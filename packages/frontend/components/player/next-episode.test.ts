import assert from 'node:assert/strict';
import test from 'node:test';
import {
  nextEpisodePromptStart,
  shouldShowNextEpisodePrompt,
} from './next-episode.js';

test('uses the credits marker when one exists', () => {
  assert.equal(nextEpisodePromptStart(1800, [
    { type: 'credits', startSeconds: 1500, endSeconds: 1780 },
  ]), 1500);
});

test('prefers a CREDITS segment over the legacy marker', () => {
  assert.equal(nextEpisodePromptStart(
    1800,
    [{ type: 'credits', startSeconds: 1500, endSeconds: 1780 }],
    [{ id: 's1', episodeId: 'e1', type: 'CREDITS', startMs: 1_560_000, endMs: 1_790_000, confidence: 1, source: 'AUTOMATIC' }],
  ), 1560);
});

test('falls back to the shared 92 percent completion point', () => {
  assert.equal(nextEpisodePromptStart(1000), 920);
});

test('does not show before the selected threshold', () => {
  assert.equal(shouldShowNextEpisodePrompt({
    currentTimeSeconds: 919,
    durationSeconds: 1000,
  }), false);
  assert.equal(shouldShowNextEpisodePrompt({
    currentTimeSeconds: 920,
    durationSeconds: 1000,
  }), true);
});

test('ignores invalid durations', () => {
  assert.equal(nextEpisodePromptStart(0), null);
  assert.equal(shouldShowNextEpisodePrompt({
    currentTimeSeconds: 100,
    durationSeconds: Number.NaN,
  }), false);
});
