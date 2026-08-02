/**
 * Admin info aggregator — collects system, storage, database, torrent, and
 * request stats for the admin dashboard. Admin-only at the route layer.
 */
import * as os from 'node:os';
import fs from 'node:fs/promises';
import path from 'node:path';
import { prisma } from '../../lib/db.js';
import { config } from '../../config.js';
import { safeJoin, resolveFilePath } from '../../lib/media-paths.js';
import { getLibraryRootState } from '../../lib/library-roots.js';
import { analyzeAndStoreMedia } from '../../lib/media-analyzer.js';
import { ensureTrickplay } from '../../lib/trickplay-generator.js';
import { ApiError } from '../../lib/errors.js';
import {
  getDetail as getTmdbDetail,
  getSeasonEpisodes as getTmdbSeasonEpisodes,
} from '../tmdb/tmdb.service.js';
import type {
  AdminBulkEpisodeSyncResultDTO,
  AdminBulkMediaAnalyzeResultDTO,
  AdminEpisodeSyncResultDTO,
  AdminInfoDTO,
  AdminLibraryAcquisitionTargetDTO,
  AdminLibraryHealthDTO,
  AdminLibraryItemDTO,
  AdminLibraryRequestDTO,
  AdminLibraryRepairResultDTO,
  AdminMediaDeleteResultDTO,
  AdminMediaAnalyzeResultDTO,
  AdminStorageCleanupResultDTO,
  StorageRootDTO,
} from '@flux/shared';
import type { TorrentStatus, RequestStatus } from '@flux/shared';

const ADMIN_HEALTH_METADATA_REFRESH_LIMIT = 6;

const DIR_SIZE_CACHE_TTL_MS = 60_000;
const DIR_SIZE_CONCURRENCY = 32;
const dirSizeCache = new Map<string, { bytes: number; measuredAt: number }>();

function clearDirectorySizeCache(): void {
  dirSizeCache.clear();
}

async function mapWithConcurrency<T>(
  items: readonly T[],
  limit: number,
  fn: (item: T) => Promise<number>,
): Promise<number[]> {
  const results = new Array<number>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next++;
      const item = items[index];
      if (item !== undefined) results[index] = await fn(item);
    }
  });
  await Promise.all(workers);
  return results;
}

async function getStorageRoot(rootPath: string): Promise<StorageRootDTO> {
  try {
    const stats = await fs.statfs(rootPath);
    const totalBytes = stats.blocks * stats.bsize;
    const freeBytes = stats.bavail * stats.bsize;
    const usedBytes = await directorySize(rootPath);
    return {
      path: rootPath,
      exists: true,
      totalBytes,
      freeBytes,
      usedBytes,
    };
  } catch {
    return {
      path: rootPath,
      exists: false,
      totalBytes: null,
      freeBytes: null,
      usedBytes: null,
    };
  }
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function directorySize(dir: string): Promise<number> {
  const cached = dirSizeCache.get(dir);
  if (cached && Date.now() - cached.measuredAt < DIR_SIZE_CACHE_TTL_MS) {
    return cached.bytes;
  }
  let bytes = 0;
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    const sizes = await mapWithConcurrency(
      entries,
      DIR_SIZE_CONCURRENCY,
      async (entry) => {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) return directorySize(fullPath);
        if (!entry.isFile()) return 0;
        const stat = await fs.stat(fullPath).catch(() => null);
        return stat?.size ?? 0;
      },
    );
    bytes = sizes.reduce((sum, value) => sum + value, 0);
  } catch {
    bytes = 0;
  }
  dirSizeCache.set(dir, { bytes, measuredAt: Date.now() });
  return bytes;
}

async function containingMediaRoot(filePath: string): Promise<string | null> {
  const resolved = path.resolve(filePath);
  const { roots } = await getLibraryRootState();
  for (const root of roots) {
    const rel = path.relative(root, resolved);
    if (rel === '' || rel === '.' || (!rel.startsWith('..') && !path.isAbsolute(rel))) {
      return root;
    }
  }
  return null;
}

async function resolveDeletableMediaPath(filePath: string): Promise<{ filePath: string; root: string } | null> {
  const resolved = await resolveFilePath(filePath);
  if (!resolved) return null;
  const root = await containingMediaRoot(resolved);
  if (!root) {
    throw ApiError.badRequest(
      'Refusing to delete a media file outside configured media roots',
      'MEDIA_DELETE_OUTSIDE_ROOT',
    );
  }
  return { filePath: resolved, root };
}

async function removeEmptyParents(filePath: string, root: string): Promise<void> {
  let dir = path.dirname(filePath);
  const resolvedRoot = path.resolve(root);
  while (dir !== resolvedRoot) {
    const rel = path.relative(resolvedRoot, dir);
    if (rel.startsWith('..') || path.isAbsolute(rel)) return;
    try {
      await fs.rmdir(dir);
    } catch {
      return;
    }
    dir = path.dirname(dir);
  }
}

