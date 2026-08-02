'use client';

export interface DesktopPlaybackPresence {
  title: string;
  mediaType: 'movie' | 'show';
  season?: number;
  episode?: number;
  episodeTitle?: string;
  posterUrl?: string;
  positionSeconds: number;
  durationSeconds: number;
  paused: boolean;
}

export interface DesktopAppInfo {
  version: string;
  platform: string;
  serverUrl: string | null;
  discordRichPresence: boolean;
  repositoryUrl: string;
}

export interface DesktopWindowState {
  maximized: boolean;
  fullscreen: boolean;
}

declare global {
  interface Window {
    FLUX_DESKTOP_APP?: boolean;
    FluxDesktop?: {
      isDesktopApp: () => boolean;
      getAppInfo: () => Promise<DesktopAppInfo>;
      getServerConfig: () => Promise<{ serverUrl: string | null }>;
      configureServer: (url: string) => Promise<{ ok: true; serverUrl: string }>;
      changeServer: () => Promise<{ ok: true }>;
      checkForUpdates: () => Promise<{ ok: true }>;
      getWindowState: () => Promise<DesktopWindowState>;
      minimizeWindow: () => Promise<DesktopWindowState>;
      toggleMaximizeWindow: () => Promise<DesktopWindowState>;
      closeWindow: () => Promise<void>;
      setActivity: (presence: DesktopPlaybackPresence) => void;
      clearActivity: () => void;
    };
  }
}

export function isFluxDesktop(): boolean {
  return Boolean(window.FLUX_DESKTOP_APP && window.FluxDesktop?.isDesktopApp());
}

export function setDesktopPlaybackPresence(presence: DesktopPlaybackPresence): void {
  window.FluxDesktop?.setActivity(presence);
}

export function clearDesktopPlaybackPresence(): void {
  window.FluxDesktop?.clearActivity();
}
