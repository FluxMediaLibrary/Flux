import { randomBytes, timingSafeEqual } from 'node:crypto';
import { Prisma } from '@prisma/client';
import type {
  ApproveDeviceAuthorizationRequest,
  CreateDeviceAuthorizationRequest,
  DeviceAuthorizationCreatedDTO,
  DeviceAuthorizationStatusDTO,
  DeviceSessionTokensDTO,
} from '@flux/shared';
import { prisma } from '../../lib/db.js';
import { config } from '../../config.js';
import { ApiError } from '../../lib/errors.js';
import { signDeviceToken } from '../../lib/jwt.js';
import { toAccountDTO, toProfileDTO } from './auth.service.js';
import { generateUserCode, hashOpaqueToken, isExpired, normalizeUserCode } from './device-auth.utils.js';

const ACCESS_TOKEN_TTL_SECONDS = 15 * 60;

function generateDeviceCode(): string {
  return randomBytes(32).toString('base64url');
}

function refreshToken(sessionId: string): string {
  return `${sessionId}.${randomBytes(48).toString('base64url')}`;
}

function refreshSessionId(token: string): string {
  const separator = token.indexOf('.');
  return separator > 0 ? token.slice(0, separator) : '';
}

function equalHash(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left, 'hex');
  const rightBuffer = Buffer.from(right, 'hex');
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

export async function createDeviceAuthorization(
  input: CreateDeviceAuthorizationRequest,
): Promise<DeviceAuthorizationCreatedDTO> {
  await prisma.deviceAuthorization.deleteMany({
    where: { expiresAt: { lt: new Date(Date.now() - 24 * 60 * 60 * 1000) } },
  });

  const deviceCode = generateDeviceCode();
  let record;
  for (let attempt = 0; attempt < 8; attempt += 1) {
    try {
      record = await prisma.deviceAuthorization.create({
        data: {
          deviceCodeHash: hashOpaqueToken(deviceCode),
          userCode: generateUserCode(),
          deviceId: input.deviceId,
          deviceName: input.deviceName,
          platform: input.platform,
          appVersion: input.appVersion,
          pollIntervalSeconds: config.DEVICE_POLL_INTERVAL_SECONDS,
          expiresAt: new Date(Date.now() + config.DEVICE_CODE_TTL_SECONDS * 1000),
        },
      });
      break;
    } catch (error: unknown) {
      if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002' || attempt === 7) throw error;
    }
  }
  if (!record) throw ApiError.internal('Could not create a device authorization', 'DEVICE_CODE_CREATE_FAILED');

  return {
    deviceCode,
    userCode: record.userCode,
    verificationUrl: new URL('/link', config.FRONTEND_ORIGIN).toString(),
    expiresIn: config.DEVICE_CODE_TTL_SECONDS,
    pollInterval: record.pollIntervalSeconds,
  };
}

export async function pollDeviceAuthorization(deviceCode: string): Promise<DeviceAuthorizationStatusDTO> {
  const record = await prisma.deviceAuthorization.findUnique({
    where: { deviceCodeHash: hashOpaqueToken(deviceCode) },
  });
  if (!record) return { state: 'expired' };
  if (isExpired(record.expiresAt)) {
    await prisma.deviceAuthorization.update({ where: { id: record.id }, data: { status: 'EXPIRED' } });
    return { state: 'expired' };
  }
  const minimumPollMs = record.pollIntervalSeconds * 1000;
  if (record.lastPolledAt && Date.now() - record.lastPolledAt.getTime() < minimumPollMs) {
    return { state: 'slow_down', pollInterval: record.pollIntervalSeconds + 2 };
  }
  await prisma.deviceAuthorization.update({ where: { id: record.id }, data: { lastPolledAt: new Date() } });

  if (record.status === 'DENIED') return { state: 'denied' };
  if (record.status === 'CONSUMED') return { state: 'expired' };
  if (record.status !== 'APPROVED' || !record.approvedById) return { state: 'pending', pollInterval: record.pollIntervalSeconds };

  const user = await prisma.user.findUnique({
    where: { id: record.approvedById },
    include: { profiles: { orderBy: { createdAt: 'asc' } } },
  });
  if (!user || user.disabled) return { state: 'denied' };

  const temporaryRefresh = randomBytes(48).toString('base64url');
  const expiresAt = new Date(Date.now() + config.DEVICE_SESSION_TTL_DAYS * 86_400_000);
  const session = await prisma.$transaction(async (tx) => {
    const saved = await tx.deviceSession.upsert({
      where: { userId_deviceId: { userId: user.id, deviceId: record.deviceId } },
      create: {
        userId: user.id,
        deviceId: record.deviceId,
        deviceName: record.deviceName,
        platform: record.platform,
        appVersion: record.appVersion,
        refreshTokenHash: hashOpaqueToken(temporaryRefresh),
        expiresAt,
      },
      update: {
        deviceName: record.deviceName,
        platform: record.platform,
        appVersion: record.appVersion,
        refreshTokenHash: hashOpaqueToken(temporaryRefresh),
        refreshVersion: { increment: 1 },
        activeProfileId: null,
        expiresAt,
        revokedAt: null,
        revokedReason: null,
        lastSeenAt: new Date(),
      },
    });
    await tx.deviceAuthorization.update({ where: { id: record.id }, data: { status: 'CONSUMED' } });
    return saved;
  });
  const nextRefreshToken = refreshToken(session.id);
  await prisma.deviceSession.update({
    where: { id: session.id },
    data: { refreshTokenHash: hashOpaqueToken(nextRefreshToken) },
  });
  const accessToken = signDeviceToken({ sub: user.id, role: user.role }, session.id);
  return {
    state: 'approved',
    accessToken,
    refreshToken: nextRefreshToken,
    expiresIn: ACCESS_TOKEN_TTL_SECONDS,
    account: toAccountDTO(user),
    profiles: user.profiles.map(toProfileDTO),
  };
}

