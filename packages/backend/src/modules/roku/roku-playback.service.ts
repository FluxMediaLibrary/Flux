import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type {
  ResolveRokuPlaybackRequest,
  RokuNextPlaybackDTO,
  RokuPlaybackProgressRequest,
  RokuPlaybackSessionDTO,
  RokuPlaybackStopRequest,
  RokuPlaybackTrackDTO,
  Role,
} from '@flux/shared';
import type { PlaybackSession } from '@prisma/client';
import type { FastifyRequest } from 'fastify';
import { config } from '../../config.js';
import { prisma } from '../../lib/db.js';
import { ApiError } from '../../lib/errors.js';
import { signPlaybackToken } from '../../lib/jwt.js';
import { saveProgress } from '../library/library.service.js';
import { getMediaFilePath, getPlaybackInfo } from '../streaming/streaming.service.js';
import { selectRokuPlaybackMethod } from './roku-playback-policy.js';

const execFileAsync = promisify(execFile);
const EXTERNAL_SUBTITLE_INDEX = 100_000;

interface SidecarSubtitle {
  index: number;
  filePath: string;
  language: string | null;
  title: string;
}

async function findSidecarSubtitles(mediaFilePath: string): Promise<SidecarSubtitle[]> {
  const directory = path.dirname(mediaFilePath);
  const stem = path.basename(mediaFilePath, path.extname(mediaFilePath));
  let names: string[];
  try {
    names = await fs.promises.readdir(directory);
  } catch {
    return [];
  }
  return names
    .filter((name) => {
      const lower = name.toLowerCase();
      return (lower === `${stem.toLowerCase()}.srt` || lower.startsWith(`${stem.toLowerCase()}.`)) && ['.srt', '.vtt', '.ass', '.ssa'].includes(path.extname(lower));
    })
    .sort((left, right) => left.localeCompare(right))
    .map((name, offset) => {
      const suffix = path.basename(name, path.extname(name)).slice(stem.length).replace(/^\./, '');
      const language = suffix.split('.')[0]?.trim() || null;
      return { index: EXTERNAL_SUBTITLE_INDEX + offset, filePath: path.join(directory, name), language, title: language ? `${language} (external)` : 'External subtitles' };
    });
}

interface PlaybackIdentity {
  accountId: string;
  role: Role;
  profileId: string;
  deviceSessionId: string;
}

function publicApiBaseUrl(request: { protocol: string; headers: { host?: string } }): { baseUrl: string; warnings: string[] } {
  const inferred = request.headers.host ? `${request.protocol}://${request.headers.host}` : '';
  const baseUrl = (config.PUBLIC_API_BASE_URL ?? inferred).replace(/\/$/, '');
  if (!baseUrl) throw ApiError.internal('Could not determine a Roku-reachable API URL', 'ROKU_PUBLIC_URL_MISSING');
  const parsed = new URL(baseUrl);
  const warnings: string[] = [];
  if (['localhost', '127.0.0.1', '::1'].includes(parsed.hostname)) warnings.push('This media URL points to localhost and will not be reachable from a physical Roku.');
  if (parsed.protocol !== 'https:' && !['localhost', '127.0.0.1'].includes(parsed.hostname)) warnings.push('Use HTTPS for production Roku playback.');
  return { baseUrl, warnings };
}

async function resolveEpisode(mediaItemId: string, requestedEpisodeId: string | undefined, profileId: string): Promise<string | undefined> {
  if (requestedEpisodeId) {
    const episode = await prisma.episode.findFirst({ where: { id: requestedEpisodeId, mediaItemId, filePath: { not: null } }, select: { id: true } });
    if (!episode) throw ApiError.notFound('The selected episode is unavailable');
    return episode.id;
  }
  const item = await prisma.mediaItem.findUnique({ where: { id: mediaItemId }, select: { type: true } });
  if (!item) throw ApiError.notFound('Media item not found');
  if (item.type === 'MOVIE') return undefined;

  const resumed = await prisma.watchProgress.findFirst({
    where: { profileId, completed: false, positionSeconds: { gt: 0 }, episode: { mediaItemId, filePath: { not: null } } },
    orderBy: { updatedAt: 'desc' },
    select: { episodeId: true },
  });
  if (resumed?.episodeId) return resumed.episodeId;
  const first = await prisma.episode.findFirst({
    where: { mediaItemId, filePath: { not: null } },
    orderBy: [{ season: 'asc' }, { episode: 'asc' }],
    select: { id: true },
  });
  if (!first) throw ApiError.notFound('This show has no playable episodes');
  return first.id;
}

