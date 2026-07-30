/**
 * Backend entry point. Builds the Fastify server, seeds the bootstrap admin,
 * starts BullMQ workers, and listens. Handles graceful shutdown.
 */
import { config } from './config.js';
import { prisma } from './lib/db.js';
import { redisConnection } from './lib/redis.js';
import { buildServer, seedBootstrapAdmin } from './server.js';
import { startWorkers, stopWorkers } from './jobs/worker.js';
import { startTorrentPoller, stopTorrentPoller } from './jobs/torrent-poller.js';
import { checkTorrentClient } from './lib/webtorrent.js';

async function main(): Promise<void> {
  const app = await buildServer();

  if (config.NODE_ENV === 'production' && config.TRANSMISSION_PASS.length < 12) {
    app.log.warn(
      'TRANSMISSION_PASS is a legacy weak value. Flux will remain available, but rotate it to at least 12 characters in .env and recreate backend + Transmission.',
    );
  }

  await seedBootstrapAdmin(app);
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
