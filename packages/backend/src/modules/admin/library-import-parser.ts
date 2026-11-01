import path from 'node:path';
import { parse } from 'parse-torrent-title';

type Kind = 'MOVIE' | 'SHOW';
export type Candidate = { file: string; title: string; year: number | null; kind: Kind; season?: number; episode?: number };

function titleYear(input: string) {
  const clean = input.replace(/\{[^}]*\}/g, '').replace(/\[[^\]]*\]/g, '').trim();
  const parsed = parse(clean);
  return {
    title: (parsed.title ?? clean).replace(/[._]+/g, ' ').replace(/\s+/g, ' ').trim(),
    year: typeof parsed.year === 'number' ? parsed.year : null,
  };
}

export function parseFile(root: string, file: string, kind: Kind): Candidate | null {
  const basename = path.basename(file, path.extname(file));
  const relative = path.relative(root, file).split(path.sep);
  if (kind === 'MOVIE') {
    const parsed = titleYear(basename);
    return parsed.title ? { file, kind, ...parsed } : null;
  }
  const folders = relative.slice(0, -1);
  const seasonIndex = folders.findIndex((part) => /^(?:season|s)[ ._-]*\d+$/i.test(part) || /^specials$/i.test(part));
  const seasonFolder = seasonIndex >= 0 ? folders[seasonIndex]! : null;
  const pair = basename.match(/(?:^|[^\p{L}\d])s(\d{1,2})[ ._-]*e(\d{1,3})(?!\d)/iu)
    ?? basename.match(/(?:^|[^\d])(\d{1,2})x(\d{1,3})(?!\d)/i)
    ?? basename.match(/season[ ._-]*(\d{1,2}).*?episode[ ._-]*(\d{1,3})(?!\d)/i);
  const season = pair ? Number(pair[1]) : seasonFolder ? Number(seasonFolder.match(/\d+/)?.[0] ?? 0) : null;
  const episodeOnly = basename.match(/^(\d{1,3})(?:\s|[-._]|$)/)
    ?? basename.match(/(?:^|[ ._-])e(?:p(?:isode)?)?[ ._-]*(\d{1,3})(?!\d)/i);
  const episode = pair ? Number(pair[2]) : episodeOnly ? Number(episodeOnly[1]) : null;
  if (season === null || episode === null || episode < 1 || episode > 999) return null;
  const titleSource = seasonIndex > 0 ? folders[seasonIndex - 1]!
    : seasonIndex === 0 ? path.basename(root)
    : folders.at(-1) ?? basename.slice(0, pair?.index ?? 0);
  const parsed = titleYear(titleSource);
  return parsed.title ? { file, kind, season, episode, ...parsed } : null;
}

export function normalizeImportTitle(value: string) {
  return value.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().replace(/&/g, 'and').replace(/[^\p{L}\p{N}]/gu, '');
}
