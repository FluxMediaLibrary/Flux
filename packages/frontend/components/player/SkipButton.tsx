'use client';

import { useMemo } from 'react';

export interface PlaybackMarker {
  startTime: number;
  endTime: number;
  type: 'intro' | 'recap' | 'credits';
}

interface SkipButtonProps {
  currentTime: number;
  markers: PlaybackMarker[];
  onSkip: (time: number) => void;
}

export function SkipButton({ currentTime, markers, onSkip }: SkipButtonProps) {
  const active = useMemo(
    () => markers.find((marker) => currentTime >= marker.startTime && currentTime < marker.endTime) ?? null,
    [currentTime, markers],
  );

  if (!active) return null;

  const label =
    active.type === 'intro' ? 'Skip Intro' : active.type === 'recap' ? 'Skip Recap' : 'Skip Credits';

  return (
    <button className="fx-skip-btn" type="button" onClick={() => onSkip(active.endTime)}>
      {label}
    </button>
  );
}
