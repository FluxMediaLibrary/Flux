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

export type SearchQuery = z.infer<typeof searchQuerySchema>;
export type DetailParams = z.infer<typeof detailParamsSchema>;
