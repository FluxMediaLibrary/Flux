'use client';

import { useEffect, useState } from 'react';
import { useMediaState } from '@vidstack/react';

interface DebugOverlayProps {
  open: boolean;
  playbackMethod: string;
  videoCodec?: string | null;
  audioCodec?: string | null;
  durationSeconds?: number | null;
  positionOffset?: number;
}

function formatTime(value: number | null | undefined): string {
  if (!value || !Number.isFinite(value) || value < 0) return '-';
  const hours = Math.floor(value / 3600);
  const minutes = Math.floor((value % 3600) / 60);
  const seconds = Math.floor(value % 60);
  if (hours > 0) return `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

function getBufferedEnd(buffered: unknown): number | null {
  if (!buffered || typeof buffered !== 'object' || !('length' in buffered) || !('end' in buffered)) return null;
  const range = buffered as { length: number; end: (index: number) => number };
  if (range.length <= 0) return null;
  try {
    return range.end(range.length - 1);
  } catch {
    return null;
  }
}

export function DebugOverlay({
  open,
  playbackMethod,
  videoCodec,
  audioCodec,
  durationSeconds,
  positionOffset = 0,
}: DebugOverlayProps) {
  const currentTime = useMediaState('currentTime');
  const duration = useMediaState('duration');
  const playbackRate = useMediaState('playbackRate');
  const streamType = useMediaState('streamType');
  const qualities = useMediaState('qualities');
  const audioTrack = useMediaState('audioTrack');
  const buffered = useMediaState('buffered');
  const [frames, setFrames] = useState({ dropped: 0, fps: 0 });

  useEffect(() => {
    if (!open) return;

    let lastTime = performance.now();
    let lastFrames = 0;
    const interval = window.setInterval(() => {
      const video = document.querySelector('media-player.fx-player video') as HTMLVideoElement | null;
      const quality = video?.getVideoPlaybackQuality?.();
      if (!quality) return;

      const now = performance.now();
      const elapsed = (now - lastTime) / 1000;
      const totalFrames = quality.totalVideoFrames ?? 0;
      const fps = elapsed > 0 && totalFrames >= lastFrames ? Math.round((totalFrames - lastFrames) / elapsed) : 0;
      setFrames({ dropped: quality.droppedVideoFrames ?? 0, fps });
      lastTime = now;
      lastFrames = totalFrames;
    }, 1000);

    return () => window.clearInterval(interval);
  }, [open]);

  if (!open) return null;

  const qualityList = qualities ? Array.from({ length: qualities.length }, (_, index) => qualities[index]) : [];
  const selectedQuality = qualityList.find((quality) => quality?.selected);
  const bufferEnd = getBufferedEnd(buffered);

  const audioLabel =
    audioTrack?.label || audioTrack?.language || audioCodec || '-';
  const qualityLabel = selectedQuality
    ? `${selectedQuality.height ?? '-'}p / ${selectedQuality.bitrate ? `${Math.round(selectedQuality.bitrate / 1000)} kbps` : 'auto'}`
    : 'Auto';

  return (
    <div className="fx-debug" aria-label="Playback debug stats">
      <div className="fx-debug-row"><span>Method</span><span>{playbackMethod}{streamType ? ` / ${streamType}` : ''}</span></div>
      <div className="fx-debug-row"><span>Video</span><span>{videoCodec ?? '-'}</span></div>
      <div className="fx-debug-row"><span>Quality</span><span>{qualityLabel}</span></div>
      <div className="fx-debug-row"><span>Audio</span><span>{audioLabel}</span></div>
      <div className="fx-debug-row"><span>Buffer</span><span>{bufferEnd != null ? `${Math.max(0, bufferEnd - currentTime).toFixed(1)}s` : '-'}</span></div>
      <div className="fx-debug-row"><span>Dropped</span><span>{frames.dropped}</span></div>
      <div className="fx-debug-row"><span>FPS</span><span>{frames.fps || '-'}</span></div>
      <div className="fx-debug-row"><span>Speed</span><span>{playbackRate}x</span></div>
      <div className="fx-debug-row"><span>Time</span><span>{formatTime(positionOffset + currentTime)} / {formatTime(durationSeconds || (positionOffset + duration))}</span></div>
    </div>
  );
}
