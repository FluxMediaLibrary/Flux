/**
 * TMDb proxy routes (require an active profile — this is the member request
 * browser). The TMDb key stays server-side.
 *   GET /api/tmdb/search?q=&type=
 *   GET /api/tmdb/:mediaType/:tmdbId
 */
import type { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { searchQuerySchema, detailParamsSchema } from './tmdb.schema.js';
import { search, getDetail, normalizeMediaType } from './tmdb.service.js';

export const tmdbRoutes: FastifyPluginAsync = async (app: FastifyInstance) => {
  // Browsing TMDb is a per-profile activity (requests log against a profile).
  app.addHook('preHandler', app.requireProfile);

  app.get('/search', async (request) => {
    const { q, type } = searchQuerySchema.parse(request.query);
    return search(q, type);
  });

  app.get('/:mediaType/:tmdbId', async (request) => {
    const { mediaType, tmdbId } = detailParamsSchema.parse(request.params);
    return getDetail(normalizeMediaType(mediaType), tmdbId);
  });
};
