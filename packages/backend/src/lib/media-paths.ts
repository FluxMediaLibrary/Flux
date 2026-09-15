/**
 * Library path construction + path-traversal safety.
 *
 * Builds the on-disk library layout (spec §4.1.6):
 *   movies → {MEDIA_ROOT}/movies/Title (Year)/Title (Year).ext
 *   tv     → {MEDIA_ROOT}/tv/Show Name/Season 01/Show Name - S01E01.ext
 *
 * Every produced path is asserted to resolve INSIDE its configured root, so a
 * malicious title/episode value can never escape MEDIA_ROOTS.
 *
 * Supports multiple media roots (MEDIA_ROOTS env var, comma-separated).
 * Root selection is delegated to the storage service (lib/storage.ts), which
 * applies the reserve/placement policy from ServerSettings; lookups search
 * all roots.
 */

import path from 'node:path';
import fs from 'node:fs/promises';
import { config } from '../config.js';
import { MEDIA_ROOTS, planMediaPlacement, type PlacementOptions } from './storage.js';

export { MEDIA_ROOTS };

/** Primary media root — first configured root. */
export const PRIMARY_MEDIA_ROOT = MEDIA_ROOTS[0]!;

/**
 * Try each media root in order to resolve a file path to an absolute path.
 * Handles both absolute paths (stored in DB) and relative paths.
 * Returns the first match that exists on disk, or null.
 */
export async function resolveFilePath(filePath: string): Promise<string | null> {
  // Absolute path: check existence directly (it's where the file was placed)
  if (path.isAbsolute(filePath)) {
    try {
      await fs.access(filePath);
      return filePath;
    } catch {
      return null;
    }
  }

  // Relative path: try each root
  for (const root of MEDIA_ROOTS) {
    const resolved = safeJoin(root, filePath);
    try {
      await fs.access(resolved);
      return resolved;
    } catch {
      // try next root
    }
  }
  return null;
}

/**
 * Select the media root for new content. Applies the ServerSettings storage
 * policy (reserve, strategy, preferred root) and the size of the incoming
 * content. Throws `StorageFullError` with a per-volume explanation when no
 * root qualifies.
 */
export async function selectMediaRoot(options: PlacementOptions): Promise<string> {
  return (await planMediaPlacement(options)).root;
}

/** Ensure an explicitly supplied root is one of the configured media roots. */
function assertMediaRoot(root: string): string {
  const resolved = path.resolve(root);
  if (!MEDIA_ROOTS.includes(resolved)) {
    throw new Error(`Not a configured media root: ${root}`);
  }
  return resolved;
}

/** Strip characters illegal on common filesystems; collapse whitespace. */
export function sanitizeSegment(input: string): string {
  const cleaned = input
    // eslint-disable-next-line no-control-regex
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '')
    .replace(/\s+/g, ' ')
    .replace(/[. ]+$/g, '') // no trailing dots/spaces (Windows-hostile)
    .trim();
  return cleaned.length > 0 ? cleaned : 'Untitled';
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

/**
 * Resolve `segments` under `root` and guarantee the result stays within root.
 * Throws on traversal attempts.
 */
export function safeJoin(root: string, ...segments: string[]): string {
  const resolvedRoot = path.resolve(root);
  const target = path.resolve(resolvedRoot, ...segments);
  const rel = path.relative(resolvedRoot, target);
  if (rel === '' || rel === '.') return target;
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new Error(`Path escapes root: ${target} (root ${resolvedRoot})`);
  }
  return target;
}

export interface MoviePlacement {
  dir: string;
  file: string;
}

/**
 * Build the library path for a movie under an already-selected media root.
 * Callers pick the root once via `selectMediaRoot` so every path derived for
 * the same import (copy target, analysis, trickplay) agrees.
 */
export function moviePlacement(
  root: string,
  title: string,
  year: number | null,
  ext: string,
): MoviePlacement {
  const moviesRoot = path.posix.join(assertMediaRoot(root), 'movies');
  const label = year ? `${sanitizeSegment(title)} (${year})` : sanitizeSegment(title);
  const dir = safeJoin(moviesRoot, label);
  const file = safeJoin(dir, `${label}${ext}`);
  return { dir, file };
}

export interface EpisodePlacement {
  showDir: string;
  seasonDir: string;
  file: string;
}

/** Build the library path for an episode under an already-selected media root. */
export function episodePlacement(
  root: string,
  showTitle: string,
  season: number,
  episode: number,
  ext: string,
): EpisodePlacement {
  const tvRoot = path.posix.join(assertMediaRoot(root), 'tv');
  const show = sanitizeSegment(showTitle);
  const showDir = safeJoin(tvRoot, show);
  const seasonDir = safeJoin(showDir, `Season ${pad2(season)}`);
  const file = safeJoin(
    seasonDir,
    `${show} - S${pad2(season)}E${pad2(episode)}${ext}`,
  );
  return { showDir, seasonDir, file };
}

/** Absolute directory a torrent's files are downloaded into. */
export function torrentDownloadDir(infoHash: string): string {
  return safeJoin(config.DOWNLOAD_ROOT, infoHash);
}

/** Where we persist the raw .torrent bytes (for confirm + seed-resume on boot). */
export function torrentFilePath(infoHash: string): string {
  return safeJoin(config.DOWNLOAD_ROOT, '.torrents', `${infoHash}.torrent`);
}
