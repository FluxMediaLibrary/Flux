import test from 'node:test';
import assert from 'node:assert/strict';
import { selectImportMatch } from './library-import-match.js';

test('matches punctuation, articles, sequel numerals and versus variants', () => {
  for (const [file, title, year] of [
    ['Back to the Future - Part 2', 'Back to the Future Part II', 1989],
    ['Back to the Future - Part 3', 'Back to the Future Part III', 1990],
    ['Batman vs Superman - Dawn of Justice', 'Batman v Superman: Dawn of Justice', 2016],
    ['Maze Runner', 'The Maze Runner', 2014],
    ['Mr Nobody', 'Mr. Nobody', 2009],
  ] as const) {
    assert.equal(selectImportMatch(file, year, [{ tmdbId: 1, title, year }])?.tmdbId, 1, file);
  }
});

test('accepts a single character typo only with a matching year', () => {
  const result = { tmdbId: 1, title: "Malibu's Most Wanted", year: 2003 };
  assert.equal(selectImportMatch("Malubu's Most Wanted", 2003, [result])?.tmdbId, 1);
  assert.equal(selectImportMatch("Malubu's Most Wanted", null, [result]), null);
  assert.equal(selectImportMatch("Malubu's Most Wanted", 2004, [result]), null);
});

test('does not guess between ambiguous results or ignore a conflicting year', () => {
  const results = [1, 2].map((tmdbId) => ({ tmdbId, title: 'Arrival', year: 2016 }));
  assert.equal(selectImportMatch('Arrival', 2016, results), null);
  assert.equal(selectImportMatch('Arrival', 2017, [results[0]!]), null);
  assert.equal(selectImportMatch('Arrival', 2016, []), null);
  assert.equal(selectImportMatch('Arrival', 2016, [results[0]!, results[0]!])?.tmdbId, 1);
});

test('uses original titles and gives exact matches priority over typos', () => {
  assert.equal(selectImportMatch('Original Name', 2020, [{ tmdbId: 1, title: 'Localized Title', originalTitle: 'Original Name', year: 2020 }])?.tmdbId, 1);
  assert.equal(selectImportMatch('Example Movie', 2020, [
    { tmdbId: 1, title: 'Example Movie', year: 2020 },
    { tmdbId: 2, title: 'Example Movies', year: 2020 },
  ])?.tmdbId, 1);
});
