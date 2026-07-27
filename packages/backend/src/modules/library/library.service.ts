/**
 * Library service — homepage rows, media item detail, and watch progress.
 *
 * All per-profile data is scoped to the active profile. DTO mapping is handled
 * internally to keep route handlers thin.
 */
import { prisma } from '../../lib/db.js';
import { ApiError } from '../../lib/errors.js';
import type {
  HomeRowsDTO,
  HomeRowErrorDTO,
  MediaItemDTO,
  MediaItemDetailDTO,
  LibraryItemDTO,
  EpisodeDTO,
  PlaybackMarkerDTO,
  WatchProgressDTO,
  SaveProgressRequest,
  ContinueWatchingItemDTO,
  MediaType,
} from '@flux/shared';
import type { MediaItem, Episode, PlaybackMarker, WatchProgress } from '@prisma/client';
import { isProgressComplete } from './progress-policy.js';

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

function uniqueItems(
  items: MediaItem[],
  limit: number,
  excludeIds = new Set<string>(),
): MediaItemDTO[] {
  const seen = new Set(excludeIds);
  const result: MediaItemDTO[] = [];
  for (const item of items) {
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    result.push(mapMediaItemToDTO(item));
    if (result.length >= limit) break;
  }
  return result;
}

function shuffleItems<T>(items: T[]): T[] {
  return items
    .map((item) => ({ item, sort: Math.random() }))
    .sort((a, b) => a.sort - b.sort)
    .map(({ item }) => item);
}

// ─── DTO mappers ─────────────────────────────────────────────────────────────

/** Map a Prisma MediaItem row to the MediaItemDTO wire shape. */
export function mapMediaItemToDTO(row: MediaItem): MediaItemDTO {
  return {
    id: row.id,
    tmdbId: row.tmdbId,
    type: row.type as MediaType,
    title: row.title,
    year: row.year,
    overview: row.overview,
    posterPath: row.posterPath,
    backdropPath: row.backdropPath,
    genres: row.genres,
    runtimeMinutes: metadataNumber(row.metadata, 'runtime'),
    contentRating: metadataString(row.metadata, 'certification'),
    rating: metadataNumber(row.metadata, 'vote_average'),
    addedAt: row.addedAt.toISOString(),
  };
}

/** Map a Prisma Episode row to the EpisodeDTO wire shape. */
export function mapPlaybackMarkerToDTO(row: PlaybackMarker): PlaybackMarkerDTO {
  return {
    type: row.type as PlaybackMarkerDTO['type'],
    startSeconds: row.startSeconds,
    endSeconds: row.endSeconds,
  };
}

/** Map a Prisma Episode row to the EpisodeDTO wire shape. */
export function mapEpisodeToDTO(row: Episode & { playbackMarkers?: PlaybackMarker[] }): EpisodeDTO {
  const markers = row.playbackMarkers?.map(mapPlaybackMarkerToDTO);
  return {
    id: row.id,
    season: row.season,
    episode: row.episode,
    title: row.title,
    overview: row.overview,
    runtime: row.runtime,
    available: row.filePath != null,
    ...(markers ? { playbackMarkers: markers } : {}),
  };
}

