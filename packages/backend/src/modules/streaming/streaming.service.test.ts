import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import type { MediaStream } from '@prisma/client';

interface MediaProbe {
  videoCodec: string | null;
  audioCodec: string | null;
  videoStreamIndex: number | null;
  audioStreamIndex: number | null;
  width: number | null;
  height: number | null;
  durationSeconds: number | null;
}

let streaming: typeof import('./streaming.service.js');

test.before(async () => {
  process.env.NODE_ENV = 'test';
  process.env.DATABASE_URL ??= 'postgresql://flux:flux@localhost:5432/flux_test';
  process.env.REDIS_URL ??= 'redis://localhost:6379';
  process.env.JWT_SECRET ??= 'test-secret-at-least-16-chars';
  process.env.TMDB_API_KEY ??= 'test';
  streaming = await import('./streaming.service.js');
});

function audio(index: number, overrides: Partial<MediaStream> = {}): MediaStream {
  return {
    id: String(index),
    mediaItemId: 'movie-1',
    episodeId: null,
    type: 'audio',
    index,
    codec: overrides.codec ?? 'aac',
    profile: null,
    level: null,
    width: null,
    height: null,
    bitrate: null,
    framerate: null,
    hdr: null,
    channels: overrides.channels ?? 2,
    language: overrides.language ?? null,
    title: overrides.title ?? null,
    isDefault: overrides.isDefault ?? false,
    isForced: false,
  };
}

test('selects same audio language and title before language-only matches', () => {
  const streams = [
    audio(1, { language: 'eng', title: 'Main', isDefault: true }),
    audio(2, { language: 'eng', title: 'Commentary' }),
    audio(3, { language: 'jpn', title: 'Main' }),
  ];

  assert.equal(streaming.selectPreferredAudioStream(streams, { language: 'English', title: 'Commentary' })?.index, 2);
  assert.equal(streaming.selectPreferredAudioStream(streams, { language: 'English', title: 'Missing' })?.index, 1);
});

test('falls back to default audio track, then first available audio track', () => {
  assert.equal(streaming.selectPreferredAudioStream([
    audio(1, { language: 'eng' }),
    audio(2, { language: 'jpn', isDefault: true }),
  ], {})?.index, 2);

  assert.equal(streaming.selectPreferredAudioStream([
    audio(4, { language: 'eng' }),
    audio(5, { language: 'jpn' }),
  ], {})?.index, 4);
});

test('single-rendition HLS copies H.264 video while transcoding selected non-AAC audio', () => {
  const probe: MediaProbe = {
    videoCodec: 'h264',
    audioCodec: 'flac',
    videoStreamIndex: 0,
    audioStreamIndex: 2,
    width: 1920,
    height: 1080,
    durationSeconds: 120,
  };
  const args = streaming.buildHlsFfmpegArgs(probe, 'episode.mkv', path.join('tmp', 'audio-switch'), 2, 131);

  assert.deepEqual(args.slice(0, 5), ['-fflags', '+genpts', '-ss', '131.000', '-i']);
  assert.ok(args.includes('-c:v'));
  assert.equal(args[args.indexOf('-c:v') + 1], 'copy');
  assert.ok(args.includes('-c:a'));
  assert.equal(args[args.indexOf('-c:a') + 1], 'aac');
  assert.ok(args.includes('-map'));
  assert.ok(args.includes('0:2?'));
  assert.ok(args.includes('aresample=async=1:first_pts=0'));
});
