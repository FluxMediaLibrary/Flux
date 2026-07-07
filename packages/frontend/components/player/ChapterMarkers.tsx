'use client';

interface Chapter {
  time: number;
  title: string;
}

interface ChapterMarkersProps {
  chapters: Chapter[];
  duration: number;
  onSeek: (time: number) => void;
}

/**
 * Visual chapter markers on the timeline.
 * Each marker is a thin vertical bar positioned at the chapter's time.
 * Hover for title tooltip, click to seek.
 */
export function ChapterMarkers({
  chapters,
  duration,
  onSeek,
}: ChapterMarkersProps) {
  if (!duration || chapters.length === 0) return null;

  return (
    <>
      {chapters.map((ch, i) => (
        <div
          key={i}
          className="fx-chapter-marker"
          style={{ left: `${(ch.time / duration) * 100}%` }}
          title={ch.title}
          onClick={(e) => {
            e.stopPropagation();
            onSeek(ch.time);
          }}
        />
      ))}
    </>
  );
}
