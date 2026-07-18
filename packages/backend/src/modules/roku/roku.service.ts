import type {
  MediaItemDTO,
  MediaType,
  RokuHomeDTO,
  RokuEpisodeDetailDTO,
  RokuMediaDetailDTO,
  RokuMediaItemDTO,
  RokuMediaRowDTO,
  RokuPagedMediaDTO,
  RokuProgressDTO,
  RokuSearchDTO,
  RokuSeasonDTO,
  WatchProgressDTO,
} from '@flux/shared';
import type { Episode, MediaItem, Prisma, WatchProgress } from '@prisma/client';
import { prisma } from '../../lib/db.js';
import { ApiError } from '../../lib/errors.js';
import { getHomepage, getMediaItemDetail } from '../library/library.service.js';
import { getDetail } from '../tmdb/tmdb.service.js';

const TMDB_IMAGE_ROOT = 'https://image.tmdb.org/t/p';

function imageUrl(size: 'w300' | 'w342' | 'w1280', path: string | null): string | null {
  return path ? `${TMDB_IMAGE_ROOT}/${size}${path}` : null;
}

function metadataNumber(metadata: unknown, key: string): number | null {
  if (!metadata || typeof metadata !== 'object') return null;
  const value = (metadata as Record<string, unknown>)[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function metadataString(metadata: unknown, key: string): string | null {
  if (!metadata || typeof metadata !== 'object') return null;
  const value = (metadata as Record<string, unknown>)[key];
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function mapProgress(progress: WatchProgressDTO | WatchProgress | null | undefined): RokuProgressDTO | null {
  if (!progress) return null;
  const duration = progress.durationSeconds ?? null;
  return {
    positionSeconds: progress.positionSeconds,
    durationSeconds: duration,
    completed: progress.completed,
    percent: duration && duration > 0 ? Math.min(1, progress.positionSeconds / duration) : null,
    updatedAt: typeof progress.updatedAt === 'string' ? progress.updatedAt : progress.updatedAt.toISOString(),
  };
}

function mapBaseItem(
  item: Pick<MediaItem, 'id' | 'type' | 'title' | 'year' | 'overview' | 'genres' | 'posterPath' | 'backdropPath' | 'filePath'> & {
    runtimeMinutes?: number | null;
    contentRating?: string | null;
    rating?: number | null;
    metadata?: unknown;
  },
  options: {
    progress?: WatchProgressDTO | WatchProgress | null;
    episodeCount?: number | null;
    unplayedCount?: number | null;
    available?: boolean;
  } = {},
): RokuMediaItemDTO {
  const progress = mapProgress(options.progress);
  return {
    id: item.id,
    mediaType: item.type === 'MOVIE' ? 'movie' : 'show',
    title: item.title,
    subtitle: item.year ? String(item.year) : null,
    year: item.year,
    runtimeMinutes: item.runtimeMinutes ?? metadataNumber(item.metadata, 'runtime'),
    contentRating: item.contentRating ?? metadataString(item.metadata, 'certification'),
    rating: item.rating ?? metadataNumber(item.metadata, 'vote_average'),
    overview: item.overview,
    genres: item.genres,
    artwork: {
      poster: imageUrl('w342', item.posterPath),
      backdrop: imageUrl('w1280', item.backdropPath),
      thumbnail: imageUrl('w300', item.backdropPath ?? item.posterPath),
    },
    progress,
    watched: progress?.completed ?? false,
    available: options.available ?? (item.type === 'MOVIE' ? item.filePath != null : false),
    episodeCount: options.episodeCount ?? null,
    unplayedCount: options.unplayedCount ?? null,
    parentMediaId: null,
    season: null,
    episode: null,
  };
}

function mapHomeItem(item: MediaItemDTO, progress?: WatchProgressDTO | null): RokuMediaItemDTO {
  return mapBaseItem(
    {
      ...item,
      type: item.type,
      filePath: null,
    },
    { progress, available: true },
  );
}

function mapEpisode(
  episode: Episode,
  parent: Pick<MediaItem, 'id' | 'title' | 'year' | 'genres' | 'posterPath' | 'backdropPath'>,
  progress?: WatchProgressDTO | WatchProgress | null,
): RokuMediaItemDTO {
  const mappedProgress = mapProgress(progress);
  return {
    id: episode.id,
    mediaType: 'episode',
    title: episode.title?.trim() || `Episode ${episode.episode}`,
    subtitle: `S${episode.season} E${episode.episode} · ${parent.title}`,
    year: parent.year,
    runtimeMinutes: episode.runtime,
    contentRating: null,
    rating: null,
    overview: episode.overview,
    genres: parent.genres,
    artwork: {
      poster: imageUrl('w342', parent.posterPath),
      backdrop: imageUrl('w1280', parent.backdropPath),
      thumbnail: imageUrl('w300', parent.backdropPath ?? parent.posterPath),
    },
    progress: mappedProgress,
    watched: mappedProgress?.completed ?? false,
    available: episode.filePath != null,
    episodeCount: null,
    unplayedCount: null,
    parentMediaId: parent.id,
    season: episode.season,
    episode: episode.episode,
  };
}

async function annotateItems(items: MediaItem[], profileId: string): Promise<RokuMediaItemDTO[]> {
  if (items.length === 0) return [];
  const ids = items.map((item) => item.id);
  const [progressRows, episodeStats] = await Promise.all([
    prisma.watchProgress.findMany({
      where: { profileId, mediaItemId: { in: ids } },
    }),
    prisma.episode.groupBy({
      by: ['mediaItemId'],
      where: { mediaItemId: { in: ids }, filePath: { not: null } },
      _count: { _all: true },
    }),
  ]);
  const progressByMedia = new Map(progressRows.map((row) => [row.mediaItemId, row]));
  const episodeCount = new Map(episodeStats.map((row) => [row.mediaItemId, row._count._all]));

  return items.map((item) => {
    const count = episodeCount.get(item.id) ?? 0;
    return mapBaseItem(item, {
      progress: progressByMedia.get(item.id),
      episodeCount: item.type === 'SHOW' ? count : null,
      available: item.type === 'MOVIE' ? item.filePath != null : count > 0,
    });
  });
}

function row(id: string, title: string, items: RokuMediaItemDTO[], layout: RokuMediaRowDTO['layout'] = 'poster'): RokuMediaRowDTO {
  return { id, title, layout, items };
}

export async function getRokuHome(profileId: string, rowOrder: string[] = []): Promise<RokuHomeDTO> {
  const home = await getHomepage(profileId);
  const continueWatching = home.continueWatching.map((entry) => {
    const base = mapHomeItem(entry.mediaItem, entry.progress);
    if (!entry.episode) return base;
    return {
      ...base,
      id: entry.episode.id,
      mediaType: 'episode' as const,
      title: entry.episode.title || `Episode ${entry.episode.episode}`,
      subtitle: `S${entry.episode.season} E${entry.episode.episode} · ${entry.mediaItem.title}`,
      parentMediaId: entry.mediaItem.id,
      season: entry.episode.season,
      episode: entry.episode.episode,
      available: entry.episode.available,
      runtimeMinutes: entry.episode.runtime,
      contentRating: null,
      rating: null,
    };
  });
  const rows: RokuMediaRowDTO[] = [];
  if (continueWatching.length) rows.push(row('continue-watching', 'Continue Watching', continueWatching, 'landscape'));
  rows.push(row('recently-added', 'Recently Added', home.recentlyAdded.map((item) => mapHomeItem(item))));
  if (home.newReleases.length) rows.push(row('new-releases', 'New Releases', home.newReleases.map((item) => mapHomeItem(item))));
  if (home.topRated.length) rows.push(row('top-rated', 'Top Rated', home.topRated.map((item) => mapHomeItem(item))));
  if (home.recommended.length) rows.push(row('recommended', 'Because You Watched', home.recommended.map((item) => mapHomeItem(item))));
  if (home.randomPicks.length) rows.push(row('random-picks', 'Random Picks', home.randomPicks.map((item) => mapHomeItem(item))));
  for (const genre of home.byGenre) {
    rows.push(row(`genre-${genre.genre.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`, genre.genre, genre.items.map((item) => mapHomeItem(item))));
  }
  for (const failure of home.errors ?? []) {
    const existing = rows.find((candidate) => candidate.id === failure.id);
    const error = { code: failure.code, message: failure.message, retryable: failure.retryable };
    if (existing) existing.error = error;
    else rows.push({ id: failure.id, title: failure.title, layout: 'poster', items: [], error });
  }
  if (rowOrder.length) {
    const priority = new Map(rowOrder.map((id, index) => [id, index]));
    rows.sort((left, right) => (priority.get(left.id) ?? rowOrder.length) - (priority.get(right.id) ?? rowOrder.length));
  }
  const hero = rows.flatMap((entry) => entry.items).filter((item) => item.artwork.backdrop).slice(0, 5);
  return { hero, rows, generatedAt: new Date().toISOString() };
}

export async function getRokuHomeRow(profileId: string, rowOrder: string[], id: string): Promise<RokuMediaRowDTO> {
  const home = await getRokuHome(profileId, rowOrder);
  const result = home.rows.find((candidate) => candidate.id === id);
  if (!result) throw ApiError.notFound('Home row not found');
  return result;
}

export async function getRokuLibrary(
  profileId: string,
  type: MediaType,
  page: number,
  limit: number,
  sort: 'title' | 'recent' | 'year' = 'title',
  direction?: 'asc' | 'desc',
  genre?: string,
  watched?: boolean,
): Promise<RokuPagedMediaDTO> {
  const where: Prisma.MediaItemWhereInput = { type };
  if (genre) where.genres = { has: genre };
  if (watched !== undefined && type === 'MOVIE') {
    where.watchProgress = watched
      ? { some: { profileId, completed: true } }
      : { none: { profileId, completed: true } };
  } else if (watched !== undefined) {
    where.episodes = watched
      ? {
          some: { filePath: { not: null } },
          none: { filePath: { not: null }, watchProgress: { none: { profileId, completed: true } } },
        }
      : { some: { filePath: { not: null }, watchProgress: { none: { profileId, completed: true } } } };
  }
  const orderBy: Prisma.MediaItemOrderByWithRelationInput[] = sort === 'recent'
    ? [{ addedAt: direction ?? 'desc' }, { id: 'asc' }]
    : sort === 'year'
      ? [{ year: direction ?? 'desc' }, { title: 'asc' }, { id: 'asc' }]
      : [{ title: direction ?? 'asc' }, { id: 'asc' }];
  const [total, items, genreRows] = await Promise.all([
    prisma.mediaItem.count({ where }),
    prisma.mediaItem.findMany({ where, orderBy, skip: (page - 1) * limit, take: limit }),
    prisma.mediaItem.findMany({ where: { type }, select: { genres: true } }),
  ]);
  const availableGenres = [...new Set(genreRows.flatMap((item) => item.genres))].sort((left, right) => left.localeCompare(right));
  return { items: await annotateItems(items, profileId), page, limit, total, hasMore: page * limit < total, availableGenres };
}

export async function searchRokuLibrary(profileId: string, query: string): Promise<RokuSearchDTO> {
  const normalized = query.trim();
  if (normalized.length < 2) return { query: normalized, movies: [], shows: [], episodes: [] };
  const [media, episodes] = await Promise.all([
    prisma.mediaItem.findMany({
      where: { title: { contains: normalized, mode: 'insensitive' } },
      orderBy: { title: 'asc' },
      take: 30,
    }),
    prisma.episode.findMany({
      where: { title: { contains: normalized, mode: 'insensitive' } },
      include: { mediaItem: true, watchProgress: { where: { profileId }, take: 1 } },
      orderBy: [{ mediaItem: { title: 'asc' } }, { season: 'asc' }, { episode: 'asc' }],
      take: 20,
    }),
  ]);
  const mapped = await annotateItems(media, profileId);
  return {
    query: normalized,
    movies: mapped.filter((item) => item.mediaType === 'movie'),
    shows: mapped.filter((item) => item.mediaType === 'show'),
    episodes: episodes.map((episode) => mapEpisode(episode, episode.mediaItem, episode.watchProgress[0])),
  };
}

export async function getRokuMediaDetail(profileId: string, id: string): Promise<RokuMediaDetailDTO> {
  const item = await prisma.mediaItem.findUnique({
    where: { id },
    include: {
      episodes: { include: { watchProgress: { where: { profileId }, take: 1 } }, orderBy: [{ season: 'asc' }, { episode: 'asc' }] },
      watchProgress: { where: { profileId }, take: 1 },
    },
  });
  if (!item) throw ApiError.notFound('Media item not found');

  const local = await getMediaItemDetail(id, profileId);
  const base = mapBaseItem(item, {
    progress: item.watchProgress[0],
    episodeCount: item.type === 'SHOW' ? item.episodes.filter((episode) => episode.filePath).length : null,
    available: item.type === 'MOVIE' ? item.filePath != null : item.episodes.some((episode) => episode.filePath),
  });
  const episodes = item.episodes.map((episode) => mapEpisode(episode, item, episode.watchProgress[0]));
  const seasons: RokuSeasonDTO[] = [...new Set(item.episodes.map((episode) => episode.season))].map((season) => {
    const seasonEpisodes = episodes.filter((episode) => episode.season === season);
    return {
      season,
      title: `Season ${season}`,
      episodeCount: seasonEpisodes.length,
      availableCount: seasonEpisodes.filter((episode) => episode.available).length,
      unplayedCount: seasonEpisodes.filter((episode) => episode.available && !episode.watched).length,
      artwork: base.artwork,
    };
  });

  let remote: Awaited<ReturnType<typeof getDetail>> | null = null;
  try {
    remote = await getDetail(item.type, item.tmdbId);
  } catch {
    // Local library metadata is authoritative for availability. Rich TMDb
    // metadata is optional so browsing still works during an upstream outage.
  }

  const similarRows = remote?.similar?.filter((candidate) => candidate.inLibrary && candidate.mediaItemId).slice(0, 18) ?? [];
  const similarItems = similarRows.length
    ? await prisma.mediaItem.findMany({ where: { id: { in: similarRows.map((candidate) => candidate.mediaItemId!) } } })
    : [];
  const similar = await annotateItems(similarItems, profileId);
  const directors = remote?.crew?.filter((member) => member.job === 'Director').map((member) => member.name) ?? [];

  return {
    ...base,
    progress: mapProgress(local.progress),
    runtimeMinutes: remote?.runtime ?? metadataNumber(item.metadata, 'runtime'),
    contentRating: remote?.ageRating ?? metadataString(item.metadata, 'certification'),
    rating: remote?.voteAverage ?? metadataNumber(item.metadata, 'vote_average'),
    tagline: remote?.tagline ?? metadataString(item.metadata, 'tagline'),
    cast: remote?.cast ?? [],
    directors,
    trailerYoutubeKey: remote?.trailerYoutubeKey ?? null,
    similar,
    seasons,
    episodes,
  };
}

export async function getRokuSeasons(profileId: string, id: string): Promise<RokuSeasonDTO[]> {
  return (await getRokuMediaDetail(profileId, id)).seasons;
}

export async function getRokuEpisodes(profileId: string, id: string, season: number): Promise<RokuMediaItemDTO[]> {
  const detail = await getRokuMediaDetail(profileId, id);
  return detail.episodes.filter((episode) => episode.season === season);
}

export async function getRokuEpisodeDetail(profileId: string, id: string): Promise<RokuEpisodeDetailDTO> {
  const episode = await prisma.episode.findUnique({
    where: { id },
    include: {
      mediaItem: true,
      watchProgress: { where: { profileId }, take: 1 },
    },
  });
  if (!episode) throw ApiError.notFound('Episode not found');
  return {
    ...mapEpisode(episode, episode.mediaItem, episode.watchProgress[0]),
    showTitle: episode.mediaItem.title,
    runtimeMinutes: episode.runtime,
    airDate: null,
  };
}
