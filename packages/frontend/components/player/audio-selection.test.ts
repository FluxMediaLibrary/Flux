import assert from 'node:assert/strict';
import test from 'node:test';
import type { MediaStreamDTO, PlaybackInfoDTO } from '@flux/shared';
import { audioPreferenceFromStream, audioStreamLabel, selectedAudioStreamIndex } from './audio-selection.js';

function audio(overrides: Partial<MediaStreamDTO>): MediaStreamDTO {
  return {
    id: String(overrides.index ?? 0),
    type: 'audio',
    index: overrides.index ?? 0,
    codec: overrides.codec ?? null,
    profile: null,
    level: null,
    width: null,
    height: null,
    bitrate: null,
    framerate: null,
    hdr: null,
    channels: overrides.channels ?? null,
    language: overrides.language ?? null,
    title: overrides.title ?? null,
    isDefault: overrides.isDefault ?? false,
    isForced: false,
  };
}

function playbackInfo(streams: MediaStreamDTO[], selected: number | null): PlaybackInfoDTO {
  return {
    directPlay: true,
    hlsAvailable: true,
    videoCodec: 'h264',
    audioCodec: 'aac',
    durationSeconds: 100,
    selectedAudioStreamIndex: selected,
    preferences: {
      autoplayEnabled: true,
      resumeBehavior: 'ASK',
      skipIntroEnabled: true,
      preferredAudioLanguage: null,
      preferredAudioTitle: null,
      preferredSubtitleLanguage: null,
      subtitlesMode: 'FOREIGN_ONLY',
    },
    streams,
    qualities: [],
  };
}

test('formats readable audio labels', () => {
  assert.equal(audioStreamLabel(audio({ language: 'eng', channels: 6, codec: 'eac3' }), 'Track 1'), 'English — 5.1 — EAC3');
  assert.equal(audioStreamLabel(audio({ language: 'jpn', channels: 2, codec: 'aac' }), 'Track 1'), 'Japanese — Stereo — AAC');
  assert.equal(audioStreamLabel(audio({ language: 'eng', title: 'Commentary', channels: 2, codec: 'aac' }), 'Track 1'), 'English Commentary — Stereo — AAC');
});

test('does not force HLS for a single analyzed audio track', () => {
  assert.equal(selectedAudioStreamIndex(playbackInfo([audio({ index: 1, isDefault: true })], 1)), null);
});

test('uses backend-selected audio stream for multi-track media', () => {
  assert.equal(selectedAudioStreamIndex(playbackInfo([
    audio({ index: 1, isDefault: true }),
    audio({ index: 2, language: 'jpn' }),
  ], 2)), 2);
});

test('persists language and exact title/type from selected stream', () => {
  assert.deepEqual(audioPreferenceFromStream(audio({ language: 'eng', title: 'Commentary' })), {
    language: 'eng',
    title: 'Commentary',
  });
});
