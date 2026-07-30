/**
 * Auth plugin — JWT bearer verification + role/profile guards.
 *
 * Decorates each request with:
 *   - request.account          → { id, role }  (from JWT `sub` + `role`)
 *   - request.activeProfileId  → string | undefined (from JWT `activeProfileId`)
 *
 * Exposes preHandlers:
 *   - requireAuth     → valid token; populates request.account
 *   - requireAdmin    → requireAuth + account.role === 'ADMIN'
 *   - requireProfile  → requireAuth + an active profile is selected
 *
 * Registered as a Fastify plugin so decorators are available app-wide.
 */
import fp from 'fastify-plugin';
import type {
  FastifyInstance,
  FastifyReply,
  FastifyRequest,
  preHandlerHookHandler,
} from 'fastify';
import type { AdminPermission, Role } from '@flux/shared';
import {
  verifyToken,
  type CastPlaybackClaims,
  type StreamPlaybackClaims,
} from '../lib/jwt.js';
import { ApiError } from '../lib/errors.js';
import { prisma } from '../lib/db.js';

export interface AuthedAccount {
  id: string;
  role: Role;
}

declare module 'fastify' {
  interface FastifyRequest {
    account?: AuthedAccount;
    activeProfileId?: string;
    /** Present only for a signed, media-scoped Cast receiver token. */
    castPlayback?: CastPlaybackClaims;
    /** Present only for a short-lived, media-scoped browser token. */
    streamPlayback?: StreamPlaybackClaims;
  }
  interface FastifyInstance {
    requireAuth: preHandlerHookHandler;
    requireAdmin: preHandlerHookHandler;
    requirePermission: (permission: AdminPermission) => preHandlerHookHandler;
    requireProfile: preHandlerHookHandler;
    /**
     * Like requireProfile, but also accepts the JWT via a `?token=` query
     * param. Needed for media streaming: <video> elements and hls.js segment
     * loads cannot attach an Authorization header.
     */
    requireProfileStream: preHandlerHookHandler;
  }
}

function extractBearer(request: FastifyRequest): string {
  const header = request.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    throw ApiError.unauthorized('Missing bearer token');
  }
  const token = header.slice('Bearer '.length).trim();
  if (!token) {
    throw ApiError.unauthorized('Empty bearer token');
  }
  return token;
}

/**
 * Resolve the JWT from the Authorization header, falling back to a `?token=`
 * query param. The query fallback exists only for streaming endpoints where a
 * browser media request cannot set headers.
 */
function extractTokenAllowQuery(request: FastifyRequest): string {
  const header = request.headers.authorization;
  if (header && header.startsWith('Bearer ')) {
    const token = header.slice('Bearer '.length).trim();
    if (token) return token;
  }
  const q = (request.query as { token?: unknown } | undefined)?.token;
  if (typeof q === 'string' && q.trim()) return q.trim();
  throw ApiError.unauthorized('Missing bearer token');
}

/** Populate request.account/activeProfileId from a valid JWT, else 401. */
function authenticate(request: FastifyRequest): void {
  const token = extractBearer(request);
  applyClaims(request, token, false);
}

/** Same as authenticate but allows the token to arrive via `?token=`. */
function authenticateAllowQuery(request: FastifyRequest): void {
  const token = extractTokenAllowQuery(request);
  applyClaims(request, token, true);
}

function applyClaims(request: FastifyRequest, token: string, allowMediaPurpose: boolean): void {
  let claims;
  try {
    claims = verifyToken(token);
  } catch {
    throw ApiError.unauthorized('Invalid or expired token');
  }
  if (!allowMediaPurpose && claims.purpose !== 'account') {
    throw ApiError.unauthorized('This token cannot access account APIs', 'TOKEN_PURPOSE_INVALID');
  }
  request.account = { id: claims.sub, role: claims.role };
  request.activeProfileId = claims.activeProfileId;
  if (claims.purpose === 'cast-playback') {
    const cast = claims as unknown as CastPlaybackClaims;
    if (!cast.castSessionId || !cast.mediaItemId) {
      throw ApiError.unauthorized('Invalid Cast playback token');
    }
    request.castPlayback = cast;
  } else if (claims.purpose === 'stream') {
    const stream = claims as unknown as StreamPlaybackClaims;
    if (!stream.mediaItemId) {
      throw ApiError.unauthorized('Invalid stream token');
    }
    request.streamPlayback = stream;
  }
}

