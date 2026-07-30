/**
 * Profiles service — all operations scoped to the authenticated account.
 * A profile belongs to a User (account). Activating a profile mints a new JWT
 * that carries `activeProfileId`.
 */
import type {
  ProfileDTO,
  ActivateProfileResponse,
  Role,
} from '@flux/shared';
import type { Profile } from '@prisma/client';
import argon2 from 'argon2';
import { prisma } from '../../lib/db.js';
import { signToken } from '../../lib/jwt.js';
import { ApiError } from '../../lib/errors.js';
import { toProfileDTO } from '../auth/auth.service.js';
import type { CreateProfileInput, DeleteProfileInput, UpdateProfileInput } from './profiles.schema.js';

export async function listProfiles(accountId: string): Promise<ProfileDTO[]> {
  const profiles = await prisma.profile.findMany({
    where: { userId: accountId },
    orderBy: { createdAt: 'asc' },
  });
  return profiles.map(toProfileDTO);
}

export async function createProfile(
  accountId: string,
  input: CreateProfileInput,
): Promise<ProfileDTO> {
  const profile = await prisma.profile.create({
    data: {
      userId: accountId,
      name: input.name,
      avatar: input.avatar ?? null,
    },
  });
  if (!input.pin) return toProfileDTO(profile);
  const pinHash = await hashProfilePin(profile.id, input.pin);
  const protectedProfile = await prisma.profile.update({
    where: { id: profile.id },
    data: { pinHash },
  });
  return toProfileDTO(protectedProfile);
}

export async function updateProfile(
  accountId: string,
  profileId: string,
  input: UpdateProfileInput,
): Promise<ProfileDTO> {
  await getOwnedProfile(accountId, profileId);
  if (input.pin !== undefined) {
    await verifyAccountPassword(accountId, input.accountPassword);
  }
  const profile = await prisma.profile.update({
    where: { id: profileId },
    data: {
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.avatar !== undefined ? { avatar: input.avatar } : {}),
      ...(input.pin !== undefined
        ? {
            pinHash: input.pin === null ? null : await hashProfilePin(profileId, input.pin),
            pinFailedAttempts: 0,
            pinLockedUntil: null,
          }
        : {}),
    },
  });
  return toProfileDTO(profile);
}

async function getOwnedProfile(
  accountId: string,
  profileId: string,
): Promise<Profile> {
  const profile = await prisma.profile.findUnique({ where: { id: profileId } });
  if (!profile || profile.userId !== accountId) {
    // Do not distinguish "not found" from "not yours" to avoid enumeration.
    throw ApiError.notFound('Profile not found');
  }
  return profile;
}

export async function deleteProfile(
  accountId: string,
  profileId: string,
  input: DeleteProfileInput,
): Promise<void> {
  const profile = await getOwnedProfile(accountId, profileId);
  if (profile.pinHash) {
    await verifyAccountPassword(accountId, input.accountPassword);
  }

  const count = await prisma.profile.count({ where: { userId: accountId } });
  if (count <= 1) {
    throw ApiError.badRequest(
      'Cannot delete the only profile on an account',
      'LAST_PROFILE',
    );
  }
  await prisma.profile.delete({ where: { id: profileId } });
}

export async function activateProfile(
  accountId: string,
  accountRole: Role,
  profileId: string,
  pin?: string,
): Promise<ActivateProfileResponse> {
  const profile = await getOwnedProfile(accountId, profileId);
  await verifyProfilePin(profile, pin);
  const token = signToken({
    sub: accountId,
    role: accountRole,
    activeProfileId: profile.id,
  });
  return { token, profile: toProfileDTO(profile) };
}

const PIN_MAX_ATTEMPTS = 5;
const PIN_LOCK_MS = 15 * 60 * 1000;

function hashProfilePin(profileId: string, pin: string): Promise<string> {
  return argon2.hash(`${profileId}:${pin}`, { type: argon2.argon2id });
}

async function verifyAccountPassword(accountId: string, password: string | undefined): Promise<void> {
  if (!password) {
    throw ApiError.forbidden('Enter the account password to manage this profile PIN', 'ACCOUNT_PASSWORD_REQUIRED');
  }
  const account = await prisma.user.findUnique({
    where: { id: accountId },
    select: { passwordHash: true },
  });
  const valid = account
    ? await argon2.verify(account.passwordHash, password).catch(() => false)
    : false;
  if (!valid) {
    throw ApiError.forbidden('Incorrect account password', 'ACCOUNT_PASSWORD_INVALID');
  }
}

async function verifyProfilePin(profile: Profile, pin: string | undefined): Promise<void> {
  if (!profile.pinHash) return;
  if (profile.pinLockedUntil && profile.pinLockedUntil.getTime() > Date.now()) {
    throw ApiError.tooManyRequests('Too many incorrect PIN attempts. Try again later.', 'PROFILE_PIN_LOCKED');
  }
  if (!pin) {
    throw ApiError.forbidden('Enter this profile PIN to continue', 'PROFILE_PIN_REQUIRED');
  }

  const valid = await argon2.verify(profile.pinHash, `${profile.id}:${pin}`).catch(() => false);
  if (!valid) {
    await prisma.profile.update({
      where: { id: profile.id },
      data: { pinFailedAttempts: { increment: 1 } },
    });
    const failedProfile = await prisma.profile.findUniqueOrThrow({
      where: { id: profile.id },
      select: { pinFailedAttempts: true },
    });
    const locked = failedProfile.pinFailedAttempts >= PIN_MAX_ATTEMPTS;
    if (locked) {
      await prisma.profile.update({
        where: { id: profile.id },
        data: {
          pinFailedAttempts: 0,
          pinLockedUntil: new Date(Date.now() + PIN_LOCK_MS),
        },
      });
      throw ApiError.tooManyRequests('Too many incorrect PIN attempts. Try again in 15 minutes.', 'PROFILE_PIN_LOCKED');
    }
    throw ApiError.forbidden('Incorrect profile PIN', 'PROFILE_PIN_INVALID');
  }

  if (profile.pinFailedAttempts || profile.pinLockedUntil) {
    await prisma.profile.update({
      where: { id: profile.id },
      data: { pinFailedAttempts: 0, pinLockedUntil: null },
    });
  }
}
