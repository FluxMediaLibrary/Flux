'use client';

import { useCallback, useRef, useState } from 'react';
import { TimeSlider, useMediaState } from '@vidstack/react';
import { ChapterMarkers } from './ChapterMarkers';
import { ThumbnailPreview } from './ThumbnailPreview';

export interface ChapterMarker {
  time: number;
  title: string;
}

interface TimelineProps {
  mediaItemId: string;
  episodeId?: string;
  chapters?: ChapterMarker[];
}

export function Timeline({ mediaItemId, episodeId, chapters = [] }: TimelineProps) {
  const duration = useMediaState('duration');
  const rootRef = useRef<HTMLDivElement>(null);
  const [preview, setPreview] = useState({ visible: false, time: 0, left: 0 });

  const updatePreview = useCallback(
    (clientX: number, forceVisible = true) => {
      const root = rootRef.current;
      if (!root || !duration || duration <= 0) return;

      const rect = root.getBoundingClientRect();
      const left = Math.max(0, Math.min(clientX - rect.left, rect.width));
      const ratio = rect.width > 0 ? left / rect.width : 0;
      setPreview({ visible: forceVisible, time: ratio * duration, left });
    },
    [duration],
  );

  return (
    <div
      ref={rootRef}
      className="fx-timeline"
      onPointerMove={(event) => updatePreview(event.clientX)}
      onPointerDown={(event) => updatePreview(event.clientX)}
      onPointerLeave={() => setPreview((state) => ({ ...state, visible: false }))}
      onFocus={() => setPreview((state) => ({ ...state, visible: false }))}
    >
      <ThumbnailPreview
        mediaItemId={mediaItemId}
        episodeId={episodeId}
        time={preview.time}
        left={preview.left}
        visible={preview.visible}
      />
      <TimeSlider.Root
        className="fx-seek"
        keyStep={5}
        shiftKeyMultiplier={2}
        pauseWhileDragging={false}
        seekingRequestThrottle={50}
        aria-label="Seek"
      >
        <TimeSlider.Preview className="fx-seek-preview">
          <TimeSlider.Value className="fx-seek-preview-time" type="pointer" format="time" />
        </TimeSlider.Preview>
        <TimeSlider.Track className="fx-seek-track">
          <TimeSlider.Progress className="fx-seek-buffered" />
          <TimeSlider.TrackFill className="fx-seek-played" />
          <ChapterMarkers chapters={chapters} duration={duration} />
        </TimeSlider.Track>
        <TimeSlider.Thumb className="fx-seek-thumb" />
      </TimeSlider.Root>
    </div>
  );
}
