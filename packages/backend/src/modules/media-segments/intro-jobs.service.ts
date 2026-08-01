import type { Job } from 'bullmq';
import type {
  AdminIntroDashboardDTO,
  AdminIntroScanJobDTO,
  AdminIntroScanJobState,
  AdminIntroScanProgressDTO,
  AdminIntroScanResultDTO,
} from '@flux/shared';
import { config } from '../../config.js';
import { prisma } from '../../lib/db.js';
import { ApiError } from '../../lib/errors.js';
import {
  introDetectionQueue,
  type IntroDetectionJob,
} from '../../jobs/queues.js';

const JOB_STATES = ['active', 'waiting', 'delayed', 'prioritized', 'completed', 'failed'] as const;

function normalizeState(state: string): AdminIntroScanJobState {
  if (state === 'active') return 'ACTIVE';
  if (state === 'completed') return 'COMPLETED';
  if (state === 'failed') return 'FAILED';
  if (state === 'delayed') return 'DELAYED';
  return 'WAITING';
}

function normalizeProgress(
  progress: Job<IntroDetectionJob>['progress'],
  state: AdminIntroScanJobState,
): AdminIntroScanProgressDTO {
  if (progress && typeof progress === 'object' && !Array.isArray(progress)) {
    const value = progress as Partial<AdminIntroScanProgressDTO>;
    if (
      typeof value.stage === 'string' &&
      typeof value.current === 'number' &&
      typeof value.total === 'number' &&
      typeof value.percent === 'number' &&
      typeof value.message === 'string'
    ) {
      return {
        stage: value.stage,
        current: value.current,
        total: value.total,
        percent: Math.max(0, Math.min(100, Math.round(value.percent))),
        message: value.message,
      } as AdminIntroScanProgressDTO;
    }
  }
  if (state === 'COMPLETED') return { stage: 'COMPLETE', current: 1, total: 1, percent: 100, message: 'Scan complete' };
  if (state === 'FAILED') return { stage: 'COMPLETE', current: 0, total: 0, percent: 100, message: 'Scan failed' };
  if (state === 'ACTIVE') return { stage: 'LOADING', current: 0, total: 0, percent: 1, message: 'Intro detection worker started' };
  return { stage: 'QUEUED', current: 0, total: 0, percent: 0, message: 'Waiting for the intro detection worker' };
}

function normalizeResult(value: unknown): AdminIntroScanResultDTO | null {
  if (!value || typeof value !== 'object') return null;
  const result = value as Partial<AdminIntroScanResultDTO>;
  if (typeof result.mediaItemId !== 'string' || typeof result.season !== 'number') return null;
  return result as AdminIntroScanResultDTO;
}

async function mapJob(
  job: Job<IntroDetectionJob>,
  title: string,
  logs?: string[],
): Promise<AdminIntroScanJobDTO> {
  const state = normalizeState(await job.getState());
  return {
    id: job.id ?? '',
    mediaItemId: job.data.mediaItemId,
    title,
    season: job.data.season,
    force: job.data.force ?? false,
    state,
    progress: normalizeProgress(job.progress, state),
    attemptsMade: job.attemptsMade,
    createdAt: new Date(job.timestamp).toISOString(),
    processedAt: job.processedOn ? new Date(job.processedOn).toISOString() : null,
    finishedAt: job.finishedOn ? new Date(job.finishedOn).toISOString() : null,
    failedReason: job.failedReason || null,
    result: normalizeResult(job.returnvalue),
    ...(logs ? { logs } : {}),
  };
}

async function listRawJobs(limit = 100): Promise<Job<IntroDetectionJob>[]> {
  const jobs = await introDetectionQueue.getJobs([...JOB_STATES], 0, Math.max(0, limit - 1), false);
  return jobs.sort((a, b) => b.timestamp - a.timestamp);
}

