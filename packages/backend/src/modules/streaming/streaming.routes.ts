/**
 * Streaming routes — direct play (HTTP range) + on-demand FFmpeg HLS transcode.
 *
 * Mounted at /api/stream.
 *
 * SECURITY: every served path is resolved/sanitized against its configured root
 * (MEDIA_ROOT or TRANSCODE_ROOT) via safeJoin to prevent path traversal.
 */
import type { FastifyInstance, FastifyPluginAsync } from 'fastify';
import {
  getMediaFilePath,
  probeMedia,
  buildHlsFfmpegArgs,
  getPlaybackInfo,
  decideCastPlayback,
  getCastMediaMetadata,
} from './streaming.service.js';
import { buildAdaptiveHlsArgs } from '../../lib/adaptive-hls.js';
import {
  ensureTrickplay,
  trickplayAssetPath,
} from '../../lib/trickplay-generator.js';
import { safeJoin } from '../../lib/media-paths.js';
import { config } from '../../config.js';
import { ApiError } from '../../lib/errors.js';
import path from 'node:path';
import fs from 'node:fs';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { signStreamToken } from '../../lib/jwt.js';
import type { CastPlaybackInfoDTO } from '@flux/shared';

// ── In-memory session tracking ──────────────────────────────────────────────
// Maps a (mediaItemId, episodeId) pair → sessionDir so segment routes know
// where .ts files live. Keyed per-episode so switching episodes of the same
// show does not replay the previous episode's manifest.
interface HlsSession {
  dir: string;
  manifest: 'index.m3u8' | 'master.m3u8';
  transcode: TranscodeState;
}

interface TranscodeState {
  proc: ReturnType<typeof spawn>;
  exited: boolean;
  failure: string | null;
  stderrTail: string;
}

const hlsSessions = new Map<string, HlsSession>();

function sessionBaseKey(mediaItemId: string, episodeId?: string, audioStreamIndex?: number): string {
  return `${mediaItemId}::${episodeId ?? ''}::audio=${audioStreamIndex ?? 'default'}`;
}

function sessionKey(
  mediaItemId: string,
  episodeId?: string,
  audioStreamIndex?: number,
  startTimeSeconds = 0,
): string {
  return `${sessionBaseKey(mediaItemId, episodeId, audioStreamIndex)}::start=${startTimeSeconds.toFixed(3)}`;
}

function parseStartTime(value: string | undefined): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return 0;
  return Math.round(parsed * 1000) / 1000;
}

function publicApiBaseUrl(request: { protocol: string; headers: { host?: string } }): { baseUrl: string; warnings: string[] } {
  const inferred = request.headers.host ? `${request.protocol}://${request.headers.host}` : '';
  const baseUrl = (config.PUBLIC_API_BASE_URL ?? inferred).replace(/\/$/, '');
  const warnings: string[] = [];
  if (!baseUrl) {
    throw ApiError.internal('Could not determine public API base URL for Cast playback', 'CAST_PUBLIC_URL_MISSING');
  }
  const url = new URL(baseUrl);
  if (['localhost', '127.0.0.1', '::1'].includes(url.hostname)) {
    warnings.push('Cast receivers cannot reach localhost URLs. Set PUBLIC_API_BASE_URL to an HTTPS/LAN API URL reachable by the TV.');
  }
  if (url.protocol !== 'https:' && url.hostname !== 'localhost' && url.hostname !== '127.0.0.1') {
    warnings.push('Production Cast playback should use HTTPS. Some receiver/network combinations reject insecure media URLs.');
  }
  return { baseUrl, warnings };
}

function posterUrlFromPath(posterPath: string | null): string | null {
  return posterPath ? `https://image.tmdb.org/t/p/w342${posterPath}` : null;
}

/**
 * Resolve the raw JWT from a stream request — either the Authorization header
 * or the `?token=` query param. Returns '' if absent (the preHandler has
 * already enforced auth, so this is only for propagating the token onward to
 * segment URLs in the rewritten manifest).
 */
function streamToken(request: {
  headers: { authorization?: string };
  query: unknown;
}): string {
  const header = request.headers.authorization;
  if (header && header.startsWith('Bearer ')) {
    const t = header.slice('Bearer '.length).trim();
    if (t) return t;
  }
  const q = (request.query as { token?: unknown })?.token;
  return typeof q === 'string' ? q : '';
}

