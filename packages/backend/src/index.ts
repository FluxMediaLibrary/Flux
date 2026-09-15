/**
 * Backend entry point. Builds the Fastify server, seeds the bootstrap admin,
 * starts BullMQ workers, and listens. Handles graceful shutdown.
 */
import { config, DEPRECATED_ENV_VARS } from './config.js';
import { prisma } from './lib/db.js';
import { redisConnection } from './lib/redis.js';
import { startSettingsSubscriber } from './lib/settings-events.js';
import { buildServer, seedBootstrapAdmin } from './server.js';
import { startWorkers, stopWorkers } from './jobs/worker.js';
import { startTorrentPoller, stopTorrentPoller } from './jobs/torrent-poller.js';
import { checkTorrentClient } from './lib/webtorrent.js';
import { reconcileSetupState } from './modules/setup/setup.service.js';

async function main(): Promise<void> {
  const app = await buildServer();

  for (const entry of DEPRECATED_ENV_VARS) {
    app.log.warn(`${entry.name} is no longer used. Configure it in ${entry.replacement}.`);
  }

  const stopSettingsSubscriber = startSettingsSubscriber(app.log);
  await seedBootstrapAdmin(app);
  await reconcileSetupState(app.log);
  startWorkers();
  startTorrentPoller(app.log);

  const torrentClient = await checkTorrentClient();
  if (torrentClient.ok) {
    app.log.info(`Transmission RPC ready at ${torrentClient.url}`);
  } else {
    app.log.warn(`Transmission RPC is not ready at ${torrentClient.url}: ${torrentClient.message}`);
  }

  // Resume any torrents that were downloading/seeding when we last shut down.
  try {
    const { resumeTorrents } = await import('./lib/webtorrent.js');
    const resumed = await resumeTorrents();
    if (resumed > 0) {
      app.log.info(`Resumed ${resumed} torrent(s) on boot`);
    }
  } catch (err) {
    app.log.warn(`Failed to resume torrents on boot: ${String(err)}`);
  }

  await app.listen({ host: '0.0.0.0', port: config.BACKEND_PORT });

  const shutdown = async (signal: string): Promise<void> => {
    app.log.info(`Received ${signal}, shutting down...`);
    try {
      stopTorrentPoller();
      await app.close();
      await stopWorkers();
      await stopSettingsSubscriber();
      await redisConnection.quit();
      await prisma.$disconnect();
    } catch (err) {
      app.log.error(err);
    } finally {
      process.exit(0);
    }
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('Fatal startup error:', err);
  process.exit(1);
});
