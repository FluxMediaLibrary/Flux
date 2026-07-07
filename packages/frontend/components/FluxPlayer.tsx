'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react';
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
import { SkipButton, type PlaybackMarker } from './player/SkipButton';
import { Spinner } from './player/Spinner';
import { Timeline, type ChapterMarker } from './player/Timeline';
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

function deriveMarkers(info: PlaybackInfoDTO | null): PlaybackMarker[] {
  const duration = info?.durationSeconds ?? 0;
  if (!Number.isFinite(duration) || duration <= 0) return [];

  const markers: PlaybackMarker[] = [];
  if (duration > 900) {
    markers.push({ startTime: 0, endTime: Math.min(90, duration * 0.08), type: 'intro' });
  }
  if (duration > 1800) {
    markers.push({
      startTime: Math.max(duration - 90, duration * 0.92),
      endTime: Math.max(duration - 10, duration * 0.98),
      type: 'credits',
    });
  }
  return markers;
}

function deriveChapters(markers: PlaybackMarker[]): ChapterMarker[] {
  return markers.map((marker) => ({
    time: marker.startTime,
    title:
      marker.type === 'intro'
        ? 'Intro'
        : marker.type === 'recap'
          ? 'Recap'
          : 'Credits',
  }));
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

  const markers = useMemo(() => deriveMarkers(source.info), [source.info]);
  const chapters = useMemo(() => deriveChapters(markers), [markers]);

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
      playsInline
      crossOrigin
      controls={false}
      hideControlsOnMouseLeave
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
        markers={markers}
        chapters={chapters}
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
  markers,
  chapters,
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
  markers: PlaybackMarker[];
  chapters: ChapterMarker[];
  debugOpen: boolean;
  methodLabel: string;
  videoCodec: string | null;
  audioCodec: string | null;
  durationSeconds: number | null;
}) {
  const currentTime = useMediaState('currentTime');
  const duration = useMediaState('duration');
  const paused = useMediaState('paused');
  const remote = useMediaRemote();
  const resumeTargetRef = useRef(startPositionSeconds ?? 0);
  const nearEndFiredRef = useRef(false);

  const reportProgress = useCallback(() => {
    const player = playerRef.current;
    if (!player) return;

    const position = player.currentTime;
    const totalDuration = Number.isFinite(player.duration) ? player.duration : 0;
    if (!Number.isFinite(position) || position <= 0) return;

    api.saveProgress({
      mediaItemId: episodeId ? undefined : mediaItemId,
      episodeId,
      positionSeconds: position,
      durationSeconds: totalDuration > 0 ? totalDuration : undefined,
    }).catch(() => {});
    onProgress?.(position, totalDuration);
  }, [episodeId, mediaItemId, onProgress, playerRef]);

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
    if (duration > 0 && currentTime / duration >= 0.85) {
      nearEndFiredRef.current = true;
      onNearEnd();
    }
  }, [currentTime, duration, onNearEnd]);

  useEffect(() => {
    const target = resumeTargetRef.current;
    if (target > 0 && Number.isFinite(target) && duration > 0) {
      remote.seek(Math.min(target, duration - 1));
      resumeTargetRef.current = 0;
    }
  }, [duration, remote]);

  return (
    <>
      <div className="fx-video-scrim" aria-hidden="true" />
      <TitleOverlay title={title} subtitle={subtitle} onBack={onBack} />
      <div className="fx-spinner-wrap">
        <Spinner />
      </div>
      <Timeline mediaItemId={mediaItemId} episodeId={episodeId} chapters={chapters} />
      <SkipButton currentTime={currentTime} markers={markers} onSkip={(time) => remote.seek(time)} />
      <ControlBar />
      <DebugOverlay
        open={debugOpen}
        playbackMethod={methodLabel}
        videoCodec={videoCodec}
        audioCodec={audioCodec}
        durationSeconds={durationSeconds}
      />
    </>
  );
}
