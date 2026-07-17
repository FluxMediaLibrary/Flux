import type {
  AdminRequestFulfillmentSyncResultDTO,
  RequestDTO,
  RequestStatus,
  MediaType,
} from '@flux/shared';
import type { Request, Torrent } from '@prisma/client';
import { prisma } from '../../lib/db.js';
import { ApiError } from '../../lib/errors.js';
import { notifyNewRequest } from '../notifications/notify.js';
import type { CreateRequestInput } from './requests.schema.js';

// ─── Types ───────────────────────────────────────────────────────────────────

/** A Prisma Request row optionally joined with its profile and user. */
type RequestWithProfile = Request & {
  profile?: { id: string; name: string; user?: { email: string } | null } | null;
  torrent?: Torrent | null;
};

// ─── DTO mappers ─────────────────────────────────────────────────────────────

/** Map a plain Prisma Request row to the member-facing RequestDTO. */
export function mapRequestToDTO(row: Request): RequestDTO {
  return {
    id: row.id,
    tmdbId: row.tmdbId,
    mediaType: row.mediaType as MediaType,
    title: row.title,
    season: row.season,
    episode: row.episode,
    status: row.status as RequestStatus,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/**
 * Map a Prisma Request row (optionally including profile with user) to the
 * admin-facing RequestDTO.  The caller controls whether the profile relation
 * is included — if present, `requestedBy` is populated; otherwise it is
 * left undefined.
 */
export function mapRequestToAdminDTO(row: RequestWithProfile): RequestDTO {
  const dto: RequestDTO = {
    id: row.id,
    tmdbId: row.tmdbId,
    mediaType: row.mediaType as MediaType,
    title: row.title,
    season: row.season,
    episode: row.episode,
    status: row.status as RequestStatus,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };

  if (row.profile) {
    dto.requestedBy = {
      profileId: row.profile.id,
      profileName: row.profile.name,
      accountEmail: row.profile.user?.email ?? '',
    };
  }

  if (row.torrent) {
    dto.torrent = {
      id: row.torrent.id,
      name: row.torrent.name,
      status: row.torrent.status,
      progress: row.torrent.progress,
      errorMessage: row.torrent.errorMessage,
    };
  }

  return dto;
}

// ─── Public API ──────────────────────────────────────────────────────────────

async function getAdminRequestDTO(id: string): Promise<RequestDTO> {
  const row = await prisma.request.findUnique({
    where: { id },
    include: {
      profile: {
        select: {
          id: true,
          name: true,
          user: { select: { email: true } },
        },
      },
      torrent: true,
    },
  });
  if (!row) {
    throw ApiError.notFound(`Request ${id} not found`);
  }
  return mapRequestToAdminDTO(row);
}

async function hasPlayableLibraryItem(
  tmdbId: number,
  mediaType: MediaType,
  target?: { season: number | null; episode: number | null },
): Promise<boolean> {
  const item = await prisma.mediaItem.findUnique({
    where: { tmdbId_type: { tmdbId, type: mediaType } },
    select: {
      filePath: true,
      episodes: {
        where:
          mediaType === 'SHOW' && target?.season
            ? {
                season: target.season,
                ...(target.episode ? { episode: target.episode } : {}),
                filePath: { not: null },
              }
            : { filePath: { not: null } },
        select: { id: true },
        take: 1,
      },
    },
  });

  if (!item) return false;
  return mediaType === 'MOVIE' ? item.filePath != null : item.episodes.length > 0;
}

/** Create a new media request for the active profile. */
export async function createRequest(
  profileId: string,
  data: CreateRequestInput,
): Promise<RequestDTO> {
  const requester = await prisma.profile.findUnique({
    where: { id: profileId },
    select: { userId: true, user: { select: { disabled: true, requestLimit: true } } },
  });
  if (!requester || requester.user.disabled) {
    throw ApiError.forbidden('This account cannot submit requests', 'ACCOUNT_DISABLED');
  }
  if (requester.user.requestLimit !== null) {
    const now = new Date();
    const periodStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const used = await prisma.request.count({
      where: { profile: { userId: requester.userId }, createdAt: { gte: periodStart } },
    });
    if (used >= requester.user.requestLimit) {
      throw ApiError.forbidden('Monthly request limit reached', 'REQUEST_LIMIT_REACHED');
    }
  }
  const target = {
    season: data.mediaType === 'SHOW' ? data.season ?? null : null,
    episode: data.mediaType === 'SHOW' && data.season ? data.episode ?? null : null,
  };
  const existing = await prisma.request.findFirst({
    where: {
      profileId,
      tmdbId: data.tmdbId,
      mediaType: data.mediaType,
      season: target.season,
      episode: target.episode,
      status: { in: ['PENDING', 'APPROVED', 'DOWNLOADING', 'FULFILLED'] },
    },
    orderBy: { createdAt: 'desc' },
  });
  if (existing) {
    return mapRequestToDTO(existing);
  }

  const fulfilled = await hasPlayableLibraryItem(data.tmdbId, data.mediaType, target);
  const row = await prisma.request.create({
    data: {
      profileId,
      tmdbId: data.tmdbId,
      mediaType: data.mediaType,
      title: data.title,
      season: target.season,
      episode: target.episode,
      status: fulfilled ? 'FULFILLED' : 'PENDING',
    },
  });

  if (row.status === 'PENDING') {
    void notifyNewRequest(row.id);
  }

  return mapRequestToDTO(row);
}

/** List requests belonging to a specific profile (member view). */
export async function listMyRequests(profileId: string): Promise<RequestDTO[]> {
  const rows = await prisma.request.findMany({
    where: { profileId },
    orderBy: { createdAt: 'desc' },
  });

  return rows.map(mapRequestToDTO);
}

/** List every request in the system (admin view) with requester info. */
export async function listAllRequests(): Promise<RequestDTO[]> {
  const rows = await prisma.request.findMany({
    include: {
      profile: {
        select: {
          id: true,
          name: true,
          user: { select: { email: true } },
        },
      },
      torrent: true,
    },
    orderBy: { createdAt: 'desc' },
  });

  return rows.map(mapRequestToAdminDTO);
}

/** Approve a pending request by id. */
export async function approveRequest(id: string): Promise<RequestDTO> {
  const existing = await prisma.request.findUnique({ where: { id } });
  if (!existing) {
    throw ApiError.notFound(`Request ${id} not found`);
  }

  const fulfilled = await hasPlayableLibraryItem(
    existing.tmdbId,
    existing.mediaType as MediaType,
    { season: existing.season, episode: existing.episode },
  );
  const updated = await prisma.request.update({
    where: { id },
    data: { status: fulfilled ? 'FULFILLED' : 'APPROVED' },
  });

  return getAdminRequestDTO(updated.id);
}

/** Reject a pending request by id. */
export async function rejectRequest(id: string): Promise<RequestDTO> {
  const existing = await prisma.request.findUnique({ where: { id } });
  if (!existing) {
    throw ApiError.notFound(`Request ${id} not found`);
  }

  const updated = await prisma.request.update({
    where: { id },
    data: { status: 'REJECTED' },
  });

  return getAdminRequestDTO(updated.id);
}

/** Get a single request by id. */
export async function getRequest(id: string): Promise<RequestDTO> {
  const row = await prisma.request.findUnique({ where: { id } });
  if (!row) {
    throw ApiError.notFound(`Request ${id} not found`);
  }

  return mapRequestToDTO(row);
}

export async function syncFulfilledRequests(): Promise<AdminRequestFulfillmentSyncResultDTO> {
  const candidates = await prisma.request.findMany({
    where: { status: { in: ['PENDING', 'APPROVED', 'DOWNLOADING'] } },
    select: {
      id: true,
      tmdbId: true,
      mediaType: true,
      season: true,
      episode: true,
    },
  });

  let fulfilled = 0;
  for (const request of candidates) {
    if (!(
      await hasPlayableLibraryItem(
        request.tmdbId,
        request.mediaType as MediaType,
        { season: request.season, episode: request.episode },
      )
    )) {
      continue;
    }
    await prisma.request.update({
      where: { id: request.id },
      data: { status: 'FULFILLED' },
    });
    fulfilled += 1;
  }

  return {
    scanned: candidates.length,
    fulfilled,
  };
}
