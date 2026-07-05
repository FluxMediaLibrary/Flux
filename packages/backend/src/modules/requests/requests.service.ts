import type { RequestDTO, RequestStatus, MediaType } from '@flux/shared';
import type { Request } from '@prisma/client';
import { prisma } from '../../lib/db.js';
import { ApiError } from '../../lib/errors.js';
import type { CreateRequestInput } from './requests.schema.js';

// ─── Types ───────────────────────────────────────────────────────────────────

/** A Prisma Request row optionally joined with its profile and user. */
type RequestWithProfile = Request & {
  profile?: { id: string; name: string; user?: { email: string } | null } | null;
};

// ─── DTO mappers ─────────────────────────────────────────────────────────────

/** Map a plain Prisma Request row to the member-facing RequestDTO. */
export function mapRequestToDTO(row: Request): RequestDTO {
  return {
    id: row.id,
    tmdbId: row.tmdbId,
    mediaType: row.mediaType as MediaType,
    title: row.title,
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

  return dto;
}

// ─── Public API ──────────────────────────────────────────────────────────────

/** Create a new media request for the active profile. */
export async function createRequest(
  profileId: string,
  data: CreateRequestInput,
): Promise<RequestDTO> {
  const row = await prisma.request.create({
    data: {
      profileId,
      tmdbId: data.tmdbId,
      mediaType: data.mediaType,
      title: data.title,
      status: 'PENDING',
    },
  });

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

  const updated = await prisma.request.update({
    where: { id },
    data: { status: 'APPROVED' },
  });

  return mapRequestToDTO(updated);
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

  return mapRequestToDTO(updated);
}

/** Get a single request by id. */
export async function getRequest(id: string): Promise<RequestDTO> {
  const row = await prisma.request.findUnique({ where: { id } });
  if (!row) {
    throw ApiError.notFound(`Request ${id} not found`);
  }

  return mapRequestToDTO(row);
}
