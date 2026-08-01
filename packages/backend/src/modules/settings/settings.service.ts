import type { Prisma, DownloadClient, QualityProfile, ServerSettings } from '@prisma/client';
import type {
  DownloadClientDTO,
  DownloadClientTestResultDTO,
  QualityProfileDTO,
  SaveDownloadClientRequest,
  SaveQualityProfileRequest,
  SettingsBundleDTO,
  UpdateSettingsBundleRequest,
} from '@flux/shared';
import { config } from '../../config.js';
import { prisma } from '../../lib/db.js';
import { ApiError } from '../../lib/errors.js';
import { getSettings as getNotificationSettings } from '../notifications/notifications.service.js';

const DEFAULT_PROFILES: SaveQualityProfileRequest[] = [
  {
    name: 'Balanced 1080p', enabled: true,
    allowedResolutions: ['1080p'], sourceTypes: ['WEB-DL', 'BluRay'], videoCodecs: ['HEVC', 'H.264'],
    hdrFormats: [], audioFormats: [], audioChannels: [], languages: [], releaseGroups: [],
    minimumSizeMb: 700, maximumSizeMb: 20000,
    rules: [
      { id: 'webdl', attribute: 'WEB-DL', kind: 'PREFERRED', score: 40 },
      { id: 'hevc', attribute: 'HEVC', kind: 'PREFERRED', score: 20 },
      { id: 'stereo', attribute: 'Stereo', kind: 'PREFERRED', score: -20 },
      { id: 'cam', attribute: 'CAM', kind: 'REJECTED', score: 0 },
    ], upgradeCutoffScore: 80, minimumScoreImprovement: 15,
  },
  {
    name: '1080p Remux', enabled: true,
    allowedResolutions: ['1080p'], sourceTypes: ['Remux'], videoCodecs: ['HEVC', 'H.264'],
    hdrFormats: [], audioFormats: ['TrueHD', 'Atmos', 'DTS-HD', 'DTS:X'], audioChannels: [], languages: [], releaseGroups: [],
    minimumSizeMb: 10000, maximumSizeMb: 80000,
    rules: [
      { id: 'remux', attribute: 'Remux', kind: 'REQUIRED', score: 0 },
      { id: 'truehd', attribute: 'TrueHD', kind: 'PREFERRED', score: 40 },
      { id: 'dtsx', attribute: 'DTS:X', kind: 'PREFERRED', score: 40 },
      { id: 'cam', attribute: 'CAM', kind: 'REJECTED', score: 0 },
    ], upgradeCutoffScore: 100, minimumScoreImprovement: 20,
  },
  {
    name: '4K HDR', enabled: true,
    allowedResolutions: ['2160p'], sourceTypes: ['WEB-DL', 'BluRay', 'Remux'], videoCodecs: ['HEVC', 'AV1'],
    hdrFormats: ['Dolby Vision', 'HDR10+', 'HDR10', 'HDR'], audioFormats: [], audioChannels: [], languages: [], releaseGroups: [],
    minimumSizeMb: 5000, maximumSizeMb: 120000,
    rules: [
      { id: 'remux', attribute: 'Remux', kind: 'PREFERRED', score: 100 },
      { id: 'dv', attribute: 'Dolby Vision', kind: 'PREFERRED', score: 50 },
      { id: 'dtsx', attribute: 'DTS:X', kind: 'PREFERRED', score: 40 },
      { id: 'hevc', attribute: 'HEVC', kind: 'PREFERRED', score: 20 },
      { id: 'cam', attribute: 'CAM', kind: 'REJECTED', score: 0 },
    ], upgradeCutoffScore: 170, minimumScoreImprovement: 20,
  },
  {
    name: 'Storage Saver', enabled: true,
    allowedResolutions: ['720p', '1080p'], sourceTypes: ['WEB-DL', 'WEBRip'], videoCodecs: ['HEVC', 'AV1'],
    hdrFormats: [], audioFormats: ['AAC', 'AC-3', 'E-AC-3'], audioChannels: [], languages: [], releaseGroups: [],
    minimumSizeMb: 300, maximumSizeMb: 6000,
    rules: [
      { id: 'hevc', attribute: 'HEVC', kind: 'PREFERRED', score: 40 },
      { id: 'av1', attribute: 'AV1', kind: 'PREFERRED', score: 50 },
      { id: 'remux', attribute: 'Remux', kind: 'REJECTED', score: 0 },
      { id: 'cam', attribute: 'CAM', kind: 'REJECTED', score: 0 },
    ], upgradeCutoffScore: 70, minimumScoreImprovement: 15,
  },
];

