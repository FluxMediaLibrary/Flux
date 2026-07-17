import fs from 'node:fs/promises';
import { ADMIN_PERMISSIONS, type AdminActivityEventDTO, type AdminOverviewDTO, type AdminPermission, type AdminPlaybackSessionDTO, type AdminSignalDTO, type AdminUserDTO, type UpdateAdminUserRequest } from '@flux/shared';
import { Prisma } from '@prisma/client';
import { config } from '../../config.js';
import { prisma } from '../../lib/db.js';
import { ApiError } from '../../lib/errors.js';
import { getAdminInfo } from './admin.service.js';

const ACTIVE_WINDOW_MS = 90_000;

function isAdminPermission(value: string): value is AdminPermission {
  return ADMIN_PERMISSIONS.includes(value as AdminPermission);
}

function safeDetails(details: Prisma.JsonValue | null): string | null {
  if (details == null) return null;
  if (typeof details === 'string') return details;
  try {
    return JSON.stringify(details);
  } catch {
    return null;
  }
}

export async function writeAuditEvent(input: {
  actorId?: string | null;
  action: string;
  targetType: string;
  targetId?: string | null;
  targetLabel?: string | null;
  result?: 'SUCCESS' | 'FAILURE' | 'INFO';
  details?: unknown;
}): Promise<void> {
  await prisma.auditEvent.create({
    data: {
      actorId: input.actorId ?? null,
      action: input.action,
      targetType: input.targetType,
      targetId: input.targetId ?? null,
      targetLabel: input.targetLabel ?? null,
      result: input.result ?? 'SUCCESS',
      details: input.details != null
        ? JSON.parse(JSON.stringify(input.details)) as Prisma.InputJsonValue
        : Prisma.JsonNull,
    },
  });
}

export async function getAdminActivity(limit = 40): Promise<AdminActivityEventDTO[]> {
  const rows = await prisma.auditEvent.findMany({
    orderBy: { createdAt: 'desc' },
    take: Math.min(200, Math.max(1, limit)),
    include: { actor: { select: { email: true } } },
  });
  return rows.map((row) => ({
    id: row.id,
    occurredAt: row.createdAt.toISOString(),
    actor: row.actor?.email ?? 'Flux',
    action: row.action,
    targetType: row.targetType,
    targetId: row.targetId,
    targetLabel: row.targetLabel,
    result: row.result === 'FAILURE' || row.result === 'INFO' ? row.result : 'SUCCESS',
    details: safeDetails(row.details),
  }));
}

export async function getAdminPlayback(limit = 12): Promise<AdminPlaybackSessionDTO[]> {
  const rows = await prisma.watchProgress.findMany({
    where: { positionSeconds: { gt: 0 } },
    orderBy: { updatedAt: 'desc' },
    take: Math.min(50, Math.max(1, limit)),
    include: {
      profile: { include: { user: { select: { email: true } } } },
      mediaItem: { select: { id: true, title: true } },
      episode: {
        select: {
          id: true,
          title: true,
          season: true,
          episode: true,
          mediaItem: { select: { id: true, title: true } },
        },
      },
    },
  });
  const activeCutoff = Date.now() - ACTIVE_WINDOW_MS;
  return rows.map((row) => {
    const show = row.episode?.mediaItem;
    const title = row.mediaItem?.title ?? show?.title ?? 'Unknown media';
    const subtitle = row.episode
      ? `S${String(row.episode.season).padStart(2, '0')} E${String(row.episode.episode).padStart(2, '0')}${row.episode.title ? ` · ${row.episode.title}` : ''}`
      : null;
    return {
      id: row.id,
      profileId: row.profileId,
      profileName: row.profile.name,
      accountEmail: row.profile.user.email,
      mediaItemId: row.mediaItemId ?? show?.id ?? null,
      episodeId: row.episodeId,
      title,
      subtitle,
      positionSeconds: row.positionSeconds,
      durationSeconds: row.durationSeconds,
      progress: row.durationSeconds && row.durationSeconds > 0
        ? Math.min(1, row.positionSeconds / row.durationSeconds)
        : null,
      updatedAt: row.updatedAt.toISOString(),
      state: row.updatedAt.getTime() >= activeCutoff ? 'ACTIVE' : 'RECENT',
    };
  });
}

