import { z } from 'zod';

export const createRequestSchema = z.object({
  tmdbId: z.number().int().positive(),
  mediaType: z.enum(['MOVIE', 'SHOW']),
  title: z.string().min(1).max(500),
  season: z.number().int().positive().nullable().optional(),
  episode: z.number().int().positive().nullable().optional(),
}).superRefine((value, ctx) => {
  if (value.mediaType !== 'SHOW' && (value.season != null || value.episode != null)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['season'],
      message: 'Movies cannot include season or episode targets',
    });
  }
  if (value.mediaType === 'SHOW' && value.episode != null && value.season == null) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['episode'],
      message: 'Episode requests must include a season',
    });
  }
});

export type CreateRequestInput = z.infer<typeof createRequestSchema>;
