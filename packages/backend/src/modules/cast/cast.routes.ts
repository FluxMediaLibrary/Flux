import type { FastifyPluginAsync } from 'fastify';
import type { CastPlaybackInfoDTO, CreateCastSessionRequest } from '@flux/shared';
import { config } from '../../config.js';
import { ApiError } from '../../lib/errors.js';
import { createCastSession } from '../../lib/cast-sessions.js';
import { signCastPlaybackToken } from '../../lib/jwt.js';
import { decideCastPlayback, getCastMediaMetadata, getMediaFilePath } from '../streaming/streaming.service.js';

function publicApiBaseUrl(request: { protocol: string; headers: { host?: string } }): { baseUrl: string; warnings: string[] } {
  const inferred = request.headers.host ? `${request.protocol}://${request.headers.host}` : '';
  const baseUrl = (config.PUBLIC_API_BASE_URL ?? inferred).replace(/\/$/, '');
  if (!baseUrl) throw ApiError.internal('Could not determine public API base URL for Cast playback', 'CAST_PUBLIC_URL_MISSING');
  const parsed = new URL(baseUrl);
  const warnings: string[] = [];
  if (['localhost', '127.0.0.1', '::1'].includes(parsed.hostname)) warnings.push('Cast receivers cannot reach localhost URLs. Configure PUBLIC_API_BASE_URL with a TV-reachable HTTPS or LAN address.');
  if (parsed.protocol !== 'https:' && !['localhost', '127.0.0.1'].includes(parsed.hostname)) warnings.push('The TV may reject this insecure server URL. Configure HTTPS for production Cast playback.');
  return { baseUrl, warnings };
}

export const castRoutes: FastifyPluginAsync = async (app) => {
  app.post<{ Body: CreateCastSessionRequest }>('/sessions', { preHandler: [app.requireProfile] }, async (request): Promise<CastPlaybackInfoDTO> => {
    const body = request.body;
    if (!body || typeof body.mediaItemId !== 'string' || !body.mediaItemId.trim() || body.mediaItemId.length > 128) throw ApiError.badRequest('A valid media item is required', 'CAST_MEDIA_INVALID');
    if (body.episodeId !== undefined && (typeof body.episodeId !== 'string' || !body.episodeId.trim() || body.episodeId.length > 128)) throw ApiError.badRequest('The episode identifier is invalid', 'CAST_EPISODE_INVALID');
    const position = Number(body.positionSeconds ?? 0);
    if (!Number.isFinite(position) || position < 0) throw ApiError.badRequest('The Cast start position is invalid', 'CAST_POSITION_INVALID');

    const mediaItemId = body.mediaItemId.trim();
    const episodeId = body.episodeId?.trim() || undefined;
    const { filePath } = await getMediaFilePath(mediaItemId, episodeId);
    const decision = await decideCastPlayback(filePath, mediaItemId, episodeId);
    const metadata = await getCastMediaMetadata(mediaItemId, episodeId);
    const inferred = request.headers.host ? `${request.protocol}://${request.headers.host}` : '';
    const baseUrl = (config.PUBLIC_API_BASE_URL ?? inferred).replace(/\/$/, '');
    if (!baseUrl) throw ApiError.internal('Could not determine public API base URL for Cast playback', 'CAST_PUBLIC_URL_MISSING');
    const parsedBase = new URL(baseUrl);
    const warnings: string[] = [];
    if (['localhost', '127.0.0.1', '::1'].includes(parsedBase.hostname)) warnings.push('Cast receivers cannot reach localhost URLs. Configure PUBLIC_API_BASE_URL with a TV-reachable HTTPS or LAN address.');
    if (parsedBase.protocol !== 'https:' && !['localhost', '127.0.0.1'].includes(parsedBase.hostname)) warnings.push('The TV may reject this insecure server URL. Configure HTTPS for production Cast playback.');
    const expiresAt = new Date(Date.now() + config.CAST_SESSION_TTL_SECONDS * 1000);
    const session = createCastSession({ accountId: request.account!.id, profileId: request.activeProfileId!, mediaItemId, episodeId, expiresAt });
    const token = signCastPlaybackToken({ sub: request.account!.id, role: request.account!.role, activeProfileId: request.activeProfileId! }, { castSessionId: session.id, mediaItemId, episodeId }, `${config.CAST_SESSION_TTL_SECONDS}s`);
    const params = new URLSearchParams({ token, castSessionId: session.id });
    if (episodeId) params.set('episodeId', episodeId);
    if (decision.method === 'hls' && position > 0) params.set('startTime', position.toFixed(3));
    const streamPath = decision.method === 'direct' ? `/api/stream/${encodeURIComponent(mediaItemId)}` : `/api/stream/${encodeURIComponent(mediaItemId)}/hls/index.m3u8`;
    const url = `${baseUrl}${streamPath}?${params.toString()}`;
    request.log.info({ castSessionId: session.id, mediaItemId, episodeId, method: decision.method, contentType: decision.contentType, playbackHost: new URL(url).host }, '[Cast] created scoped playback session');
    return { sessionId: session.id, url, contentType: decision.contentType, streamType: 'BUFFERED', method: decision.method, title: metadata.title, subtitle: metadata.subtitle, posterUrl: metadata.posterPath ? `https://image.tmdb.org/t/p/w342${metadata.posterPath}` : null, durationSeconds: decision.durationSeconds, expiresAt: expiresAt.toISOString(), warnings };
  });
};
