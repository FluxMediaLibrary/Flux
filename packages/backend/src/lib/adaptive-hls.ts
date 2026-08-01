/**
 * Adaptive HLS stream builder — generates multi-quality HLS master playlists
 * and manages multi-bitrate transcode sessions.
 *
 * Replaces the single-quality buildHlsFfmpegArgs() with a proper adaptive
 * bitrate pipeline that produces a master playlist + quality variants.
 */
import path from 'node:path';
import { spawn } from 'node:child_process';

export interface QualityTier {
  label: string;       // "4K", "1080p", etc.
  width: number;
  height: number;
  videoBitrate: number; // kbps
  audioBitrate: number; // kbps
  maxrate: number;     // kbps (VBV max)
  bufsize: number;     // kbps (VBV buffer)
}

/** Quality tiers in descending order. Media below a tier's resolution skips it. */
export const QUALITY_TIERS: QualityTier[] = [
  { label: '4K',    width: 3840, height: 2160, videoBitrate: 15000, audioBitrate: 192, maxrate: 16500, bufsize: 30000 },
  { label: '1440p', width: 2560, height: 1440, videoBitrate: 9000,  audioBitrate: 192, maxrate: 9900,  bufsize: 18000 },
  { label: '1080p', width: 1920, height: 1080, videoBitrate: 5000,  audioBitrate: 192, maxrate: 5500,  bufsize: 10000 },
  { label: '720p',  width: 1280, height: 720,  videoBitrate: 2800,  audioBitrate: 160, maxrate: 3080,  bufsize: 5600  },
  { label: '480p',  width: 854,  height: 480,  videoBitrate: 1400,  audioBitrate: 128, maxrate: 1540,  bufsize: 2800  },
  { label: '360p',  width: 640,  height: 360,  videoBitrate: 800,   audioBitrate: 96,  maxrate: 880,   bufsize: 1600  },
];

const MAX_SOFTWARE_TRANSCODE_HEIGHT = 1080;
const MAX_ADAPTIVE_VARIANTS = 2;

/**
 * Filter quality tiers to those not exceeding source resolution.
 * Always includes at least the lowest tier (360p).
 */
export function applicableTiers(sourceWidth: number, sourceHeight: number, maxVideoBitrateKbps?: number | null): QualityTier[] {
  const tiers = QUALITY_TIERS.filter(
    (tier) => tier.height <= sourceHeight
      && tier.height <= MAX_SOFTWARE_TRANSCODE_HEIGHT
      && (maxVideoBitrateKbps == null || tier.videoBitrate <= maxVideoBitrateKbps),
  ).slice(0, MAX_ADAPTIVE_VARIANTS);

  return tiers.length > 0 ? tiers : [QUALITY_TIERS[QUALITY_TIERS.length - 1]!];
}

/**
 * Build FFmpeg args for a multi-quality adaptive HLS transcode.
 *
 * Uses filter_complex to scale the source to each tier, then var_stream_map
 * to assign video+audio pairs and produce a master playlist.
 *
 * If source video is already H.264 and audio is AAC, we stream-copy rather
 * than re-encode (remux mode). Otherwise, transcode with libx264 + AAC.
 *
 * Output structure:
 *   sessionDir/
 *     master.m3u8
 *     stream_0/index.m3u8 + segment_*.ts    (highest quality)
 *     stream_1/index.m3u8 + segment_*.ts
 *     ...
 */
