/**
 * TMDb proxy service. The TMDb API key never leaves the backend — the frontend
 * only ever talks to /api/tmdb/*.
 *
 * Uses the TMDb v3 REST API (https://api.themoviedb.org/3) with the v3 api_key.
 * Verified response fields used below:
 *   - search/multi   → results[].media_type ('movie'|'tv'|'person'), id,
 *                      title|name, overview, poster_path, backdrop_path,
 *                      release_date|first_air_date
 *   - movie/{id}     → title, release_date, runtime, genres[].name,
 *                      credits.cast[].{name,character,profile_path},
 *                      videos.results[].{site,type,key}
 *   - tv/{id}        → name, first_air_date, episode_run_time[],
 *                      genres[].name, credits.cast[...], videos.results[...],
 *                      seasons[].{season_number,episode_count,name}
 *
 * A tiny in-memory TTL cache reduces duplicate upstream calls.
 */
import type {
  MediaType,
  TmdbSearchResult,
  TmdbDetail,
  TmdbCastMember,
  TmdbGenreDTO,
  TrendingWindow,
} from '@flux/shared';
import { prisma } from '../../lib/db.js';
import { config } from '../../config.js';
import { ApiError } from '../../lib/errors.js';

const TMDB_BASE = 'https://api.themoviedb.org/3';

// ─── TMDb wire types (partial — only fields we consume) ───────────────────────

interface TmdbGenre {
  id: number;
  name: string;
}
interface TmdbVideo {
  site: string;
  type: string;
  key: string;
  official?: boolean;
}
interface TmdbCastRaw {
  name: string;
  character?: string;
  profile_path: string | null;
}
interface TmdbSearchItemRaw {
  id: number;
  media_type?: string; // present on multi search
  title?: string; // movie
  name?: string; // tv
  overview?: string;
  poster_path?: string | null;
  backdrop_path?: string | null;
  release_date?: string; // movie
  first_air_date?: string; // tv
  vote_average?: number;
}
interface TmdbSearchResponseRaw {
  results?: TmdbSearchItemRaw[];
}
interface TmdbGenreListRaw {
  genres?: TmdbGenre[];
}
interface TmdbSeasonRaw {
  season_number: number;
  episode_count: number;
  name: string;
}
interface TmdbDetailRaw extends TmdbSearchItemRaw {
  genres?: TmdbGenre[];
  runtime?: number | null; // movie
  episode_run_time?: number[]; // tv
  seasons?: TmdbSeasonRaw[]; // tv
  credits?: { cast?: TmdbCastRaw[] };
  videos?: { results?: TmdbVideo[] };
}

// ─── Small in-memory TTL cache ────────────────────────────────────────────────

interface CacheEntry {
  expiresAt: number;
  value: unknown;
}
const cache = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 5 * 60 * 1000;
const CACHE_MAX = 500;

function cacheGet<T>(key: string): T | undefined {
  const entry = cache.get(key);
  if (!entry) return undefined;
  if (entry.expiresAt <= Date.now()) {
    cache.delete(key);
    return undefined;
  }
  return entry.value as T;
}
function cacheSet(key: string, value: unknown): void {
  if (cache.size >= CACHE_MAX) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  cache.set(key, { value, expiresAt: Date.now() + CACHE_TTL_MS });
}

// ─── Upstream fetch ───────────────────────────────────────────────────────────

