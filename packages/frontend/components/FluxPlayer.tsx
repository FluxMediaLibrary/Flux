'use client';

import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import {
  MediaPlayer,
  MediaProvider,
  useMediaRemote,
  useMediaState,
  type MediaPlayerInstance,
} from '@vidstack/react';
import { api } from '@/lib/api';
import type { MediaStreamDTO, PlaybackInfoDTO } from '@flux/shared';
import { ControlBar } from './player/ControlBar';
import { DebugOverlay } from './player/DebugOverlay';
import { ErrorOverlay } from './player/ErrorOverlay';
import { Spinner } from './player/Spinner';
import { Timeline } from './player/Timeline';
import { TitleOverlay } from './player/TitleOverlay';

interface FluxPlayerProps {
  mediaItemId: string;
  episodeId?: string;
  title: string;
  subtitle?: string;
  startPositionSeconds?: number;
  fill?: boolean;
  onProgress?: (positionSeconds: number, durationSeconds: number) => void;
  onBack?: () => void;
  onNearEnd?: () => void;
}

interface PlayerSource {
  src: string;
  method: 'direct' | 'hls';
  info: PlaybackInfoDTO | null;
}

function getStreamLabel(streams: MediaStreamDTO[], type: MediaStreamDTO['type']) {
  const stream = streams.find((item) => item.type === type);
  if (!stream) return null;
  const parts = [stream.codec, stream.width && stream.height ? `${stream.width}x${stream.height}` : null]
    .filter(Boolean);
  return parts.join(' / ') || null;
}

export function FluxPlayer(props: FluxPlayerProps) {
  const {
    mediaItemId,
    episodeId,
    title,
    subtitle,
    startPositionSeconds = 0,
    fill = false,
  } = props;

  const [source, setSource] = useState<PlayerSource | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const loadSource = useCallback(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    setSource(null);

    api.getPlaybackInfo(mediaItemId, episodeId, controller.signal).then(
      (info) => {
        const direct = info.directPlay;
        setSource({
          src: direct ? api.getStreamUrl(mediaItemId, episodeId) : api.getHlsUrl(mediaItemId, episodeId),
          method: direct ? 'direct' : 'hls',
          info,
        });
        setLoading(false);
      },
      () => {
        if (controller.signal.aborted) return;
        setSource({
          src: api.getStreamUrl(mediaItemId, episodeId),
          method: 'direct',
          info: null,
        });
        setLoading(false);
      },
    );

    return () => controller.abort();
  }, [episodeId, mediaItemId]);

  useEffect(() => loadSource(), [loadSource]);

  const handleRetry = useCallback(() => {
    loadSource();
  }, [loadSource]);

  if (loading) {
    return (
      <div className={fill ? 'fx-player-shell fx-player-shell--fill' : 'fx-player-shell'}>
        <Spinner />
      </div>
    );
  }

  if (error || !source) {
    return (
      <div className={fill ? 'fx-player-shell fx-player-shell--fill' : 'fx-player-shell'}>
        <ErrorOverlay message={error ?? 'Unable to load this video.'} onRetry={handleRetry} />
      </div>
    );
  }

  return (
    <FluxMediaPlayer
      {...props}
      key={`${mediaItemId}:${episodeId ?? 'movie'}:${source.src}`}
      source={source}
      startPositionSeconds={startPositionSeconds}
      fill={fill}
      onFatalError={() => setError('Playback failed. Try again or choose another title.')}
    />
  );
}