function initialSettings() {
  return {
    serverName: config.FLUX_SERVER_NAME,
    frontendUrl: config.FRONTEND_ORIGIN,
    apiUrl: config.PUBLIC_API_BASE_URL ?? null,
  };
}

export async function getServerSettings(): Promise<ServerSettings> {
  return prisma.serverSettings.upsert({ where: { id: 'singleton' }, create: initialSettings(), update: {} });
}

export async function getSettingsBundle(): Promise<SettingsBundleDTO> {
  await ensureLegacyTransmissionClient();
  await ensureDefaultQualityProfiles();
  const [row, notifications] = await Promise.all([getServerSettings(), getNotificationSettings()]);
  return {
    general: {
      serverName: row.serverName, frontendUrl: row.frontendUrl, apiUrl: row.apiUrl,
      timezone: row.timezone, language: row.language, defaultInviteExpiryHours: row.defaultInviteExpiryHours,
    },
    downloads: {
      automatedDownloads: row.automatedDownloads,
      preferredProtocol: row.preferredProtocol as SettingsBundleDTO['downloads']['preferredProtocol'],
      defaultDownloadClientId: row.defaultDownloadClientId, defaultQualityProfileId: row.defaultQualityProfileId,
      automaticSearch: row.automaticSearch, automaticUpgrades: row.automaticUpgrades,
      retryFailedDownloads: row.retryFailedDownloads, minimumFreeSpaceGb: row.minimumFreeSpaceGb,
      completedImportBehavior: row.completedImportBehavior as 'COPY' | 'MOVE',
      torrentSeedRatio: row.torrentSeedRatio, torrentSeedTimeMinutes: row.torrentSeedTimeMinutes,
      torrentRemoveAfterSeeding: row.torrentRemoveAfterSeeding,
      usenetRemoveCompleted: row.usenetRemoveCompleted, usenetRemoveFailed: row.usenetRemoveFailed,
    },
    playback: {
      directPlayEnabled: row.directPlayEnabled, directStreamEnabled: row.directStreamEnabled,
      transcodingEnabled: row.transcodingEnabled, localBitrateLimitMbps: row.localBitrateLimitMbps,
      remoteBitrateLimitMbps: row.remoteBitrateLimitMbps,
      hardwareAcceleration: row.hardwareAcceleration as SettingsBundleDTO['playback']['hardwareAcceleration'],
      preferredAudioLanguage: row.preferredAudioLanguage,
      preferredSubtitleLanguage: row.preferredSubtitleLanguage,
      subtitlesMode: row.subtitlesMode as SettingsBundleDTO['playback']['subtitlesMode'],
      autoplayEnabled: row.autoplayEnabled,
      resumeBehavior: row.resumeBehavior as SettingsBundleDTO['playback']['resumeBehavior'],
      skipIntroEnabled: row.skipIntroEnabled,
    },
    notifications,
    integrations: {
      tmdbApiKeyConfigured: Boolean(row.tmdbApiKey || config.TMDB_API_KEY),
      tmdbSource: row.tmdbApiKey ? 'DATABASE' : 'ENVIRONMENT',
    },
  };
}

