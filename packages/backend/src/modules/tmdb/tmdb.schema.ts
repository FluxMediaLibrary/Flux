/** Zod input schemas for the TMDb proxy module. */
import { z } from 'zod';

/** Search query. `type` narrows movie/tv; omitted/`all` = multi search. */
export const searchQuerySchema = z.object({
  q: z.string().min(1, 'Query "q" is required').max(200),
  type: z
    .enum(['movie', 'show', 'tv', 'all', 'multi'])
    .optional()
    .default('all'),
});

/** Path params for detail lookup. */
export const detailParamsSchema = z.object({
  mediaType: z.enum(['movie', 'show', 'tv']),
  tmdbId: z.coerce.number().int().positive(),
});

/** A media type that maps 1:1 to a TMDb segment (no multi/all). */
const discoverMediaType = z.enum(['movie', 'tv', 'show']).default('movie');

/** Trending feed query: media type + optional day|week window. */
export const trendingQuerySchema = z.object({
  type: discoverMediaType,
  window: z.enum(['day', 'week']).optional().default('week'),
});

/** Popular feed query: media type + optional page. */
export const popularQuerySchema = z.object({
  type: discoverMediaType,
  page: z.coerce.number().int().positive().max(500).optional().default(1),
});

/** Genre list query: media type only. */
export const genresQuerySchema = z.object({
  type: discoverMediaType,
});

/** Discover query: media type + optional genre id + optional page. */
export const discoverQuerySchema = z.object({
  type: discoverMediaType,
  genre: z.coerce.number().int().positive().optional(),
  page: z.coerce.number().int().positive().max(500).optional().default(1),
});

export type SearchQuery = z.infer<typeof searchQuerySchema>;
export type DetailParams = z.infer<typeof detailParamsSchema>;
export type TrendingQuery = z.infer<typeof trendingQuerySchema>;
export type PopularQuery = z.infer<typeof popularQuerySchema>;
export type GenresQuery = z.infer<typeof genresQuerySchema>;
export type DiscoverQuery = z.infer<typeof discoverQuerySchema>;
