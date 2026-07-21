import assert from 'node:assert/strict';
import test from 'node:test';
import { createRokuTrailer } from './roku-trailer.js';

test('Roku trailers expose a Flux page rather than a provider embed URL', () => {
  assert.deepEqual(createRokuTrailer('movie/42', 'youtube-key', 'https://flux.example/'), {
    provider: 'youtube',
    webUrl: 'https://flux.example/library/movie%2F42',
  });
});

test('Roku trailers are absent when TMDb has no usable key', () => {
  assert.equal(createRokuTrailer('movie-42', '   ', 'https://flux.example'), null);
  assert.equal(createRokuTrailer('movie-42', null, 'https://flux.example'), null);
});