export function buildAdaptiveHlsArgs(
  sourceFile: string,
  sessionDir: string,
  sourceCodec: string | null,
  audioCodec: string | null,
  sourceWidth: number | null,
  sourceHeight: number | null,
  videoStreamIndex?: number,
  audioStreamIndex?: number,
  startTimeSeconds = 0,
  maxVideoBitrateKbps?: number | null,
  hardwareAcceleration = 'NONE',
): string[] {
  const tiers = applicableTiers(sourceWidth ?? 1920, sourceHeight ?? 1080, maxVideoBitrateKbps);
  const canCopy = sourceCodec === 'h264' && audioCodec === 'aac';
  const resetEncodedTimestamps = canCopy ? '' : ',setpts=PTS-STARTPTS';
  const videoMap = typeof videoStreamIndex === 'number' ? `0:${videoStreamIndex}` : '0:v:0';
  const hasAudio = typeof audioStreamIndex === 'number' && audioCodec !== null;
  const audioMap = hasAudio ? `0:${audioStreamIndex}` : null;
  const useVaapi = hardwareAcceleration === 'VAAPI';
  const hardwareFilter = useVaapi ? ',format=nv12,hwupload' : '';

  if (canCopy && tiers.length <= 1) {
    // Single-quality remux — simple case, no filter_complex needed.
    return [
      '-fflags', '+genpts',
      ...(startTimeSeconds > 0 ? ['-ss', startTimeSeconds.toFixed(3)] : []),
      '-i', sourceFile,
      '-map', videoMap,
      ...(audioMap ? ['-map', audioMap, '-c:a', 'copy'] : []),
      '-c:v', 'copy',
      '-sn', '-dn',
      '-avoid_negative_ts', 'make_zero',
      '-muxdelay', '0', '-muxpreload', '0',
      '-max_muxing_queue_size', '1024',
      '-f', 'hls',
      '-hls_time', '4',
      '-hls_list_size', '0',
      '-hls_playlist_type', 'event',
      '-hls_flags', 'independent_segments+temp_file',
      '-hls_segment_type', 'mpegts',
      '-start_number', '0',
      '-hls_segment_filename', path.join(sessionDir, 'segment_%05d.ts'),
      path.join(sessionDir, 'index.m3u8'),
    ];
  }

  // ── Multi-quality transcode ──────────────────────────────────────

  // Build filter_complex: split source → scale to each tier
  const filterParts: string[] = [];
  if (tiers.length === 1) {
    // Single tier — just copy, no split needed
    filterParts.push(`[${videoMap}]scale=w=${tiers[0]!.width}:h=${tiers[0]!.height}:force_original_aspect_ratio=decrease:force_divisible_by=2,setsar=1${resetEncodedTimestamps}${hardwareFilter}[v0out]`);
  } else {
    filterParts.push(`[${videoMap}]split=${tiers.length}${tiers.map((_, i) => `[v${i}]`).join('')}`);
    for (let i = 0; i < tiers.length; i++) {
      const t = tiers[i]!;
      filterParts.push(`[v${i}]scale=w=${t.width}:h=${t.height}:force_original_aspect_ratio=decrease:force_divisible_by=2,setsar=1${resetEncodedTimestamps}${hardwareFilter}[v${i}out]`);
    }
  }

  const args: string[] = [
    '-fflags', '+genpts',
    ...(useVaapi ? ['-vaapi_device', '/dev/dri/renderD128'] : []),
    ...(startTimeSeconds > 0 ? ['-ss', startTimeSeconds.toFixed(3)] : []),
    '-i', sourceFile,
    '-filter_complex', filterParts.join(';'),
  ];

  // Video maps + codecs
  for (let i = 0; i < tiers.length; i++) {
    const t = tiers[i]!;
    const encoderArgs = hardwareAcceleration === 'NVENC'
      ? ['-c:v:' + i, 'h264_nvenc', '-preset:v:' + i, 'p4', '-cq:v:' + i, '23']
      : hardwareAcceleration === 'QSV'
        ? ['-c:v:' + i, 'h264_qsv', '-preset:v:' + i, 'faster', '-global_quality:v:' + i, '23']
        : hardwareAcceleration === 'VIDEOTOOLBOX'
          ? ['-c:v:' + i, 'h264_videotoolbox', '-q:v:' + i, '65']
          : hardwareAcceleration === 'VAAPI'
            ? ['-c:v:' + i, 'h264_vaapi', '-qp:v:' + i, '23']
            : ['-c:v:' + i, 'libx264', '-preset:v:' + i, 'veryfast', '-crf', '23', '-pix_fmt', 'yuv420p'];
    args.push(
      '-map', `[v${i}out]`,
      ...encoderArgs,
      '-b:v:' + i, String(t.videoBitrate) + 'k',
      '-maxrate:v:' + i, String(t.maxrate) + 'k',
      '-bufsize:v:' + i, String(t.bufsize) + 'k',
      '-force_key_frames:v:' + i, 'expr:gte(t,n_forced*4)',
    );
  }

  // Audio maps (one per video tier — same audio track replicated)
  for (let i = 0; i < tiers.length; i++) {
    const t = tiers[i]!;
    if (!audioMap) {
      continue;
    }
    if (canCopy) {
      args.push(
        '-map', audioMap,
        '-c:a:' + i, 'copy',
      );
    } else {
      args.push(
        '-map', audioMap,
        '-c:a:' + i, 'aac',
        '-b:a:' + i, String(t.audioBitrate) + 'k',
        '-ac', '2',
        '-af:a:' + i, 'aresample=async=1:first_pts=0',
      );
    }
  }

  // var_stream_map: pair each video stream with its matching audio
  const pairings = tiers.map((_, i) => hasAudio ? `v:${i},a:${i}` : `v:${i}`).join(' ');

  args.push(
    '-sn', '-dn',
    '-avoid_negative_ts', 'make_zero',
    '-muxdelay', '0', '-muxpreload', '0',
    '-max_muxing_queue_size', '2048',
    '-f', 'hls',
    '-hls_time', '4',
    '-hls_list_size', '0',
    '-hls_playlist_type', 'event',
    '-hls_flags', 'independent_segments+temp_file',
    '-hls_segment_type', 'mpegts',
    '-start_number', '0',
    '-var_stream_map', pairings,
    '-master_pl_name', 'master.m3u8',
    '-hls_segment_filename', path.join(sessionDir, 'stream_%v', 'segment_%05d.ts'),
    path.join(sessionDir, 'stream_%v', 'index.m3u8'),
  );

  return args;
}

