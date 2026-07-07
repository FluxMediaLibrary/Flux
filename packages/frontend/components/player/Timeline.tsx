'use client';

import { useCallback, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { useMediaState } from '@vidstack/react';
import { ThumbnailPreview } from './ThumbnailPreview';

interface TimelineProps {
  mediaItemId: string;
  episodeId?: string;
  onSeek: (time: number, trigger?: Event) => void;
}

export interface ChapterMarker {
  time: number;
  title: string;
}

function formatTime(value: number): string {
  if (!Number.isFinite(value) || value < 0) return '0:00';
  const hours = Math.floor(value / 3600);
  const minutes = Math.floor((value % 3600) / 60);
  const seconds = Math.floor(value % 60);
  if (hours > 0) return `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

export function Timeline({ mediaItemId, episodeId, onSeek }: TimelineProps) {
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
    const finiteDuration = Number.isFinite(duration) && duration > 0 ? duration : 0;
    const finiteSeekEnd = Number.isFinite(seekableEnd) && seekableEnd > start ? seekableEnd : 0;
    const end = finiteDuration || finiteSeekEnd;
    return { start, end, length: Math.max(0, end - start) };
  }, [duration, seekableEnd, seekableStart]);

  const getPosition = useCallback(
    (clientX: number) => {
      const root = rootRef.current;
      if (!root || range.length <= 0) return null;

      const rect = root.getBoundingClientRect();
      const left = Math.max(0, Math.min(clientX - rect.left, rect.width));
      const ratio = rect.width > 0 ? left / rect.width : 0;
      return {
        left,
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
    (event: PointerEvent<HTMLDivElement>) => {
      if (!canSeek) return;
      const position = getPosition(event.clientX);
      if (!position) return;
      setPreview({ visible: true, time: position.time, left: position.left });
      onSeek(position.time, event.nativeEvent);
    },
    [canSeek, getPosition, onSeek],
  );

  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      if (!canSeek || range.length <= 0) return;

      let target: number | null = null;
      if (event.key === 'ArrowLeft') target = Math.max(range.start, currentTime - 10);
      if (event.key === 'ArrowRight') target = Math.min(range.end, currentTime + 10);
      if (event.key === 'Home') target = range.start;
      if (event.key === 'End') target = range.end;
      if (target == null) return;

      event.preventDefault();
      onSeek(target, event.nativeEvent);
    },
    [canSeek, currentTime, onSeek, range.end, range.length, range.start],
  );

  const playedPercent = range.length > 0
    ? Math.max(0, Math.min(100, ((currentTime - range.start) / range.length) * 100))
    : 0;
  const bufferedPercent = range.length > 0
    ? Math.max(playedPercent, Math.min(100, ((bufferedEnd - range.start) / range.length) * 100))
    : 0;
  const disabled = !canSeek || range.length <= 0;

  return (
    <div
      ref={rootRef}
      className={disabled ? 'fx-timeline is-disabled' : 'fx-timeline'}
      onPointerMove={(event) => {
        updatePreview(event.clientX, true);
        if (dragging) seekFromPointer(event);
      }}
      onPointerDown={(event) => {
        if (disabled) return;
        event.currentTarget.setPointerCapture(event.pointerId);
        setDragging(true);
        seekFromPointer(event);
      }}
      onPointerUp={(event) => {
        if (dragging) seekFromPointer(event);
        setDragging(false);
      }}
      onPointerCancel={() => setDragging(false)}
      onPointerLeave={() => {
        if (!dragging) setPreview((state) => ({ ...state, visible: false }));
      }}
      onBlur={() => setPreview((state) => ({ ...state, visible: false }))}
      onKeyDown={handleKeyDown}
      role="slider"
      tabIndex={disabled ? -1 : 0}
      aria-label="Seek"
      aria-valuemin={Math.round(range.start)}
      aria-valuemax={Math.round(range.end)}
      aria-valuenow={Math.round(currentTime)}
      aria-valuetext={`${formatTime(currentTime)} of ${formatTime(range.end)}`}
      aria-disabled={disabled}
    >
      <ThumbnailPreview
        mediaItemId={mediaItemId}
        episodeId={episodeId}
        time={preview.time}
        left={preview.left}
        visible={preview.visible}
      />
      <div className="fx-seek" aria-hidden="true">
        <div className="fx-seek-track">
          <div className="fx-seek-buffered" style={{ width: `${bufferedPercent}%` }} />
          <div className="fx-seek-played" style={{ width: `${playedPercent}%` }} />
          <div className="fx-seek-thumb" style={{ left: `${playedPercent}%` }} />
        </div>
      </div>
      {preview.visible && !disabled && (
        <div className="fx-seek-preview" style={{ left: `${preview.left}px`, opacity: 1 }}>
          <span className="fx-seek-preview-time">{formatTime(preview.time)}</span>
        </div>
      )}
    </div>
  );
}
