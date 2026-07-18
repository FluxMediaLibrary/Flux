/** Auth routes: POST /api/auth/signup, POST /api/auth/login. */
import type { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { signupSchema, loginSchema } from './auth.schema.js';
import { signup, login } from './auth.service.js';
import { z } from 'zod';
import {
  approveDeviceAuthorization,
  createDeviceAuthorization,
  pollDeviceAuthorization,
  refreshDeviceSession,
  revokeDeviceSession,
} from './device-auth.service.js';
import { enforceRateLimit } from '../../lib/rate-limit.js';

const createDeviceSchema = z.object({
  deviceName: z.string().trim().min(1).max(80),
  platform: z.literal('roku'),
  deviceId: z.string().trim().min(8).max(128),
  appVersion: z.string().regex(/^\d+\.\d+\.\d+$/),
});
const deviceStatusSchema = z.object({ deviceCode: z.string().min(32).max(128) });
const approveDeviceSchema = z.object({
  userCode: z.string().trim().min(6).max(16),
  approve: z.boolean(),
});
const refreshSchema = z.object({
  refreshToken: z.string().min(40).max(256),
  deviceId: z.string().trim().min(8).max(128),
});

export const authRoutes: FastifyPluginAsync = async (app: FastifyInstance) => {
  app.post('/signup', async (request, reply) => {
    const input = signupSchema.parse(request.body);
    const result = await signup(input);
    return reply.status(201).send(result);
  });

  app.post('/login', async (request, reply) => {
    const input = loginSchema.parse(request.body);
    const result = await login(input);
    return reply.send(result);
  });

  app.post('/device', async (request, reply) => {
    await enforceRateLimit('device-create', request.ip, 10, 60);
    const input = createDeviceSchema.parse(request.body);
    return reply.status(201).send(await createDeviceAuthorization(input));
  });

  app.post('/device/status', async (request) => {
    await enforceRateLimit('device-poll', request.ip, 120, 60);
    const input = deviceStatusSchema.parse(request.body);
    return pollDeviceAuthorization(input.deviceCode);
  });

  app.post('/device/approve', { preHandler: [app.requireAuth] }, async (request) => {
    await enforceRateLimit('device-approve', `${request.account!.id}:${request.ip}`, 10, 300);
    const input = approveDeviceSchema.parse(request.body);
    return approveDeviceAuthorization(request.account!.id, input);
  });

  app.post('/refresh', async (request) => {
    await enforceRateLimit('device-refresh', request.ip, 30, 60);
    const input = refreshSchema.parse(request.body);
    return refreshDeviceSession(input.refreshToken, input.deviceId);
  });

  app.post('/logout', { preHandler: [app.requireDeviceAuth] }, async (request, reply) => {
    await revokeDeviceSession(request.deviceSessionId!);
    return reply.status(204).send();
  });
};
