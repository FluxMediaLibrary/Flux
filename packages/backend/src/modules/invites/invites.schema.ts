/** Zod input schema for invite creation. */
import { z } from 'zod';

export const createInviteSchema = z.object({
  // Hours until expiry. 1 hour .. 90 days. Defaults server-side to 72h.
  expiresInHours: z.number().int().positive().max(24 * 90).optional(),
});

export type CreateInviteInput = z.infer<typeof createInviteSchema>;
