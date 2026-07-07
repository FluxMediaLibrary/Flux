/**
 * Admin info aggregator — collects system, storage, database, torrent, and
 * request stats for the admin dashboard. Admin-only at the route layer.
 */
import * as os from 'node:os';
import { prisma } from '../../lib/db.js';
import { config } from '../../config.js';
import type { AdminInfoDTO } from '@flux/shared';
import type { TorrentStatus, RequestStatus } from '@flux/shared';
import type { IntroJobsDTO } from '@flux/shared';
import { introDetectionQueue } from '../../jobs/queues.js';

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
  const storage: AdminInfoDTO['storage'] = {
    mediaRoot: config.MEDIA_ROOT,
    downloadRoot: config.DOWNLOAD_ROOT,
    transcodeRoot: config.TRANSCODE_ROOT,
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
    torrents,
    requests,
    errors,
  };
}

/** Query BullMQ for intro detection job status. */
export async function getIntroJobs(): Promise<IntroJobsDTO> {
  const [activeJobs, waitingCount, completedJobs, failedJobs] = await Promise.all([
    introDetectionQueue.getActive(),
    introDetectionQueue.getWaitingCount(),
    introDetectionQueue.getCompleted(0, 5),
    introDetectionQueue.getFailed(0, 5),
  ]);

  // Build a quick lookup of show titles from active/waiting job data
  const mediaIds = new Set<string>();
  for (const j of activeJobs) {
    if (j.data?.mediaItemId) mediaIds.add(j.data.mediaItemId);
  }

  const titleMap = new Map<string, string>();
  if (mediaIds.size > 0) {
    const items = await prisma.mediaItem.findMany({
      where: { id: { in: Array.from(mediaIds) } },
      select: { id: true, title: true },
    });
    for (const item of items) {
      titleMap.set(item.id, item.title);
    }
  }

  const active: IntroJobsDTO['active'] = activeJobs.map((j) => ({
    id: j.id ?? '',
    mediaItemId: j.data?.mediaItemId ?? '',
    season: j.data?.season ?? 0,
    state: 'active',
    progress: j.progress as number | undefined,
    showTitle: j.data?.mediaItemId ? titleMap.get(j.data.mediaItemId) : undefined,
  }));

  const recent: IntroJobsDTO['recent'] = [];

  for (const j of [...completedJobs, ...failedJobs].slice(0, 5)) {
    const isFailed = j.failedReason != null;
    recent.push({
      id: j.id ?? '',
      mediaItemId: j.data?.mediaItemId ?? '',
      season: j.data?.season ?? 0,
      state: isFailed ? 'failed' : 'completed',
      finishedAt: j.finishedOn ? new Date(j.finishedOn).toISOString() : undefined,
      failedReason: j.failedReason ?? undefined,
    });
  }

  return { active, waiting: waitingCount, recent };
}
