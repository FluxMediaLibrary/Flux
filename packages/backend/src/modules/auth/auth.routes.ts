/** Auth routes: POST /api/auth/signup, POST /api/auth/login. */
import type { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { signupSchema, loginSchema } from './auth.schema.js';
import { signup, login } from './auth.service.js';
import { enforceRateLimit } from '../../lib/rate-limit.js';

export const authRoutes: FastifyPluginAsync = async (app: FastifyInstance) => {
  app.post('/signup', async (request, reply) => {
    await enforceRateLimit('signup', request.ip, 10, 15 * 60);
    const input = signupSchema.parse(request.body);
    const result = await signup(input);
    return reply.status(201).send(result);
  });

  app.post('/login', async (request, reply) => {
    const input = loginSchema.parse(request.body);
    // Per-IP and per-account buckets: a distributed guess against one account
    // is throttled even when it comes from many addresses.
    await enforceRateLimit('login-ip', request.ip, 30, 10 * 60);
    await enforceRateLimit('login-account', input.email, 10, 10 * 60);
    const result = await login(input);
    return reply.send(result);
  });
};
