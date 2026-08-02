import assert from 'node:assert/strict';
import test from 'node:test';
import {
  isCastSessionActive,
  isCurrentCastMedia,
  shouldAutoplayLocalMedia,
} from './native-cast';

test('matches Cast state to the exact episode', () => {
  const state = {
    connected: true,
    mediaLoaded: true,
    mediaItemId: 'show-1',
    episodeId: 'episode-2',
  };

  assert.equal(isCurrentCastMedia(state, 'show-1', 'episode-2'), true);
  assert.equal(isCurrentCastMedia(state, 'show-1', 'episode-3'), false);
});

test('does not expose stale receiver time while another episode is loading', () => {
  const previousEpisode = {
    connected: true,
    mediaLoaded: true,
    mediaItemId: 'show-1',
    episodeId: 'episode-1',
  };

  assert.equal(isCurrentCastMedia(previousEpisode, 'show-1', 'episode-2'), false);
  assert.equal(isCastSessionActive(previousEpisode), true);
});

test('keeps local playback off while Cast state loads or a receiver is connected', () => {
  assert.equal(shouldAutoplayLocalMedia(true, false, false), false);
  assert.equal(shouldAutoplayLocalMedia(true, true, true), false);
  assert.equal(shouldAutoplayLocalMedia(true, true, false), true);
  assert.equal(isCastSessionActive({ connected: true }), true);
});

test('keeps legacy receiver sessions controllable until their next load', () => {
  assert.equal(isCurrentCastMedia({
    connected: true,
    mediaLoaded: true,
    mediaItemId: null,
    episodeId: null,
  }, 'show-1', 'episode-2'), true);
});
