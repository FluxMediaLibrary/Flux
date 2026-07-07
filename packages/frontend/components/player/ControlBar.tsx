'use client';

import { useCallback, useRef, useState } from 'react';
import { useMediaState, useMediaRemote } from '@vidstack/react';
import {
  PlayIcon,
  PauseIcon,
  SkipBackIcon,
  SkipForwardIcon,
  VolumeIcon,
  MuteIcon,
  FullscreenIcon,
  FullscreenExitIcon,
  SettingsIcon,
  CastIcon,
  SubtitlesIcon,
} from './icons';
import { SettingsPanel } from './SettingsPanel';

/**
 * Flux-branded bottom control bar.
 *
 * Uses Vidstack's headless hooks for state and remote for dispatching
 * media requests. Styling is done via the `.fx-*` CSS namespace (see globals.css).
 */
export function ControlBar() {
  const remote = useMediaRemote();
  const paused = useMediaState('paused');
  const muted = useMediaState('muted');
  const volume = useMediaState('volume');
  const currentTime = useMediaState('currentTime');
  const duration = useMediaState('duration');
  const fullscreen = useMediaState('fullscreen');
  const canPictureInPicture = useMediaState('canPictureInPicture');

  // Cast state — Vidstack surfaces this via data attributes on the player element.
  // We read from the DOM or use a simple ref-based approach.
  const [settingsOpen, setSettingsOpen] = useState(false);
  const settingsRef = useRef<HTMLDivElement>(null);

  const togglePlay = useCallback(() => {
    remote.togglePaused();
  }, [remote]);

  const skipBack = useCallback(() => {
    remote.seek(Math.max(0, (currentTime ?? 0) - 10));
  }, [remote, currentTime]);

  const skipForward = useCallback(() => {
    const d = duration ?? 0;
    remote.seek(Math.min(d, (currentTime ?? 0) + 10));
  }, [remote, currentTime, duration]);

  const changeVolume = useCallback(
    (val: number) => {
      remote.changeVolume(val);
    },
    [remote],
  );

  const toggleMute = useCallback(() => {
    remote.toggleMuted();
  }, [remote]);

  const toggleFullscreen = useCallback(() => {
    remote.toggleFullscreen();
  }, [remote]);

  const enterPip = useCallback(() => {
    remote.enterPictureInPicture();
  }, [remote]);

  // Format time as H:MM:SS or M:SS
  const fmt = (t: number): string => {
    if (!Number.isFinite(t) || t < 0) return '0:00';
    const h = Math.floor(t / 3600);
    const m = Math.floor((t % 3600) / 60);
    const s = Math.floor(t % 60);
    if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    return `${m}:${String(s).padStart(2, '0')}`;
  };

  const cur = currentTime ?? 0;
  const dur = duration ?? 0;
  const vol = muted ? 0 : (volume ?? 1);

  return (
    <div className="fx-controls">
      <div className="fx-row">
        {/* Play/Pause */}
        <button className="fx-btn" onClick={togglePlay} aria-label={paused ? 'Play' : 'Pause'}>
          {paused ? <PlayIcon /> : <PauseIcon />}
        </button>

        {/* Skip back */}
        <button className="fx-btn" onClick={skipBack} aria-label="Back 10 seconds">
          <SkipBackIcon />
        </button>

        {/* Skip forward */}
        <button className="fx-btn" onClick={skipForward} aria-label="Forward 10 seconds">
          <SkipForwardIcon />
        </button>

        {/* Volume */}
        <div className="fx-vol">
          <button className="fx-btn" onClick={toggleMute} aria-label={muted ? 'Unmute' : 'Mute'}>
            {muted || vol === 0 ? <MuteIcon /> : <VolumeIcon />}
          </button>
          <input
            className="fx-vol-slider"
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={vol}
            onChange={(e) => changeVolume(Number(e.target.value))}
            aria-label="Volume"
          />
        </div>

        {/* Time display */}
        <div className="fx-time">
          {fmt(cur)} <span className="fx-time-sep">/</span> {fmt(dur)}
        </div>

        {/* Spacer */}
        <div className="fx-spacer" />

        {/* Subtitles toggle */}
        <button className="fx-btn" aria-label="Subtitles">
          <SubtitlesIcon />
        </button>

        {/* Cast */}
        <button className="fx-btn" aria-label="Cast to TV">
          <CastIcon connected={false} />
        </button>

        {/* Picture-in-Picture */}
        {canPictureInPicture && (
          <button className="fx-btn" onClick={enterPip} aria-label="Picture in Picture">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ width: 20, height: 20 }}>
              <rect x="10" y="10" width="12" height="8" rx="2" />
              <rect x="2" y="4" width="16" height="12" rx="2" />
            </svg>
          </button>
        )}

        {/* Settings */}
        <div className="fx-settings-wrap" ref={settingsRef}>
          <button
            className={`fx-btn${settingsOpen ? ' active' : ''}`}
            onClick={() => setSettingsOpen((v) => !v)}
            aria-label="Settings"
          >
            <SettingsIcon />
          </button>
          {/* Settings panel rendered by SettingsPanel component */}
          <SettingsPanel open={settingsOpen} onToggle={() => setSettingsOpen((v) => !v)} />
        </div>

        {/* Fullscreen */}
        <button className="fx-btn" onClick={toggleFullscreen} aria-label={fullscreen ? 'Exit fullscreen' : 'Fullscreen'}>
          {fullscreen ? <FullscreenExitIcon /> : <FullscreenIcon />}
        </button>
      </div>
    </div>
  );
}
