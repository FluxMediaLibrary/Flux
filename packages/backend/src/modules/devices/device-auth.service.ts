/**
 * Device link ("enter this code on the web") for TV clients such as Roku.
 *
 * Flow:
 *   1. TV: POST /api/auth/device        → { deviceCode, userCode, verificationUrl, pollInterval, expiresIn }
 *   2. Person on the web (/link): POST /api/auth/device/approve { userCode }
 *   3. TV polls POST /api/auth/device/status { deviceCode }
 *        → { state: 'pending' | 'slow_down' | 'approved' | 'denied' | 'expired', ... }
 *      On approval the TV receives a short-lived access token (a normal
 *      account JWT that also carries the device session id) and an opaque
 *      refresh token.
 *   4. TV: POST /api/auth/refresh { refreshToken, deviceId } rotates both.
 *      POST /api/auth/logout { refreshToken } revokes the device session.
 *
 * Security notes: device codes and refresh tokens are random 256-bit values
 * stored only as SHA-256 hashes; user codes avoid ambiguous characters and are
 * rate-limited on approval; approvals must come from a signed-in web session;
 * access tokens are short-lived and are rejected the moment the device session
 * is revoked (checked by the auth plugin).
 */
import { createHash, randomBytes, randomInt } from 'node:crypto';
import type { DeviceSession, User } from '@prisma/client';
import { ADMIN_PERMISSIONS, type AccountDTO, type DeviceLinkStartDTO, type DeviceLinkStatusDTO, type DeviceTokenPairDTO, type LinkedDeviceDTO, type PendingDeviceLinkDTO } from '@flux/shared';
import { prisma } from '../../lib/db.js';
import { ApiError } from '../../lib/errors.js';
import { signToken } from '../../lib/jwt.js';
import { getServerSettings } from '../settings/settings.service.js';

const DEVICE_CODE_TTL_MS = 10 * 60 * 1000;
const DEVICE_SESSION_TTL_MS = 90 * 24 * 60 * 60 * 1000;
const ACCESS_TOKEN_TTL = '12h';
const POLL_INTERVAL_SECONDS = 5;
/** Alphabet without 0/O/1/I so codes are unambiguous on a TV screen. */
const USER_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function randomToken(): string {
  return randomBytes(32).toString('base64url');
}

function generateUserCode(): string {
  let code = '';
  for (let i = 0; i < 8; i += 1) code += USER_CODE_ALPHABET[randomInt(USER_CODE_ALPHABET.length)];
  return `${code.slice(0, 4)}-${code.slice(4)}`;
}

export function normalizeUserCode(input: string): string {
  const raw = input.toUpperCase().replace(/[^A-Z0-9]/g, '');
  return raw.length === 8 ? `${raw.slice(0, 4)}-${raw.slice(4)}` : raw;
}

function accountDTO(user: User): AccountDTO {
  return {
    id: user.id,
    email: user.email,
    role: user.role,
    permissions: user.role === 'ADMIN' ? [...ADMIN_PERMISSIONS] : (user.permissions as AccountDTO['permissions']),
    createdAt: user.createdAt.toISOString(),
  };
}

export interface StartDeviceLinkInput {
  deviceId: string;
  deviceName: string;
  platform: string;
  appVersion: string;
}

export async function startDeviceLink(input: StartDeviceLinkInput): Promise<DeviceLinkStartDTO> {
  const settings = await getServerSettings();
  const deviceCode = randomToken();
  const expiresAt = new Date(Date.now() + DEVICE_CODE_TTL_MS);

  // Retry on the (astronomically rare) user-code collision.
  let userCode = generateUserCode();
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const clash = await prisma.deviceAuthorization.findUnique({ where: { userCode }, select: { id: true, expiresAt: true } });
    if (!clash) break;
    if (clash.expiresAt.getTime() < Date.now()) {
      await prisma.deviceAuthorization.delete({ where: { id: clash.id } }).catch(() => undefined);
      break;
    }
    userCode = generateUserCode();
  }

  await prisma.deviceAuthorization.create({
    data: {
      deviceCodeHash: sha256(deviceCode),
      userCode,
      deviceId: input.deviceId,
      deviceName: input.deviceName,
      platform: input.platform,
      appVersion: input.appVersion,
      pollIntervalSeconds: POLL_INTERVAL_SECONDS,
      expiresAt,
    },
  });

  const verificationUrl = `${settings.frontendUrl.replace(/\/+$/, '')}/link`;
  return {
    deviceCode,
    userCode,
    verificationUrl,
    verificationUrlComplete: `${verificationUrl}?code=${encodeURIComponent(userCode)}`,
    expiresIn: Math.floor(DEVICE_CODE_TTL_MS / 1000),
    pollInterval: POLL_INTERVAL_SECONDS,
  };
}

