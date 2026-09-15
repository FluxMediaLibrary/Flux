/**
 * Lightweight media item reads for list surfaces.
 *
 * `media_items.metadata` holds the entire cached TMDb payload (cast, crew,
 * similar titles, reviews…) — tens of kilobytes per row. Grid and row
 * endpoints only need three scalars out of it, so listing the library through
 * `prisma.mediaItem.findMany` moved megabytes per request for large
 * libraries. This helper projects those scalars in SQL and never loads the
 * JSON document.
 */
import { Prisma } from '@prisma/client';
import type { MediaItemDTO, MediaType } from '@flux/shared';
import { prisma } from './db.js';

export interface MediaItemLite {
  id: string;
  tmdbId: number;
  type: MediaType;
  title: string;
  year: number | null;
  overview: string | null;
  posterPath: string | null;
  backdropPath: string | null;
  genres: string[];
  filePath: string | null;
  addedAt: Date;
  runtimeMinutes: number | null;
  contentRating: string | null;
  rating: number | null;
}

interface RawRow {
  id: string;
  tmdbId: number;
  type: MediaType;
  title: string;
  year: number | null;
  overview: string | null;
  posterPath: string | null;
  backdropPath: string | null;
  genres: string[];
  filePath: string | null;
  addedAt: Date;
  runtimeMinutes: number | string | null;
  contentRating: string | null;
  rating: number | string | null;
}

const COLUMNS = Prisma.sql`
  "id", "tmdbId", "type", "title", "year", "overview", "posterPath", "backdropPath",
  "genres", "filePath", "addedAt",
  NULLIF(metadata->>'runtime', '')::int AS "runtimeMinutes",
  COALESCE(NULLIF(metadata->>'ageRating', ''), NULLIF(metadata->>'certification', '')) AS "contentRating",
  COALESCE(NULLIF(metadata->>'voteAverage', ''), NULLIF(metadata->>'vote_average', ''))::float AS "rating"
`;

function toNumber(value: number | string | null): number | null {
  if (value === null || value === undefined) return null;
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export interface LiteQuery {
  type?: MediaType;
  ids?: string[];
  /** Only rows with at least one genre (home-page discovery pool). */
  withGenresOnly?: boolean;
  orderBy?: 'title' | 'addedAt';
  take?: number;
}

export async function findMediaItemsLite(query: LiteQuery = {}): Promise<MediaItemLite[]> {
  const where: Prisma.Sql[] = [];
  if (query.type) where.push(Prisma.sql`"type" = ${query.type}::"MediaType"`);
  if (query.ids) {
    if (query.ids.length === 0) return [];
    where.push(Prisma.sql`"id" IN (${Prisma.join(query.ids)})`);
  }
  if (query.withGenresOnly) where.push(Prisma.sql`cardinality("genres") > 0`);
  const whereSql = where.length ? Prisma.sql`WHERE ${Prisma.join(where, ' AND ')}` : Prisma.empty;
  const orderSql = query.orderBy === 'addedAt' ? Prisma.sql`ORDER BY "addedAt" DESC` : Prisma.sql`ORDER BY "title" ASC`;
  const limitSql = query.take ? Prisma.sql`LIMIT ${query.take}` : Prisma.empty;
  const rows = await prisma.$queryRaw<RawRow[]>`SELECT ${COLUMNS} FROM "media_items" ${whereSql} ${orderSql} ${limitSql}`;
  return rows.map((row) => ({
    ...row,
    addedAt: new Date(row.addedAt),
    runtimeMinutes: toNumber(row.runtimeMinutes),
    rating: toNumber(row.rating),
  }));
}

export function liteToDTO(row: MediaItemLite): MediaItemDTO {
  return {
    id: row.id,
    tmdbId: row.tmdbId,
    type: row.type,
    title: row.title,
    year: row.year,
    overview: row.overview,
    posterPath: row.posterPath,
    backdropPath: row.backdropPath,
    genres: row.genres,
    runtimeMinutes: row.runtimeMinutes,
    contentRating: row.contentRating,
    rating: row.rating,
    addedAt: row.addedAt.toISOString(),
  };
}
