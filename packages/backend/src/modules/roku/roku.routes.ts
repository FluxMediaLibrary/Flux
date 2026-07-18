import type { FastifyPluginAsync } from 'fastify';
import type {
  RokuClientConfigDTO,
  RokuProfileDTO,
  RokuProfilesDTO,
  RokuVersionDTO,
  SelectRokuProfileResponse,
} from '@flux/shared';
import { AVATAR_PRESETS } from '@flux/shared';
import { z } from 'zod';
import { config } from '../../config.js';
import { prisma } from '../../lib/db.js';
import { ApiError } from '../../lib/errors.js';
import { rotateSessionForProfile } from '../auth/device-auth.service.js';
import { toAccountDTO, toProfileDTO } from '../auth/auth.service.js';
import { listMyRequests } from '../requests/requests.service.js';
import {
  getRokuEpisodes,
  getRokuEpisodeDetail,
  getRokuHome,
  getRokuHomeRow,
  getRokuLibrary,
  getRokuMediaDetail,
  getRokuSeasons,
  searchRokuLibrary,
} from './roku.service.js';
import {
  assertPlaybackAccess,
  getRokuSubtitle,
  nextRokuPlayback,
  refreshRokuPlayback,
  resolveRokuPlayback,
  stopRokuPlayback,
  updateRokuPlayback,
} from './roku-playback.service.js';

const selectProfileSchema = z.object({ profileId: z.string().trim().min(1).max(128) });
const pageSchema = z.object({
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  limit: z.coerce.number().int().min(1).max(60).default(30),
  sort: z.enum(['title', 'recent', 'year']).default('title'),
  direction: z.enum(['asc', 'desc']).optional(),
  genre: z.string().trim().min(1).max(64).optional(),
  watched: z.enum(['true', 'false']).transform((value) => value === 'true').optional(),
});
const searchSchema = z.object({ q: z.string().trim().min(2).max(100) });
const mediaParamsSchema = z.object({ id: z.string().trim().min(1).max(128) });
const seasonParamsSchema = mediaParamsSchema.extend({ season: z.coerce.number().int().min(0).max(1_000) });
const capabilitiesSchema = z.object({
  model: z.string().trim().min(1).max(100),
  firmware: z.string().trim().min(1).max(100),
  supports4k: z.boolean(),
  supportsHevc: z.boolean(),
  supportsHdr10: z.boolean(),
  maxBitrate: z.number().int().min(500_000).max(200_000_000),
});
const resolvePlaybackSchema = z.object({
  mediaItemId: z.string().trim().min(1).max(128),
  episodeId: z.string().trim().min(1).max(128).optional(),
  positionSeconds: z.number().finite().min(0).optional(),
  audioStreamIndex: z.number().int().min(0).optional(),
  subtitleStreamIndex: z.number().int().min(0).optional(),
  preferredAudioLanguage: z.string().trim().min(2).max(16).optional(),
  preferredSubtitleLanguage: z.string().trim().min(2).max(16).optional(),
  subtitlesEnabled: z.boolean().optional(),
  capabilities: capabilitiesSchema,
});
const progressSchema = z.object({
  sessionId: z.string().trim().min(1).max(128),
  positionSeconds: z.number().finite().min(0),
  durationSeconds: z.number().finite().positive().optional(),
  state: z.enum(['playing', 'paused', 'buffering']).optional(),
});
const stopSchema = progressSchema.omit({ state: true }).extend({ reason: z.enum(['ended', 'back', 'error', 'idle']).optional() });
const sessionSchema = z.object({
  sessionId: z.string().trim().min(1).max(128),
  positionSeconds: z.coerce.number().finite().min(0).optional(),
});
const subtitleParamsSchema = z.object({
  sessionId: z.string().trim().min(1).max(128),
  streamIndex: z.coerce.number().int().min(0).max(1_000),
});

function avatarUrl(avatar: string | null): string | null {
  if (!avatar) return null;
  const preset = AVATAR_PRESETS.find((candidate) => candidate.id === avatar);
  return preset ? new URL(`/avatars/${preset.file}`, config.FRONTEND_ORIGIN).toString() : null;
}

