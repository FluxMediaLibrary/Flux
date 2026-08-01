/**
 * Invites service (ADMIN only at the route layer). Generates single-use,
 * expiring invite codes and builds the signup URL from FRONTEND_ORIGIN.
 */
import { randomBytes } from 'node:crypto';
import type { InviteDTO } from '@flux/shared';
import type { Invite } from '@prisma/client';
import { prisma } from '../../lib/db.js';
import { getServerSettings } from '../settings/settings.service.js';
import type { CreateInviteInput } from './invites.schema.js';

/** URL-safe, unambiguous invite code. */
function generateCode(): string {
  // 24 bytes → 32-char base64url; strip padding.
  return randomBytes(24).toString('base64url');
}

async function buildInviteUrl(code: string): Promise<string> {
  const base = (await getServerSettings()).frontendUrl.replace(/\/+$/, '');
  return `${base}/signup?invite=${encodeURIComponent(code)}`;
}

export async function toInviteDTO(invite: Invite): Promise<InviteDTO> {
  return {
    id: invite.id,
    code: invite.code,
    url: await buildInviteUrl(invite.code),
    expiresAt: invite.expiresAt.toISOString(),
    usedAt: invite.usedAt ? invite.usedAt.toISOString() : null,
    createdAt: invite.createdAt.toISOString(),
  };
}

export async function createInvite(
  adminAccountId: string,
  input: CreateInviteInput,
): Promise<InviteDTO> {
  const hours = input.expiresInHours ?? (await getServerSettings()).defaultInviteExpiryHours;
  const expiresAt = new Date(Date.now() + hours * 60 * 60 * 1000);

  const invite = await prisma.invite.create({
    data: {
      code: generateCode(),
      expiresAt,
      createdById: adminAccountId,
    },
  });
  return toInviteDTO(invite);
}

export async function listInvites(): Promise<InviteDTO[]> {
  const invites = await prisma.invite.findMany({
    orderBy: { createdAt: 'desc' },
  });
  return Promise.all(invites.map(toInviteDTO));
}
