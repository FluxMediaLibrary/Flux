import type { PlaybackMarkerDTO } from '@flux/shared';

const COMPLETION_PROMPT_RATIO = 0.92;

export function nextEpisodePromptStart(
  durationSeconds: number,
  markers: PlaybackMarkerDTO[] = [],
): number | null {
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) return null;

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
}): boolean {
  const start = nextEpisodePromptStart(params.durationSeconds, params.markers);
  if (start === null) return false;
  return params.currentTimeSeconds >= start;
}
