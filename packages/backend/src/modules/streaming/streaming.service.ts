/**
 * Streaming service — direct play file resolution + HLS transcode session setup.
 *
 * SECURITY: every served path is resolved/sanitized against its configured root
 * (MEDIA_ROOT or TRANSCODE_ROOT) via safeJoin to prevent path traversal.
 */
import { prisma } from '../../lib/db.js';
import { ApiError } from '../../lib/errors.js';
import { config } from '../../config.js';
import { safeJoin, resolveFilePath } from '../../lib/media-paths.js';
import path from 'node:path';
import fs from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { QUALITY_TIERS, applicableTiers } from '../../lib/adaptive-hls.js';
import type { MediaStreamDTO, PlaybackInfoDTO } from '@flux/shared';
import type { MediaStream } from '@prisma/client';
import { mapMediaSegmentToDTO } from '../media-segments/media-segments.service.js';
import { getServerSettings } from '../settings/settings.service.js';

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
  videoStreamIndex: number | null;
  audioStreamIndex: number | null;
  width: number | null;
  height: number | null;
  /** Source file duration in seconds (from ffprobe format.duration). */
  durationSeconds: number | null;
}

/** Video codecs a browser HLS player can play without re-encoding. */
const COPYABLE_VIDEO = new Set(['h264']);
/** Audio codecs playable as-is; anything else is re-encoded to AAC. */
const COPYABLE_AUDIO = new Set(['aac']);

/**
 * Inspect a media file's first video/audio codecs via ffprobe. Best-effort:
 * returns nulls if ffprobe fails, which makes the caller fall back to a full
 * re-encode (safe default). Also returns the source file duration so the
 * frontend can display an accurate seek bar even for HLS event playlists
 * where video.duration reports Infinity.
 */
export function probeMedia(
  filePath: string,
  audioStreamIndex?: number,
): Promise<MediaProbe> {
  return new Promise((resolve) => {
    const proc = spawn('ffprobe', [
      '-v', 'error',
      '-show_entries', 'stream=index,codec_type,codec_name,width,height,disposition:format=duration',
      '-of', 'json',
      filePath,
    ]);
    let out = '';
    proc.stdout.on('data', (c) => { out += c.toString(); });
    proc.on('error', () => resolve({
      videoCodec: null,
      audioCodec: null,
      videoStreamIndex: null,
      audioStreamIndex: null,
      width: null,
      height: null,
      durationSeconds: null,
    }));
    proc.on('close', () => {
      try {
        const json = JSON.parse(out) as {
          format?: { duration?: string };
          streams?: {
            index?: number;
            codec_type?: string;
            codec_name?: string;
            width?: number;
            height?: number;
            disposition?: { default?: number; attached_pic?: number };
          }[];
        };
        const streams = json.streams ?? [];
        const videoStreams = streams.filter((s) => s.codec_type === 'video');
        const playableVideoStreams = videoStreams.filter((s) => s.disposition?.attached_pic !== 1);
        const video =
          playableVideoStreams.find((s) => s.disposition?.default === 1) ??
          playableVideoStreams[0] ??
          videoStreams[0];
        const audioStreams = streams.filter((s) => s.codec_type === 'audio');
        const audio =
          typeof audioStreamIndex === 'number'
            ? audioStreams.find((s) => s.index === audioStreamIndex)
            : audioStreams.find((s) => s.disposition?.default === 1) ?? audioStreams[0];
        const durRaw = json.format?.duration;
        const durationSeconds = durRaw ? parseFloat(durRaw) : null;
        resolve({
          videoCodec: video?.codec_name ?? null,
          audioCodec: audio?.codec_name ?? null,
          videoStreamIndex: video?.index ?? null,
          audioStreamIndex: audio?.index ?? null,
          width: video?.width ?? null,
          height: video?.height ?? null,
          durationSeconds: Number.isFinite(durationSeconds) ? durationSeconds : null,
        });
      } catch {
        resolve({
          videoCodec: null,
          audioCodec: null,
          videoStreamIndex: null,
          audioStreamIndex: null,
          width: null,
          height: null,
          durationSeconds: null,
        });
      }
    });
  });
}

