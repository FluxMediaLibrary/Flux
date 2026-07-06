/** Zod input schemas for the profiles module. */
import { z } from 'zod';
import { AVATAR_PRESET_IDS } from '@flux/shared';

/** An avatar is either one of the curated preset ids or omitted/cleared. */
const avatarSchema = z
  .enum(AVATAR_PRESET_IDS as [string, ...string[]])
  .describe('One of the premade avatar preset ids');

export const createProfileSchema = z.object({
  name: z.string().min(1, 'Name is required').max(50).trim(),
  avatar: avatarSchema.optional(),
});

export const updateProfileSchema = z
  .object({
    name: z.string().min(1, 'Name is required').max(50).trim().optional(),
    // `null` explicitly clears the avatar (falls back to initials).
    avatar: avatarSchema.nullable().optional(),
  })
  .refine((v) => v.name !== undefined || v.avatar !== undefined, {
    message: 'Provide at least one field to update',
  });

export type CreateProfileInput = z.infer<typeof createProfileSchema>;
export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;