function createToken(identity: PlaybackIdentity, session: PlaybackSession): string {
  return signPlaybackToken(
    { sub: identity.accountId, role: identity.role, activeProfileId: identity.profileId },
    { playbackSessionId: session.id, mediaItemId: session.mediaItemId, episodeId: session.episodeId ?? undefined },
    `${Math.max(60, Math.floor((session.expiresAt.getTime() - Date.now()) / 1000))}s`,
  );
}

function createPlaybackUrl(baseUrl: string, session: PlaybackSession, token: string): string {
  const isDirect = session.method === 'direct';
  const route = isDirect
    ? `/api/stream/${encodeURIComponent(session.mediaItemId)}`
    : `/api/stream/${encodeURIComponent(session.mediaItemId)}/hls/index.m3u8`;
  const params = new URLSearchParams({ token, playbackSessionId: session.id });
  if (session.episodeId) params.set('episodeId', session.episodeId);
  if (session.audioStreamIndex != null) params.set('audioStream', String(session.audioStreamIndex));
  if (!isDirect && session.positionSeconds > 0) params.set('startTime', session.positionSeconds.toFixed(3));
  return `${baseUrl}${route}?${params.toString()}`;
}

function mapTracks(streams: Awaited<ReturnType<typeof getPlaybackInfo>>['streams'], type: 'audio' | 'subtitle'): RokuPlaybackTrackDTO[] {
  return streams.filter((stream) => stream.type === type).map((stream) => ({
    index: stream.index,
    type,
    codec: stream.codec,
    language: stream.language,
    title: stream.title,
    channels: stream.channels,
    isDefault: stream.isDefault,
    isForced: stream.isForced,
    selected: false,
  }));
}