function mapProfile(profile: Parameters<typeof toProfileDTO>[0]): RokuProfileDTO {
  return { ...toProfileDTO(profile), avatarUrl: avatarUrl(profile.avatar) };
}

export const rokuRoutes: FastifyPluginAsync = async (app) => {
  app.get('/profiles', { preHandler: [app.requireDeviceAuth] }, async (request): Promise<RokuProfilesDTO> => {
    const account = await prisma.user.findUnique({
      where: { id: request.account!.id },
      include: { profiles: { orderBy: { createdAt: 'asc' } } },
    });
    if (!account) throw ApiError.unauthorized('Account not found');
    return { account: toAccountDTO(account), profiles: account.profiles.map(mapProfile) };
  });

  app.post('/profiles/select', { preHandler: [app.requireDeviceAuth] }, async (request): Promise<SelectRokuProfileResponse> => {
    const { profileId } = selectProfileSchema.parse(request.body);
    const profile = await prisma.profile.findFirst({ where: { id: profileId, userId: request.account!.id } });
    if (!profile) throw ApiError.notFound('Profile not found');
    const tokens = await rotateSessionForProfile(request.deviceSessionId!, request.account!.id, profile.id);
    return { ...tokens, profile: mapProfile(profile) };
  });

  const profileHandlers = [app.requireDeviceAuth, app.requireProfile];

  app.get('/home', { preHandler: profileHandlers }, async (request) => {
    return getRokuHome(request.activeProfileId!, config.ROKU_ROW_ORDER.split(',').map((value) => value.trim()).filter(Boolean));
  });

  app.get('/home/rows/:id', { preHandler: profileHandlers }, async (request) => {
    const { id } = mediaParamsSchema.parse(request.params);
    const order = config.ROKU_ROW_ORDER.split(',').map((value) => value.trim()).filter(Boolean);
    return { row: await getRokuHomeRow(request.activeProfileId!, order, id) };
  });

  app.get('/requests', { preHandler: profileHandlers }, async (request) => {
    if (!config.ROKU_FEATURE_REQUESTS) throw ApiError.notFound('Requests are disabled for Roku clients', 'ROKU_FEATURE_DISABLED');
    return { requests: await listMyRequests(request.activeProfileId!) };
  });

  app.get('/library/movies', { preHandler: profileHandlers }, async (request) => {
    const { page, limit, sort, direction, genre, watched } = pageSchema.parse(request.query);
    return getRokuLibrary(request.activeProfileId!, 'MOVIE', page, limit, sort, direction, genre, watched);
  });

  app.get('/library/shows', { preHandler: profileHandlers }, async (request) => {
    const { page, limit, sort, direction, genre, watched } = pageSchema.parse(request.query);
    return getRokuLibrary(request.activeProfileId!, 'SHOW', page, limit, sort, direction, genre, watched);
  });

  app.get('/search', { preHandler: profileHandlers }, async (request) => {
    const { q } = searchSchema.parse(request.query);
    return searchRokuLibrary(request.activeProfileId!, q);
  });

  app.get('/media/:id', { preHandler: profileHandlers }, async (request) => {
    const { id } = mediaParamsSchema.parse(request.params);
    return getRokuMediaDetail(request.activeProfileId!, id);
  });

  app.get('/episodes/:id', { preHandler: profileHandlers }, async (request) => {
    const { id } = mediaParamsSchema.parse(request.params);
    return getRokuEpisodeDetail(request.activeProfileId!, id);
  });

  app.get('/shows/:id/seasons', { preHandler: profileHandlers }, async (request) => {
    const { id } = mediaParamsSchema.parse(request.params);
    return getRokuSeasons(request.activeProfileId!, id);
  });

  app.get('/shows/:id/seasons/:season/episodes', { preHandler: profileHandlers }, async (request) => {
    const { id, season } = seasonParamsSchema.parse(request.params);
    return getRokuEpisodes(request.activeProfileId!, id, season);
  });

  const playbackIdentity = (request: Parameters<typeof resolveRokuPlayback>[0] & {
    account?: { id: string; role: 'ADMIN' | 'MEMBER' };
    activeProfileId?: string;
    deviceSessionId?: string;
  }) => ({
    accountId: request.account!.id,
    role: request.account!.role,
    profileId: request.activeProfileId!,
    deviceSessionId: request.deviceSessionId!,
  });

  app.post('/playback/resolve', { preHandler: profileHandlers }, async (request) => {
    const body = resolvePlaybackSchema.parse(request.body);
    return resolveRokuPlayback(request, playbackIdentity(request), body);
  });

  app.post('/playback/progress', { preHandler: profileHandlers }, async (request) => {
    return updateRokuPlayback(playbackIdentity(request), progressSchema.parse(request.body));
  });

  app.post('/playback/stop', { preHandler: profileHandlers }, async (request) => {
    return stopRokuPlayback(playbackIdentity(request), stopSchema.parse(request.body));
  });

  app.post('/playback/refresh', { preHandler: profileHandlers }, async (request) => {
    const { sessionId, positionSeconds } = sessionSchema.parse(request.body);
    return refreshRokuPlayback(request, playbackIdentity(request), sessionId, positionSeconds);
  });

  app.get('/playback/next', { preHandler: profileHandlers }, async (request) => {
    const { sessionId } = sessionSchema.parse(request.query);
    return { next: await nextRokuPlayback(playbackIdentity(request), sessionId) };
  });

  app.get('/playback/subtitles/:sessionId/:streamIndex', { preHandler: [app.requireProfileStream] }, async (request, reply) => {
    if (!config.ROKU_FEATURE_SUBTITLES) throw ApiError.notFound('Subtitles are disabled for Roku clients', 'ROKU_FEATURE_DISABLED');
    const { sessionId, streamIndex } = subtitleParamsSchema.parse(request.params);
    if (!request.playback || request.playback.playbackSessionId !== sessionId) {
      throw ApiError.forbidden('Subtitle token does not match this session', 'PLAYBACK_SCOPE_INVALID');
    }
    await assertPlaybackAccess(request, request.playback.mediaItemId, request.playback.episodeId);
    reply.header('Content-Type', 'text/vtt; charset=utf-8').header('Cache-Control', 'private, max-age=3600');
    return reply.send(await getRokuSubtitle(sessionId, streamIndex));
  });
};

