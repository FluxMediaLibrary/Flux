import assert from 'node:assert/strict';
import test from 'node:test';
import type { RokuPlaybackCapabilitiesDTO } from '@flux/shared';
import { selectRokuPlaybackMethod } from './roku-playback-policy.js';

const hd: RokuPlaybackCapabilitiesDTO = {
  model: 'test-roku',
  firmware: '14.0',
  supports4k: false,
  supportsHevc: false,
  supportsHdr10: false,
  maxBitrate: 20_000_000,
};

test('direct plays compatible MP4 H.264/AAC', () => {
  assert.equal(selectRokuPlaybackMethod({ filePath: 'movie.mp4', videoCodec: 'h264', audioCodec: 'aac', width: 1920, bitrate: 8_000_000, hdr: null }, hd), 'direct');
});

test('direct streams compatible codecs from an incompatible container', () => {
  assert.equal(selectRokuPlaybackMethod({ filePath: 'movie.mkv', videoCodec: 'h264', audioCodec: 'aac', width: 1920, bitrate: 8_000_000, hdr: null }, hd), 'direct_stream');
});

test('transcodes unsupported HEVC and oversized sources', () => {
  assert.equal(selectRokuPlaybackMethod({ filePath: 'movie.mp4', videoCodec: 'hevc', audioCodec: 'aac', width: 1920, bitrate: 8_000_000, hdr: null }, hd), 'transcode');
  assert.equal(selectRokuPlaybackMethod({ filePath: 'movie.mp4', videoCodec: 'h264', audioCodec: 'aac', width: 3840, bitrate: 12_000_000, hdr: null }, hd), 'transcode');
});

test('allows HEVC HDR10 direct play only on a capable Roku', () => {
  const capable = { ...hd, supports4k: true, supportsHevc: true, supportsHdr10: true };
  assert.equal(selectRokuPlaybackMethod({ filePath: 'movie.mp4', videoCodec: 'hevc', audioCodec: 'eac3', width: 3840, bitrate: 18_000_000, hdr: 'HDR10' }, capable), 'direct');
});