async function refreshAccount(request: FastifyRequest): Promise<void> {
  const account = await prisma.user.findUnique({
    where: { id: request.account!.id },
    select: { role: true, disabled: true },
  });
  if (!account || account.disabled) {
    throw ApiError.forbidden('This account is disabled', 'ACCOUNT_DISABLED');
  }
  request.account!.role = account.role;
}

async function ensureActiveProfile(request: FastifyRequest): Promise<void> {
  if (!request.activeProfileId) {
    throw ApiError.forbidden(
      'No active profile selected. Activate a profile first.',
      'NO_ACTIVE_PROFILE',
    );
  }
  const profile = await prisma.profile.findFirst({
    where: { id: request.activeProfileId, userId: request.account!.id },
    select: { id: true },
  });
  if (!profile) {
    throw ApiError.forbidden('This profile is unavailable', 'PROFILE_UNAVAILABLE');
  }
}

const authPlugin = fp(async (app: FastifyInstance) => {
  // Ensure decorators exist so `request.account` is a known property.
  app.decorateRequest('account', undefined);
  app.decorateRequest('activeProfileId', undefined);
  app.decorateRequest('castPlayback', undefined);
  app.decorateRequest('streamPlayback', undefined);

  const requireAuth: preHandlerHookHandler = async (
    request: FastifyRequest,
    _reply: FastifyReply,
  ) => {
    authenticate(request);
    await refreshAccount(request);
  };

  const requireAdmin: preHandlerHookHandler = async (
    request: FastifyRequest,
    _reply: FastifyReply,
  ) => {
    authenticate(request);
    await refreshAccount(request);
    if (request.account?.role !== 'ADMIN') {
      throw ApiError.forbidden('Admin role required');
    }
  };

  const requirePermission = (permission: AdminPermission): preHandlerHookHandler => async (
    request: FastifyRequest,
    _reply: FastifyReply,
  ) => {
    authenticate(request);
    const account = await prisma.user.findUnique({
      where: { id: request.account!.id },
      select: { role: true, permissions: true, disabled: true },
    });
    if (!account || account.disabled) {
      throw ApiError.forbidden('This account is disabled', 'ACCOUNT_DISABLED');
    }
    if (account.role !== 'ADMIN' && !account.permissions.includes(permission)) {
      throw ApiError.forbidden(`Permission required: ${permission}`, 'PERMISSION_REQUIRED');
    }
  };

  const requireProfile: preHandlerHookHandler = async (
    request: FastifyRequest,
    _reply: FastifyReply,
  ) => {
    authenticate(request);
    await refreshAccount(request);
    await ensureActiveProfile(request);
  };

  const requireProfileStream: preHandlerHookHandler = async (
    request: FastifyRequest,
    _reply: FastifyReply,
  ) => {
    authenticateAllowQuery(request);
    if (!request.streamPlayback && !request.castPlayback) {
      throw ApiError.unauthorized('A short-lived media token is required', 'MEDIA_TOKEN_REQUIRED');
    }
    await refreshAccount(request);
    await ensureActiveProfile(request);
  };

  app.decorate('requireAuth', requireAuth);
  app.decorate('requireAdmin', requireAdmin);
  app.decorate('requirePermission', requirePermission);
  app.decorate('requireProfile', requireProfile);
  app.decorate('requireProfileStream', requireProfileStream);
});

export default authPlugin;
