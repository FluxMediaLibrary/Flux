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
  decidePlayback,
} from './streaming.service.js';
import { safeJoin } from '../../lib/media-paths.js';
import { config } from '../../config.js';
import { ApiError } from '../../lib/errors.js';
import path from 'node:path';
import fs from 'node:fs';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';

// ── In-memory session tracking ──────────────────────────────────────────────
// Maps a (mediaItemId, episodeId) pair → sessionDir so segment routes know
// where .ts files live. Keyed per-episode so switching episodes of the same
// show does not replay the previous episode's manifest.
const hlsSessions = new Map<string, string>();

function sessionKey(mediaItemId: string, episodeId?: string): string {
  return `${mediaItemId}::${episodeId ?? ''}`;
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
): string {
  if (!token) return manifest;
  return manifest
    .split('\n')
    .map((line) => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) return line;
      const params = new URLSearchParams({ token });
      if (episodeId) params.set('episodeId', episodeId);
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

/**
 * Probe the source, then fire-and-forget a codec-aware FFmpeg HLS session:
 * H.264/AAC are stream-copied (remux → near-instant), everything else is
 * transcoded. Errors are logged but never propagated to the HTTP response.
 */
async function spawnTranscode(
  sourceFile: string,
  sessionDir: string,
): Promise<void> {
  const probe = await probeMedia(sourceFile);
  const args = buildHlsFfmpegArgs(probe, sourceFile, sessionDir);
  console.log(
    `[Transcode] video=${probe.videoCodec ?? '?'} audio=${probe.audioCodec ?? '?'} → ${args.includes('copy') ? 'remux/partial-copy' : 'transcode'}`,
  );

  // Capture stderr so a mid-file FFmpeg failure (bad codec, corrupt source,
  // incomplete download) is visible in the logs instead of the stream just
  // silently stopping a few segments in.
  const proc = spawn('ffmpeg', args, { stdio: ['ignore', 'ignore', 'pipe'] });
  let stderrTail = '';
  proc.stderr?.on('data', (c) => {
    stderrTail = (stderrTail + c.toString()).slice(-4000);
  });
  proc.on('error', (err) => {
    console.error('[Transcode] FFmpeg spawn error:', err);
  });
  proc.on('exit', (code, signal) => {
    // 255 / SIGKILL / SIGTERM = we/the client stopped it — not a failure.
    if (code !== 0 && code !== 255 && signal !== 'SIGKILL' && signal !== 'SIGTERM') {
      console.error(
        `[Transcode] FFmpeg exited code=${code} signal=${signal ?? ''}\n${stderrTail}`,
      );
    }
  });
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

        const stream = fs.createReadStream(filePath, { start, end });
        return reply.send(stream);
      }

      // Full file (no Range header).
      reply
        .status(200)
        .header('Accept-Ranges', 'bytes')
        .header('Content-Length', size)
        .header('Content-Type', mimeType);

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
      return decidePlayback(filePath);
    },
  );

  // ── GET /:mediaItemId/hls/index.m3u8 — HLS manifest (transcode on demand) ─

  app.get(
    '/:mediaItemId/hls/index.m3u8',
    { preHandler: [app.requireProfileStream] },
    async (request, reply) => {
      const { mediaItemId } = request.params as { mediaItemId: string };
      const { episodeId } = request.query as { episodeId?: string };
      const key = sessionKey(mediaItemId, episodeId);
      const token = streamToken(request);

      const sendManifest = (raw: string) =>
        reply
          .header('Content-Type', 'application/vnd.apple.mpegurl')
          .header('Cache-Control', 'no-store')
          .send(tokenizeManifest(raw, token, episodeId));

      let sessionDir = hlsSessions.get(key);
      if (!sessionDir) {
        // 404 if the source file doesn't exist — before reserving a session.
        const { filePath: sourceFile } = await getMediaFilePath(
          mediaItemId,
          episodeId,
        );
        // Re-check after the await: the set below is synchronous, so two
        // concurrent requests can't both spawn a transcode for the same key.
        sessionDir = hlsSessions.get(key);
        if (!sessionDir) {
          sessionDir = safeJoin(config.TRANSCODE_ROOT, randomUUID());
          hlsSessions.set(key, sessionDir);
          await fs.promises.mkdir(sessionDir, { recursive: true });
          await spawnTranscode(sourceFile, sessionDir);
        }
      }

      // Poll for the manifest (up to 40 attempts × 500 ms = 20 s).
      const manifestPath = path.join(sessionDir, 'index.m3u8');
      const ready = await pollForFile(manifestPath, 40, 500);
      if (!ready) {
        throw ApiError.badRequest(
          'HLS transcode timed out — try again shortly',
          'TRANSCODE_TIMEOUT',
        );
      }

      // Head start: wait (best-effort) for a few segments so playback opens with
      // runway and doesn't immediately catch the encoder's live edge — the main
      // cause of a hard stop ~one segment in. Harmless for short clips.
      await pollForFile(path.join(sessionDir, 'segment_00002.ts'), 16, 500);

      return sendManifest(fs.readFileSync(manifestPath, 'utf-8'));
    },
  );

  // ── GET /:mediaItemId/hls/:segment — serve .ts segments ───────────────────

  app.get(
    '/:mediaItemId/hls/:segment',
    { preHandler: [app.requireProfileStream] },
    async (request, reply) => {
      const { mediaItemId, segment } = request.params as {
        mediaItemId: string;
        segment: string;
      };
      const { episodeId } = request.query as { episodeId?: string };

      const sessionDir = hlsSessions.get(sessionKey(mediaItemId, episodeId));
      if (!sessionDir) {
        throw ApiError.notFound('No active HLS session for this media item');
      }

      const segmentPath = safeJoin(sessionDir, segment);
      // The segment may be a beat behind the encoder — wait for it (up to ~15s)
      // rather than 404-ing, which hls.js treats as a fatal load error.
      if (!fs.existsSync(segmentPath)) {
        await pollForFile(segmentPath, 30, 500);
      }
      if (!fs.existsSync(segmentPath)) {
        throw ApiError.notFound('HLS segment not found');
      }

      const stream = fs.createReadStream(segmentPath);
      return reply
        .header('Content-Type', 'video/mp2t')
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
};
