/**
 * Torrents module — ADMIN-only torrent acquisition (embedded WebTorrent).
 *
 * Routes:
 *   POST /api/torrents/upload     — parse .torrent file → TorrentParseResult
 *   POST /api/torrents/confirm    — confirm/correct match → TorrentDTO
 *   GET  /api/torrents            — list all torrents
 *   GET  /api/torrents/:id        — get single torrent
 *   POST /api/torrents/:id/stop   — stop seeding
 *   DELETE /api/torrents/:id      — remove torrent (optional ?deleteFiles=true)
 */
import type { FastifyInstance, FastifyPluginAsync } from 'fastify';
import multipart from '@fastify/multipart';
import { confirmBodySchema } from './torrents.schema.js';
import {
  parseUpload,
  confirmTorrent,
  getTorrentClientHealth,
  listTorrents,
  getTorrent,
  markTorrentStartFailed,
  retryTorrentDownload,
  stopTorrent,
  removeTorrentById,
  startDownloading,
} from './torrents.service.js';
import { torrentFilePath } from '../../lib/media-paths.js';
import { writeFile, readFile } from 'node:fs/promises';
import { mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { writeAuditEvent } from '../admin/admin-control.service.js';

export const torrentRoutes: FastifyPluginAsync = async (
  app: FastifyInstance,
) => {
  await app.register(multipart, {
    limits: { fileSize: 2 * 1024 * 1024 }, // 2 MiB — .torrent files are tiny
  });

  app.addHook('preHandler', app.requirePermission('MANAGE_DOWNLOADS'));

  app.get('/health', async () => {
    return getTorrentClientHealth();
  });

  // ─── POST /upload — parse a .torrent file + persist for confirm ────────
  app.post('/upload', async (request) => {
    const data = await request.file();
    if (!data) {
      const err = new Error('No file uploaded');
      (err as any).statusCode = 400;
      throw err;
    }
    const buffer = await data.toBuffer();
    const result = await parseUpload(buffer);

    // Persist the raw .torrent bytes so the confirm step can retrieve them.
    const filePath = torrentFilePath(result.infoHash);
    await mkdir(dirname(filePath), { recursive: true });
    await writeFile(filePath, buffer);

    return result;
  });

  // ─── POST /confirm — confirm parsed torrent and kick off download ──────
  app.post('/confirm', async (request) => {
    const input = confirmBodySchema.parse(request.body);
    const dto = await confirmTorrent(input);

    // Read the .torrent buffer persisted during upload and start the download.
    try {
      const filePath = torrentFilePath(input.infoHash);
      const buffer = await readFile(filePath);
      await startDownloading(dto.id, buffer);
    } catch (err) {
      // If the download fails to start, surface a retryable admin error instead
      // of silently leaving the acquisition looking pending.
      await markTorrentStartFailed(dto.id, err);
    }

    const result = await getTorrent(dto.id);
    await writeAuditEvent({ actorId: request.account!.id, action: 'DOWNLOAD_CREATED', targetType: 'TORRENT', targetId: result.id, targetLabel: result.name });
    return result;
  });

  // ─── GET / — list all torrents ────────────────────────────────────────
  app.get('/', async () => {
    return listTorrents();
  });

  // ─── GET /:id — single torrent ────────────────────────────────────────
  app.get('/:id', async (request) => {
    const { id } = request.params as { id: string };
    return getTorrent(id);
  });

  // ─── POST /:id/stop — stop seeding ────────────────────────────────────
  app.post('/:id/stop', async (request) => {
    const { id } = request.params as { id: string };
    const result = await stopTorrent(id);
    await writeAuditEvent({ actorId: request.account!.id, action: 'DOWNLOAD_STOPPED', targetType: 'TORRENT', targetId: id, targetLabel: result.name });
    return result;
  });

  app.post('/:id/retry', async (request) => {
    const { id } = request.params as { id: string };
    const result = await retryTorrentDownload(id);
    await writeAuditEvent({ actorId: request.account!.id, action: 'DOWNLOAD_RETRIED', targetType: 'TORRENT', targetId: id, targetLabel: result.name });
    return result;
  });

  // ─── DELETE /:id — remove torrent ─────────────────────────────────────
  app.delete('/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const { deleteFiles } = request.query as { deleteFiles?: string };
    const shouldDelete = deleteFiles === 'true';
    await removeTorrentById(id, shouldDelete);
    await writeAuditEvent({ actorId: request.account!.id, action: shouldDelete ? 'DOWNLOAD_FILES_DELETED' : 'DOWNLOAD_REMOVED', targetType: 'TORRENT', targetId: id });
    return reply.status(204).send();
  });
};
