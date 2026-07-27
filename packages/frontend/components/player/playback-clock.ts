export type PlaybackMethod = 'direct' | 'hls';

/**
 * HLS media timelines can begin at a non-zero timestamp inherited from the
 * source container. Direct-play timelines are already normalized by the
 * browser and must not be shifted.
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
