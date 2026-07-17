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
  syncFulfilledRequests,
} from './requests.service.js';
import { writeAuditEvent } from '../admin/admin-control.service.js';

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

  app.get('/admin', { preHandler: [app.requirePermission('MANAGE_REQUESTS')] }, async () => {
    return listAllRequests();
  });

  app.post('/admin/sync-fulfilled', { preHandler: [app.requirePermission('MANAGE_REQUESTS')] }, async (request) => {
    const result = await syncFulfilledRequests();
    await writeAuditEvent({ actorId: request.account!.id, action: 'REQUESTS_SYNCED', targetType: 'REQUEST_QUEUE', details: result });
    return result;
  });

  app.post(
    '/:id/approve',
    { preHandler: [app.requirePermission('MANAGE_REQUESTS')] },
    async (request) => {
      const { id } = request.params as { id: string };
      const result = await approveRequest(id);
      await writeAuditEvent({ actorId: request.account!.id, action: 'REQUEST_APPROVED', targetType: 'REQUEST', targetId: id, targetLabel: result.title });
      return result;
    },
  );

  app.post(
    '/:id/reject',
    { preHandler: [app.requirePermission('MANAGE_REQUESTS')] },
    async (request) => {
      const { id } = request.params as { id: string };
      const result = await rejectRequest(id);
      await writeAuditEvent({ actorId: request.account!.id, action: 'REQUEST_REJECTED', targetType: 'REQUEST', targetId: id, targetLabel: result.title });
      return result;
    },
  );
};
