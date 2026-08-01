const test = require('node:test');
const assert = require('node:assert/strict');
const {
  compareDesktopVersions,
  desktopReleaseFeedUrl,
  parseDesktopReleaseTag,
  selectLatestDesktopRelease,
} = require('../src/release-channel.cjs');

test('parses only the dedicated desktop tag format', () => {
  assert.equal(parseDesktopReleaseTag('pc-v1.2.3').version, '1.2.3');
  assert.equal(parseDesktopReleaseTag('pc-v2.0.0-beta.1').version, '2.0.0-beta.1');
  assert.equal(parseDesktopReleaseTag('v1.2.3'), null);
  assert.equal(parseDesktopReleaseTag('android-v1.2.3'), null);
});

test('selects the greatest published stable desktop release', () => {
  const releases = [
    { tag_name: 'android-v9.0.0' },
    { tag_name: 'pc-v1.9.0' },
    { tag_name: 'pc-v2.0.0', draft: true },
    { tag_name: 'pc-v1.10.0' },
    { tag_name: 'pc-v3.0.0-beta.1', prerelease: true },
  ];
  assert.equal(selectLatestDesktopRelease(releases).tag_name, 'pc-v1.10.0');
});

test('compares prerelease identifiers using semantic version precedence', () => {
  const beta2 = parseDesktopReleaseTag('pc-v2.0.0-beta.2');
  const beta10 = parseDesktopReleaseTag('pc-v2.0.0-beta.10');
  const stable = parseDesktopReleaseTag('pc-v2.0.0');
  assert.ok(compareDesktopVersions(beta10, beta2) > 0);
  assert.ok(compareDesktopVersions(stable, beta10) > 0);
});

test('builds a release-specific generic update feed URL', () => {
  assert.equal(
    desktopReleaseFeedUrl('pc-v1.2.3'),
    'https://github.com/FluxMediaLibrary/Flux/releases/download/pc-v1.2.3',
  );
  assert.throws(() => desktopReleaseFeedUrl('android-v1.2.3'));
});