async function issueTokens(session: DeviceSession, user: User): Promise<DeviceTokenPairDTO> {
  const refreshToken = randomToken();
  const updated = await prisma.deviceSession.update({
    where: { id: session.id },
    data: {
      refreshTokenHash: sha256(refreshToken),
      refreshVersion: { increment: 1 },
      lastSeenAt: new Date(),
      expiresAt: new Date(Date.now() + DEVICE_SESSION_TTL_MS),
    },
  });
  const accessToken = signToken(
    {
      sub: user.id,
      role: user.role,
      ...(updated.activeProfileId ? { activeProfileId: updated.activeProfileId } : {}),
      deviceSessionId: updated.id,
    },
    ACCESS_TOKEN_TTL,
  );
  return { accessToken, refreshToken, expiresIn: 12 * 3600 };
}

/** TV polling endpoint. */
export async function pollDeviceLink(deviceCode: string): Promise<DeviceLinkStatusDTO> {
  const row = await prisma.deviceAuthorization.findUnique({ where: { deviceCodeHash: sha256(deviceCode) } });
  if (!row) return { state: 'expired' };

  // Enforce the advertised interval: a client that polls too fast is told to
  // back off instead of being served.
  const now = Date.now();
  if (row.lastPolledAt && now - row.lastPolledAt.getTime() < (row.pollIntervalSeconds - 1) * 1000) {
    await prisma.deviceAuthorization.update({ where: { id: row.id }, data: { lastPolledAt: new Date(now), pollIntervalSeconds: Math.min(30, row.pollIntervalSeconds + 2) } });
    return { state: 'slow_down', pollInterval: Math.min(30, row.pollIntervalSeconds + 2) };
  }
  await prisma.deviceAuthorization.update({ where: { id: row.id }, data: { lastPolledAt: new Date(now) } });

  if (row.expiresAt.getTime() < now && row.status === 'PENDING') {
    await prisma.deviceAuthorization.delete({ where: { id: row.id } }).catch(() => undefined);
    return { state: 'expired' };
  }
  if (row.status === 'PENDING') return { state: 'pending', pollInterval: row.pollIntervalSeconds };
  if (row.status === 'DENIED') {
    await prisma.deviceAuthorization.delete({ where: { id: row.id } }).catch(() => undefined);
    return { state: 'denied' };
  }
  if (row.status !== 'APPROVED' || !row.approvedById) return { state: 'expired' };

  const user = await prisma.user.findUnique({ where: { id: row.approvedById } });
  if (!user || user.disabled) {
    await prisma.deviceAuthorization.delete({ where: { id: row.id } }).catch(() => undefined);
    return { state: 'denied' };
  }

  // One device session per (user, device). Re-linking the same TV replaces
  // the old refresh token instead of accumulating sessions.
  const session = await prisma.deviceSession.upsert({
    where: { userId_deviceId: { userId: user.id, deviceId: row.deviceId } },
    create: {
      userId: user.id,
      deviceId: row.deviceId,
      deviceName: row.deviceName,
      platform: row.platform,
      appVersion: row.appVersion,
      refreshTokenHash: sha256(randomToken()),
      expiresAt: new Date(now + DEVICE_SESSION_TTL_MS),
    },
    update: {
      deviceName: row.deviceName,
      appVersion: row.appVersion,
      revokedAt: null,
      revokedReason: null,
      activeProfileId: null,
    },
  });
  // Consume the authorization so the code cannot be replayed.
  await prisma.deviceAuthorization.delete({ where: { id: row.id } }).catch(() => undefined);

  const tokens = await issueTokens(session, user);
  return { state: 'approved', ...tokens, account: accountDTO(user) };
}

/** Web side: what the person is about to approve. */
export async function describePendingLink(userCode: string): Promise<PendingDeviceLinkDTO> {
  const row = await prisma.deviceAuthorization.findUnique({ where: { userCode: normalizeUserCode(userCode) } });
  if (!row || row.status !== 'PENDING' || row.expiresAt.getTime() < Date.now()) {
    throw ApiError.notFound('That code is not valid or has expired. Ask the TV for a new one.', 'DEVICE_CODE_INVALID');
  }
  return {
    userCode: row.userCode,
    deviceName: row.deviceName,
    platform: row.platform,
    appVersion: row.appVersion,
    expiresAt: row.expiresAt.toISOString(),
  };
}

