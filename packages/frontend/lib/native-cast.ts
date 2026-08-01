'use client';

import { useCallback, useEffect, useState } from 'react';

export type NativeCastPlayerState = 'IDLE' | 'BUFFERING' | 'PLAYING' | 'PAUSED' | 'UNKNOWN';

export interface NativeCastState {
  available: boolean;
  connected: boolean;
  mediaLoaded: boolean;
  playerState: NativeCastPlayerState;
  currentTimeSeconds: number;
  durationSeconds: number;
  title: string | null;
  subtitle: string | null;
  deviceName: string | null;
  volume: number;
  muted: boolean;
  detail: string | null;
}

declare global {
  interface Window {
    FLUX_NATIVE_APP?: boolean;
    FluxNative?: {
      isNativeApp?: () => boolean;
      getAppInfo?: () => string;
      checkForUpdates?: () => void;
      requestCast?: () => void;
      setAutomaticUpdates?: (enabled: boolean) => void;
      clearUpdateDownloads?: () => void;
      setPlaybackContext?: (payload: string) => void;
      getCastState?: () => string;
      castPlay?: () => void;
      castPause?: () => void;
      castSeek?: (positionSeconds: number) => void;
      castSetVolume?: (volume: number) => void;
      castToggleMute?: () => void;
      disconnectCast?: () => void;
    };
  }
}

const EMPTY_STATE: NativeCastState = {
  available: false,
  connected: false,
  mediaLoaded: false,
  playerState: 'UNKNOWN',
  currentTimeSeconds: 0,
  durationSeconds: 0,
  title: null,
  subtitle: null,
  deviceName: null,
  volume: 1,
  muted: false,
  detail: null,
};

function finiteNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function normalizeState(value: unknown, current: NativeCastState): NativeCastState {
  if (!value || typeof value !== 'object') return current;
  const input = value as Record<string, unknown>;
  const eventState = typeof input.state === 'string' ? input.state : '';
  const connected = typeof input.connected === 'boolean'
    ? input.connected
    : ['connected', 'media-loaded', 'playback'].includes(eventState)
      ? true
      : ['disconnected', 'error'].includes(eventState)
        ? false
        : current.connected;
  const playerState = ['IDLE', 'BUFFERING', 'PLAYING', 'PAUSED', 'UNKNOWN'].includes(String(input.playerState))
    ? String(input.playerState) as NativeCastPlayerState
    : current.playerState;
  return {
    available: current.available,
    connected,
    mediaLoaded: typeof input.mediaLoaded === 'boolean' ? input.mediaLoaded : connected && (eventState === 'media-loaded' || eventState === 'playback' || current.mediaLoaded),
    playerState,
    currentTimeSeconds: Math.max(0, finiteNumber(input.currentTimeSeconds, current.currentTimeSeconds)),
    durationSeconds: Math.max(0, finiteNumber(input.durationSeconds, current.durationSeconds)),
    title: typeof input.title === 'string' ? input.title : current.title,
    subtitle: typeof input.subtitle === 'string' ? input.subtitle : current.subtitle,
    deviceName: typeof input.deviceName === 'string' ? input.deviceName : current.deviceName,
    volume: Math.max(0, Math.min(1, finiteNumber(input.volume, current.volume))),
    muted: typeof input.muted === 'boolean' ? input.muted : current.muted,
    detail: typeof input.detail === 'string' ? input.detail : current.detail,
  };
}

export function useNativeCast() {
  const [state, setState] = useState<NativeCastState>(EMPTY_STATE);

  useEffect(() => {
    const bridge = window.FluxNative;
    const available = Boolean(bridge?.requestCast && (window.FLUX_NATIVE_APP || bridge.isNativeApp?.()));
    setState((current) => ({ ...current, available }));
    if (available && bridge?.getCastState) {
      try {
        const value = JSON.parse(bridge.getCastState()) as unknown;
        setState((current) => normalizeState(value, { ...current, available: true }));
      } catch {
        // A later native status event will hydrate the state.
      }
    }

    const onState = (event: Event) => {
      const detail = (event as CustomEvent<unknown>).detail;
      setState((current) => normalizeState(detail, { ...current, available }));
    };
    document.addEventListener('flux:native-cast-state', onState);
    return () => document.removeEventListener('flux:native-cast-state', onState);
  }, []);

  const request = useCallback(() => window.FluxNative?.requestCast?.(), []);
  const play = useCallback(() => window.FluxNative?.castPlay?.(), []);
  const pause = useCallback(() => window.FluxNative?.castPause?.(), []);
  const seek = useCallback((positionSeconds: number) => window.FluxNative?.castSeek?.(Math.max(0, positionSeconds)), []);
  const setVolume = useCallback((volume: number) => window.FluxNative?.castSetVolume?.(Math.max(0, Math.min(1, volume))), []);
  const toggleMute = useCallback(() => window.FluxNative?.castToggleMute?.(), []);
  const disconnect = useCallback(() => window.FluxNative?.disconnectCast?.(), []);

  return { state, request, play, pause, seek, setVolume, toggleMute, disconnect };
}
