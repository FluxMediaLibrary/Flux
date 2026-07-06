/**
 * Fastify app construction + bootstrap.
 * Registers CORS, auth plugin, error handler, health check, and mounts all
 * module routes under /api. Seeds the bootstrap ADMIN account on first boot.
 */
import Fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import { config, isProduction } from './config.js';
import { prisma } from './lib/db.js';
import { registerErrorHandler } from './lib/errors.js';
import { hashPassword } from './modules/auth/auth.service.js';
import authPlugin from './plugins/auth.js';

import { authRoutes } from './modules/auth/auth.routes.js';
import { profileRoutes } from './modules/profiles/profiles.routes.js';
import { inviteRoutes } from './modules/invites/invites.routes.js';
import { tmdbRoutes } from './modules/tmdb/tmdb.routes.js';
import { libraryRoutes } from './modules/library/library.routes.js';
import { torrentRoutes } from './modules/torrents/torrents.routes.js';
import { requestRoutes } from './modules/requests/requests.routes.js';
import { streamingRoutes } from './modules/streaming/streaming.routes.js';
import { notificationRoutes } from './modules/notifications/notifications.routes.js';
import { adminRoutes } from './modules/admin/admin.routes.js';

export async function buildServer(): Promise<FastifyInstance> {
  const app = Fastify({
    logger: isProduction
      ? { level: 'info' }
      : {
          level: 'debug',
          transport: { target: 'pino-pretty', options: { colorize: true } },
        },
    // Trust the reverse proxy (single-VPS deployment behind the frontend/proxy).
    trustProxy: true,
    bodyLimit: 2 * 1024 * 1024, // 2 MiB JSON limit (torrent uploads handled later)
  });

  registerErrorHandler(app);

  await app.register(cors, {
    origin: config.FRONTEND_ORIGIN,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  });

  await app.register(authPlugin);

  // Health check (unauthenticated).
  app.get('/health', async () => ({ status: 'ok', uptime: process.uptime() }));

  // Module routes under /api.
  await app.register(
    async (api) => {
      await api.register(authRoutes, { prefix: '/auth' });
      await api.register(profileRoutes, { prefix: '/profiles' });
      await api.register(inviteRoutes, { prefix: '/invites' });
      await api.register(tmdbRoutes, { prefix: '/tmdb' });
      // Reserved mount points for later phases (stubs register no routes yet).
      await api.register(libraryRoutes, { prefix: '/library' });
      await api.register(torrentRoutes, { prefix: '/torrents' });
      await api.register(requestRoutes, { prefix: '/requests' });
      await api.register(streamingRoutes, { prefix: '/stream' });
      await api.register(notificationRoutes, { prefix: '/notifications' });
      await api.register(adminRoutes, { prefix: '/admin' });
    },
    { prefix: '/api' },
  );

  return app;
}

/**
 * Seed the initial ADMIN account if there are no users yet. Idempotent: does
 * nothing once any user exists. Requires BOOTSTRAP_ADMIN_* to be configured.
 */
export async function seedBootstrapAdmin(app: FastifyInstance): Promise<void> {
  const userCount = await prisma.user.count();
  if (userCount > 0) return;

  if (!config.BOOTSTRAP_ADMIN_EMAIL || !config.BOOTSTRAP_ADMIN_PASSWORD) {
    app.log.warn(
      'No users exist and BOOTSTRAP_ADMIN_EMAIL/PASSWORD are not set — ' +
        'skipping admin seed. Set them to bootstrap the first admin.',
    );
    return;
  }

  const email = config.BOOTSTRAP_ADMIN_EMAIL.toLowerCase().trim();
  const passwordHash = await hashPassword(config.BOOTSTRAP_ADMIN_PASSWORD);

  await prisma.user.create({
    data: {
      email,
      passwordHash,
      role: 'ADMIN',
      profiles: { create: { name: 'Admin' } },
    },
  });
  app.log.info(`Seeded bootstrap ADMIN account: ${email}`);
}
