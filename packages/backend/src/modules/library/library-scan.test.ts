import assert from 'node:assert/strict';
import test from 'node:test';

process.env.DATABASE_URL ??= 'postgres://user:pass@localhost:5432/flux_test';
process.env.REDIS_URL ??= 'redis://127.0.0.1:1';
process.env.JWT_SECRET ??= 'test-secret-1234567890';
process.env.NODE_ENV = 'test';

const { pickConfidentMatch, seasonFromFolder, normalizeTitle } = await import('./library-scan-match.js');

test('matches on exact normalised title + year', () => {
  const results = [
    { tmdbId: 1, title: 'Heat', year: 1995 },
    { tmdbId: 2, title: 'Heat', year: 1986 },
    { tmdbId: 3, title: 'Heat Wave', year: 1995 },
  ];
  assert.equal(pickConfidentMatch(results, 'Heat', 1995), 1);
  assert.equal(pickConfidentMatch(results, 'heat', 1986), 2);
});

test('refuses ambiguous titles when no year is available', () => {
  const results = [
    { tmdbId: 1, title: 'Heat', year: 1995 },
    { tmdbId: 2, title: 'Heat', year: 1986 },
  ];
  assert.equal(pickConfidentMatch(results, 'Heat', null), null);
});

test('accepts a single exact match without a year and a lone result overall', () => {
  assert.equal(pickConfidentMatch([{ tmdbId: 9, title: 'The Bear', year: 2022 }, { tmdbId: 10, title: 'Bear Grylls', year: 2010 }], 'The Bear', null), 9);
  assert.equal(pickConfidentMatch([{ tmdbId: 11, title: 'Severance', year: 2022 }], 'Severence', null), 11);
});

test('tolerates a one-year drift only when it is unambiguous', () => {
  const results = [{ tmdbId: 1, title: 'Arrival', year: 2016 }];
  assert.equal(pickConfidentMatch(results, 'Arrival', 2017), 1);
  const twoClose = [{ tmdbId: 1, title: 'Arrival', year: 2016 }, { tmdbId: 2, title: 'Arrival', year: 2018 }];
  assert.equal(pickConfidentMatch(twoClose, 'Arrival', 2017), null);
});

test('normalises punctuation and years out of titles', () => {
  assert.equal(normalizeTitle('Spider-Man: No Way Home (2021)'), 'spider man no way home');
});

test('parses season folders', () => {
  assert.equal(seasonFromFolder('Season 01'), 1);
  assert.equal(seasonFromFolder('S3'), 3);
  assert.equal(seasonFromFolder('Specials'), 0);
  assert.equal(seasonFromFolder('Extras'), null);
});