export async function updateSettings(input: UpdateSettingsBundleRequest): Promise<SettingsBundleDTO> {
  if (input.playback) {
    const current = await getServerSettings();
    const playback = {
      directPlayEnabled: current.directPlayEnabled,
      directStreamEnabled: current.directStreamEnabled,
      transcodingEnabled: current.transcodingEnabled,
      ...input.playback,
    };
    if (!playback.directPlayEnabled && !playback.directStreamEnabled && !playback.transcodingEnabled) {
      throw ApiError.badRequest('At least one playback method must remain enabled', 'PLAYBACK_METHOD_REQUIRED');
    }
  }
  if (input.downloads?.defaultDownloadClientId) {
    const client = await prisma.downloadClient.findUnique({ where: { id: input.downloads.defaultDownloadClientId } });
    if (!client?.enabled) throw ApiError.badRequest('The default download client must exist and be enabled', 'INVALID_DEFAULT_CLIENT');
  }
  if (input.downloads?.defaultQualityProfileId) {
    const profile = await prisma.qualityProfile.findUnique({ where: { id: input.downloads.defaultQualityProfileId } });
    if (!profile?.enabled) throw ApiError.badRequest('The default quality profile must exist and be enabled', 'INVALID_DEFAULT_PROFILE');
  }
  const data = { ...(input.general ?? {}), ...(input.downloads ?? {}), ...(input.playback ?? {}) } as Prisma.ServerSettingsUpdateInput;
  if (input.integrations && Object.prototype.hasOwnProperty.call(input.integrations, 'tmdbApiKey')) {
    data.tmdbApiKey = input.integrations.tmdbApiKey;
  }
  await prisma.serverSettings.upsert({ where: { id: 'singleton' }, create: { ...initialSettings(), ...data } as Prisma.ServerSettingsCreateInput, update: data });
  if (input.downloads && Object.prototype.hasOwnProperty.call(input.downloads, 'defaultDownloadClientId')) {
    await prisma.$transaction([
      prisma.downloadClient.updateMany({ data: { isDefault: false } }),
      ...(input.downloads.defaultDownloadClientId ? [prisma.downloadClient.update({ where: { id: input.downloads.defaultDownloadClientId }, data: { isDefault: true } })] : []),
    ]);
  }
  return getSettingsBundle();
}

function clientDTO(row: DownloadClient): DownloadClientDTO {
  return {
    id: row.id, name: row.name, type: row.type as DownloadClientDTO['type'], enabled: row.enabled,
    host: row.host, port: row.port, useHttps: row.useHttps, username: row.username,
    category: row.category, priority: row.priority, isDefault: row.isDefault,
    credentialConfigured: Boolean(row.credential), createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString(),
  };
}

async function ensureLegacyTransmissionClient(): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const settings = await tx.serverSettings.upsert({ where: { id: 'singleton' }, create: initialSettings(), update: {} });
    if (settings.downloadClientsSeeded) return;
    let client = await tx.downloadClient.findFirst({ orderBy: [{ isDefault: 'desc' }, { priority: 'desc' }, { id: 'asc' }] });
    if (!client) {
      const url = new URL(config.TRANSMISSION_RPC_URL);
      url.username = '';
      url.password = '';
      client = await tx.downloadClient.create({ data: {
        name: 'Transmission', type: 'TRANSMISSION', enabled: true, host: url.toString(),
        port: Number(url.port || (url.protocol === 'https:' ? 443 : 80)), useHttps: url.protocol === 'https:',
        username: config.TRANSMISSION_USER, credential: config.TRANSMISSION_PASS, category: null, priority: 0, isDefault: true,
      } });
    }
    if (!settings.defaultDownloadClientId && !client.isDefault) {
      await tx.downloadClient.updateMany({ data: { isDefault: false } });
      client = await tx.downloadClient.update({ where: { id: client.id }, data: { isDefault: true } });
    }
    await tx.serverSettings.update({
      where: { id: 'singleton' },
      data: { downloadClientsSeeded: true, ...(settings.defaultDownloadClientId ? {} : { defaultDownloadClientId: client.id }) },
    });
  });
}

export async function listDownloadClients(): Promise<DownloadClientDTO[]> {
  await ensureLegacyTransmissionClient();
  return (await prisma.downloadClient.findMany({ orderBy: [{ priority: 'desc' }, { name: 'asc' }, { id: 'asc' }] })).map(clientDTO);
}

