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
  type TorrentPostprocessJob,
  type TranscodeJob,
} from './queues.js';

let workers: Worker[] = [];

async function processTorrentPostprocess(
  job: Job<TorrentPostprocessJob>,
): Promise<void> {
  // TODO(phase 5): rename/move downloaded files into the library structure,
  // split season packs, update Torrent + MediaItem, fulfil linked request.
  job.log(`torrent-postprocess stub for torrent ${job.data.torrentId}`);
}

async function processTranscode(job: Job<TranscodeJob>): Promise<void> {
  // TODO(phase 6): spawn FFmpeg to produce HLS segments for the session.
  job.log(`transcode stub for session ${job.data.sessionId}`);
}

/** Start all background workers. Called from server bootstrap. */
export function startWorkers(): Worker[] {
  const torrentWorker = new Worker<TorrentPostprocessJob>(
    QUEUE_NAMES.torrentPostprocess,
    processTorrentPostprocess,
    { connection: bullConnection, concurrency: 1 },
  );

  const transcodeWorker = new Worker<TranscodeJob>(
    QUEUE_NAMES.transcode,
    processTranscode,
    { connection: bullConnection, concurrency: 2 },
  );

  workers = [torrentWorker, transcodeWorker];
  return workers;
}

/** Gracefully close workers on shutdown. */
export async function stopWorkers(): Promise<void> {
  await Promise.all(workers.map((w) => w.close()));
  workers = [];
}
