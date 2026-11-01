import { normalizeImportTitle } from './library-import-parser.js';

export type ImportMatch = { tmdbId: number; title: string; year: number | null; originalTitle?: string };

export function importTitleKey(title: string) {
  return normalizeImportTitle(title.toLowerCase()
    .replace(/\bpart\s+(?=\d|i\b|ii\b|iii\b|iv\b|v\b)/g, '')
    .replace(/\b(iii|ii|iv|v|i)\b/g, (token) => ({ i: '1', ii: '2', iii: '3', iv: '4', v: '5' })[token]!)
    .replace(/\b(vs\.?|versus)\b/g, 'v')
    .replace(/^(the|a|an)\s+/g, ''));
}

function distance(left: string, right: string) {
  let previous = Array.from({ length: right.length + 1 }, (_, i) => i);
  for (let i = 1; i <= left.length; i++) {
    const current = [i];
    for (let j = 1; j <= right.length; j++) current[j] = Math.min(current[j - 1]! + 1, previous[j]! + 1, previous[j - 1]! + (left[i - 1] === right[j - 1] ? 0 : 1));
    previous = current;
  }
  return previous[right.length]!;
}

export function selectImportMatch(title: string, year: number | null, results: ImportMatch[]) {
  const unique = [...new Map(results.map((result) => [result.tmdbId, result])).values()];
  const eligible = unique.filter((result) => year === null || result.year === year);
  const key = importTitleKey(title);
  const keys = (result: ImportMatch) => [result.title, result.originalTitle].filter((name): name is string => Boolean(name)).map(importTitleKey);
  const exact = eligible.filter((result) => keys(result).includes(key));
  if (exact.length) return exact.length === 1 ? exact[0]! : null;
  if (year === null || key.length < 8) return null;
  const close = eligible.filter((result) => keys(result).some((other) => distance(key, other) <= 1));
  return close.length === 1 ? close[0]! : null;
}
