/** Zod input schemas for the profiles module. */
import { z } from 'zod';

export const createProfileSchema = z.object({
  name: z.string().min(1, 'Name is required').max(50).trim(),
  avatar: z.string().max(500).trim().optional(),
});

export type CreateProfileInput = z.infer<typeof createProfileSchema>;
