/**
 * Torrents module — ADMIN-only acquisition (embedded WebTorrent).
 * TODO(phase 5): implement .torrent upload + parse (TorrentParseResult),
 * confirm/correct matching (ConfirmTorrentRequest), live progress + seeding
 * stats (TorrentDTO), and completion post-processing (rename/move/season-pack
 * split) wired through the `torrent-postprocess` BullMQ queue.
 *
 * Stub: reserves the /api/torrents mount point (admin-guarded when implemented).
 */
import type { FastifyInstance, FastifyPluginAsync } from 'fastify';

export const torrentRoutes: FastifyPluginAsync = async (
  _app: FastifyInstance,
) => {
  // TODO(phase 5): POST /  (upload+parse), POST /confirm, GET /  (list), etc.
};
