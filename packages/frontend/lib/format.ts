/**
 * Small presentation helpers for the torrent dashboard: human-readable byte
 * sizes, transfer speeds, and durations. Pure functions, no side effects.
 */

/** Bytes → "1.4 GB" / "820 MB" / "512 KB" / "0 B". */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
  const i = Math.min(
    units.length - 1,
    Math.floor(Math.log(bytes) / Math.log(1024)),
  );
  const value = bytes / 1024 ** i;
  const decimals = value >= 100 || i === 0 ? 0 : 1;
  return `${value.toFixed(decimals)} ${units[i]}`;
}

/** Bytes/sec → "3.2 MB/s". */
export function formatSpeed(bytesPerSec: number): string {
  if (!Number.isFinite(bytesPerSec) || bytesPerSec <= 0) return '0 B/s';
  return `${formatBytes(bytesPerSec)}/s`;
}

/** Seconds → "2h 3m" / "5m 12s" / "45s". Rounds to a coarse, readable form. */
export function formatDuration(totalSeconds: number): string {
  if (!Number.isFinite(totalSeconds) || totalSeconds <= 0) return '0s';
  const s = Math.floor(totalSeconds);
  const days = Math.floor(s / 86400);
  const hours = Math.floor((s % 86400) / 3600);
  const mins = Math.floor((s % 3600) / 60);
  const secs = s % 60;

  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${mins}m`;
  if (mins > 0) return `${mins}m ${secs}s`;
  return `${secs}s`;
}

/**
 * ETA from remaining bytes / download speed. Returns "—" when the speed is
 * zero (unknown) or the download is already complete.
 */
export function formatEta(remainingBytes: number, bytesPerSec: number): string {
  if (remainingBytes <= 0) return 'Done';
  if (!Number.isFinite(bytesPerSec) || bytesPerSec <= 0) return '—';
  return formatDuration(remainingBytes / bytesPerSec);
}

/** Elapsed time since an ISO timestamp, e.g. seeding-since → "3h 12m". */
export function formatSince(iso: string | null): string {
  if (!iso) return '—';
  const start = new Date(iso).getTime();
  if (Number.isNaN(start)) return '—';
  return formatDuration((Date.now() - start) / 1000);
}

/** Ratio to two decimals; guards against NaN/Infinity. */
export function formatRatio(ratio: number): string {
  if (!Number.isFinite(ratio) || ratio < 0) return '0.00';
  return ratio.toFixed(2);
}

/** 0..1 progress → integer percent string, clamped. */
export function formatPercent(progress: number): string {
  const pct = Math.max(0, Math.min(1, progress)) * 100;
  const decimals = pct > 0 && pct < 100 && pct < 10 ? 1 : 0;
  return `${pct.toFixed(decimals)}%`;
}
