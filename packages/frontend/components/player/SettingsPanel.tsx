'use client';

import { useCallback, useEffect, useMemo, useRef } from 'react';
import { useMediaRemote, useMediaState } from '@vidstack/react';
import type { MediaStreamDTO, PlaybackInfoDTO } from '@flux/shared';

interface SettingsPanelProps {
  open: boolean;
  onClose: () => void;
  qualityOptions: PlaybackInfoDTO['qualities'];
  selectedQuality: PlaybackInfoDTO['qualities'][number]['label'];
  onQualityChange: (quality: PlaybackInfoDTO['qualities'][number]['label'], positionSeconds?: number) => void;
  currentPositionSeconds: number;
  audioStreams: MediaStreamDTO[];
  selectedAudioStreamIndex: number | null;
  onAudioStreamChange: (streamIndex: number | null) => void;
  playbackMethod: 'direct' | 'hls';
}

const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 2] as const;

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

function streamLabel(stream: MediaStreamDTO, fallback: string) {
  const language = stream.language?.toUpperCase();
  const parts = [
    stream.title,
    language,
    stream.codec?.toUpperCase(),
    stream.channels ? `${stream.channels}ch` : null,
  ].filter(Boolean);
  return parts.join(' · ') || fallback;
}

export function SettingsPanel({
  open,
  onClose,
  qualityOptions,
  selectedQuality,
  onQualityChange,
  currentPositionSeconds,
  audioStreams,
  selectedAudioStreamIndex,
  onAudioStreamChange,
  playbackMethod,
}: SettingsPanelProps) {
  const remote = useMediaRemote();
  const panelRef = useRef<HTMLDivElement>(null);
  const qualities = useMediaState('qualities');
  const audioTracks = useMediaState('audioTracks');
  const audioTrack = useMediaState('audioTrack');
  const playbackRate = useMediaState('playbackRate');

  const qualityList = useMemo(
    () => (qualities ? Array.from({ length: qualities.length }, (_, index) => qualities[index]) : []),
    [qualities],
  );
  const audioTrackList = useMemo(
    () => (audioTracks ? Array.from({ length: audioTracks.length }, (_, index) => audioTracks[index]) : []),
    [audioTracks],
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

  const availableQualityOptions = qualityOptions.filter((quality) => quality.available);

  return (
    <div className="fx-settings-panel" ref={panelRef} role="menu" aria-label="Playback settings">
      {availableQualityOptions.length > 0 && (
        <section className="fx-settings-section">
          <div className="fx-settings-label">Quality</div>
          {availableQualityOptions.map((quality) => {
            const selected = selectedQuality === quality.label;
            const label = quality.label;
            const liveQuality = quality.height
              ? qualityList.find((item) => item?.height === quality.height)
              : null;
            const bitrate = liveQuality?.bitrate || quality.bitrate
              ? `${Math.round((liveQuality?.bitrate ?? quality.bitrate ?? 0) / 1000)} kbps`
              : '';
            const detail = selected && playbackMethod === 'direct'
              ? 'Direct Play'
              : quality.source === 'direct'
              ? 'Direct Play'
              : quality.label === 'Auto'
                ? 'Adaptive'
                : bitrate;
            return (
              <button
                key={quality.label}
                className={selected ? 'fx-settings-item sel' : 'fx-settings-item'}
                type="button"
                role="menuitemradio"
                aria-checked={selected}
                onClick={() =>
                  runAndClose(() => {
                    onQualityChange(quality.label, currentPositionSeconds);
                  })
                }
              >
                <span>{label}</span>
                {detail && <span className="fx-settings-sub">{detail}</span>}
                {selected && <span className="fx-settings-check">Selected</span>}
              </button>
            );
          })}
        </section>
      )}

      {audioStreams.length > 1 ? (
        <section className="fx-settings-section">
          <div className="fx-settings-label">Audio</div>
          <button
            className={selectedAudioStreamIndex === null ? 'fx-settings-item sel' : 'fx-settings-item'}
            type="button"
            role="menuitemradio"
            aria-checked={selectedAudioStreamIndex === null}
            onClick={() => runAndClose(() => onAudioStreamChange(null))}
          >
            <span>Default</span>
            <span className="fx-settings-sub">Source default</span>
            {selectedAudioStreamIndex === null && <span className="fx-settings-check">Selected</span>}
          </button>
          {audioStreams.map((stream, index) => {
            const selected = selectedAudioStreamIndex === stream.index;
            return (
              <button
                key={stream.id}
                className={selected ? 'fx-settings-item sel' : 'fx-settings-item'}
                type="button"
                role="menuitemradio"
                aria-checked={selected}
                onClick={() => runAndClose(() => onAudioStreamChange(stream.index))}
              >
                <span>{streamLabel(stream, `Track ${index + 1}`)}</span>
                {(stream.isDefault || stream.isForced) && (
                  <span className="fx-settings-sub">
                    {stream.isDefault ? 'Default' : 'Forced'}
                  </span>
                )}
                {selected && <span className="fx-settings-check">Selected</span>}
              </button>
            );
          })}
        </section>
      ) : audioTrackList.length > 1 && (
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
