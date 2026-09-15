/**
 * First-run setup.
 *
 * A fresh Flux install has no users and `ServerSettings.setupCompleted` is
 * false. The web UI polls `GET /api/setup/status` (public, minimal) and sends
 * the operator through the wizard until an admin exists and the wizard has
 * been finished. Installs that pre-date the wizard are reconciled at boot:
 * if users already exist the wizard is marked complete so nobody is locked
 * out by an upgrade.
 *
 * Security: creating the initial administrator is only possible while the
 * users table is empty and is checked inside a serializable transaction so a
 * race cannot produce two "first" admins.
 */
import type { FastifyBaseLogger } from 'fastify';
import { Prisma } from '@prisma/client';
import type {
  AuthResponse,
  SetupSnapshotDTO,
  SetupStatusDTO,
  TmdbKeyTestResultDTO,
} from '@flux/shared';
import { config } from '../../config.js';
import { prisma } from '../../lib/db.js';
import { ApiError } from '../../lib/errors.js';
import { signToken } from '../../lib/jwt.js';
import { listStorageVolumes } from '../../lib/storage.js';
import { checkTorrentClient } from '../../lib/webtorrent.js';
import { hashPassword, toAccountDTO, toProfileDTO } from '../auth/auth.service.js';
import {
  getServerSettings,
  getSettingsBundle,
  getTmdbApiKey,
  writeServerSettings,
} from '../settings/settings.service.js';

export async function reconcileSetupState(log: FastifyBaseLogger): Promise<void> {
  const settings = await getServerSettings({ fresh: true });
  if (settings.setupCompleted) return;
  const users = await prisma.user.count();
  if (users > 0) {
    await writeServerSettings({ setupCompleted: true, setupCompletedAt: new Date() }, ['setup']);
    log.info('Existing installation detected; first-run setup marked complete.');
  } else {
    log.info('No users exist yet — first-run setup is pending. Open the web UI to configure Flux.');
  }
}

export async function getSetupStatus(): Promise<SetupStatusDTO> {
  const [settings, users] = await Promise.all([getServerSettings(), prisma.user.count()]);
  return {
    completed: settings.setupCompleted,
    needsAdmin: users === 0,
    serverName: settings.serverName,
    version: config.FLUX_SERVER_VERSION,
  };
}

export interface CreateInitialAdminInput {
  email: string;
  password: string;
  profileName?: string;
}

/** Create the very first administrator. Refuses once any user exists. */
export async function createInitialAdmin(input: CreateInitialAdminInput): Promise<AuthResponse> {
  const passwordHash = await hashPassword(input.password);
  const profileName = input.profileName?.trim() || 'Admin';

  const user = await prisma.$transaction(
    async (tx) => {
      const existing = await tx.user.count();
      if (existing > 0) {
        throw ApiError.conflict('An account already exists. Sign in instead.', 'SETUP_ADMIN_EXISTS');
      }
      return tx.user.create({
        data: {
          email: input.email,
          passwordHash,
          role: 'ADMIN',
          profiles: { create: { name: profileName } },
        },
        include: { profiles: true },
      });
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
  );

  const { profiles, ...account } = user;
  return {
    token: signToken({ sub: account.id, role: account.role }),
    account: toAccountDTO(account),
    profiles: profiles.map(toProfileDTO),
  };
}

/** Everything the wizard needs to prefill and validate, in one round-trip. */
export async function getSetupSnapshot(): Promise<SetupSnapshotDTO> {
  const [settings, volumes, torrent] = await Promise.all([
    getSettingsBundle(),
    listStorageVolumes(),
    checkTorrentClient().catch((err: unknown) => ({ ok: false, url: '', message: String(err) })),
  ]);
  return {
    settings,
    volumes,
    downloadClient: {
      ok: torrent.ok,
      message: torrent.ok
        ? `Connected${'version' in torrent && torrent.version ? ` (Transmission ${torrent.version})` : ''}`
        : torrent.message ?? 'Connection failed',
    },
    environment: {
      mediaRoots: config.MEDIA_ROOTS,
      downloadRoot: config.DOWNLOAD_ROOT,
      transcodeRoot: config.TRANSCODE_ROOT,
      frontendOrigin: config.FRONTEND_ORIGIN,
      publicApiBaseUrl: config.PUBLIC_API_BASE_URL ?? null,
    },
  };
}

/**
 * Validate a TMDb v3 key by hitting the cheapest authenticated endpoint. Uses
 * the supplied key when given, otherwise whatever is currently configured.
 */
export async function testTmdbKey(apiKey?: string | null): Promise<TmdbKeyTestResultDTO> {
  const key = (apiKey ?? '').trim() || (await getTmdbApiKey());
  if (!key) return { ok: false, message: 'No TMDb API key is configured.' };
  try {
    const url = new URL('https://api.themoviedb.org/3/configuration');
    url.searchParams.set('api_key', key);
    const res = await fetch(url, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(10_000) });
    if (res.status === 401) return { ok: false, message: 'TMDb rejected this API key.' };
    if (!res.ok) return { ok: false, message: `TMDb responded with HTTP ${res.status}.` };
    return { ok: true, message: 'TMDb key accepted.' };
  } catch {
    return { ok: false, message: 'Could not reach TMDb. Check outbound network access.' };
  }
}

export async function completeSetup(): Promise<SetupStatusDTO> {
  const users = await prisma.user.count();
  if (users === 0) {
    throw ApiError.badRequest('Create an administrator before finishing setup.', 'SETUP_ADMIN_REQUIRED');
  }
  await writeServerSettings({ setupCompleted: true, setupCompletedAt: new Date() }, ['setup']);
  return getSetupStatus();
}
