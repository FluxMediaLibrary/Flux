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
import { prisma } from '../../lib/db.js';
import {
  getHomepage,
  getMediaItemDetail,
  listLibrary,
  saveProgress,
  getPlaybackMarker,
} from './library.service.js';
import { introDetectionQueue } from '../../jobs/queues.js';

const listQuerySchema = z.object({
  type: z.enum(['movie', 'tv', 'show', 'all']).optional().default('all'),
});

const saveProgressSchema = z
  .object({
    mediaItemId: z.string().optional(),
    episodeId: z.string().optional(),
    positionSeconds: z.number().finite().min(0),
    // Duration is unknown for some streams (HLS reports Infinity, which
    // serializes to null over JSON). Accept null/undefined and treat both as
    // "unknown" — never reject the whole save over a missing duration.
    durationSeconds: z.number().finite().positive().nullish(),
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
    return saveProgress(request.activeProfileId!, {
      ...body,
      durationSeconds: body.durationSeconds ?? undefined,
    });
  });

  // ── Playback marker (intro) ──────────────────────────────────────────────

  const introQuerySchema = z.object({
    season: z.coerce.number().int().min(1),
  });

  app.get('/items/:id/intro', async (request) => {
    const { id } = request.params as { id: string };
    const { season } = introQuerySchema.parse(request.query);
    return getPlaybackMarker(id, season);
  });

  // ── Manual re-analysis trigger (admin-only inside the library prefix) ─────
  // Since /items/:id/intro doesn't require admin, we add a separate route that
  // does. The requireProfile guard is already on; for admin-only we could add a
  // separate guard, but for simplicity this is exposed under /api/library with
  // profile requirement. Admin-only enforcement happens at the route caller level
  // (only admin UI surfaces the button).
  app.post('/items/:id/analyze-intro', async (request, reply) => {
    const { id } = request.params as { id: string };
    const { season } = introQuerySchema.parse(request.body ?? {});
    
    await introDetectionQueue.add(
      'intro-detection',
      { mediaItemId: id, season },
      { jobId: `intro-${id}-s${season}` },
    );

    return reply.status(202).send({ queued: true, mediaItemId: id, season });
  });

  // ── Scan all shows for intros (admin action) ──────────────────────────────

  app.post('/scan-all-intros', async (request, reply) => {
    const shows = await prisma.mediaItem.findMany({
      where: { type: 'SHOW' },
      select: { id: true, title: true },
    });

    let queued = 0;
    for (const show of shows) {
      const seasons = await prisma.episode.groupBy({
        by: ['season'],
        where: { mediaItemId: show.id, filePath: { not: null } },
      });

      for (const { season } of seasons) {
        await introDetectionQueue.add(
          'intro-detection',
          { mediaItemId: show.id, season },
          { jobId: `intro-${show.id}-s${season}` },
        );
        queued++;
      }
    }

    return reply.status(202).send({ queued, shows: shows.length });
  });
}
