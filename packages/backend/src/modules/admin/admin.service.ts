/**
 * Admin info aggregator — collects system, storage, database, torrent, and
 * request stats for the admin dashboard. Admin-only at the route layer.
 */
import * as os from 'node:os';
import fs from 'node:fs/promises';
import path from 'node:path';
import { prisma } from '../../lib/db.js';
import { config } from '../../config.js';
import { safeJoin } from '../../lib/media-paths.js';
import type { AdminInfoDTO } from '@flux/shared';
import type { TorrentStatus, RequestStatus } from '@flux/shared';

async function getStorageRoot(path: string): Promise<AdminInfoDTO['storage']['mediaRoot']> {
  try {
    const stats = await fs.statfs(path);
    const totalBytes = stats.blocks * stats.bsize;
    const freeBytes = stats.bavail * stats.bsize;
    return {
      path,
      exists: true,
      totalBytes,
      freeBytes,
      usedBytes: Math.max(0, totalBytes - freeBytes),
    };
  } catch {
    return {
      path,
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
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    const sizes = await Promise.all(
      entries.map(async (entry) => {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) return directorySize(fullPath);
        if (!entry.isFile()) return 0;
        const stat = await fs.stat(fullPath).catch(() => null);
        return stat?.size ?? 0;
      }),
    );
    return sizes.reduce((sum, value) => sum + value, 0);
  } catch {
    return 0;
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
  const [mediaRoot, downloadRoot, transcodeRoot] = await Promise.all([
    getStorageRoot(config.MEDIA_ROOT),
    getStorageRoot(config.DOWNLOAD_ROOT),
    getStorageRoot(config.TRANSCODE_ROOT),
  ]);

  const storage: AdminInfoDTO['storage'] = {
    mediaRoot,
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
      .map((item) => pathExists(safeJoin(config.MEDIA_ROOT, item.filePath!))),
    ...episodesForHealth
      .filter((episode) => episode.filePath)
      .map((episode) => pathExists(safeJoin(config.MEDIA_ROOT, episode.filePath!))),
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