async function deletePreparedFiles(
  files: { filePath: string; root: string }[],
): Promise<{ deletedFiles: number; deletedBytes: number; skippedFiles: string[] }> {
  let deletedFiles = 0;
  let deletedBytes = 0;
  const skippedFiles: string[] = [];
  const uniqueFiles = [...new Map(files.map((file) => [file.filePath, file])).values()];

  for (const file of uniqueFiles) {
    try {
      const stat = await fs.stat(file.filePath);
      if (!stat.isFile()) {
        skippedFiles.push(file.filePath);
        continue;
      }
      await fs.rm(file.filePath, { force: true });
      await removeEmptyParents(file.filePath, file.root);
      deletedFiles += 1;
      deletedBytes += stat.size;
    } catch {
      skippedFiles.push(file.filePath);
    }
  }

  return { deletedFiles, deletedBytes, skippedFiles };
}

async function buildDeletableFileList(filePaths: (string | null)[]): Promise<{
  files: { filePath: string; root: string }[];
  skippedFiles: string[];
}> {
  const files: { filePath: string; root: string }[] = [];
  const skippedFiles: string[] = [];

  for (const filePath of filePaths) {
    if (!filePath) continue;
    const resolved = await resolveDeletableMediaPath(filePath);
    if (resolved) files.push(resolved);
    else skippedFiles.push(filePath);
  }

  return { files, skippedFiles };
}

function tmdbSeasonCounts(metadata: unknown): { season: number; episodeCount: number }[] {
  if (!metadata || typeof metadata !== 'object') return [];
  const seasons = (metadata as { seasons?: unknown }).seasons;
  if (!Array.isArray(seasons)) return [];
  return seasons.flatMap((season) => {
    if (!season || typeof season !== 'object') return [];
    const raw = season as { season?: unknown; episodeCount?: unknown };
    return typeof raw.season === 'number' &&
      raw.season > 0 &&
      typeof raw.episodeCount === 'number' &&
      raw.episodeCount > 0
      ? [{ season: raw.season, episodeCount: raw.episodeCount }]
      : [];
  });
}

function expectedEpisodeTotal(metadata: unknown): number | null {
  const seasons = tmdbSeasonCounts(metadata);
  if (seasons.length === 0) return null;
  return seasons.reduce((sum, season) => sum + season.episodeCount, 0);
}

function hasShowSeasonMetadata(metadata: unknown): boolean {
  return tmdbSeasonCounts(metadata).length > 0;
}

async function refreshIncompleteShowMetadata(): Promise<void> {
  const candidates = await prisma.mediaItem.findMany({
    where: { type: 'SHOW' },
    orderBy: { updatedAt: 'asc' },
    select: {
      id: true,
      tmdbId: true,
      metadata: true,
    },
    take: 40,
  });

  const targets = candidates
    .filter((item) => !hasShowSeasonMetadata(item.metadata))
    .slice(0, ADMIN_HEALTH_METADATA_REFRESH_LIMIT);

  for (const item of targets) {
    try {
      const detail = await getTmdbDetail('SHOW', item.tmdbId);
      await prisma.mediaItem.update({
        where: { id: item.id },
        data: {
          title: detail.title,
          year: detail.year,
          overview: detail.overview,
          posterPath: detail.posterPath,
          backdropPath: detail.backdropPath,
          genres: detail.genres,
          metadata: detail as any,
        },
      });
    } catch (err) {
      console.error(`[Admin] Failed to refresh TMDb metadata for show ${item.id}:`, err);
    }
  }
}

function buildSeasonCoverage(
  expectedSeasons: { season: number; episodeCount: number }[],
  episodes: {
    season: number;
    episode: number;
    filePath: string | null;
    mediaInfo: { id: string } | null;
    fileExists: boolean | null;
  }[],
): AdminLibraryHealthDTO['items'][number]['seasons'] {
  type SeasonCoverageRow = NonNullable<AdminLibraryHealthDTO['items'][number]['seasons']>[number];
  const bySeason = new Map<number, SeasonCoverageRow>();

  const addEpisodeNumber = (numbers: number[], episodeNumber: number) => {
    if (!numbers.includes(episodeNumber)) numbers.push(episodeNumber);
  };

  const removeEpisodeNumber = (numbers: number[], episodeNumber: number) => {
    const index = numbers.indexOf(episodeNumber);
    if (index >= 0) numbers.splice(index, 1);
  };

  for (const season of expectedSeasons) {
    bySeason.set(season.season, {
      season: season.season,
      expectedEpisodes: season.episodeCount,
      syncedEpisodes: 0,
      availableEpisodes: 0,
      missingEpisodes: season.episodeCount,
      brokenEpisodes: 0,
      unanalyzedEpisodes: 0,
      missingEpisodeNumbers: Array.from({ length: season.episodeCount }, (_, index) => index + 1),
      brokenEpisodeNumbers: [],
    });
  }

  for (const episode of episodes) {
    const row = bySeason.get(episode.season) ?? {
      season: episode.season,
      expectedEpisodes: null,
      syncedEpisodes: 0,
      availableEpisodes: 0,
      missingEpisodes: 0,
      brokenEpisodes: 0,
      unanalyzedEpisodes: 0,
      missingEpisodeNumbers: [],
      brokenEpisodeNumbers: [],
    };
    row.syncedEpisodes += 1;
    if (episode.filePath) {
      row.availableEpisodes += 1;
      removeEpisodeNumber(row.missingEpisodeNumbers, episode.episode);
    } else if (row.expectedEpisodes === null) {
      addEpisodeNumber(row.missingEpisodeNumbers, episode.episode);
    }
    if (episode.filePath && episode.fileExists === false) {
      row.brokenEpisodes += 1;
      addEpisodeNumber(row.brokenEpisodeNumbers, episode.episode);
    }
    if (episode.filePath && !episode.mediaInfo) row.unanalyzedEpisodes += 1;
    row.missingEpisodes = row.expectedEpisodes === null
      ? Math.max(0, row.syncedEpisodes - row.availableEpisodes)
      : Math.max(0, row.expectedEpisodes - row.availableEpisodes);
    row.missingEpisodeNumbers.sort((a, b) => a - b);
    row.brokenEpisodeNumbers.sort((a, b) => a - b);
    bySeason.set(episode.season, row);
  }

  return [...bySeason.values()].sort((a, b) => a.season - b.season);
}

