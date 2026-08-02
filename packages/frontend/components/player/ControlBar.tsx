'use client';

import { useCallback, useState } from 'react';
import { useMediaRemote, useMediaState } from '@vidstack/react';
import {
  CastIcon,
  FullscreenExitIcon,
  FullscreenIcon,
  MuteIcon,
  PauseIcon,
  PictureInPictureIcon,
  PlayIcon,
  SettingsIcon,
  SkipBackIcon,
  SkipForwardIcon,
  VolumeIcon,
} from './icons';
import { SettingsPanel } from './SettingsPanel';
import type { MediaStreamDTO, PlaybackInfoDTO } from '@flux/shared';
import type { NativeCastState } from '@/lib/native-cast';

interface ControlBarProps {
  durationSeconds?: number | null;
  positionOffset?: number;
  onSeek: (time: number, trigger?: Event, commit?: boolean) => void;
  onTogglePlayback: (trigger?: Event) => void;
  qualityOptions: PlaybackInfoDTO['qualities'];
  selectedQuality: PlaybackInfoDTO['qualities'][number]['label'];
  onQualityChange: (quality: PlaybackInfoDTO['qualities'][number]['label'], positionSeconds?: number) => void;
  audioStreams: MediaStreamDTO[];
  selectedAudioStreamIndex: number | null;
  onAudioStreamChange: (streamIndex: number, positionSeconds?: number) => void;
  playbackMethod: 'direct' | 'hls';
  castState?: NativeCastState;
  castTransitioning?: boolean;
  onCastRequest?: () => void;
  onCastSetVolume?: (volume: number) => void;
  onCastToggleMute?: () => void;
}

