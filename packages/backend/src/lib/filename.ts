/**
 * Filename → metadata guessing for the torrent confirm step (spec §4.1.2).
 * Wraps `parse-torrent-title` to guess a clean title, year, and (for TV)
 * season/episode numbers from a torrent name or an individual file name.
 *
 * These are only GUESSES — the admin reviews and corrects them before download.
 */
import { parse } from 'parse-torrent-title';
import type { MediaType } from '@flux/shared';

const VIDEO_EXTENSIONS = new Set([
  '.mkv',
  '.mp4',
  '.avi',
  '.mov',
  '.wmv',
  '.m4v',
  '.mpg',
  '.mpeg',
  '.ts',
  '.webm',
]);

/** Basename of a torrent-internal path, regardless of separator. */
export function baseName(p: string): string {
  const parts = p.split(/[\\/]/);
  return parts[parts.length - 1] ?? p;
}

export function fileExtension(p: string): string {
  const name = baseName(p);
  const dot = name.lastIndexOf('.');
  return dot >= 0 ? name.slice(dot).toLowerCase() : '';
}

export function isVideoFile(p: string): boolean {
  return VIDEO_EXTENSIONS.has(fileExtension(p));
}

export interface NameGuess {
  title: string;
  year: number | null;
  /** Best-guess category from the presence of season/episode markers. */
  type: MediaType;
  season: number | null;
  episode: number | null;
}

/** Guess title/year/type from the overall torrent name. */
export function guessFromTorrentName(name: string): NameGuess {
  const parsed = parse(name);
  const season = typeof parsed.season === 'number' ? parsed.season : null;
  const episode = typeof parsed.episode === 'number' ? parsed.episode : null;
  const isTv = season !== null || episode !== null;

  return {
    title: (parsed.title ?? name).trim() || name,
    year: typeof parsed.year === 'number' ? parsed.year : null,
    type: isTv ? 'SHOW' : 'MOVIE',
    season,
    episode,
  };
}

export interface FileEpisodeGuess {
  season: number | null;
  episode: number | null;
}

/** Guess season/episode for a single file within a (season-pack) torrent. */
export function guessFileEpisode(filePath: string): FileEpisodeGuess {
  const parsed = parse(baseName(filePath));
  const season = typeof parsed.season === 'number' ? parsed.season : null;
  return {
    season,
    episode: typeof parsed.episode === 'number' ? parsed.episode : null,
  };
}
