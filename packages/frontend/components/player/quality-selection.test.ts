import assert from 'node:assert/strict';
import test from 'node:test';
import type { PlaybackInfoDTO } from '@flux/shared';
import {
  canKeepDirectPlayback,
  canSwitchQualityInPlace,
  requiresAdaptiveTranscode,
} from './quality-selection.js';

function playbackInfo(sourceBitrate: number): PlaybackInfoDTO {
  return {
    directPlay: true,
    hlsAvailable: true,
    videoCodec: 'h264',
    audioCodec: 'aac',
    durationSeconds: 7200,
    preferences: {
      autoplayEnabled: true,
      resumeBehavior: 'ASK',
      skipIntroEnabled: true,
      preferredAudioLanguage: null,
      preferredSubtitleLanguage: null,
      subtitlesMode: 'FOREIGN_ONLY',
    },
    streams: [],
    qualities: [
      {
        label: 'Auto',
        width: null,
        height: null,
        bitrate: null,
        available: true,
        source: 'hls',
      },
      {
        label: 'Original',
        width: 1920,
        height: 1080,
        bitrate: sourceBitrate,
        available: true,
        source: 'direct',
      },
      {
        label: '1080p',
        width: 1920,
        height: 1080,
        bitrate: 5_000_000,
        available: true,
        source: 'hls',
      },
      {
        label: '720p',
        width: 1280,
        height: 720,
        bitrate: 2_800_000,
        available: true,
        source: 'hls',
      },
    ],
  };
}

test('keeps the reported 1080p AVC source direct instead of replacing it', () => {
  const info = playbackInfo(2_249_000);

  assert.equal(canKeepDirectPlayback(info, '1080p', null), true);
  assert.equal(requiresAdaptiveTranscode(info, '1080p'), false);
});

test('requests adaptive transcoding for a lower selected resolution', () => {
  const info = playbackInfo(2_249_000);

  assert.equal(canKeepDirectPlayback(info, '720p', null), false);
  assert.equal(requiresAdaptiveTranscode(info, '720p'), true);
});

test('requests adaptive transcoding when same-resolution source bitrate exceeds the tier', () => {
  const info = playbackInfo(8_000_000);

  assert.equal(canKeepDirectPlayback(info, '1080p', null), false);
  assert.equal(requiresAdaptiveTranscode(info, '1080p'), true);
});

test('selected audio tracks continue through HLS', () => {
  const info = playbackInfo(2_249_000);

  assert.equal(canKeepDirectPlayback(info, '1080p', 2), false);
});

test('source-equivalent HLS quality does not restart a non-adaptive stream', () => {
  const info = playbackInfo(2_249_000);
  info.directPlay = false;

  assert.equal(canKeepDirectPlayback(info, '1080p', null), false);
  assert.equal(requiresAdaptiveTranscode(info, '1080p'), false);
});

test('source-equivalent direct quality changes in place without touching currentTime', () => {
  assert.equal(canSwitchQualityInPlace('direct', false, true, false), true);
});

test('adaptive HLS rendition changes in place without replacing the source', () => {
  assert.equal(canSwitchQualityInPlace('hls', true, false, true), true);
});

test('lower quality from a non-adaptive source starts one adaptive session', () => {
  assert.equal(canSwitchQualityInPlace('direct', false, false, true), false);
  assert.equal(canSwitchQualityInPlace('hls', false, false, true), false);
});
