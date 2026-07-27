export type PlaybackMethod = 'direct' | 'hls';

/**
 * Some mobile HLS implementations expose the MPEG-TS timestamp as the media
 * element's seekable start, while desktop hls.js commonly normalizes it to 0.
 * Treat that value as a transport-only origin so the Flux timeline always
 * remains relative to the source media.
 */
export function getMediaTimeOrigin(
  playbackMethod: PlaybackMethod,
  seekableStart: number | null | undefined,
): number {
  return playbackMethod === 'hls' &&
    typeof seekableStart === 'number' &&
    Number.isFinite(seekableStart) &&
    seekableStart > 0
    ? seekableStart
    : 0;
}

export function toAbsolutePlaybackTime(
  localTime: number,
  timelineOffset: number,
  mediaTimeOrigin: number,
): number {
  const safeLocalTime = Number.isFinite(localTime) ? localTime : mediaTimeOrigin;
  const safeTimelineOffset = Number.isFinite(timelineOffset) ? timelineOffset : 0;
  const safeMediaTimeOrigin = Number.isFinite(mediaTimeOrigin) ? mediaTimeOrigin : 0;
  return Math.max(0, safeTimelineOffset + safeLocalTime - safeMediaTimeOrigin);
}

export function toLocalPlaybackTime(
  absoluteTime: number,
  timelineOffset: number,
  mediaTimeOrigin: number,
): number {
  const safeAbsoluteTime = Number.isFinite(absoluteTime) ? absoluteTime : 0;
  const safeTimelineOffset = Number.isFinite(timelineOffset) ? timelineOffset : 0;
  const safeMediaTimeOrigin = Number.isFinite(mediaTimeOrigin) ? mediaTimeOrigin : 0;
  return safeMediaTimeOrigin + safeAbsoluteTime - safeTimelineOffset;
}

export function isUnexpectedPlaybackJump(
  expectedTime: number,
  actualTime: number,
  toleranceSeconds = 4,
): boolean {
  return Number.isFinite(expectedTime) &&
    Number.isFinite(actualTime) &&
    Math.abs(actualTime - expectedTime) > toleranceSeconds;
}
