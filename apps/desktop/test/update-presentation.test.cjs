const test = require('node:test');
const assert = require('node:assert/strict');
const {
  buildUpdatePresentation,
  normalizeUpdateFeedUrl,
  releaseNotesText,
} = require('../src/update-presentation.cjs');

test('uses GitHub release metadata for the update changelog', () => {
  assert.deepEqual(
    buildUpdatePresentation(
      { version: '0.1.2', releaseName: 'Fallback', releaseNotes: 'Fallback notes' },
      {
        name: 'Flux Desktop v0.1.2',
        body: '## Fixed\n\n- Silent updates',
        html_url: 'https://github.com/FluxMediaLibrary/Flux/releases/tag/pc-v0.1.2',
      },
    ),
    {
      version: '0.1.2',
      title: 'Flux Desktop v0.1.2',
      notes: '## Fixed\n\n- Silent updates',
      releaseUrl: 'https://github.com/FluxMediaLibrary/Flux/releases/tag/pc-v0.1.2',
    },
  );
});

test('normalizes multi-version notes and provides an honest fallback', () => {
  assert.equal(
    releaseNotesText([{ version: '0.1.2', note: 'Dock-safe controls' }]),
    'Version 0.1.2\nDock-safe controls',
  );
  assert.match(releaseNotesText(null), /improvements and fixes/);
});

test('accepts HTTP smoke feeds but rejects executable update protocols', () => {
  assert.equal(normalizeUpdateFeedUrl('http://127.0.0.1:48766/feed/'), 'http://127.0.0.1:48766/feed');
  assert.throws(() => normalizeUpdateFeedUrl('file:///tmp/feed'), /HTTP or HTTPS/);
});
