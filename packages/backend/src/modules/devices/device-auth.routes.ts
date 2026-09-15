/**
 * Device link routes. Mounted under /api/auth (TV-facing) and /api/devices
 * (web-facing management).
 */
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { ApiError } from '../../lib/errors.js';
import { enforceRateLimit } from '../../lib/rate-limit.js';
import { writeAuditEvent } from '../admin/admin-control.service.js';
import {
  approveDeviceLink,
  denyDeviceLink,
  describePendingLink,
  listLinkedDevices,
  pollDeviceLink,
  refreshDeviceSession,
  revokeDeviceSession,
  revokeDeviceSessionByRefreshToken,
  startDeviceLink,
} from './device-auth.service.js';

const startSchema = z.object({
  deviceId: z.string().trim().min(4).max(128),
  deviceName: z.string().trim().min(1).max(80),
  platform: z.string().trim().min(1).max(40),
  appVersion: z.string().trim().min(1).max(40),
}).strict();

const pollSchema = z.object({ deviceCode: z.string().trim().min(16).max(256) }).strict();
const refreshSchema = z.object({ refreshToken: z.string().trim().min(16).max(256), deviceId: z.string().trim().min(4).max(128) }).strict();
const logoutSchema = z.object({ refreshToken: z.string().trim().min(16).max(256).optional() }).strict();
const userCodeSchema = z.object({ userCode: z.string().trim().min(8).max(12) }).strict();

/** TV-facing: /api/auth/device, /device/status, /refresh, /logout. */
export const deviceAuthRoutes: FastifyPluginAsync = async (app) => {
  app.post('/device', async (request, reply) => {
    await enforceRateLimit('device-link-start', request.ip, 20, 10 * 60);
    const input = startSchema.parse(request.body);
    return reply.status(201).send(await startDeviceLink(input));
  });

  app.post('/device/status', async (request) => {
    await enforceRateLimit('device-link-poll', request.ip, 120, 10 * 60);
    const input = pollSchema.parse(request.body);
    return pollDeviceLink(input.deviceCode);
  });

  app.post('/refresh', async (request) => {
    await enforceRateLimit('device-refresh', request.ip, 60, 10 * 60);
    const input = refreshSchema.parse(request.body);
    return refreshDeviceSession(input.refreshToken, input.deviceId);
  });

  app.post('/logout', async (request, reply) => {
    const input = logoutSchema.parse(request.body ?? {});
    if (input.refreshToken) await revokeDeviceSessionByRefreshToken(input.refreshToken);
    return reply.status(204).send();
  });
};

/** Web-facing: /api/devices/pending/:code, /approve, /deny, list, revoke. */
export const deviceManagementRoutes: FastifyPluginAsync = async (app) => {
  app.get<{ Params: { code: string } }>('/pending/:code', { preHandler: [app.requireAuth] }, async (request) => {
    await enforceRateLimit('device-link-lookup', request.account!.id, 30, 10 * 60);
    return describePendingLink(request.params.code);
  });

  app.post('/approve', { preHandler: [app.requireAuth] }, async (request) => {
    // Codes are short by design; cap guesses per account to keep them safe.
    await enforceRateLimit('device-link-approve', request.account!.id, 10, 10 * 60);
    const input = userCodeSchema.parse(request.body);
    const pending = await approveDeviceLink(input.userCode, request.account!.id);
    await writeAuditEvent({
      actorId: request.account!.id,
      action: 'DEVICE_LINK_APPROVED',
      targetType: 'DEVICE',
      targetLabel: pending.deviceName,
      details: { platform: pending.platform, appVersion: pending.appVersion },
    });
    return pending;
  });

  app.post('/deny', { preHandler: [app.requireAuth] }, async (request, reply) => {
    const input = userCodeSchema.parse(request.body);
    await denyDeviceLink(input.userCode);
    return reply.status(204).send();
  });

  app.get('/', { preHandler: [app.requireAuth] }, async (request) => {
    const all = request.account!.role === 'ADMIN' && (request.query as { all?: string }).all === '1';
    return listLinkedDevices(all ? null : request.account!.id);
  });

  app.delete<{ Params: { id: string } }>('/:id', { preHandler: [app.requireAuth] }, async (request, reply) => {
    if (!request.params.id) throw ApiError.badRequest('Device id required');
    await revokeDeviceSession(request.params.id, request.account!.id, request.account!.role === 'ADMIN');
    await writeAuditEvent({ actorId: request.account!.id, action: 'DEVICE_REVOKED', targetType: 'DEVICE', targetId: request.params.id });
    return reply.status(204).send();
  });
};
