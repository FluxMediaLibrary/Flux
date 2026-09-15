/**
 * BullMQ workers. Each worker gets its own blocking Redis connection (BullMQ
 * requirement). HLS transcoding is not a queue job — it is spawned on demand
 * by the streaming routes because a session must start within a second.
 */
import { Worker, type Job } from 'bullmq';
import { bullConnection } from '../lib/redis.js';
import {
  QUEUE_NAMES,
  type IntroDetectionJob,
  type LibraryScanJob,
  type TorrentPostprocessJob,
} from './queues.js';
import { processTorrentPostprocess } from '../modules/torrents/postprocess.js';
import { runIntroDetectionForSeason } from '../modules/media-segments/intro-detection/intro-detection.service.js';
import { runLibraryScan } from '../modules/library/library-scan.service.js';

let workers: Worker[] = [];

async function processTorrentPostprocessJob(
  job: Job<TorrentPostprocessJob>,
): Promise<void> {
  await processTorrentPostprocess(job);
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

  const libraryScanWorker = new Worker<LibraryScanJob>(
    QUEUE_NAMES.libraryScan,
    runLibraryScan,
    { connection: bullConnection, concurrency: 1 },
  );

  const introDetectionWorker = new Worker<IntroDetectionJob>(
    QUEUE_NAMES.introDetection,
    processIntroDetection,
    // Fingerprinting is FFmpeg/CPU heavy; one at a time keeps imports stable.
    { connection: bullConnection, concurrency: 1 },
  );

  workers = [torrentWorker, libraryScanWorker, introDetectionWorker];
  return workers;
}

/** Gracefully close workers on shutdown. */
export async function stopWorkers(): Promise<void> {
  await Promise.all(workers.map((w) => w.close()));
  workers = [];
}