/** Containers a browser can demux for direct play (by file extension). */
const DIRECT_CONTAINERS = new Set(['.mp4', '.m4v', '.mov', '.webm']);
/** Video codecs browsers decode natively. */
const DIRECT_VIDEO = new Set(['h264', 'vp9', 'vp8', 'av1']);
/** Audio codecs browsers decode natively (AC3/EAC3/DTS are NOT here). */
const DIRECT_AUDIO = new Set(['aac', 'mp3', 'opus', 'vorbis', 'flac']);

export interface PlaybackDecision {
  /** True when the browser can play the file as-is (no transcode/remux). */
  directPlay: boolean;
  videoCodec: string | null;
  audioCodec: string | null;
  /** Source file duration in seconds (from ffprobe). Null if probe failed. */
  durationSeconds: number | null;
}

export interface CastPlaybackDecision {
  /** Chromecast-friendly direct MP4, otherwise route through HLS. */
  method: 'direct' | 'hls';
  contentType: 'video/mp4' | 'application/x-mpegURL';
  videoCodec: string | null;
  audioCodec: string | null;
  durationSeconds: number | null;
  reason: string;
}

function mapMediaStream(row: MediaStream): MediaStreamDTO {
  return {
    id: row.id,
    type: row.type as MediaStreamDTO['type'],
    index: row.index,
    codec: row.codec,
    profile: row.profile,
    level: row.level,
    width: row.width,
    height: row.height,
    bitrate: row.bitrate,
    framerate: row.framerate,
    hdr: row.hdr,
    channels: row.channels,
    language: row.language,
    title: row.title,
    isDefault: row.isDefault,
    isForced: row.isForced,
  };
}

function primaryVideoStream(streams: MediaStream[]): MediaStream | undefined {
  const videoStreams = streams.filter((stream) => stream.type === 'video');
  return videoStreams.find((stream) => stream.isDefault) ?? videoStreams.sort(
    (a, b) => ((b.width ?? 0) * (b.height ?? 0)) - ((a.width ?? 0) * (a.height ?? 0)),
  )[0];
}

function buildQualityOptions(
  directPlay: boolean,
  videoStream: MediaStream | undefined,
): PlaybackInfoDTO['qualities'] {
  const sourceWidth = videoStream?.width ?? null;
  const sourceHeight = videoStream?.height ?? null;
  const sourceBitrate = videoStream?.bitrate ?? null;
  const hlsTiers = sourceWidth && sourceHeight
    ? applicableTiers(sourceWidth, sourceHeight)
    : QUALITY_TIERS.filter((tier) => tier.height <= 1080);

  return [
    {
      label: 'Auto',
      width: null,
      height: null,
      bitrate: null,
      available: hlsTiers.length > 0,
      source: 'hls',
    },
    {
      label: 'Original',
      width: sourceWidth,
      height: sourceHeight,
      bitrate: sourceBitrate,
      available: directPlay,
      source: 'direct',
    },
    ...QUALITY_TIERS.map((tier) => ({
      label: tier.label as PlaybackInfoDTO['qualities'][number]['label'],
      width: tier.width,
      height: tier.height,
      bitrate: tier.videoBitrate * 1000,
      available: hlsTiers.some((available) => available.label === tier.label),
      source: 'hls' as const,
    })),
  ];
}

/**
 * Decide, Plex-style, whether a file can be direct-played by a browser or must
 * go through HLS. Direct play needs a browser-friendly container AND both a
 * decodable video and audio codec.
 *
 * When ffprobe can't identify a codec (returns null), we route through HLS
 * to be safe — the browser can't decode what we can't identify, and a silent
 * direct-play failure produces "video plays but no audio" which is worse than
 * a brief transcode start.
 */
