/**
 * Admin routes — admin-only endpoints for the dashboard.
 *
 * Routes:
 *   GET  /info   — system dashboard aggregating backend stats
 */
import type { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { ADMIN_PERMISSIONS, type UpdateAdminUserRequest } from '@flux/shared';
import { z } from 'zod';
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
import {
  getAdminActivity,
  getAdminOverview,
  getAdminPlayback,
  getAdminSignal,
  listAdminUsers,
  updateAdminUser,
  writeAuditEvent,
} from './admin-control.service.js';
import { approveRequest, listAllRequests, rejectRequest, syncFulfilledRequests } from '../requests/requests.service.js';
import { getTorrentClientHealth, listTorrents, removeTorrentById, retryTorrentDownload, stopTorrent } from '../torrents/torrents.service.js';

const updateUserSchema = z.object({
  role: z.enum(['ADMIN', 'MEMBER']).optional(),
  permissions: z.array(z.enum(ADMIN_PERMISSIONS as [typeof ADMIN_PERMISSIONS[number], ...typeof ADMIN_PERMISSIONS[number][]])).optional(),
  disabled: z.boolean().optional(),
  requestLimit: z.number().int().positive().nullable().optional(),
  streamLimit: z.number().int().positive().nullable().optional(),
});

export const adminRoutes: FastifyPluginAsync = async (app: FastifyInstance) => {
  app.get('/overview', { preHandler: [app.requirePermission('VIEW_SYSTEM')] }, async () => {
    return getAdminOverview();
  });

  app.get('/signal', { preHandler: [app.requirePermission('VIEW_SYSTEM')] }, async () => {
    return getAdminSignal();
  });

  app.get('/events', { preHandler: [app.requirePermission('VIEW_SYSTEM')] }, async (request, reply) => {
    reply.hijack();
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    let writing = false;
    const send = async () => {
      if (writing || reply.raw.destroyed) return;
      writing = true;
      try {
        const signal = await getAdminSignal();
        reply.raw.write(`event: signal\ndata: ${JSON.stringify(signal)}\n\n`);
      } catch {
        reply.raw.write(': signal unavailable\n\n');
      } finally {
        writing = false;
      }
    };
    await send();
    const timer = setInterval(() => void send(), 10_000);
    request.raw.on('close', () => clearInterval(timer));
  });

  app.get('/info', { preHandler: [app.requirePermission('VIEW_SYSTEM')] }, async () => {
    return getAdminInfo();
  });

  app.get('/system', { preHandler: [app.requirePermission('VIEW_SYSTEM')] }, async () => {
    return getAdminInfo();
  });

  app.get('/storage', { preHandler: [app.requirePermission('VIEW_SYSTEM')] }, async () => {
    const info = await getAdminInfo();
    return info.storage;
  });

  app.get('/playback', { preHandler: [app.requirePermission('VIEW_SYSTEM')] }, async () => {
    return getAdminPlayback(50);
  });

  app.get('/activity', { preHandler: [app.requirePermission('VIEW_LOGS')] }, async (request) => {
    const { limit } = request.query as { limit?: string };
    return getAdminActivity(limit ? Number(limit) : 50);
  });

  app.get('/users', { preHandler: [app.requirePermission('MANAGE_USERS')] }, async () => {
    return listAdminUsers();
  });

  app.patch('/users/:id', { preHandler: [app.requirePermission('MANAGE_USERS')] }, async (request) => {
    const { id } = request.params as { id: string };
    const input = updateUserSchema.parse(request.body) as UpdateAdminUserRequest;
    return updateAdminUser(request.account!.id, id, input);
  });

  app.get('/requests', { preHandler: [app.requirePermission('MANAGE_REQUESTS')] }, async () => listAllRequests());
  app.post('/requests/sync-fulfilled', { preHandler: [app.requirePermission('MANAGE_REQUESTS')] }, async (request) => {
    const result = await syncFulfilledRequests();
    await writeAuditEvent({ actorId: request.account!.id, action: 'REQUESTS_SYNCED', targetType: 'REQUEST_QUEUE', details: result });
    return result;
  });
  app.post('/requests/:id/approve', { preHandler: [app.requirePermission('MANAGE_REQUESTS')] }, async (request) => {
    const { id } = request.params as { id: string };
    const result = await approveRequest(id);
    await writeAuditEvent({ actorId: request.account!.id, action: 'REQUEST_APPROVED', targetType: 'REQUEST', targetId: id, targetLabel: result.title });
    return result;
  });
  app.post('/requests/:id/reject', { preHandler: [app.requirePermission('MANAGE_REQUESTS')] }, async (request) => {
    const { id } = request.params as { id: string };
    const result = await rejectRequest(id);
    await writeAuditEvent({ actorId: request.account!.id, action: 'REQUEST_REJECTED', targetType: 'REQUEST', targetId: id, targetLabel: result.title });
    return result;
  });

  app.get('/downloads', { preHandler: [app.requirePermission('MANAGE_DOWNLOADS')] }, async () => listTorrents());
  app.get('/downloads/health', { preHandler: [app.requirePermission('MANAGE_DOWNLOADS')] }, async () => getTorrentClientHealth());
  app.post('/downloads/:id/stop', { preHandler: [app.requirePermission('MANAGE_DOWNLOADS')] }, async (request) => {
    const { id } = request.params as { id: string };
    const result = await stopTorrent(id);
    await writeAuditEvent({ actorId: request.account!.id, action: 'DOWNLOAD_STOPPED', targetType: 'TORRENT', targetId: id, targetLabel: result.name });
    return result;
  });
  app.post('/downloads/:id/retry', { preHandler: [app.requirePermission('MANAGE_DOWNLOADS')] }, async (request) => {
    const { id } = request.params as { id: string };
    const result = await retryTorrentDownload(id);
    await writeAuditEvent({ actorId: request.account!.id, action: 'DOWNLOAD_RETRIED', targetType: 'TORRENT', targetId: id, targetLabel: result.name });
    return result;
  });
  app.delete('/downloads/:id', { preHandler: [app.requirePermission('MANAGE_DOWNLOADS')] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const { deleteFiles } = request.query as { deleteFiles?: string };
    const shouldDelete = deleteFiles === 'true';
    await removeTorrentById(id, shouldDelete);
    await writeAuditEvent({ actorId: request.account!.id, action: shouldDelete ? 'DOWNLOAD_FILES_DELETED' : 'DOWNLOAD_REMOVED', targetType: 'TORRENT', targetId: id });
    return reply.status(204).send();
  });

  app.get('/library', { preHandler: [app.requirePermission('MANAGE_LIBRARY')] }, async () => {
    return getAdminLibraryHealth();
  });

  app.post('/library/sync-episodes', { preHandler: [app.requirePermission('MANAGE_LIBRARY')] }, async (request) => {
    const result = await syncMissingShowEpisodes();
    await writeAuditEvent({ actorId: request.account!.id, action: 'LIBRARY_EPISODES_SYNCED', targetType: 'LIBRARY', details: result });
    return result;
  });

  app.post('/library/analyze-missing', { preHandler: [app.requirePermission('MANAGE_LIBRARY')] }, async (request) => {
    const result = await analyzeMissingLibraryMedia();
    await writeAuditEvent({ actorId: request.account!.id, action: 'LIBRARY_ANALYZED', targetType: 'LIBRARY', details: result });
    return result;
  });

  app.post('/library/episodes/:episodeId/clear-missing-file', { preHandler: [app.requirePermission('MANAGE_LIBRARY')] }, async (request) => {
    const { episodeId } = request.params as { episodeId: string };
    const result = await clearMissingEpisodeFile(episodeId);
    await writeAuditEvent({ actorId: request.account!.id, action: 'MISSING_EPISODE_PATH_CLEARED', targetType: 'EPISODE', targetId: episodeId, details: result });
    return result;
  });

  app.post('/library/:id/sync-episodes', { preHandler: [app.requirePermission('MANAGE_LIBRARY')] }, async (request) => {
    const { id } = request.params as { id: string };
    const result = await syncShowEpisodes(id);
    await writeAuditEvent({ actorId: request.account!.id, action: 'SHOW_EPISODES_SYNCED', targetType: 'MEDIA_ITEM', targetId: id, details: result });
    return result;
  });

  app.post('/library/:id/seasons/:season/sync-episodes', { preHandler: [app.requirePermission('MANAGE_LIBRARY')] }, async (request) => {
    const { id, season: rawSeason } = request.params as { id: string; season: string };
    const season = Number(rawSeason);
    if (!Number.isInteger(season) || season <= 0) {
      throw ApiError.badRequest('Season must be a positive integer', 'INVALID_SEASON');
    }
    const result = await syncShowEpisodes(id, { season });
    await writeAuditEvent({ actorId: request.account!.id, action: 'SEASON_EPISODES_SYNCED', targetType: 'MEDIA_ITEM', targetId: id, details: { season, ...result } });
    return result;
  });

  app.post('/library/:id/analyze', { preHandler: [app.requirePermission('MANAGE_LIBRARY')] }, async (request) => {
    const { id } = request.params as { id: string };
    const result = await analyzeLibraryItem(id);
    await writeAuditEvent({ actorId: request.account!.id, action: 'MEDIA_ANALYZED', targetType: 'MEDIA_ITEM', targetId: id, details: result });
    return result;
  });

  app.post('/library/:id/clear-missing-file', { preHandler: [app.requirePermission('MANAGE_LIBRARY')] }, async (request) => {
    const { id } = request.params as { id: string };
    const result = await clearMissingLibraryFile(id);
    await writeAuditEvent({ actorId: request.account!.id, action: 'MISSING_MEDIA_PATH_CLEARED', targetType: 'MEDIA_ITEM', targetId: id, details: result });
    return result;
  });
};
