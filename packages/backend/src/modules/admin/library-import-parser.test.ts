import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { parseFile, normalizeImportTitle } from './library-import-parser.js';
import { isVideoFile } from '../../lib/filename.js';

const root = path.resolve('library');

test('movie release names produce clean titles and years', () => {
  for (const name of ['The.Matrix.1999.1080p.BluRay.x264-GROUP.mkv', 'The Matrix (1999).mp4']) {
    const candidate = parseFile(root, path.join(root, name), 'MOVIE');
    assert.equal(candidate?.title, 'The Matrix');
    assert.equal(candidate?.year, 1999);
  }
  assert.equal(parseFile(root, path.join(root, '1917 (2019).mkv'), 'MOVIE')?.title, '1917');
});

test('shows support season folders, flat episodes and nested libraries', () => {
  for (const name of [
    'Example (2020)/Season 2/03 - Pilot.mkv',
    'Example (2020)/S02/EP03.mkv',
    'Example (2020)/Example.S02E03.1080p.mkv',
    'Example.2020.S02E03.1080p.mkv',
    'Example (2020)/Example.2x03.mkv',
    'Drama/Example (2020)/Season 2/03.mkv',
  ]) {
    const candidate = parseFile(root, path.join(root, ...name.split('/')), 'SHOW');
    assert.equal(candidate?.title, 'Example', name);
    assert.equal(candidate?.year, 2020, name);
    assert.equal(candidate?.season, 2, name);
    assert.equal(candidate?.episode, 3, name);
  }
});

test('specials and a root pointing directly at a show are recognized', () => {
  const showRoot = path.join(root, 'Example (2020)');
  const candidate = parseFile(showRoot, path.join(showRoot, 'Specials', 'E01.mkv'), 'SHOW');
  assert.equal(candidate?.title, 'Example');
  assert.equal(candidate?.season, 0);
  assert.equal(candidate?.episode, 1);
});

test('season folders with show names use the parent show title', () => {
  for (const seasonFolder of ['s07 - Workaholics', 'Season 07 - Workaholics']) {
    for (const filename of ['s07e08 - Termidate.mkv', '08 - Termidate.mkv']) {
      const candidate = parseFile(root, path.join(root, 'Workaholics', seasonFolder, filename), 'SHOW');
      assert.equal(candidate?.title, 'Workaholics');
      assert.equal(candidate?.season, 7);
      assert.equal(candidate?.episode, 8);
    }
  }
});

test('ambiguous episode names are not assigned invented season numbers', () => {
  assert.equal(parseFile(root, path.join(root, 'Example', '03.mkv'), 'SHOW'), null);
});

test('title comparison preserves non-Latin names and handles accents', () => {
  assert.equal(normalizeImportTitle('Amélie'), normalizeImportTitle('Amelie'));
  assert.equal(normalizeImportTitle('Law & Order'), normalizeImportTitle('Law and Order'));
  assert.notEqual(normalizeImportTitle('怪物'), normalizeImportTitle('東京'));
});

test('import uses the same video formats as the rest of the library', () => {
  for (const name of ['movie.WMV', 'movie.mpeg', 'movie.mpg']) assert.equal(isVideoFile(name), true);
});
