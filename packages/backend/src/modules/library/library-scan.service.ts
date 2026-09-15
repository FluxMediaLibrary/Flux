/**
 * Library import scan — index media that is already on disk.
 *
 * Flux normally learns about files when it imports a download. Files that were
 * copied into a media root by hand (or that survive a database reset) are
 * invisible until this scan runs. It walks every configured media root using
 * the library layout Flux itself writes:
 *
 *   <root>/movies/<Title (Year)>/<file>.<ext>
 *   <root>/tv/<Show>/Season NN/<file>.<ext>
 *
 * For each unknown video file it guesses a title/year (movies) or show/season/
 * episode (TV) from the folder + file name, asks TMDb, and creates the
 * MediaItem/Episode rows when the match is confident. Anything ambiguous is
 * reported as "unmatched" with candidate titles so an admin can resolve it by
 * hand. Files already referenced by the database are skipped, so re-running
 * the scan is safe and cheap.
 *
 * One scan runs at a time (BullMQ singleton job id). Progress and the final
 * report live in Redis so they survive a backend restart and are visible from
 * every process.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import type { Job } from 'bullmq';
import type { MediaType } from '@flux/shared';
import type {
  LibraryScanReportDTO,
  LibraryScanUnmatchedDTO,
  LibraryScanErrorDTO,
  LibraryScanCandidateDTO,
  ResolveLibraryScanFileRequest,
} from '@flux/shared';
import { prisma } from '../../lib/db.js';
import { ApiError } from '../../lib/errors.js';
import { redisConnection } from '../../lib/redis.js';
import { MEDIA_ROOTS, containingMediaRoot } from '../../lib/storage.js';
import { guessFileEpisode, guessFromTorrentName, isVideoFile } from '../../lib/filename.js';
import { pickConfidentMatch, seasonFromFolder } from './library-scan-match.js';
import { analyzeAndStoreMedia } from '../../lib/media-analyzer.js';
import { enqueueIntroDetection, libraryScanQueue, type LibraryScanJob } from '../../jobs/queues.js';
import {
  getDetail as getTmdbDetail,
  getSeasonEpisodes as getTmdbSeasonEpisodes,
  search as tmdbSearch,
} from '../tmdb/tmdb.service.js';

const STATE_KEY = 'flux:library-scan:state';
const STATE_TTL_SECONDS = 7 * 24 * 3600;
const SCAN_JOB_ID = 'library-scan';
const MAX_UNMATCHED = 500;
const MAX_ERRORS = 200;
/** How many TMDb lookups to keep in flight. */
const MATCH_CONCURRENCY = 4;

// ── State persistence ───────────────────────────────────────────────────────

function emptyReport(): LibraryScanReportDTO {
  return {
    status: 'IDLE',
    startedAt: null,
    finishedAt: null,
    roots: [...MEDIA_ROOTS],
    progress: { filesSeen: 0, filesSkipped: 0, filesMatched: 0, filesUnmatched: 0, errors: 0, stage: 'Idle' },
    created: { movies: 0, shows: 0, episodes: 0 },
    unmatched: [],
    errors: [],
  };
}

export async function getLibraryScanReport(): Promise<LibraryScanReportDTO> {
  try {
    const raw = await redisConnection.get(STATE_KEY);
    if (raw) return JSON.parse(raw) as LibraryScanReportDTO;
  } catch {
    // Redis unavailable: report idle rather than failing the admin page.
  }
  return emptyReport();
}

async function saveReport(report: LibraryScanReportDTO): Promise<void> {
  await redisConnection.set(STATE_KEY, JSON.stringify(report), 'EX', STATE_TTL_SECONDS).catch(() => undefined);
}

// ── Starting a scan ─────────────────────────────────────────────────────────

export async function startLibraryScan(): Promise<{ started: boolean; report: LibraryScanReportDTO }> {
  const existing = await libraryScanQueue.getJob(SCAN_JOB_ID);
  if (existing) {
    const state = await existing.getState();
    if (state === 'active' || state === 'waiting' || state === 'delayed' || state === 'prioritized') {
      return { started: false, report: await getLibraryScanReport() };
    }
    // A finished/failed record with the singleton id blocks re-adding; clear it.
    await existing.remove().catch(() => undefined);
  }
  const report: LibraryScanReportDTO = { ...emptyReport(), status: 'QUEUED', startedAt: new Date().toISOString() };
  report.progress.stage = 'Waiting for the scan worker';
  await saveReport(report);
  await libraryScanQueue.add('library-scan', { requestedAt: report.startedAt! }, { jobId: SCAN_JOB_ID, attempts: 1 });
  return { started: true, report };
}

