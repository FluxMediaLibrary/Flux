import fs from 'node:fs/promises';
import path from 'node:path';
import { config } from '../../config.js';
import { prisma } from '../../lib/db.js';
import { getDetail, search } from '../tmdb/tmdb.service.js';
import { isVideoFile } from '../../lib/filename.js';
import { parseFile, normalizeImportTitle as normalize, type Candidate } from './library-import-parser.js';

type Kind = 'MOVIE' | 'SHOW';
type Job = { id: string; root: string; kind: Kind; status: 'running' | 'done' | 'failed'; total: number; processed: number; imported: number; skipped: number; errors: string[] };

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
  const results = await search(candidate.title, candidate.kind === 'MOVIE' ? 'movie' : 'show');
  // Never guess on a fuzzy match: matching name and year are required if supplied.
  const possibilities = results.filter((result) => normalize(result.title) === normalize(candidate.title) && (candidate.year === null || result.year === candidate.year));
  if (possibilities.length !== 1) return null;
  return getDetail(candidate.kind, possibilities[0]!.tmdbId);
}

async function run(job: Job) {
  try {
    const files = await collectFiles(job.root);
    const candidates = files.map((file) => parseFile(job.root, file, job.kind));
    job.total = files.length;
    const cache = new Map<string, Awaited<ReturnType<typeof match>>>();
    for (const candidate of candidates) {
      try {
        if (!candidate) {
          job.skipped++;
          if (job.errors.length < 30) job.errors.push(`${files[job.processed]}: Could not recognize title or season/episode numbers`);
          continue;
        }
        const key = `${candidate.kind}:${candidate.title}:${candidate.year}`;
        if (!cache.has(key)) cache.set(key, await match(candidate));
        const detail = cache.get(key);
        if (!detail) {
          job.skipped++;
          if (job.errors.length < 30) job.errors.push(`${candidate.file}: No unique TMDb match for ${candidate.title}${candidate.year ? ` (${candidate.year})` : ''}`);
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
          if (item.filePath && item.filePath !== candidate.file) { job.skipped++; continue; }
          if (!item.filePath) await prisma.mediaItem.update({ where: { id: item.id }, data: { filePath: candidate.file } });
        } else {
          const episode = await prisma.episode.upsert({
            where: { mediaItemId_season_episode: { mediaItemId: item.id, season: candidate.season!, episode: candidate.episode! } },
            create: { mediaItemId: item.id, season: candidate.season!, episode: candidate.episode!, filePath: candidate.file },
            update: {},
          });
          if (episode.filePath && episode.filePath !== candidate.file) { job.skipped++; continue; }
          if (!episode.filePath) await prisma.episode.update({ where: { id: episode.id }, data: { filePath: candidate.file } });
        }
        job.imported++;
      } catch (error) {
        job.skipped++;
        if (job.errors.length < 30) job.errors.push(`${candidate?.file ?? 'unknown'}: ${error instanceof Error ? error.message : 'Import failed'}`);
      } finally { job.processed++; }
    }
    job.status = 'done';
  } catch (error) {
    job.status = 'failed';
    job.errors.push(error instanceof Error ? error.message : 'Import failed');
  } finally { activeJob = null; }
}

export async function startImport(root: string, kind: Kind) {
  const safeRoot = await allowedRoot(root);
  if (activeJob) throw new Error('Another library import is running');
  const id = crypto.randomUUID();
  const job: Job = { id, root: safeRoot, kind, status: 'running', total: 0, processed: 0, imported: 0, skipped: 0, errors: [] };
  jobs.set(id, job);
  if (jobs.size > 20) jobs.delete(jobs.keys().next().value!);
  activeJob = id;
  void run(job);
  return job;
}

export function getImportJob(id: string) { return jobs.get(id) ?? null; }
