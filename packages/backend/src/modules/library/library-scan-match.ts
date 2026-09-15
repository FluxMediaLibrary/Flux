/**
 * Pure helpers for the library import scan (no I/O, no queue/DB imports) so
 * the matching rules can be unit-tested in isolation.
 */

export function seasonFromFolder(name: string): number | null {
  const match = name.match(/^(?:season|s)[ ._-]*(\d{1,3})$/i) ?? name.match(/^specials$/i);
  if (!match) return null;
  return match[1] ? Number(match[1]) : 0;
}

export function normalizeTitle(value: string): string {
  return value
    .toLowerCase()
    .replace(/\(\d{4}\)/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/**
 * Pick a TMDb result only when it is unambiguous: normalised title equality
 * plus (when we have one) a matching year, or a single result overall. Anything
 * weaker is left for a human — a wrong automatic match is worse than none.
 * Pure so it can be unit-tested without TMDb.
 */
export function pickConfidentMatch(
  results: readonly { tmdbId: number; title: string; year: number | null }[],
  guessTitle: string,
  guessYear: number | null,
): number | null {
  if (results.length === 0) return null;
  const wanted = normalizeTitle(guessTitle);
  const exact = results.filter((result) => normalizeTitle(result.title) === wanted);
  if (guessYear) {
    const byYear = exact.filter((result) => result.year === guessYear);
    // Same title *and* same year is as specific as a folder name gets. TMDb
    // returns results ranked by popularity, so when a short or a remake
    // shares both (e.g. two "Arrival (2016)" entries) the first one is the
    // release people actually keep.
    if (byYear.length >= 1) return byYear[0]!.tmdbId;
    // Releases are sometimes dated a year off between folder and TMDb.
    const nearYear = exact.filter((result) => result.year !== null && Math.abs(result.year - guessYear) <= 1);
    if (byYear.length === 0 && nearYear.length === 1) return nearYear[0]!.tmdbId;
    return null;
  }
  if (exact.length === 1) return exact[0]!.tmdbId;
  if (exact.length === 0 && results.length === 1) return results[0]!.tmdbId;
  return null;
}

