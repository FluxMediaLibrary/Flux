/**
 * Pure parsing/classification helpers for Flux GitHub releases.
 *
 * Desktop releases are tagged `pc-vX.Y.Z` and Android releases
 * `android-vX.Y.Z`. These helpers intentionally mirror the desktop client's
 * release-channel logic so the website resolves the same "latest" versions.
 */
import type {
  AppReleaseAssetDTO,
  AppReleaseDTO,
  ReleaseArch,
} from '@flux/shared';

export interface GitHubAsset {
  name: string;
  size: number;
  browser_download_url: string;
}

export interface GitHubRelease {
  tag_name: string;
  draft: boolean;
  prerelease: boolean;
  published_at: string | null;
  html_url: string;
  assets: GitHubAsset[];
}

export interface ParsedReleaseTag {
  kind: 'pc' | 'android';
  version: string;
  major: number;
  minor: number;
  patch: number;
  prerelease: string[];
}

const TAG_PATTERN =
  /^(pc|android)-v(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/;
const WINDOWS_ASSET =
  /^Flux-Setup-(.+?)(?:-(x64|arm64))?\.exe$/;
const MAC_ASSET =
  /^Flux-(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)-mac-(x64|arm64)\.(dmg|zip)$/;
const LINUX_ASSET =
  /^Flux-(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)-linux-(x86_64|amd64|aarch64|arm64)\.(AppImage|deb|rpm)$/;
const ANDROID_ASSET =
  /^Flux-Android-v(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)\.apk$/;

const LINUX_ARCH: Record<string, ReleaseArch> = {
  x86_64: 'x64',
  amd64: 'x64',
  aarch64: 'arm64',
  arm64: 'arm64',
};

export function parseReleaseTag(tag: string): ParsedReleaseTag | null {
  const match = TAG_PATTERN.exec(String(tag || '').trim());
  if (!match) return null;
  return {
    kind: match[1] as 'pc' | 'android',
    version: match[2] + '.' + match[3] + '.' + match[4],
    major: Number(match[2]),
    minor: Number(match[3]),
    patch: Number(match[4]),
    prerelease: match[5] ? match[5].split('.') : [],
  };
}

function compareIdentifiers(left: string, right: string): number {
  const leftNumber = /^\d+$/.test(left) ? Number(left) : null;
  const rightNumber = /^\d+$/.test(right) ? Number(right) : null;
  if (leftNumber !== null && rightNumber !== null) return leftNumber - rightNumber;
  if (leftNumber !== null) return -1;
  if (rightNumber !== null) return 1;
  return left.localeCompare(right);
}

export function compareReleaseTags(
  left: ParsedReleaseTag,
  right: ParsedReleaseTag,
): number {
  for (const key of ['major', 'minor', 'patch'] as const) {
    if (left[key] !== right[key]) return left[key] - right[key];
  }
  if (left.prerelease.length === 0 || right.prerelease.length === 0) {
    return left.prerelease.length === right.prerelease.length
      ? 0
      : left.prerelease.length === 0
        ? 1
        : -1;
  }
  const length = Math.max(left.prerelease.length, right.prerelease.length);
  for (let index = 0; index < length; index += 1) {
    const leftIdentifier = left.prerelease[index];
    const rightIdentifier = right.prerelease[index];
    if (leftIdentifier === undefined) return -1;
    if (rightIdentifier === undefined) return 1;
    const comparison = compareIdentifiers(leftIdentifier, rightIdentifier);
    if (comparison !== 0) return comparison;
  }
  return 0;
}

/** Newest non-draft, non-prerelease release whose tag starts with `kind`. */
export function selectLatestRelease(
  releases: GitHubRelease[],
  kind: 'pc' | 'android',
): GitHubRelease | null {
  return (
    releases
      .filter((release) => !release?.draft && !release?.prerelease)
      .map((release) => ({ release, parsed: parseReleaseTag(release.tag_name) }))
      .filter(
        (entry): entry is { release: GitHubRelease; parsed: ParsedReleaseTag } =>
          entry.parsed !== null && entry.parsed.kind === kind,
      )
      .sort((left, right) => compareReleaseTags(right.parsed, left.parsed))[0]
        ?.release ?? null
  );
}

export function classifyDesktopAsset(
  asset: GitHubAsset,
): AppReleaseAssetDTO | null {
  const windows = WINDOWS_ASSET.exec(asset.name);
  if (windows) {
    return {
      name: asset.name,
      url: asset.browser_download_url,
      size: asset.size,
      platform: 'windows',
      format: 'exe',
      arch: windows[2] === 'arm64' ? 'arm64' : windows[2] === 'x64' ? 'x64' : 'universal',
    };
  }
  const mac = MAC_ASSET.exec(asset.name);
  if (mac) {
    return {
      name: asset.name,
      url: asset.browser_download_url,
      size: asset.size,
      platform: 'macos',
      format: mac[3] as 'dmg' | 'zip',
      arch: mac[2] as 'x64' | 'arm64',
    };
  }
  const linux = LINUX_ASSET.exec(asset.name);
  if (linux) {
    const arch = linux[2] ? LINUX_ARCH[linux[2]] : undefined;
    const format = linux[3] ? (linux[3].toLowerCase() as 'appimage' | 'deb' | 'rpm') : undefined;
    if (!arch || !format) return null;
    return {
      name: asset.name,
      url: asset.browser_download_url,
      size: asset.size,
      platform: 'linux',
      format,
      arch,
    };
  }
  return null;
}

export function classifyAndroidAsset(
  asset: GitHubAsset,
): AppReleaseAssetDTO | null {
  if (!ANDROID_ASSET.test(asset.name)) return null;
  return {
    name: asset.name,
    url: asset.browser_download_url,
    size: asset.size,
    platform: 'android',
    format: 'apk',
    arch: 'universal',
  };
}

export function buildAppRelease(
  release: GitHubRelease,
  kind: 'desktop' | 'android',
): AppReleaseDTO {
  const parsed = parseReleaseTag(release.tag_name);
  if (!parsed) throw new Error(`Invalid ${kind} release tag: ${release.tag_name}`);
  const classify =
    kind === 'desktop' ? classifyDesktopAsset : classifyAndroidAsset;
  const assets = release.assets
    .map(classify)
    .filter((asset): asset is AppReleaseAssetDTO => asset !== null)
    .sort((left, right) => left.name.localeCompare(right.name));
  return {
    platform: kind,
    version: parsed.version,
    tag: release.tag_name,
    publishedAt: release.published_at ?? '',
    releaseUrl: release.html_url,
    assets,
  };
}
