/**
 * Intro-detection job orchestration.
 *
 * Loads a season's episodes, fingerprints their first N minutes of audio,
 * runs the offset-aware detector, and persists INTRO segments into
 * media_segments. Manual markers are protected: a normal rescan never
 * fingerprints or overwrites episodes that have a MANUAL INTRO segment;
 * a forced rescan replaces everything (manual included).
 */
import { prisma } from '../../../lib/db.js';
import { config } from '../../../config.js';
import { fingerprintEpisodeAudio } from './audio-fingerprint.js';
import { detectRepeatedIntro, type IntroMatch } from './intro-detector.js';
import type {
  AdminIntroScanOutcome,
  AdminIntroScanProgressDTO,
  AdminIntroScanResultDTO,
} from '@flux/shared';

export interface IntroDetectionJobData {
  mediaItemId: string;
  season: number;
  /** When true, replace manual INTRO markers too (explicit admin request). */
  force?: boolean;
}

export interface SeasonDetectionResult extends AdminIntroScanResultDTO {
  outcome: AdminIntroScanOutcome;
  enabled: boolean;
  mediaItemId: string;
  season: number;
  force: boolean;
  episodes: number;
  fingerprinted: number;
  detected: number;
  matched: number;
  skippedManual: number;
  failed: number;
}

const MIN_EPISODES = 3;

function clampConfidence(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

/** Run a small map with limited parallelism (FFmpeg is CPU-heavy). */
async function mapLimit<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await fn(items[index]!);
    }
  });
  await Promise.all(workers);
  return results;
}

