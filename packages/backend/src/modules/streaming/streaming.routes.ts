/**
 * Streaming module — direct play (HTTP range) + FFmpeg HLS transcode fallback.
 * TODO(phase 6): implement range-request direct play from MEDIA_ROOT and
 * on-demand HLS (.m3u8/.ts) transcode sessions written to TRANSCODE_ROOT,
 * supporting multiple concurrent streams. SECURITY: every served path MUST be
 * resolved/sanitized against its configured root to prevent path traversal.
 *
 * Stub: reserves the /api/stream mount point.
 */
import type { FastifyInstance, FastifyPluginAsync } from 'fastify';

export const streamingRoutes: FastifyPluginAsync = async (
  _app: FastifyInstance,
) => {
  // TODO(phase 6): GET /:mediaItemId (direct play), GET /:id/hls/* (transcode).
};
