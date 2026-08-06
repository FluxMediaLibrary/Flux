/**
 * Resolves the latest Flux desktop (`pc-v*`) and Android (`android-v*`)
 * releases from the GitHub releases API, normalized for the website's
 * downloads page. Results are cached briefly to stay well inside GitHub's
 * unauthenticated rate limit.
 */
import type { AppReleasesDTO } from '@flux/shared';
import { config } from '../../config.js';
import { ApiError } from '../../lib/errors.js';
import {
  buildAppRelease,
  selectLatestRelease,
  type GitHubRelease,
} from './release-tags.js';

const FETCH_TIMEOUT_MS = 10_000;

interface ReleasesCache {
  payload: AppReleasesDTO;
  expiresAt: number;
}

let cache: ReleasesCache | null = null;

async function fetchGitHubReleases(): Promise<GitHubRelease[]> {
  const owner = encodeURIComponent(config.GITHUB_RELEASES_OWNER);
  const repo = encodeURIComponent(config.GITHUB_RELEASES_REPO);
  const url = `https://api.github.com/repos/${owner}/${repo}/releases?per_page=100`;
  const headers: Record<string, string> = {
    Accept: 'application/vnd.github+json',
    'User-Agent': 'Flux-Server',
    'X-GitHub-Api-Version': '2022-11-28',
  };
  // Optional token only raises the rate limit; it is never returned or logged.
  if (config.GITHUB_TOKEN) headers.Authorization = `Bearer ${config.GITHUB_TOKEN}`;

  let response: Response;
  try {
    response = await fetch(url, { headers, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  } catch {
    throw ApiError.badGateway(
      'Could not reach the GitHub releases API',
      'RELEASES_UNAVAILABLE',
    );
  }
  if (!response.ok) {
    throw ApiError.badGateway(
      `GitHub releases API returned HTTP ${response.status}`,
      'RELEASES_UNAVAILABLE',
    );
  }

  let data: unknown;
  try {
    data = await response.json();
  } catch {
    throw ApiError.badGateway(
      'GitHub releases API returned an invalid response',
      'RELEASES_UNAVAILABLE',
    );
  }
  if (!Array.isArray(data)) {
    throw ApiError.badGateway(
      'GitHub releases API returned an unexpected payload',
      'RELEASES_UNAVAILABLE',
    );
  }
  return data as GitHubRelease[];
}

export async function getAppReleases(): Promise<AppReleasesDTO> {
  const now = Date.now();
  if (cache && cache.expiresAt > now) return cache.payload;

  try {
    const releases = await fetchGitHubReleases();
    const desktopRelease = selectLatestRelease(releases, 'pc');
    const androidRelease = selectLatestRelease(releases, 'android');
    const payload: AppReleasesDTO = {
      desktop: desktopRelease ? buildAppRelease(desktopRelease, 'desktop') : null,
      android: androidRelease ? buildAppRelease(androidRelease, 'android') : null,
      fetchedAt: new Date().toISOString(),
    };
    if (config.APP_RELEASES_CACHE_MS > 0) {
      cache = {
        payload,
        expiresAt: Date.now() + config.APP_RELEASES_CACHE_MS,
      };
    }
    return payload;
  } catch (error) {
    // Serve the last known snapshot when GitHub is unreachable.
    if (cache) return cache.payload;
    throw error;
  }
}
