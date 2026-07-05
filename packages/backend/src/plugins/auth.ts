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
import type { Role } from '@flux/shared';
import { verifyToken } from '../lib/jwt.js';
import { ApiError } from '../lib/errors.js';

export interface AuthedAccount {
  id: string;
  role: Role;
}

declare module 'fastify' {
  interface FastifyRequest {
    account?: AuthedAccount;
    activeProfileId?: string;
  }
  interface FastifyInstance {
    requireAuth: preHandlerHookHandler;
    requireAdmin: preHandlerHookHandler;
    requireProfile: preHandlerHookHandler;
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

/** Populate request.account/activeProfileId from a valid JWT, else 401. */
function authenticate(request: FastifyRequest): void {
  const token = extractBearer(request);
  let claims;
  try {
    claims = verifyToken(token);
  } catch {
    throw ApiError.unauthorized('Invalid or expired token');
  }
  request.account = { id: claims.sub, role: claims.role };
  request.activeProfileId = claims.activeProfileId;
}

const authPlugin = fp(async (app: FastifyInstance) => {
  // Ensure decorators exist so `request.account` is a known property.
  app.decorateRequest('account', undefined);
  app.decorateRequest('activeProfileId', undefined);

  const requireAuth: preHandlerHookHandler = async (
    request: FastifyRequest,
    _reply: FastifyReply,
  ) => {
    authenticate(request);
  };

  const requireAdmin: preHandlerHookHandler = async (
    request: FastifyRequest,
    _reply: FastifyReply,
  ) => {
    authenticate(request);
    if (request.account?.role !== 'ADMIN') {
      throw ApiError.forbidden('Admin role required');
    }
  };

  const requireProfile: preHandlerHookHandler = async (
    request: FastifyRequest,
    _reply: FastifyReply,
  ) => {
    authenticate(request);
    if (!request.activeProfileId) {
      throw ApiError.forbidden(
        'No active profile selected. Activate a profile first.',
        'NO_ACTIVE_PROFILE',
      );
    }
  };

  app.decorate('requireAuth', requireAuth);
  app.decorate('requireAdmin', requireAdmin);
  app.decorate('requireProfile', requireProfile);
});

export default authPlugin;
