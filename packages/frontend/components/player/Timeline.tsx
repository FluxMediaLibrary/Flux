'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent } from 'react';
import { useMediaState } from '@vidstack/react';
import { ThumbnailPreview } from './ThumbnailPreview';

interface TimelineProps {
  mediaItemId: string;
  episodeId?: string;
  durationSeconds?: number | null;
  positionOffset?: number;
  onSeek: (time: number, trigger?: Event, commit?: boolean) => void;
}

export interface ChapterMarker {
  time: number;
  title: string;
}

export function Timeline({
  mediaItemId,
  episodeId,
  durationSeconds,
  positionOffset = 0,
  onSeek,
}: TimelineProps) {
  const currentTime = useMediaState('currentTime');
  const duration = useMediaState('duration');
  const bufferedEnd = useMediaState('bufferedEnd');
  const seekableStart = useMediaState('seekableStart');
  const seekableEnd = useMediaState('seekableEnd');
  const rootRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef(false);
  const [dragging, setDragging] = useState(false);
  const [pendingSeekTime, setPendingSeekTime] = useState<number | null>(null);
  const [preview, setPreview] = useState({ visible: false, time: 0, left: 0 });

  const range = useMemo(() => {
    const sourceDuration = typeof durationSeconds === 'number' && Number.isFinite(durationSeconds) && durationSeconds > 0
      ? durationSeconds
      : 0;
    const finiteDuration = typeof duration === 'number' && Number.isFinite(duration) && duration > 0 ? duration : 0;
    const localSeekStart = Number.isFinite(seekableStart) && seekableStart > 0 ? seekableStart : 0;
    const absoluteSeekStart = positionOffset + localSeekStart;
    const finiteSeekEnd = typeof seekableEnd === 'number' && Number.isFinite(seekableEnd) && seekableEnd > localSeekStart
      ? positionOffset + seekableEnd
      : 0;
    const start = sourceDuration > 0 ? 0 : absoluteSeekStart;
    const end = sourceDuration || (finiteDuration ? positionOffset + finiteDuration : 0) || finiteSeekEnd;
    return { start, end, length: Math.max(0, end - start) };
  }, [duration, durationSeconds, positionOffset, seekableEnd, seekableStart]);

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

  const updateFromPointer = useCallback(
    (event: PointerEvent<HTMLDivElement>) => {
      const position = getPosition(event.clientX);
      if (!position) return null;
      setPreview({ visible: true, time: position.time, left: position.left });
      return position;
    },
    [getPosition],
  );

  const absoluteCurrentTime = positionOffset + currentTime;

  useEffect(() => {
    if (pendingSeekTime === null) return;
    if (Math.abs(absoluteCurrentTime - pendingSeekTime) <= 0.75) {
      setPendingSeekTime(null);
    }
  }, [absoluteCurrentTime, pendingSeekTime]);

  const displayTime = dragging ? preview.time : pendingSeekTime ?? absoluteCurrentTime;
  const playedPercent = range.length > 0
    ? Math.max(0, Math.min(100, ((displayTime - range.start) / range.length) * 100))
    : 0;
  const bufferedStartPercent = range.length > 0
    ? Math.max(0, Math.min(100, ((positionOffset - range.start) / range.length) * 100))
    : 0;
  const bufferedEndPercent = range.length > 0 && typeof bufferedEnd === 'number' && Number.isFinite(bufferedEnd)
    ? Math.max(bufferedStartPercent, Math.min(100, ((positionOffset + bufferedEnd - range.start) / range.length) * 100))
    : 0;
  const disabled = range.length <= 0;

  return (
    <div
      ref={rootRef}
      className={disabled ? 'fx-timeline is-disabled' : 'fx-timeline'}
      onPointerMove={(event) => {
        if (draggingRef.current) {
          event.preventDefault();
          event.stopPropagation();
          updateFromPointer(event);
          return;
        }
        updatePreview(event.clientX, true);
      }}
      onPointerDown={(event) => {
        if (disabled || event.button !== 0) return;
        event.preventDefault();
        event.stopPropagation();
        event.currentTarget.setPointerCapture(event.pointerId);
        draggingRef.current = true;
        setDragging(true);
        setPendingSeekTime(null);
        updateFromPointer(event);
      }}
      onPointerUp={(event) => {
        if (!draggingRef.current) return;
        event.preventDefault();
        event.stopPropagation();
        const position = updateFromPointer(event);
        draggingRef.current = false;
        setDragging(false);
        if (position) {
          setPendingSeekTime(position.time);
          onSeek(position.time, event.nativeEvent, true);
        }
        if (event.currentTarget.hasPointerCapture(event.pointerId)) {
          event.currentTarget.releasePointerCapture(event.pointerId);
        }
      }}
      onPointerCancel={(event) => {
        draggingRef.current = false;
        setDragging(false);
        if (event.currentTarget.hasPointerCapture(event.pointerId)) {
          event.currentTarget.releasePointerCapture(event.pointerId);
        }
      }}
      onPointerLeave={() => {
        if (!draggingRef.current) setPreview((state) => ({ ...state, visible: false }));
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
          <div
            className="fx-seek-buffered"
            style={{
              left: `${bufferedStartPercent}%`,
              width: `${Math.max(0, bufferedEndPercent - bufferedStartPercent)}%`,
            }}
          />
          <div className="fx-seek-played" style={{ width: `${playedPercent}%` }} />
          <div className="fx-seek-thumb" style={{ left: `${playedPercent}%` }} />
        </div>
      </div>
    </div>
  );
}
