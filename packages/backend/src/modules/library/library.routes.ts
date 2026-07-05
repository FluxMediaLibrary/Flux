/**
 * Library routes — member-facing browsing & playback metadata.
 *
 * Routes (all require an active profile):
 *   GET  /home          — homepage rows (continue watching, recent, by genre)
 *   GET  /items/:id     — media item detail with episodes + progress
 *   POST /progress      — save (upsert) watch progress for current profile
 */
import type { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import {
  getHomepage,
  getMediaItemDetail,
  listLibrary,
  saveProgress,
} from './library.service.js';

const listQuerySchema = z.object({
  type: z.enum(['movie', 'tv', 'show', 'all']).optional().default('all'),
});

const saveProgressSchema = z
  .object({
    mediaItemId: z.string().optional(),
    episodeId: z.string().optional(),
    positionSeconds: z.number().min(0),
    durationSeconds: z.number().optional(),
  })
  .refine(
    (data) => !!(data.mediaItemId || data.episodeId),
    'mediaItemId or episodeId required',
  );

export const libraryRoutes: FastifyPluginAsync = async (
  app: FastifyInstance,
) => {
  // All library routes need an active profile.
  app.addHook('preHandler', app.requireProfile);

  // ── Homepage rows ───────────────────────────────────────────────────────

  app.get('/home', async (request) => {
    return getHomepage(request.activeProfileId!);
  });

  // ── Library grid (all items, per-profile badge state) ───────────────────

  app.get('/items', async (request) => {
    const { type } = listQuerySchema.parse(request.query);
    const mt =
      type === 'all' ? undefined : type === 'movie' ? 'MOVIE' : 'SHOW';
    return listLibrary(request.activeProfileId!, mt);
  });

  // ── Media item detail ───────────────────────────────────────────────────

  app.get('/items/:id', async (request) => {
    const { id } = request.params as { id: string };
    return getMediaItemDetail(id, request.activeProfileId!);
  });

  // ── Save watch progress ─────────────────────────────────────────────────

  app.post('/progress', async (request) => {
    const body = saveProgressSchema.parse(request.body);
    return saveProgress(request.activeProfileId!, body);
  });
};
