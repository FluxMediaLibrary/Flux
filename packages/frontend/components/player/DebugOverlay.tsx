'use client';

import { useEffect, useState } from 'react';
import { useMediaStore } from '@vidstack/react';

interface DebugOverlayProps {
  open: boolean;
  mediaItemId: string;
  episodeId?: string;
  /** Playback method from the initial getPlaybackInfo call */
  playbackMethod?: 'direct' | 'hls';
  videoCodec?: string | null;
  audioCodec?: string | null;
  durationSeconds?: number | null;
}

const fmt = (t: number): string => {
  if (!Number.isFinite(t) || t < 0) return '0:00';
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const s = Math.floor(t % 60);
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
};

/**
 * Debug overlay showing live playback statistics.
 * Toggled via Ctrl+Shift+D — the parent player manages the keyboard listener
 * and passes `open` / `onToggle` props.
 *
 * Non-interactive overlay (pointer-events: none) positioned in the top-left.
 */
export function DebugOverlay({
  open,
  mediaItemId,
  episodeId,
  playbackMethod,
  videoCodec,
  audioCodec,
  durationSeconds,
}: DebugOverlayProps) {
  // ── Vidstack state ─────────────────────────────────────────────────────────
  const mediaState = useMediaStore();

  const {
    paused,
    duration,
    currentTime,
    volume,
    qualities,
    audioTrack,
    textTrack,
    streamType,
    playbackRate,
    buffered,
  } = mediaState;

  // ── Dropped frames & FPS polling ──────────────────────────────────────────
  const [droppedFrames, setDroppedFrames] = useState(0);
  const [currentFps, setCurrentFps] = useState(0);

  useEffect(() => {
    if (!open) return;
    let startTime = performance.now();
    let startFrames = 0;

    const interval = setInterval(() => {
      const videoEl = document.querySelector(
        'media-player video',
      ) as HTMLVideoElement | null;
      if (videoEl?.getVideoPlaybackQuality) {
        const q = videoEl.getVideoPlaybackQuality();
        setDroppedFrames(q.droppedVideoFrames ?? 0);

        const now = performance.now();
        const elapsed = (now - startTime) / 1000;
        const totalFrames = q.totalVideoFrames ?? 0;
        if (elapsed > 1 && totalFrames > startFrames) {
          setCurrentFps(Math.round((totalFrames - startFrames) / elapsed));
          startTime = now;
          startFrames = totalFrames;
        }
      }
    }, 2000);

    return () => clearInterval(interval);
  }, [open]);

  if (!open) return null;

  // ── Derived stats ─────────────────────────────────────────────────────────

  // Current quality (width, height, bitrate) from qualities array
  let qualityLabel = '—';
  let bitrateLabel = '—';
  let resWidth = 0;
  let resHeight = 0;

  if (qualities) {
    const arr = Array.from(qualities as Iterable<unknown>) as Array<{
      selected?: boolean;
      width?: number;
      height?: number;
      bitrate?: number;
    }>;
    const selected = arr.find((q) => q.selected);
    if (selected) {
      resWidth = selected.width ?? 0;
      resHeight = selected.height ?? 0;
      qualityLabel = resHeight > 0 ? `${resHeight}p` : '—';
      bitrateLabel = selected.bitrate
        ? `${Math.round(selected.bitrate / 1000)} kbps`
        : '—';
    }
  }

  // Audio track name
  const audioTrackName =
    ((audioTrack as { name?: string; lang?: string } | null)?.name) ??
    ((audioTrack as { lang?: string } | null)?.lang) ??
    '—';

  // Subtitle status
  const subtitleStatus =
    (textTrack as { mode?: string; label?: string } | null)?.mode === 'showing'
      ? ((textTrack as { label?: string } | null)?.label ?? 'On')
      : 'Off';

  // Buffer end time
  let bufferedEnd: number | null = null;
  if (
    buffered &&
    typeof buffered === 'object' &&
    'length' in buffered
  ) {
    const len = (buffered as { length: number; end: (i: number) => number }).length;
    if (len > 0) {
      bufferedEnd = (buffered as { end: (i: number) => number }).end(len - 1);
    }
  }

  const formatTime = (t: number | null | undefined) =>
    t != null && t > 0 ? fmt(t) : '—';

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="fx-debug">
      <div className="fx-debug-row">
        <span>Method</span>
        <span>
          {playbackMethod ?? '—'}
          {streamType === 'on-demand' ? '' : streamType ? ` (${streamType})` : ''}
        </span>
      </div>
      <div className="fx-debug-row">
        <span>Video</span>
        <span>
          {videoCodec ?? '—'}
          {resWidth > 0 && resHeight > 0 ? ` · ${resWidth}×${resHeight}` : ''}
        </span>
      </div>
      <div className="fx-debug-row">
        <span>Audio</span>
        <span>
          {audioCodec ?? '—'} · {audioTrackName}
        </span>
      </div>
      <div className="fx-debug-row">
        <span>Quality</span>
        <span>
          {qualityLabel} · {bitrateLabel}
        </span>
      </div>
      <div className="fx-debug-row">
        <span>Buffer</span>
        <span>{bufferedEnd != null ? `${bufferedEnd.toFixed(1)}s` : '—'}</span>
      </div>
      <div className="fx-debug-row">
        <span>Dropped</span>
        <span>{droppedFrames}</span>
      </div>
      <div className="fx-debug-row">
        <span>FPS</span>
        <span>{currentFps || '—'}</span>
      </div>
      <div className="fx-debug-row">
        <span>Subtitle</span>
        <span>{subtitleStatus}</span>
      </div>
      <div className="fx-debug-row">
        <span>Speed</span>
        <span>{playbackRate ?? 1}×</span>
      </div>
      <div className="fx-debug-row">
        <span>Time</span>
        <span>
          {formatTime(currentTime)} / {formatTime(duration)}
        </span>
      </div>
    </div>
  );
}
