'use client';

import { useMediaRemote } from '@vidstack/react';
import type { ChapterMarker } from './Timeline';

interface ChapterMarkersProps {
  chapters: ChapterMarker[];
  duration: number;
}

export function ChapterMarkers({ chapters, duration }: ChapterMarkersProps) {
  const remote = useMediaRemote();

  if (!Number.isFinite(duration) || duration <= 0 || chapters.length === 0) return null;

  return (
    <>
      {chapters.map((chapter, index) => (
        <button
          key={`${chapter.time}-${index}`}
          className="fx-chapter-marker"
          type="button"
          style={{ left: `${Math.max(0, Math.min(100, (chapter.time / duration) * 100))}%` }}
          title={chapter.title}
          aria-label={`Seek to ${chapter.title}`}
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            remote.seek(chapter.time);
          }}
        />
      ))}
    </>
  );
}