export async function resolveRokuPlayback(
  request: { protocol: string; headers: { host?: string } },
  identity: PlaybackIdentity,
  input: ResolveRokuPlaybackRequest,
): Promise<RokuPlaybackSessionDTO> {
  const episodeId = await resolveEpisode(input.mediaItemId, input.episodeId, identity.profileId);
  const [{ filePath }, item, episode, existingProgress] = await Promise.all([
    getMediaFilePath(input.mediaItemId, episodeId),
    prisma.mediaItem.findUnique({ where: { id: input.mediaItemId } }),
    episodeId ? prisma.episode.findUnique({ where: { id: episodeId } }) : Promise.resolve(null),
    prisma.watchProgress.findFirst({ where: episodeId ? { profileId: identity.profileId, episodeId } : { profileId: identity.profileId, mediaItemId: input.mediaItemId } }),
  ]);
  if (!item) throw ApiError.notFound('Media item not found');
  const info = await getPlaybackInfo(filePath, input.mediaItemId, episodeId);
  const video = info.streams.find((stream) => stream.type === 'video' && stream.isDefault) ?? info.streams.find((stream) => stream.type === 'video');
  const audioStreams = info.streams.filter((stream) => stream.type === 'audio');
  const chosenAudio = input.audioStreamIndex != null
    ? audioStreams.find((stream) => stream.index === input.audioStreamIndex)
    : audioStreams.find((stream) => stream.language === input.preferredAudioLanguage) ?? audioStreams.find((stream) => stream.isDefault) ?? audioStreams[0];
  const subtitleStreams = info.streams.filter((stream) => stream.type === 'subtitle');
  const chosenSubtitle = input.subtitlesEnabled === false
    ? undefined
    : input.subtitleStreamIndex != null
      ? subtitleStreams.find((stream) => stream.index === input.subtitleStreamIndex)
      : subtitleStreams.find((stream) => stream.isForced && stream.language === input.preferredSubtitleLanguage)
        ?? subtitleStreams.find((stream) => stream.isDefault && stream.language === input.preferredSubtitleLanguage);
  const method = selectRokuPlaybackMethod({
    filePath,
    videoCodec: info.videoCodec,
    audioCodec: chosenAudio?.codec ?? info.audioCodec,
    width: video?.width ?? null,
    bitrate: video?.bitrate ?? null,
    hdr: video?.hdr ?? null,
  }, input.capabilities);
  const positionSeconds = Math.max(0, input.positionSeconds ?? existingProgress?.positionSeconds ?? 0);
  const expiresAt = new Date(Date.now() + config.ROKU_PLAYBACK_SESSION_TTL_SECONDS * 1000);

  await Promise.all([
    prisma.playbackSession.updateMany({
      where: { deviceSessionId: identity.deviceSessionId, state: 'ACTIVE' },
      data: { state: 'REPLACED', endedAt: new Date() },
    }),
    prisma.playbackSession.updateMany({
      where: { state: 'ACTIVE', expiresAt: { lt: new Date() } },
      data: { state: 'EXPIRED', endedAt: new Date() },
    }),
  ]);
  const session = await prisma.playbackSession.create({
    data: {
      accountId: identity.accountId,
      profileId: identity.profileId,
      deviceSessionId: identity.deviceSessionId,
      mediaItemId: input.mediaItemId,
      episodeId,
      method,
      contentType: method === 'direct' ? 'video/mp4' : 'application/x-mpegURL',
      audioStreamIndex: chosenAudio?.index,
      subtitleStreamIndex: chosenSubtitle?.index,
      positionSeconds,
      durationSeconds: info.durationSeconds,
      expiresAt,
    },
  });
  const { baseUrl, warnings } = publicApiBaseUrl(request);
  const token = createToken(identity, session);
  const [markerRows, next] = await Promise.all([
    config.ROKU_FEATURE_SKIP_INTRO ? prisma.playbackMarker.findMany({
      where: episodeId ? { episodeId, type: { in: ['intro', 'credits'] } } : { mediaItemId: input.mediaItemId, type: { in: ['intro', 'credits'] } },
      orderBy: { startSeconds: 'asc' },
    }) : Promise.resolve([]),
    nextRokuPlayback(identity, session.id),
  ]);
  const sidecarSubtitles = config.ROKU_FEATURE_SUBTITLES ? await findSidecarSubtitles(filePath) : [];
  const subtitleTracks = [
    ...(config.ROKU_FEATURE_SUBTITLES ? mapTracks(info.streams, 'subtitle') : []),
    ...sidecarSubtitles.map((track) => ({
      index: track.index,
      type: 'subtitle' as const,
      codec: path.extname(track.filePath).slice(1),
      language: track.language,
      title: track.title,
      channels: null,
      isDefault: false,
      isForced: false,
      selected: false,
    })),
  ].map((track) => ({
    ...track,
    selected: chosenSubtitle?.index === track.index,
    url: `${baseUrl}/api/roku/playback/subtitles/${encodeURIComponent(session.id)}/${track.index}?token=${encodeURIComponent(token)}`,
  }));
  return {
    sessionId: session.id,
    mediaItemId: session.mediaItemId,
    episodeId: session.episodeId,
    method: method as RokuPlaybackSessionDTO['method'],
    url: createPlaybackUrl(baseUrl, session, token),
    contentType: session.contentType as RokuPlaybackSessionDTO['contentType'],
    title: episode?.title || item.title,
    subtitle: episode ? `${item.title} · S${episode.season} E${episode.episode}` : null,
    artworkUrl: item.backdropPath ? `https://image.tmdb.org/t/p/w1280${item.backdropPath}` : item.posterPath ? `https://image.tmdb.org/t/p/w342${item.posterPath}` : null,
    durationSeconds: info.durationSeconds,
    positionSeconds,
    audioTracks: config.ROKU_FEATURE_AUDIO_TRACKS ? mapTracks(info.streams, 'audio').map((track) => ({ ...track, selected: chosenAudio?.index === track.index })) : [],
    subtitleTracks,
    markers: markerRows.map((marker) => ({
      type: marker.type as 'intro' | 'credits',
      startSeconds: marker.startSeconds,
      endSeconds: marker.endSeconds,
    })),
    next,
    expiresAt: expiresAt.toISOString(),
    warnings,
  };
}