async function storageUsage(): Promise<{ used: number | null; total: number | null; percent: number | null }> {
  try {
    const stats = await fs.statfs(config.MEDIA_ROOT);
    const total = stats.blocks * stats.bsize;
    const free = stats.bavail * stats.bsize;
    const used = Math.max(0, total - free);
    return { used, total, percent: total > 0 ? used / total : null };
  } catch {
    return { used: null, total: null, percent: null };
  }
}

export async function getAdminSignal(): Promise<AdminSignalDTO> {
  const activeCutoff = new Date(Date.now() - ACTIVE_WINDOW_MS);
  const [pendingRequests, activeDownloads, failedDownloads, missingMetadata, missingAnalysisMovies, missingAnalysisEpisodes, activeStreams, storage] = await Promise.all([
    prisma.request.count({ where: { status: 'PENDING' } }),
    prisma.torrent.count({ where: { status: { in: ['DOWNLOADING', 'PROCESSING'] } } }),
    prisma.torrent.count({ where: { status: 'ERROR' } }),
    prisma.mediaItem.count({ where: { metadata: { equals: Prisma.DbNull } } }),
    prisma.mediaItem.count({ where: { filePath: { not: null }, mediaInfo: null } }),
    prisma.episode.count({ where: { filePath: { not: null }, mediaInfo: null } }),
    prisma.watchProgress.count({ where: { updatedAt: { gte: activeCutoff }, positionSeconds: { gt: 0 } } }),
    storageUsage(),
  ]);
  const libraryIssues = missingMetadata + missingAnalysisMovies + missingAnalysisEpisodes;
  const storageCritical = storage.percent !== null && storage.percent >= 0.95;
  const storageWarning = storage.percent !== null && storage.percent >= 0.85;
  const status = failedDownloads > 0 || storageCritical
    ? 'UNHEALTHY'
    : pendingRequests > 0 || libraryIssues > 0 || storageWarning
      ? 'DEGRADED'
      : 'HEALTHY';
  return {
    generatedAt: new Date().toISOString(),
    status,
    counts: { pendingRequests, activeDownloads, failedDownloads, libraryIssues, activeStreams },
    storagePercent: storage.percent,
  };
}

export async function getAdminOverview(): Promise<AdminOverviewDTO> {
  const [info, signal, playback, activity, storage] = await Promise.all([
    getAdminInfo(),
    getAdminSignal(),
    getAdminPlayback(8),
    getAdminActivity(12),
    storageUsage(),
  ]);
  const attention: AdminOverviewDTO['attention'] = [];
  if (signal.counts.failedDownloads > 0) attention.push({
    id: 'failed-downloads', severity: 'CRITICAL', kind: 'DOWNLOAD_FAILED',
    title: 'Downloads need intervention',
    detail: `${signal.counts.failedDownloads} job${signal.counts.failedDownloads === 1 ? '' : 's'} failed with a retryable error.`,
    href: '/admin/downloads?status=ERROR', count: signal.counts.failedDownloads,
  });
  if (info.library.brokenFiles > 0) attention.push({
    id: 'broken-library', severity: 'CRITICAL', kind: 'LIBRARY_BROKEN',
    title: 'Library files are missing',
    detail: `${info.library.brokenFiles} catalog entr${info.library.brokenFiles === 1 ? 'y points' : 'ies point'} to a missing file.`,
    href: '/admin/library?issue=BROKEN', count: info.library.brokenFiles,
  });
  if (info.library.missingMetadata > 0) attention.push({
    id: 'missing-metadata', severity: 'WARNING', kind: 'METADATA_MISSING',
    title: 'Metadata is incomplete', detail: `${info.library.missingMetadata} title${info.library.missingMetadata === 1 ? '' : 's'} need metadata.`,
    href: '/admin/library?issue=METADATA', count: info.library.missingMetadata,
  });
  if (info.library.missingAnalysis > 0) attention.push({
    id: 'missing-analysis', severity: 'WARNING', kind: 'ANALYSIS_MISSING',
    title: 'Media analysis is incomplete', detail: `${info.library.missingAnalysis} file${info.library.missingAnalysis === 1 ? '' : 's'} have not been analyzed.`,
    href: '/admin/library?issue=ANALYSIS', count: info.library.missingAnalysis,
  });
  if (storage.percent !== null && storage.percent >= 0.85) attention.push({
    id: 'storage-capacity', severity: storage.percent >= 0.95 ? 'CRITICAL' : 'WARNING', kind: 'STORAGE_WARNING',
    title: 'Media storage is nearing capacity', detail: `${Math.round(storage.percent * 100)}% of the primary media volume is used.`,
    href: '/admin/storage', count: Math.round(storage.percent * 100),
  });
  if (signal.counts.pendingRequests > 0) attention.push({
    id: 'pending-requests', severity: 'INFO', kind: 'REQUEST_PENDING',
    title: 'Requests are waiting for review', detail: `${signal.counts.pendingRequests} request${signal.counts.pendingRequests === 1 ? '' : 's'} are pending.`,
    href: '/admin/requests?status=PENDING', count: signal.counts.pendingRequests,
  });
  return {
    generatedAt: new Date().toISOString(),
    signal,
    stats: {
      mediaItems: info.database.mediaItems,
      users: info.database.users,
      pendingRequests: signal.counts.pendingRequests,
      activeDownloads: signal.counts.activeDownloads,
      failedJobs: signal.counts.failedDownloads,
      activeStreams: signal.counts.activeStreams,
      storageUsedBytes: storage.used,
      storageTotalBytes: storage.total,
    },
    playback,
    attention,
    activity,
  };
}