function FluxMediaPlayer({
  mediaItemId,
  episodeId,
  title,
  subtitle,
  startPositionSeconds = 0,
  fill = false,
  onProgress,
  onBack,
  onNearEnd,
  source,
  onFatalError,
}: FluxPlayerProps & {
  source: PlayerSource;
  onFatalError: () => void;
}) {
  const playerRef = useRef<MediaPlayerInstance>(null);
  const [debugOpen, setDebugOpen] = useState(false);
  // Safety net: if playback doesn't start within 30 s of setting the source,
  // show an error so the user isn't stuck on an infinite spinner.
  const [loadTimedOut, setLoadTimedOut] = useState(false);

  useEffect(() => {
    // Reset on source change (including retry).
    setLoadTimedOut(false);
    if (!source) return;
    const id = window.setTimeout(() => setLoadTimedOut(true), 30_000);
    return () => window.clearTimeout(id);
  }, [source]);

  // Surface the timeout as a fatal error so the parent FluxPlayer shows the
  // ErrorOverlay with a retry button instead of an infinite spinner.
  useEffect(() => {
    if (loadTimedOut) onFatalError();
  }, [loadTimedOut, onFatalError]);

  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      if (event.ctrlKey && event.shiftKey && event.key.toLowerCase() === 'd') {
        event.preventDefault();
        setDebugOpen((open) => !open);
      }
    };

    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, []);

  const methodLabel = source.method === 'direct' ? 'Direct Play' : 'HLS';
  const videoLabel = getStreamLabel(source.info?.streams ?? [], 'video');
  const audioLabel = getStreamLabel(source.info?.streams ?? [], 'audio');

  return (
    <MediaPlayer
      ref={playerRef}
      src={source.src}
      title={title}
      className={fill ? 'fx-player fx-player--fill' : 'fx-player'}
      aspectRatio={fill ? undefined : '16/9'}
      load="visible"
      autoPlay
      playsInline
      crossOrigin
      controls={false}
      keyDisabled
      streamType="on-demand"
      controlsDelay={2600}
      googleCast={{}}
      onError={onFatalError}
    >
      <MediaProvider />
      <FluxPlayerChrome
        mediaItemId={mediaItemId}
        episodeId={episodeId}
        title={title}
        subtitle={subtitle}
        startPositionSeconds={startPositionSeconds}
        onBack={onBack}
        onProgress={onProgress}
        onNearEnd={onNearEnd}
        playerRef={playerRef}
        debugOpen={debugOpen}
        methodLabel={methodLabel}
        videoCodec={videoLabel ?? source.info?.videoCodec ?? null}
        audioCodec={audioLabel ?? source.info?.audioCodec ?? null}
        durationSeconds={source.info?.durationSeconds ?? null}
      />
    </MediaPlayer>
  );
}