async function ownedSession(identity: PlaybackIdentity, sessionId: string): Promise<PlaybackSession> {
  const session = await prisma.playbackSession.findUnique({ where: { id: sessionId } });
  if (!session || session.accountId !== identity.accountId || session.profileId !== identity.profileId || session.deviceSessionId !== identity.deviceSessionId) {
    throw ApiError.notFound('Playback session not found');
  }
  return session;
}

async function persistProgress(session: PlaybackSession, positionSeconds: number, durationSeconds?: number): Promise<void> {
  await saveProgress(session.profileId, {
    mediaItemId: session.episodeId ? undefined : session.mediaItemId,
    episodeId: session.episodeId ?? undefined,
    positionSeconds,
    durationSeconds: durationSeconds ?? session.durationSeconds ?? undefined,
  });
}

export async function updateRokuPlayback(identity: PlaybackIdentity, input: RokuPlaybackProgressRequest): Promise<{ ok: true }> {
  const session = await ownedSession(identity, input.sessionId);
  if (session.state !== 'ACTIVE' || session.expiresAt.getTime() <= Date.now()) throw ApiError.unauthorized('Playback session expired', 'PLAYBACK_SESSION_EXPIRED');
  await Promise.all([
    persistProgress(session, input.positionSeconds, input.durationSeconds),
    prisma.playbackSession.update({
      where: { id: session.id },
      data: { positionSeconds: input.positionSeconds, durationSeconds: input.durationSeconds ?? session.durationSeconds, lastHeartbeatAt: new Date() },
    }),
  ]);
  return { ok: true };
}

export async function stopRokuPlayback(identity: PlaybackIdentity, input: RokuPlaybackStopRequest): Promise<{ ok: true }> {
  const session = await ownedSession(identity, input.sessionId);
  await Promise.all([
    persistProgress(session, input.positionSeconds, input.durationSeconds),
    prisma.playbackSession.update({
      where: { id: session.id },
      data: { state: input.reason === 'ended' ? 'COMPLETED' : 'STOPPED', positionSeconds: input.positionSeconds, durationSeconds: input.durationSeconds ?? session.durationSeconds, endedAt: new Date(), lastHeartbeatAt: new Date() },
    }),
  ]);
  return { ok: true };
}

export async function refreshRokuPlayback(
  request: { protocol: string; headers: { host?: string } },
  identity: PlaybackIdentity,
  sessionId: string,
  positionSeconds?: number,
): Promise<{ url: string; expiresAt: string }> {
  const current = await ownedSession(identity, sessionId);
  if (current.state !== 'ACTIVE') throw ApiError.badRequest('Playback session is not active', 'PLAYBACK_SESSION_INACTIVE');
  const expiresAt = new Date(Date.now() + config.ROKU_PLAYBACK_SESSION_TTL_SECONDS * 1000);
  const session = await prisma.playbackSession.update({
    where: { id: current.id },
    data: { expiresAt, lastHeartbeatAt: new Date(), positionSeconds: positionSeconds ?? current.positionSeconds },
  });
  const token = createToken(identity, session);
  return { url: createPlaybackUrl(publicApiBaseUrl(request).baseUrl, session, token), expiresAt: expiresAt.toISOString() };
}

