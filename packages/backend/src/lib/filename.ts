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

function regexEpisodeGuess(filePath: string): FileEpisodeGuess {
  const normalized = filePath.replace(/\\/g, '/');
  const name = baseName(normalized);
  const seasonFolder = normalized.match(/(?:^|\/)(?:season|s)[ ._-]*(\d{1,2})(?:\/|$)/i);
  const seasonFromFolder = seasonFolder ? Number(seasonFolder[1]) : null;

  const seasonEpisode = name.match(/(?:^|[^\d])s(\d{1,2})[ ._-]*e(\d{1,3})(?:[^\d]|$)/i);
  if (seasonEpisode) {
    return {
      season: Number(seasonEpisode[1]),
      episode: Number(seasonEpisode[2]),
    };
  }

  const xPattern = name.match(/(?:^|[^\d])(\d{1,2})x(\d{1,3})(?:[^\d]|$)/i);
  if (xPattern) {
    return {
      season: Number(xPattern[1]),
      episode: Number(xPattern[2]),
    };
  }

  const wordPattern = name.match(/season[ ._-]*(\d{1,2}).*episode[ ._-]*(\d{1,3})/i);
  if (wordPattern) {
    return {
      season: Number(wordPattern[1]),
      episode: Number(wordPattern[2]),
    };
  }

  const episodeOnly = name.match(/(?:^|[^\d])e(?:p(?:isode)?)?[ ._-]*(\d{1,3})(?:[^\d]|$)/i);
  if (seasonFromFolder && episodeOnly) {
    return {
      season: seasonFromFolder,
      episode: Number(episodeOnly[1]),
    };
  }

  return { season: seasonFromFolder, episode: null };
}

/** Guess season/episode for a single file within a (season-pack) torrent. */
export function guessFileEpisode(filePath: string): FileEpisodeGuess {
  const parsed = parse(baseName(filePath));
  const season = typeof parsed.season === 'number' ? parsed.season : null;
  const episode = typeof parsed.episode === 'number' ? parsed.episode : null;
  if (season !== null || episode !== null) {
    return { season, episode };
  }

  const fallback = regexEpisodeGuess(filePath);
  return {
    season: fallback.season,
    episode: fallback.episode,
  };
}
