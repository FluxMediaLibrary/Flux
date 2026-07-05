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
  getHlsPath,
} from './streaming.service.js';
import { safeJoin } from '../../lib/media-paths.js';
import { ApiError } from '../../lib/errors.js';
import path from 'node:path';
import fs from 'node:fs';
import { spawn } from 'node:child_process';

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
 * Fire-and-forget FFmpeg HLS transcode in a background child process.
 * The promise resolves on spawn success (so we know the process started);
 * any exit errors are logged but never propagated to the HTTP response.
 */
function spawnTranscode(sourceFile: string, sessionDir: string): void {
  const args = [
    '-i', sourceFile,
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23',
    '-c:a', 'aac', '-b:a', '128k',
    '-f', 'hls', '-hls_time', '4', '-hls_list_size', '0',
    '-hls_segment_filename', path.join(sessionDir, 'segment_%05d.ts'),
    path.join(sessionDir, 'index.m3u8'),
  ];

  const proc = spawn('ffmpeg', args, { stdio: 'ignore' });

  proc.on('error', (err) => {
    console.error('[Transcode] FFmpeg spawn error:', err);
  });
  proc.on('exit', (code) => {
    if (code !== 0) {
      console.error(`[Transcode] FFmpeg exited with code ${code}`);
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

      // Reuse an existing session if its manifest is already on disk.
      const existingSession = hlsSessions.get(key);
      if (existingSession) {
        const existingManifest = path.join(existingSession, 'index.m3u8');
        if (fs.existsSync(existingManifest)) {
          return sendManifest(fs.readFileSync(existingManifest, 'utf-8'));
        }
      }

      // Create a fresh session.
      const hls = await getHlsPath(mediaItemId, episodeId);
      const { manifestPath, sessionDir } = hls;
      hlsSessions.set(key, sessionDir);

      // Resolve the source file for FFmpeg.
      const { filePath: sourceFile } = await getMediaFilePath(mediaItemId, episodeId);

      // Fire-and-forget transcode in the background.
      spawnTranscode(sourceFile, sessionDir);

      // Poll for the manifest (up to 30 attempts × 500 ms = 15 s).
      const ready = await pollForFile(manifestPath, 30, 500);
      if (!ready) {
        throw ApiError.badRequest(
          'HLS transcode timed out — try again shortly',
          'TRANSCODE_TIMEOUT',
        );
      }

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
      if (!fs.existsSync(segmentPath)) {
        throw ApiError.notFound('HLS segment not found');
      }

      const stream = fs.createReadStream(segmentPath);
      return reply
        .header('Content-Type', 'video/mp2t')
        .send(stream);
    },
  );
};