/** Map a Prisma WatchProgress row to the WatchProgressDTO wire shape. */
export function mapProgressToDTO(row: WatchProgress): WatchProgressDTO {
  return {
    mediaItemId: row.mediaItemId,
    episodeId: row.episodeId,
    positionSeconds: row.positionSeconds,
    durationSeconds: row.durationSeconds,
    completed: row.completed,
    updatedAt: row.updatedAt.toISOString(),
  };
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Build the homepage rows for a profile:
 *   1. Continue Watching — in-progress items ordered by most recently watched.
 *   2. Recently Added — newest library additions.
 *   3. By Genre — top 6 genres by item count, up to 10 items each.
 */
export async function getHomepage(profileId: string): Promise<HomeRowsDTO> {
  const [progressResult, recentResult, releasesResult, discoveryResult] = await Promise.allSettled([
    prisma.watchProgress.findMany({
      where: { profileId, completed: false, positionSeconds: { gt: 0 } },
      include: { mediaItem: true, episode: { include: { mediaItem: true } } },
      orderBy: { updatedAt: 'desc' },
      take: 10,
    }),
    prisma.mediaItem.findMany({ orderBy: { addedAt: 'desc' }, take: 20 }),
    prisma.mediaItem.findMany({
      where: { year: { not: null } },
      orderBy: [{ year: 'desc' }, { addedAt: 'desc' }],
      take: 24,
    }),
    prisma.mediaItem.findMany({ where: { genres: { isEmpty: false } } }),
  ]);

  const errors: HomeRowErrorDTO[] = [];
  const errorIds = new Set<string>();
  const addError = (id: string, title: string) => {
    if (errorIds.has(id)) return;
    errorIds.add(id);
    errors.push({
      id,
      title,
      code: 'HOME_ROW_UNAVAILABLE',
      message: 'Flux could not load this row. Select Retry to try again.',
      retryable: true,
    });
  };

  const progressRows = progressResult.status === 'fulfilled' ? progressResult.value : [];
  if (progressResult.status === 'rejected') {
    addError('continue-watching', 'Continue Watching');
    addError('recommended', 'Because You Watched');
  }

  const continueWatching: ContinueWatchingItemDTO[] = progressRows.flatMap(
    (p) => {
      const mediaItem = p.mediaItem ?? p.episode?.mediaItem;
      if (!mediaItem) return []; // orphaned progress row — skip
      return [
        {
          mediaItem: mapMediaItemToDTO(mediaItem),
          episode: p.episode ? mapEpisodeToDTO(p.episode) : null,
          progress: mapProgressToDTO(p),
        },
      ];
    },
  );

  const recentRows = recentResult.status === 'fulfilled' ? recentResult.value : [];
  if (recentResult.status === 'rejected') addError('recently-added', 'Recently Added');
  const recentlyAdded: MediaItemDTO[] = recentRows.map(mapMediaItemToDTO);
  const newReleaseRows = releasesResult.status === 'fulfilled' ? releasesResult.value : [];
  if (releasesResult.status === 'rejected') addError('new-releases', 'New Releases');
  const newReleases = uniqueItems(newReleaseRows, 16);
  const allItems = discoveryResult.status === 'fulfilled' ? discoveryResult.value : [];
  if (discoveryResult.status === 'rejected') {
    addError('top-rated', 'Top Rated');
    addError('recommended', 'Because You Watched');
    addError('random-picks', 'Random Picks');
    addError('genres', 'Genres');
  }

  const topRated = uniqueItems(
    [...allItems]
      .filter((item) => metadataNumber(item.metadata, 'vote_average') !== null)
      .sort(
        (a, b) =>
          (metadataNumber(b.metadata, 'vote_average') ?? 0) -
          (metadataNumber(a.metadata, 'vote_average') ?? 0),
      ),
    16,
  );

  const watchedGenres = new Set(
    progressRows.flatMap((progress) => {
      const mediaItem = progress.mediaItem ?? progress.episode?.mediaItem;
      return mediaItem?.genres ?? [];
    }),
  );
  const watchedIds = new Set(
    progressRows
      .map((progress) => progress.mediaItem?.id ?? progress.episode?.mediaItem.id)
      .filter((id): id is string => Boolean(id)),
  );
  const recommended = uniqueItems(
    allItems
      .filter((item) => item.genres.some((genre) => watchedGenres.has(genre)))
      .sort((a, b) => b.addedAt.getTime() - a.addedAt.getTime()),
    16,
    watchedIds,
  );
  const randomPicks = uniqueItems(shuffleItems(allItems), 16);

  const genreMap = new Map<string, MediaItem[]>();
  for (const item of allItems) {
    for (const genre of item.genres) {
      const bucket = genreMap.get(genre);
      if (bucket) {
        bucket.push(item);
      } else {
        genreMap.set(genre, [item]);
      }
    }
  }

  // Sort genres by item count desc, take top 6, up to 10 items per genre.
  const genreEntries: [string, MediaItem[]][] = [];
  genreMap.forEach((items, genre) => {
    genreEntries.push([genre, items]);
  });
  genreEntries.sort((a, b) => b[1].length - a[1].length);

  const byGenre: { genre: string; items: MediaItemDTO[] }[] = genreEntries
    .slice(0, 6)
    .map(([genre, items]) => ({
      genre,
      items: items.slice(0, 10).map(mapMediaItemToDTO),
    }));

  return {
    continueWatching,
    recentlyAdded,
    newReleases,
    topRated,
    recommended,
    randomPicks,
    byGenre,
    errors,
  };
}

/**
 * List the whole library (optionally filtered by type) as grid items, annotated
 * with per-profile playback state so the UI can render watched/unplayed badges.
 * Sorted by title for the A–Z rail.
 */
export async function listLibrary(
  profileId: string,
  type?: MediaType,
): Promise<LibraryItemDTO[]> {
  const items = await prisma.mediaItem.findMany({
    where: type ? { type } : undefined,
    include: { episodes: { select: { id: true, filePath: true } } },
    orderBy: { title: 'asc' },
  });
  if (items.length === 0) return [];

  const mediaIds = items.map((i) => i.id);
  const episodeIds = items.flatMap((i) => i.episodes.map((e) => e.id));

  // Completed movie progress + completed episode progress for this profile.
  const [movieDone, episodeDone] = await Promise.all([
    prisma.watchProgress.findMany({
      where: { profileId, mediaItemId: { in: mediaIds }, completed: true },
      select: { mediaItemId: true },
    }),
    episodeIds.length
      ? prisma.watchProgress.findMany({
          where: { profileId, episodeId: { in: episodeIds }, completed: true },
          select: { episodeId: true },
        })
      : Promise.resolve([] as { episodeId: string | null }[]),
  ]);

  const completedMovies = new Set(movieDone.map((p) => p.mediaItemId));
  const completedEpisodes = new Set(episodeDone.map((p) => p.episodeId));

  return items.map((item) => {
    const base = mapMediaItemToDTO(item);

    if (item.type === 'MOVIE') {
      return {
        ...base,
        episodeCount: 0,
        unplayedCount: null,
        available: item.filePath != null,
        watched: completedMovies.has(item.id),
      };
    }

    const availableEps = item.episodes.filter((e) => e.filePath != null);
    const episodeCount = availableEps.length;
    const unplayed = availableEps.filter(
      (e) => !completedEpisodes.has(e.id),
    ).length;

    return {
      ...base,
      episodeCount,
      unplayedCount: episodeCount > 0 ? unplayed : null,
      available: episodeCount > 0,
      watched: episodeCount > 0 && unplayed === 0,
    };
  });
}

/**
 * Fetch a single media item with episodes (for shows) and optional
 * per-profile watch progress.
 */
export async function getMediaItemDetail(
  id: string,
  profileId?: string,
): Promise<MediaItemDetailDTO> {
  const item = await prisma.mediaItem.findUnique({
    where: { id },
    include: {
      playbackMarkers: { orderBy: { startSeconds: 'asc' } },
      episodes: {
        orderBy: [{ season: 'asc' }, { episode: 'asc' }],
        include: {
          playbackMarkers: { orderBy: { startSeconds: 'asc' } },
        },
      },
    },
  });

  if (!item) {
    throw ApiError.notFound(`Media item ${id} not found`);
  }

  const dto: MediaItemDetailDTO = {
    ...mapMediaItemToDTO(item),
    episodes: item.episodes.map(mapEpisodeToDTO),
    playbackMarkers: item.playbackMarkers.map(mapPlaybackMarkerToDTO),
  };

  if (profileId) {
    const episodeIds = item.episodes.map((e) => e.id);
    // One query covers both the movie-level row and every episode row so shows
    // can resume the exact episode/position the profile left off at.
    const progressRows = await prisma.watchProgress.findMany({
      where: {
        profileId,
        OR: [
          { mediaItemId: id },
          ...(episodeIds.length ? [{ episodeId: { in: episodeIds } }] : []),
        ],
      },
    });

    const movieProgress = progressRows.find((p) => p.mediaItemId === id) ?? null;
    dto.progress = movieProgress ? mapProgressToDTO(movieProgress) : null;

    const byEpisode = new Map(
      progressRows
        .filter((p) => p.episodeId != null)
        .map((p) => [p.episodeId!, p] as const),
    );
    dto.episodes = dto.episodes!.map((e) => {
      const p = byEpisode.get(e.id);
      return { ...e, progress: p ? mapProgressToDTO(p) : null };
    });
  }

  return dto;
}

/**
 * Save (upsert) watch progress for a profile.
 *
 * Exactly one of `mediaItemId` or `episodeId` must be provided.
 * Progress is marked completed when position >= 92 % of duration.
 */
export async function saveProgress(
  profileId: string,
  data: SaveProgressRequest,
): Promise<WatchProgressDTO> {
  const hasMedia = !!data.mediaItemId;
  const hasEpisode = !!data.episodeId;

  if (hasMedia === hasEpisode) {
    throw ApiError.badRequest(
      'Exactly one of mediaItemId or episodeId must be provided',
      'INVALID_PROGRESS_TARGET',
    );
  }

  const completed = isProgressComplete(data.positionSeconds, data.durationSeconds);

  if (hasMedia) {
    const row = await prisma.watchProgress.upsert({
      where: {
        profileId_mediaItemId: {
          profileId,
          mediaItemId: data.mediaItemId!,
        },
      },
      create: {
        profileId,
        mediaItemId: data.mediaItemId!,
        positionSeconds: data.positionSeconds,
        durationSeconds: data.durationSeconds ?? null,
        completed,
      },
      update: {
        positionSeconds: data.positionSeconds,
        durationSeconds: data.durationSeconds,
        completed,
      },
    });
    return mapProgressToDTO(row);
  }

  // hasEpisode branch
  const row = await prisma.watchProgress.upsert({
    where: {
      profileId_episodeId: {
        profileId,
        episodeId: data.episodeId!,
      },
    },
    create: {
      profileId,
      episodeId: data.episodeId!,
      positionSeconds: data.positionSeconds,
      durationSeconds: data.durationSeconds ?? null,
      completed,
    },
    update: {
      positionSeconds: data.positionSeconds,
      durationSeconds: data.durationSeconds,
      completed,
    },
  });
  return mapProgressToDTO(row);
}
