import assert from 'node:assert/strict';
import test from 'node:test';
import {
  getMediaTimeOrigin,
  toAbsolutePlaybackTime,
  toLocalPlaybackTime,
} from './playback-clock.js';

test('direct play keeps the browser media timeline unchanged', () => {
  const origin = getMediaTimeOrigin('direct', 531);

  assert.equal(origin, 0);
  assert.equal(toAbsolutePlaybackTime(131, 0, origin), 131);
  assert.equal(toLocalPlaybackTime(141, 0, origin), 141);
});

test('HLS removes a non-zero media origin from the displayed movie time', () => {
  const origin = getMediaTimeOrigin('hls', 531);

  // The previous calculation produced 131 + 531 = 662 (11:02).
  assert.equal(toAbsolutePlaybackTime(531, 131, origin), 131);
  assert.equal(toAbsolutePlaybackTime(541, 131, origin), 141);
});

test('HLS absolute seeks are translated back into the generated media timeline', () => {
  const origin = getMediaTimeOrigin('hls', 531);

  assert.equal(toLocalPlaybackTime(151, 131, origin), 551);
});

test('HLS streams that already start at zero retain their existing behavior', () => {
  const origin = getMediaTimeOrigin('hls', 0);

  assert.equal(origin, 0);
  assert.equal(toAbsolutePlaybackTime(10, 131, origin), 141);
  assert.equal(toLocalPlaybackTime(141, 131, origin), 10);
});
