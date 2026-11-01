import fs from 'node:fs/promises';
import path from 'node:path';
import { config } from '../../config.js';
import { prisma } from '../../lib/db.js';
import { ApiError } from '../../lib/errors.js';
import { getDetail, searchForImport } from '../tmdb/tmdb.service.js';
import { isVideoFile } from '../../lib/filename.js';
import { parseFile, type Candidate } from './library-import-parser.js';

import { selectImportMatch } from './library-import-match.js';
import { importLogPath, writeImportLog } from './library-import-log.js';

type Kind = 'MOVIE' | 'SHOW';
type Job = { id: string; root: string; kind: Kind; status: 'running' | 'done' | 'failed'; total: number; processed: number; imported: number; skipped: number; errors: string[]; logPath: string; logError?: string };

const jobs = new Map<string, Job>();
let activeJob: string | null = null;

/** Only configured, pre-mounted directories may be browsed or imported. */
export function importFolders() {
  // The primary root is Flux-managed writable media; subsequent configured
  // roots are the existing libraries supplied by the NAS administrator.
  return config.MEDIA_ROOTS.slice(1);
}

async function allowedRoot(root: string) {
  const exact = importFolders().find((entry) => path.resolve(entry) === path.resolve(root));
  if (!exact) throw new Error('Folder is not an allowed media root');
  const st = await fs.stat(exact);
  if (!st.isDirectory()) throw new Error('Media folder does not exist');
  return path.resolve(exact);
}

async function collectFiles(root: string): Promise<string[]> {
  const files: string[] = [];
  const queue = [root];
  while (queue.length) {
    const directory = queue.pop()!;
    for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
      const full = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) queue.push(full);
      else if (entry.isFile() && isVideoFile(entry.name)) files.push(full);
      if (files.length + queue.length > 50_000) throw new Error('Folder contains too many entries for one import');
    }
  }
  return files.sort();
}

export async function previewFolder(root: string, kind: Kind) {
  const safeRoot = await allowedRoot(root);
  const files = await collectFiles(safeRoot);
  const candidates = files.map((file) => parseFile(safeRoot, file, kind));
  return { root: safeRoot, files: files.length, recognized: candidates.filter(Boolean).length, sample: candidates.filter((item): item is Candidate => Boolean(item)).slice(0, 12).map((c) => ({ ...c, file: path.relative(safeRoot, c.file) })) };
}

async function match(candidate: Candidate) {
  const results = await searchForImport(candidate.title, candidate.kind, candidate.year);
  let selected = selectImportMatch(candidate.title, candidate.year, results);
  const query = candidate.title.toLowerCase().replace(/\bpart\s+/g, '').replace(/\biii\b/g, '3').replace(/\bii\b/g, '2').replace(/\bvs\.?\b/g, 'v');
  if (!selected && query !== candidate.title.toLowerCase()) {
    results.push(...await searchForImport(query, candidate.kind, candidate.year));
    selected = selectImportMatch(candidate.title, candidate.year, results);
  }
  if (!selected && results.length === 0 && candidate.year !== null) {
    results.push(...await searchForImport(candidate.title, candidate.kind, null));
    selected = selectImportMatch(candidate.title, candidate.year, results);
  }
  if (selected) return { detail: await getDetail(candidate.kind, selected.tmdbId), reason: '' };
  const suggestions = results.slice(0, 5).map((result) => `${result.title} (${result.year ?? 'unknown year'}) [${result.tmdbId}]`).join('; ');
  return { detail: null, reason: suggestions ? `No unambiguous title/year match. TMDb returned: ${suggestions}` : 'TMDb returned no results for this title/year' };
}

