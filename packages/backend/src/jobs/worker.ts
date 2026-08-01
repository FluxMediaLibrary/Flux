/**
 * BullMQ workers. Wiring only — the real processors are implemented in later
 * phases (torrent post-processing in phase 5, transcoding in phase 6).
 *
 * Each worker gets its own blocking Redis connection (BullMQ requirement).
 */
import { Worker, type Job } from 'bullmq';
import { bullConnection } from '../lib/redis.js';
import {
  QUEUE_NAMES,
  type IntroDetectionJob,
  type TorrentPostprocessJob,
  type TranscodeJob,
} from './queues.js';
import { processTorrentPostprocess } from '../modules/torrents/postprocess.js';
import { runIntroDetectionForSeason } from '../modules/media-segments/intro-detection/intro-detection.service.js';

let workers: Worker[] = [];

async function processTorrentPostprocessJob(
  job: Job<TorrentPostprocessJob>,
): Promise<void> {
  await processTorrentPostprocess(job);
}

async function processTranscode(job: Job<TranscodeJob>): Promise<void> {
  // TODO(phase 6): spawn FFmpeg to produce HLS segments for the session.
  job.log(`transcode stub for session ${job.data.sessionId}`);
}

async function processIntroDetection(
  job: Job<IntroDetectionJob>,
): Promise<void> {
  await runIntroDetectionForSeason(job);
}

/** Start all background workers. Called from server bootstrap. */
export function startWorkers(): Worker[] {
  const torrentWorker = new Worker<TorrentPostprocessJob>(
    QUEUE_NAMES.torrentPostprocess,
    processTorrentPostprocessJob,
    { connection: bullConnection, concurrency: 1 },
  );

  const transcodeWorker = new Worker<TranscodeJob>(
    QUEUE_NAMES.transcode,
    processTranscode,
    { connection: bullConnection, concurrency: 2 },
  );

  const introDetectionWorker = new Worker<IntroDetectionJob>(
    QUEUE_NAMES.introDetection,
    processIntroDetection,
    // Fingerprinting is FFmpeg/CPU heavy; one at a time keeps imports stable.
    { connection: bullConnection, concurrency: 1 },
  );

  workers = [torrentWorker, transcodeWorker, introDetectionWorker];
  return workers;
}

/** Gracefully close workers on shutdown. */
export async function stopWorkers(): Promise<void> {
  await Promise.all(workers.map((w) => w.close()));
  workers = [];
}