export const rokuClientRoutes: FastifyPluginAsync = async (app) => {
  app.get('/roku/version', async (): Promise<RokuVersionDTO> => ({
    minimumVersion: config.ROKU_MIN_VERSION,
    latestVersion: config.ROKU_LATEST_VERSION,
    updateRequired: false,
    updateAvailable: false,
    message: config.ROKU_UPDATE_MESSAGE,
    releaseNotes: config.ROKU_RELEASE_NOTES.split('|').map((value) => value.trim()).filter(Boolean),
  }));

  app.get('/roku/config', async (): Promise<RokuClientConfigDTO> => ({
    apiVersion: 1,
    features: {
      profiles: true,
      profilePins: false,
      requests: config.ROKU_FEATURE_REQUESTS,
      skipIntro: config.ROKU_FEATURE_SKIP_INTRO,
      subtitles: config.ROKU_FEATURE_SUBTITLES,
      audioTracks: config.ROKU_FEATURE_AUDIO_TRACKS,
    },
    rowOrder: config.ROKU_ROW_ORDER.split(',').map((value) => value.trim()).filter(Boolean),
    minimumServerVersion: '0.1.0',
    playbackDefaults: {
      maxBitrate: 20_000_000,
      progressIntervalSeconds: 15,
      completionThreshold: 0.92,
    },
    loggingLevel: config.ROKU_LOG_LEVEL,
    announcement: config.ROKU_ANNOUNCEMENT ?? null,
    ui: {
      heroRotationSeconds: config.ROKU_HERO_ROTATION_SECONDS,
    },
  }));
};