function requestMatchesTarget(
  request: AdminLibraryRequestDTO,
  season?: number,
  episode?: number,
): boolean {
  if (!season) return request.season == null;
  if (request.season != null && request.season !== season) return false;
  if (!episode) return request.episode == null || request.season === season;
  return request.episode == null || request.episode === episode;
}

function preferredRequestId(
  requests: AdminLibraryRequestDTO[],
  season?: number,
  episode?: number,
): string | null {
  return requests.find(
    (request) => request.status === 'APPROVED' && requestMatchesTarget(request, season, episode),
  )?.id ?? null;
}

function buildAcquisitionTargets(
  item: Omit<AdminLibraryItemDTO, 'acquisitionTargets'>,
): AdminLibraryAcquisitionTargetDTO[] {
  if (item.type === 'MOVIE') {
    if (item.available && item.fileExists !== false) return [];
    const broken = item.fileExists === false;
    return [{
      key: item.id,
      reason: broken ? 'BROKEN_FILE' : 'MISSING_FILE',
      season: null,
      episode: null,
      requestId: preferredRequestId(item.requests),
      label: broken ? 'Broken movie file' : 'Missing movie file',
      detail: broken ? 'Replace the missing disk file.' : 'Acquire the movie file.',
      tone: 'bad',
      syncSeason: null,
      priority: broken ? 120 : 100,
    }];
  }

  if (item.expectedEpisodes === null) {
    return [{
      key: `${item.id}:metadata`,
      reason: 'MISSING_METADATA',
      season: null,
      episode: null,
      requestId: preferredRequestId(item.requests),
      label: 'Unknown seasons',
      detail: 'Sync episodes to refresh TMDb season data.',
      tone: 'warn',
      syncSeason: null,
      priority: 70,
    }];
  }

  const targets = (item.seasons ?? []).flatMap((season): AdminLibraryAcquisitionTargetDTO[] => {
    const exactEpisodeNumbers = [
      ...season.brokenEpisodeNumbers,
      ...season.missingEpisodeNumbers,
    ].filter((episode, index, all) => all.indexOf(episode) === index);

    if (exactEpisodeNumbers.length > 0) {
      return exactEpisodeNumbers.slice(0, 12).map((episode) => {
        const broken = season.brokenEpisodeNumbers.includes(episode);
        return {
          key: `${item.id}:s${season.season}:e${episode}`,
          reason: broken ? 'BROKEN_FILE' : 'MISSING_FILE',
          season: season.season,
          episode,
          requestId: preferredRequestId(item.requests, season.season, episode),
          label: `S${season.season} E${episode}`,
          detail: broken ? 'Broken file' : 'Missing file',
          tone: 'bad',
          syncSeason: season.season,
          priority: broken ? 130 : 110,
        };
      });
    }

    if (season.missingEpisodes > 0 || season.brokenEpisodes > 0) {
      const unavailable = season.missingEpisodes + season.brokenEpisodes;
      return [{
        key: `${item.id}:s${season.season}`,
        reason: season.brokenEpisodes > 0 ? 'BROKEN_FILE' : 'MISSING_FILE',
        season: season.season,
        episode: null,
        requestId: preferredRequestId(item.requests, season.season),
        label: `Season ${season.season}`,
        detail: `${unavailable} unavailable episode${unavailable === 1 ? '' : 's'}`,
        tone: 'bad',
        syncSeason: season.season,
        priority: 90 + unavailable,
      }];
    }

    return [];
  });

  if (targets.length > 0) {
    return targets.sort((a, b) => b.priority - a.priority || a.label.localeCompare(b.label));
  }

  if (item.episodeCount === 0) {
    return [{
      key: `${item.id}:episodes`,
      reason: 'UNSYNCED_EPISODES',
      season: null,
      episode: null,
      requestId: preferredRequestId(item.requests),
      label: 'No episodes',
      detail: 'No episode records are synced yet.',
      tone: 'bad',
      syncSeason: null,
      priority: 80,
    }];
  }

  return [];
}

async function analyzeMediaAsset(
  filePath: string,
  target: { mediaItemId: string } | { episodeId: string },
): Promise<void> {
  await analyzeAndStoreMedia(filePath, target);
  const mediaInfo = 'mediaItemId' in target
    ? await prisma.mediaInfo.findUnique({ where: { mediaItemId: target.mediaItemId } })
    : await prisma.mediaInfo.findUnique({ where: { episodeId: target.episodeId } });

  if (mediaInfo?.durationSec && mediaInfo.durationSec > 0) {
    await ensureTrickplay(filePath, mediaInfo.durationSec);
  }
}

