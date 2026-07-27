import assert from 'node:assert/strict';
import test from 'node:test';
import {
  getMediaTimeOrigin,
  isUnexpectedPlaybackJump,
  toAbsolutePlaybackTime,
  toLocalPlaybackTime,
} from './playback-clock.js';

test('direct play keeps the browser media timeline unchanged', () => {
  const origin = getMediaTimeOrigin('direct', 531);

  assert.equal(origin, 0);
  assert.equal(toAbsolutePlaybackTime(131, 0, origin), 131);
  assert.equal(toLocalPlaybackTime(141, 0, origin), 141);
});

test('mobile HLS removes a non-zero MPEG-TS origin from displayed playback time', () => {
  const origin = getMediaTimeOrigin('hls', 531);

  assert.equal(toAbsolutePlaybackTime(531, 0, origin), 0);
  assert.equal(toAbsolutePlaybackTime(541, 0, origin), 10);
});

test('quality reloads preserve the absolute position with a non-zero HLS origin', () => {
  const origin = getMediaTimeOrigin('hls', 531);

  assert.equal(toAbsolutePlaybackTime(531, 131, origin), 131);
  assert.equal(toLocalPlaybackTime(141, 131, origin), 541);
});

test('desktop HLS streams that start at zero retain their existing behavior', () => {
  const origin = getMediaTimeOrigin('hls', 0);

  assert.equal(origin, 0);
  assert.equal(toAbsolutePlaybackTime(10, 131, origin), 141);
  assert.equal(toLocalPlaybackTime(141, 131, origin), 10);
});

test('detects a mobile quality switch that jumps to the EVENT live edge', () => {
  assert.equal(isUnexpectedPlaybackJump(131, 902), true);
  assert.equal(isUnexpectedPlaybackJump(131, 133), false);
});