// ── Filesystem walk ─────────────────────────────────────────────────────────

interface MovieCandidateFile {
  kind: 'movie';
  root: string;
  filePath: string;
  sizeBytes: number;
  /** Folder name is the best title source in the Flux layout; fall back to file name. */
  label: string;
}

interface EpisodeCandidateFile {
  kind: 'episode';
  root: string;
  filePath: string;
  sizeBytes: number;
  showLabel: string;
  season: number | null;
  episode: number | null;
}

type CandidateFile = MovieCandidateFile | EpisodeCandidateFile;

async function listDir(dir: string): Promise<import('node:fs').Dirent[]> {
  try {
    return await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
}

async function* walkVideoFiles(dir: string, depth = 0): AsyncGenerator<{ filePath: string; sizeBytes: number }> {
  if (depth > 6) return;
  for (const entry of await listDir(dir)) {
    if (entry.name.startsWith('.')) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      yield* walkVideoFiles(full, depth + 1);
    } else if (entry.isFile() && isVideoFile(entry.name) && !entry.name.endsWith('.flux-partial')) {
      const stat = await fs.stat(full).catch(() => null);
      if (stat) yield { filePath: full, sizeBytes: stat.size };
    }
  }
}

async function collectCandidates(root: string): Promise<CandidateFile[]> {
  const out: CandidateFile[] = [];

  const moviesDir = path.join(root, 'movies');
  for (const entry of await listDir(moviesDir)) {
    if (entry.name.startsWith('.')) continue;
    const full = path.join(moviesDir, entry.name);
    if (entry.isDirectory()) {
      for await (const file of walkVideoFiles(full)) {
        out.push({ kind: 'movie', root, filePath: file.filePath, sizeBytes: file.sizeBytes, label: entry.name });
      }
    } else if (entry.isFile() && isVideoFile(entry.name)) {
      const stat = await fs.stat(full).catch(() => null);
      if (stat) out.push({ kind: 'movie', root, filePath: full, sizeBytes: stat.size, label: path.parse(entry.name).name });
    }
  }

  const tvDir = path.join(root, 'tv');
  for (const show of await listDir(tvDir)) {
    if (!show.isDirectory() || show.name.startsWith('.')) continue;
    const showDir = path.join(tvDir, show.name);
    for await (const file of walkVideoFiles(showDir)) {
      const rel = path.relative(showDir, file.filePath);
      const segments = rel.split(path.sep);
      const folderSeason = segments.length > 1 ? seasonFromFolder(segments[0]!) : null;
      const guess = guessFileEpisode(rel);
      out.push({
        kind: 'episode',
        root,
        filePath: file.filePath,
        sizeBytes: file.sizeBytes,
        showLabel: show.name,
        season: guess.season ?? folderSeason,
        episode: guess.episode,
      });
    }
  }

  return out;
}

// ── Matching ────────────────────────────────────────────────────────────────

interface MatchOutcome {
  tmdbId: number | null;
  candidates: LibraryScanCandidateDTO[];
  guessTitle: string;
  guessYear: number | null;
}

async function matchTitle(type: MediaType, label: string): Promise<MatchOutcome> {
  const guess = guessFromTorrentName(label);
  // For a movie folder like "Title (2019)" parse-torrent-title already splits
  // title/year; for bare folders the year may be absent.
  const guessTitle = guess.title.trim() || label;
  const results = await tmdbSearch(guessTitle, type === 'MOVIE' ? 'movie' : 'show');
  const candidates: LibraryScanCandidateDTO[] = results.slice(0, 6).map((result) => ({
    tmdbId: result.tmdbId,
    title: result.title,
    year: result.year,
    posterPath: result.posterPath,
  }));
  return { tmdbId: pickConfidentMatch(results, guessTitle, guess.year), candidates, guessTitle, guessYear: guess.year };
}

// ── Persisting matches ──────────────────────────────────────────────────────

