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
import {
  isCastSessionActive,
  isCurrentCastMedia,
  shouldAutoplayLocalMedia,
  useNativeCast,
} from '@/lib/native-cast';

import type { MediaSegmentDTO, MediaStreamDTO, PlaybackInfoDTO, PlaybackMarkerDTO } from '@flux/shared';
import { ControlBar } from './player/ControlBar';
import { DebugOverlay } from './player/DebugOverlay';
import { ErrorOverlay } from './player/ErrorOverlay';
import { Spinner } from './player/Spinner';
import { Timeline } from './player/Timeline';
import { TitleOverlay } from './player/TitleOverlay';
import {
  canKeepDirectPlayback,
  canSwitchQualityInPlace,
  requiresAdaptiveTranscode,
} from './player/quality-selection';
import { shouldShowNextEpisodePrompt } from './player/next-episode';
import {
  getMediaTimeOrigin,
  isUnexpectedPlaybackJump,
  toAbsolutePlaybackTime,
  toLocalPlaybackTime,
} from './player/playback-clock';

interface FluxPlayerProps {
  mediaItemId: string;
  episodeId?: string;
  title: string;
  subtitle?: string;
  startPositionSeconds?: number;
  fill?: boolean;
  onProgress?: (positionSeconds: number, durationSeconds: number, paused: boolean) => void;
  onBack?: () => void;
  onNearEnd?: () => void;
  nextEpisode?: {
    id: string;
    title: string;
    subtitle: string;
  } | null;
  nextEpisodeMarkers?: PlaybackMarkerDTO[];
  /** Reusable segment markers for the current episode (intro/recap/credits). */
  segments?: MediaSegmentDTO[];
  onNextEpisode?: () => void;
}

interface PlayerSource {
  src: string;
  method: 'direct' | 'hls';
  info: PlaybackInfoDTO | null;
  qualityLabel: PlaybackInfoDTO['qualities'][number]['label'];
  audioStreamIndex: number | null;
  timelineOffset: number;
  adaptive: boolean;
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
  const [qualityLabel, setQualityLabel] = useState<PlaybackInfoDTO['qualities'][number]['label']>('Auto');
  const [audioStreamIndex, setAudioStreamIndex] = useState<number | null>(null);
  const [hlsStartTime, setHlsStartTime] = useState(() => Math.max(0, startPositionSeconds));
  const [directStartTime, setDirectStartTime] = useState(() => Math.max(0, startPositionSeconds));
  const [hlsReloadNonce, setHlsReloadNonce] = useState(0);
  const skipNextSourceReloadRef = useRef(false);

  useEffect(() => {
    const start = Math.max(0, startPositionSeconds);
    setHlsStartTime(start);
    setDirectStartTime(start);
  }, [episodeId, mediaItemId, startPositionSeconds]);

