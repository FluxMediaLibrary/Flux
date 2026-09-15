/**
 * Roku routes.
 *   /api/roku/*     — content + playback, requires a linked device with a profile
 *   /api/clients/*  — version/config for the Roku client (public)
 */
import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { ApiError } from '../../lib/errors.js';
import { config } from '../../config.js';
import { toAccountDTO, toProfileDTO } from '../auth/auth.service.js';
import { prisma } from '../../lib/db.js';
import { selectDeviceProfile } from '../devices/device-auth.service.js';
import { getServerSettings } from '../settings/settings.service.js';
import {
  nextRokuPlayback,
  recordRokuProgress,
  refreshRokuPlayback,
  resolveRokuPlayback,
  rokuEpisodeDetail,
  rokuHome,
  rokuHomeRow,
  rokuLibrary,
  rokuMediaDetail,
  rokuRequests,
  rokuSearch,
  rokuSeasonEpisodes,
  stopRokuPlayback,
} from './roku.service.js';

/** Bump when the Roku channel gains a feature the server must support. */
export const ROKU_CLIENT = {
  minimumVersion: '1.0.11',
  latestVersion: '1.1.0',
  minimumServerVersion: '0.1.0',
  releaseNotes: [
    'Season episode lists load again.',
    'Playback sessions appear in the Flux admin dashboard.',
    'Text subtitles (SRT/ASS) can be shown on the TV.',
  ],
};

const librarySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(60).default(30),
  sort: z.enum(['title', 'recent', 'year']).default('title'),
  watched: z.enum(['all', 'true', 'false']).default('all'),
  genre: z.string().trim().max(80).optional(),
});
const searchSchema = z.object({ q: z.string().trim().min(2).max(200) });
const capabilitiesSchema = z.object({
  model: z.string().max(80).optional(),
  firmware: z.string().max(80).optional(),
  supports4k: z.boolean().optional(),
  supportsHevc: z.boolean().optional(),
  supportsHdr10: z.boolean().optional(),
  maxBitrate: z.number().int().positive().optional(),
}).passthrough();
const resolveSchema = z.object({
  mediaItemId: z.string().trim().min(1).max(128),
  episodeId: z.string().trim().min(1).max(128).optional(),
  positionSeconds: z.number().finite().min(0).optional(),
  audioStreamIndex: z.number().int().min(0).optional(),
  subtitleStreamIndex: z.number().int().min(0).optional(),
  subtitlesEnabled: z.boolean().optional(),
  preferredAudioLanguage: z.string().trim().max(40).optional(),
  preferredSubtitleLanguage: z.string().trim().max(40).optional(),
  capabilities: capabilitiesSchema.optional(),
}).passthrough();
const progressSchema = z.object({
  sessionId: z.string().trim().min(1).max(128),
  positionSeconds: z.number().finite().min(0),
  durationSeconds: z.number().finite().positive().nullish(),
  state: z.string().max(20).optional(),
}).passthrough();
const stopSchema = z.object({
  sessionId: z.string().trim().min(1).max(128),
  positionSeconds: z.number().finite().min(0).optional(),
  durationSeconds: z.number().finite().positive().nullish(),
  reason: z.string().max(20).optional(),
}).passthrough();
const refreshSchema = z.object({ sessionId: z.string().trim().min(1).max(128), positionSeconds: z.number().finite().min(0).optional() }).passthrough();

function deviceContext(request: FastifyRequest) {
  const account = request.account!;
  if (!account.deviceSessionId) throw ApiError.forbidden('This API is for linked TV devices', 'DEVICE_REQUIRED');
  return { accountId: account.id, role: account.role, profileId: request.activeProfileId!, deviceSessionId: account.deviceSessionId };
}

