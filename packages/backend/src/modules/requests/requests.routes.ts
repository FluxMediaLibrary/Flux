/**
 * Requests module — per-profile TMDb media requests.
 * TODO(phase 4): implement create request (CreateRequestRequest, logged against
 * the active profile), list own requests, and ADMIN list/approve/reject/fulfil
 * (RequestDTO). Fulfilment links to the torrent flow + notifications.
 *
 * Stub: reserves the /api/requests mount point.
 */
import type { FastifyInstance, FastifyPluginAsync } from 'fastify';

export const requestRoutes: FastifyPluginAsync = async (
  _app: FastifyInstance,
) => {
  // TODO(phase 4): POST /  (requireProfile), GET /  (own), admin sub-routes.
};