export async function nextRokuPlayback(identity: PlaybackIdentity, sessionId: string): Promise<RokuNextPlaybackDTO | null> {
  const session = await ownedSession(identity, sessionId);
  if (!session.episodeId) return null;
  const current = await prisma.episode.findUnique({ where: { id: session.episodeId } });
  if (!current) return null;
  const next = await prisma.episode.findFirst({
    where: {
      mediaItemId: current.mediaItemId,
      filePath: { not: null },
      OR: [{ season: { gt: current.season } }, { season: current.season, episode: { gt: current.episode } }],
    },
    orderBy: [{ season: 'asc' }, { episode: 'asc' }],
    include: { mediaItem: true },
  });
  if (!next) return null;
  return {
    mediaItemId: next.mediaItemId,
    episodeId: next.id,
    title: next.title || `Episode ${next.episode}`,
    subtitle: `${next.mediaItem.title} · S${next.season} E${next.episode}`,
    artworkUrl: next.mediaItem.backdropPath ? `https://image.tmdb.org/t/p/w1280${next.mediaItem.backdropPath}` : null,
  };
}

export async function assertPlaybackAccess(request: FastifyRequest, mediaItemId: string, episodeId?: string): Promise<void> {
  const grant = request.playback;
  if (!grant) return;
  if (grant.mediaItemId !== mediaItemId || (grant.episodeId ?? undefined) !== (episodeId ?? undefined)) {
    throw ApiError.forbidden('Playback token does not grant access to this title', 'PLAYBACK_SCOPE_INVALID');
  }
  const session = await prisma.playbackSession.findUnique({ where: { id: grant.playbackSessionId } });
  if (!session || session.state !== 'ACTIVE' || session.expiresAt.getTime() <= Date.now() || session.accountId !== grant.sub || session.profileId !== grant.activeProfileId || session.mediaItemId !== mediaItemId || (session.episodeId ?? undefined) !== (episodeId ?? undefined)) {
    throw ApiError.forbidden('Playback session is no longer valid', 'PLAYBACK_SESSION_INVALID');
  }
}

export async function getRokuSubtitle(sessionId: string, streamIndex: number): Promise<string> {
  const session = await prisma.playbackSession.findUnique({ where: { id: sessionId } });
  if (!session || session.state !== 'ACTIVE' || session.expiresAt.getTime() <= Date.now()) {
    throw ApiError.notFound('Subtitle session not found');
  }
  const { filePath } = await getMediaFilePath(session.mediaItemId, session.episodeId ?? undefined);
  let subtitleFilePath: string | null = null;
  if (streamIndex >= EXTERNAL_SUBTITLE_INDEX) {
    const sidecars = await findSidecarSubtitles(filePath);
    subtitleFilePath = sidecars.find((sidecar) => sidecar.index === streamIndex)?.filePath ?? null;
    if (!subtitleFilePath) throw ApiError.notFound('External subtitle track not found');
    if (path.extname(subtitleFilePath).toLowerCase() === '.vtt') {
      const content = await fs.promises.readFile(subtitleFilePath, 'utf8');
      if (!content.trim().startsWith('WEBVTT')) throw ApiError.badRequest('External WebVTT file is invalid', 'SUBTITLE_CONVERSION_FAILED');
      return content;
    }
  } else {
    const stream = await prisma.mediaStream.findFirst({
      where: session.episodeId
        ? { episodeId: session.episodeId, type: 'subtitle', index: streamIndex }
        : { mediaItemId: session.mediaItemId, type: 'subtitle', index: streamIndex },
    });
    if (!stream) throw ApiError.notFound('Subtitle track not found');
  }
  try {
    const args = subtitleFilePath
      ? ['-v', 'error', '-i', subtitleFilePath, '-f', 'webvtt', 'pipe:1']
      : ['-v', 'error', '-i', filePath, '-map', `0:${streamIndex}`, '-f', 'webvtt', 'pipe:1'];
    const result = await execFileAsync('ffmpeg', args, { encoding: 'utf8', maxBuffer: 20 * 1024 * 1024 });
    if (!result.stdout.trim().startsWith('WEBVTT')) throw new Error('FFmpeg returned an invalid WebVTT document');
    return result.stdout;
  } catch (error) {
    throw ApiError.badRequest(error instanceof Error ? error.message : 'Subtitle conversion failed', 'SUBTITLE_CONVERSION_FAILED');
  }
}