function formatTime(value: number): string {
  if (!Number.isFinite(value) || value < 0) return '0:00';
  const hours = Math.floor(value / 3600);
  const minutes = Math.floor((value % 3600) / 60);
  const seconds = Math.floor(value % 60);
  if (hours > 0) return `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

export function ControlBar({
  durationSeconds,
  positionOffset = 0,
  onSeek,
  onTogglePlayback,
  qualityOptions,
  selectedQuality,
  onQualityChange,
  audioStreams,
  selectedAudioStreamIndex,
  onAudioStreamChange,
  playbackMethod,
  castState,
  castTransitioning = false,
  onCastRequest,
  onCastSetVolume,
  onCastToggleMute,
}: ControlBarProps) {
  const remote = useMediaRemote();
  const localPaused = useMediaState('paused');
  const localMuted = useMediaState('muted');
  const localVolume = useMediaState('volume');
  const currentTime = useMediaState('currentTime');
  const duration = useMediaState('duration');
  const fullscreen = useMediaState('fullscreen');
  const canPictureInPicture = useMediaState('canPictureInPicture');
  const pictureInPicture = useMediaState('pictureInPicture');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const remoteActive = Boolean(castState?.connected);
  const paused = remoteActive ? castTransitioning || castState?.playerState !== 'PLAYING' : localPaused;
  const muted = remoteActive ? Boolean(castState?.muted) : localMuted;
  const volume = remoteActive ? castState?.volume ?? 1 : localVolume;
  const displayDuration = typeof durationSeconds === 'number' && Number.isFinite(durationSeconds) && durationSeconds > 0
    ? durationSeconds
    : remoteActive && castState && castState.durationSeconds > 0
      ? castState.durationSeconds
    : typeof duration === 'number' && Number.isFinite(duration) && duration > 0
      ? duration
      : 0;
  const displayCurrentTime = remoteActive && castTransitioning
    ? 0
    : remoteActive && castState
    ? castState.currentTimeSeconds
    : positionOffset + (Number.isFinite(currentTime) ? currentTime : 0);

  const seekBy = useCallback(
    (delta: number, trigger: Event) => {
      const rawTarget = displayCurrentTime + delta;
      const target = Number.isFinite(displayDuration) && displayDuration > 0
        ? Math.max(0, Math.min(displayDuration, rawTarget))
        : Math.max(0, rawTarget);
      onSeek(target, trigger);
    },
    [displayCurrentTime, displayDuration, onSeek],
  );

  const changeVolume = useCallback(
    (value: number) => {
      if (remoteActive) {
        onCastSetVolume?.(value);
        return;
      }
      remote.changeVolume(value);
      if (value > 0 && muted) remote.toggleMuted();
    },
    [muted, onCastSetVolume, remote, remoteActive],
  );

  const togglePip = useCallback(() => {
    if (pictureInPicture) remote.exitPictureInPicture();
    else remote.enterPictureInPicture();
  }, [pictureInPicture, remote]);

  const displayVolume = muted ? 0 : volume;

  return (
    <div className="fx-controls">
      <div className="fx-row">
        <button
          className="fx-btn fx-btn--primary"
          type="button"
          disabled={castTransitioning}
          onClick={(event) => {
            event.stopPropagation();
            onTogglePlayback(event.nativeEvent);
          }}
          aria-label={paused ? 'Play' : 'Pause'}
        >
          {paused ? <PlayIcon /> : <PauseIcon />}
        </button>

        <button className="fx-btn" type="button" disabled={castTransitioning} onClick={(event) => seekBy(-10, event.nativeEvent)} aria-label="Back 10 seconds">
          <SkipBackIcon />
        </button>
        <button className="fx-btn" type="button" disabled={castTransitioning} onClick={(event) => seekBy(10, event.nativeEvent)} aria-label="Forward 10 seconds">
          <SkipForwardIcon />
        </button>

        <div className="fx-vol">
          <button className="fx-btn" type="button" disabled={castTransitioning} onClick={() => remoteActive ? onCastToggleMute?.() : remote.toggleMuted()} aria-label={muted ? 'Unmute' : 'Mute'}>
            {muted || displayVolume === 0 ? <MuteIcon /> : <VolumeIcon />}
          </button>
          <input
            className="fx-vol-slider"
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={displayVolume}
            disabled={castTransitioning}
            onChange={(event) => changeVolume(Number(event.currentTarget.value))}
            aria-label="Volume"
          />
        </div>

        <div className="fx-time" aria-label="Playback time">
          <span>{formatTime(displayCurrentTime)}</span>
          <span className="fx-time-sep">/</span>
          <span>{formatTime(displayDuration)}</span>
        </div>

        <div className="fx-spacer" />

        {castState?.available && (
          <button
            className={castState.connected ? 'fx-btn active' : 'fx-btn'}
            type="button"
            onClick={onCastRequest}
            aria-label={castState.connected ? `Casting to ${castState.deviceName ?? 'TV'}` : 'Cast'}
          >
            <CastIcon connected={castState.connected} />
          </button>
        )}

        {!remoteActive && canPictureInPicture && (
          <button className={pictureInPicture ? 'fx-btn active' : 'fx-btn'} type="button" onClick={togglePip} aria-label="Picture in picture">
            <PictureInPictureIcon />
          </button>
        )}

        {!remoteActive && <div className="fx-settings-wrap">
          <button
            className={settingsOpen ? 'fx-btn active' : 'fx-btn'}
            type="button"
            onClick={() => setSettingsOpen((open) => !open)}
            aria-label="Settings"
            aria-expanded={settingsOpen}
          >
            <SettingsIcon />
          </button>
          <SettingsPanel
            open={settingsOpen}
            onClose={() => setSettingsOpen(false)}
            qualityOptions={qualityOptions}
            selectedQuality={selectedQuality}
            onQualityChange={onQualityChange}
            currentPositionSeconds={displayCurrentTime}
            audioStreams={audioStreams}
            selectedAudioStreamIndex={selectedAudioStreamIndex}
            onAudioStreamChange={onAudioStreamChange}
            playbackMethod={playbackMethod}
          />
        </div>}

        <button
          className="fx-btn"
          type="button"
          onClick={(event) => remote.toggleFullscreen('prefer-media', event.nativeEvent)}
          aria-label={fullscreen ? 'Exit fullscreen' : 'Fullscreen'}
        >
          {fullscreen ? <FullscreenExitIcon /> : <FullscreenIcon />}
        </button>
      </div>
    </div>
  );
}
