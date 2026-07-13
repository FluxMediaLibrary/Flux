/** Zod input schema for torrent confirm. */
import { z } from 'zod';

export const confirmBodySchema = z.object({
  infoHash: z.string().min(1, 'infoHash is required'),
  category: z.enum(['MOVIE', 'SHOW']),
  tmdbId: z.number().int().positive('tmdbId must be a positive integer'),
  title: z.string().min(1, 'title is required'),
  year: z.number().int().positive().nullable(),
  fileMapping: z
    .array(
      z.object({
        path: z.string().min(1),
        season: z.number().int().positive('season must be greater than 0'),
        episode: z.number().int().positive('episode must be greater than 0'),
      }),
    )
    .optional(),
  requestId: z.string().optional(),
});

export type ConfirmTorrentInput = z.infer<typeof confirmBodySchema>;
