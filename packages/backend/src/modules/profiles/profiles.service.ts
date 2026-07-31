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
import { prisma } from '../../lib/db.js';
import { signToken } from '../../lib/jwt.js';
import { ApiError } from '../../lib/errors.js';
import { toProfileDTO } from '../auth/auth.service.js';
import type { CreateProfileInput, UpdateProfileInput } from './profiles.schema.js';

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
  return toProfileDTO(profile);
}

export async function updateProfile(
  accountId: string,
  profileId: string,
  input: UpdateProfileInput,
): Promise<ProfileDTO> {
  await getOwnedProfile(accountId, profileId);
  const profile = await prisma.profile.update({
    where: { id: profileId },
    data: {
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.avatar !== undefined ? { avatar: input.avatar } : {}),
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
): Promise<void> {
  await getOwnedProfile(accountId, profileId);

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
): Promise<ActivateProfileResponse> {
  const profile = await getOwnedProfile(accountId, profileId);
  const token = signToken({
    sub: accountId,
    role: accountRole,
    activeProfileId: profile.id,
  });
  return { token, profile: toProfileDTO(profile) };
}
