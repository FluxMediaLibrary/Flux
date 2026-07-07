'use client';

import { useEffect, useState } from 'react';

interface PlaybackMarker {
  startTime: number;
  endTime: number;
  type: 'intro' | 'recap' | 'credits';
  label: string;
}

interface SkipButtonProps {
  currentTime: number;
  markers: PlaybackMarker[];
  onSkip: (time: number) => void;
}

/**
 * Netflix-style skip button — appears when playback enters a marker range
 * (intro, recap, credits) and lets the user jump past it.
 */
export function SkipButton({ currentTime, markers, onSkip }: SkipButtonProps) {
  const [active, setActive] = useState<PlaybackMarker | null>(null);

  useEffect(() => {
    const match = markers.find(
      (m) => currentTime >= m.startTime && currentTime < m.endTime,
    );
    setActive(match ?? null);
  }, [currentTime, markers]);

  if (!active) return null;

  const label =
    active.type === 'intro'
      ? 'Skip Intro'
      : active.type === 'recap'
        ? 'Skip Recap'
        : 'Skip Credits';

  return (
    <button className="fx-skip-btn" onClick={() => onSkip(active.endTime)}>
      {label}
    </button>
  );
}
