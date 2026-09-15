import type {
  AdminRequestFulfillmentSyncResultDTO,
  RequestDTO,
  RequestStage,
  RequestStatus,
  MediaType,
} from '@flux/shared';
import type { Request, Torrent } from '@prisma/client';
import { prisma } from '../../lib/db.js';
import { ApiError } from '../../lib/errors.js';
import { notifyNewRequest } from '../notifications/notify.js';
import { getDetail as getTmdbDetail } from '../tmdb/tmdb.service.js';
import type { CreateRequestInput } from './requests.schema.js';

// ─── Types ───────────────────────────────────────────────────────────────────

/** A Prisma Request row optionally joined with its profile and user. */
type RequestWithProfile = Request & {
  profile?: { id: string; name: string; user?: { email: string } | null } | null;
  torrent?: Torrent | null;
};

type RequestMetadata = {
  year: number | null;
  posterPath: string | null;
  backdropPath: string | null;
  genres: string[];
};

// ─── DTO mappers ─────────────────────────────────────────────────────────────

/**
 * Collapse the stored request status and the linked acquisition job into the
 * single lifecycle members see. A failed torrent surfaces as FAILED with its
 * reason even while the request row still says APPROVED/DOWNLOADING, so users
 * are never left staring at "Downloading" for a job that died.
 */
export function deriveRequestStage(
  status: RequestStatus,
  torrent: Pick<Torrent, 'status' | 'progress' | 'errorMessage'> | null | undefined,
): { stage: RequestStage; progress: number | null; failureReason: string | null } {
  if (status === 'FULFILLED') return { stage: 'AVAILABLE', progress: null, failureReason: null };
  if (status === 'REJECTED') return { stage: 'REJECTED', progress: null, failureReason: null };
  if (torrent) {
    switch (torrent.status) {
      case 'ERROR':
        return { stage: 'FAILED', progress: torrent.progress, failureReason: torrent.errorMessage ?? 'The download failed.' };
      case 'DOWNLOADING':
        return { stage: 'DOWNLOADING', progress: torrent.progress, failureReason: null };
      case 'PROCESSING':
        return { stage: 'PROCESSING', progress: null, failureReason: null };
      case 'SEEDING':
      case 'STOPPED':
        // Import finished but fulfilment has not been recorded yet.
        return { stage: 'PROCESSING', progress: null, failureReason: null };
      default:
        break;
    }
  }
  if (status === 'DOWNLOADING') return { stage: 'DOWNLOADING', progress: torrent?.progress ?? null, failureReason: null };
  if (status === 'APPROVED') return { stage: 'APPROVED', progress: null, failureReason: null };
  return { stage: 'REQUESTED', progress: null, failureReason: null };
}

