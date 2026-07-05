/**
 * Requests routes — per-profile TMDb media requests.
 *
 * Routes:
 *   POST   /api/requests             — create (requireProfile)
 *   GET    /api/requests             — list own (requireProfile)
 *   GET    /api/requests/admin       — list all (requireAdmin)
 *   POST   /api/requests/:id/approve — approve (requireAdmin)
 *   POST   /api/requests/:id/reject  — reject  (requireAdmin)
 */
import type { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { createRequestSchema } from './requests.schema.js';
import {
  createRequest,
  listMyRequests,
  listAllRequests,
  approveRequest,
  rejectRequest,
} from './requests.service.js';

export const requestRoutes: FastifyPluginAsync = async (
  app: FastifyInstance,
) => {
  // ── Member routes (requireProfile) ──────────────────────────────────────

  app.post(
    '/',
    { preHandler: [app.requireProfile] },
    async (request, reply) => {
      const input = createRequestSchema.parse(request.body);
      const result = await createRequest(request.activeProfileId!, input);
      return reply.status(201).send(result);
    },
  );

  app.get('/', { preHandler: [app.requireProfile] }, async (request) => {
    return listMyRequests(request.activeProfileId!);
  });

  // ── Admin routes (requireAdmin) — registered before parameterised routes ──

  app.get('/admin', { preHandler: [app.requireAdmin] }, async () => {
    return listAllRequests();
  });

  app.post(
    '/:id/approve',
    { preHandler: [app.requireAdmin] },
    async (request) => {
      const { id } = request.params as { id: string };
      return approveRequest(id);
    },
  );

  app.post(
    '/:id/reject',
    { preHandler: [app.requireAdmin] },
    async (request) => {
      const { id } = request.params as { id: string };
      return rejectRequest(id);
    },
  );
};
