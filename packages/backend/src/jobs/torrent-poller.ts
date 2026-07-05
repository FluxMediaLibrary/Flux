/**
 * Background torrent poller. Periodically sweeps for downloads that have
 * finished and enqueues their post-processing job — so completion is detected
 * even when no admin has the dashboard open (the dashboard's on-demand listing
 * runs the same check via listTorrents).
 *
 * A run never overlaps itself: if a sweep is still in flight when the timer
 * fires, that tick is skipped.
 */
import type { FastifyBaseLogger } from 'fastify';
import { config } from '../config.js';
import { reconcileCompletedTorrents } from '../modules/torrents/torrents.service.js';

let timer: NodeJS.Timeout | null = null;
let running = false;

/** Start the periodic sweep. Idempotent — a second call is a no-op. */
export function startTorrentPoller(log: FastifyBaseLogger): void {
  if (timer) return;

  const tick = async (): Promise<void> => {
    if (running) return; // previous sweep still in flight
    running = true;
    try {
      await reconcileCompletedTorrents();
    } catch (err) {
      log.warn(`[TorrentPoller] sweep failed: ${String(err)}`);
    } finally {
      running = false;
    }
  };

  timer = setInterval(() => void tick(), config.TORRENT_POLL_INTERVAL_MS);
  // Don't let the poller keep the event loop alive on shutdown.
  timer.unref();
  log.info(
    `[TorrentPoller] started (every ${config.TORRENT_POLL_INTERVAL_MS}ms)`,
  );
}

/** Stop the periodic sweep. */
export function stopTorrentPoller(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}