/**
 * Build the single-rendition HLS stream used by Cast receivers.
 *
 * A Chromecast only consumes one rendition at a time, while encoding two
 * software renditions can make the receiver catch the encoder's live edge and
 * stall indefinitely. Keep Cast to one bitrate-limited, at-most-1080p encode so
 * segment production stays comfortably ahead of playback.
 */
export function buildCastHlsArgs(
  sourceFile: string,
  sessionDir: string,
  sourceWidth: number | null,
  sourceHeight: number | null,
  videoStreamIndex?: number,
  audioStreamIndex?: number,
  startTimeSeconds = 0,
  maxVideoBitrateKbps?: number | null,
  hardwareAcceleration = 'NONE',
): string[] {
  const tier = applicableTiers(
    sourceWidth ?? 1920,
    sourceHeight ?? 1080,
    maxVideoBitrateKbps,
  )[0]!;
  const videoMap = typeof videoStreamIndex === 'number' ? `0:${videoStreamIndex}` : '0:v:0';
  const hasAudio = typeof audioStreamIndex === 'number';
  const useVaapi = hardwareAcceleration === 'VAAPI';
  const hardwareFilter = useVaapi ? ',format=nv12,hwupload' : '';
  const videoFilter = [
    `scale=w=${tier.width}:h=${tier.height}:force_original_aspect_ratio=decrease:force_divisible_by=2`,
    'setsar=1',
    'setpts=PTS-STARTPTS',
  ].join(',') + hardwareFilter;
  const encoderArgs = hardwareAcceleration === 'NVENC'
    ? ['-c:v', 'h264_nvenc', '-preset', 'p4', '-cq', '23']
    : hardwareAcceleration === 'QSV'
      ? ['-c:v', 'h264_qsv', '-preset', 'faster', '-global_quality', '23']
      : hardwareAcceleration === 'VIDEOTOOLBOX'
        ? ['-c:v', 'h264_videotoolbox', '-q:v', '65']
        : hardwareAcceleration === 'VAAPI'
          ? ['-c:v', 'h264_vaapi', '-qp', '23']
          : ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23', '-pix_fmt', 'yuv420p'];

  return [
    '-fflags', '+genpts',
    ...(useVaapi ? ['-vaapi_device', '/dev/dri/renderD128'] : []),
    ...(startTimeSeconds > 0 ? ['-ss', startTimeSeconds.toFixed(3)] : []),
    '-i', sourceFile,
    '-map', videoMap,
    ...(hasAudio ? ['-map', `0:${audioStreamIndex}`] : []),
    '-sn', '-dn',
    '-vf', videoFilter,
    ...encoderArgs,
    '-b:v', `${tier.videoBitrate}k`,
    '-maxrate', `${tier.maxrate}k`,
    '-bufsize', `${tier.bufsize}k`,
    '-force_key_frames', 'expr:gte(t,n_forced*4)',
    ...(hasAudio
      ? ['-c:a', 'aac', '-b:a', `${tier.audioBitrate}k`, '-ac', '2', '-af', 'aresample=async=1:first_pts=0']
      : []),
    '-avoid_negative_ts', 'make_zero',
    '-muxdelay', '0', '-muxpreload', '0',
    '-max_muxing_queue_size', '1024',
    '-f', 'hls',
    '-hls_time', '4',
    '-hls_list_size', '0',
    '-hls_playlist_type', 'event',
    '-hls_flags', 'independent_segments+temp_file',
    '-hls_segment_type', 'mpegts',
    '-start_number', '0',
    '-hls_segment_filename', path.join(sessionDir, 'segment_%05d.ts'),
    path.join(sessionDir, 'index.m3u8'),
  ];
}

