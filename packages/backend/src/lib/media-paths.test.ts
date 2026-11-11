import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';

process.env.DATABASE_URL ??= 'postgresql://flux:flux@localhost:5432/flux';
process.env.REDIS_URL ??= 'redis://localhost:6379';
process.env.JWT_SECRET ??= '0123456789abcdef';
process.env.TMDB_API_KEY ??= 'test-key';

const { moviePlacement, episodePlacement } = await import('./media-paths.js');

const moviesDirectory = path.resolve('test-media', 'nas-volume-3');
const tvDirectory = path.resolve('test-media', 'nas-volume-4');

test('media placement appends separate type folders when enabled', async () => {
  const settings = { createMediaTypeSubfolders: true, moviesDirectory, tvDirectory };

  const movie = await moviePlacement('Movie 4', 2024, '.mkv', settings);
  assert.equal(movie.dir, path.join(moviesDirectory, 'movies', 'Movie 4 (2024)'));
  assert.equal(movie.file, path.join(movie.dir, 'Movie 4 (2024).mkv'));

  const episode = await episodePlacement('Example Show', 2, 4, '.mkv', settings);
  assert.equal(episode.showDir, path.join(tvDirectory, 'tv', 'Example Show'));
  assert.equal(episode.seasonDir, path.join(episode.showDir, 'Season 02'));
  assert.equal(episode.file, path.join(episode.seasonDir, 'Example Show - S02E04.mkv'));
});

test('media placement writes directly under separate directories when disabled', async () => {
  const settings = { createMediaTypeSubfolders: false, moviesDirectory, tvDirectory };

  const movie = await moviePlacement('Movie 4', null, '.mp4', settings);
  assert.equal(movie.dir, path.join(moviesDirectory, 'Movie 4'));

  const episode = await episodePlacement('Example Show', 1, 1, '.mp4', settings);
  assert.equal(episode.showDir, path.join(tvDirectory, 'Example Show'));
  assert.equal(episode.seasonDir, path.join(tvDirectory, 'Example Show', 'Season 01'));
});