async function upsertMovie(tmdbId: number, filePath: string): Promise<{ mediaItemId: string; created: boolean }> {
  const detail = await getTmdbDetail('MOVIE', tmdbId);
  const existing = await prisma.mediaItem.findUnique({ where: { tmdbId_type: { tmdbId, type: 'MOVIE' } }, select: { id: true, filePath: true } });
  const row = await prisma.mediaItem.upsert({
    where: { tmdbId_type: { tmdbId, type: 'MOVIE' } },
    create: {
      tmdbId,
      type: 'MOVIE',
      title: detail.title,
      year: detail.year ?? null,
      overview: detail.overview,
      posterPath: detail.posterPath,
      backdropPath: detail.backdropPath,
      genres: detail.genres,
      filePath,
      metadata: detail as object,
    },
    update: {
      // A movie already present with a working file keeps its file; only a
      // row with no file (missing/removed) adopts the scanned one.
      ...(existing?.filePath ? {} : { filePath }),
      title: detail.title,
      overview: detail.overview,
      posterPath: detail.posterPath,
      backdropPath: detail.backdropPath,
      genres: detail.genres,
      metadata: detail as object,
    },
  });
  return { mediaItemId: row.id, created: !existing };
}

const showCache = new Map<number, { mediaItemId: string; created: boolean; title: string }>();
const seasonMetaCache = new Map<string, Awaited<ReturnType<typeof getTmdbSeasonEpisodes>>>();

async function upsertShow(tmdbId: number): Promise<{ mediaItemId: string; created: boolean; title: string }> {
  const cached = showCache.get(tmdbId);
  if (cached) return { ...cached, created: false };
  const detail = await getTmdbDetail('SHOW', tmdbId);
  const existing = await prisma.mediaItem.findUnique({ where: { tmdbId_type: { tmdbId, type: 'SHOW' } }, select: { id: true } });
  const row = await prisma.mediaItem.upsert({
    where: { tmdbId_type: { tmdbId, type: 'SHOW' } },
    create: {
      tmdbId,
      type: 'SHOW',
      title: detail.title,
      year: detail.year ?? null,
      overview: detail.overview,
      posterPath: detail.posterPath,
      backdropPath: detail.backdropPath,
      genres: detail.genres,
      metadata: detail as object,
    },
    update: {
      title: detail.title,
      overview: detail.overview,
      posterPath: detail.posterPath,
      backdropPath: detail.backdropPath,
      genres: detail.genres,
      metadata: detail as object,
    },
  });
  const result = { mediaItemId: row.id, created: !existing, title: detail.title };
  showCache.set(tmdbId, { ...result, created: false });
  return result;
}

async function upsertEpisode(
  show: { mediaItemId: string; tmdbId: number },
  season: number,
  episode: number,
  filePath: string,
): Promise<{ episodeId: string; created: boolean }> {
  const key = `${show.tmdbId}:${season}`;
  let meta = seasonMetaCache.get(key);
  if (!meta) {
    meta = await getTmdbSeasonEpisodes(show.tmdbId, season).catch(() => []);
    seasonMetaCache.set(key, meta);
  }
  const episodeMeta = meta.find((entry) => entry.episodeNumber === episode);
  const existing = await prisma.episode.findUnique({
    where: { mediaItemId_season_episode: { mediaItemId: show.mediaItemId, season, episode } },
    select: { id: true, filePath: true },
  });
  const row = await prisma.episode.upsert({
    where: { mediaItemId_season_episode: { mediaItemId: show.mediaItemId, season, episode } },
    create: {
      mediaItemId: show.mediaItemId,
      season,
      episode,
      title: episodeMeta?.name ?? null,
      overview: episodeMeta?.overview ?? null,
      runtime: episodeMeta?.runtime ?? null,
      filePath,
    },
    update: {
      ...(existing?.filePath ? {} : { filePath }),
      title: episodeMeta?.name ?? null,
      overview: episodeMeta?.overview ?? null,
      runtime: episodeMeta?.runtime ?? null,
    },
  });
  return { episodeId: row.id, created: !existing };
}

// ── The job ─────────────────────────────────────────────────────────────────

