import { z } from 'zod';

export const createRequestSchema = z.object({
  tmdbId: z.number().int().positive(),
  mediaType: z.enum(['MOVIE', 'SHOW']),
  title: z.string().min(1).max(500),
});

export type CreateRequestInput = z.infer<typeof createRequestSchema>;