  const loadSource = useCallback(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    setSource(null);

    api.getPlaybackInfo(mediaItemId, episodeId, controller.signal).then(
      (info) => {
        if (!info.directPlay && !info.hlsAvailable) {
          setError('Playback is disabled by the server settings.');
          setLoading(false);
          return;
        }
        const preferredAudioLanguage = info.preferences.preferredAudioLanguage?.toLowerCase() ?? null;
        const preferredAudioStream = audioStreamIndex === null && preferredAudioLanguage
          ? info.streams.find((stream) => stream.type === 'audio' && (
              stream.language?.toLowerCase() === preferredAudioLanguage
              || stream.title?.toLowerCase().includes(preferredAudioLanguage)
            ))
          : null;
        const requestedAudioStreamIndex = audioStreamIndex ?? preferredAudioStream?.index ?? null;
        const validAudioStreamIndex = requestedAudioStreamIndex !== null && info.streams.some(
          (stream) => stream.type === 'audio' && stream.index === requestedAudioStreamIndex,
        )
          ? requestedAudioStreamIndex
          : null;
        if (validAudioStreamIndex !== audioStreamIndex) setAudioStreamIndex(validAudioStreamIndex);
        const direct = canKeepDirectPlayback(info, qualityLabel, validAudioStreamIndex);
        const forceAdaptive = requiresAdaptiveTranscode(
          info,
          qualityLabel,
        );
        const adaptive =
          forceAdaptive ||
          info.videoCodec !== 'h264' ||
          (info.audioCodec !== null && info.audioCodec !== 'aac');
        const timelineOffset = direct ? 0 : Math.max(0, hlsStartTime);
        setSource({
          src: direct
            ? api.getStreamUrl(mediaItemId, episodeId)
            : api.getHlsUrl(
                mediaItemId,
                episodeId,
                validAudioStreamIndex,
                timelineOffset,
                hlsReloadNonce,
                forceAdaptive,
              ),
          method: direct ? 'direct' : 'hls',
          info,
          qualityLabel,
          audioStreamIndex: validAudioStreamIndex,
          timelineOffset,
          adaptive,
        });
        setLoading(false);
      },
      () => {
        if (controller.signal.aborted) return;
        setError('Unable to prepare this file for playback. Retry after checking the server connection.');
        setLoading(false);
      },
    );

    return () => controller.abort();
  }, [audioStreamIndex, episodeId, hlsReloadNonce, hlsStartTime, mediaItemId, qualityLabel]);

  useEffect(() => {
    if (skipNextSourceReloadRef.current) {
      skipNextSourceReloadRef.current = false;
      return;
    }
    return loadSource();
  }, [loadSource]);

  const handleRetry = useCallback(() => {
    loadSource();
  }, [loadSource]);

  const handleFatalError = useCallback(() => {
    setError('Playback failed. Try again or choose another title.');
  }, []);

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
      startPositionSeconds={source.method === 'direct' ? directStartTime : startPositionSeconds}
      fill={fill}
      onQualityChange={(quality, positionSeconds) => {
        const position = Number.isFinite(positionSeconds) ? Math.max(0, positionSeconds ?? 0) : 0;
        const nextSourceIsDirect = source.info
          ? canKeepDirectPlayback(source.info, quality, audioStreamIndex)
          : quality === 'Auto' || quality === 'Original';
        const nextRequiresAdaptive = source.info
          ? requiresAdaptiveTranscode(source.info, quality)
          : quality !== 'Auto' && quality !== 'Original';

        // A quality selection that stays on the same transport must not replace
        // the media source. HLS can switch rendition in place, and selecting a
        // source-equivalent quality while direct-playing requires no media
        // operation at all.
        const canSwitchInPlace = canSwitchQualityInPlace(
          source.method,
          source.adaptive,
          nextSourceIsDirect,
          nextRequiresAdaptive,
        );
        if (canSwitchInPlace) {
          if (quality !== qualityLabel) {
            skipNextSourceReloadRef.current = true;
            setQualityLabel(quality);
            setSource((current) => current ? { ...current, qualityLabel: quality } : current);
          }
          return;
        }

        if (nextSourceIsDirect) {
          setDirectStartTime(position);
        } else {
          const start = Math.max(0.001, position);
          setHlsStartTime(Math.round(start * 1000) / 1000);
          setHlsReloadNonce((nonce) => nonce + 1);
        }
        setQualityLabel(quality);
      }}
      onAudioStreamChange={(streamIndex) => {
        setAudioStreamIndex(streamIndex);
        if (streamIndex !== null && qualityLabel === 'Original') setQualityLabel('Auto');
      }}
      onTranscodeSeek={(time) => {
        setHlsStartTime(Math.max(0, Math.round(time * 1000) / 1000));
        setHlsReloadNonce((nonce) => nonce + 1);
      }}
      onFatalError={handleFatalError}
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
  nextEpisode,
  nextEpisodeMarkers,
  segments,
  onNextEpisode,
  source,
  onQualityChange,
  onAudioStreamChange,
  onTranscodeSeek,
  onFatalError,
}: FluxPlayerProps & {
  source: PlayerSource;
  onQualityChange: (quality: PlaybackInfoDTO['qualities'][number]['label'], positionSeconds?: number) => void;
  onAudioStreamChange: (streamIndex: number | null) => void;
  onTranscodeSeek: (time: number) => void;
  onFatalError: () => void;
}) {
  const playerRef = useRef<MediaPlayerInstance>(null);
  const [debugOpen, setDebugOpen] = useState(false);
  const [playbackReady, setPlaybackReady] = useState(false);
  const pausedByUserRef = useRef(false);
  const playbackStartedRef = useRef(false);
  const playRequestedRef = useRef(true);
  const hiddenRef = useRef(false);
  const lastHiddenAtRef = useRef(0);
  const lastPausedAtRef = useRef(0);
  const lastPlaybackStateRef = useRef({ paused: true, started: false });
  const recoverableErrorRef = useRef(false);
  const hlsRecoveryRef = useRef({ time: 0, at: 0 });
  const hlsMediaTimeOriginRef = useRef(0);
  const nativeCast = useNativeCast();

  useEffect(() => {
    setPlaybackReady(false);
    pausedByUserRef.current = false;
    playbackStartedRef.current = false;
    playRequestedRef.current = true;
    lastPausedAtRef.current = 0;
    lastPlaybackStateRef.current = { paused: true, started: false };
    recoverableErrorRef.current = false;
    hlsRecoveryRef.current = { time: 0, at: 0 };
    hlsMediaTimeOriginRef.current = 0;
  }, [source.src]);

  const handlePlayerError = useCallback(() => {
    const player = playerRef.current;
    const now = Date.now();
    const wasStarted = playbackStartedRef.current || lastPlaybackStateRef.current.started;
    const canTrustPausedState = wasStarted || playbackReady;
    const actualPaused = canTrustPausedState && (
      player?.paused === true || lastPlaybackStateRef.current.paused
    );
    const paused =
      actualPaused ||
      pausedByUserRef.current ||
      (wasStarted && !playRequestedRef.current);
    const hidden = hiddenRef.current || document.hidden;
    const recentlyHidden = now - lastHiddenAtRef.current < 10000;
    const idlePipeline = hidden || paused || recentlyHidden || recoverableErrorRef.current;

    if (source.method === 'hls') {
      const localTime = Number.isFinite(player?.currentTime) ? player?.currentTime ?? 0 : 0;
      const absoluteTime = toAbsolutePlaybackTime(
        localTime,
        source.timelineOffset,
        hlsMediaTimeOriginRef.current,
      );

      if (idlePipeline) {
        recoverableErrorRef.current = true;
        return;
      }

      const lastRecovery = hlsRecoveryRef.current;
      const repeatedRecovery =
        now - lastRecovery.at < 12000 && Math.abs(absoluteTime - lastRecovery.time) < 3;
      if (!repeatedRecovery) {
        hlsRecoveryRef.current = { time: absoluteTime, at: now };
        recoverableErrorRef.current = false;
        onTranscodeSeek(absoluteTime);
        return;
      }
      if (now - lastRecovery.at < 45000) {
        recoverableErrorRef.current = true;
        return;
      }
    }

    if (idlePipeline) {
      recoverableErrorRef.current = false;
      return;
    }

    onFatalError();
  }, [onFatalError, onTranscodeSeek, playbackReady, source.method, source.timelineOffset]);

  useEffect(() => {
    const handleVisibility = () => {
      hiddenRef.current = document.hidden;
      if (document.hidden) {
        lastHiddenAtRef.current = Date.now();
      } else if (
        source.method === 'hls' &&
        recoverableErrorRef.current &&
        playRequestedRef.current &&
        !pausedByUserRef.current
      ) {
        const player = playerRef.current;
        const currentTime = Number.isFinite(player?.currentTime) ? player?.currentTime ?? 0 : 0;
        recoverableErrorRef.current = false;
        onTranscodeSeek(toAbsolutePlaybackTime(
          currentTime,
          source.timelineOffset,
          hlsMediaTimeOriginRef.current,
        ));
      }
    };

    handleVisibility();
    document.addEventListener('visibilitychange', handleVisibility);
    return () => document.removeEventListener('visibilitychange', handleVisibility);
  }, [onTranscodeSeek, source.method, source.timelineOffset]);

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
  const autoplayEnabled = source.info?.preferences.autoplayEnabled ?? true;
  const localAutoplayEnabled = shouldAutoplayLocalMedia(
    autoplayEnabled,
    nativeCast.ready,
    nativeCast.state.connected,
  );
  const configuredStartPosition = source.info?.preferences.resumeBehavior === 'RESTART' ? 0 : startPositionSeconds;
  const configuredSegments = source.info?.preferences.skipIntroEnabled === false
    ? segments?.filter((segment) => segment.type !== 'INTRO')
    : segments;
  const reportProgressWithPlaybackIntent = useCallback((
    positionSeconds: number,
    durationSeconds: number,
    _playerPaused: boolean,
  ) => {
    // The media element can briefly report itself paused while it buffers or
    // swaps sources. Presence should only say Paused after an explicit pause
    // request from the viewer.
    onProgress?.(positionSeconds, durationSeconds, pausedByUserRef.current);
  }, [onProgress]);

  return (
    <MediaPlayer
      ref={playerRef}
      src={source.src}
      title={title}
      className={fill ? 'fx-player fx-player--fill' : 'fx-player'}
      aspectRatio={fill ? undefined : '16/9'}
      load="visible"
      autoPlay={localAutoplayEnabled}
      playsInline
      crossOrigin
      controls={false}
      keyDisabled
      streamType="on-demand"
      controlsDelay={2600}
      onCanPlay={() => {
        setPlaybackReady(true);
      }}
      onPlay={() => {
        playbackStartedRef.current = true;
        lastPlaybackStateRef.current = { paused: false, started: true };
        playRequestedRef.current = true;
        pausedByUserRef.current = false;
        lastPausedAtRef.current = 0;
      }}
      onPause={() => {
        lastPlaybackStateRef.current = {
          paused: true,
          started: playbackStartedRef.current || lastPlaybackStateRef.current.started,
        };
      }}
      onError={handlePlayerError}
    >
      <MediaProvider />
      <FluxPlayerChrome
        mediaItemId={mediaItemId}
        episodeId={episodeId}
        title={title}
        subtitle={subtitle}
        startPositionSeconds={configuredStartPosition}
        onBack={onBack}
        onProgress={reportProgressWithPlaybackIntent}
        onNearEnd={onNearEnd}
        nextEpisode={nextEpisode}
        nextEpisodeMarkers={nextEpisodeMarkers}
        segments={configuredSegments}
        onNextEpisode={onNextEpisode}
        autoplayEnabled={localAutoplayEnabled}
        nativeCast={nativeCast}
        playerRef={playerRef}
        debugOpen={debugOpen}
        methodLabel={methodLabel}
        videoCodec={videoLabel ?? source.info?.videoCodec ?? null}
        audioCodec={audioLabel ?? source.info?.audioCodec ?? null}
        durationSeconds={source.info?.durationSeconds ?? null}
        streams={source.info?.streams ?? []}
        qualityOptions={source.info?.qualities ?? []}
        selectedQuality={source.qualityLabel}
        onQualityChange={onQualityChange}
        selectedAudioStreamIndex={source.audioStreamIndex}
        onAudioStreamChange={onAudioStreamChange}
        playbackMethod={source.method}
        timelineOffset={source.timelineOffset}
        mediaTimeOriginRef={hlsMediaTimeOriginRef}
        onTranscodeSeek={onTranscodeSeek}
        onPlaybackIntent={(wantsPlayback) => {
          playRequestedRef.current = wantsPlayback;
          if (wantsPlayback) {
            pausedByUserRef.current = false;
            lastPausedAtRef.current = 0;
            if (recoverableErrorRef.current && source.method === 'hls') {
              const player = playerRef.current;
              const currentTime = Number.isFinite(player?.currentTime) ? player?.currentTime ?? 0 : 0;
              recoverableErrorRef.current = false;
              onTranscodeSeek(toAbsolutePlaybackTime(
                currentTime,
                source.timelineOffset,
                hlsMediaTimeOriginRef.current,
              ));
            }
          } else {
            pausedByUserRef.current = true;
            lastPausedAtRef.current = Date.now();
          }
        }}
        onPlaybackStateChange={(state) => {
          lastPlaybackStateRef.current = state;
          if (!state.started) return;
          playbackStartedRef.current = true;
        }}
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
  nextEpisode,
  nextEpisodeMarkers,
  segments,
  onNextEpisode,
  playerRef,
  debugOpen,
  methodLabel,
  videoCodec,
  audioCodec,
  durationSeconds,
  streams,
  qualityOptions,
  selectedQuality,
  onQualityChange,
  selectedAudioStreamIndex,
  onAudioStreamChange,
  playbackMethod,
  timelineOffset,
  mediaTimeOriginRef,
  onTranscodeSeek,
  onPlaybackIntent,
  onPlaybackStateChange,
  autoplayEnabled,
  nativeCast,
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
  | 'nextEpisode'
  | 'nextEpisodeMarkers'
  | 'segments'
  | 'onNextEpisode'
> & {
  playerRef: RefObject<MediaPlayerInstance | null>;
  debugOpen: boolean;
  methodLabel: string;
  videoCodec: string | null;
  audioCodec: string | null;
  durationSeconds: number | null;
  streams: MediaStreamDTO[];
  qualityOptions: PlaybackInfoDTO['qualities'];
  selectedQuality: PlaybackInfoDTO['qualities'][number]['label'];
  onQualityChange: (quality: PlaybackInfoDTO['qualities'][number]['label'], positionSeconds?: number) => void;
  selectedAudioStreamIndex: number | null;
  onAudioStreamChange: (streamIndex: number | null) => void;
  playbackMethod: PlayerSource['method'];
  timelineOffset: number;
  mediaTimeOriginRef: RefObject<number>;
  onTranscodeSeek: (time: number) => void;
  onPlaybackIntent: (wantsPlayback: boolean) => void;
  onPlaybackStateChange: (state: { paused: boolean; started: boolean }) => void;
  autoplayEnabled: boolean;
  nativeCast: ReturnType<typeof useNativeCast>;
}) {
  const currentTime = useMediaState('currentTime');
  const duration = useMediaState('duration');
  const paused = useMediaState('paused');
  const canPlay = useMediaState('canPlay');
  const started = useMediaState('started');
  const waiting = useMediaState('waiting');
  const playing = useMediaState('playing');
  const qualities = useMediaState('qualities');
  const seekableStart = useMediaState('seekableStart');
  const seekableEnd = useMediaState('seekableEnd');
  const remote = useMediaRemote();
  const nativeCastStateRef = useRef(nativeCast.state);
  nativeCastStateRef.current = nativeCast.state;
  const castConnected = nativeCast.state.connected;
  const castRemoteActive = isCastSessionActive(nativeCast.state);
  const castMediaCurrent = isCurrentCastMedia(nativeCast.state, mediaItemId, episodeId);
  const castTransitioning = castRemoteActive && !castMediaCurrent;
  const resumeTargetRef = useRef(playbackMethod === 'direct' ? (startPositionSeconds ?? 0) : 0);
  const nearEndFiredRef = useRef(false);
  const autoplayAttemptedRef = useRef(false);
  const chromeRef = useRef<HTMLDivElement>(null);
  const [idle, setIdle] = useState(false);
  const pausedRef = useRef(paused);
  const progressSaveInFlightRef = useRef<AbortController | null>(null);
  const initialHlsPositionAppliedRef = useRef(false);
  const pendingQualityPositionRef = useRef<number | null>(null);
  const seekToRef = useRef<(time: number) => void>(() => {});
  pausedRef.current = paused;
  const stableDuration = typeof durationSeconds === 'number' && Number.isFinite(durationSeconds) && durationSeconds > 0
    ? durationSeconds
    : typeof duration === 'number' && Number.isFinite(duration) && duration > 0
      ? duration
      : 0;
  const mediaTimeOrigin = getMediaTimeOrigin(playbackMethod, seekableStart);
  const positionOffset = timelineOffset - mediaTimeOrigin;
  const localAbsoluteCurrentTime = toAbsolutePlaybackTime(
    currentTime,
    timelineOffset,
    mediaTimeOrigin,
  );
  const absoluteCurrentTime = castRemoteActive
    ? castMediaCurrent ? nativeCast.state.currentTimeSeconds : 0
    : localAbsoluteCurrentTime;
  const controlsPaused = castRemoteActive
    ? castTransitioning || nativeCast.state.playerState !== 'PLAYING'
    : paused;
  const showNextEpisode = Boolean(
    nextEpisode &&
    onNextEpisode &&
    shouldShowNextEpisodePrompt({
      currentTimeSeconds: absoluteCurrentTime,
      durationSeconds: stableDuration,
      markers: nextEpisodeMarkers,
      segments,
    }),
  );
  const introSegment = useMemo(
    () =>
      (segments ?? [])
        .filter((segment) => segment.type === 'INTRO')
        .find((segment) => segment.endMs > segment.startMs) ?? null,
    [segments],
  );
  const introSkippedRef = useRef(false);
  const introStartSeconds = introSegment ? introSegment.startMs / 1000 : null;
  const introEndSeconds = introSegment ? introSegment.endMs / 1000 : null;
  const inIntroRange = Boolean(
    introStartSeconds !== null &&
    introEndSeconds !== null &&
    absoluteCurrentTime >= introStartSeconds &&
    absoluteCurrentTime < introEndSeconds - 1 &&
    !introSkippedRef.current,
  );

  // Android owns the single Cast sender. The WebView only publishes the
  // selected media and current position; it never renders a second Cast button.
  useEffect(() => {
    if (!window.FluxNative?.setPlaybackContext) return;
    window.FluxNative.setPlaybackContext(JSON.stringify({
      mediaItemId,
      episodeId: episodeId ?? null,
      currentTimeSeconds: Math.max(0, absoluteCurrentTime),
    }));
  }, [absoluteCurrentTime, episodeId, mediaItemId]);

  useEffect(() => {
    return () => {
      progressSaveInFlightRef.current?.abort();
      progressSaveInFlightRef.current = null;
    };
  }, []);

  const pauseForNativeCast = useCallback(() => {
    onPlaybackIntent(false);
    remote.pause();
  }, [onPlaybackIntent, remote]);

  useEffect(() => {
    if (castConnected) pauseForNativeCast();
  }, [castConnected, pauseForNativeCast]);

  useEffect(() => {
    document.addEventListener('flux:native-cast-local-pause', pauseForNativeCast);
    return () => document.removeEventListener('flux:native-cast-local-pause', pauseForNativeCast);
  }, [pauseForNativeCast]);

  useEffect(() => {
    onPlaybackStateChange({ paused, started });
  }, [onPlaybackStateChange, paused, started]);

  useEffect(() => {
    mediaTimeOriginRef.current = mediaTimeOrigin;
  }, [mediaTimeOrigin, mediaTimeOriginRef]);

  useEffect(() => {
    if (
      playbackMethod !== 'hls' ||
      !canPlay ||
      initialHlsPositionAppliedRef.current ||
      !Number.isFinite(seekableStart) ||
      !Number.isFinite(seekableEnd) ||
      seekableEnd <= seekableStart
    ) {
      return;
    }

    const player = playerRef.current;
    if (!player || !Number.isFinite(player.currentTime)) return;

    initialHlsPositionAppliedRef.current = true;
    if (Math.abs(player.currentTime - mediaTimeOrigin) > 1) {
      player.currentTime = mediaTimeOrigin;
      remote.seek(mediaTimeOrigin);
    }
  }, [
    canPlay,
    mediaTimeOrigin,
    playbackMethod,
    playerRef,
    remote,
    seekableEnd,
    seekableStart,
  ]);

  const seekTo = useCallback(
    (time: number, trigger?: Event, commit = true) => {
      if (!commit || !Number.isFinite(time)) return;

      const hardMax = stableDuration > 0 ? stableDuration : Number.POSITIVE_INFINITY;
      const target = Math.max(0, Math.min(time, hardMax));
      if (castRemoteActive) {
        if (!castMediaCurrent) return;
        nativeCast.seek(target);
        return;
      }
      const player = playerRef.current;
      const localTarget = playbackMethod === 'hls'
        ? toLocalPlaybackTime(target, timelineOffset, mediaTimeOrigin)
        : target;
      const localSeekStart = Number.isFinite(seekableStart) ? seekableStart : 0;
      const localSeekEnd = Number.isFinite(seekableEnd) ? seekableEnd : 0;
      const outsideGeneratedWindow = playbackMethod === 'hls' && (
        localSeekEnd <= localSeekStart ||
        localTarget < localSeekStart - 0.5 ||
        localTarget > localSeekEnd + 0.5
      );

      if (outsideGeneratedWindow) {
        onTranscodeSeek(target);
        return;
      }

      if (player) {
        player.currentTime = localTarget;
      }
      remote.seek(localTarget, trigger);
    },
    [
      onTranscodeSeek,
      playbackMethod,
      playerRef,
      remote,
      castRemoteActive,
      castMediaCurrent,
      nativeCast.seek,
      mediaTimeOrigin,
      seekableEnd,
      seekableStart,
      stableDuration,
      timelineOffset,
    ],
  );
  seekToRef.current = (time: number) => seekTo(time);

  const handleQualityChange = useCallback(
    (
      quality: PlaybackInfoDTO['qualities'][number]['label'],
      positionSeconds?: number,
    ) => {
      const position = Number.isFinite(positionSeconds)
        ? Math.max(0, positionSeconds ?? 0)
        : absoluteCurrentTime;
      pendingQualityPositionRef.current = position;
      onQualityChange(quality, position);
    },
    [absoluteCurrentTime, onQualityChange],
  );

  const enterFullscreenForPlay = useCallback((trigger?: Event) => {
    if (document.fullscreenElement) return;
    remote.enterFullscreen('prefer-media', trigger);
  }, [remote]);

  const togglePlayback = useCallback(
    (trigger?: Event) => {
      if (castRemoteActive) {
        if (!castMediaCurrent) return;
        if (nativeCast.state.playerState === 'PLAYING') nativeCast.pause();
        else nativeCast.play();
        return;
      }
      onPlaybackIntent(paused);
      if (paused) {
        enterFullscreenForPlay(trigger);
        remote.play(trigger);
      } else {
        remote.pause(trigger);
      }
    },
    [castMediaCurrent, castRemoteActive, enterFullscreenForPlay, nativeCast.pause, nativeCast.play, nativeCast.state.playerState, onPlaybackIntent, paused, remote],
  );

  useEffect(() => {
    if (playbackMethod !== 'hls') return;
    if (selectedQuality === 'Auto') {
      remote.changeQuality(-1);
      return;
    }
    const target = qualityOptions.find((quality) => quality.label === selectedQuality);
    if (!target?.height) return;
    const qualityList = qualities ? Array.from({ length: qualities.length }, (_, index) => qualities[index]) : [];
    const index = qualityList.findIndex((quality) => quality?.height === target.height);
    if (index >= 0) remote.changeQuality(index);
  }, [playbackMethod, qualities, qualityOptions, remote, selectedQuality]);

  useEffect(() => {
    if (playbackMethod !== 'hls') {
      pendingQualityPositionRef.current = null;
      return;
    }

    const expectedTime = pendingQualityPositionRef.current;
    if (expectedTime === null) return;
    pendingQualityPositionRef.current = null;
    const startedAt = performance.now();

    const restoreIfJumped = () => {
      const player = playerRef.current;
      if (!player || !Number.isFinite(player.currentTime)) return;
      const elapsedSeconds = Math.max(0, (performance.now() - startedAt) / 1000);
      const expectedNow = pausedRef.current ? expectedTime : expectedTime + elapsedSeconds;
      const actualTime = toAbsolutePlaybackTime(
        player.currentTime,
        timelineOffset,
        mediaTimeOriginRef.current,
      );
      if (isUnexpectedPlaybackJump(expectedNow, actualTime)) {
        seekToRef.current(expectedNow);
      }
    };

    const timers = [0, 200, 600, 1200, 2000].map((delay) =>
      window.setTimeout(restoreIfJumped, delay),
    );
    return () => timers.forEach((timer) => window.clearTimeout(timer));
  }, [playbackMethod, playerRef, selectedQuality, timelineOffset]);

  const reportProgress = useCallback(() => {
    if (castRemoteActive) {
      if (!castMediaCurrent) return;
      const castState = nativeCastStateRef.current;
      const position = castState.currentTimeSeconds;
      const totalDuration = stableDuration > 0 ? stableDuration : castState.durationSeconds;
      if (!Number.isFinite(position) || position <= 0) return;
      if (totalDuration > 0 && position > totalDuration + 5) return;
      if (progressSaveInFlightRef.current) {
        onProgress?.(position, totalDuration, controlsPaused);
        return;
      }
      const controller = new AbortController();
      progressSaveInFlightRef.current = controller;
      const timeout = window.setTimeout(() => controller.abort(), 4000);
      api.saveProgress({
        mediaItemId: episodeId ? undefined : mediaItemId,
        episodeId,
        positionSeconds: position,
        durationSeconds: totalDuration > 0 ? totalDuration : undefined,
      }, controller.signal)
        .catch(() => {})
        .finally(() => {
          window.clearTimeout(timeout);
          if (progressSaveInFlightRef.current === controller) {
            progressSaveInFlightRef.current = null;
          }
        });
      onProgress?.(position, totalDuration, controlsPaused);
      return;
    }
    const player = playerRef.current;
    if (!player) return;
    if (!started || (waiting && !playing)) return;

    const position = toAbsolutePlaybackTime(
      player.currentTime,
      timelineOffset,
      mediaTimeOrigin,
    );
    const totalDuration = stableDuration > 0
      ? stableDuration
      : Number.isFinite(player.duration) ? player.duration : 0;
    if (!Number.isFinite(position) || position <= 0) return;
    if (totalDuration > 0 && position > totalDuration + 5) return;

    if (progressSaveInFlightRef.current) {
      onProgress?.(position, totalDuration, controlsPaused);
      return;
    }

    const controller = new AbortController();
    progressSaveInFlightRef.current = controller;
    const timeout = window.setTimeout(() => controller.abort(), 4000);
    api.saveProgress({
      mediaItemId: episodeId ? undefined : mediaItemId,
      episodeId,
      positionSeconds: position,
      durationSeconds: totalDuration > 0 ? totalDuration : undefined,
    }, controller.signal)
      .catch(() => {})
      .finally(() => {
        window.clearTimeout(timeout);
        if (progressSaveInFlightRef.current === controller) {
          progressSaveInFlightRef.current = null;
        }
      });
    onProgress?.(position, totalDuration, controlsPaused);
  }, [
    castRemoteActive,
    castMediaCurrent,
    controlsPaused,
    episodeId,
    mediaItemId,
    mediaTimeOrigin,
    onProgress,
    playerRef,
    playing,
    stableDuration,
    started,
    timelineOffset,
    waiting,
  ]);

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
    if (controlsPaused) reportProgress();
  }, [controlsPaused, reportProgress]);

  useEffect(() => {
    if (!onNearEnd || nearEndFiredRef.current) return;
    if (stableDuration > 0 && absoluteCurrentTime / stableDuration >= 0.85) {
      nearEndFiredRef.current = true;
      onNearEnd();
    }
  }, [absoluteCurrentTime, onNearEnd, stableDuration]);

  useEffect(() => {
    const target = resumeTargetRef.current;
    if (target > 0 && Number.isFinite(target) && stableDuration > 0) {
      seekTo(Math.min(target, stableDuration - 1));
      resumeTargetRef.current = 0;
    }
  }, [seekTo, stableDuration]);

  useEffect(() => {
    if (!autoplayEnabled || !canPlay || !paused || autoplayAttemptedRef.current) return;
    autoplayAttemptedRef.current = true;
    playerRef.current?.play().catch(() => {});
  }, [autoplayEnabled, canPlay, paused, playerRef]);

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

    const handleLeave = (event: PointerEvent) => {
      if (event.pointerType === 'touch') {
        startTimer();
        return;
      }
      if (idleTimer) clearTimeout(idleTimer);
      if (!pausedRef.current) setIdle(true);
    };

    root.addEventListener('pointermove', wake);
    root.addEventListener('pointerdown', wake);
    root.addEventListener('pointerup', wake);
    root.addEventListener('pointerenter', wake);
    root.addEventListener('pointerleave', handleLeave);
    root.addEventListener('touchstart', wake, { passive: true });
    root.addEventListener('click', wake);

    startTimer();

    return () => {
      root.removeEventListener('pointermove', wake);
      root.removeEventListener('pointerdown', wake);
      root.removeEventListener('pointerup', wake);
      root.removeEventListener('pointerenter', wake);
      root.removeEventListener('pointerleave', handleLeave);
      root.removeEventListener('touchstart', wake);
      root.removeEventListener('click', wake);
      if (idleTimer) clearTimeout(idleTimer);
    };
  }, []);

  useEffect(() => {
    if (controlsPaused) {
      setIdle(false);
      return;
    }
    const timer = window.setTimeout(() => setIdle(true), 2600);
    return () => window.clearTimeout(timer);
  }, [controlsPaused]);

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
        seekTo(absoluteCurrentTime - 10, event);
      } else if (event.key === 'ArrowRight') {
        event.preventDefault();
        setIdle(false);
        seekTo(absoluteCurrentTime + 10, event);
      } else if (event.key.toLowerCase() === 'f') {
        event.preventDefault();
        setIdle(false);
        remote.toggleFullscreen();
      } else if (event.key.toLowerCase() === 'm') {
        event.preventDefault();
        setIdle(false);
        if (castRemoteActive) {
          if (castMediaCurrent) nativeCast.toggleMute();
        }
        else remote.toggleMuted(event);
      }
    };

    window.addEventListener('keydown', handleKey, { capture: true });
    return () => window.removeEventListener('keydown', handleKey, { capture: true });
  }, [absoluteCurrentTime, castMediaCurrent, castRemoteActive, nativeCast.toggleMute, remote, seekTo, togglePlayback]);

  return (
    <div ref={chromeRef} className={idle ? 'fx-chrome is-idle' : 'fx-chrome'}>
      <button
        className="fx-click-layer"
        type="button"
        aria-label={controlsPaused ? 'Play' : 'Pause'}
        onClick={(event) => {
          event.stopPropagation();
          event.nativeEvent.stopImmediatePropagation();
          togglePlayback();
        }}
      />
      <TitleOverlay title={title} subtitle={subtitle} onBack={onBack} />
      {castRemoteActive && (
        <div className="fx-cast-remote-banner" role="status">
          <span>CASTING TO</span>
          <strong>{nativeCast.state.deviceName ?? 'TV'}</strong>
          <small>{castMediaCurrent ? nativeCast.state.title ?? title : title}{castMediaCurrent && nativeCast.state.subtitle ? ` · ${nativeCast.state.subtitle}` : ''}</small>
        </div>
      )}
      <div className={(castRemoteActive ? castTransitioning || nativeCast.state.playerState === 'BUFFERING' : (!started || (waiting && !playing))) ? 'fx-spinner-wrap is-visible' : 'fx-spinner-wrap'}>
        <Spinner />
      </div>
      <Timeline
        mediaItemId={mediaItemId}
        episodeId={episodeId}
        durationSeconds={stableDuration || null}
        positionOffset={castRemoteActive ? 0 : positionOffset}
        currentTimeSeconds={castRemoteActive ? castMediaCurrent ? nativeCast.state.currentTimeSeconds : 0 : undefined}
        remotePlayback={castRemoteActive}
        onSeek={seekTo}
      />
      {nextEpisode && onNextEpisode && showNextEpisode && (
        <button
          className="fx-next-episode"
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            reportProgress();
            if (castRemoteActive) {
              nativeCast.loadMedia(mediaItemId, nextEpisode.id, 0);
            }
            onNextEpisode();
          }}
        >
          <span>Next Episode</span>
          <strong>{nextEpisode.title}</strong>
          <small>{nextEpisode.subtitle}</small>
        </button>
      )}
      {inIntroRange && introEndSeconds !== null && (
        <button
          className="fx-skip-intro"
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            introSkippedRef.current = true;
            seekTo(introEndSeconds);
          }}
        >
          Skip Intro
        </button>
      )}
      <ControlBar
        durationSeconds={stableDuration || null}
        positionOffset={positionOffset}
        onSeek={seekTo}
        onTogglePlayback={togglePlayback}
        qualityOptions={qualityOptions}
        selectedQuality={selectedQuality}
        onQualityChange={handleQualityChange}
        audioStreams={streams.filter((stream) => stream.type === 'audio')}
        selectedAudioStreamIndex={selectedAudioStreamIndex}
        onAudioStreamChange={onAudioStreamChange}
        playbackMethod={playbackMethod}
        castState={nativeCast.state}
        castTransitioning={castTransitioning}
        onCastRequest={nativeCast.request}
        onCastSetVolume={nativeCast.setVolume}
        onCastToggleMute={nativeCast.toggleMute}
      />
      <DebugOverlay
        open={debugOpen}
        playbackMethod={methodLabel}
        videoCodec={videoCodec}
        audioCodec={audioCodec}
        durationSeconds={durationSeconds}
        positionOffset={positionOffset}
      />
    </div>
  );
}