export async function getAdminIntroDashboard(): Promise<AdminIntroDashboardDTO> {
  const [shows, rawJobs] = await Promise.all([
    prisma.mediaItem.findMany({
      where: { type: 'SHOW' },
      orderBy: { title: 'asc' },
      select: {
        id: true,
        title: true,
        posterPath: true,
        episodes: {
          orderBy: [{ season: 'asc' }, { episode: 'asc' }],
          select: {
            season: true,
            filePath: true,
            mediaSegments: {
              where: { type: 'INTRO' },
              select: { source: true },
            },
          },
        },
      },
    }),
    listRawJobs(),
  ]);
  const titleById = new Map(shows.map((show) => [show.id, show.title]));
  const jobs = await Promise.all(rawJobs.map((job) => mapJob(job, titleById.get(job.data.mediaItemId) ?? 'Unknown show')));
  const latestBySeason = new Map<string, AdminIntroScanJobDTO>();
  for (const job of jobs) {
    const key = `${job.mediaItemId}:${job.season}`;
    if (!latestBySeason.has(key)) latestBySeason.set(key, job);
  }

  const seasons = shows.flatMap((show) => {
    const seasonNumbers = [...new Set(show.episodes.map((episode) => episode.season))]
      .filter((season) => season > 0)
      .sort((a, b) => a - b);
    return seasonNumbers.map((season) => {
      const episodes = show.episodes.filter((episode) => episode.season === season);
      const available = episodes.filter((episode) => episode.filePath !== null);
      const introMarkers = available.filter((episode) => episode.mediaSegments.length > 0).length;
      const automaticMarkers = available.filter((episode) => episode.mediaSegments.some((segment) => segment.source === 'AUTOMATIC')).length;
      const manualMarkers = available.filter((episode) => episode.mediaSegments.some((segment) => segment.source === 'MANUAL')).length;
      return {
        mediaItemId: show.id,
        title: show.title,
        posterPath: show.posterPath,
        season,
        episodes: episodes.length,
        availableEpisodes: available.length,
        introMarkers,
        automaticMarkers,
        manualMarkers,
        coverage: available.length > 0 ? introMarkers / available.length : 0,
        latestJob: latestBySeason.get(`${show.id}:${season}`) ?? null,
      };
    });
  });
  const markedEpisodes = seasons.reduce((sum, season) => sum + season.introMarkers, 0);

  return {
    enabled: config.INTRO_DETECTION_ENABLED,
    configuration: {
      windowMinutes: config.INTRO_DETECTION_WINDOW_MINUTES,
      minimumSeconds: config.INTRO_MIN_SECONDS,
      minimumConfidence: config.INTRO_MIN_CONFIDENCE,
      minimumCoverage: config.INTRO_MIN_COVERAGE,
    },
    summary: {
      shows: shows.length,
      seasons: seasons.length,
      availableEpisodes: seasons.reduce((sum, season) => sum + season.availableEpisodes, 0),
      markedEpisodes,
      queued: jobs.filter((job) => job.state === 'WAITING' || job.state === 'DELAYED').length,
      active: jobs.filter((job) => job.state === 'ACTIVE').length,
      failed: jobs.filter((job) => job.state === 'FAILED').length,
    },
    seasons,
    jobs,
  };
}

export async function getAdminIntroJob(jobId: string): Promise<AdminIntroScanJobDTO> {
  const job = await introDetectionQueue.getJob(jobId);
  if (!job) throw ApiError.notFound('Intro scan job not found');
  const [item, jobLogs] = await Promise.all([
    prisma.mediaItem.findUnique({ where: { id: job.data.mediaItemId }, select: { title: true } }),
    introDetectionQueue.getJobLogs(jobId, 0, 499, true),
  ]);
  return mapJob(job, item?.title ?? 'Unknown show', jobLogs.logs);
}

export async function validateIntroScanTargets(
  targets: { mediaItemId: string; season: number }[],
): Promise<void> {
  const unique = new Set(targets.map((target) => `${target.mediaItemId}:${target.season}`));
  if (unique.size !== targets.length) {
    throw ApiError.badRequest('Intro scan targets must be unique', 'DUPLICATE_INTRO_TARGET');
  }
  const count = await prisma.episode.groupBy({
    by: ['mediaItemId', 'season'],
    where: {
      filePath: { not: null },
      OR: targets.map((target) => ({ mediaItemId: target.mediaItemId, season: target.season })),
    },
  });
  const available = new Set(count.map((row) => `${row.mediaItemId}:${row.season}`));
  const invalid = targets.find((target) => !available.has(`${target.mediaItemId}:${target.season}`));
  if (invalid) {
    throw ApiError.badRequest('One or more intro scan targets have no available episodes', 'INVALID_INTRO_TARGET');
  }
}
