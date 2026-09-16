/**
 * Roku client API — a TV-shaped projection of the existing library, request
 * and playback services. Nothing here owns data: it maps the same rows the
 * web app uses into the flat, artwork-first shapes the SceneGraph screens
 * render, and it records playback through the shared PlaybackSession table
 * so the admin dashboard sees Roku sessions like any other.
 */
import path from 'node:path';
import type { Episode, MediaItem, MediaStream, Prisma, WatchProgress } from '@prisma/client';
import type { MediaType } from '@flux/shared';
import { config } from '../../config.js';
import { prisma } from '../../lib/db.js';
import { ApiError } from '../../lib/errors.js';
import { signStreamToken } from '../../lib/jwt.js';
import { getHomepage, listLibrary, saveProgress } from '../library/library.service.js';
import { isProgressComplete } from '../library/progress-policy.js';
import { listMyRequests } from '../requests/requests.service.js';
import { getServerSettings } from '../settings/settings.service.js';
import { decidePlayback, getMediaFilePath } from '../streaming/streaming.service.js';
import { requestStageLabel } from '@flux/shared';

const IMAGE_BASE = 'https://image.tmdb.org/t/p/';
const PLAYBACK_TTL_SECONDS = 4 * 3600;

// ── Artwork + card mapping ──────────────────────────────────────────────────

function image(size: string, filePath: string | null | undefined): string | null {
  return filePath ? `${IMAGE_BASE}${size}${filePath}` : null;
}

function artworkFor(row: Pick<MediaItem, 'posterPath' | 'backdropPath'>): { poster: string | null; backdrop: string | null } {
  return { poster: image('w342', row.posterPath), backdrop: image('w1280', row.backdropPath) };
}

