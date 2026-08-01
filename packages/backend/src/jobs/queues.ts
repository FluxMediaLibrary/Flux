/**
 * BullMQ queues. Producers add jobs here; workers (worker.ts) consume them.
 * Actual job payload/processing logic is implemented in later phases.
 */
import { Queue } from 'bullmq';
import { bullConnection } from '../lib/redis.js';

export const QUEUE_NAMES = {
  torrentPostprocess: 'torrent-postprocess',
  transcode: 'transcode',
  introDetection: 'intro-detection',
} as const;

export type QueueName = (typeof QUEUE_NAMES)[keyof typeof QUEUE_NAMES];

// ─── Job payload shapes (stubs — refined in later phases) ─────────────────────

export interface TorrentPostprocessJob {
  torrentId: string;
  infoHash: string;
}

/** TODO(phase 6): fields for an on-demand HLS transcode session. */
export interface TranscodeJob {
  mediaItemId?: string;
  episodeId?: string;
  sessionId: string;
}

export interface IntroDetectionJob {
  mediaItemId: string;
  season: number;
  /** When true, replace manual INTRO markers too (explicit admin request). */
  force?: boolean;
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

export const introDetectionQueue = new Queue<IntroDetectionJob>(
  QUEUE_NAMES.introDetection,
  {
    connection: bullConnection,
    defaultJobOptions,
  },
);

/**
 * Enqueue an intro-detection pass for a season. The deterministic jobId keeps
 * repeated imports/rescans from stacking duplicate queued jobs; adding the
 * same jobId again replaces the pending job payload (e.g. force=true).
 */
export async function enqueueIntroDetection(
  mediaItemId: string,
  season: number,
  options: { force?: boolean } = {},
): Promise<void> {
  await introDetectionQueue.add(
    'intro-detection',
    { mediaItemId, season, force: options.force ?? false },
    { jobId: `intro-detect:${mediaItemId}:${season}` },
  );
}
