/** Auth routes: POST /api/auth/signup, POST /api/auth/login. */
import type { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { signupSchema, loginSchema } from './auth.schema.js';
import { signup, login } from './auth.service.js';
import { enforceRateLimit } from '../../lib/rate-limit.js';

export const authRoutes: FastifyPluginAsync = async (app: FastifyInstance) => {
  app.post('/signup', async (request, reply) => {
    const input = signupSchema.parse(request.body);
    await enforceRateLimit('signup-ip', request.ip, 10, 60 * 60);
    const result = await signup(input);
    return reply.status(201).send(result);
  });

  app.post('/login', async (request, reply) => {
    const input = loginSchema.parse(request.body);
    await Promise.all([
      enforceRateLimit('login-ip', request.ip, 20, 10 * 60),
      enforceRateLimit('login-account', input.email, 8, 10 * 60),
    ]);
    const result = await login(input);
    return reply.send(result);
  });
};
