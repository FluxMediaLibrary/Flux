'use client';

import { useCallback, useMemo, useRef, useState, type PointerEvent } from 'react';
import { useMediaState } from '@vidstack/react';
import { ThumbnailPreview } from './ThumbnailPreview';

interface TimelineProps {
  mediaItemId: string;
  episodeId?: string;
  durationSeconds?: number | null;
  onSeek: (time: number, trigger?: Event, commit?: boolean) => void;
}

export interface ChapterMarker {
  time: number;
  title: string;
}

export function Timeline({ mediaItemId, episodeId, durationSeconds, onSeek }: TimelineProps) {
  const currentTime = useMediaState('currentTime');
  const duration = useMediaState('duration');
  const bufferedEnd = useMediaState('bufferedEnd');
  const seekableStart = useMediaState('seekableStart');
  const seekableEnd = useMediaState('seekableEnd');
  const canSeek = useMediaState('canSeek');
  const rootRef = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState(false);
  const [preview, setPreview] = useState({ visible: false, time: 0, left: 0 });

  const range = useMemo(() => {
    const start = Number.isFinite(seekableStart) && seekableStart > 0 ? seekableStart : 0;
    const sourceDuration = typeof durationSeconds === 'number' && Number.isFinite(durationSeconds) && durationSeconds > 0
      ? durationSeconds
      : 0;
    const finiteDuration = typeof duration === 'number' && Number.isFinite(duration) && duration > 0 ? duration : 0;
    const finiteSeekEnd = typeof seekableEnd === 'number' && Number.isFinite(seekableEnd) && seekableEnd > start
      ? seekableEnd
      : 0;
    const end = sourceDuration || finiteDuration || finiteSeekEnd;
    return { start, end, length: Math.max(0, end - start) };
  }, [duration, durationSeconds, seekableEnd, seekableStart]);

  const getPosition = useCallback(
    (clientX: number) => {
      const root = rootRef.current;
      if (!root || range.length <= 0) return null;

      const rect = root.getBoundingClientRect();
      const left = Math.max(0, Math.min(clientX - rect.left, rect.width));
      const ratio = rect.width > 0 ? left / rect.width : 0;
      const previewHalfWidth = 88;
      const previewLeft = rect.width > previewHalfWidth * 2
        ? Math.max(previewHalfWidth, Math.min(left, rect.width - previewHalfWidth))
        : rect.width / 2;
      return {
        left: previewLeft,
        ratio,
        time: range.start + ratio * range.length,
      };
    },
    [range.length, range.start],
  );

  const updatePreview = useCallback(
    (clientX: number, visible = true) => {
      const position = getPosition(clientX);
      if (!position) return;
      setPreview({ visible, time: position.time, left: position.left });
    },
    [getPosition],
  );

  const seekFromPointer = useCallback(
    (event: PointerEvent<HTMLDivElement>, commit: boolean) => {
      if (!canSeek && range.length <= 0) return;
      const position = getPosition(event.clientX);
      if (!position) return;
      setPreview({ visible: true, time: position.time, left: position.left });
      onSeek(position.time, event.nativeEvent, commit);
    },
    [canSeek, getPosition, onSeek, range.length],
  );

  const playedPercent = range.length > 0
    ? Math.max(0, Math.min(100, ((currentTime - range.start) / range.length) * 100))
    : 0;
  const bufferedPercent = range.length > 0 && typeof bufferedEnd === 'number' && Number.isFinite(bufferedEnd)
    ? Math.max(playedPercent, Math.min(100, ((bufferedEnd - range.start) / range.length) * 100))
    : 0;
  const disabled = range.length <= 0;

  return (
    <div
      ref={rootRef}
      className={disabled ? 'fx-timeline is-disabled' : 'fx-timeline'}
      onPointerMove={(event) => {
        updatePreview(event.clientX, true);
        if (dragging) seekFromPointer(event, false);
      }}
      onPointerDown={(event) => {
        if (disabled) return;
        event.currentTarget.setPointerCapture(event.pointerId);
        setDragging(true);
        seekFromPointer(event, false);
      }}
      onPointerUp={(event) => {
        if (dragging) seekFromPointer(event, true);
        setDragging(false);
        if (event.currentTarget.hasPointerCapture(event.pointerId)) {
          event.currentTarget.releasePointerCapture(event.pointerId);
        }
      }}
      onPointerCancel={(event) => {
        setDragging(false);
        if (event.currentTarget.hasPointerCapture(event.pointerId)) {
          event.currentTarget.releasePointerCapture(event.pointerId);
        }
      }}
      onPointerLeave={() => {
        if (!dragging) setPreview((state) => ({ ...state, visible: false }));
      }}
      onBlur={() => setPreview((state) => ({ ...state, visible: false }))}
      role="presentation"
      aria-disabled={disabled}
    >
      <ThumbnailPreview
        mediaItemId={mediaItemId}
        episodeId={episodeId}
        time={preview.time}
        left={preview.left}
        visible={preview.visible && !disabled}
      />
      <div className="fx-seek" aria-hidden="true">
        <div className="fx-seek-track">
          <div className="fx-seek-buffered" style={{ width: `${bufferedPercent}%` }} />
          <div className="fx-seek-played" style={{ width: `${playedPercent}%` }} />
          <div className="fx-seek-thumb" style={{ left: `${playedPercent}%` }} />
        </div>
      </div>
    </div>
  );
}
