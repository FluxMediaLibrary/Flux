import assert from 'node:assert/strict';
import test from 'node:test';
import { preferHlsStartAtBeginning } from './hls-manifest.js';

test('marks a growing EVENT playlist to begin at its first segment', () => {
  const manifest = [
    '#EXTM3U',
    '#EXT-X-VERSION:6',
    '#EXT-X-PLAYLIST-TYPE:EVENT',
    '#EXTINF:4.000000,',
    'segment_00000.ts',
    '',
  ].join('\n');

  const result = preferHlsStartAtBeginning(manifest);

  assert.match(result, /#EXT-X-START:TIME-OFFSET=0,PRECISE=YES/);
  assert.ok(
    result.indexOf('#EXT-X-START:') < result.indexOf('#EXT-X-PLAYLIST-TYPE:EVENT'),
  );
});

test('adds the required protocol version when a playlist omits it', () => {
  const result = preferHlsStartAtBeginning('#EXTM3U\nsegment.ts\n');

  assert.match(result, /#EXT-X-VERSION:6/);
  assert.match(result, /#EXT-X-START:TIME-OFFSET=0,PRECISE=YES/);
});

test('raises an older playlist version for EXT-X-START compatibility', () => {
  const result = preferHlsStartAtBeginning('#EXTM3U\n#EXT-X-VERSION:3\nsegment.ts\n');

  assert.match(result, /#EXT-X-VERSION:6/);
  assert.doesNotMatch(result, /#EXT-X-VERSION:3/);
});

test('does not duplicate an existing start preference', () => {
  const manifest = [
    '#EXTM3U',
    '#EXT-X-VERSION:6',
    '#EXT-X-START:TIME-OFFSET=12',
    'segment.ts',
    '',
  ].join('\n');

  assert.equal(preferHlsStartAtBeginning(manifest), manifest);
});
