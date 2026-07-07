'use client';

import { useCallback, useEffect, useMemo, useRef } from 'react';
import { useMediaRemote, useMediaState } from '@vidstack/react';

interface SettingsPanelProps {
  open: boolean;
  onClose: () => void;
}

const SPEEDS = [0.5, 1, 1.25, 1.5, 2] as const;

function sameId(a: unknown, b: unknown) {
  return Boolean(
    a &&
      b &&
      typeof a === 'object' &&
      typeof b === 'object' &&
      'id' in a &&
      'id' in b &&
      a.id === b.id,
  );
}

export function SettingsPanel({ open, onClose }: SettingsPanelProps) {
  const remote = useMediaRemote();
  const panelRef = useRef<HTMLDivElement>(null);
  const qualities = useMediaState('qualities');
  const audioTracks = useMediaState('audioTracks');
  const textTracks = useMediaState('textTracks');
  const audioTrack = useMediaState('audioTrack');
  const playbackRate = useMediaState('playbackRate');
  const canSetQuality = useMediaState('canSetQuality');

  const qualityList = useMemo(
    () => (qualities ? Array.from({ length: qualities.length }, (_, index) => qualities[index]) : []),
    [qualities],
  );
  const audioTrackList = useMemo(
    () => (audioTracks ? Array.from({ length: audioTracks.length }, (_, index) => audioTracks[index]) : []),
    [audioTracks],
  );
  const subtitleList = useMemo(
    () => (textTracks ? Array.from({ length: textTracks.length }, (_, index) => textTracks[index]) : []),
    [textTracks],
  );

  useEffect(() => {
    if (!open) {
      remote.resumeControls();
      return;
    }
    remote.pauseControls();

    const handlePointerDown = (event: PointerEvent) => {
      if (panelRef.current && !panelRef.current.contains(event.target as Node)) onClose();
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };

    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
      remote.resumeControls();
    };
  }, [onClose, open, remote]);

  const runAndClose = useCallback(
    (action: () => void) => {
      action();
      onClose();
    },
    [onClose],
  );

  if (!open) return null;

  const hasManualQuality = qualityList.some((quality) => quality?.selected);
  const subtitleActive = subtitleList.findIndex((track) => track?.mode === 'showing');

  return (
    <div className="fx-settings-panel" ref={panelRef} role="menu" aria-label="Playback settings">
      {canSetQuality && qualityList.length > 0 && (
        <section className="fx-settings-section">
          <div className="fx-settings-label">Quality</div>
          <button
            className={!hasManualQuality ? 'fx-settings-item sel' : 'fx-settings-item'}
            type="button"
            role="menuitemradio"
            aria-checked={!hasManualQuality}
            onClick={() => runAndClose(() => remote.changeQuality(-1))}
          >
            <span>Auto</span>
            {!hasManualQuality && <span className="fx-settings-check">Selected</span>}
          </button>
          {qualityList.map((quality, index) => {
            const label = quality?.height ? `${quality.height}p` : `Quality ${index + 1}`;
            const bitrate = quality?.bitrate ? `${Math.round(quality.bitrate / 1000)} kbps` : '';
            return (
              <button
                key={`${label}-${index}`}
                className={quality?.selected ? 'fx-settings-item sel' : 'fx-settings-item'}
                type="button"
                role="menuitemradio"
                aria-checked={Boolean(quality?.selected)}
                onClick={() => runAndClose(() => remote.changeQuality(index))}
              >
                <span>{label}</span>
                {bitrate && <span className="fx-settings-sub">{bitrate}</span>}
                {quality?.selected && <span className="fx-settings-check">Selected</span>}
              </button>
            );
          })}
        </section>
      )}

      {audioTrackList.length > 1 && (
        <section className="fx-settings-section">
          <div className="fx-settings-label">Audio</div>
          {audioTrackList.map((track, index) => {
            const selected = sameId(audioTrack, track) || audioTrack === track;
            const label = track?.label || track?.language || `Track ${index + 1}`;
            return (
              <button
                key={`${label}-${index}`}
                className={selected ? 'fx-settings-item sel' : 'fx-settings-item'}
                type="button"
                role="menuitemradio"
                aria-checked={selected}
                onClick={() => runAndClose(() => remote.changeAudioTrack(index))}
              >
                <span>{label}</span>
                {track?.language && <span className="fx-settings-sub">{track.language}</span>}
                {selected && <span className="fx-settings-check">Selected</span>}
              </button>
            );
          })}
        </section>
      )}

      <section className="fx-settings-section">
        <div className="fx-settings-label">Subtitles</div>
        <button
          className={subtitleActive < 0 ? 'fx-settings-item sel' : 'fx-settings-item'}
          type="button"
          role="menuitemradio"
          aria-checked={subtitleActive < 0}
          onClick={() =>
            runAndClose(() => {
              subtitleList.forEach((_, index) => remote.changeTextTrackMode(index, 'disabled'));
            })
          }
        >
          <span>Off</span>
          {subtitleActive < 0 && <span className="fx-settings-check">Selected</span>}
        </button>
        {subtitleList.map((track, index) => {
          const selected = track?.mode === 'showing';
          const label = track?.label || track?.language || `Track ${index + 1}`;
          return (
            <button
              key={`${label}-${index}`}
              className={selected ? 'fx-settings-item sel' : 'fx-settings-item'}
              type="button"
              role="menuitemradio"
              aria-checked={selected}
              onClick={() => runAndClose(() => remote.changeTextTrackMode(index, 'showing'))}
            >
              <span>{label}</span>
              {track?.language && <span className="fx-settings-sub">{track.language}</span>}
              {selected && <span className="fx-settings-check">Selected</span>}
            </button>
          );
        })}
      </section>

      <section className="fx-settings-section">
        <div className="fx-settings-label">Playback Speed</div>
        {SPEEDS.map((speed) => {
          const selected = playbackRate === speed;
          return (
            <button
              key={speed}
              className={selected ? 'fx-settings-item sel' : 'fx-settings-item'}
              type="button"
              role="menuitemradio"
              aria-checked={selected}
              onClick={() => runAndClose(() => remote.changePlaybackRate(speed))}
            >
              <span>{speed === 1 ? '1x' : `${speed}x`}</span>
              {selected && <span className="fx-settings-check">Selected</span>}
            </button>
          );
        })}
      </section>
    </div>
  );
}
