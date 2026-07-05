/**
 * Streaming service — direct play file resolution + HLS transcode session setup.
 *
 * SECURITY: every served path is resolved/sanitized against its configured root
 * (MEDIA_ROOT or TRANSCODE_ROOT) via safeJoin to prevent path traversal.
 */
import { prisma } from '../../lib/db.js';
import { ApiError } from '../../lib/errors.js';
import { config } from '../../config.js';
import { safeJoin } from '../../lib/media-paths.js';
import path from 'node:path';
import fs from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';

/** Map a file extension to its MIME type for direct-play streaming. */
function mimeTypeFromExt(ext: string): string {
  const mimeMap: Record<string, string> = {
    '.mkv': 'video/x-matroska',
    '.mp4': 'video/mp4',
    '.avi': 'video/x-msvideo',
    '.mov': 'video/quicktime',
    '.webm': 'video/webm',
    '.m4v': 'video/mp4',
    '.ts': 'video/mp2t',
  };
  return mimeMap[ext.toLowerCase()] ?? 'application/octet-stream';
}

export interface MediaFileInfo {
  /** Absolute on-disk path to the media file. */
  filePath: string;
  /** MIME type determined from the file extension. */
  mimeType: string;
  /** File size in bytes. */
  size: number;
}

export interface HlsPaths {
  /** Absolute path to the HLS manifest (.m3u8). */
  manifestPath: string;
  /** Absolute path to the transcode session directory. */
  sessionDir: string;
}

export interface MediaProbe {
  videoCodec: string | null;
  audioCodec: string | null;
}

/** Video codecs a browser HLS player can play without re-encoding. */
const COPYABLE_VIDEO = new Set(['h264']);
/** Audio codecs playable as-is; anything else is re-encoded to AAC. */
const COPYABLE_AUDIO = new Set(['aac']);

/**
 * Inspect a media file's first video/audio codecs via ffprobe. Best-effort:
 * returns nulls if ffprobe fails, which makes the caller fall back to a full
 * re-encode (safe default).
 */
export function probeMedia(filePath: string): Promise<MediaProbe> {
  return new Promise((resolve) => {
    const proc = spawn('ffprobe', [
      '-v', 'error',
      '-show_entries', 'stream=codec_type,codec_name',
      '-of', 'json',
      filePath,
    ]);
    let out = '';
    proc.stdout.on('data', (c) => { out += c.toString(); });
    proc.on('error', () => resolve({ videoCodec: null, audioCodec: null }));
    proc.on('close', () => {
      try {
        const json = JSON.parse(out) as {
          streams?: { codec_type?: string; codec_name?: string }[];
        };
        const streams = json.streams ?? [];
        const video = streams.find((s) => s.codec_type === 'video');
        const audio = streams.find((s) => s.codec_type === 'audio');
        resolve({
          videoCodec: video?.codec_name ?? null,
          audioCodec: audio?.codec_name ?? null,
        });
      } catch {
        resolve({ videoCodec: null, audioCodec: null });
      }
    });
  });
}

/**
 * Build codec-aware FFmpeg args for an HLS session (Plex-style):
 *   - video already H.264  → stream-copy (remux, no re-encode → near-instant)
 *   - otherwise            → transcode to H.264 (veryfast, CRF 23)
 *   - audio already AAC     → stream-copy; otherwise → AAC stereo
 * Subtitles/data streams are dropped so the HLS muxer can't choke on them.
 */
export function buildHlsFfmpegArgs(
  probe: MediaProbe,
  sourceFile: string,
  sessionDir: string,
): string[] {
  const videoArgs = probe.videoCodec && COPYABLE_VIDEO.has(probe.videoCodec)
    ? ['-c:v', 'copy']
    : ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23', '-pix_fmt', 'yuv420p'];

  const audioArgs = probe.audioCodec && COPYABLE_AUDIO.has(probe.audioCodec)
    ? ['-c:a', 'copy']
    : ['-c:a', 'aac', '-b:a', '160k', '-ac', '2'];

  return [
    '-i', sourceFile,
    '-map', '0:v:0',
    '-map', '0:a:0?',
    '-sn', '-dn',
    ...videoArgs,
    ...audioArgs,
    '-f', 'hls',
    '-hls_time', '4',
    '-hls_list_size', '0',
    '-hls_flags', 'independent_segments',
    '-hls_segment_type', 'mpegts',
    '-start_number', '0',
    '-hls_segment_filename', path.join(sessionDir, 'segment_%05d.ts'),
    path.join(sessionDir, 'index.m3u8'),
  ];
}

/**
 * Resolve the absolute path, MIME type, and size of a media file.
 *
 * If `episodeId` is provided the episode's filePath is used (TV shows);
 * otherwise the MediaItem's own filePath is used (movies).
 */
export async function getMediaFilePath(
  mediaItemId: string,
  episodeId?: string,
): Promise<MediaFileInfo> {
  if (episodeId) {
    const episode = await prisma.episode.findUnique({
      where: { id: episodeId },
      include: { mediaItem: true },
    });
    if (!episode) throw ApiError.notFound('Episode not found');
    if (!episode.filePath) throw ApiError.notFound('Episode has no media file');

    const filePath = safeJoin(config.MEDIA_ROOT, episode.filePath);
    const size = (await fs.stat(filePath)).size;
    const mimeType = mimeTypeFromExt(path.extname(filePath));

    return { filePath, mimeType, size };
  }

  const mediaItem = await prisma.mediaItem.findUnique({
    where: { id: mediaItemId },
  });
  if (!mediaItem) throw ApiError.notFound('Media item not found');
  if (!mediaItem.filePath) throw ApiError.notFound('Media item has no file');

  const filePath = safeJoin(config.MEDIA_ROOT, mediaItem.filePath);
  const size = (await fs.stat(filePath)).size;
  const mimeType = mimeTypeFromExt(path.extname(filePath));

  return { filePath, mimeType, size };
}

/**
 * Create a unique transcode session directory and return its paths.
 *
 * Resolves the source file (to make sure it exists) then creates a UUID-named
 * output directory under TRANSCODE_ROOT.
 */
export async function getHlsPath(
  mediaItemId: string,
  episodeId?: string,
): Promise<HlsPaths> {
  // Verify the source file actually exists.
  await getMediaFilePath(mediaItemId, episodeId);

  const sessionDir = safeJoin(config.TRANSCODE_ROOT, randomUUID());
  await fs.mkdir(sessionDir, { recursive: true });

  return {
    manifestPath: path.join(sessionDir, 'index.m3u8'),
    sessionDir,
  };
}

/**
 * Spawn an FFmpeg process to transcode `sourceFile` → HLS segments.
 *
 * HLS parameters:
 *   - video: libx264, veryfast preset, CRF 23
 *   - audio: AAC 128 kbps
 *   - 4-second segments, no playlist cap (live-style growing playlist)
 *
 * The process runs in the background; errors are logged to console but never
 * reject the returned Promise — this is fire-and-forget from the route's
 * perspective.
 */
export function startTranscode(sourceFile: string, sessionDir: string): Promise<void> {
  return new Promise((resolve, reject) => {
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
      reject(err);
    });

    proc.on('exit', (code) => {
      if (code !== 0) {
        console.error(`[Transcode] FFmpeg exited with code ${code}`);
        reject(new Error(`FFmpeg exited with code ${code}`));
      } else {
        resolve();
      }
    });
  });
}
