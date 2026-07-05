/**
 * Library module — member-facing browsing & playback metadata.
 * TODO(phase 4): implement homepage rows (continue watching, recently added,
 * by genre), media item detail, episodes, and watch-progress endpoints
 * (HomeRowsDTO / MediaItemDetailDTO / WatchProgressDTO from @flux/shared).
 *
 * Stub: registers no routes yet, but reserves the /api/library mount point.
 */
import type { FastifyInstance, FastifyPluginAsync } from 'fastify';

export const libraryRoutes: FastifyPluginAsync = async (
  _app: FastifyInstance,
) => {
  // TODO(phase 4): GET /  (HomeRowsDTO), GET /items/:id, POST /progress, etc.
};