export async function getAdminInfo(): Promise<AdminInfoDTO> {
  // ── System ──────────────────────────────────────────────────────────────
  const totalMem = os.totalmem();
  const freeMem = os.freemem();

  const system: AdminInfoDTO['system'] = {
    uptime: Math.floor(process.uptime()),
    nodeVersion: process.version,
    platform: `${os.platform()} ${os.arch()} (${os.release()})`,
    memory: {
      total: totalMem,
      free: freeMem,
      used: totalMem - freeMem,
    },
    cpuLoad: os.loadavg(),
  };

  // ── Storage roots (paths only; disk usage via df in container) ─────────
  const libraryRootState = await getLibraryRootState();
  const [mediaRoots, downloadRoot, transcodeRoot] = await Promise.all([
    Promise.all(libraryRootState.roots.map((r) => getStorageRoot(r))),
    getStorageRoot(config.DOWNLOAD_ROOT),
    getStorageRoot(config.TRANSCODE_ROOT),
  ]);

  const storage: AdminInfoDTO['storage'] = {
    mediaRoots,
    downloadRoot,
    transcodeRoot,
  };

  // ── Database counts ────────────────────────────────────────────────────
  const [
    users,
    profiles,
    mediaItems,
    episodes,
    torrentCount,
    requestCount,
    inviteCount,
  ] = await Promise.all([
    prisma.user.count(),
    prisma.profile.count(),
    prisma.mediaItem.count(),
    prisma.episode.count(),
    prisma.torrent.count(),
    prisma.request.count(),
    prisma.invite.count(),
  ]);

  const database: AdminInfoDTO['database'] = {
    users,
    profiles,
    mediaItems,
    episodes,
    torrents: torrentCount,
    requests: requestCount,
    invites: inviteCount,
  };

  const [
    movies,
    shows,
    availableMovies,
    availableEpisodes,
    mediaForHealth,
    episodesForHealth,
    orphanProgress,
    transcodeEntries,
    transcodeBytes,
  ] = await Promise.all([
    prisma.mediaItem.count({ where: { type: 'MOVIE' } }),
    prisma.mediaItem.count({ where: { type: 'SHOW' } }),
    prisma.mediaItem.count({ where: { type: 'MOVIE', filePath: { not: null } } }),
    prisma.episode.count({ where: { filePath: { not: null } } }),
    prisma.mediaItem.findMany({
      select: {
        filePath: true,
        metadata: true,
        mediaInfo: { select: { id: true } },
      },
    }),
    prisma.episode.findMany({
      select: {
        filePath: true,
        mediaInfo: { select: { id: true } },
      },
    }),
    prisma.watchProgress.count({
      where: {
        mediaItemId: null,
        episodeId: null,
      },
    }),
    fs.readdir(config.TRANSCODE_ROOT, { withFileTypes: true }).catch(() => []),
    directorySize(config.TRANSCODE_ROOT),
  ]);

  const fileChecks = await Promise.all([
    ...mediaForHealth
      .filter((item) => item.filePath)
      .map(async (item) => pathExists((await resolveFilePath(item.filePath!)) ?? '')),
    ...episodesForHealth
      .filter((episode) => episode.filePath)
      .map(async (episode) => pathExists((await resolveFilePath(episode.filePath!)) ?? '')),
  ]);
  const brokenFiles = fileChecks.filter((exists) => !exists).length;
  const missingMetadata = mediaForHealth.filter((item) => item.metadata == null).length;
  const missingAnalysis =
    mediaForHealth.filter((item) => item.filePath && !item.mediaInfo).length +
    episodesForHealth.filter((episode) => episode.filePath && !episode.mediaInfo).length;
  const transcodeSessions = transcodeEntries.filter((entry) => entry.isDirectory()).length;

  const library: AdminInfoDTO['library'] = {
    movies,
    shows,
    availableMovies,
    availableEpisodes,
    unavailableMovies: Math.max(0, movies - availableMovies),
    unavailableEpisodes: episodesForHealth.filter((episode) => !episode.filePath).length,
    missingMetadata,
    missingAnalysis,
    brokenFiles,
    orphanProgress,
    transcodeSessions,
    transcodeBytes,
  };

  // ── Torrent breakdown by status ────────────────────────────────────────
  const torrentStatuses = await prisma.torrent.groupBy({
    by: ['status'],
    _count: { status: true },
  });

  const torrents = {
    downloading: 0,
    seeding: 0,
    stopped: 0,
    error: 0,
    processing: 0,
  };

  for (const s of torrentStatuses) {
    const status = s.status as TorrentStatus;
    if (status === 'DOWNLOADING') torrents.downloading = s._count.status;
    else if (status === 'SEEDING') torrents.seeding = s._count.status;
    else if (status === 'STOPPED') torrents.stopped = s._count.status;
    else if (status === 'ERROR') torrents.error = s._count.status;
    else if (status === 'PROCESSING') torrents.processing = s._count.status;
  }

  // ── Request breakdown by status ────────────────────────────────────────
  const requestStatuses = await prisma.request.groupBy({
    by: ['status'],
    _count: { status: true },
  });

  const requests = {
    pending: 0,
    approved: 0,
    fulfilled: 0,
    rejected: 0,
    downloading: 0,
  };

  for (const s of requestStatuses) {
    const status = s.status as RequestStatus;
    if (status === 'PENDING') requests.pending = s._count.status;
    else if (status === 'APPROVED') requests.approved = s._count.status;
    else if (status === 'FULFILLED') requests.fulfilled = s._count.status;
    else if (status === 'REJECTED') requests.rejected = s._count.status;
    else if (status === 'DOWNLOADING') requests.downloading = s._count.status;
  }

  // ── Torrent errors (last 10) ───────────────────────────────────────────
  const errorTorrents = await prisma.torrent.findMany({
    where: { status: 'ERROR' },
    orderBy: { createdAt: 'desc' },
    take: 10,
    select: { name: true, errorMessage: true, createdAt: true },
  });

  const errors: AdminInfoDTO['errors'] = errorTorrents.map((t) => ({
    name: t.name,
    message: t.errorMessage ?? 'Unknown error',
    since: t.createdAt.toISOString(),
  }));

  return {
    system,
    storage,
    database,
    library,
    torrents,
    requests,
    errors,
  };
}