async function tmdbFetch<T>(
  path: string,
  params: Record<string, string> = {},
): Promise<T> {
  const url = new URL(`${TMDB_BASE}${path}`);
  url.searchParams.set('api_key', config.TMDB_API_KEY);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);

  const cacheKey = url.pathname + '?' + url.searchParams.toString();
  const cached = cacheGet<T>(cacheKey);
  if (cached !== undefined) return cached;

  let res: Response;
  try {
    res = await fetch(url, { headers: { accept: 'application/json' } });
  } catch {
    throw new ApiError(502, 'TMDB_UNREACHABLE', 'Could not reach TMDb');
  }

  if (res.status === 404) {
    throw ApiError.notFound('TMDb resource not found', 'TMDB_NOT_FOUND');
  }
  if (!res.ok) {
    throw new ApiError(
      502,
      'TMDB_ERROR',
      `TMDb request failed with status ${res.status}`,
    );
  }

  const json = (await res.json()) as T;
  cacheSet(cacheKey, json);
  return json;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function yearFromDate(date?: string): number | null {
  if (!date) return null;
  const y = Number.parseInt(date.slice(0, 4), 10);
  return Number.isFinite(y) ? y : null;
}

/** Normalize a route/query media type token to the shared MediaType enum. */
export function normalizeMediaType(token: string): MediaType {
  return token === 'movie' ? 'MOVIE' : 'SHOW';
}

/** shared MediaType → TMDb path segment. */
function tmdbPathSegment(type: MediaType): 'movie' | 'tv' {
  return type === 'MOVIE' ? 'movie' : 'tv';
}

function mapSearchItem(
  raw: TmdbSearchItemRaw,
  type: MediaType,
): TmdbSearchResult {
  return {
    tmdbId: raw.id,
    mediaType: type,
    title: raw.title ?? raw.name ?? 'Untitled',
    year: yearFromDate(raw.release_date ?? raw.first_air_date),
    overview: raw.overview ?? '',
    posterPath: raw.poster_path ?? null,
    backdropPath: raw.backdrop_path ?? null,
    voteAverage:
      typeof raw.vote_average === 'number' && raw.vote_average > 0
        ? raw.vote_average
        : null,
    inLibrary: false,
  };
}

/**
 * Given search results, set inLibrary/mediaItemId by matching MediaItem on
 * (tmdbId, type). Done in a single query.
 */
async function annotateLibrary(
  results: TmdbSearchResult[],
): Promise<TmdbSearchResult[]> {
  if (results.length === 0) return results;
  const items = await prisma.mediaItem.findMany({
    where: {
      OR: results.map((r) => ({ tmdbId: r.tmdbId, type: r.mediaType })),
    },
    select: { id: true, tmdbId: true, type: true },
  });
  const byKey = new Map<string, string>();
  for (const it of items) byKey.set(`${it.type}:${it.tmdbId}`, it.id);

  return results.map((r) => {
    const localId = byKey.get(`${r.mediaType}:${r.tmdbId}`);
    return localId ? { ...r, inLibrary: true, mediaItemId: localId } : r;
  });
}

// ─── Public API ───────────────────────────────────────────────────────────────

export async function search(
  query: string,
  type: 'movie' | 'show' | 'tv' | 'all' | 'multi',
): Promise<TmdbSearchResult[]> {
  let mapped: TmdbSearchResult[];

  if (type === 'movie') {
    const data = await tmdbFetch<TmdbSearchResponseRaw>('/search/movie', {
      query,
    });
    mapped = (data.results ?? []).map((r) => mapSearchItem(r, 'MOVIE'));
  } else if (type === 'show' || type === 'tv') {
    const data = await tmdbFetch<TmdbSearchResponseRaw>('/search/tv', {
      query,
    });
    mapped = (data.results ?? []).map((r) => mapSearchItem(r, 'SHOW'));
  } else {
    const data = await tmdbFetch<TmdbSearchResponseRaw>('/search/multi', {
      query,
    });
    mapped = (data.results ?? [])
      .filter((r) => r.media_type === 'movie' || r.media_type === 'tv')
      .map((r) =>
        mapSearchItem(r, r.media_type === 'movie' ? 'MOVIE' : 'SHOW'),
      );
  }

  return annotateLibrary(mapped);
}

// ─── Discovery (trending / popular / genres / discover) ───────────────────────