export async function saveDownloadClient(input: SaveDownloadClientRequest, id?: string): Promise<DownloadClientDTO> {
  const existing = id ? await prisma.downloadClient.findUnique({ where: { id } }) : null;
  if (id && !existing) throw ApiError.notFound('Download client not found');
  if (input.isDefault && !input.enabled) throw ApiError.badRequest('A disabled client cannot be the default', 'INVALID_DEFAULT_CLIENT');
  const { credential, ...safe } = input;
  const data: Prisma.DownloadClientUncheckedCreateInput = {
    ...safe, username: safe.username || null, category: safe.category || null,
    ...(credential !== undefined && (!existing || credential !== '')
      ? { credential: credential || null }
      : existing ? { credential: existing.credential } : {}),
  };
  const row = id
    ? await prisma.downloadClient.update({ where: { id }, data })
    : await prisma.downloadClient.create({ data });
  if (row.isDefault) {
    await prisma.$transaction([
      prisma.downloadClient.updateMany({ where: { id: { not: row.id } }, data: { isDefault: false } }),
      prisma.serverSettings.upsert({ where: { id: 'singleton' }, create: { ...initialSettings(), defaultDownloadClientId: row.id }, update: { defaultDownloadClientId: row.id } }),
    ]);
  } else if (existing?.isDefault || !row.enabled) {
    await prisma.serverSettings.updateMany({ where: { defaultDownloadClientId: row.id }, data: { defaultDownloadClientId: null } });
  }
  return clientDTO(row);
}

export async function deleteDownloadClient(id: string): Promise<void> {
  const client = await prisma.downloadClient.findUnique({ where: { id } });
  if (!client) throw ApiError.notFound('Download client not found');
  await prisma.$transaction([
    prisma.downloadClient.delete({ where: { id } }),
    prisma.serverSettings.updateMany({ where: { defaultDownloadClientId: id }, data: { defaultDownloadClientId: null } }),
  ]);
}

function clientUrl(client: Pick<DownloadClient, 'host' | 'port' | 'useHttps'>): URL {
  const raw = /^https?:\/\//i.test(client.host) ? client.host : `${client.useHttps ? 'https' : 'http'}://${client.host}`;
  const url = new URL(raw);
  url.protocol = client.useHttps ? 'https:' : 'http:';
  url.port = String(client.port);
  url.username = '';
  url.password = '';
  return url;
}

export async function testDownloadClient(id: string): Promise<DownloadClientTestResultDTO> {
  const client = await prisma.downloadClient.findUnique({ where: { id } });
  if (!client) throw ApiError.notFound('Download client not found');
  const url = clientUrl(client);
  try {
    let version: string | null = null;
    if (client.type === 'TRANSMISSION') {
      if (url.pathname === '/') url.pathname = '/transmission/rpc';
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (client.username || client.credential) headers.Authorization = `Basic ${Buffer.from(`${client.username ?? ''}:${client.credential ?? ''}`).toString('base64')}`;
      let response = await fetch(url, { method: 'POST', headers, body: JSON.stringify({ method: 'session-get' }), signal: AbortSignal.timeout(10_000) });
      if (response.status === 409) {
        const sessionId = response.headers.get('X-Transmission-Session-Id');
        if (!sessionId) throw new Error('Transmission did not provide a session identifier');
        response = await fetch(url, { method: 'POST', headers: { ...headers, 'X-Transmission-Session-Id': sessionId }, body: JSON.stringify({ method: 'session-get' }), signal: AbortSignal.timeout(10_000) });
      }
      if (!response.ok) throw new Error(`Transmission returned HTTP ${response.status}`);
      const body = await response.json() as { result?: string; arguments?: { version?: string } };
      if (body.result !== 'success') throw new Error('Transmission rejected the connection test');
      version = body.arguments?.version ?? null;
    } else if (client.type === 'SABNZBD') {
      url.pathname = `${url.pathname.replace(/\/$/, '')}/api`;
      url.search = new URLSearchParams({ mode: 'version', output: 'json', ...(client.credential ? { apikey: client.credential } : {}) }).toString();
      const response = await fetch(url, { signal: AbortSignal.timeout(10_000) });
      if (!response.ok) throw new Error(`SABnzbd returned HTTP ${response.status}`);
      const body = await response.json() as { version?: string };
      version = body.version ?? null;
    } else {
      url.pathname = `${url.pathname.replace(/\/$/, '')}/jsonrpc`;
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (client.username || client.credential) headers.Authorization = `Basic ${Buffer.from(`${client.username ?? ''}:${client.credential ?? ''}`).toString('base64')}`;
      const response = await fetch(url, { method: 'POST', headers, body: JSON.stringify({ method: 'version', params: [], id: 1 }), signal: AbortSignal.timeout(10_000) });
      if (!response.ok) throw new Error(`NZBGet returned HTTP ${response.status}`);
      const body = await response.json() as { result?: string };
      version = body.result ?? null;
    }
    return { ok: true, clientName: client.name, version, message: 'Connection successful.' };
  } catch (error) {
    const message = error instanceof Error ? error.message.replace(/https?:\/\/[^\s]+/g, '[redacted endpoint]') : 'Connection failed';
    return { ok: false, clientName: client.name, version: null, message };
  }
}