export async function getAdminLibraryHealth(): Promise<AdminLibraryHealthDTO> {
  await refreshIncompleteShowMetadata();

  const items = await prisma.mediaItem.findMany({
    orderBy: [{ type: 'asc' }, { title: 'asc' }],
    include: {
      mediaInfo: { select: { id: true } },
      episodes: {
        orderBy: [{ season: 'asc' }, { episode: 'asc' }],
        include: { mediaInfo: { select: { id: true } } },
      },
    },
  });
  const requestRows = items.length === 0
    ? []
    : await prisma.request.findMany({
        where: {
          status: { in: ['PENDING', 'APPROVED', 'DOWNLOADING'] },
          OR: items.map((item) => ({
            tmdbId: item.tmdbId,
            mediaType: item.type,
          })),
        },
        include: {
          profile: {
            select: {
              id: true,
              name: true,
              user: { select: { email: true } },
            },
          },
        },
        orderBy: { createdAt: 'asc' },
      });
  const requestsByMedia = new Map<string, typeof requestRows>();
  for (const request of requestRows) {
    const key = `${request.tmdbId}:${request.mediaType}`;
    const list = requestsByMedia.get(key) ?? [];
    list.push(request);
    requestsByMedia.set(key, list);
  }

  const dtoItems = await Promise.all(
    items.map(async (item) => {
      const issues: string[] = [];
      let fileExists: boolean | null = null;
      let brokenEpisodes = 0;
      let missingEpisodes = 0;
      let unanalyzedEpisodes = 0;
      const expectedSeasonCounts = item.type === 'SHOW' ? tmdbSeasonCounts(item.metadata) : [];
      const expectedEpisodes = item.type === 'SHOW' ? expectedEpisodeTotal(item.metadata) : null;
      const requests = (requestsByMedia.get(`${item.tmdbId}:${item.type}`) ?? []).map((request) => ({
        id: request.id,
        status: request.status,
        season: request.season,
        episode: request.episode,
        requestedBy: request.profile
          ? {
              profileId: request.profile.id,
              profileName: request.profile.name,
              accountEmail: request.profile.user?.email ?? '',
            }
          : undefined,
      }));

      if (item.metadata == null) issues.push('TMDb metadata missing');

      if (item.type === 'MOVIE') {
        if (!item.filePath) {
          issues.push('No movie file');
        } else {
          fileExists = await resolveFilePath(item.filePath).then((p) => p !== null && pathExists(p));
          if (!fileExists) issues.push('Movie file missing on disk');
        }
        if (item.filePath && !item.mediaInfo) issues.push('Missing media analysis');
      }

      const episodes = await Promise.all(
        item.episodes.map(async (episode) => {
          let episodeFileExists: boolean | null = null;
          if (!episode.filePath) {
            missingEpisodes += 1;
          } else {
            episodeFileExists = await resolveFilePath(episode.filePath).then((p) => p !== null && pathExists(p));
            if (!episodeFileExists) brokenEpisodes += 1;
          }

          if (episode.filePath && !episode.mediaInfo) {
            unanalyzedEpisodes += 1;
          }

          return {
            id: episode.id,
            season: episode.season,
            episode: episode.episode,
            title: episode.title,
            overview: episode.overview,
            filePath: episode.filePath,
            available: episode.filePath != null,
            fileExists: episodeFileExists,
            analyzed: episode.mediaInfo != null,
            runtime: episode.runtime,
          };
        }),
      );

      if (item.type === 'SHOW') {
        if (item.episodes.length === 0) issues.push('No episodes in library');
        if (expectedEpisodes === null) issues.push('TMDb season metadata missing');
        if (expectedEpisodes !== null && item.episodes.length < expectedEpisodes) {
          issues.push(`${expectedEpisodes - item.episodes.length} episodes not synced from TMDb`);
        }
        if (missingEpisodes > 0) issues.push(`${missingEpisodes} episodes without files`);
        if (brokenEpisodes > 0) issues.push(`${brokenEpisodes} episode files missing on disk`);
        if (unanalyzedEpisodes > 0) issues.push(`${unanalyzedEpisodes} episodes missing analysis`);
      }

      const availableEpisodes = item.episodes.filter((episode) => episode.filePath != null).length;
      const unsyncedEpisodes =
        expectedEpisodes !== null ? Math.max(0, expectedEpisodes - item.episodes.length) : 0;
      const seasons = item.type === 'SHOW'
        ? buildSeasonCoverage(
            expectedSeasonCounts,
            item.episodes.map((episode, index) => ({
              season: episode.season,
              episode: episode.episode,
              filePath: episode.filePath,
              mediaInfo: episode.mediaInfo,
              fileExists: episodes[index]?.fileExists ?? null,
            })),
          )
        : undefined;

      const dtoItem: Omit<AdminLibraryItemDTO, 'acquisitionTargets'> = {
        id: item.id,
        tmdbId: item.tmdbId,
        type: item.type,
        title: item.title,
        year: item.year,
        posterPath: item.posterPath,
        addedAt: item.addedAt.toISOString(),
        available:
          item.type === 'MOVIE'
            ? item.filePath != null && fileExists !== false
            : availableEpisodes > 0 && brokenEpisodes === 0,
        fileExists,
        analyzed: item.type === 'MOVIE' ? item.mediaInfo != null : unanalyzedEpisodes === 0,
        episodeCount: item.episodes.length,
        expectedEpisodes,
        availableEpisodes,
        missingEpisodes: missingEpisodes + unsyncedEpisodes,
        brokenEpisodes,
        unanalyzedEpisodes,
        issues,
        seasons,
        episodes: item.type === 'SHOW' ? episodes : undefined,
        requests,
      };

      return {
        ...dtoItem,
        acquisitionTargets: buildAcquisitionTargets(dtoItem),
      };
    }),
  );

  const missingFiles = dtoItems.filter((item) => item.type === 'MOVIE' && !item.available).length;
  const missingAnalysis = dtoItems.filter((item) =>
    item.type === 'MOVIE' ? !item.analyzed && item.available : item.unanalyzedEpisodes > 0,
  ).length;
  const brokenFiles =
    dtoItems.filter((item) => item.type === 'MOVIE' && item.fileExists === false).length +
    dtoItems.reduce((sum, item) => sum + item.brokenEpisodes, 0);
  const unavailableEpisodes = dtoItems.reduce((sum, item) => sum + item.missingEpisodes, 0);

  return {
    summary: {
      items: dtoItems.length,
      movies: dtoItems.filter((item) => item.type === 'MOVIE').length,
      shows: dtoItems.filter((item) => item.type === 'SHOW').length,
      availableItems: dtoItems.filter((item) => item.available).length,
      missingFiles,
      missingAnalysis,
      brokenFiles,
      unavailableEpisodes,
    },
    items: dtoItems,
  };
}