export const rokuRoutes: FastifyPluginAsync = async (app) => {
  // Profile selection happens before a profile is active, so only requireAuth.
  app.get('/profiles', { preHandler: [app.requireAuth] }, async (request) => {
    const user = await prisma.user.findUnique({ where: { id: request.account!.id }, include: { profiles: { orderBy: { createdAt: 'asc' } } } });
    if (!user) throw ApiError.unauthorized();
    return {
      account: toAccountDTO(user),
      profiles: user.profiles.map((profile) => ({ ...toProfileDTO(profile), avatarUrl: profile.avatar })),
    };
  });

  app.post('/profiles/select', { preHandler: [app.requireAuth] }, async (request) => {
    const { profileId } = z.object({ profileId: z.string().trim().min(1).max(128) }).parse(request.body);
    const sessionId = request.account!.deviceSessionId;
    if (!sessionId) throw ApiError.forbidden('This API is for linked TV devices', 'DEVICE_REQUIRED');
    const tokens = await selectDeviceProfile(sessionId, profileId);
    const profile = await prisma.profile.findUnique({ where: { id: profileId } });
    return { ...tokens, profile: profile ? { ...toProfileDTO(profile), avatarUrl: profile.avatar } : null };
  });

  app.register(async (scoped) => {
    scoped.addHook('preHandler', scoped.requireProfile);

    scoped.get('/home', async (request) => rokuHome(request.activeProfileId!));
    scoped.get<{ Params: { rowId: string } }>('/home/rows/:rowId', async (request) => rokuHomeRow(request.activeProfileId!, request.params.rowId));

    scoped.get('/library/movies', async (request) => {
      const query = librarySchema.parse(request.query ?? {});
      return rokuLibrary(request.activeProfileId!, 'MOVIE', { ...query, genre: query.genre || null });
    });
    scoped.get('/library/shows', async (request) => {
      const query = librarySchema.parse(request.query ?? {});
      return rokuLibrary(request.activeProfileId!, 'SHOW', { ...query, genre: query.genre || null });
    });

    scoped.get('/search', async (request) => {
      const { q } = searchSchema.parse(request.query ?? {});
      return rokuSearch(request.activeProfileId!, q);
    });

    scoped.get('/requests', async (request) => rokuRequests(request.activeProfileId!));

    scoped.get<{ Params: { id: string } }>('/media/:id', async (request) => rokuMediaDetail(request.params.id, request.activeProfileId!));
    scoped.get<{ Params: { id: string; season: string } }>('/shows/:id/seasons/:season/episodes', async (request) => {
      const season = Number(request.params.season);
      if (!Number.isInteger(season) || season < 0) throw ApiError.badRequest('Invalid season');
      return rokuSeasonEpisodes(request.params.id, season, request.activeProfileId!);
    });
    scoped.get<{ Params: { id: string } }>('/episodes/:id', async (request) => rokuEpisodeDetail(request.params.id, request.activeProfileId!));

    scoped.post('/playback/resolve', async (request) => {
      const body = resolveSchema.parse(request.body);
      return resolveRokuPlayback(deviceContext(request), body, request);
    });
    scoped.post('/playback/progress', async (request) => recordRokuProgress(deviceContext(request), progressSchema.parse(request.body)));
    scoped.post('/playback/stop', async (request) => stopRokuPlayback(deviceContext(request), stopSchema.parse(request.body)));
    scoped.post('/playback/refresh', async (request) => refreshRokuPlayback(deviceContext(request), refreshSchema.parse(request.body), request));
    scoped.get('/playback/next', async (request) => {
      const { sessionId } = z.object({ sessionId: z.string().trim().min(1).max(128) }).parse(request.query ?? {});
      return nextRokuPlayback(deviceContext(request), sessionId);
    });
  });
};

export const rokuClientRoutes: FastifyPluginAsync = async (app) => {
  app.get('/roku/version', async () => ({
    minimumVersion: ROKU_CLIENT.minimumVersion,
    latestVersion: ROKU_CLIENT.latestVersion,
    message: `Flux Roku ${ROKU_CLIENT.latestVersion} is available.`,
    releaseNotes: ROKU_CLIENT.releaseNotes,
  }));
  app.get('/roku/config', async () => {
    const settings = await getServerSettings();
    return {
      minimumServerVersion: ROKU_CLIENT.minimumServerVersion,
      serverVersion: config.FLUX_SERVER_VERSION,
      features: { requests: true, search: true, skipIntro: settings.skipIntroEnabled, autoplay: settings.autoplayEnabled },
      ui: { heroRotationSeconds: 8 },
      announcement: null,
    };
  });
};
