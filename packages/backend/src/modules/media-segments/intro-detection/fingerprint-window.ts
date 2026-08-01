/**
 * fpcalc 1.5.x treats reaching EOF exactly at its requested `-length` as a
 * decode error. Keep at least one complete second beyond the requested range,
 * or shorten the request when the source itself ends inside the scan window.
 */
export function getFpcalcLengthSeconds(
  windowSeconds: number,
  extractedDurationSeconds: number,
): number {
  if (!Number.isFinite(windowSeconds) || !Number.isFinite(extractedDurationSeconds)) return 0;
  return Math.max(0, Math.floor(Math.min(windowSeconds, extractedDurationSeconds - 1)));
}