export async function approveDeviceAuthorization(
  accountId: string,
  input: ApproveDeviceAuthorizationRequest,
): Promise<{ state: 'approved' | 'denied' }> {
  const userCode = normalizeUserCode(input.userCode);
  if (!userCode) throw ApiError.badRequest('Enter a valid six-character device code', 'DEVICE_USER_CODE_INVALID');
  const record = await prisma.deviceAuthorization.findUnique({ where: { userCode } });
  if (!record || isExpired(record.expiresAt) || record.status !== 'PENDING') {
    throw ApiError.badRequest('This device code is invalid or expired', 'DEVICE_CODE_INVALID');
  }
  await prisma.deviceAuthorization.update({
    where: { id: record.id },
    data: input.approve
      ? { status: 'APPROVED', approvedById: accountId }
      : { status: 'DENIED', approvedById: accountId },
  });
  return { state: input.approve ? 'approved' : 'denied' };
}

export async function refreshDeviceSession(token: string, deviceId: string): Promise<DeviceSessionTokensDTO> {
  const sessionId = refreshSessionId(token);
  if (!sessionId) throw ApiError.unauthorized('The refresh token is invalid', 'REFRESH_TOKEN_INVALID');
  const session = await prisma.deviceSession.findUnique({
    where: { id: sessionId },
    include: { user: true },
  });
  if (!session || session.deviceId !== deviceId || session.revokedAt || isExpired(session.expiresAt) || session.user.disabled) {
    throw ApiError.unauthorized('The Roku session is expired or revoked', 'DEVICE_SESSION_REVOKED');
  }
  if (!equalHash(session.refreshTokenHash, hashOpaqueToken(token))) {
    await prisma.deviceSession.update({
      where: { id: session.id },
      data: { revokedAt: new Date(), revokedReason: 'REFRESH_TOKEN_REUSE' },
    });
    throw ApiError.unauthorized('The Roku session was revoked after refresh-token reuse', 'REFRESH_TOKEN_REUSED');
  }

  let activeProfileId = session.activeProfileId ?? undefined;
  if (activeProfileId) {
    const owned = await prisma.profile.count({ where: { id: activeProfileId, userId: session.userId } });
    if (!owned) activeProfileId = undefined;
  }
  const nextRefreshToken = refreshToken(session.id);
  await prisma.deviceSession.update({
    where: { id: session.id },
    data: {
      refreshTokenHash: hashOpaqueToken(nextRefreshToken),
      refreshVersion: { increment: 1 },
      activeProfileId: activeProfileId ?? null,
      lastSeenAt: new Date(),
    },
  });
  return {
    accessToken: signDeviceToken({ sub: session.userId, role: session.user.role, activeProfileId }, session.id),
    refreshToken: nextRefreshToken,
    expiresIn: ACCESS_TOKEN_TTL_SECONDS,
  };
}

export async function revokeDeviceSession(sessionId: string, reason = 'SIGNED_OUT'): Promise<void> {
  await prisma.deviceSession.updateMany({
    where: { id: sessionId, revokedAt: null },
    data: { revokedAt: new Date(), revokedReason: reason },
  });
}

export async function rotateSessionForProfile(
  sessionId: string,
  accountId: string,
  profileId: string,
): Promise<DeviceSessionTokensDTO> {
  const profile = await prisma.profile.findFirst({ where: { id: profileId, userId: accountId } });
  if (!profile) throw ApiError.notFound('Profile not found');
  const session = await prisma.deviceSession.findFirst({
    where: { id: sessionId, userId: accountId, revokedAt: null },
    include: { user: true },
  });
  if (!session) throw ApiError.unauthorized('The Roku session is no longer valid', 'DEVICE_SESSION_REVOKED');
  const nextRefreshToken = refreshToken(session.id);
  await prisma.deviceSession.update({
    where: { id: session.id },
    data: {
      activeProfileId: profile.id,
      refreshTokenHash: hashOpaqueToken(nextRefreshToken),
      refreshVersion: { increment: 1 },
      lastSeenAt: new Date(),
    },
  });
  return {
    accessToken: signDeviceToken({ sub: accountId, role: session.user.role, activeProfileId: profile.id }, session.id),
    refreshToken: nextRefreshToken,
    expiresIn: ACCESS_TOKEN_TTL_SECONDS,
  };
}
