const test = require('node:test');
const assert = require('node:assert/strict');
const { buildActivity, buildRpcActivity, normalizePresence } = require('../src/discord-presence.cjs');

const REPOSITORY = 'https://github.com/FluxMediaLibrary/Flux';

test('builds show presence with episode metadata, artwork, and playback timeline', () => {
  const now = Date.parse('2026-08-01T12:00:00Z');
  const activity = buildActivity({
    title: 'Family Guy',
    mediaType: 'show',
    season: 4,
    episode: 7,
    episodeTitle: 'Brian the Bachelor',
    posterUrl: 'https://image.tmdb.org/t/p/w500/poster.jpg',
    positionSeconds: 600,
    durationSeconds: 1200,
    paused: false,
  }, REPOSITORY, now);

  assert.equal(activity.type, 3);
  assert.equal(activity.details, 'Watching Family Guy');
  assert.equal(activity.state, 'S4 E7 - Brian the Bachelor');
  assert.equal(activity.largeImageKey, 'https://image.tmdb.org/t/p/w500/poster.jpg');
  assert.equal(activity.startTimestamp.toISOString(), '2026-08-01T11:50:00.000Z');
  assert.equal(activity.endTimestamp.toISOString(), '2026-08-01T12:10:00.000Z');
  assert.deepEqual(activity.buttons, [{ label: 'View Repository', url: REPOSITORY }]);
});

test('paused presence keeps the position without a moving Discord timeline', () => {
  const activity = buildActivity({
    title: 'Arrival',
    mediaType: 'movie',
    positionSeconds: 900,
    durationSeconds: 6960,
    paused: true,
  }, REPOSITORY);
  assert.equal(activity.state, 'Paused');
  assert.equal(activity.startTimestamp, undefined);
  assert.equal(activity.endTimestamp, undefined);
});

test('wire payload preserves Discord watching type and RPC field names', () => {
  const now = Date.parse('2026-08-01T12:00:00Z');
  const activity = buildRpcActivity({
    title: 'Family Guy',
    mediaType: 'show',
    season: 2,
    episode: 3,
    posterUrl: 'https://image.tmdb.org/t/p/w500/poster.jpg',
    positionSeconds: 60,
    durationSeconds: 1200,
  }, REPOSITORY, now);
  assert.equal(activity.type, 3);
  assert.equal(activity.assets.large_image, 'https://image.tmdb.org/t/p/w500/poster.jpg');
  assert.equal(activity.timestamps.start, now - 60_000);
  assert.equal(activity.timestamps.end, now + 1_140_000);
});

test('only permits HTTPS artwork and clamps invalid playback values', () => {
  const value = normalizePresence({
    title: 'Movie',
    posterUrl: 'http://private.example/poster.jpg',
    positionSeconds: -1,
    durationSeconds: Number.NaN,
  });
  assert.equal(value.posterUrl, '');
  assert.equal(value.positionSeconds, 0);
  assert.equal(value.durationSeconds, 0);
});
