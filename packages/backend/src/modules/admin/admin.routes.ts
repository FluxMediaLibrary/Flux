/**
 * Admin routes — admin-only endpoints for the dashboard.
 *
 * Routes:
 *   GET  /info   — system dashboard aggregating backend stats
 */
import type { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { ApiError } from '../../lib/errors.js';
import {
  analyzeMissingLibraryMedia,
  analyzeLibraryItem,
  clearMissingEpisodeFile,
  clearMissingLibraryFile,
  getAdminInfo,
  getAdminLibraryHealth,
  syncMissingShowEpisodes,
  syncShowEpisodes,
} from './admin.service.js';

export const adminRoutes: FastifyPluginAsync = async (app: FastifyInstance) => {
  // All admin routes require ADMIN role.
  app.addHook('preHandler', app.requireAdmin);

  app.get('/info', async () => {
    return getAdminInfo();
  });

  app.get('/library', async () => {
    return getAdminLibraryHealth();
  });

  app.post('/library/sync-episodes', async () => {
    return syncMissingShowEpisodes();
  });

  app.post('/library/analyze-missing', async () => {
    return analyzeMissingLibraryMedia();
  });

  app.post('/library/episodes/:episodeId/clear-missing-file', async (request) => {
    const { episodeId } = request.params as { episodeId: string };
    return clearMissingEpisodeFile(episodeId);
  });

  app.post('/library/:id/sync-episodes', async (request) => {
    const { id } = request.params as { id: string };
    return syncShowEpisodes(id);
  });

  app.post('/library/:id/seasons/:season/sync-episodes', async (request) => {
    const { id, season: rawSeason } = request.params as { id: string; season: string };
    const season = Number(rawSeason);
    if (!Number.isInteger(season) || season <= 0) {
      throw ApiError.badRequest('Season must be a positive integer', 'INVALID_SEASON');
    }
    return syncShowEpisodes(id, { season });
  });

  app.post('/library/:id/analyze', async (request) => {
    const { id } = request.params as { id: string };
    return analyzeLibraryItem(id);
  });

  app.post('/library/:id/clear-missing-file', async (request) => {
    const { id } = request.params as { id: string };
    return clearMissingLibraryFile(id);
  });
};
