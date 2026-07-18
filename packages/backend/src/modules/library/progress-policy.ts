export function isProgressComplete(positionSeconds: number, durationSeconds?: number | null, threshold = 0.92): boolean {
  return durationSeconds != null && durationSeconds > 0 && positionSeconds / durationSeconds >= threshold;
}