export async function syncShowEpisodes(
  mediaItemId: string,
  options: { season?: number } = {},
): Promise<AdminEpisodeSyncResultDTO> {
  const item = await prisma.mediaItem.findUnique({
    where: { id: mediaItemId },
    include: { episodes: { select: { season: true, episode: true } } },
  });

  if (!item) {
    throw ApiError.notFound(`Media item ${mediaItemId} not found`);
  }
  if (item.type !== 'SHOW') {
    throw ApiError.badRequest('Episode sync is only available for TV shows', 'NOT_A_SHOW');
  }

  const detail = await getTmdbDetail('SHOW', item.tmdbId);
  const seasons = detail.seasons?.filter((season) => season.season > 0) ?? [];
  const targetSeasons = options.season
    ? seasons.filter((season) => season.season === options.season)
    : seasons;

  if (options.season && targetSeasons.length === 0) {
    throw ApiError.badRequest(`Season ${options.season} was not found on TMDb`, 'SEASON_NOT_FOUND');
  }

  const existing = new Set(item.episodes.map((episode) => `${episode.season}:${episode.episode}`));

  let episodes = 0;
  let created = 0;
  let updated = 0;

  for (const season of targetSeasons) {
    const seasonEpisodes = await getTmdbSeasonEpisodes(item.tmdbId, season.season);
    for (const episode of seasonEpisodes) {
      episodes += 1;
      const key = `${season.season}:${episode.episodeNumber}`;
      if (existing.has(key)) updated += 1;
      else created += 1;

      await prisma.episode.upsert({
        where: {
          mediaItemId_season_episode: {
            mediaItemId: item.id,
            season: season.season,
            episode: episode.episodeNumber,
          },
        },
        create: {
          mediaItemId: item.id,
          season: season.season,
          episode: episode.episodeNumber,
          title: episode.name,
          overview: episode.overview,
          runtime: episode.runtime,
        },
        update: {
          title: episode.name,
          overview: episode.overview,
          runtime: episode.runtime,
        },
      });
    }
  }

  await prisma.mediaItem.update({
    where: { id: item.id },
    data: {
      title: detail.title,
      year: detail.year,
      overview: detail.overview,
      posterPath: detail.posterPath,
      backdropPath: detail.backdropPath,
      genres: detail.genres,
      metadata: detail as any,
    },
  });

  return {
    mediaItemId: item.id,
    seasons: targetSeasons.length,
    episodes,
    created,
    updated,
  };
}