export async function listAdminUsers(): Promise<AdminUserDTO[]> {
  const activeCutoff = new Date(Date.now() - ACTIVE_WINDOW_MS);
  const users = await prisma.user.findMany({
    orderBy: { createdAt: 'asc' },
    include: {
      profiles: {
        select: {
          id: true, name: true, avatar: true,
          _count: { select: { requests: true } },
          watchProgress: { orderBy: { updatedAt: 'desc' }, take: 1, select: { updatedAt: true } },
        },
      },
    },
  });
  return Promise.all(users.map(async (user) => {
    const profileIds = user.profiles.map((profile) => profile.id);
    const currentStreamCount = profileIds.length === 0 ? 0 : await prisma.watchProgress.count({
      where: { profileId: { in: profileIds }, updatedAt: { gte: activeCutoff }, positionSeconds: { gt: 0 } },
    });
    const lastActive = user.profiles.flatMap((profile) => profile.watchProgress).map((row) => row.updatedAt).sort((a, b) => b.getTime() - a.getTime())[0] ?? null;
    return {
      id: user.id,
      email: user.email,
      role: user.role,
      permissions: (user.role === 'ADMIN' ? ADMIN_PERMISSIONS : user.permissions.filter(isAdminPermission)) as AdminPermission[],
      disabled: user.disabled,
      requestLimit: user.requestLimit,
      streamLimit: user.streamLimit,
      profiles: user.profiles.map(({ id, name, avatar }) => ({ id, name, avatar })),
      requestCount: user.profiles.reduce((sum, profile) => sum + profile._count.requests, 0),
      currentStreamCount,
      lastActiveAt: lastActive?.toISOString() ?? null,
      createdAt: user.createdAt.toISOString(),
    };
  }));
}

export async function updateAdminUser(actorId: string, userId: string, input: UpdateAdminUserRequest): Promise<AdminUserDTO> {
  if (actorId === userId && (input.disabled || input.role === 'MEMBER')) {
    throw ApiError.badRequest('You cannot disable or demote your own active account', 'SELF_LOCKOUT');
  }
  const existing = await prisma.user.findUnique({ where: { id: userId } });
  if (!existing) throw ApiError.notFound(`User ${userId} not found`);
  if (existing.role === 'ADMIN' && input.role === 'MEMBER') {
    const admins = await prisma.user.count({ where: { role: 'ADMIN', disabled: false } });
    if (admins <= 1) throw ApiError.badRequest('Flux must keep at least one active administrator', 'LAST_ADMIN');
  }
  const permissions = input.permissions?.filter((permission, index, all) => isAdminPermission(permission) && all.indexOf(permission) === index);
  await prisma.user.update({
    where: { id: userId },
    data: {
      role: input.role,
      disabled: input.disabled,
      permissions,
      requestLimit: input.requestLimit,
      streamLimit: input.streamLimit,
    },
  });
  await writeAuditEvent({ actorId, action: 'USER_UPDATED', targetType: 'USER', targetId: userId, targetLabel: existing.email, details: input });
  const users = await listAdminUsers();
  return users.find((user) => user.id === userId)!;
}
