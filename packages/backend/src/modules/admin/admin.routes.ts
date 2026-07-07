/**
 * Admin routes — admin-only endpoints for the dashboard.
 *
 * Routes:
 *   GET  /info   — system dashboard aggregating backend stats
 */
import type { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { getAdminInfo, getIntroJobs } from './admin.service.js';
import { prisma } from '../../lib/db.js';
import { introDetectionQueue } from '../../jobs/queues.js';

export const adminRoutes: FastifyPluginAsync = async (app: FastifyInstance) => {
  // All admin routes require ADMIN role.
  app.addHook('preHandler', app.requireAdmin);

  app.get('/info', async () => {
    return getAdminInfo();
  });

  app.get('/intro-jobs', async () => {
    return getIntroJobs();
  });

  // ── Intro detection scan triggers ────────────────────────────────────────

  app.post('/scan-all-intros', async (_request, reply) => {
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

  app.post('/analyze-intro', async (request, reply) => {
    const { mediaItemId, season } = request.body as { mediaItemId: string; season: number };
    await introDetectionQueue.add(
      'intro-detection',
      { mediaItemId, season },
      { jobId: `intro-${mediaItemId}-s${season}` },
    );
    return reply.status(202).send({ queued: true, mediaItemId, season });
  });
};
