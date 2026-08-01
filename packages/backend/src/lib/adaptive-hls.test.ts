import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import { buildAdaptiveHlsArgs } from './adaptive-hls.js';

test('forces compatible 1080p AVC/AAC sources through a real adaptive encode', () => {
  const outputDir = path.join('tmp', 'adaptive');
  const args = buildAdaptiveHlsArgs(
    'movie.mkv',
    outputDir,
    'h264',
    'aac',
    1920,
    1080,
    0,
    1,
    131,
  );

  assert.deepEqual(args.slice(0, 5), ['-fflags', '+genpts', '-ss', '131.000', '-i']);
  assert.ok(args.includes('-filter_complex'));
  assert.ok(args.includes('libx264'));
  assert.ok(args.includes('-var_stream_map'));
  assert.ok(args.includes('v:0,a:0 v:1,a:1'));
  assert.equal(
    args.some((arg, index) => arg.startsWith('-c:v') && args[index + 1] === 'copy'),
    false,
  );
  assert.equal(args.at(-1), path.join(outputDir, 'stream_%v', 'index.m3u8'));
});

test('normalizes H.264 MKV video and FLAC audio onto one zero-based HLS clock', () => {
  const args = buildAdaptiveHlsArgs(
    'episode.mkv',
    path.join('tmp', 'dual-flac'),
    'h264',
    'flac',
    1920,
    1080,
    0,
    1,
    0,
  );
  const filter = args[args.indexOf('-filter_complex') + 1] ?? '';

  assert.match(filter, /setpts=PTS-STARTPTS/);
  assert.ok(args.includes('libx264'));
  assert.ok(args.includes('aac'));
  assert.ok(args.includes('aresample=async=1:first_pts=0'));
  assert.equal(
    args.some((arg, index) => arg.startsWith('-c:a') && args[index + 1] === 'copy'),
    false,
  );
});

test('applies configured bitrate ceilings and hardware encoders', () => {
  const args = buildAdaptiveHlsArgs(
    'movie.mkv',
    path.join('tmp', 'nvenc-limited'),
    'hevc',
    'truehd',
    3840,
    2160,
    0,
    1,
    0,
    3000,
    'NVENC',
  );

  assert.ok(args.includes('h264_nvenc'));
  assert.ok(args.includes('2800k'));
  assert.equal(args.includes('5000k'), false);
});