/** Trending movies or TV for a time window (`day` | `week`). */
export async function getTrending(
  type: MediaType,
  window: TrendingWindow,
): Promise<TmdbSearchResult[]> {
  const segment = tmdbPathSegment(type);
  const data = await tmdbFetch<TmdbSearchResponseRaw>(
    `/trending/${segment}/${window}`,
  );
  const mapped = (data.results ?? []).map((r) => mapSearchItem(r, type));
  return annotateLibrary(mapped);
}

/** Popular movies or TV. */
export async function getPopular(
  type: MediaType,
  page = 1,
): Promise<TmdbSearchResult[]> {
  const segment = tmdbPathSegment(type);
  const data = await tmdbFetch<TmdbSearchResponseRaw>(`/${segment}/popular`, {
    page: String(page),
  });
  const mapped = (data.results ?? []).map((r) => mapSearchItem(r, type));
  return annotateLibrary(mapped);
}

/** The TMDb genre list for movies or TV. */
export async function getGenres(type: MediaType): Promise<TmdbGenreDTO[]> {
  const segment = tmdbPathSegment(type);
  const data = await tmdbFetch<TmdbGenreListRaw>(`/genre/${segment}/list`);
  return (data.genres ?? []).map((g) => ({ id: g.id, name: g.name }));
}

/** Discover movies or TV, optionally filtered by a single genre id. */
export async function discover(
  type: MediaType,
  opts: { genreId?: number; page?: number } = {},
): Promise<TmdbSearchResult[]> {
  const segment = tmdbPathSegment(type);
  const params: Record<string, string> = {
    sort_by: 'popularity.desc',
    include_adult: 'false',
    page: String(opts.page ?? 1),
  };
  if (opts.genreId !== undefined) params.with_genres = String(opts.genreId);
  const data = await tmdbFetch<TmdbSearchResponseRaw>(
    `/discover/${segment}`,
    params,
  );
  const mapped = (data.results ?? []).map((r) => mapSearchItem(r, type));
  return annotateLibrary(mapped);
}

function pickTrailerKey(videos?: TmdbVideo[]): string | null {
  if (!videos || videos.length === 0) return null;
  const youtube = videos.filter((v) => v.site === 'YouTube');
  const trailer =
    youtube.find((v) => v.type === 'Trailer' && v.official) ??
    youtube.find((v) => v.type === 'Trailer') ??
    youtube.find((v) => v.type === 'Teaser') ??
    youtube[0];
  return trailer?.key ?? null;
}

function mapCast(cast?: TmdbCastRaw[]): TmdbCastMember[] {
  if (!cast) return [];
  return cast.slice(0, 20).map((c) => ({
    name: c.name,
    character: c.character ?? '',
    profilePath: c.profile_path ?? null,
  }));
}

export async function getDetail(
  type: MediaType,
  tmdbId: number,
): Promise<TmdbDetail> {
  const segment = tmdbPathSegment(type);
  const raw = await tmdbFetch<TmdbDetailRaw>(`/${segment}/${tmdbId}`, {
    append_to_response: 'credits,videos',
  });

  const runtime =
    type === 'MOVIE'
      ? raw.runtime ?? null
      : raw.episode_run_time && raw.episode_run_time.length > 0
        ? (raw.episode_run_time[0] ?? null)
        : null;

  const base: TmdbSearchResult = mapSearchItem(raw, type);
  const [annotated] = await annotateLibrary([base]);

  const detail: TmdbDetail = {
    ...(annotated ?? base),
    genres: (raw.genres ?? []).map((g) => g.name),
    runtime,
    cast: mapCast(raw.credits?.cast),
    trailerYoutubeKey: pickTrailerKey(raw.videos?.results),
  };

  if (type === 'SHOW' && raw.seasons) {
    detail.seasons = raw.seasons
      .filter((s) => s.season_number > 0) // drop "Specials" (season 0)
      .map((s) => ({
        season: s.season_number,
        episodeCount: s.episode_count,
        name: s.name,
      }));
  }

  return detail;
}