function FluxPlayerChrome({
  mediaItemId,
  episodeId,
  title,
  subtitle,
  startPositionSeconds,
  onBack,
  onProgress,
  onNearEnd,
  playerRef,
  debugOpen,
  methodLabel,
  videoCodec,
  audioCodec,
  durationSeconds,
}: Pick<
  FluxPlayerProps,
  | 'mediaItemId'
  | 'episodeId'
  | 'title'
  | 'subtitle'
  | 'startPositionSeconds'
  | 'onBack'
  | 'onProgress'
  | 'onNearEnd'
> & {
  playerRef: RefObject<MediaPlayerInstance | null>;
  debugOpen: boolean;
  methodLabel: string;
  videoCodec: string | null;
  audioCodec: string | null;
  durationSeconds: number | null;
}) {
  const currentTime = useMediaState('currentTime');
  const duration = useMediaState('duration');
  const paused = useMediaState('paused');
  const canPlay = useMediaState('canPlay');
  const started = useMediaState('started');
  const waiting = useMediaState('waiting');
  const playing = useMediaState('playing');
  const remote = useMediaRemote();
  const resumeTargetRef = useRef(startPositionSeconds ?? 0);
  const nearEndFiredRef = useRef(false);
  const autoplayAttemptedRef = useRef(false);
  const chromeRef = useRef<HTMLDivElement>(null);
  const [idle, setIdle] = useState(false);
  const pausedRef = useRef(paused);
  pausedRef.current = paused;
  const stableDuration = typeof durationSeconds === 'number' && Number.isFinite(durationSeconds) && durationSeconds > 0
    ? durationSeconds
    : typeof duration === 'number' && Number.isFinite(duration) && duration > 0
      ? duration
      : 0;

  const seekTo = useCallback(
    (time: number, trigger?: Event, commit = true) => {
      if (!Number.isFinite(time)) return;

      const hardMax = stableDuration > 0 ? stableDuration : Number.POSITIVE_INFINITY;
      const target = Math.max(0, Math.min(time, hardMax));
      const player = playerRef.current;

      if (commit) {
        if (player) {
          player.currentTime = target;
        }
        remote.seek(target, trigger);
      } else {
        if (player) {
          player.currentTime = target;
        }
        remote.seeking(target, trigger);
      }
    },
    [playerRef, remote, stableDuration],
  );

  const togglePlayback = useCallback(
    (trigger?: Event) => {
      if (paused) remote.play(trigger);
      else remote.pause(trigger);
    },
    [paused, remote],
  );

  const reportProgress = useCallback(() => {
    const player = playerRef.current;
    if (!player) return;

    const position = player.currentTime;
    const totalDuration = stableDuration > 0
      ? stableDuration
      : Number.isFinite(player.duration) ? player.duration : 0;
    if (!Number.isFinite(position) || position <= 0) return;
    if (totalDuration > 0 && position > totalDuration + 5) return;

    api.saveProgress({
      mediaItemId: episodeId ? undefined : mediaItemId,
      episodeId,
      positionSeconds: position,
      durationSeconds: totalDuration > 0 ? totalDuration : undefined,
    }).catch(() => {});
    onProgress?.(position, totalDuration);
  }, [episodeId, mediaItemId, onProgress, playerRef, stableDuration]);

  useEffect(() => {
    const interval = window.setInterval(reportProgress, 5000);
    const handleVisibility = () => {
      if (document.visibilityState === 'hidden') reportProgress();
    };

    document.addEventListener('visibilitychange', handleVisibility);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener('visibilitychange', handleVisibility);
      reportProgress();
    };
  }, [reportProgress]);

  useEffect(() => {
    if (paused) reportProgress();
  }, [paused, reportProgress]);

  useEffect(() => {
    if (!onNearEnd || nearEndFiredRef.current) return;
    if (stableDuration > 0 && currentTime / stableDuration >= 0.85) {
      nearEndFiredRef.current = true;
      onNearEnd();
    }
  }, [currentTime, onNearEnd, stableDuration]);

  useEffect(() => {
    const target = resumeTargetRef.current;
    if (target > 0 && Number.isFinite(target) && stableDuration > 0) {
      seekTo(Math.min(target, stableDuration - 1));
      resumeTargetRef.current = 0;
    }
  }, [seekTo, stableDuration]);

  useEffect(() => {
    if (!canPlay || !paused || autoplayAttemptedRef.current) return;
    autoplayAttemptedRef.current = true;
    playerRef.current?.play().catch(() => {});
  }, [canPlay, paused, playerRef]);

  /* Mouse idle tracking — hide controls after inactivity during playback */
  useEffect(() => {
    const root = chromeRef.current;
    if (!root) return;

    const IDLE_DELAY = 2600;
    let idleTimer: ReturnType<typeof setTimeout> | null = null;

    const startTimer = () => {
      if (idleTimer) clearTimeout(idleTimer);
      idleTimer = setTimeout(() => {
        if (!pausedRef.current) setIdle(true);
      }, IDLE_DELAY);
    };

    const wake = () => {
      setIdle(false);
      startTimer();
    };

    const handleLeave = () => {
      if (idleTimer) clearTimeout(idleTimer);
      if (!pausedRef.current) setIdle(true);
    };

    root.addEventListener('pointermove', wake);
    root.addEventListener('pointerenter', wake);
    root.addEventListener('pointerleave', handleLeave);

    startTimer();

    return () => {
      root.removeEventListener('pointermove', wake);
      root.removeEventListener('pointerenter', wake);
      root.removeEventListener('pointerleave', handleLeave);
      if (idleTimer) clearTimeout(idleTimer);
    };
  }, []);

  useEffect(() => {
    const isEditableTarget = (target: EventTarget | null) => {
      if (!(target instanceof HTMLElement)) return false;
      return (
        target.isContentEditable ||
        ['INPUT', 'TEXTAREA', 'SELECT', 'BUTTON'].includes(target.tagName)
      );
    };

    const handleKey = (event: KeyboardEvent) => {
      const root = chromeRef.current;
      if (!root || isEditableTarget(event.target)) return;

      const target = event.target instanceof Node ? event.target : null;
      if (target && !root.contains(target) && document.activeElement && !root.contains(document.activeElement)) {
        return;
      }

      if (event.code === 'Space' || event.key === ' ') {
        event.preventDefault();
        setIdle(false);
        togglePlayback(event);
      } else if (event.key === 'ArrowLeft') {
        event.preventDefault();
        setIdle(false);
        seekTo(currentTime - 10, event);
      } else if (event.key === 'ArrowRight') {
        event.preventDefault();
        setIdle(false);
        seekTo(currentTime + 10, event);
      }
    };

    window.addEventListener('keydown', handleKey, { capture: true });
    return () => window.removeEventListener('keydown', handleKey, { capture: true });
  }, [currentTime, seekTo, togglePlayback]);

  return (
    <div ref={chromeRef} className={idle ? 'fx-chrome is-idle' : 'fx-chrome'}>
      <button
        className="fx-click-layer"
        type="button"
        aria-label={paused ? 'Play' : 'Pause'}
        onClick={(event) => {
          event.stopPropagation();
          event.nativeEvent.stopImmediatePropagation();
          togglePlayback();
        }}
      />
      <TitleOverlay title={title} subtitle={subtitle} onBack={onBack} />
      <div className={(!started || (waiting && !playing)) ? 'fx-spinner-wrap is-visible' : 'fx-spinner-wrap'}>
        <Spinner />
      </div>
      <Timeline
        mediaItemId={mediaItemId}
        episodeId={episodeId}
        durationSeconds={stableDuration || null}
        onSeek={seekTo}
      />
      <ControlBar durationSeconds={stableDuration || null} onSeek={seekTo} />
      <DebugOverlay
        open={debugOpen}
        playbackMethod={methodLabel}
        videoCodec={videoCodec}
        audioCodec={audioCodec}
        durationSeconds={durationSeconds}
      />
    </div>
  );
}
