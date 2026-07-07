/**
 * Admin routes — admin-only endpoints for the dashboard.
 *
 * Routes:
 *   GET  /info   — system dashboard aggregating backend stats
 */
import type { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { getAdminInfo, getIntroJobs } from './admin.service.js';

export const adminRoutes: FastifyPluginAsync = async (app: FastifyInstance) => {
  // All admin routes require ADMIN role.
  app.addHook('preHandler', app.requireAdmin);

  app.get('/info', async () => {
    return getAdminInfo();
  });

  app.get('/intro-jobs', async () => {
    return getIntroJobs();
  });
};