export async function getActiveTransmissionConfig(): Promise<{ url: string; username: string; password: string }> {
  const selected = await prisma.downloadClient.findFirst({ where: { type: 'TRANSMISSION', enabled: true }, orderBy: [{ isDefault: 'desc' }, { priority: 'desc' }, { id: 'asc' }] });
  if (!selected) return { url: config.TRANSMISSION_RPC_URL, username: config.TRANSMISSION_USER, password: config.TRANSMISSION_PASS };
  const url = clientUrl(selected);
  if (url.pathname === '/') url.pathname = '/transmission/rpc';
  return { url: url.toString(), username: selected.username ?? '', password: selected.credential ?? '' };
}

export async function ensureDefaultQualityProfiles(): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const settings = await tx.serverSettings.upsert({ where: { id: 'singleton' }, create: initialSettings(), update: {} });
    if (settings.qualityProfilesSeeded) return;
    if (await tx.qualityProfile.count() === 0) {
      await tx.qualityProfile.createMany({ data: DEFAULT_PROFILES.map((profile) => ({ ...profile, rules: profile.rules as unknown as Prisma.InputJsonValue })) });
    }
    const first = await tx.qualityProfile.findFirst({ orderBy: [{ name: 'asc' }, { id: 'asc' }] });
    await tx.serverSettings.update({
      where: { id: 'singleton' },
      data: { qualityProfilesSeeded: true, ...(settings.defaultQualityProfileId || !first ? {} : { defaultQualityProfileId: first.id }) },
    });
  });
}

export function qualityProfileDTO(row: QualityProfile): QualityProfileDTO {
  return {
    ...row,
    rules: row.rules as unknown as QualityProfileDTO['rules'],
    createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString(),
  };
}

export async function listQualityProfiles(): Promise<QualityProfileDTO[]> {
  await ensureDefaultQualityProfiles();
  return (await prisma.qualityProfile.findMany({ orderBy: [{ name: 'asc' }, { id: 'asc' }] })).map(qualityProfileDTO);
}

export async function getQualityProfile(id: string): Promise<QualityProfileDTO> {
  const row = await prisma.qualityProfile.findUnique({ where: { id } });
  if (!row) throw ApiError.notFound('Quality profile not found');
  return qualityProfileDTO(row);
}

export async function saveQualityProfile(input: SaveQualityProfileRequest, id?: string): Promise<QualityProfileDTO> {
  if (id && !(await prisma.qualityProfile.findUnique({ where: { id } }))) throw ApiError.notFound('Quality profile not found');
  const data = { ...input, rules: input.rules as unknown as Prisma.InputJsonValue };
  const row = id ? await prisma.qualityProfile.update({ where: { id }, data }) : await prisma.qualityProfile.create({ data });
  if (!row.enabled) {
    await prisma.serverSettings.updateMany({ where: { defaultQualityProfileId: row.id }, data: { defaultQualityProfileId: null } });
  }
  return qualityProfileDTO(row);
}

export async function deleteQualityProfile(id: string): Promise<void> {
  const row = await prisma.qualityProfile.findUnique({ where: { id } });
  if (!row) throw ApiError.notFound('Quality profile not found');
  await prisma.$transaction([
    prisma.qualityProfile.delete({ where: { id } }),
    prisma.serverSettings.updateMany({ where: { defaultQualityProfileId: id }, data: { defaultQualityProfileId: null } }),
  ]);
}

export async function getTmdbApiKey(): Promise<string> {
  const row = await getServerSettings();
  return row.tmdbApiKey || config.TMDB_API_KEY;
}