/**
 * Spawn an adaptive HLS transcode. Writes the master playlist and per-quality
 * segment files to `sessionDir`. Returns a Promise that resolves when the
 * process starts (does not wait for completion).
 */
export function spawnAdaptiveTranscode(
  sourceFile: string,
  sessionDir: string,
  sourceCodec: string | null,
  audioCodec: string | null,
  sourceWidth: number | null,
  sourceHeight: number | null,
  videoStreamIndex?: number,
  audioStreamIndex?: number,
  startTimeSeconds = 0,
): { proc: ReturnType<typeof spawn>; args: string[] } {
  const args = buildAdaptiveHlsArgs(
    sourceFile, sessionDir, sourceCodec, audioCodec, sourceWidth, sourceHeight,
    videoStreamIndex, audioStreamIndex, startTimeSeconds,
  );
  console.log(
    `[AdaptiveTranscode] source=${path.basename(sourceFile)} ` +
    `video=${sourceCodec ?? '?'} audio=${audioCodec ?? '?'} ` +
    `${sourceWidth ?? '?'}x${sourceHeight ?? '?'}`,
  );

  const proc = spawn('ffmpeg', args, { stdio: ['ignore', 'ignore', 'pipe'] });
  let stderrTail = '';
  proc.stderr?.on('data', (c: Buffer) => {
    stderrTail = (stderrTail + c.toString()).slice(-4000);
  });
  proc.on('error', (err) => {
    console.error('[AdaptiveTranscode] FFmpeg spawn error:', err);
  });
  proc.on('exit', (code, signal) => {
    if (code !== 0 && code !== 255 && signal !== 'SIGKILL' && signal !== 'SIGTERM') {
      console.error(
        `[AdaptiveTranscode] FFmpeg exited code=${code} signal=${signal ?? ''}\n${stderrTail}`,
      );
    }
  });

  return { proc, args };
}