export async function syncMissingShowEpisodes(): Promise<AdminBulkEpisodeSyncResultDTO> {
  const shows = await prisma.mediaItem.findMany({
    where: { type: 'SHOW' },
    select: {
      id: true,
      metadata: true,
      _count: { select: { episodes: true } },
    },
  });

  const targets = shows.filter((show) => {
    const expected = expectedEpisodeTotal(show.metadata);
    return expected === null || show._count.episodes < expected;
  });

  const result: AdminBulkEpisodeSyncResultDTO = {
    shows: targets.length,
    seasons: 0,
    episodes: 0,
    created: 0,
    updated: 0,
    failed: 0,
  };

  for (const show of targets) {
    try {
      const synced = await syncShowEpisodes(show.id);
      result.seasons += synced.seasons;
      result.episodes += synced.episodes;
      result.created += synced.created;
      result.updated += synced.updated;
    } catch (err) {
      result.failed += 1;
      console.error(`[Admin] Episode sync failed for ${show.id}:`, err);
    }
  }

  return result;
}

export async function analyzeLibraryItem(
  mediaItemId: string,
  options: { missingOnly?: boolean } = {},
): Promise<AdminMediaAnalyzeResultDTO> {
  const item = await prisma.mediaItem.findUnique({
    where: { id: mediaItemId },
    include: {
      mediaInfo: { select: { id: true } },
      episodes: {
        orderBy: [{ season: 'asc' }, { episode: 'asc' }],
        include: { mediaInfo: { select: { id: true } } },
      },
    },
  });

  if (!item) {
    throw ApiError.notFound(`Media item ${mediaItemId} not found`);
  }

  let analyzed = 0;
  let skipped = 0;
  let failed = 0;

  const analyzeOne = async (
    filePath: string | null,
    target: { mediaItemId: string } | { episodeId: string },
    alreadyAnalyzed: boolean,
  ) => {
    if (options.missingOnly && alreadyAnalyzed) {
      skipped += 1;
      return;
    }
    if (!filePath) {
      skipped += 1;
      return;
    }

    const resolved = await resolveFilePath(filePath);
    if (!resolved) {
      skipped += 1;
      return;
    }

    try {
      await analyzeMediaAsset(resolved, target);
      analyzed += 1;
    } catch (err) {
      failed += 1;
      console.error(`[Admin] Media analysis failed for ${resolved}:`, err);
    }
  };

  if (item.type === 'MOVIE') {
    await analyzeOne(item.filePath, { mediaItemId: item.id }, item.mediaInfo != null);
  } else {
    for (const episode of item.episodes) {
      await analyzeOne(episode.filePath, { episodeId: episode.id }, episode.mediaInfo != null);
    }
  }

  return {
    mediaItemId: item.id,
    analyzed,
    skipped,
    failed,
  };
}

export async function clearMissingLibraryFile(
  mediaItemId: string,
): Promise<AdminLibraryRepairResultDTO> {
  const item = await prisma.mediaItem.findUnique({
    where: { id: mediaItemId },
    select: { id: true, type: true, filePath: true },
  });

  if (!item) {
    throw ApiError.notFound(`Media item ${mediaItemId} not found`);
  }
  if (item.type !== 'MOVIE') {
    throw ApiError.badRequest('Movie file repair is only available for movies', 'NOT_A_MOVIE');
  }
  if (!item.filePath) {
    return { mediaItemId: item.id, episodeId: null, cleared: false };
  }

  const resolved = await resolveFilePath(item.filePath);
  if (resolved && await pathExists(resolved)) {
    throw ApiError.badRequest('The referenced movie file still exists on disk', 'FILE_STILL_EXISTS');
  }

  await prisma.$transaction([
    prisma.mediaStream.deleteMany({ where: { mediaItemId: item.id } }),
    prisma.mediaInfo.deleteMany({ where: { mediaItemId: item.id } }),
    prisma.mediaItem.update({
      where: { id: item.id },
      data: { filePath: null },
    }),
  ]);

  return { mediaItemId: item.id, episodeId: null, cleared: true };
}

export async function clearMissingEpisodeFile(
  episodeId: string,
): Promise<AdminLibraryRepairResultDTO> {
  const episode = await prisma.episode.findUnique({
    where: { id: episodeId },
    select: { id: true, mediaItemId: true, filePath: true },
  });

  if (!episode) {
    throw ApiError.notFound(`Episode ${episodeId} not found`);
  }
  if (!episode.filePath) {
    return { mediaItemId: episode.mediaItemId, episodeId: episode.id, cleared: false };
  }

  const resolved = await resolveFilePath(episode.filePath);
  if (resolved && await pathExists(resolved)) {
    throw ApiError.badRequest('The referenced episode file still exists on disk', 'FILE_STILL_EXISTS');
  }

  await prisma.$transaction([
    prisma.mediaStream.deleteMany({ where: { episodeId: episode.id } }),
    prisma.mediaInfo.deleteMany({ where: { episodeId: episode.id } }),
    prisma.episode.update({
      where: { id: episode.id },
      data: { filePath: null },
    }),
  ]);

  return { mediaItemId: episode.mediaItemId, episodeId: episode.id, cleared: true };
}