function metadataNumber(metadata: unknown, key: string): number | null {
  if (!metadata || typeof metadata !== 'object') return null;
  const value = (metadata as Record<string, unknown>)[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function metadataString(metadata: unknown, key: string): string | null {
  if (!metadata || typeof metadata !== 'object') return null;
  const value = (metadata as Record<string, unknown>)[key];
  return typeof value === 'string' && value.trim() ? value : null;
}

function metadataArray<T>(metadata: unknown, key: string): T[] {
  if (!metadata || typeof metadata !== 'object') return [];
  const value = (metadata as Record<string, unknown>)[key];
  return Array.isArray(value) ? (value as T[]) : [];
}

export interface RokuProgress {
  positionSeconds: number;
  durationSeconds: number | null;
  percent: number;
  completed: boolean;
}

function progressFor(row: Pick<WatchProgress, 'positionSeconds' | 'durationSeconds' | 'completed'> | null | undefined): RokuProgress | null {
  if (!row || row.positionSeconds <= 0) return null;
  const percent = row.durationSeconds && row.durationSeconds > 0 ? Math.min(1, row.positionSeconds / row.durationSeconds) : 0;
  return { positionSeconds: row.positionSeconds, durationSeconds: row.durationSeconds, percent, completed: row.completed };
}

export interface RokuCard {
  id: string;
  mediaType: 'movie' | 'show' | 'episode';
  title: string;
  subtitle: string | null;
  overview: string | null;
  year: number | null;
  runtimeMinutes: number | null;
  contentRating: string | null;
  rating: number | null;
  genres: string[];
  artwork: { poster: string | null; backdrop: string | null; thumbnail?: string | null };
  progress: RokuProgress | null;
  watched: boolean;
  unplayedCount: number | null;
  parentMediaId: string | null;
  available: boolean;
}

function mediaCard(row: MediaItem, extra: Partial<RokuCard> = {}): RokuCard {
  return {
    id: row.id,
    mediaType: row.type === 'MOVIE' ? 'movie' : 'show',
    title: row.title,
    subtitle: row.type === 'MOVIE' ? 'Movie' : 'Series',
    overview: row.overview,
    year: row.year,
    runtimeMinutes: metadataNumber(row.metadata, 'runtime'),
    contentRating: metadataString(row.metadata, 'certification') ?? metadataString(row.metadata, 'ageRating'),
    rating: metadataNumber(row.metadata, 'vote_average') ?? metadataNumber(row.metadata, 'voteAverage'),
    genres: row.genres,
    artwork: artworkFor(row),
    progress: null,
    watched: false,
    unplayedCount: null,
    parentMediaId: null,
    available: row.type === 'MOVIE' ? row.filePath != null : true,
    ...extra,
  };
}

function episodeLabel(episode: Pick<Episode, 'season' | 'episode' | 'title'>): string {
  return `S${episode.season} E${episode.episode}${episode.title ? ` · ${episode.title}` : ''}`;
}

function episodeCard(episode: Episode & { mediaItem: MediaItem }, progress: WatchProgress | null | undefined): RokuCard {
  const show = episode.mediaItem;
  return {
    id: episode.id,
    mediaType: 'episode',
    title: show.title,
    subtitle: episodeLabel(episode),
    overview: episode.overview ?? show.overview,
    year: show.year,
    runtimeMinutes: episode.runtime,
    contentRating: metadataString(show.metadata, 'certification'),
    rating: null,
    genres: show.genres,
    artwork: { ...artworkFor(show), thumbnail: image('w780', show.backdropPath) },
    progress: progressFor(progress),
    watched: progress?.completed ?? false,
    unplayedCount: null,
    parentMediaId: show.id,
    available: episode.filePath != null,
  };
}

// ── Home ────────────────────────────────────────────────────────────────────

export interface RokuHomeRow {
  id: string;
  title: string;
  items: RokuCard[];
  error?: { code: string; message: string };
}

export async function rokuHome(profileId: string): Promise<{ rows: RokuHomeRow[]; hero: RokuCard[] }> {
  const home = await getHomepage(profileId);
  const byId = new Map<string, MediaItem>();
  const ids = new Set<string>();
  for (const list of [home.recentlyAdded, home.newReleases, home.topRated, home.recommended, home.randomPicks, ...home.byGenre.map((g) => g.items)]) {
    for (const item of list) ids.add(item.id);
  }
  for (const item of home.continueWatching) ids.add(item.mediaItem.id);
  if (ids.size > 0) {
    const rows = await prisma.mediaItem.findMany({ where: { id: { in: [...ids] } } });
    for (const row of rows) byId.set(row.id, row);
  }
  const cards = (items: { id: string }[]): RokuCard[] => items.map((item) => byId.get(item.id)).filter((row): row is MediaItem => Boolean(row)).map((row) => mediaCard(row));

  const continueWatching: RokuCard[] = [];
  if (home.continueWatching.length > 0) {
    const episodeIds = home.continueWatching.map((entry) => entry.episode?.id).filter((id): id is string => Boolean(id));
    const episodes = episodeIds.length
      ? await prisma.episode.findMany({ where: { id: { in: episodeIds } }, include: { mediaItem: true } })
      : [];
    const episodeById = new Map(episodes.map((episode) => [episode.id, episode]));
    for (const entry of home.continueWatching) {
      const progressRow = {
        positionSeconds: entry.progress.positionSeconds,
        durationSeconds: entry.progress.durationSeconds,
        completed: entry.progress.completed,
      };
      if (entry.episode) {
        const episode = episodeById.get(entry.episode.id);
        if (episode) continueWatching.push(episodeCard(episode, progressRow as WatchProgress));
      } else {
        const row = byId.get(entry.mediaItem.id);
        if (row) continueWatching.push(mediaCard(row, { progress: progressFor(progressRow) }));
      }
    }
  }

  const rows: RokuHomeRow[] = [
    { id: 'continue-watching', title: 'Continue Watching', items: continueWatching },
    { id: 'recently-added', title: 'Recently Added', items: cards(home.recentlyAdded) },
    { id: 'new-releases', title: 'New Releases', items: cards(home.newReleases) },
    { id: 'top-rated', title: 'Top Rated', items: cards(home.topRated) },
    { id: 'recommended', title: 'Because You Watched', items: cards(home.recommended) },
    ...home.byGenre.map((group) => ({ id: `genre-${group.genre.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`, title: group.genre, items: cards(group.items) })),
  ];
  for (const error of home.errors ?? []) {
    const row = rows.find((entry) => entry.id === error.id);
    if (row) row.error = { code: error.code, message: error.message };
    else rows.push({ id: error.id, title: error.title, items: [], error: { code: error.code, message: error.message } });
  }
  const hero = [...continueWatching, ...cards(home.recentlyAdded)].filter((card) => card.artwork.backdrop).slice(0, 5);
  return { rows: rows.filter((row) => row.items.length > 0 || row.error), hero };
}

export async function rokuHomeRow(profileId: string, rowId: string): Promise<{ row: RokuHomeRow }> {
  const home = await rokuHome(profileId);
  const row = home.rows.find((entry) => entry.id === rowId);
  if (!row) throw ApiError.notFound('Row not found');
  return { row };
}

// ── Library ─────────────────────────────────────────────────────────────────

export interface LibraryQuery {
  page: number;
  limit: number;
  sort: 'title' | 'recent' | 'year';
  watched: 'all' | 'true' | 'false';
  genre: string | null;
}

export async function rokuLibrary(profileId: string, type: MediaType, query: LibraryQuery) {
  const all = await listLibrary(profileId, type);
  const availableGenres = [...new Set(all.flatMap((item) => item.genres))].sort((a, b) => a.localeCompare(b));
  let filtered = all;
  if (query.watched !== 'all') filtered = filtered.filter((item) => item.watched === (query.watched === 'true'));
  if (query.genre) filtered = filtered.filter((item) => item.genres.includes(query.genre!));
  if (query.sort === 'recent') filtered = [...filtered].sort((a, b) => b.addedAt.localeCompare(a.addedAt));
  else if (query.sort === 'year') filtered = [...filtered].sort((a, b) => (b.year ?? 0) - (a.year ?? 0) || a.title.localeCompare(b.title));
  const total = filtered.length;
  const totalPages = Math.max(1, Math.ceil(total / query.limit));
  const page = Math.min(Math.max(1, query.page), totalPages);
  const slice = filtered.slice((page - 1) * query.limit, page * query.limit);
  const rows = slice.length ? await prisma.mediaItem.findMany({ where: { id: { in: slice.map((item) => item.id) } } }) : [];
  const rowById = new Map(rows.map((row) => [row.id, row]));
  const items = slice.map((item) => {
    const row = rowById.get(item.id);
    return row ? mediaCard(row, { watched: item.watched, unplayedCount: item.unplayedCount, available: item.available }) : null;
  }).filter((card): card is RokuCard => Boolean(card));
  return { items, page, limit: query.limit, total, totalPages, hasNext: page < totalPages, hasPrevious: page > 1, availableGenres };
}

// ── Search (local library) ──────────────────────────────────────────────────

export async function rokuSearch(profileId: string, query: string) {
  const q = query.trim();
  const [items, episodes] = await Promise.all([
    prisma.mediaItem.findMany({ where: { title: { contains: q, mode: 'insensitive' } }, orderBy: { title: 'asc' }, take: 40 }),
    prisma.episode.findMany({
      where: { title: { contains: q, mode: 'insensitive' }, filePath: { not: null } },
      include: { mediaItem: true },
      orderBy: [{ season: 'asc' }, { episode: 'asc' }],
      take: 20,
    }),
  ]);
  const progress = episodes.length
    ? await prisma.watchProgress.findMany({ where: { profileId, episodeId: { in: episodes.map((episode) => episode.id) } } })
    : [];
  const progressByEpisode = new Map(progress.map((row) => [row.episodeId, row]));
  return {
    query: q,
    movies: items.filter((item) => item.type === 'MOVIE').map((row) => mediaCard(row)),
    shows: items.filter((item) => item.type === 'SHOW').map((row) => mediaCard(row)),
    episodes: episodes.map((episode) => episodeCard(episode, progressByEpisode.get(episode.id))),
  };
}

// ── Requests ────────────────────────────────────────────────────────────────

export async function rokuRequests(profileId: string) {
  const requests = await listMyRequests(profileId);
  return {
    requests: requests.map((request) => ({
      id: request.id,
      title: request.title,
      status: requestStageLabel(request),
      stage: request.stage,
      season: request.season,
      episode: request.episode,
      mediaType: request.mediaType === 'MOVIE' ? 'movie' : 'show',
      artwork: { poster: image('w342', request.posterPath ?? null), backdrop: image('w1280', request.backdropPath ?? null) },
    })),
  };
}

// ── Details ─────────────────────────────────────────────────────────────────

export async function rokuMediaDetail(id: string, profileId: string) {
  const item = await prisma.mediaItem.findUnique({
    where: { id },
    include: { episodes: { orderBy: [{ season: 'asc' }, { episode: 'asc' }], select: { id: true, season: true, filePath: true } } },
  });
  if (!item) throw ApiError.notFound('Media item not found');
  const episodeIds = item.episodes.map((episode) => episode.id);
  const progressRows = await prisma.watchProgress.findMany({
    where: { profileId, OR: [{ mediaItemId: id }, ...(episodeIds.length ? [{ episodeId: { in: episodeIds } }] : [])] },
  });
  const movieProgress = progressRows.find((row) => row.mediaItemId === id) ?? null;
  const completedEpisodes = new Set(progressRows.filter((row) => row.completed && row.episodeId).map((row) => row.episodeId));

  const seasons = item.type === 'SHOW'
    ? [...new Set(item.episodes.map((episode) => episode.season))].sort((a, b) => a - b).map((season) => {
        const available = item.episodes.filter((episode) => episode.season === season && episode.filePath);
        return {
          season,
          title: season === 0 ? 'Specials' : `Season ${season}`,
          availableCount: available.length,
          unplayedCount: available.filter((episode) => !completedEpisodes.has(episode.id)).length,
          artwork: artworkFor(item),
        };
      }).filter((season) => season.availableCount > 0)
    : [];

  const similarRows = item.genres.length
    ? await prisma.mediaItem.findMany({ where: { id: { not: id }, genres: { hasSome: item.genres.slice(0, 2) } }, orderBy: { addedAt: 'desc' }, take: 12 })
    : [];

  const cast = metadataArray<{ name?: string; character?: string }>(item.metadata, 'cast').slice(0, 8).map((member) => ({ name: member.name ?? '', role: member.character ?? null })).filter((member) => member.name);
  const crew = metadataArray<{ name?: string; job?: string }>(item.metadata, 'crew');
  const directors = crew.filter((member) => member.job === 'Director').map((member) => member.name ?? '').filter(Boolean);
  const trailerKey = metadataString(item.metadata, 'trailerYoutubeKey');

  return {
    ...mediaCard(item, {
      progress: item.type === 'MOVIE' ? progressFor(movieProgress) : null,
      available: item.type === 'MOVIE' ? item.filePath != null : seasons.length > 0,
    }),
    tagline: metadataString(item.metadata, 'tagline'),
    cast,
    directors,
    trailer: trailerKey ? { webUrl: `https://www.youtube.com/watch?v=${trailerKey}` } : null,
    seasons,
    similar: similarRows.map((row) => mediaCard(row)),
  };
}

export async function rokuSeasonEpisodes(showId: string, season: number, profileId: string) {
  const show = await prisma.mediaItem.findUnique({ where: { id: showId } });
  if (!show || show.type !== 'SHOW') throw ApiError.notFound('Show not found');
  const episodes = await prisma.episode.findMany({ where: { mediaItemId: showId, season }, orderBy: { episode: 'asc' } });
  const progress = episodes.length ? await prisma.watchProgress.findMany({ where: { profileId, episodeId: { in: episodes.map((episode) => episode.id) } } }) : [];
  const progressByEpisode = new Map(progress.map((row) => [row.episodeId, row]));
  return {
    show: { id: show.id, title: show.title },
    season,
    episodes: episodes.map((episode) => {
      const card = episodeCard({ ...episode, mediaItem: show }, progressByEpisode.get(episode.id));
      return {
        ...card,
        title: episode.title ?? `Episode ${episode.episode}`,
        subtitle: `Episode ${episode.episode}${episode.runtime ? ` · ${episode.runtime} min` : ''}`,
        seasonNumber: episode.season,
        episodeNumber: episode.episode,
      };
    }),
  };
}

export async function rokuEpisodeDetail(episodeId: string, profileId: string) {
  const episode = await prisma.episode.findUnique({ where: { id: episodeId }, include: { mediaItem: true } });
  if (!episode) throw ApiError.notFound('Episode not found');
  const progress = await prisma.watchProgress.findUnique({ where: { profileId_episodeId: { profileId, episodeId } } });
  const card = episodeCard(episode, progress);
  return {
    ...card,
    title: episode.title,
    showTitle: episode.mediaItem.title,
    season: episode.season,
    episode: episode.episode,
    airDate: null,
  };
}

// ── Playback ────────────────────────────────────────────────────────────────

export interface RokuCapabilities {
  model?: string;
  firmware?: string;
  supports4k?: boolean;
  supportsHevc?: boolean;
  supportsHdr10?: boolean;
  maxBitrate?: number;
}

export interface ResolvePlaybackInput {
  mediaItemId: string;
  episodeId?: string;
  positionSeconds?: number;
  audioStreamIndex?: number;
  subtitleStreamIndex?: number;
  subtitlesEnabled?: boolean;
  preferredAudioLanguage?: string;
  preferredSubtitleLanguage?: string;
  capabilities?: RokuCapabilities;
}

const ROKU_DIRECT_CONTAINERS = new Set(['.mp4', '.m4v', '.mov']);
const ROKU_DIRECT_AUDIO = new Set(['aac', 'ac3', 'eac3', 'mp3']);
const TEXT_SUBTITLE_CODECS = new Set(['subrip', 'srt', 'ass', 'ssa', 'webvtt', 'mov_text', 'text']);

function apiBase(settingsApiUrl: string | null, request: { protocol: string; headers: { host?: string } }): string {
  const inferred = request.headers.host ? `${request.protocol}://${request.headers.host}` : '';
  const base = (settingsApiUrl ?? config.PUBLIC_API_BASE_URL ?? inferred).replace(/\/$/, '');
  if (!base) throw ApiError.internal('Could not determine the public API URL for TV playback', 'PUBLIC_URL_MISSING');
  return base;
}

function languageMatches(track: { language: string | null }, wanted: string | undefined): boolean {
  if (!wanted || !track.language) return false;
  const a = track.language.toLowerCase();
  const b = wanted.toLowerCase();
  return a === b || a.startsWith(b) || b.startsWith(a);
}

interface PlaybackContext {
  accountId: string;
  role: 'ADMIN' | 'MEMBER';
  profileId: string;
  deviceSessionId: string;
}

function buildStreamUrl(base: string, token: string, method: 'direct' | 'hls', mediaItemId: string, episodeId: string | undefined, startTime: number, audioStreamIndex: number | undefined): string {
  const params = new URLSearchParams({ token });
  if (episodeId) params.set('episodeId', episodeId);
  if (method === 'hls') {
    if (startTime > 0) params.set('startTime', startTime.toFixed(3));
    if (audioStreamIndex !== undefined) params.set('audioStream', String(audioStreamIndex));
  }
  const streamPath = method === 'direct'
    ? `/api/stream/${encodeURIComponent(mediaItemId)}`
    : `/api/stream/${encodeURIComponent(mediaItemId)}/hls/index.m3u8`;
  return `${base}${streamPath}?${params.toString()}`;
}

export async function resolveRokuPlayback(
  context: PlaybackContext,
  input: ResolvePlaybackInput,
  request: { protocol: string; headers: { host?: string } },
) {
  const { filePath } = await getMediaFilePath(input.mediaItemId, input.episodeId);
  const [decision, settings, streams, item, episode] = await Promise.all([
    decidePlayback(filePath, input.mediaItemId, input.episodeId),
    getServerSettings(),
    prisma.mediaStream.findMany({ where: input.episodeId ? { episodeId: input.episodeId } : { mediaItemId: input.mediaItemId }, orderBy: { index: 'asc' } }),
    prisma.mediaItem.findUnique({ where: { id: input.mediaItemId } }),
    input.episodeId ? prisma.episode.findUnique({ where: { id: input.episodeId } }) : Promise.resolve(null),
  ]);
  if (!item) throw ApiError.notFound('Media item not found');

  const capabilities = input.capabilities ?? {};
  const ext = path.extname(filePath).toLowerCase();
  const audioStreams = streams.filter((stream) => stream.type === 'audio');
  const subtitleStreams = streams.filter((stream) => stream.type === 'subtitle');

  // Audio selection: explicit index → preferred language → default → first.
  const chosenAudio: MediaStream | undefined =
    (input.audioStreamIndex !== undefined ? audioStreams.find((stream) => stream.index === input.audioStreamIndex) : undefined)
    ?? audioStreams.find((stream) => languageMatches(stream, input.preferredAudioLanguage ?? settings.preferredAudioLanguage ?? undefined))
    ?? audioStreams.find((stream) => stream.isDefault)
    ?? audioStreams[0];
  const audioCodec = chosenAudio?.codec ?? decision.audioCodec;

  const videoOk = decision.videoCodec === 'h264' || (decision.videoCodec === 'hevc' && capabilities.supportsHevc === true);
  const audioOk = audioCodec === null || ROKU_DIRECT_AUDIO.has(audioCodec);
  const nonDefaultAudio = chosenAudio !== undefined && audioStreams.length > 1 && !(chosenAudio.isDefault || chosenAudio === audioStreams[0]);
  const canDirect = settings.directPlayEnabled && ROKU_DIRECT_CONTAINERS.has(ext) && videoOk && audioOk && !nonDefaultAudio;
  if (!canDirect && !settings.transcodingEnabled && !settings.directStreamEnabled) {
    throw ApiError.badRequest('This title needs a playback method that is disabled in server settings.', 'PLAYBACK_METHOD_DISABLED');
  }
  const method: 'direct' | 'hls' = canDirect ? 'direct' : 'hls';
  const contentType = method === 'direct' ? 'video/mp4' : 'application/x-mpegURL';

  // Resume position: explicit → stored progress (unless completed).
  let positionSeconds = input.positionSeconds ?? 0;
  if (input.positionSeconds === undefined) {
    const progress = input.episodeId
      ? await prisma.watchProgress.findUnique({ where: { profileId_episodeId: { profileId: context.profileId, episodeId: input.episodeId } } })
      : await prisma.watchProgress.findUnique({ where: { profileId_mediaItemId: { profileId: context.profileId, mediaItemId: input.mediaItemId } } });
    if (progress && !progress.completed && settings.resumeBehavior !== 'RESTART') positionSeconds = progress.positionSeconds;
  }

  const expiresAt = new Date(Date.now() + PLAYBACK_TTL_SECONDS * 1000);
  const token = signStreamToken(
    { sub: context.accountId, role: context.role, activeProfileId: context.profileId, deviceSessionId: context.deviceSessionId },
    `${PLAYBACK_TTL_SECONDS}s`,
  );
  const base = apiBase(settings.apiUrl, request);
  const url = buildStreamUrl(base, token, method, input.mediaItemId, input.episodeId, positionSeconds, method === 'hls' ? chosenAudio?.index : undefined);

  const subtitlesWanted = input.subtitlesEnabled ?? settings.subtitlesMode !== 'OFF';
  const preferredSubtitle = input.preferredSubtitleLanguage ?? settings.preferredSubtitleLanguage ?? undefined;
  const chosenSubtitle = subtitlesWanted
    ? (input.subtitleStreamIndex !== undefined ? subtitleStreams.find((stream) => stream.index === input.subtitleStreamIndex) : undefined)
      ?? (input.subtitleStreamIndex === undefined && settings.subtitlesMode === 'ALWAYS' ? subtitleStreams.find((stream) => languageMatches(stream, preferredSubtitle)) : undefined)
    : undefined;

  const session = await prisma.playbackSession.create({
    data: {
      accountId: context.accountId,
      profileId: context.profileId,
      deviceSessionId: context.deviceSessionId,
      mediaItemId: input.mediaItemId,
      episodeId: input.episodeId ?? null,
      method,
      contentType,
      audioStreamIndex: chosenAudio?.index ?? null,
      subtitleStreamIndex: chosenSubtitle?.index ?? null,
      positionSeconds,
      durationSeconds: decision.durationSeconds,
      expiresAt,
    },
  });

  const markers = await prisma.playbackMarker.findMany({ where: input.episodeId ? { episodeId: input.episodeId } : { mediaItemId: input.mediaItemId } });
  const segments = input.episodeId ? await prisma.mediaSegment.findMany({ where: { episodeId: input.episodeId } }) : [];
  const markerList = [
    ...markers.map((marker) => ({ type: marker.type, startSeconds: marker.startSeconds, endSeconds: marker.endSeconds })),
    ...segments.map((segment) => ({ type: segment.type.toLowerCase(), startSeconds: segment.startMs / 1000, endSeconds: segment.endMs / 1000 })),
  ];

  const next = episode ? await nextEpisodeFor(episode) : null;

  return {
    sessionId: session.id,
    url,
    contentType,
    method,
    mediaItemId: input.mediaItemId,
    episodeId: input.episodeId ?? null,
    title: item.title,
    subtitle: episode ? episodeLabel(episode) : null,
    artworkUrl: image('w780', item.backdropPath) ?? image('w342', item.posterPath),
    positionSeconds,
    durationSeconds: decision.durationSeconds,
    expiresAt: expiresAt.toISOString(),
    reason: method === 'direct' ? 'Container and codecs are supported natively' : `Streaming via HLS: container=${ext || 'unknown'} video=${decision.videoCodec ?? 'unknown'} audio=${audioCodec ?? 'none'}`,
    audioTracks: audioStreams.map((stream) => ({ index: stream.index, language: stream.language, title: stream.title, channels: stream.channels, codec: stream.codec, selected: chosenAudio?.index === stream.index })),
    subtitleTracks: subtitleStreams.map((stream) => ({
      index: stream.index,
      language: stream.language,
      title: stream.title,
      codec: stream.codec,
      selected: chosenSubtitle?.index === stream.index,
      url: stream.codec && TEXT_SUBTITLE_CODECS.has(stream.codec)
        ? `${base}/api/stream/${encodeURIComponent(input.mediaItemId)}/subtitles/${stream.index}.vtt?${new URLSearchParams({ token, ...(input.episodeId ? { episodeId: input.episodeId } : {}) }).toString()}`
        : null,
    })),
    markers: markerList,
    next,
  };
}

async function nextEpisodeFor(episode: Episode) {
  const next = await prisma.episode.findFirst({
    where: {
      mediaItemId: episode.mediaItemId,
      filePath: { not: null },
      OR: [
        { season: episode.season, episode: { gt: episode.episode } },
        { season: { gt: episode.season } },
      ],
    },
    orderBy: [{ season: 'asc' }, { episode: 'asc' }],
    include: { mediaItem: true },
  });
  if (!next) return null;
  return {
    mediaItemId: next.mediaItemId,
    episodeId: next.id,
    title: next.mediaItem.title,
    subtitle: episodeLabel(next),
    artworkUrl: image('w780', next.mediaItem.backdropPath),
  };
}

async function ownedSession(sessionId: string, context: PlaybackContext) {
  const session = await prisma.playbackSession.findUnique({ where: { id: sessionId } });
  if (!session || session.accountId !== context.accountId || session.profileId !== context.profileId) {
    throw ApiError.notFound('Playback session not found', 'PLAYBACK_SESSION_NOT_FOUND');
  }
  return session;
}

export async function recordRokuProgress(context: PlaybackContext, input: { sessionId: string; positionSeconds: number; durationSeconds?: number | null; state?: string }) {
  const session = await ownedSession(input.sessionId, context);
  const duration = input.durationSeconds ?? session.durationSeconds ?? undefined;
  const state = (input.state ?? 'playing').toUpperCase();
  await Promise.all([
    prisma.playbackSession.update({
      where: { id: session.id },
      data: {
        positionSeconds: input.positionSeconds,
        ...(duration ? { durationSeconds: duration } : {}),
        state: state === 'PAUSED' ? 'PAUSED' : state === 'BUFFERING' ? 'BUFFERING' : 'ACTIVE',
        lastHeartbeatAt: new Date(),
      },
    }),
    saveProgress(context.profileId, {
      ...(session.episodeId ? { episodeId: session.episodeId } : { mediaItemId: session.mediaItemId }),
      positionSeconds: input.positionSeconds,
      durationSeconds: duration,
    }),
  ]);
  return { ok: true, completed: isProgressComplete(input.positionSeconds, duration ?? null) };
}

export async function stopRokuPlayback(context: PlaybackContext, input: { sessionId: string; positionSeconds?: number; durationSeconds?: number | null; reason?: string }) {
  const session = await ownedSession(input.sessionId, context);
  const position = input.positionSeconds ?? session.positionSeconds;
  const duration = input.durationSeconds ?? session.durationSeconds ?? undefined;
  await Promise.all([
    prisma.playbackSession.update({
      where: { id: session.id },
      data: { positionSeconds: position, ...(duration ? { durationSeconds: duration } : {}), state: 'ENDED', endedAt: new Date(), lastHeartbeatAt: new Date() },
    }),
    saveProgress(context.profileId, {
      ...(session.episodeId ? { episodeId: session.episodeId } : { mediaItemId: session.mediaItemId }),
      positionSeconds: input.reason === 'ended' && duration ? duration : position,
      durationSeconds: duration,
    }),
  ]);
  return { ok: true };
}

export async function refreshRokuPlayback(context: PlaybackContext, input: { sessionId: string; positionSeconds?: number }, request: { protocol: string; headers: { host?: string } }) {
  const session = await ownedSession(input.sessionId, context);
  const settings = await getServerSettings();
  const expiresAt = new Date(Date.now() + PLAYBACK_TTL_SECONDS * 1000);
  const token = signStreamToken(
    { sub: context.accountId, role: context.role, activeProfileId: context.profileId, deviceSessionId: context.deviceSessionId },
    `${PLAYBACK_TTL_SECONDS}s`,
  );
  const position = input.positionSeconds ?? session.positionSeconds;
  const url = buildStreamUrl(apiBase(settings.apiUrl, request), token, session.method as 'direct' | 'hls', session.mediaItemId, session.episodeId ?? undefined, position, session.audioStreamIndex ?? undefined);
  await prisma.playbackSession.update({ where: { id: session.id }, data: { expiresAt, positionSeconds: position, lastHeartbeatAt: new Date() } });
  return { url, expiresAt: expiresAt.toISOString(), positionSeconds: position };
}

export async function nextRokuPlayback(context: PlaybackContext, sessionId: string) {
  const session = await ownedSession(sessionId, context);
  if (!session.episodeId) return { next: null };
  const episode = await prisma.episode.findUnique({ where: { id: session.episodeId } });
  return { next: episode ? await nextEpisodeFor(episode) : null };
}

export type RokuPlaybackSessionRow = Prisma.PlaybackSessionGetPayload<{ include: { mediaItem: true; episode: true; profile: true; deviceSession: true } }>;
