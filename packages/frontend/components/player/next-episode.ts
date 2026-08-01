import type { MediaSegmentDTO, PlaybackMarkerDTO } from '@flux/shared';

const COMPLETION_PROMPT_RATIO = 0.92;

export function nextEpisodePromptStart(
  durationSeconds: number,
  markers: PlaybackMarkerDTO[] = [],
  segments: MediaSegmentDTO[] = [],
): number | null {
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) return null;

  const segmentCredits = segments
    .filter((segment) => segment.type === 'CREDITS')
    .filter((segment) => segment.startMs >= 0 && segment.startMs / 1000 < durationSeconds)
    .sort((left, right) => left.startMs - right.startMs)[0];
  if (segmentCredits) return segmentCredits.startMs / 1000;

  const credits = markers
    .filter((marker) => marker.type === 'credits')
    .filter((marker) => marker.startSeconds >= 0 && marker.startSeconds < durationSeconds)
    .sort((left, right) => left.startSeconds - right.startSeconds)[0];

  if (credits) return credits.startSeconds;
  return durationSeconds * COMPLETION_PROMPT_RATIO;
}

export function shouldShowNextEpisodePrompt(params: {
  currentTimeSeconds: number;
  durationSeconds: number;
  markers?: PlaybackMarkerDTO[];
  segments?: MediaSegmentDTO[];
}): boolean {
  const start = nextEpisodePromptStart(params.durationSeconds, params.markers, params.segments);
  if (start === null) return false;
  return params.currentTimeSeconds >= start;
}
