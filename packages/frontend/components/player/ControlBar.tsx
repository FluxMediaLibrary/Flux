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

interface ControlBarProps {
  durationSeconds?: number | null;
  positionOffset?: number;
  onSeek: (time: number, trigger?: Event, commit?: boolean) => void;
  qualityOptions: PlaybackInfoDTO['qualities'];
  selectedQuality: PlaybackInfoDTO['qualities'][number]['label'];
  onQualityChange: (quality: PlaybackInfoDTO['qualities'][number]['label']) => void;
  audioStreams: MediaStreamDTO[];
  selectedAudioStreamIndex: number | null;
  onAudioStreamChange: (streamIndex: number | null) => void;
  playbackMethod: 'direct' | 'hls';
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
  qualityOptions,
  selectedQuality,
  onQualityChange,
  audioStreams,
  selectedAudioStreamIndex,
  onAudioStreamChange,
  playbackMethod,
}: ControlBarProps) {
  const remote = useMediaRemote();
  const paused = useMediaState('paused');
  const muted = useMediaState('muted');
  const volume = useMediaState('volume');
  const currentTime = useMediaState('currentTime');
  const duration = useMediaState('duration');
  const fullscreen = useMediaState('fullscreen');
  const canPictureInPicture = useMediaState('canPictureInPicture');
  const pictureInPicture = useMediaState('pictureInPicture');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const displayDuration = typeof durationSeconds === 'number' && Number.isFinite(durationSeconds) && durationSeconds > 0
    ? durationSeconds
    : typeof duration === 'number' && Number.isFinite(duration) && duration > 0
      ? duration
      : 0;
  const displayCurrentTime = positionOffset + (Number.isFinite(currentTime) ? currentTime : 0);

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
      remote.changeVolume(value);
      if (value > 0 && muted) remote.toggleMuted();
    },
    [muted, remote],
  );

  const togglePip = useCallback(() => {
    if (pictureInPicture) remote.exitPictureInPicture();
    else remote.enterPictureInPicture();
  }, [pictureInPicture, remote]);

  const displayVolume = muted ? 0 : volume;

  return (
    <div className="fx-controls">
      <div className="fx-row">
        <button className="fx-btn fx-btn--primary" type="button" onClick={() => remote.togglePaused()} aria-label={paused ? 'Play' : 'Pause'}>
          {paused ? <PlayIcon /> : <PauseIcon />}
        </button>

        <button className="fx-btn" type="button" onClick={(event) => seekBy(-10, event.nativeEvent)} aria-label="Back 10 seconds">
          <SkipBackIcon />
        </button>
        <button className="fx-btn" type="button" onClick={(event) => seekBy(10, event.nativeEvent)} aria-label="Forward 10 seconds">
          <SkipForwardIcon />
        </button>

        <div className="fx-vol">
          <button className="fx-btn" type="button" onClick={() => remote.toggleMuted()} aria-label={muted ? 'Unmute' : 'Mute'}>
            {muted || displayVolume === 0 ? <MuteIcon /> : <VolumeIcon />}
          </button>
          <input
            className="fx-vol-slider"
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={displayVolume}
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

        <button className="fx-btn" type="button" onClick={() => remote.requestGoogleCast()} aria-label="Cast">
          <CastIcon connected={false} />
        </button>

        {canPictureInPicture && (
          <button className={pictureInPicture ? 'fx-btn active' : 'fx-btn'} type="button" onClick={togglePip} aria-label="Picture in picture">
            <PictureInPictureIcon />
          </button>
        )}

        <div className="fx-settings-wrap">
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
            audioStreams={audioStreams}
            selectedAudioStreamIndex={selectedAudioStreamIndex}
            onAudioStreamChange={onAudioStreamChange}
            playbackMethod={playbackMethod}
          />
        </div>

        <button className="fx-btn" type="button" onClick={() => remote.toggleFullscreen()} aria-label={fullscreen ? 'Exit fullscreen' : 'Fullscreen'}>
          {fullscreen ? <FullscreenExitIcon /> : <FullscreenIcon />}
        </button>
      </div>
    </div>
  );
}
