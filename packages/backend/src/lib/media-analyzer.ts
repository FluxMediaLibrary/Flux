/**
 * Media file analysis — runs ffprobe at import time and caches results in the DB
 * so per-playback decisions become sub-millisecond lookups.
 */
import { prisma } from './db.js';
import { spawn } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs/promises';

interface FfprobeStream {
  index: number;
  codec_type?: string;  // "video", "audio", "subtitle"
  codec_name?: string;
  profile?: string;
  level?: number;
  width?: number;
  height?: number;
  r_frame_rate?: string;  // "24000/1001"
  bit_rate?: string;
  channels?: number;
  tags?: {
    language?: string;
    title?: string;
    [key: string]: string | undefined;
  };
  disposition?: {
    default?: number;
    forced?: number;
  };
  color_transfer?: string;
  color_primaries?: string;
}

interface FfprobeOutput {
  format?: {
    format_name?: string;
    duration?: string;
    size?: string;
  };
  streams?: FfprobeStream[];
}

/** Run ffprobe on a file and return the parsed JSON. */
function runFfprobe(filePath: string): Promise<FfprobeOutput> {
  return new Promise((resolve, reject) => {
    const proc = spawn('ffprobe', [
      '-v', 'error',
      '-show_entries', 'stream=index,codec_type,codec_name,profile,level,width,height,r_frame_rate,bit_rate,channels,disposition,tags:format=format_name,duration,size',
      '-of', 'json',
      filePath,
    ]);
    let out = '';
    let err = '';
    proc.stdout.on('data', (c: Buffer) => { out += c.toString(); });
    proc.stderr.on('data', (c: Buffer) => { err += c.toString(); });
    proc.on('error', reject);
    proc.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`ffprobe exited ${code}: ${err.slice(0, 500)}`));
        return;
      }
      try { resolve(JSON.parse(out)); } catch (e) { reject(e); }
    });
  });
}

/** Parse "24000/1001" → 23.976 */
function parseFrameRate(rate?: string): number | null {
  if (!rate) return null;
  const parts = rate.split('/');
  if (parts.length !== 2) return parseFloat(rate) || null;
  const num = parseFloat(parts[0]!);
  const den = parseFloat(parts[1]!);
  return den !== 0 ? num / den : null;
}

/** Detect HDR from color metadata */
function detectHdr(stream: FfprobeStream): string | null {
  const transfer = stream.color_transfer;
  const primaries = stream.color_primaries;
  if (transfer === 'smpte2084' || transfer === 'arib-std-b67') {
    if (primaries === 'bt2020') return 'HDR10';
    return 'HDR'; // PQ transfer but not BT.2020
  }
  if (transfer === 'hlg' || transfer === 'arib-std-b67') return 'HLG';
  // Dolby Vision check: codec_name often includes 'dolby' or has dovi side data
  if (stream.codec_name?.toLowerCase().includes('dolby')) return 'DV';
  return null;
}

/**
 * Analyze a media file with ffprobe and store the results in the database.
 * If mediaItemId is provided, the analysis is for a movie.
 * If episodeId is provided, the analysis is for a TV episode.
 */
export async function analyzeAndStoreMedia(
  filePath: string,
  opts: { mediaItemId?: string; episodeId?: string },
): Promise<void> {
  const { mediaItemId, episodeId } = opts;
  if (!mediaItemId && !episodeId) {
    throw new Error('Must provide either mediaItemId or episodeId');
  }

  // Verify file exists first
  const stat = await fs.stat(filePath).catch(() => null);
  if (!stat) {
    console.warn(`[MediaAnalyzer] File not found: ${filePath}`);
    return;
  }

  let probe: FfprobeOutput;
  try {
    probe = await runFfprobe(filePath);
  } catch (err) {
    console.error(`[MediaAnalyzer] ffprobe failed for ${filePath}:`, err);
    // Create a minimal MediaInfo record so we don't keep retrying
    await prisma.mediaInfo.upsert({
      where: mediaItemId ? { mediaItemId } : { episodeId: episodeId! },
      create: {
        mediaItemId: mediaItemId ?? null,
        episodeId: episodeId ?? null,
        container: path.extname(filePath).toLowerCase().replace('.', '') || 'unknown',
        durationSec: 0,
        sizeBytes: BigInt(stat.size),
        hasVideo: false,
        hasAudio: false,
        hasSubtitles: false,
      },
      update: { sizeBytes: BigInt(stat.size) },
    });
    return;
  }

  const streams = probe.streams ?? [];
  const fmt = probe.format ?? {};

  const container = (fmt.format_name ?? '').split(',')[0] || path.extname(filePath).toLowerCase().replace('.', '');
  const durationSec = fmt.duration ? parseFloat(fmt.duration) : 0;
  const sizeBytes = BigInt(fmt.size ?? stat.size);

  const videoStreams = streams.filter(s => s.codec_type === 'video');
  const audioStreams = streams.filter(s => s.codec_type === 'audio');
  const subtitleStreams = streams.filter(s => s.codec_type === 'subtitle');

  // Delete old analysis for this entity
  if (mediaItemId) {
    await prisma.mediaStream.deleteMany({ where: { mediaItemId } });
    await prisma.mediaInfo.deleteMany({ where: { mediaItemId } });
  } else if (episodeId) {
    await prisma.mediaStream.deleteMany({ where: { episodeId } });
    await prisma.mediaInfo.deleteMany({ where: { episodeId } });
  }

  // Insert MediaInfo
  await prisma.mediaInfo.create({
    data: {
      mediaItemId: mediaItemId ?? null,
      episodeId: episodeId ?? null,
      container,
      durationSec,
      sizeBytes,
      hasVideo: videoStreams.length > 0,
      hasAudio: audioStreams.length > 0,
      hasSubtitles: subtitleStreams.length > 0,
    },
  });

  // Insert all streams
  const allStreams = streams.filter(s => s.codec_type === 'video' || s.codec_type === 'audio' || s.codec_type === 'subtitle');
  for (const s of allStreams) {
    await prisma.mediaStream.create({
      data: {
        mediaItemId: mediaItemId ?? null,
        episodeId: episodeId ?? null,
        type: s.codec_type!,
        index: s.index,
        codec: s.codec_name ?? null,
        profile: s.profile ?? null,
        level: s.level ?? null,
        width: s.width ?? null,
        height: s.height ?? null,
        bitrate: s.bit_rate ? parseInt(s.bit_rate, 10) : null,
        framerate: parseFrameRate(s.r_frame_rate),
        hdr: detectHdr(s),
        channels: s.channels ?? null,
        language: s.tags?.language ?? null,
        title: s.tags?.title ?? null,
        isDefault: (s.disposition?.default ?? 0) !== 0,
        isForced: (s.disposition?.forced ?? 0) !== 0,
      },
    });
  }

  console.log(
    `[MediaAnalyzer] Stored analysis for ${path.basename(filePath)}: ` +
    `${videoStreams.length}v/${audioStreams.length}a/${subtitleStreams.length}s, ${container}, ${Math.round(durationSec)}s`,
  );
}
