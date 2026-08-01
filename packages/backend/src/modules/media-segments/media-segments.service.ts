/**
 * Media segment service - reusable episode markers (INTRO/RECAP/CREDITS/PREVIEW)
 * stored in media_segments. Manual rows are protected from automatic rescans.
 */
import { prisma } from '../../lib/db.js';
import { ApiError } from '../../lib/errors.js';
import type { MediaSegment, MediaSegmentSource, MediaSegmentType, Prisma } from '@prisma/client';
import type {
  CreateMediaSegmentRequest,
  MediaSegmentDTO,
  UpdateMediaSegmentRequest,
} from '@flux/shared';

export function mapMediaSegmentToDTO(row: MediaSegment): MediaSegmentDTO {
  return {
    id: row.id,
    episodeId: row.episodeId,
    type: row.type as MediaSegmentType,
    startMs: row.startMs,
    endMs: row.endMs,
    confidence: row.confidence,
    source: row.source as MediaSegmentSource,
  };
}

export interface ListSegmentsOptions {
  season?: number;
  episodeId?: string;
}

/**
 * List all segments of a media item's episodes (optionally filtered to a
 * season or single episode), ordered by episode then start time.
 */
export async function listMediaSegments(
  mediaItemId: string,
  options: ListSegmentsOptions = {},
): Promise<MediaSegmentDTO[]> {
  const item = await prisma.mediaItem.findUnique({
    where: { id: mediaItemId },
    select: { id: true, type: true },
  });
  if (!item) throw ApiError.notFound('Media item not found');

  const segments = await prisma.mediaSegment.findMany({
    where: {
      episode: {
        mediaItemId,
        ...(options.season !== undefined ? { season: options.season } : {}),
        ...(options.episodeId ? { id: options.episodeId } : {}),
      },
    },
    include: { episode: { select: { season: true, episode: true } } },
    orderBy: [
      { episode: { season: 'asc' } },
      { episode: { episode: 'asc' } },
      { startMs: 'asc' },
    ],
  });

  return segments.map(mapMediaSegmentToDTO);
}

/**
 * Manually set a segment for an episode (source=MANUAL). Replaces any existing
 * segment of the same type, including automatic ones, so the admin's value is
 * the source of truth until a forced rescan replaces it.
 */
export async function createManualSegment(
  episodeId: string,
  input: CreateMediaSegmentRequest,
): Promise<MediaSegmentDTO> {
  const episode = await prisma.episode.findUnique({
    where: { id: episodeId },
    select: { id: true },
  });
  if (!episode) throw ApiError.notFound('Episode not found');
  validateRange(input.startMs, input.endMs);

  const row = await prisma.$transaction(async (tx) => {
    await tx.mediaSegment.deleteMany({
      where: { episodeId, type: input.type },
    });
    return tx.mediaSegment.create({
      data: {
        episodeId,
        type: input.type,
        startMs: input.startMs,
        endMs: input.endMs,
        confidence: clampConfidence(input.confidence ?? 1),
        source: 'MANUAL',
      },
    });
  });

  return mapMediaSegmentToDTO(row);
}

/**
 * Edit an existing segment. Any admin edit promotes the row to MANUAL so a
 * later automatic rescan cannot silently overwrite the admin's adjustment.
 */
export async function updateSegment(
  segmentId: string,
  input: UpdateMediaSegmentRequest,
): Promise<MediaSegmentDTO> {
  const existing = await prisma.mediaSegment.findUnique({
    where: { id: segmentId },
  });
  if (!existing) throw ApiError.notFound('Segment not found');

  const next: {
    type?: MediaSegmentType;
    startMs?: number;
    endMs?: number;
    confidence?: number;
  } = {};
  if (input.type !== undefined) next.type = input.type;
  if (input.startMs !== undefined) next.startMs = input.startMs;
  if (input.endMs !== undefined) next.endMs = input.endMs;
  if (input.confidence !== undefined) next.confidence = clampConfidence(input.confidence);
  validateRange(next.startMs ?? existing.startMs, next.endMs ?? existing.endMs);

  const data: Prisma.MediaSegmentUpdateInput = {
    ...next,
    source: 'MANUAL',
  };
  const updated = await prisma.mediaSegment.update({
    where: { id: segmentId },
    data,
  });
  return mapMediaSegmentToDTO(updated);
}

export async function deleteSegment(segmentId: string): Promise<void> {
  const existing = await prisma.mediaSegment.findUnique({
    where: { id: segmentId },
    select: { id: true },
  });
  if (!existing) throw ApiError.notFound('Segment not found');
  await prisma.mediaSegment.delete({ where: { id: segmentId } });
}

function validateRange(startMs: number, endMs: number): void {
  if (!Number.isInteger(startMs) || !Number.isInteger(endMs) || startMs < 0 || endMs <= startMs) {
    throw ApiError.badRequest(
      'Segment timestamps must be whole milliseconds with endMs greater than startMs',
      'INVALID_SEGMENT_RANGE',
    );
  }
}

function clampConfidence(value: number): number {
  if (!Number.isFinite(value)) return 1;
  return Math.min(1, Math.max(0, value));
}