async function knownFilePaths(): Promise<Set<string>> {
  const [movies, episodes] = await Promise.all([
    prisma.mediaItem.findMany({ where: { filePath: { not: null } }, select: { filePath: true } }),
    prisma.episode.findMany({ where: { filePath: { not: null } }, select: { filePath: true } }),
  ]);
  const known = new Set<string>();
  for (const row of [...movies, ...episodes]) if (row.filePath) known.add(path.resolve(row.filePath));
  return known;
}

async function mapLimit<T>(items: T[], limit: number, fn: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const item = items[next++]!;
      await fn(item);
    }
  }));
}

export async function runLibraryScan(job: Job<LibraryScanJob>): Promise<void> {
  const report: LibraryScanReportDTO = {
    ...emptyReport(),
    status: 'RUNNING',
    startedAt: job.data.requestedAt,
  };
  showCache.clear();
  seasonMetaCache.clear();
  const unmatched: LibraryScanUnmatchedDTO[] = [];
  const errors: LibraryScanErrorDTO[] = [];
  let lastFlush = 0;

  const flush = async (force = false): Promise<void> => {
    if (!force && Date.now() - lastFlush < 1000) return;
    lastFlush = Date.now();
    report.unmatched = unmatched.slice(0, MAX_UNMATCHED);
    report.errors = errors.slice(0, MAX_ERRORS);
    report.progress.filesUnmatched = unmatched.length;
    report.progress.errors = errors.length;
    await saveReport(report);
    await job.updateProgress(report.progress).catch(() => undefined);
  };

  const recordError = (filePath: string, error: unknown): void => {
    errors.push({ filePath, message: error instanceof Error ? error.message : String(error) });
  };

  try {
    report.progress.stage = 'Listing media folders';
    await flush(true);

    const known = await knownFilePaths();
    const candidates: CandidateFile[] = [];
    for (const root of MEDIA_ROOTS) {
      try {
        candidates.push(...await collectCandidates(root));
      } catch (err) {
        recordError(root, err);
      }
    }
    report.progress.filesSeen = candidates.length;

    const fresh = candidates.filter((candidate) => !known.has(path.resolve(candidate.filePath)));
    report.progress.filesSkipped = candidates.length - fresh.length;
    report.progress.stage = `Matching ${fresh.length} new file${fresh.length === 1 ? '' : 's'}`;
    await flush(true);

    // Group episodes by show folder so each show is looked up once.
    const episodesByShow = new Map<string, EpisodeCandidateFile[]>();
    const movies: MovieCandidateFile[] = [];
    for (const candidate of fresh) {
      if (candidate.kind === 'movie') movies.push(candidate);
      else {
        const list = episodesByShow.get(`${candidate.root}::${candidate.showLabel}`) ?? [];
        list.push(candidate);
        episodesByShow.set(`${candidate.root}::${candidate.showLabel}`, list);
      }
    }

    const analysisTargets: { filePath: string; target: { mediaItemId: string } | { episodeId: string } }[] = [];

    await mapLimit(movies, MATCH_CONCURRENCY, async (movie) => {
      try {
        const match = await matchTitle('MOVIE', movie.label);
        if (!match.tmdbId) {
          unmatched.push({ filePath: movie.filePath, kind: 'MOVIE', guessTitle: match.guessTitle, guessYear: match.guessYear, season: null, episode: null, sizeBytes: movie.sizeBytes, candidates: match.candidates });
          await flush();
          return;
        }
        const result = await upsertMovie(match.tmdbId, movie.filePath);
        if (result.created) report.created.movies += 1;
        report.progress.filesMatched += 1;
        analysisTargets.push({ filePath: movie.filePath, target: { mediaItemId: result.mediaItemId } });
      } catch (err) {
        recordError(movie.filePath, err);
      }
      await flush();
    });

    const showGroups = [...episodesByShow.entries()];
    const importedSeasons = new Set<string>();
    await mapLimit(showGroups, MATCH_CONCURRENCY, async ([, files]) => {
      const first = files[0]!;
      let show: { mediaItemId: string; tmdbId: number } | null = null;
      let match: MatchOutcome | null = null;
      try {
        match = await matchTitle('SHOW', first.showLabel);
        if (match.tmdbId) {
          const upserted = await upsertShow(match.tmdbId);
          if (upserted.created) report.created.shows += 1;
          show = { mediaItemId: upserted.mediaItemId, tmdbId: match.tmdbId };
        }
      } catch (err) {
        recordError(first.filePath, err);
        return;
      }
      for (const file of files) {
        try {
          if (!show || file.season === null || file.episode === null) {
            unmatched.push({
              filePath: file.filePath,
              kind: 'SHOW',
              guessTitle: match?.guessTitle ?? first.showLabel,
              guessYear: match?.guessYear ?? null,
              season: file.season,
              episode: file.episode,
              sizeBytes: file.sizeBytes,
              candidates: match?.candidates ?? [],
            });
            continue;
          }
          const result = await upsertEpisode(show, file.season, file.episode, file.filePath);
          if (result.created) report.created.episodes += 1;
          report.progress.filesMatched += 1;
          importedSeasons.add(`${show.mediaItemId}:${file.season}`);
          analysisTargets.push({ filePath: file.filePath, target: { episodeId: result.episodeId } });
        } catch (err) {
          recordError(file.filePath, err);
        }
        await flush();
      }
    });

    report.progress.stage = `Analysing ${analysisTargets.length} file${analysisTargets.length === 1 ? '' : 's'}`;
    await flush(true);
    let analysed = 0;
    await mapLimit(analysisTargets, 2, async (entry) => {
      try {
        await analyzeAndStoreMedia(entry.filePath, entry.target);
      } catch (err) {
        recordError(entry.filePath, err);
      }
      analysed += 1;
      report.progress.stage = `Analysing ${analysed}/${analysisTargets.length}`;
      await flush();
    });

    for (const key of importedSeasons) {
      const [mediaItemId, season] = key.split(':');
      enqueueIntroDetection(mediaItemId!, Number(season)).catch(() => undefined);
    }

    report.status = 'COMPLETED';
    report.progress.stage = 'Completed';
  } catch (err) {
    report.status = 'FAILED';
    report.progress.stage = err instanceof Error ? err.message : String(err);
    recordError('(scan)', err);
  } finally {
    report.finishedAt = new Date().toISOString();
    await flush(true);
  }
}

