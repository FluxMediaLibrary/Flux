import type { FastifyPluginAsync } from 'fastify';
import { ApiError } from '../../lib/errors.js';
import { writeAuditEvent } from '../admin/admin-control.service.js';
import {
  saveDownloadClientSchema,
  saveQualityProfileSchema,
  selectReleaseSchema,
  queueUsenetReleaseSchema,
  testReleaseSchema,
  updateSettingsSchema,
} from './settings.schema.js';
import {
  deleteDownloadClient,
  deleteQualityProfile,
  getQualityProfile,
  getSettingsBundle,
  listDownloadClients,
  listQualityProfiles,
  saveDownloadClient,
  saveQualityProfile,
  testDownloadClient,
  updateSettings,
} from './settings.service.js';
import { scoreRelease, selectRelease } from './release-quality.js';
import { enqueueUsenetDownload, resolveUsenetClient } from './usenet-maintenance.js';

export const settingsRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', app.requirePermission('CHANGE_SETTINGS'));

  app.get('/', async () => getSettingsBundle());
  app.put('/', async (request) => {
    const body = updateSettingsSchema.parse(request.body);
    const result = await updateSettings(body);
    await writeAuditEvent({
      actorId: request.account!.id,
      action: 'SERVER_SETTINGS_CHANGED',
      targetType: 'SETTINGS',
      targetId: Object.keys(body).sort().join(','),
      details: { sections: Object.keys(body).sort() },
    });
    return result;
  });

  app.get('/download-clients', async () => listDownloadClients());
  app.post('/download-clients', async (request) => {
    const body = saveDownloadClientSchema.parse(request.body);
    const result = await saveDownloadClient(body);
    await writeAuditEvent({ actorId: request.account!.id, action: 'DOWNLOAD_CLIENT_CREATED', targetType: 'DOWNLOAD_CLIENT', targetId: result.id, targetLabel: result.name, details: { type: result.type } });
    return result;
  });
  app.put<{ Params: { id: string } }>('/download-clients/:id', async (request) => {
    const body = saveDownloadClientSchema.parse(request.body);
    const result = await saveDownloadClient(body, request.params.id);
    await writeAuditEvent({ actorId: request.account!.id, action: 'DOWNLOAD_CLIENT_CHANGED', targetType: 'DOWNLOAD_CLIENT', targetId: result.id, targetLabel: result.name, details: { type: result.type, enabled: result.enabled } });
    return result;
  });
  app.delete<{ Params: { id: string } }>('/download-clients/:id', async (request) => {
    await deleteDownloadClient(request.params.id);
    await writeAuditEvent({ actorId: request.account!.id, action: 'DOWNLOAD_CLIENT_DELETED', targetType: 'DOWNLOAD_CLIENT', targetId: request.params.id });
    return { ok: true };
  });
  app.post<{ Params: { id: string } }>('/download-clients/:id/test', async (request) => {
    const result = await testDownloadClient(request.params.id);
    await writeAuditEvent({ actorId: request.account!.id, action: 'DOWNLOAD_CLIENT_TESTED', targetType: 'DOWNLOAD_CLIENT', targetId: request.params.id, result: result.ok ? 'SUCCESS' : 'FAILURE', details: { ok: result.ok } });
    return result;
  });

  app.get('/quality-profiles', async () => listQualityProfiles());
  app.post('/quality-profiles', async (request) => {
    const body = saveQualityProfileSchema.parse(request.body);
    const result = await saveQualityProfile(body);
    await writeAuditEvent({ actorId: request.account!.id, action: 'QUALITY_PROFILE_CREATED', targetType: 'QUALITY_PROFILE', targetId: result.id, targetLabel: result.name });
    return result;
  });
  app.put<{ Params: { id: string } }>('/quality-profiles/:id', async (request) => {
    const body = saveQualityProfileSchema.parse(request.body);
    const result = await saveQualityProfile(body, request.params.id);
    await writeAuditEvent({ actorId: request.account!.id, action: 'QUALITY_PROFILE_CHANGED', targetType: 'QUALITY_PROFILE', targetId: result.id, targetLabel: result.name });
    return result;
  });
  app.delete<{ Params: { id: string } }>('/quality-profiles/:id', async (request) => {
    await deleteQualityProfile(request.params.id);
    await writeAuditEvent({ actorId: request.account!.id, action: 'QUALITY_PROFILE_DELETED', targetType: 'QUALITY_PROFILE', targetId: request.params.id });
    return { ok: true };
  });
  app.post<{ Params: { id: string } }>('/quality-profiles/:id/test-release', async (request) => {
    const body = testReleaseSchema.parse(request.body);
    return scoreRelease(await getQualityProfile(request.params.id), body.title, body.sizeMb ?? null);
  });
  app.post<{ Params: { id: string } }>('/quality-profiles/:id/select-release', async (request) => {
    const body = selectReleaseSchema.parse(request.body);
    return selectRelease(await getQualityProfile(request.params.id), body.candidates, body.currentScore ?? null);
  });
  app.post<{ Params: { id: string } }>('/quality-profiles/:id/queue-usenet-release', async (request) => {
    const body = queueUsenetReleaseSchema.parse(request.body);
    const profile = await getQualityProfile(request.params.id);
    const selection = selectRelease(
      profile,
      body.candidates.map(({ nzbUrl: _nzbUrl, ...candidate }) => candidate),
      body.currentScore ?? null,
    );
    if (!selection.selected || !selection.upgradeAllowed) {
      throw ApiError.badRequest(selection.reason, 'NO_RELEASE_SELECTED');
    }
    const source = body.candidates.find((candidate) => candidate.id === selection.selected!.id)!;
    const client = await resolveUsenetClient(body.downloadClientId);
    const jobId = await enqueueUsenetDownload(client, source.nzbUrl, source.title);
    await writeAuditEvent({
      actorId: request.account!.id,
      action: 'USENET_RELEASE_QUEUED',
      targetType: 'DOWNLOAD_CLIENT',
      targetId: client.id,
      targetLabel: client.name,
      details: { profileId: profile.id, releaseId: source.id, score: selection.selected.result.totalScore },
    });
    return {
      clientId: client.id,
      clientName: client.name,
      jobId,
      release: { id: source.id, title: source.title, sizeMb: source.sizeMb ?? null, score: selection.selected.result.totalScore },
    };
  });
};