export async function approveDeviceLink(userCode: string, approverId: string): Promise<PendingDeviceLinkDTO> {
  const pending = await describePendingLink(userCode);
  const result = await prisma.deviceAuthorization.updateMany({
    where: { userCode: pending.userCode, status: 'PENDING' },
    data: { status: 'APPROVED', approvedById: approverId, approvedAt: new Date() },
  });
  if (result.count !== 1) throw ApiError.conflict('That code was already used.', 'DEVICE_CODE_USED');
  return pending;
}

export async function denyDeviceLink(userCode: string): Promise<void> {
  await prisma.deviceAuthorization.updateMany({
    where: { userCode: normalizeUserCode(userCode), status: 'PENDING' },
    data: { status: 'DENIED' },
  });
}

export async function refreshDeviceSession(refreshToken: string, deviceId: string): Promise<DeviceTokenPairDTO> {
  const session = await prisma.deviceSession.findUnique({ where: { refreshTokenHash: sha256(refreshToken) }, include: { user: true } });
  if (!session || session.revokedAt || session.expiresAt.getTime() < Date.now() || session.deviceId !== deviceId) {
    throw ApiError.unauthorized('This device is no longer linked. Link it again.', 'DEVICE_SESSION_INVALID');
  }
  if (session.user.disabled) throw ApiError.forbidden('This account is disabled', 'ACCOUNT_DISABLED');
  return issueTokens(session, session.user);
}

export async function revokeDeviceSessionByRefreshToken(refreshToken: string, reason = 'logout'): Promise<void> {
  await prisma.deviceSession.updateMany({
    where: { refreshTokenHash: sha256(refreshToken), revokedAt: null },
    data: { revokedAt: new Date(), revokedReason: reason },
  });
}

export async function revokeDeviceSession(id: string, actorId: string, actorIsAdmin: boolean, reason = 'revoked'): Promise<void> {
  const session = await prisma.deviceSession.findUnique({ where: { id }, select: { userId: true } });
  if (!session) throw ApiError.notFound('Device not found');
  if (session.userId !== actorId && !actorIsAdmin) throw ApiError.forbidden('You can only remove your own devices');
  await prisma.deviceSession.update({ where: { id }, data: { revokedAt: new Date(), revokedReason: reason } });
}

/** Update the profile a device is using; returns fresh tokens carrying it. */
export async function selectDeviceProfile(sessionId: string, profileId: string): Promise<DeviceTokenPairDTO> {
  const session = await prisma.deviceSession.findUnique({ where: { id: sessionId }, include: { user: true } });
  if (!session || session.revokedAt) throw ApiError.unauthorized('This device is no longer linked.', 'DEVICE_SESSION_INVALID');
  const profile = await prisma.profile.findFirst({ where: { id: profileId, userId: session.userId }, select: { id: true } });
  if (!profile) throw ApiError.notFound('Profile not found');
  const updated = await prisma.deviceSession.update({ where: { id: sessionId }, data: { activeProfileId: profile.id } });
  return issueTokens(updated, session.user);
}

/** Auth plugin hook: a revoked or expired device session must not keep working. */
export async function isDeviceSessionActive(sessionId: string): Promise<boolean> {
  const session = await prisma.deviceSession.findUnique({ where: { id: sessionId }, select: { revokedAt: true, expiresAt: true } });
  if (!session || session.revokedAt || session.expiresAt.getTime() < Date.now()) return false;
  // Cheap liveness for the "devices" list; throttled to once a minute per session.
  prisma.deviceSession.updateMany({
    where: { id: sessionId, lastSeenAt: { lt: new Date(Date.now() - 60_000) } },
    data: { lastSeenAt: new Date() },
  }).catch(() => undefined);
  return true;
}

export async function listLinkedDevices(userId: string | null): Promise<LinkedDeviceDTO[]> {
  const rows = await prisma.deviceSession.findMany({
    where: { ...(userId ? { userId } : {}), revokedAt: null, expiresAt: { gt: new Date() } },
    include: { user: { select: { email: true } } },
    orderBy: { lastSeenAt: 'desc' },
  });
  return rows.map((row) => ({
    id: row.id,
    deviceName: row.deviceName,
    platform: row.platform,
    appVersion: row.appVersion,
    accountEmail: row.user.email,
    activeProfileId: row.activeProfileId,
    lastSeenAt: row.lastSeenAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
  }));
}