/** Map a Prisma Request row (optionally with its torrent) to the member-facing RequestDTO. */
export function mapRequestToDTO(row: Request & { torrent?: Torrent | null }, mediaItemId: string | null = null): RequestDTO {
  const lifecycle = deriveRequestStage(row.status as RequestStatus, row.torrent);
  return {
    id: row.id,
    tmdbId: row.tmdbId,
    mediaType: row.mediaType as MediaType,
    title: row.title,
    season: row.season,
    episode: row.episode,
    status: row.status as RequestStatus,
    ...lifecycle,
    mediaItemId,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** Resolve local library ids for a batch of requests (one query). */
async function mediaItemIdsFor(rows: { tmdbId: number; mediaType: string }[]): Promise<Map<string, string>> {
  if (rows.length === 0) return new Map();
  const items = await prisma.mediaItem.findMany({
    where: { OR: rows.map((row) => ({ tmdbId: row.tmdbId, type: row.mediaType as MediaType })) },
    select: { id: true, tmdbId: true, type: true },
  });
  return new Map(items.map((item) => [requestKey(item.tmdbId, item.type as MediaType), item.id]));
}

/**
 * Map a Prisma Request row (optionally including profile with user) to the
 * admin-facing RequestDTO.  The caller controls whether the profile relation
 * is included — if present, `requestedBy` is populated; otherwise it is
 * left undefined.
 */
export function mapRequestToAdminDTO(row: RequestWithProfile, mediaItemId: string | null = null): RequestDTO {
  const dto: RequestDTO = mapRequestToDTO(row, mediaItemId);

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

function requestKey(tmdbId: number, mediaType: MediaType): string {
  return `${tmdbId}:${mediaType}`;
}

async function getRequestMetadata(tmdbId: number, mediaType: MediaType): Promise<RequestMetadata> {
  const local = await prisma.mediaItem.findUnique({
    where: { tmdbId_type: { tmdbId, type: mediaType } },
    select: { year: true, posterPath: true, backdropPath: true, genres: true },
  });
  if (local) {
    return {
      year: local.year,
      posterPath: local.posterPath,
      backdropPath: local.backdropPath,
      genres: local.genres,
    };
  }

  try {
    const detail = await getTmdbDetail(mediaType, tmdbId);
    return {
      year: detail.year,
      posterPath: detail.posterPath,
      backdropPath: detail.backdropPath,
      genres: detail.genres,
    };
  } catch {
    return { year: null, posterPath: null, backdropPath: null, genres: [] };
  }
}

function applyMetadata(dto: RequestDTO, metadata: RequestMetadata | undefined): RequestDTO {
  if (!metadata) return { ...dto, genres: dto.genres ?? [] };
  return {
    ...dto,
    year: metadata.year,
    posterPath: metadata.posterPath,
    backdropPath: metadata.backdropPath,
    genres: metadata.genres,
  };
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
  const mediaIds = await mediaItemIdsFor([row]);
  const dto = mapRequestToAdminDTO(row, mediaIds.get(requestKey(row.tmdbId, row.mediaType as MediaType)) ?? null);
  const metadata = await getRequestMetadata(dto.tmdbId, dto.mediaType);
  return applyMetadata(dto, metadata);
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
    const mediaIds = await mediaItemIdsFor([existing]);
    return mapRequestToDTO(existing, mediaIds.get(requestKey(existing.tmdbId, existing.mediaType as MediaType)) ?? null);
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

  const mediaIds = fulfilled ? await mediaItemIdsFor([row]) : new Map<string, string>();
  return mapRequestToDTO(row, mediaIds.get(requestKey(row.tmdbId, row.mediaType as MediaType)) ?? null);
}

/** List requests belonging to a specific profile (member view). */
export async function listMyRequests(profileId: string): Promise<RequestDTO[]> {
  const rows = await prisma.request.findMany({
    where: { profileId },
    orderBy: { createdAt: 'desc' },
    include: { torrent: true },
  });
  const mediaIds = await mediaItemIdsFor(rows);
  const dtos = rows.map((row) => mapRequestToDTO(row, mediaIds.get(requestKey(row.tmdbId, row.mediaType as MediaType)) ?? null));
  // Artwork for the member's own rows (home rail, title pages). Cached in the
  // TMDb layer, so repeated loads are cheap.
  const metadataEntries = await Promise.all(
    Array.from(new Map(dtos.map((dto) => [requestKey(dto.tmdbId, dto.mediaType), dto])).values())
      .map(async (dto) => [requestKey(dto.tmdbId, dto.mediaType), await getRequestMetadata(dto.tmdbId, dto.mediaType)] as const),
  );
  const metadataByKey = new Map(metadataEntries);
  return dtos.map((dto) => applyMetadata(dto, metadataByKey.get(requestKey(dto.tmdbId, dto.mediaType))));
}

/**
 * A member may withdraw their own request while nothing has been acquired
 * for it yet. Once a download is running the admin owns the job.
 */
export async function cancelOwnRequest(profileId: string, id: string): Promise<void> {
  const row = await prisma.request.findUnique({ where: { id }, select: { profileId: true, status: true, torrentId: true } });
  if (!row || row.profileId !== profileId) throw ApiError.notFound('Request not found');
  if (row.status !== 'PENDING' && !(row.status === 'APPROVED' && !row.torrentId)) {
    throw ApiError.conflict('This request is already being fulfilled and can no longer be cancelled', 'REQUEST_IN_PROGRESS');
  }
  await prisma.request.delete({ where: { id } });
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

  const mediaIds = await mediaItemIdsFor(rows);
  const dtos = rows.map((row) => mapRequestToAdminDTO(row, mediaIds.get(requestKey(row.tmdbId, row.mediaType as MediaType)) ?? null));
  const metadataEntries = await Promise.all(
    Array.from(new Map(dtos.map((dto) => [requestKey(dto.tmdbId, dto.mediaType), dto])).values())
      .map(async (dto) => [
        requestKey(dto.tmdbId, dto.mediaType),
        await getRequestMetadata(dto.tmdbId, dto.mediaType),
      ] as const),
  );
  const metadataByKey = new Map(metadataEntries);
  return dtos.map((dto) => applyMetadata(dto, metadataByKey.get(requestKey(dto.tmdbId, dto.mediaType))));
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
  const row = await prisma.request.findUnique({ where: { id }, include: { torrent: true } });
  if (!row) {
    throw ApiError.notFound(`Request ${id} not found`);
  }
  const mediaIds = await mediaItemIdsFor([row]);
  return mapRequestToDTO(row, mediaIds.get(requestKey(row.tmdbId, row.mediaType as MediaType)) ?? null);
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
