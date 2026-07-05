/**
 * BullMQ queues. Producers add jobs here; workers (worker.ts) consume them.
 * Actual job payload/processing logic is implemented in later phases.
 */
import { Queue } from 'bullmq';
import { bullConnection } from '../lib/redis.js';

export const QUEUE_NAMES = {
  torrentPostprocess: 'torrent-postprocess',
  transcode: 'transcode',
} as const;

export type QueueName = (typeof QUEUE_NAMES)[keyof typeof QUEUE_NAMES];

// ─── Job payload shapes (stubs — refined in later phases) ─────────────────────

/** TODO(phase 5): fields for renaming/moving/season-pack splitting. */
export interface TorrentPostprocessJob {
  torrentId: string;
}

/** TODO(phase 6): fields for an on-demand HLS transcode session. */
export interface TranscodeJob {
  mediaItemId?: string;
  episodeId?: string;
  sessionId: string;
}

const defaultJobOptions = {
  attempts: 3,
  backoff: { type: 'exponential', delay: 5000 },
  removeOnComplete: { count: 100 },
  removeOnFail: { count: 500 },
} as const;

export const torrentPostprocessQueue = new Queue<TorrentPostprocessJob>(
  QUEUE_NAMES.torrentPostprocess,
  { connection: bullConnection, defaultJobOptions },
);

export const transcodeQueue = new Queue<TranscodeJob>(QUEUE_NAMES.transcode, {
  connection: bullConnection,
  defaultJobOptions,
});