/**
 * Rewrite the segment URIs in an HLS manifest so each carries the auth `token`
 * (and `episodeId` when present) as query params. Browser media loaders cannot
 * attach an Authorization header to segment requests, so the credential must
 * ride along in the URL. Comment/tag lines (`#…`) are left untouched.
 */
function tokenizeManifest(
  manifest: string,
  token: string,
  episodeId?: string,
  audioStreamIndex?: number,
  startTimeSeconds = 0,
): string {
  if (!token) return manifest;
  return manifest
    .split('\n')
    .map((line) => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) return line;
      const params = new URLSearchParams({ token });
      if (episodeId) params.set('episodeId', episodeId);
      if (typeof audioStreamIndex === 'number') params.set('audioStream', String(audioStreamIndex));
      if (startTimeSeconds > 0) params.set('startTime', startTimeSeconds.toFixed(3));
      const sep = trimmed.includes('?') ? '&' : '?';
      return `${trimmed}${sep}${params.toString()}`;
    })
    .join('\n');
}

// ── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Parse an HTTP Range header into { start, end } byte offsets.
 * Returns null when the header is missing, malformed, or out of bounds.
 *
 * Range spec: bytes=start-end  (both sides optional, end is inclusive).
 */
function parseRange(
  header: string,
  size: number,
): { start: number; end: number } | null {
  const match = header.match(/bytes=(\d*)-(\d*)/);
  if (!match) return null;
  const start = match[1] ? parseInt(match[1], 10) : 0;
  const end = match[2] ? parseInt(match[2], 10) : size - 1;
  if (start >= size || end >= size || start > end) return null;
  return { start, end };
}

/** Start FFmpeg and retain enough process state to fail requests immediately. */
function spawnTrackedTranscode(args: string[]): TranscodeState {
  const proc = spawn('ffmpeg', args, { stdio: ['ignore', 'ignore', 'pipe'] });
  const state: TranscodeState = {
    proc,
    exited: false,
    failure: null,
    stderrTail: '',
  };

  proc.stderr?.on('data', (chunk: Buffer) => {
    state.stderrTail = (state.stderrTail + chunk.toString()).slice(-8000);
  });
  proc.on('error', (error) => {
    state.exited = true;
    state.failure = error.message;
    console.error('[Transcode] FFmpeg spawn error:', error);
  });
  proc.on('exit', (code, signal) => {
    state.exited = true;
    if (code !== 0 && signal !== 'SIGKILL' && signal !== 'SIGTERM') {
      state.failure = `FFmpeg exited code=${code} signal=${signal ?? ''}`;
      console.error(`${state.failure}\n${state.stderrTail}`);
    }
  });

  return state;
}

/**
 * Probe the source, then fire-and-forget an HLS transcode session.
 *
 * Strategy:
 * - If the source is H.264 video + AAC audio in a browser-friendly container
 *   it will be direct-played — this HLS path is only hit as a fallback or
 *   for non-browser-compatible codecs.
 * - Single tier (remux or transcode): when the source is already at a single
 *   resolution, or we can't determine the source resolution. Produces
 *   `sessionDir/index.m3u8`.
 * - Adaptive (multi-quality master): when the source resolution is known and
 *   transcoding is needed. Produces `sessionDir/master.m3u8` with quality
 *   variants in `sessionDir/stream_N/`.
 *
 * Returns the manifest type together with the tracked FFmpeg process.
 */
async function spawnTranscode(
  sourceFile: string,
  sessionDir: string,
  audioStreamIndex?: number,
  startTimeSeconds = 0,
): Promise<{ manifest: 'index.m3u8' | 'master.m3u8'; transcode: TranscodeState }> {
  const probe = await probeMedia(sourceFile, audioStreamIndex);

  // Use adaptive when we have resolution info AND the source needs a transcode
  // (not a pure copy/remux). Remuxing a single stream is faster and simpler.
  const needsTranscode =
    probe.videoCodec !== 'h264' ||
    (probe.audioCodec !== null && probe.audioCodec !== 'aac');

  if (needsTranscode && probe.width && probe.height) {
    const args = buildAdaptiveHlsArgs(
      sourceFile, sessionDir,
      probe.videoCodec, probe.audioCodec,
      probe.width, probe.height,
      probe.videoStreamIndex ?? undefined,
      probe.audioStreamIndex ?? undefined,
      startTimeSeconds,
    );
    console.log(
      `[Transcode] adaptive video=${probe.videoCodec ?? '?'} audio=${probe.audioCodec ?? '?'} ` +
      `${probe.width}x${probe.height} -> multi-quality transcode`,
    );
    return { manifest: 'master.m3u8', transcode: spawnTrackedTranscode(args) };
  }

  // Fall back to single-quality (existing behavior)
  const args = buildHlsFfmpegArgs(
    probe,
    sourceFile,
    sessionDir,
    audioStreamIndex,
    startTimeSeconds,
  );
  console.log(
    `[Transcode] single video=${probe.videoCodec ?? '?'} audio=${probe.audioCodec ?? '?'} → ${args.includes('copy') ? 'remux/partial-copy' : 'transcode'}`,
  );
  return { manifest: 'index.m3u8', transcode: spawnTrackedTranscode(args) };
}

