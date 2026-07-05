/**
 * ioredis connection factory for BullMQ.
 *
 * BullMQ requires `maxRetriesPerRequest: null` on its connection, otherwise it
 * throws at startup. We expose a shared connection for producers (queues) and a
 * factory for consumers (workers), since a blocking worker should not share the
 * command connection used by queues.
 */
import { Redis, type RedisOptions } from 'ioredis';
import { config } from '../config.js';

const baseOptions: RedisOptions = {
  maxRetriesPerRequest: null,
  enableReadyCheck: false,
};

/** Shared ioredis connection for general commands (non-BullMQ use). */
export const redisConnection = new Redis(config.REDIS_URL, baseOptions);

/** Create a dedicated ioredis connection (general use). */
export function createRedisConnection(): Redis {
  return new Redis(config.REDIS_URL, baseOptions);
}

/**
 * Plain connection options for BullMQ. We hand BullMQ options (not a shared
 * ioredis instance) so it constructs connections with its own bundled ioredis,
 * avoiding a duplicate-ioredis type/version clash. BullMQ manages the lifecycle
 * of the connections it creates from these options.
 */
function parseBullConnection() {
  const url = new URL(config.REDIS_URL);
  const options: RedisOptions = {
    host: url.hostname,
    port: url.port ? Number(url.port) : 6379,
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
  };
  if (url.username) options.username = decodeURIComponent(url.username);
  if (url.password) options.password = decodeURIComponent(url.password);
  const dbPath = url.pathname.replace(/^\//, '');
  if (dbPath) options.db = Number(dbPath);
  if (url.protocol === 'rediss:') options.tls = {};
  return options;
}

/** Shared BullMQ connection options (queues + workers). */
export const bullConnection = parseBullConnection();
