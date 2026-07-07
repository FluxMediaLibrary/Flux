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
  MediaItemDTO,
  MediaItemDetailDTO,
  LibraryItemDTO,
  EpisodeDTO,
  WatchProgressDTO,
  SaveProgressRequest,
  ContinueWatchingItemDTO,
  MediaType,
  PlaybackMarkerDTO,
} from '@flux/shared';
import type { MediaItem, Episode, WatchProgress, PlaybackMarker } from '@prisma/client';

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
    addedAt: row.addedAt.toISOString(),
  };
}

/** Map a Prisma Episode row to the EpisodeDTO wire shape. */
export function mapEpisodeToDTO(row: Episode): EpisodeDTO {
  return {
    id: row.id,
    season: row.season,
    episode: row.episode,
    title: row.title,
    overview: row.overview,
    runtime: row.runtime,
    available: row.filePath != null,
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
  // 1. Continue Watching
  const progressRows = await prisma.watchProgress.findMany({
    where: {
      profileId,
      completed: false,
      positionSeconds: { gt: 0 },
    },
    include: {
      mediaItem: true,
      // Episode-level progress has no direct mediaItem — resolve it via the
      // episode's parent so continue-watching can show the show.
      episode: { include: { mediaItem: true } },
    },
    orderBy: { updatedAt: 'desc' },
    take: 10,
  });

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

  // 2. Recently Added
  const recentRows = await prisma.mediaItem.findMany({
    orderBy: { addedAt: 'desc' },
    take: 20,
  });

  const recentlyAdded: MediaItemDTO[] = recentRows.map(mapMediaItemToDTO);

  // 3. By Genre — aggregate genres from all library items, pick top 6 by count
  const allItems = await prisma.mediaItem.findMany({
    where: { genres: { isEmpty: false } },
  });

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

  return { continueWatching, recentlyAdded, byGenre };
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
      episodes: { orderBy: [{ season: 'asc' }, { episode: 'asc' }] },
    },
  });

  if (!item) {
    throw ApiError.notFound(`Media item ${id} not found`);
  }

  const dto: MediaItemDetailDTO = {
    ...mapMediaItemToDTO(item),
    episodes: item.episodes.map(mapEpisodeToDTO),
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

  const completed =
    data.durationSeconds != null
      ? data.positionSeconds / data.durationSeconds >= 0.92
      : false;

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

/**
 * Return the INTRO playback marker for a media item + season, if one exists
 * and meets the confidence threshold.
 */
export async function getPlaybackMarker(
  mediaItemId: string,
  season: number,
): Promise<PlaybackMarkerDTO> {
  const marker = await prisma.playbackMarker.findUnique({
    where: {
      mediaItemId_season_markerType: {
        mediaItemId,
        season,
        markerType: 'INTRO',
      },
    },
  });

  if (!marker) return { hasMarker: false };

  return {
    hasMarker: true,
    type: marker.markerType,
    start: marker.startSeconds,
    end: marker.endSeconds,
    confidence: marker.confidence,
  };
}