export async function deleteLibraryMediaItem(
  mediaItemId: string,
): Promise<AdminMediaDeleteResultDTO> {
  const item = await prisma.mediaItem.findUnique({
    where: { id: mediaItemId },
    include: {
      episodes: {
        select: {
          id: true,
          filePath: true,
        },
      },
    },
  });

  if (!item) {
    throw ApiError.notFound(`Media item ${mediaItemId} not found`);
  }

  const prepared = await buildDeletableFileList([
    item.filePath,
    ...item.episodes.map((episode) => episode.filePath),
  ]);

  await prisma.$transaction([
    prisma.torrent.updateMany({
      where: { mediaItemId: item.id },
      data: { mediaItemId: null },
    }),
    prisma.mediaItem.delete({ where: { id: item.id } }),
  ]);

  const deleted = await deletePreparedFiles(prepared.files);
  clearDirectorySizeCache();

  return {
    mediaItemId: item.id,
    episodeId: null,
    deletedRecords: 1 + item.episodes.length,
    deletedFiles: deleted.deletedFiles,
    deletedBytes: deleted.deletedBytes,
    skippedFiles: [...prepared.skippedFiles, ...deleted.skippedFiles],
  };
}

export async function deleteLibraryEpisode(
  episodeId: string,
): Promise<AdminMediaDeleteResultDTO> {
  const episode = await prisma.episode.findUnique({
    where: { id: episodeId },
    select: {
      id: true,
      mediaItemId: true,
      filePath: true,
    },
  });

  if (!episode) {
    throw ApiError.notFound(`Episode ${episodeId} not found`);
  }

  const prepared = await buildDeletableFileList([episode.filePath]);
  await prisma.episode.delete({ where: { id: episode.id } });
  const deleted = await deletePreparedFiles(prepared.files);
  clearDirectorySizeCache();

  return {
    mediaItemId: episode.mediaItemId,
    episodeId: episode.id,
    deletedRecords: 1,
    deletedFiles: deleted.deletedFiles,
    deletedBytes: deleted.deletedBytes,
    skippedFiles: [...prepared.skippedFiles, ...deleted.skippedFiles],
  };
}

export async function deleteLibrarySeason(
  mediaItemId: string,
  season: number,
): Promise<AdminMediaDeleteResultDTO> {
  const item = await prisma.mediaItem.findUnique({
    where: { id: mediaItemId },
    select: {
      id: true,
      type: true,
      episodes: {
        where: { season },
        select: { id: true, filePath: true },
      },
    },
  });

  if (!item) {
    throw ApiError.notFound(`Media item ${mediaItemId} not found`);
  }
  if (item.type !== 'SHOW') {
    throw ApiError.badRequest('Season deletion only applies to shows', 'NOT_A_SHOW');
  }

  const prepared = await buildDeletableFileList(item.episodes.map((episode) => episode.filePath));
  if (item.episodes.length > 0) {
    await prisma.episode.deleteMany({
      where: {
        mediaItemId: item.id,
        season,
      },
    });
  }
  const deleted = await deletePreparedFiles(prepared.files);
  clearDirectorySizeCache();

  return {
    mediaItemId: item.id,
    episodeId: null,
    deletedRecords: item.episodes.length,
    deletedFiles: deleted.deletedFiles,
    deletedBytes: deleted.deletedBytes,
    skippedFiles: [...prepared.skippedFiles, ...deleted.skippedFiles],
  };
}

export async function pruneTranscodeCache(
  maxAgeSeconds = 30 * 60,
): Promise<AdminStorageCleanupResultDTO> {
  const root = path.resolve(config.TRANSCODE_ROOT);
  const entries = await fs.readdir(root, { withFileTypes: true }).catch(() => []);
  const cutoff = Date.now() - Math.max(0, maxAgeSeconds) * 1000;
  let deletedEntries = 0;
  let deletedBytes = 0;
  const skippedEntries: string[] = [];

  for (const entry of entries) {
    const entryPath = safeJoin(root, entry.name);
    try {
      const stat = await fs.stat(entryPath);
      if (maxAgeSeconds > 0 && stat.mtimeMs > cutoff) {
        skippedEntries.push(entry.name);
        continue;
      }
      const bytes = entry.isDirectory() ? await directorySize(entryPath) : stat.size;
      await fs.rm(entryPath, { recursive: true, force: true });
      deletedEntries += 1;
      deletedBytes += bytes;
    } catch {
      skippedEntries.push(entry.name);
    }
  }

  clearDirectorySizeCache();

  return {
    root,
    maxAgeSeconds,
    scannedEntries: entries.length,
    deletedEntries,
    deletedBytes,
    skippedEntries,
  };
}

export async function analyzeMissingLibraryMedia(): Promise<AdminBulkMediaAnalyzeResultDTO> {
  const items = await prisma.mediaItem.findMany({
    orderBy: [{ type: 'asc' }, { title: 'asc' }],
    include: {
      mediaInfo: { select: { id: true } },
      episodes: {
        include: { mediaInfo: { select: { id: true } } },
      },
    },
  });

  const targets = items.filter((item) => {
    if (item.type === 'MOVIE') return item.filePath != null && item.mediaInfo == null;
    return item.episodes.some((episode) => episode.filePath != null && episode.mediaInfo == null);
  });

  const result: AdminBulkMediaAnalyzeResultDTO = {
    items: targets.length,
    analyzed: 0,
    skipped: 0,
    failed: 0,
  };

  for (const item of targets) {
    const analyzed = await analyzeLibraryItem(item.id, { missingOnly: true });
    result.analyzed += analyzed.analyzed;
    result.skipped += analyzed.skipped;
    result.failed += analyzed.failed;
  }

  return result;
}
