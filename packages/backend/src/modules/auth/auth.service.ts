/**
 * Auth service — signup (invite-gated) and login.
 *
 * Domain rules (see AGENTS.md):
 *  - Signup requires a valid, unexpired, single-use invite code. On success the
 *    invite is marked used, a MEMBER account is created, plus a default Profile.
 *  - Passwords hashed with argon2.
 *  - Login returns an AuthResponse whose token has NO active profile yet.
 */
import argon2 from 'argon2';
import { ADMIN_PERMISSIONS, type AuthResponse, type AccountDTO, type ProfileDTO } from '@flux/shared';
import type { User, Profile } from '@prisma/client';
import { prisma } from '../../lib/db.js';
import { signToken } from '../../lib/jwt.js';
import { ApiError } from '../../lib/errors.js';
import type { SignupInput, LoginInput } from './auth.schema.js';

const ARGON_OPTS: argon2.Options = { type: argon2.argon2id };

export function toAccountDTO(user: User): AccountDTO {
  return {
    id: user.id,
    email: user.email,
    role: user.role,
    permissions: user.role === 'ADMIN' ? [...ADMIN_PERMISSIONS] : user.permissions as AccountDTO['permissions'],
    createdAt: user.createdAt.toISOString(),
  };
}

export function toProfileDTO(profile: Profile): ProfileDTO {
  return {
    id: profile.id,
    name: profile.name,
    avatar: profile.avatar,
    hasPin: Boolean(profile.pinHash),
    createdAt: profile.createdAt.toISOString(),
  };
}

export async function hashPassword(plain: string): Promise<string> {
  return argon2.hash(plain, ARGON_OPTS);
}

function buildAuthResponse(user: User, profiles: Profile[]): AuthResponse {
  const token = signToken({ sub: user.id, role: user.role });
  return {
    token,
    account: toAccountDTO(user),
    profiles: profiles.map(toProfileDTO),
  };
}

export async function signup(input: SignupInput): Promise<AuthResponse> {
  const invite = await prisma.invite.findUnique({
    where: { code: input.inviteCode },
  });
  if (!invite) {
    throw ApiError.badRequest('Invalid invite code', 'INVALID_INVITE');
  }
  if (invite.usedById || invite.usedAt) {
    throw ApiError.conflict('Invite code has already been used', 'INVITE_USED');
  }
  if (invite.expiresAt.getTime() <= Date.now()) {
    throw ApiError.badRequest('Invite code has expired', 'INVITE_EXPIRED');
  }

  const existing = await prisma.user.findUnique({
    where: { email: input.email },
  });
  if (existing) {
    throw ApiError.conflict('An account with this email already exists', 'EMAIL_TAKEN');
  }

  const passwordHash = await hashPassword(input.password);
  const defaultProfileName = input.email.split('@')[0] ?? 'Profile';

  // Create account + default profile and consume the invite atomically. The
  // invite is consumed with a guard so two concurrent signups can't reuse it.
  const { user, profiles } = await prisma.$transaction(async (tx) => {
    const consumed = await tx.invite.updateMany({
      where: { id: invite.id, usedById: null, usedAt: null },
      data: { usedAt: new Date() },
    });
    if (consumed.count !== 1) {
      throw ApiError.conflict('Invite code has already been used', 'INVITE_USED');
    }

    const createdUser = await tx.user.create({
      data: {
        email: input.email,
        passwordHash,
        role: 'MEMBER',
        profiles: { create: { name: defaultProfileName } },
      },
      include: { profiles: true },
    });

    await tx.invite.update({
      where: { id: invite.id },
      data: { usedById: createdUser.id },
    });

    const { profiles: createdProfiles, ...userOnly } = createdUser;
    return { user: userOnly as User, profiles: createdProfiles };
  });

  return buildAuthResponse(user, profiles);
}

export async function login(input: LoginInput): Promise<AuthResponse> {
  const user = await prisma.user.findUnique({
    where: { email: input.email },
    include: { profiles: { orderBy: { createdAt: 'asc' } } },
  });

  // Generic message + always-verify to reduce user enumeration / timing leaks.
  if (!user) {
    // Perform a dummy verify to keep timing roughly constant.
    await argon2.verify(
      '$argon2id$v=19$m=65536,t=3,p=4$c29tZXNhbHR2YWx1ZQ$3g2Z1Zt1x8a0J0YjZ9m0f0J0YjZ9m0f0J0YjZ9m0f0',
      input.password,
    ).catch(() => false);
    throw ApiError.unauthorized('Invalid email or password', 'INVALID_CREDENTIALS');
  }

  const ok = await argon2.verify(user.passwordHash, input.password).catch(() => false);
  if (!ok) {
    throw ApiError.unauthorized('Invalid email or password', 'INVALID_CREDENTIALS');
  }
  if (user.disabled) {
    throw ApiError.forbidden('This account has been disabled', 'ACCOUNT_DISABLED');
  }

  const { profiles, ...userOnly } = user;
  return buildAuthResponse(userOnly as User, profiles);
}