export async function decidePlayback(
  filePath: string,
  mediaItemId?: string,
  episodeId?: string,
): Promise<PlaybackDecision> {
  // 1. Try DB-stored analysis first (sub-millisecond)
  if (mediaItemId || episodeId) {
    const mediaInfo = await prisma.mediaInfo.findUnique({
      where: mediaItemId ? { mediaItemId } : { episodeId: episodeId! },
    });

    if (mediaInfo) {
      const streams = await prisma.mediaStream.findMany({
        where: mediaItemId ? { mediaItemId } : { episodeId: episodeId! },
        orderBy: { index: 'asc' },
      });

      const videoStream = primaryVideoStream(streams);
      const audioStreams = streams.filter(s => s.type === 'audio');
      const audioStream = audioStreams.find(s => s.isDefault) ?? audioStreams[0];
      const ext = path.extname(filePath).toLowerCase();
      const containerOk = DIRECT_CONTAINERS.has(ext);
      const videoOk = videoStream?.codec != null && DIRECT_VIDEO.has(videoStream.codec);
      const audioOk = audioStream?.codec != null && DIRECT_AUDIO.has(audioStream.codec);

      return {
        directPlay: containerOk && videoOk && audioOk,
        videoCodec: videoStream?.codec ?? null,
        audioCodec: audioStream?.codec ?? null,
        durationSeconds: mediaInfo.durationSec,
      };
    }
  }

  // 2. Fall back to live ffprobe (existing behavior)
  const probe = await probeMedia(filePath);
  const ext = path.extname(filePath).toLowerCase();
  const containerOk = DIRECT_CONTAINERS.has(ext);
  const videoOk = probe.videoCodec != null && DIRECT_VIDEO.has(probe.videoCodec);
  const audioOk = probe.audioCodec != null && DIRECT_AUDIO.has(probe.audioCodec);
  return {
    directPlay: containerOk && videoOk && audioOk,
    videoCodec: probe.videoCodec,
    audioCodec: probe.audioCodec,
    durationSeconds: probe.durationSeconds,
  };
}

/**
 * Chromecast built-in receivers are stricter than desktop browsers. Prefer
 * direct play only for broadly supported MP4/H.264/AAC sources; everything else
 * goes through Flux's HLS remux/transcode path.
 */
export async function decideCastPlayback(
  filePath: string,
  mediaItemId: string,
  episodeId?: string,
): Promise<CastPlaybackDecision> {
  const [decision, settings] = await Promise.all([
    decidePlayback(filePath, mediaItemId, episodeId),
    getServerSettings(),
  ]);
  const ext = path.extname(filePath).toLowerCase();
  const containerOk = ext === '.mp4' || ext === '.m4v';
  const videoOk = decision.videoCodec === 'h264';
  const audioOk = decision.audioCodec === null || decision.audioCodec === 'aac';

  if (settings.directPlayEnabled && containerOk && videoOk && audioOk) {
    return {
      method: 'direct',
      contentType: 'video/mp4',
      videoCodec: decision.videoCodec,
      audioCodec: decision.audioCodec,
      durationSeconds: decision.durationSeconds,
      reason: 'MP4/H.264/AAC is supported by the default Cast receiver',
    };
  }

  if (!settings.transcodingEnabled && !(settings.directStreamEnabled && videoOk && audioOk)) {
    throw ApiError.badRequest('This media requires a playback method disabled in server settings', 'PLAYBACK_METHOD_DISABLED');
  }

  return {
    method: 'hls',
    contentType: 'application/x-mpegURL',
    videoCodec: decision.videoCodec,
    audioCodec: decision.audioCodec,
    durationSeconds: decision.durationSeconds,
    reason: `Cast receiver fallback: container=${ext || 'unknown'} video=${decision.videoCodec ?? 'unknown'} audio=${decision.audioCodec ?? 'none'}`,
  };
}