// ── Manual resolution ───────────────────────────────────────────────────────

/** Attach an unmatched file to a TMDb title (and season/episode for shows). */
export async function resolveLibraryScanFile(input: ResolveLibraryScanFileRequest): Promise<{ mediaItemId: string; episodeId: string | null }> {
  const filePath = path.resolve(input.filePath);
  if (!containingMediaRoot(filePath)) {
    throw ApiError.badRequest('File must live inside a configured media root', 'PATH_OUTSIDE_MEDIA_ROOT');
  }
  try {
    const stat = await fs.stat(filePath);
    if (!stat.isFile()) throw new Error('not a file');
  } catch {
    throw ApiError.notFound('File not found on disk', 'FILE_NOT_FOUND');
  }

  let outcome: { mediaItemId: string; episodeId: string | null };
  if (input.mediaType === 'MOVIE') {
    const result = await upsertMovie(input.tmdbId, filePath);
    outcome = { mediaItemId: result.mediaItemId, episodeId: null };
    analyzeAndStoreMedia(filePath, { mediaItemId: result.mediaItemId }).catch(() => undefined);
  } else {
    if (input.season == null || input.episode == null) {
      throw ApiError.badRequest('Season and episode are required for a show file', 'EPISODE_REQUIRED');
    }
    const show = await upsertShow(input.tmdbId);
    const result = await upsertEpisode({ mediaItemId: show.mediaItemId, tmdbId: input.tmdbId }, input.season, input.episode, filePath);
    outcome = { mediaItemId: show.mediaItemId, episodeId: result.episodeId };
    analyzeAndStoreMedia(filePath, { episodeId: result.episodeId }).catch(() => undefined);
    enqueueIntroDetection(show.mediaItemId, input.season).catch(() => undefined);
  }

  // Drop the file from the persisted unmatched list so the admin page updates.
  const report = await getLibraryScanReport();
  const remaining = report.unmatched.filter((entry) => path.resolve(entry.filePath) !== filePath);
  if (remaining.length !== report.unmatched.length) {
    report.unmatched = remaining;
    report.progress.filesUnmatched = remaining.length;
    report.progress.filesMatched += 1;
    await saveReport(report);
  }
  return outcome;
}