async function run(job: Job) {
  const entries: string[] = [];
  let status: 'done' | 'failed' = 'done';
  function skip(file: string, reason: string) {
    job.skipped++;
    if (job.errors.length < 30) job.errors.push(`${file}: ${reason}`);
    entries.push(`SKIPPED ${JSON.stringify({ file, reason })}`);
  }
  try {
    const files = await collectFiles(job.root);
    const candidates = files.map((file) => parseFile(job.root, file, job.kind));
    job.total = files.length;
    const cache = new Map<string, Awaited<ReturnType<typeof match>>>();
    for (const candidate of candidates) {
      try {
        if (!candidate) {
          skip(files[job.processed]!, 'Could not recognize title or season/episode numbers');
          continue;
        }
        const key = `${candidate.kind}:${candidate.title}:${candidate.year}`;
        if (!cache.has(key)) cache.set(key, await match(candidate));
        const matched = cache.get(key)!;
        const detail = matched.detail;
        if (!detail) {
          skip(candidate.file, matched.reason);
          continue;
        }
        const common = {
          title: detail.title, year: detail.year ?? null, overview: detail.overview,
          posterPath: detail.posterPath, backdropPath: detail.backdropPath, genres: detail.genres,
        };
        // Never overwrite an existing file path: imports must not replace a user's media.
        const item = await prisma.mediaItem.upsert({
          where: { tmdbId_type: { tmdbId: detail.tmdbId, type: candidate.kind } },
          create: { tmdbId: detail.tmdbId, type: candidate.kind, ...common, ...(candidate.kind === 'MOVIE' ? { filePath: candidate.file } : {}) },
          update: {},
        });
        if (candidate.kind === 'MOVIE') {
          if (item.filePath && item.filePath !== candidate.file) { skip(candidate.file, `Movie already has a different library path: ${item.filePath}`); continue; }
          if (!item.filePath) await prisma.mediaItem.update({ where: { id: item.id }, data: { filePath: candidate.file } });
        } else {
          const episode = await prisma.episode.upsert({
            where: { mediaItemId_season_episode: { mediaItemId: item.id, season: candidate.season!, episode: candidate.episode! } },
            create: { mediaItemId: item.id, season: candidate.season!, episode: candidate.episode!, filePath: candidate.file },
            update: {},
          });
          if (episode.filePath && episode.filePath !== candidate.file) { skip(candidate.file, `Episode already has a different library path: ${episode.filePath}`); continue; }
          if (!episode.filePath) await prisma.episode.update({ where: { id: episode.id }, data: { filePath: candidate.file } });
        }
        job.imported++;
        entries.push(`IMPORTED ${JSON.stringify({ file: candidate.file, title: detail.title, year: detail.year, tmdbId: detail.tmdbId, season: candidate.season, episode: candidate.episode })}`);
      } catch (error) {
        skip(candidate?.file ?? files[job.processed]!, error instanceof Error ? error.message : 'Import failed');
      } finally { job.processed++; }
    }
  } catch (error) {
    status = 'failed';
    const reason = error instanceof Error ? error.message : 'Import failed';
    job.errors.push(reason);
    entries.push(`FAILED ${JSON.stringify({ reason })}`);
  } finally {
    try {
      await writeImportLog(job.logPath, { ...job, status }, entries);
    } catch (error) {
      job.logError = `Could not save import log: ${error instanceof Error ? error.message : 'Write failed'}`;
      job.errors.push(job.logError);
    }
    job.status = status;
    activeJob = null;
  }
}

export async function startImport(root: string, kind: Kind) {
  const safeRoot = await allowedRoot(root);
  if (activeJob) throw new Error('Another library import is running');
  const id = crypto.randomUUID();
  const job: Job = { id, root: safeRoot, kind, status: 'running', total: 0, processed: 0, imported: 0, skipped: 0, errors: [], logPath: importLogPath(config.MEDIA_ROOTS[0]!, id) };
  jobs.set(id, job);
  if (jobs.size > 20) jobs.delete(jobs.keys().next().value!);
  activeJob = id;
  void run(job);
  return job;
}

export function getImportJob(id: string) { return jobs.get(id) ?? null; }

export async function getImportLog(id: string) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
    throw ApiError.badRequest('Invalid import job ID');
  }
  const job = jobs.get(id);
  if (job?.status === 'running') throw ApiError.conflict('The import log will be ready when the import finishes');
  if (job?.logError) throw ApiError.internal(job.logError);
  try {
    return await fs.readFile(importLogPath(config.MEDIA_ROOTS[0]!, id), 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw ApiError.notFound('No log was saved for this import');
    throw error;
  }
}
