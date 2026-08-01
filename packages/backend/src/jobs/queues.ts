/**
 * BullMQ queues. Producers add jobs here; workers (worker.ts) consume them.
 * Actual job payload/processing logic is implemented in later phases.
 */
import { randomUUID } from 'node:crypto';
import { Job, Queue } from 'bullmq';
import type { AdminIntroScanProgressDTO } from '@flux/shared';
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
 * Enqueue an intro-detection pass for a season. Waiting/active work is reused,
 * while every completed rescan gets a fresh ID so an old BullMQ record can
 * never swallow a new admin request.
 */
export async function enqueueIntroDetection(
  mediaItemId: string,
  season: number,
  options: { force?: boolean } = {},
): Promise<{ job: Job<IntroDetectionJob>; deduplicated: boolean }> {
  const force = options.force ?? false;
  const pending = await introDetectionQueue.getJobs(
    ['active', 'waiting', 'delayed', 'prioritized'],
    0,
    250,
    true,
  );
  const existing = pending.find((job) => (
    job.data.mediaItemId === mediaItemId &&
    job.data.season === season &&
    job.data.force === force
  ));
  if (existing) return { job: existing, deduplicated: true };

  const job = await introDetectionQueue.add(
    'intro-detection',
    { mediaItemId, season, force },
    { jobId: `intro-detect-${mediaItemId}-${season}-${randomUUID()}` },
  );
  const progress: AdminIntroScanProgressDTO = {
    stage: 'QUEUED',
    current: 0,
    total: 0,
    percent: 0,
    message: 'Waiting for the intro detection worker',
  };
  await job.updateProgress(progress);
  return { job, deduplicated: false };
}