/**
 * Poll for a file to appear on disk, retrying up to `retries` times with
 * `intervalMs` between each attempt. Returns true once the file exists.
 */
async function pollForFile(
  filePath: string,
  retries: number,
  intervalMs: number,
): Promise<boolean> {
  for (let i = 0; i < retries; i++) {
    if (fs.existsSync(filePath)) return true;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  return fs.existsSync(filePath);
}

async function pollForSessionFile(
  session: HlsSession,
  filePath: string,
  retries: number,
  intervalMs: number,
): Promise<boolean> {
  for (let i = 0; i < retries; i++) {
    if (fs.existsSync(filePath)) return true;
    if (session.transcode.failure) return false;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  return fs.existsSync(filePath);
}

async function discardSession(key: string, session: HlsSession): Promise<void> {
  if (!session.transcode.exited) session.transcode.proc.kill('SIGTERM');
  hlsSessions.delete(key);
  await fs.promises.rm(session.dir, { recursive: true, force: true }).catch(() => {});
}

async function discardOtherSessions(baseKey: string, keepKey: string): Promise<void> {
  const stale = [...hlsSessions.entries()].filter(
    ([key]) => key !== keepKey && key.startsWith(`${baseKey}::start=`),
  );
  await Promise.all(stale.map(([key, session]) => discardSession(key, session)));
}

// ── Routes ──────────────────────────────────────────────────────────────────

export const streamingRoutes: FastifyPluginAsync = async (
  app: FastifyInstance,
) => {
  // ── GET /:mediaItemId — direct play with HTTP range support ───────────────

  app.get(
    '/:mediaItemId',
    { preHandler: [app.requireProfileStream] },
    async (request, reply) => {
      const { mediaItemId } = request.params as { mediaItemId: string };
      const { episodeId } = request.query as { episodeId?: string };
      const { filePath, mimeType, size } = await getMediaFilePath(mediaItemId, episodeId);

      const rangeHeader = request.headers.range;
      if (rangeHeader) {
        const parsed = parseRange(rangeHeader, size);
        if (!parsed) {
          request.log.warn({ mediaItemId, episodeId, rangeHeader, size }, '[Stream] invalid range request');
          return reply
            .status(416)
            .header('Content-Range', `bytes */${size}`)
            .send();
        }

        const { start, end } = parsed;
        const chunkSize = end - start + 1;

        reply
          .status(206)
          .header('Content-Range', `bytes ${start}-${end}/${size}`)
          .header('Accept-Ranges', 'bytes')
          .header('Content-Length', chunkSize)
          .header('Content-Type', mimeType);

        request.log.info({ mediaItemId, episodeId, mimeType, start, end, size }, '[Stream] serving byte range');
        const stream = fs.createReadStream(filePath, { start, end });
        return reply.send(stream);
      }

      // Full file (no Range header).
      reply
        .status(200)
        .header('Accept-Ranges', 'bytes')
        .header('Content-Length', size)
        .header('Content-Type', mimeType);

      request.log.info({ mediaItemId, episodeId, mimeType, size }, '[Stream] serving full file');
      const stream = fs.createReadStream(filePath);
      return reply.send(stream);
    },
  );

  // ── GET /:mediaItemId/info — how should the client play this? ─────────────

  app.get(
    '/:mediaItemId/info',
    { preHandler: [app.requireProfile] },
    async (request) => {
      const { mediaItemId } = request.params as { mediaItemId: string };
      const { episodeId } = request.query as { episodeId?: string };
      const { filePath } = await getMediaFilePath(mediaItemId, episodeId);
      return getPlaybackInfo(filePath, mediaItemId, episodeId);
    },
  );

  // ── GET /:mediaItemId/cast-info — receiver-safe URL + media metadata ─────

  app.get(
    '/:mediaItemId/cast-info',
    { preHandler: [app.requireProfile] },
    async (request): Promise<CastPlaybackInfoDTO> => {
      const { mediaItemId } = request.params as { mediaItemId: string };
      const { episodeId, currentTime } = request.query as {
        episodeId?: string;
        currentTime?: string;
      };
      const { filePath } = await getMediaFilePath(mediaItemId, episodeId);
      const decision = await decideCastPlayback(filePath, mediaItemId, episodeId);
      const metadata = await getCastMediaMetadata(mediaItemId, episodeId);
      const { baseUrl, warnings } = publicApiBaseUrl(request);
      const expiresAt = new Date(Date.now() + 2 * 60 * 60 * 1000);
      const token = signStreamToken({
        sub: request.account!.id,
        role: request.account!.role,
        activeProfileId: request.activeProfileId!,
      }, '2h');
      const qs = new URLSearchParams({ token });
      if (episodeId) qs.set('episodeId', episodeId);
      const startTimeSeconds = parseStartTime(currentTime);
      if (decision.method === 'hls' && startTimeSeconds > 0) {
        qs.set('startTime', startTimeSeconds.toFixed(3));
      }

      const pathPart = decision.method === 'direct'
        ? `/api/stream/${encodeURIComponent(mediaItemId)}`
        : `/api/stream/${encodeURIComponent(mediaItemId)}/hls/index.m3u8`;
      const url = `${baseUrl}${pathPart}?${qs.toString()}`;

      request.log.info({
        mediaItemId,
        episodeId,
        method: decision.method,
        contentType: decision.contentType,
        videoCodec: decision.videoCodec,
        audioCodec: decision.audioCodec,
        reason: decision.reason,
        warnings,
      }, '[Cast] generated receiver playback URL');

      return {
        url,
        contentType: decision.contentType,
        streamType: 'BUFFERED',
        method: decision.method,
        title: metadata.title,
        subtitle: metadata.subtitle,
        posterUrl: posterUrlFromPath(metadata.posterPath),
        durationSeconds: decision.durationSeconds,
        expiresAt: expiresAt.toISOString(),
        warnings,
      };
    },
  );

  // ── GET /:mediaItemId/hls/index.m3u8 — HLS manifest (transcode on demand) ─

  app.get(
    '/:mediaItemId/hls/index.m3u8',
    { preHandler: [app.requireProfileStream] },
    async (request, reply) => {
      const { mediaItemId } = request.params as { mediaItemId: string };
      const { episodeId, audioStream, startTime } = request.query as {
        episodeId?: string;
        audioStream?: string;
        startTime?: string;
      };
      const audioStreamIndex =
        audioStream !== undefined && Number.isInteger(Number(audioStream))
          ? Number(audioStream)
          : undefined;
      const startTimeSeconds = parseStartTime(startTime);
      const baseKey = sessionBaseKey(mediaItemId, episodeId, audioStreamIndex);
      const key = sessionKey(mediaItemId, episodeId, audioStreamIndex, startTimeSeconds);
      const token = streamToken(request);

      const sendManifest = (raw: string) =>
        reply
          .header('Content-Type', 'application/vnd.apple.mpegurl')
          .header('Cache-Control', 'no-store')
          .send(tokenizeManifest(raw, token, episodeId, audioStreamIndex, startTimeSeconds));

      let session = hlsSessions.get(key);
      let manifestType: 'index.m3u8' | 'master.m3u8' = 'index.m3u8';
      if (!session) {
        // 404 if the source file doesn't exist — before reserving a session.
        const { filePath: sourceFile } = await getMediaFilePath(
          mediaItemId,
          episodeId,
        );
        // Re-check after the await: the set below is synchronous, so two
        // concurrent requests can't both spawn a transcode for the same key.
        session = hlsSessions.get(key);
        if (!session) {
          await discardOtherSessions(baseKey, key);
          const sessionDir = safeJoin(config.TRANSCODE_ROOT, randomUUID());
          await fs.promises.mkdir(sessionDir, { recursive: true });
          const started = await spawnTranscode(
            sourceFile,
            sessionDir,
            audioStreamIndex,
            startTimeSeconds,
          );
          manifestType = started.manifest;
          session = { dir: sessionDir, manifest: manifestType, transcode: started.transcode };
          hlsSessions.set(key, session);
          request.log.info({
            mediaItemId,
            episodeId,
            audioStreamIndex,
            startTimeSeconds,
            manifestType,
          }, '[Cast/HLS] started transcode session');
        }
      } else {
        manifestType = session.manifest;
      }

      // Poll for the manifest (up to 40 attempts × 500 ms = 20 s).
      // Try master.m3u8 first (adaptive), then index.m3u8 (single-tier/remux).
      let manifestPath = path.join(session.dir, manifestType);
      let ready = await pollForSessionFile(session, manifestPath, 40, 500);
      if (!ready && manifestType === 'master.m3u8') {
        // Adaptive transcode may have been downgraded — fall back to single-tier.
        manifestPath = path.join(session.dir, 'index.m3u8');
        ready = await pollForSessionFile(session, manifestPath, 8, 500);
        if (ready) {
          session.manifest = 'index.m3u8';
          manifestType = 'index.m3u8';
        }
      }
      if (!ready) {
        const failed = session.transcode.failure !== null;
        request.log.error({
          mediaItemId,
          episodeId,
          manifestType,
          failed,
          failure: session.transcode.failure,
        }, '[Cast/HLS] manifest did not become ready');
        await discardSession(key, session);
        throw ApiError.badRequest(
          failed
            ? 'This file could not be transcoded. The failed session was reset; retry will start cleanly.'
            : 'The transcode did not become ready in time. The session was reset; please retry.',
          failed ? 'TRANSCODE_FAILED' : 'TRANSCODE_TIMEOUT',
        );
      }

      // Head start: wait (best-effort) for a few segments so playback opens with
      // runway and doesn't immediately catch the encoder's live edge — the main
      // cause of a hard stop ~one segment in. Harmless for short clips.
      // For adaptive streams, segments are nested under stream_0/.
      const segDir = manifestType === 'master.m3u8' ? 'stream_0' : '.';
      await pollForSessionFile(session, path.join(session.dir, segDir, 'segment_00002.ts'), 16, 500);
      if (session.transcode.failure) {
        request.log.error({
          mediaItemId,
          episodeId,
          failure: session.transcode.failure,
        }, '[Cast/HLS] transcode stopped before playback runway was ready');
        await discardSession(key, session);
        throw ApiError.badRequest(
          'The transcode stopped before playback was ready. Retry to start a clean session.',
          'TRANSCODE_FAILED',
        );
      }

      request.log.info({ mediaItemId, episodeId, manifestType, startTimeSeconds }, '[Cast/HLS] serving manifest');
      return sendManifest(fs.readFileSync(manifestPath, 'utf-8'));
    },
  );

  // ── GET /:mediaItemId/hls/* — serve .ts segments and nested playlists ──────

  app.get(
    '/:mediaItemId/hls/*',
    { preHandler: [app.requireProfileStream] },
    async (request, reply) => {
      const { mediaItemId } = request.params as { mediaItemId: string };
      const { '*': relPath } = request.params as { '*': string };
      const { episodeId, audioStream, startTime } = request.query as {
        episodeId?: string;
        audioStream?: string;
        startTime?: string;
      };
      const audioStreamIndex =
        audioStream !== undefined && Number.isInteger(Number(audioStream))
          ? Number(audioStream)
          : undefined;
      const startTimeSeconds = parseStartTime(startTime);

      const key = sessionKey(mediaItemId, episodeId, audioStreamIndex, startTimeSeconds);
      const session = hlsSessions.get(key);
      if (!session) {
        throw ApiError.notFound('No active HLS session for this media item');
      }
      if (session.transcode.failure) {
        await discardSession(key, session);
        throw ApiError.badRequest(
          'The transcode stopped unexpectedly. Retry to start a clean session.',
          'TRANSCODE_FAILED',
        );
      }

      const filePath = safeJoin(session.dir, relPath);
      // The segment may be a beat behind the encoder — wait for it (up to ~15s)
      // rather than 404-ing, which hls.js treats as a fatal load error.
      if (!fs.existsSync(filePath)) {
        await pollForFile(filePath, 30, 500);
      }
      if (!fs.existsSync(filePath)) {
        request.log.warn({ mediaItemId, episodeId, relPath }, '[Cast/HLS] requested segment was not found');
        throw ApiError.notFound('HLS segment not found');
      }

      // Determine Content-Type from extension
      const ext = path.extname(filePath).toLowerCase();
      const contentType = ext === '.m3u8'
        ? 'application/vnd.apple.mpegurl'
        : 'video/mp2t';

      // Variant playlists (stream_N/index.m3u8) must be tokenized so the
      // segment URLs they reference carry the auth token. Without this,
      // adaptive HLS silently fails: the master playlist is tokenized by
      // the manifest endpoint but the variant playlists served here are
      // raw, leaving segment requests without a token → 401 → retry loop.
      if (ext === '.m3u8') {
        const raw = fs.readFileSync(filePath, 'utf-8');
        const tokenized = tokenizeManifest(
          raw,
          streamToken(request),
          episodeId,
          audioStreamIndex,
          startTimeSeconds,
        );
        return reply
          .header('Content-Type', contentType)
          .header('Cache-Control', 'no-store')
          .send(tokenized);
      }

      request.log.debug({ mediaItemId, episodeId, relPath, contentType }, '[Cast/HLS] serving segment');
      const stream = fs.createReadStream(filePath);
      return reply
        .header('Content-Type', contentType)
        .send(stream);
    },
  );

  // ── GET /:mediaItemId/thumb — thumbnail frame at a given timestamp ─────────

  app.get(
    '/:mediaItemId/thumb',
    { preHandler: [app.requireProfileStream] },
    async (request, reply) => {
      const { mediaItemId } = request.params as { mediaItemId: string };
      const { t, episodeId } = request.query as {
        t?: string;
        episodeId?: string;
      };
      const time = parseFloat(t ?? '');
      if (!Number.isFinite(time) || time < 0) {
        throw ApiError.badRequest('Invalid timestamp', 'INVALID_THUMB_TIME');
      }

      const { filePath } = await getMediaFilePath(mediaItemId, episodeId);

      const args = [
        '-ss', String(time),
        '-i', filePath,
        '-vframes', '1',
        '-vf', 'scale=160:-1',
        '-f', 'image2pipe',
        '-vcodec', 'mjpeg',
        '-q:v', '5',
        '-',
      ];

      return new Promise<void>((resolve) => {
        const proc = spawn('ffmpeg', args, {
          stdio: ['ignore', 'pipe', 'ignore'],
        });
        const chunks: Buffer[] = [];
        proc.stdout!.on('data', (c: Buffer) => chunks.push(c));
        proc.stdout!.on('end', () => {
          const buf = Buffer.concat(chunks);
          if (buf.length === 0) {
            reply.status(404).send();
            resolve();
            return;
          }
          reply
            .header('Content-Type', 'image/jpeg')
            .header('Cache-Control', 'public, max-age=86400')
            .send(buf);
          resolve();
        });
        proc.on('error', () => {
          if (!reply.sent) reply.status(500).send();
          resolve();
        });
      });
    },
  );

  // ── GET /:mediaItemId/trickplay/:file — serve sprite sheets and VTT ─────────

  app.get(
    '/:mediaItemId/trickplay/:file',
    { preHandler: [app.requireProfileStream] },
    async (request, reply) => {
      const { mediaItemId, file } = request.params as { mediaItemId: string; file: string };
      const { episodeId } = request.query as { episodeId?: string };

      const { filePath: sourceFile } = await getMediaFilePath(mediaItemId, episodeId);
      const assetPath = trickplayAssetPath(sourceFile, file);
      if (!assetPath) {
        throw ApiError.badRequest('Invalid trickplay asset', 'INVALID_TRICKPLAY_ASSET');
      }

      if (!fs.existsSync(assetPath)) {
        const probe = await probeMedia(sourceFile);
        if (probe.durationSeconds && probe.durationSeconds > 0) {
          await ensureTrickplay(sourceFile, probe.durationSeconds);
        }
      }
      if (!fs.existsSync(assetPath)) {
        return reply
          .status(204)
          .header('Cache-Control', 'no-store')
          .send();
      }

      const ext = path.extname(assetPath).toLowerCase();
      const contentType =
        ext === '.vtt' ? 'text/vtt' :
        ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg' :
        'application/octet-stream';

      const stream = fs.createReadStream(assetPath);
      return reply
        .header('Content-Type', contentType)
        .header('Cache-Control', 'public, max-age=86400, immutable')
        .send(stream);
    },
  );
};
