/**
 * Backend entry point. Builds the Fastify server, seeds the bootstrap admin,
 * starts BullMQ workers, and listens. Handles graceful shutdown.
 */
import { config } from './config.js';
import { prisma } from './lib/db.js';
import { redisConnection } from './lib/redis.js';
import { buildServer, seedBootstrapAdmin } from './server.js';
import { startWorkers, stopWorkers } from './jobs/worker.js';

async function main(): Promise<void> {
  const app = await buildServer();

  await seedBootstrapAdmin(app);
  startWorkers();

  await app.listen({ host: '0.0.0.0', port: config.BACKEND_PORT });

  const shutdown = async (signal: string): Promise<void> => {
    app.log.info(`Received ${signal}, shutting down...`);
    try {
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
