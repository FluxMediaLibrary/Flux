'use client';

/**
 * FluxPlayer — Vidstack-powered media player.
 *
 * Wraps Vidstack's <MediaPlayer> with Flux's API integration for source
 * selection (direct-play vs HLS), seek-to-position, progress reporting,
 * and near-end preloading. Vidstack handles all codec negotiation, HLS
 * playback (hls.js auto-loaded), and default UI controls.
 *
 * This is a shell — no custom UI controls have been added yet. The
 * MediaPlayer renders with Vidstack's built-in controls for now.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  MediaPlayer,
  MediaProvider,
  useMediaState,
  type MediaPlayerInstance,
} from '@vidstack/react';
import { api } from '@/lib/api';
import { ControlBar } from './player/ControlBar';
import { Timeline } from './player/Timeline';
import { TitleOverlay } from './player/TitleOverlay';
import { Spinner } from './player/Spinner';
import { ErrorOverlay } from './player/ErrorOverlay';
import { DebugOverlay } from './player/DebugOverlay';

interface FluxPlayerProps {
  mediaItemId: string;
  episodeId?: string;
  title: string;
  subtitle?: string;
  /** Resume position in seconds. */
  startPositionSeconds?: number;
  /** Fill the parent (used for the full-window watch page). */
  fill?: boolean;
  onProgress?: (positionSeconds: number, durationSeconds: number) => void;
  onBack?: () => void;
  /** Fired when playback reaches ~85% — the watch page can preload next ep. */
  onNearEnd?: () => void;
}

export function FluxPlayer({
  mediaItemId,
  episodeId,
  title,
  subtitle,
  startPositionSeconds = 0,
  fill = false,
  onProgress,
  onBack,
  onNearEnd,
}: FluxPlayerProps) {
  const playerRef = useRef<MediaPlayerInstance>(null);
  const [src, setSrc] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [debugOpen, setDebugOpen] = useState(false);
  const playbackInfoRef = useRef<{
    directPlay: boolean;
    videoCodec: string | null;
    audioCodec: string | null;
    durationSeconds: number | null;
  } | null>(null);
  const startedAt = useRef(startPositionSeconds);
  const nearEndFiredRef = useRef(false);

  // Vidstack hooks — used for custom UI overlays
  const isPaused = useMediaState('paused');
  const isFullscreen = useMediaState('fullscreen');

  // ── Source selection (direct-play vs HLS) ───────────────────────────────
  useEffect(() => {
    let cancelled = false;
    setReady(false);
    setError(null);
    nearEndFiredRef.current = false;
    startedAt.current = startPositionSeconds;

    api.getPlaybackInfo(mediaItemId, episodeId).then(
      (info) => {
        if (cancelled) return;
        playbackInfoRef.current = {
          directPlay: info.directPlay,
          videoCodec: info.videoCodec,
          audioCodec: info.audioCodec,
          durationSeconds: info.durationSeconds,
        };
        const url = info.directPlay
          ? api.getStreamUrl(mediaItemId, episodeId)
          : api.getHlsUrl(mediaItemId, episodeId);
        setSrc(url);
        setReady(true);
      },
      () => {
        // Probe failed — fall back to direct play; Vidstack will surface
        // any decode errors through its own error handling.
        if (!cancelled) {
          setSrc(api.getStreamUrl(mediaItemId, episodeId));
          setReady(true);
        }
      },
    );
    return () => {
      cancelled = true;
    };
  }, [mediaItemId, episodeId, startPositionSeconds]);

  // ── Seek to resume position once media is playable ─────────────────────
  const handleCanPlay = useCallback(() => {
    const player = playerRef.current;
    if (startedAt.current > 0 && player) {
      player.currentTime = startedAt.current;
      startedAt.current = 0;
    }
  }, []);

  // ── Debug overlay toggle (Ctrl+Shift+D) ───────────────────────────────
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.shiftKey && e.key === 'D') {
        e.preventDefault();
        setDebugOpen((v) => !v);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // ── Near-end detection (fires once at ~85%) ────────────────────────────
  const handleTimeUpdate = useCallback(() => {
    const player = playerRef.current;
    if (!player || !onNearEnd) return;
    const { currentTime, duration } = player;
    if (duration > 0 && currentTime / duration >= 0.85 && !nearEndFiredRef.current) {
      nearEndFiredRef.current = true;
      onNearEnd();
    }
  }, [onNearEnd]);

  // ── Periodic progress reporting (every 5 s, plus on pause/visibility) ──
  useEffect(() => {
    if (!onProgress) return;

    const report = () => {
      const player = playerRef.current;
      if (player && player.duration > 0 && player.currentTime > 0) {
        onProgress(player.currentTime, player.duration);
      }
    };

    const onVisibility = () => {
      if (document.visibilityState === 'hidden') report();
    };

    const interval = setInterval(report, 5000);
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [onProgress]);

  // ── Loading / error states ─────────────────────────────────────────────
  if (error) {
    return (
      <div className="centered-viewport">
        <ErrorOverlay
          message={error}
          onRetry={() => {
            setError(null);
            // Re-trigger source selection
            setReady(false);
            setTimeout(() => {
              setSrc(api.getStreamUrl(mediaItemId, episodeId));
              setReady(true);
            }, 0);
          }}
        />
      </div>
    );
  }

  if (!ready) {
    return (
      <div className="centered-viewport">
        <Spinner />
      </div>
    );
  }

  // ── Player ─────────────────────────────────────────────────────────────
  return (
    <MediaPlayer
      ref={playerRef}
      src={src}
      aspectRatio={fill ? undefined : '16/9'}
      load="visible"
      playsInline
      crossOrigin
      controls={false}
      hideControlsOnMouseLeave
      controlsDelay={2800}
      googleCast={{}}
      onCanPlay={handleCanPlay}
      onTimeUpdate={handleTimeUpdate}
      style={fill ? { width: '100%', height: '100%' } : undefined}
    >
      <MediaProvider />

      {/* Top overlay: back button + title */}
      <TitleOverlay title={title} subtitle={subtitle} onBack={onBack} />

      {/* Buffering spinner — Vidstack handles this via data-buffering attribute */}
      <div className="fx-spinner-wrap" style={{ display: 'none' }}>
        <Spinner />
      </div>

      {/* Timeline / seek bar */}
      <Timeline />

      {/* Bottom control bar */}
      <ControlBar />

      {/* Debug overlay */}
      <DebugOverlay
        open={debugOpen}
        mediaItemId={mediaItemId}
        episodeId={episodeId}
        playbackMethod={playbackInfoRef.current?.directPlay ? 'direct' : 'hls'}
        videoCodec={playbackInfoRef.current?.videoCodec}
        audioCodec={playbackInfoRef.current?.audioCodec}
        durationSeconds={playbackInfoRef.current?.durationSeconds}
      />
    </MediaPlayer>
  );
}
