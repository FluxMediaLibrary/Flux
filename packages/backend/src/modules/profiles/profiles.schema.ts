/** Zod input schemas for the profiles module. */
import { z } from 'zod';
import { AVATAR_PRESET_IDS } from '@flux/shared';

/** An avatar is either one of the curated preset ids or omitted/cleared. */
const avatarSchema = z
  .enum(AVATAR_PRESET_IDS as [string, ...string[]])
  .describe('One of the premade avatar preset ids');

const pinSchema = z.string().regex(/^\d{4}$/, 'PIN must be exactly four digits');

export const createProfileSchema = z.object({
  name: z.string().min(1, 'Name is required').max(50).trim(),
  avatar: avatarSchema.optional(),
  pin: pinSchema.optional(),
});

export const updateProfileSchema = z
  .object({
    name: z.string().min(1, 'Name is required').max(50).trim().optional(),
    // `null` explicitly clears the avatar (falls back to initials).
    avatar: avatarSchema.nullable().optional(),
    pin: pinSchema.nullable().optional(),
    accountPassword: z.string().min(1).optional(),
  })
  .refine((v) => v.name !== undefined || v.avatar !== undefined || v.pin !== undefined, {
    message: 'Provide at least one field to update',
  })
  .refine((v) => v.pin === undefined || Boolean(v.accountPassword), {
    message: 'Account password is required to change a profile PIN',
    path: ['accountPassword'],
  });

export const activateProfileSchema = z.object({
  pin: pinSchema.optional(),
});

export const deleteProfileSchema = z.object({
  accountPassword: z.string().min(1).optional(),
});

export type CreateProfileInput = z.infer<typeof createProfileSchema>;
export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;
export type DeleteProfileInput = z.infer<typeof deleteProfileSchema>;