export async function runIntroDetectionForSeason(
  job: {
    data: IntroDetectionJobData;
    log?: (message: string) => unknown | Promise<unknown>;
    updateProgress?: (progress: AdminIntroScanProgressDTO) => unknown | Promise<unknown>;
  },
): Promise<SeasonDetectionResult> {
  const { mediaItemId, season, force = false } = job.data;
  const log = async (message: string) => {
    const line = `[IntroDetection] ${message}`;
    if (job.log) await job.log(line);
    else console.log(line);
  };
  const updateProgress = async (
    stage: AdminIntroScanProgressDTO['stage'],
    current: number,
    total: number,
    percent: number,
    message: string,
  ) => {
    await job.updateProgress?.({
      stage,
      current,
      total,
      percent: Math.max(0, Math.min(100, Math.round(percent))),
      message,
    });
  };

  const result: SeasonDetectionResult = {
    outcome: 'SKIPPED',
    enabled: true,
    mediaItemId,
    season,
    force,
    episodes: 0,
    fingerprinted: 0,
    detected: 0,
    matched: 0,
    skippedManual: 0,
    failed: 0,
  };

  await updateProgress('LOADING', 0, 0, 2, `Loading season ${season}`);
  await log(`started ${mediaItemId} S${season} (force=${force})`);

  if (!config.INTRO_DETECTION_ENABLED) {
    await log(`disabled by config for ${mediaItemId} S${season}`);
    await updateProgress('COMPLETE', 0, 0, 100, 'Intro detection is disabled by server configuration');
    return { ...result, enabled: false, outcome: 'DISABLED' };
  }

  const episodes = await prisma.episode.findMany({
    where: { mediaItemId, season, filePath: { not: null } },
    orderBy: { episode: 'asc' },
    select: { id: true, episode: true, filePath: true },
  });
  result.episodes = episodes.length;
  await log(`found ${episodes.length} episode file(s)`);

  if (episodes.length < MIN_EPISODES) {
    await log(`skipping ${mediaItemId} S${season}: only ${episodes.length} episode(s) with files`);
    await updateProgress('COMPLETE', episodes.length, episodes.length, 100, `Skipped: at least ${MIN_EPISODES} episodes are required`);
    return result;
  }

  // Manual markers are the admin's source of truth. Unless the rescan is
  // explicitly forced, episodes with a MANUAL INTRO segment are left alone.
  const manualSegments = await prisma.mediaSegment.findMany({
    where: {
      episodeId: { in: episodes.map((episode) => episode.id) },
      type: 'INTRO',
      source: 'MANUAL',
    },
    select: { episodeId: true },
  });
  const manualEpisodeIds = new Set(manualSegments.map((segment) => segment.episodeId));
  const candidates = force
    ? episodes
    : episodes.filter((episode) => !manualEpisodeIds.has(episode.id));
  result.skippedManual = episodes.length - candidates.length;

  if (candidates.length < MIN_EPISODES) {
    await log(`skipping ${mediaItemId} S${season}: fewer than ${MIN_EPISODES} non-manual episodes`);
    await updateProgress('COMPLETE', candidates.length, candidates.length, 100, 'Skipped: manual markers leave too few episodes to compare');
    return result;
  }

  await log(`fingerprinting ${candidates.length} episode(s) of ${mediaItemId} S${season}${force ? ' (forced, manual markers included)' : ''}`);
  await updateProgress('FINGERPRINTING', 0, candidates.length, 10, `Fingerprinting 0 of ${candidates.length} episodes`);
  let completedFingerprints = 0;
  const fingerprints = await mapLimit(candidates, 2, async (episode) => {
    const fingerprint = await fingerprintEpisodeAudio(
      episode.filePath!,
      episode.id,
      undefined,
      (message) => log(`S${season}E${episode.episode}: ${message}`),
    );
    if (!fingerprint) result.failed += 1;
    completedFingerprints += 1;
    await log(`${fingerprint ? 'fingerprinted' : 'failed to fingerprint'} S${season}E${episode.episode}`);
    await updateProgress(
      'FINGERPRINTING',
      completedFingerprints,
      candidates.length,
      10 + (completedFingerprints / candidates.length) * 60,
      `Fingerprinting ${completedFingerprints} of ${candidates.length} episodes`,
    );
    return fingerprint;
  });

  const valid = fingerprints.filter((fp): fp is NonNullable<typeof fp> => fp !== null);
  result.fingerprinted = valid.length;

  if (valid.length < MIN_EPISODES) {
    await log(`aborting ${mediaItemId} S${season}: only ${valid.length} episode(s) fingerprinted`);
    await updateProgress('COMPLETE', valid.length, candidates.length, 100, `Stopped: only ${valid.length} episodes could be fingerprinted`);
    return result;
  }

  await updateProgress('DETECTING', valid.length, candidates.length, 76, 'Comparing fingerprints for repeated audio');
  await log(`comparing ${valid.length} fingerprints (minimum ${config.INTRO_MIN_SECONDS}s, confidence ${config.INTRO_MIN_CONFIDENCE})`);
  const matches = detectRepeatedIntro(valid, {
    windowSeconds: config.INTRO_DETECTION_WINDOW_MINUTES * 60,
    minSeconds: config.INTRO_MIN_SECONDS,
    minConfidence: config.INTRO_MIN_CONFIDENCE,
    minCoverage: config.INTRO_MIN_COVERAGE,
    minEpisodes: MIN_EPISODES,
  });

  if (!matches || matches.length === 0) {
    await log(`no repeated intro found for ${mediaItemId} S${season}; clearing stale automatic markers`);
    await updateProgress('STORING', valid.length, candidates.length, 92, 'Clearing stale automatic markers');
    await prisma.mediaSegment.deleteMany({
      where: {
        episodeId: { in: candidates.map((episode) => episode.id) },
        type: 'INTRO',
        source: 'AUTOMATIC',
      },
    });
    result.outcome = 'NO_MATCH';
    await updateProgress('COMPLETE', valid.length, candidates.length, 100, 'Complete: no repeated intro met the configured threshold');
    return result;
  }

  result.detected = matches.length;

  const rows = matches.flatMap((match: IntroMatch) => {
    const startMs = Math.max(0, Math.round(match.startMs));
    const endMs = Math.max(startMs + 1, Math.round(match.endMs));
    return {
      episodeId: match.episodeId,
      type: 'INTRO' as const,
      startMs,
      endMs,
      confidence: clampConfidence(match.confidence),
      source: 'AUTOMATIC' as const,
    };
  });

  await updateProgress('STORING', rows.length, candidates.length, 90, `Saving ${rows.length} detected intro marker(s)`);
  await prisma.$transaction(async (tx) => {
    await tx.mediaSegment.deleteMany({
      where: force
        ? { episodeId: { in: episodes.map((episode) => episode.id) }, type: 'INTRO' }
        : { episodeId: { in: candidates.map((episode) => episode.id) }, type: 'INTRO', source: 'AUTOMATIC' },
    });
    if (rows.length > 0) {
      await tx.mediaSegment.createMany({ data: rows });
    }
  });

  result.matched = rows.length;
  result.outcome = 'MATCHED';
  const averageConfidence = rows.length > 0
    ? rows.reduce((sum, row) => sum + row.confidence, 0) / rows.length
    : 0;
  await log(
    `stored ${result.matched} INTRO segment(s) for ${mediaItemId} S${season} ` +
    `(avg confidence ${averageConfidence.toFixed(2)}, force=${force})`,
  );
  await updateProgress('COMPLETE', rows.length, candidates.length, 100, `Complete: stored ${rows.length} intro marker(s)`);
  return result;
}
