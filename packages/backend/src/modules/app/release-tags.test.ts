import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  buildAppRelease,
  classifyAndroidAsset,
  classifyDesktopAsset,
  compareReleaseTags,
  parseReleaseTag,
  selectLatestRelease,
  type GitHubRelease,
} from './release-tags.js';

function release(overrides: Partial<GitHubRelease>): GitHubRelease {
  return {
    tag_name: 'pc-v0.1.0',
    draft: false,
    prerelease: false,
    published_at: '2026-08-02T02:20:24Z',
    html_url: 'https://github.com/FluxMediaLibrary/Flux/releases/tag/pc-v0.1.0',
    assets: [],
    ...overrides,
  };
}

function asset(name: string, size = 1024) {
  return {
    name,
    size,
    browser_download_url: `https://github.com/FluxMediaLibrary/Flux/releases/download/pc-v0.1.2/${encodeURIComponent(name)}`,
  };
}

describe('parseReleaseTag', () => {
  it('parses desktop and Android tags', () => {
    assert.equal(parseReleaseTag('pc-v0.1.2')?.version, '0.1.2');
    assert.equal(parseReleaseTag('pc-v0.1.2')?.kind, 'pc');
    assert.equal(parseReleaseTag('android-v1.1.7')?.version, '1.1.7');
    assert.equal(parseReleaseTag('android-v1.1.7')?.kind, 'android');
  });

  it('parses prerelease suffixes', () => {
    const parsed = parseReleaseTag('pc-v2.0.0-beta.1');
    assert.deepEqual(parsed?.prerelease, ['beta', '1']);
  });

  it('rejects unrelated tags', () => {
    assert.equal(parseReleaseTag('v1.0.0'), null);
    assert.equal(parseReleaseTag('desktop-v1.0.0'), null);
    assert.equal(parseReleaseTag('pc-v1'), null);
    assert.equal(parseReleaseTag(''), null);
  });
});

describe('compareReleaseTags', () => {
  it('orders by semver and prefers stable over prerelease', () => {
    const oneNine = parseReleaseTag('pc-v1.9.0')!;
    const oneTen = parseReleaseTag('pc-v1.10.0')!;
    const beta = parseReleaseTag('pc-v2.0.0-beta.1')!;
    const stable = parseReleaseTag('pc-v2.0.0')!;
    assert.ok(compareReleaseTags(oneTen, oneNine) > 0);
    assert.ok(compareReleaseTags(stable, beta) > 0);
    assert.ok(compareReleaseTags(beta, stable) < 0);
  });
});

describe('selectLatestRelease', () => {
  const releases = [
    release({ tag_name: 'android-v9.0.0' }),
    release({ tag_name: 'pc-v1.9.0' }),
    release({ tag_name: 'pc-v2.0.0', draft: true }),
    release({ tag_name: 'pc-v1.10.0' }),
    release({ tag_name: 'pc-v3.0.0-beta.1', prerelease: true }),
  ];

  it('picks the newest desktop release while skipping drafts/prereleases', () => {
    assert.equal(selectLatestRelease(releases, 'pc')?.tag_name, 'pc-v1.10.0');
  });

  it('picks the newest Android release independently', () => {
    assert.equal(selectLatestRelease(releases, 'android')?.tag_name, 'android-v9.0.0');
  });

  it('returns null when no matching release exists', () => {
    assert.equal(selectLatestRelease([release({ tag_name: 'pc-v1.0.0' })], 'android'), null);
  });
});

describe('classifyDesktopAsset', () => {
  it('classifies Windows installers', () => {
    assert.deepEqual(classifyDesktopAsset(asset('Flux-Setup-0.1.2.exe')), {
      name: 'Flux-Setup-0.1.2.exe',
      url: expectUrl('Flux-Setup-0.1.2.exe'),
      size: 1024,
      platform: 'windows',
      format: 'exe',
      arch: 'universal',
    });
    assert.equal(classifyDesktopAsset(asset('Flux-Setup-0.1.2-x64.exe'))?.arch, 'x64');
    assert.equal(classifyDesktopAsset(asset('Flux-Setup-0.1.2-arm64.exe'))?.arch, 'arm64');
  });

  it('classifies macOS and Linux artifacts', () => {
    assert.equal(classifyDesktopAsset(asset('Flux-0.1.2-mac-arm64.dmg'))?.platform, 'macos');
    assert.equal(classifyDesktopAsset(asset('Flux-0.1.2-mac-x64.zip'))?.format, 'zip');
    assert.deepEqual(
      {
        platform: classifyDesktopAsset(asset('Flux-0.1.2-linux-x86_64.AppImage'))?.platform,
        format: classifyDesktopAsset(asset('Flux-0.1.2-linux-x86_64.AppImage'))?.format,
        arch: classifyDesktopAsset(asset('Flux-0.1.2-linux-x86_64.AppImage'))?.arch,
      },
      { platform: 'linux', format: 'appimage', arch: 'x64' },
    );
    assert.equal(classifyDesktopAsset(asset('Flux-0.1.2-linux-aarch64.rpm'))?.arch, 'arm64');
    assert.equal(classifyDesktopAsset(asset('Flux-0.1.2-linux-amd64.deb'))?.arch, 'x64');
  });

  it('ignores update feeds and blockmaps', () => {
    assert.equal(classifyDesktopAsset(asset('latest.yml')), null);
    assert.equal(classifyDesktopAsset(asset('Flux-Setup-0.1.2.exe.blockmap')), null);
  });
});

describe('classifyAndroidAsset', () => {
  it('classifies the APK and ignores everything else', () => {
    assert.equal(classifyAndroidAsset(asset('Flux-Android-v1.1.7.apk'))?.platform, 'android');
    assert.equal(classifyAndroidAsset(asset('latest.json')), null);
  });
});

describe('buildAppRelease', () => {
  it('builds a normalized DTO from a desktop release', () => {
    const dto = buildAppRelease(
      release({
        tag_name: 'pc-v0.1.2',
        assets: [
          asset('Flux-Setup-0.1.2.exe'),
          asset('latest.yml'),
          asset('Flux-Setup-0.1.2.exe.blockmap'),
        ],
      }),
      'desktop',
    );
    assert.equal(dto.version, '0.1.2');
    assert.equal(dto.tag, 'pc-v0.1.2');
    assert.deepEqual(dto.assets.map((a) => a.name), ['Flux-Setup-0.1.2.exe']);
  });
});

function expectUrl(name: string): string {
  return `https://github.com/FluxMediaLibrary/Flux/releases/download/pc-v0.1.2/${encodeURIComponent(name)}`;
}
