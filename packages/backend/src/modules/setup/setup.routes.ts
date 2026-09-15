/**
 * Setup routes — mounted at /api/setup.
 *
 *   GET  /status     public   minimal "is setup done / is an admin needed"
 *   POST /admin      public*  create the first administrator (*only while no users exist)
 *   GET  /snapshot   admin    wizard prefill: settings, volumes, client health
 *   POST /test-tmdb  admin    validate a TMDb key without saving it
 *   POST /complete   admin    mark the wizard finished
 */
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { enforceRateLimit } from '../../lib/rate-limit.js';
import { writeAuditEvent } from '../admin/admin-control.service.js';
import {
  completeSetup,
  createInitialAdmin,
  getSetupSnapshot,
  getSetupStatus,
  testTmdbKey,
} from './setup.service.js';

const createAdminSchema = z.object({
  email: z.string().email().transform((value) => value.toLowerCase().trim()),
  password: z.string().min(10, 'Use at least 10 characters').max(200),
  profileName: z.string().trim().min(1).max(40).optional(),
}).strict();

const testTmdbSchema = z.object({
  apiKey: z.string().trim().min(8).max(512).nullable().optional(),
}).strict();

export const setupRoutes: FastifyPluginAsync = async (app) => {
  app.get('/status', async () => getSetupStatus());

  app.post('/admin', async (request, reply) => {
    await enforceRateLimit('setup-admin', request.ip, 5, 15 * 60);
    const input = createAdminSchema.parse(request.body);
    const result = await createInitialAdmin(input);
    await writeAuditEvent({
      actorId: result.account.id,
      action: 'SETUP_ADMIN_CREATED',
      targetType: 'USER',
      targetId: result.account.id,
      targetLabel: result.account.email,
    });
    return reply.status(201).send(result);
  });

  app.get('/snapshot', { preHandler: [app.requireAdmin] }, async () => getSetupSnapshot());

  app.post('/test-tmdb', { preHandler: [app.requireAdmin] }, async (request) => {
    const body = testTmdbSchema.parse(request.body ?? {});
    return testTmdbKey(body.apiKey);
  });

  app.post('/complete', { preHandler: [app.requireAdmin] }, async (request) => {
    const status = await completeSetup();
    await writeAuditEvent({
      actorId: request.account!.id,
      action: 'SETUP_COMPLETED',
      targetType: 'SETTINGS',
      targetId: 'setup',
    });
    return status;
  });
};
