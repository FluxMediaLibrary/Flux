/**
 * TMDb proxy routes (require an active profile — this is the member request
 * browser). The TMDb key stays server-side.
 *   GET /api/tmdb/search?q=&type=
 *   GET /api/tmdb/:mediaType/:tmdbId
 */
import type { FastifyInstance, FastifyPluginAsync } from 'fastify';
import {
  searchQuerySchema,
  detailParamsSchema,
  seasonParamsSchema,
  trendingQuerySchema,
  popularQuerySchema,
  genresQuerySchema,
  discoverQuerySchema,
} from './tmdb.schema.js';
import {
  search,
  getDetail,
  getSeasonEpisodes,
  getTrending,
  getPopular,
  getGenres,
  discover,
  searchPeople,
  normalizeMediaType,
} from './tmdb.service.js';

export const tmdbRoutes: FastifyPluginAsync = async (app: FastifyInstance) => {
  // Browsing TMDb is a per-profile activity (requests log against a profile).
  app.addHook('preHandler', app.requireProfile);

  app.get('/search', async (request) => {
    const { q, type } = searchQuerySchema.parse(request.query);
    return search(q, type);
  });

  app.get('/people/search', async (request) => {
    const { q } = searchQuerySchema.parse(request.query);
    return searchPeople(q);
  });

  // ── Discovery feeds ───────────────────────────────────────────────────────
  // NOTE: these static paths are declared BEFORE `/:mediaType/:tmdbId` so they
  // are not swallowed by the catch-all detail route.

  app.get('/trending', async (request) => {
    const { type, window } = trendingQuerySchema.parse(request.query);
    return getTrending(normalizeMediaType(type), window);
  });

  app.get('/popular', async (request) => {
    const { type, page } = popularQuerySchema.parse(request.query);
    return getPopular(normalizeMediaType(type), page);
  });

  app.get('/genres', async (request) => {
    const { type } = genresQuerySchema.parse(request.query);
    return getGenres(normalizeMediaType(type));
  });

  app.get('/discover', async (request) => {
    const { type, genre, page } = discoverQuerySchema.parse(request.query);
    return discover(normalizeMediaType(type), { genreId: genre, page });
  });

  // Per-season episode metadata (still frames, synopses) for TV. Declared
  // before the catch-all detail route so it is not swallowed by it.
  app.get('/tv/:tmdbId/season/:season', async (request) => {
    const { tmdbId, season } = seasonParamsSchema.parse(request.params);
    return getSeasonEpisodes(tmdbId, season);
  });

  app.get('/:mediaType/:tmdbId', async (request) => {
    const { mediaType, tmdbId } = detailParamsSchema.parse(request.params);
    return getDetail(normalizeMediaType(mediaType), tmdbId);
  });
};