export async function getCastMediaMetadata(
  mediaItemId: string,
  episodeId?: string,
): Promise<{ title: string; subtitle: string | null; posterPath: string | null }> {
  if (episodeId) {
    const item = await prisma.mediaItem.findUnique({
      where: { id: mediaItemId },
      include: { episodes: { where: { id: episodeId }, take: 1 } },
    });
    if (!item) throw ApiError.notFound('Media item not found');
    const episode = item.episodes[0];
    if (!episode) throw ApiError.notFound('Episode not found');

    return {
      title: item.title,
      subtitle: `S${episode.season} E${episode.episode}${episode.title ? ` - ${episode.title}` : ''}`,
      posterPath: item.posterPath,
    };
  }

  const item = await prisma.mediaItem.findUnique({ where: { id: mediaItemId } });
  if (!item) throw ApiError.notFound('Media item not found');

  return {
    title: item.title,
    subtitle: null,
    posterPath: item.posterPath,
  };
}

export async function getPlaybackInfo(
  filePath: string,
  mediaItemId: string,
  episodeId?: string,
): Promise<PlaybackInfoDTO> {
  const [decision, settings] = await Promise.all([
    decidePlayback(filePath, mediaItemId, episodeId),
    getServerSettings(),
  ]);
  const where = episodeId ? { episodeId } : { mediaItemId };
  const streams = await prisma.mediaStream.findMany({
    where,
    orderBy: { index: 'asc' },
  });
  const videoStream = primaryVideoStream(streams);
  const segments = episodeId
    ? await prisma.mediaSegment.findMany({
        where: { episodeId },
        orderBy: { startMs: 'asc' },
      })
    : [];

  const directPlay = decision.directPlay && settings.directPlayEnabled;
  const canDirectStream = decision.videoCodec === 'h264'
    && (decision.audioCodec === null || decision.audioCodec === 'aac');
  const hlsAvailable = settings.transcodingEnabled || (settings.directStreamEnabled && canDirectStream);
  const qualities = buildQualityOptions(directPlay, videoStream).filter((quality) => {
    if (quality.source === 'direct') return true;
    if (!hlsAvailable) return false;
    if (!settings.transcodingEnabled) return quality.label === 'Auto';
    const maxBitrate = (settings.remoteBitrateLimitMbps ?? settings.localBitrateLimitMbps)?.valueOf();
    return maxBitrate == null || quality.bitrate == null || quality.bitrate <= maxBitrate * 1_000_000;
  });
  return {
    directPlay,
    hlsAvailable,
    videoCodec: decision.videoCodec,
    audioCodec: decision.audioCodec,
    durationSeconds: decision.durationSeconds,
    preferences: {
      autoplayEnabled: settings.autoplayEnabled,
      resumeBehavior: settings.resumeBehavior as PlaybackInfoDTO['preferences']['resumeBehavior'],
      skipIntroEnabled: settings.skipIntroEnabled,
      preferredAudioLanguage: settings.preferredAudioLanguage,
      preferredSubtitleLanguage: settings.preferredSubtitleLanguage,
      subtitlesMode: settings.subtitlesMode as PlaybackInfoDTO['preferences']['subtitlesMode'],
    },
    ...(segments.length > 0 ? { segments: segments.map(mapMediaSegmentToDTO) } : {}),
    streams: streams.map(mapMediaStream),
    qualities,
  };
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
  audioStreamIndex?: number,
  startTimeSeconds = 0,
  hardwareAcceleration = 'NONE',
): string[] {
  const audioCopyable =
    probe.audioCodec != null && COPYABLE_AUDIO.has(probe.audioCodec);
  const videoCopyable =
    probe.videoCodec != null && COPYABLE_VIDEO.has(probe.videoCodec);

  // CRITICAL: only stream-copy the video when the audio is ALSO copied (a pure
  // remux). If we copy H.264 but re-encode the audio, the copied video keeps the
  // source's original (often offset) timestamps while the fresh AAC is realigned
  // — the two tracks drift apart, the browser's MSE can no longer splice them,
  // and playback deterministically dies a couple of segments in (~10s). Whenever
  // we have to touch the audio we re-encode the video too so FFmpeg produces ONE
  // coherent timeline that MSE can append cleanly.
  const reencodeVideo = !videoCopyable || !audioCopyable;
  const encoderArgs = hardwareAcceleration === 'NVENC'
    ? ['-c:v', 'h264_nvenc', '-preset', 'p4', '-cq', '23']
    : hardwareAcceleration === 'QSV'
      ? ['-c:v', 'h264_qsv', '-preset', 'faster', '-global_quality', '23']
      : hardwareAcceleration === 'VIDEOTOOLBOX'
        ? ['-c:v', 'h264_videotoolbox', '-q:v', '65']
        : hardwareAcceleration === 'VAAPI'
          ? ['-vf', 'format=nv12,hwupload', '-c:v', 'h264_vaapi', '-qp', '23']
          : ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23', '-pix_fmt', 'yuv420p'];
  const videoArgs = reencodeVideo
    ? [
        ...encoderArgs,
        // Force a keyframe on every segment boundary so each HLS segment decodes
        // standalone (matches -hls_time below).
        '-force_key_frames', 'expr:gte(t,n_forced*4)',
      ]
    : ['-c:v', 'copy'];

  const hasAudio = probe.audioStreamIndex !== null;
  const audioArgs = !hasAudio
    ? []
    : audioCopyable
      ? ['-c:a', 'copy']
      : ['-c:a', 'aac', '-b:a', '160k', '-ac', '2', '-af', 'aresample=async=1:first_pts=0'];

  return [
    '-fflags', '+genpts', // synthesize sane PTS when the source lacks them
    ...(reencodeVideo && hardwareAcceleration === 'VAAPI' ? ['-vaapi_device', '/dev/dri/renderD128'] : []),
    ...(startTimeSeconds > 0 ? ['-ss', startTimeSeconds.toFixed(3)] : []),
    '-i', sourceFile,
    '-map', probe.videoStreamIndex !== null ? `0:${probe.videoStreamIndex}` : '0:v:0',
    ...(hasAudio
      ? ['-map', `0:${probe.audioStreamIndex ?? audioStreamIndex}?`]
      : []),
    '-sn', '-dn',
    ...videoArgs,
    ...audioArgs,
    // Normalize both tracks to start at t=0 so audio and video share a timeline
    // the browser's MSE can splice cleanly.
    '-avoid_negative_ts', 'make_zero',
    '-muxdelay', '0',
    '-muxpreload', '0',
    '-max_muxing_queue_size', '1024',
    '-f', 'hls',
    '-hls_time', '4',
    '-hls_list_size', '0',
    // EVENT = a growing-but-seekable-from-start playlist. Without this the
    // manifest reads as a live stream and players jump to the live edge
    // (→ "starts on a random part of the show").
    '-hls_playlist_type', 'event',
    // independent_segments: each segment decodes standalone.
    // temp_file: FFmpeg writes the playlist AND each segment to a .tmp name and
    // atomically renames on completion. Critical because we serve this session
    // live — without it, a manifest/segment reload can read a half-written file
    // and hls.js fatals with "This file could not be played".
    '-hls_flags', 'independent_segments+temp_file',
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

    const filePath = await resolveFilePath(episode.filePath);
    if (!filePath) throw ApiError.notFound('Episode media file not found on any drive');
    const size = (await fs.stat(filePath)).size;
    const mimeType = mimeTypeFromExt(path.extname(filePath));

    return { filePath, mimeType, size };
  }

  const mediaItem = await prisma.mediaItem.findUnique({
    where: { id: mediaItemId },
  });
  if (!mediaItem) throw ApiError.notFound('Media item not found');
  if (!mediaItem.filePath) throw ApiError.notFound('Media item has no file');

  const filePath = await resolveFilePath(mediaItem.filePath);
  if (!filePath) throw ApiError.notFound('Media file not found on any drive');
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
