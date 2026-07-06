'use client';

/**
 * Google Cast (Chromecast) sender integration.
 *
 * The Cast Web Sender SDK only exists in Chromium browsers (Chrome, Edge,
 * Android Chrome). We lazy-load it once, initialise a CastContext against the
 * default media receiver, and expose a small React hook so the video player can:
 *   - know whether a cast device is reachable (`available`)
 *   - know whether we're currently connected (`connected` + `deviceName`)
 *   - open the device picker (`requestSession`)
 *   - load / control the current title on the TV (`loadMedia`, `play`, ...)
 *
 * Everything is a module-level singleton so multiple hook consumers share one
 * context and one set of listeners.
 *
 * NOTE: the Chromecast fetches the media URL itself, so the backend must be
 * reachable from the TV (same LAN / public host) and — in production — served
 * over HTTPS, which the default receiver requires.
 */
import { useEffect, useState } from 'react';

const SDK_SRC = 'https://www.gstatic.com/cv/js/sender/v1/cast_sender.js?loadCastFramework=1';

export interface CastMedia {
  url: string;
  contentType: string; // e.g. 'video/mp4' or 'application/x-mpegURL'
  title: string;
  subtitle?: string;
  poster?: string;
  currentTime?: number;
}

export interface CastState {
  /** SDK ready AND at least one cast device is on the network. */
  available: boolean;
  /** A session is connected to a device. */
  connected: boolean;
  /** Friendly name of the connected device, when any. */
  deviceName: string | null;
  /** True while media is loaded on the receiver. */
  hasMedia: boolean;
  isPlaying: boolean;
  currentTime: number;
  duration: number;
}

type Listener = (s: CastState) => void;

// Ambient globals injected by the SDK.
declare global {
  interface Window {
    __onGCastApiAvailable?: (isAvailable: boolean) => void;
    cast?: any;
    chrome?: any;
  }
}

let loaded = false;
let ready = false;
let remotePlayer: any = null;
let remoteController: any = null;

const listeners = new Set<Listener>();

const state: CastState = {
  available: false,
  connected: false,
  deviceName: null,
  hasMedia: false,
  isPlaying: false,
  currentTime: 0,
  duration: 0,
};

function emit() {
  const snapshot = { ...state };
  listeners.forEach((l) => l(snapshot));
}

function castNs() {
  return typeof window !== 'undefined' ? window.cast : undefined;
}
function chromeNs() {
  return typeof window !== 'undefined' ? window.chrome : undefined;
}

function refreshFromContext() {
  const cast = castNs();
  if (!cast?.framework) return;
  const context = cast.framework.CastContext.getInstance();
  const castState = context.getCastState(); // 'NO_DEVICES_AVAILABLE' | 'NOT_CONNECTED' | 'CONNECTING' | 'CONNECTED'
  state.available = castState !== 'NO_DEVICES_AVAILABLE';
  state.connected = castState === 'CONNECTED';
  const session = context.getCurrentSession();
  state.deviceName = session?.getCastDevice?.()?.friendlyName ?? null;
  emit();
}

function wireRemotePlayer() {
  const cast = castNs();
  if (!cast?.framework || remotePlayer) return;
  remotePlayer = new cast.framework.RemotePlayer();
  remoteController = new cast.framework.RemotePlayerController(remotePlayer);
  const RPET = cast.framework.RemotePlayerEventType;
  remoteController.addEventListener(RPET.IS_CONNECTED_CHANGED, refreshFromContext);
  remoteController.addEventListener(RPET.MEDIA_INFO_CHANGED, () => {
    state.hasMedia = !!remotePlayer.mediaInfo;
    state.duration = remotePlayer.duration || 0;
    emit();
  });
  remoteController.addEventListener(RPET.IS_PAUSED_CHANGED, () => {
    state.isPlaying = !remotePlayer.isPaused;
    emit();
  });
  remoteController.addEventListener(RPET.CURRENT_TIME_CHANGED, () => {
    state.currentTime = remotePlayer.currentTime || 0;
    emit();
  });
}

function initContext() {
  const cast = castNs();
  const chrome = chromeNs();
  if (!cast?.framework || !chrome?.cast) return;
  const context = cast.framework.CastContext.getInstance();
  context.setOptions({
    receiverApplicationId: chrome.cast.media.DEFAULT_MEDIA_RECEIVER_APP_ID,
    autoJoinPolicy: chrome.cast.AutoJoinPolicy.ORIGIN_SCOPED,
  });
  context.addEventListener(
    cast.framework.CastContextEventType.CAST_STATE_CHANGED,
    refreshFromContext,
  );
  context.addEventListener(
    cast.framework.CastContextEventType.SESSION_STATE_CHANGED,
    refreshFromContext,
  );
  wireRemotePlayer();
  ready = true;
  refreshFromContext();
}

/** Inject the SDK script once. Safe to call repeatedly. */
function ensureLoaded() {
  if (loaded || typeof window === 'undefined') return;
  loaded = true;
  window.__onGCastApiAvailable = (isAvailable: boolean) => {
    if (isAvailable) initContext();
  };
  // If the framework is somehow already present, init directly.
  if (window.cast?.framework) {
    initContext();
    return;
  }
  const script = document.createElement('script');
  script.src = SDK_SRC;
  script.async = true;
  document.head.appendChild(script);
}

/** Open the native device-picker dialog and connect. */
export async function requestSession(): Promise<void> {
  const cast = castNs();
  if (!cast?.framework) return;
  try {
    await cast.framework.CastContext.getInstance().requestSession();
  } catch {
    // User dismissed the picker or no device chosen — nothing to do.
  }
}

/** Disconnect from the current device (stops playback on the TV). */
export function endSession(): void {
  const cast = castNs();
  if (!cast?.framework) return;
  cast.framework.CastContext.getInstance().endCurrentSession(true);
}

/** Load a title onto the connected receiver. Requires an active session. */
export async function loadMedia(media: CastMedia): Promise<void> {
  const cast = castNs();
  const chrome = chromeNs();
  if (!cast?.framework || !chrome?.cast) return;
  const session = cast.framework.CastContext.getInstance().getCurrentSession();
  if (!session) return;

  const mediaInfo = new chrome.cast.media.MediaInfo(media.url, media.contentType);
  mediaInfo.streamType = chrome.cast.media.StreamType.BUFFERED;
  const meta = new chrome.cast.media.GenericMediaMetadata();
  meta.title = media.title;
  if (media.subtitle) meta.subtitle = media.subtitle;
  if (media.poster) meta.images = [new chrome.cast.Image(media.poster)];
  mediaInfo.metadata = meta;

  const request = new chrome.cast.media.LoadRequest(mediaInfo);
  if (media.currentTime) request.currentTime = media.currentTime;
  await session.loadMedia(request);
}

export function play(): void {
  if (remotePlayer?.isPaused) remoteController?.playOrPause();
}
export function pause(): void {
  if (remotePlayer && !remotePlayer.isPaused) remoteController?.playOrPause();
}
export function seek(seconds: number): void {
  if (!remotePlayer) return;
  remotePlayer.currentTime = seconds;
  remoteController?.seek();
}

/** React hook: subscribe to cast state. Ensures the SDK is loaded on mount. */
export function useCast(): CastState {
  const [snap, setSnap] = useState<CastState>({ ...state });
  useEffect(() => {
    ensureLoaded();
    if (ready) refreshFromContext();
    const listener: Listener = (s) => setSnap(s);
    listeners.add(listener);
    setSnap({ ...state });
    return () => {
      listeners.delete(listener);
    };
  }, []);
  return snap;
}
