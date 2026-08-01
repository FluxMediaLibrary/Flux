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

export interface IntroDetectionJobData {
  mediaItemId: string;
  season: number;
  /** When true, replace manual INTRO markers too (explicit admin request). */
  force?: boolean;
}

export interface SeasonDetectionResult {
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
  job: { data: IntroDetectionJobData; log?: (message: string) => void },
): Promise<SeasonDetectionResult> {
  const { mediaItemId, season, force = false } = job.data;
  const log = (message: string) => {
    const line = `[IntroDetection] ${message}`;
    if (job.log) job.log(line);
    else console.log(line);
  };

  const result: SeasonDetectionResult = {
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

  if (!config.INTRO_DETECTION_ENABLED) {
    log(`disabled by config for ${mediaItemId} S${season}`);
    return { ...result, enabled: false };
  }

  const episodes = await prisma.episode.findMany({
    where: { mediaItemId, season, filePath: { not: null } },
    orderBy: { episode: 'asc' },
    select: { id: true, episode: true, filePath: true },
  });
  result.episodes = episodes.length;

  if (episodes.length < MIN_EPISODES) {
    log(`skipping ${mediaItemId} S${season}: only ${episodes.length} episode(s) with files`);
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
    log(`skipping ${mediaItemId} S${season}: fewer than ${MIN_EPISODES} non-manual episodes`);
    return result;
  }

  log(`fingerprinting ${candidates.length} episode(s) of ${mediaItemId} S${season}${force ? ' (forced, manual markers included)' : ''}`);
  const fingerprints = await mapLimit(candidates, 2, async (episode) => {
    const fingerprint = await fingerprintEpisodeAudio(episode.filePath!, episode.id);
    if (!fingerprint) result.failed += 1;
    return fingerprint;
  });

  const valid = fingerprints.filter((fp): fp is NonNullable<typeof fp> => fp !== null);
  result.fingerprinted = valid.length;

  if (valid.length < MIN_EPISODES) {
    log(`aborting ${mediaItemId} S${season}: only ${valid.length} episode(s) fingerprinted`);
    return result;
  }

  const matches = detectRepeatedIntro(valid, {
    windowSeconds: config.INTRO_DETECTION_WINDOW_MINUTES * 60,
    minSeconds: config.INTRO_MIN_SECONDS,
    minConfidence: config.INTRO_MIN_CONFIDENCE,
    minCoverage: config.INTRO_MIN_COVERAGE,
    minEpisodes: MIN_EPISODES,
  });

  if (!matches || matches.length === 0) {
    log(`no repeated intro found for ${mediaItemId} S${season}; clearing stale automatic markers`);
    await prisma.mediaSegment.deleteMany({
      where: {
        episodeId: { in: candidates.map((episode) => episode.id) },
        type: 'INTRO',
        source: 'AUTOMATIC',
      },
    });
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
  const averageConfidence = rows.length > 0
    ? rows.reduce((sum, row) => sum + row.confidence, 0) / rows.length
    : 0;
  log(
    `stored ${result.matched} INTRO segment(s) for ${mediaItemId} S${season} ` +
    `(avg confidence ${averageConfidence.toFixed(2)}, force=${force})`,
  );
  return result;
}
