'use client';

import { useCallback, useEffect, useRef } from 'react';
import { useMediaState, useMediaRemote } from '@vidstack/react';

interface SettingsPanelProps {
  open: boolean;
  onToggle: () => void;
}

const PLAYBACK_SPEEDS = [0.5, 1, 1.25, 1.5, 2] as const;

function speedLabel(speed: number): string {
  return speed === 1 ? '1x (Normal)' : `${speed}x`;
}

/**
 * Gear-icon dropdown panel with quality, audio track, subtitle,
 * and playback speed selectors. Reads state directly from Vidstack
 * hooks and dispatches changes via useMediaRemote.
 */
export function SettingsPanel({ open, onToggle }: SettingsPanelProps) {
  const remote = useMediaRemote();
  const panelRef = useRef<HTMLDivElement>(null);

  // --- Vidstack state hooks ---
  const qualities = useMediaState('qualities');
  const audioTracks = useMediaState('audioTracks');
  const textTracks = useMediaState('textTracks');
  const audioTrack = useMediaState('audioTrack');
  const playbackRate = useMediaState('playbackRate');
  const canSetQuality = useMediaState('canSetQuality');

  // --- Prevent control-bar auto-hide while the panel is open ---
  useEffect(() => {
    if (open) {
      remote.pauseControls(new Event('settings-open'));
    } else {
      remote.resumeControls(new Event('settings-close'));
    }
  }, [open, remote]);

  // --- Click outside / Escape to close ---
  useEffect(() => {
    if (!open) return;

    const handleClick = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        onToggle();
      }
    };

    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onToggle();
      }
    };

    // Use capture phase so the click is caught before it reaches the settings button
    document.addEventListener('click', handleClick, true);
    document.addEventListener('keydown', handleKey);

    return () => {
      document.removeEventListener('click', handleClick, true);
      document.removeEventListener('keydown', handleKey);
    };
  }, [open, onToggle]);

  // --- Normalise list-like Vidstack objects to arrays ---
  const levels = qualities
    ? Array.from({ length: qualities.length }, (_, i) => qualities[i])
    : [];

  const audioTrackList = audioTracks
    ? Array.from({ length: audioTracks.length }, (_, i) => audioTracks[i])
    : [];

  const subtitleTracks = textTracks
    ? Array.from({ length: textTracks.length }, (_, i) => textTracks[i])
    : [];

  // --- Derived selected states ---
  const anyQualitySelected = levels.some((l) => l?.selected);
  const autoQualitySelected = !anyQualitySelected;
  const currentRate = playbackRate ?? 1;
  const anySubtitleShowing = subtitleTracks.some((t) => t?.mode === 'showing');

  const selectItem = useCallback(
    (action: () => void) => {
      action();
      onToggle();
    },
    [onToggle],
  );

  if (!open) return null;

  return (
    <div className="fx-settings-panel" ref={panelRef} role="menu">
      {/* ── Quality ─────────────────────────────────────────────── */}
      {canSetQuality && levels.length > 0 && (
        <div className="fx-settings-section">
          <div className="fx-settings-label">Quality</div>

          <button
            className={`fx-settings-item${autoQualitySelected ? ' sel' : ''}`}
            role="menuitemradio"
            aria-checked={autoQualitySelected}
            onClick={() => selectItem(() => remote.changeQuality(-1))}
          >
            <span>Auto</span>
            {autoQualitySelected && <span className="fx-settings-check">&#10003;</span>}
          </button>

          {levels.map((level, i) => {
            const label = level?.height ? `${level.height}p` : `Quality ${i + 1}`;
            const sublabel = level?.bitrate
              ? `${Math.round(level.bitrate / 1000)} kbps`
              : '';
            const isSel = level?.selected === true;

            return (
              <button
                key={i}
                className={`fx-settings-item${isSel ? ' sel' : ''}`}
                role="menuitemradio"
                aria-checked={isSel}
                onClick={() => selectItem(() => remote.changeQuality(i))}
              >
                <span>{label}</span>
                {sublabel && <span className="fx-settings-sub">{sublabel}</span>}
                {isSel && <span className="fx-settings-check">&#10003;</span>}
              </button>
            );
          })}
        </div>
      )}

      {/* ── Audio ───────────────────────────────────────────────── */}
      {audioTrackList.length > 1 && (
        <div className="fx-settings-section">
          <div className="fx-settings-label">Audio</div>

          {audioTrackList.map((track, i) => {
            const label = track.label || track.language || `Track ${i + 1}`;
            const isSel =
              audioTrack != null &&
              (audioTrack.id === track?.id || i === audioTrackList.indexOf(audioTrack));

            return (
              <button
                key={i}
                className={`fx-settings-item${isSel ? ' sel' : ''}`}
                role="menuitemradio"
                aria-checked={isSel}
                onClick={() => selectItem(() => remote.changeAudioTrack(i))}
              >
                <span>{label}</span>
                {isSel && <span className="fx-settings-check">&#10003;</span>}
              </button>
            );
          })}
        </div>
      )}

      {/* ── Subtitles ───────────────────────────────────────────── */}
      {subtitleTracks.length > 0 && (
        <div className="fx-settings-section">
          <div className="fx-settings-label">Subtitles</div>

          <button
            className={`fx-settings-item${!anySubtitleShowing ? ' sel' : ''}`}
            role="menuitemradio"
            aria-checked={!anySubtitleShowing}
            onClick={() =>
              selectItem(() => {
                // Disable every visible text track
                subtitleTracks.forEach((_, idx) => {
                  remote.changeTextTrackMode(idx, 'disabled');
                });
              })
            }
          >
            <span>Off</span>
            {!anySubtitleShowing && <span className="fx-settings-check">&#10003;</span>}
          </button>

          {subtitleTracks.map((track, i) => {
            const label = track?.label || track?.language || `Track ${i + 1}`;
            const isActive = track?.mode === 'showing';

            return (
              <button
                key={i}
                className={`fx-settings-item${isActive ? ' sel' : ''}`}
                role="menuitemradio"
                aria-checked={isActive}
                onClick={() => selectItem(() => remote.changeTextTrackMode(i, 'showing'))}
              >
                <span>{label}</span>
                {isActive && <span className="fx-settings-check">&#10003;</span>}
              </button>
            );
          })}
        </div>
      )}

      {/* ── Speed ───────────────────────────────────────────────── */}
      <div className="fx-settings-section">
        <div className="fx-settings-label">Speed</div>

        {PLAYBACK_SPEEDS.map((speed) => {
          const isSel = currentRate === speed;
          return (
            <button
              key={speed}
              className={`fx-settings-item${isSel ? ' sel' : ''}`}
              role="menuitemradio"
              aria-checked={isSel}
              onClick={() => selectItem(() => remote.changePlaybackRate(speed))}
            >
              <span>{speedLabel(speed)}</span>
              {isSel && <span className="fx-settings-check">&#10003;</span>}
            </button>
          );
        })}
      </div>
    </div>
  );
}
