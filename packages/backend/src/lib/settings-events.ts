/**
 * Settings change bus.
 *
 * Every consumer of `ServerSettings` reads through the in-process cache in
 * settings.service. When a write happens (from this process or another backend
 * replica/worker) the writer publishes on a Redis channel; every process that
 * subscribes invalidates its cache and re-emits locally so modules that keep
 * derived state (pollers, timers, encoder choice) can react without polling.
 */
import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import { createRedisConnection, redisConnection } from './redis.js';

export const SETTINGS_CHANNEL = 'flux:settings:changed';

export type SettingsSection =
  | 'general'
  | 'downloads'
  | 'storage'
  | 'playback'
  | 'integrations'
  | 'notifications'
  | 'setup';

export interface SettingsChangedEvent {
  /** Which sections were touched. Empty means "unknown — reload everything". */
  sections: SettingsSection[];
  /** Identifies the emitting process so we can ignore our own echo. */
  origin: string;
  at: string;
}

const processId = randomUUID();
const emitter = new EventEmitter();
emitter.setMaxListeners(50);

let subscriber: ReturnType<typeof createRedisConnection> | null = null;

/** Local listeners run after the cache has been invalidated. */
export function onSettingsChanged(listener: (event: SettingsChangedEvent) => void): () => void {
  emitter.on('changed', listener);
  return () => emitter.off('changed', listener);
}

/** Broadcast to every backend process (including this one). */
export async function publishSettingsChanged(sections: SettingsSection[]): Promise<void> {
  const event: SettingsChangedEvent = { sections, origin: processId, at: new Date().toISOString() };
  // Emit locally first so the writer observes its own change even if Redis is down.
  emitter.emit('changed', event);
  try {
    await redisConnection.publish(SETTINGS_CHANNEL, JSON.stringify(event));
  } catch {
    // Redis unavailable: local invalidation already happened; other replicas
    // fall back to the cache TTL.
  }
}

/**
 * Start listening for remote changes. Idempotent. Called once at boot; the
 * returned function closes the dedicated subscriber connection.
 */
export function startSettingsSubscriber(log?: { warn: (msg: string) => void }): () => Promise<void> {
  if (subscriber) return () => Promise.resolve();
  subscriber = createRedisConnection();
  subscriber.on('message', (_channel: string, raw: string) => {
    try {
      const event = JSON.parse(raw) as SettingsChangedEvent;
      if (event.origin === processId) return; // already emitted locally
      emitter.emit('changed', event);
    } catch {
      emitter.emit('changed', { sections: [], origin: 'unknown', at: new Date().toISOString() } satisfies SettingsChangedEvent);
    }
  });
  subscriber.subscribe(SETTINGS_CHANNEL).catch((err: unknown) => {
    log?.warn(`Settings change subscription failed: ${String(err)} (falling back to cache TTL)`);
  });
  return async () => {
    const conn = subscriber;
    subscriber = null;
    if (conn) await conn.quit().catch(() => undefined);
  };
}
