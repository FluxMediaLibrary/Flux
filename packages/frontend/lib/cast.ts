// @ts-nocheck — the Google Cast SDK types conflict with @types/chrome shiped by Vidstack.
// The cast functionality is gated behind runtime SDK availability checks; the `any`
// types used here are safe because the SDK is loaded dynamically and never at build time.

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
  streamType?: 'BUFFERED' | 'LIVE' | 'OTHER';
  title: string;
  subtitle?: string;
  poster?: string;
  currentTime?: number;
  durationSeconds?: number | null;
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
  lastError: string | null;
}

type Listener = (s: CastState) => void;

// Ambient globals injected by the SDK.
// The cast SDK adds these to the window object at runtime. Use loose types to avoid
// conflicts with @types/chrome declarations that ship with type checking.
declare global {
  interface Window {
    __onGCastApiAvailable?: ((available: boolean) => void) | undefined;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    cast?: any;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
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
  lastError: null,
};

function log(message: string, details?: unknown) {
  if (details === undefined) console.info(`[Cast] ${message}`);
  else console.info(`[Cast] ${message}`, details);
}

function warn(message: string, details?: unknown) {
  if (details === undefined) console.warn(`[Cast] ${message}`);
  else console.warn(`[Cast] ${message}`, details);
}

function fail(message: string, details?: unknown) {
  state.lastError = message;
  if (details === undefined) console.error(`[Cast] ${message}`);
  else console.error(`[Cast] ${message}`, details);
  emit();
}

function redactToken(url: string): string {
  try {
    const parsed = new URL(url);
    if (parsed.searchParams.has('token')) parsed.searchParams.set('token', '[redacted]');
    return parsed.toString();
  } catch {
    return url;
  }
}

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
  log('state changed', { castState, deviceName: state.deviceName });
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
    log('media info changed', {
      hasMedia: state.hasMedia,
      duration: state.duration,
      contentId: remotePlayer.mediaInfo?.contentId,
      contentType: remotePlayer.mediaInfo?.contentType,
    });
    emit();
  });
  remoteController.addEventListener(RPET.IS_PAUSED_CHANGED, () => {
    state.isPlaying = !remotePlayer.isPaused;
    log('playback state changed', { isPlaying: state.isPlaying });
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
  log('context initialized', {
    receiverApplicationId: chrome.cast.media.DEFAULT_MEDIA_RECEIVER_APP_ID,
    autoJoinPolicy: chrome.cast.AutoJoinPolicy.ORIGIN_SCOPED,
  });
  context.addEventListener(
    cast.framework.CastContextEventType.CAST_STATE_CHANGED,
    refreshFromContext,
  );
  context.addEventListener(
    cast.framework.CastContextEventType.SESSION_STATE_CHANGED,
    (event: any) => {
      log('session state changed', {
        sessionState: event.sessionState,
        errorCode: event.errorCode,
      });
      if (event.errorCode) fail(`Session failed: ${event.errorCode}`, event);
      refreshFromContext();
    },
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
    log('SDK availability callback', { isAvailable });
    if (isAvailable) initContext();
    else fail('Google Cast Web Sender SDK is not available in this browser');
  };
  // If the framework is somehow already present, init directly.
  if (window.cast?.framework) {
    initContext();
    return;
  }
  const script = document.createElement('script');
  script.src = SDK_SRC;
  script.async = true;
  script.onerror = () => fail('Failed to load Google Cast Web Sender SDK', { src: SDK_SRC });
  log('loading SDK', { src: SDK_SRC });
  document.head.appendChild(script);
}

/** Open the native device-picker dialog and connect. */
export async function requestSession(): Promise<void> {
  const cast = castNs();
  if (!cast?.framework) {
    fail('Cannot request Cast session before SDK initialization');
    return;
  }
  try {
    log('requesting session');
    await cast.framework.CastContext.getInstance().requestSession();
  } catch (error) {
    // User dismissed the picker or no device chosen — nothing to do.
    warn('session request did not connect', error);
  }
}

/** Disconnect from the current device (stops playback on the TV). */
export function endSession(): void {
  const cast = castNs();
  if (!cast?.framework) return;
  log('ending current session');
  cast.framework.CastContext.getInstance().endCurrentSession(true);
}

/** Load a title onto the connected receiver. Requires an active session. */
export async function loadMedia(media: CastMedia): Promise<void> {
  const cast = castNs();
  const chrome = chromeNs();
  if (!cast?.framework || !chrome?.cast) {
    fail('Cannot load media before Cast SDK initialization');
    return;
  }
  const session = cast.framework.CastContext.getInstance().getCurrentSession();
  if (!session) {
    fail('Cannot load media because there is no active Cast session');
    return;
  }

  const mediaInfo = new chrome.cast.media.MediaInfo(media.url, media.contentType);
  mediaInfo.contentUrl = media.url;
  mediaInfo.streamType = chrome.cast.media.StreamType[media.streamType ?? 'BUFFERED'];
  if (media.durationSeconds && media.durationSeconds > 0) {
    mediaInfo.duration = media.durationSeconds;
  }
  const meta = new chrome.cast.media.GenericMediaMetadata();
  meta.title = media.title;
  if (media.subtitle) meta.subtitle = media.subtitle;
  if (media.poster) meta.images = [new chrome.cast.Image(media.poster)];
  mediaInfo.metadata = meta;

  const request = new chrome.cast.media.LoadRequest(mediaInfo);
  if (media.currentTime) request.currentTime = media.currentTime;
  request.autoplay = true;
  log('loading media on receiver', {
    title: media.title,
    contentType: media.contentType,
    streamType: media.streamType ?? 'BUFFERED',
    currentTime: request.currentTime ?? 0,
    url: redactToken(media.url),
  });
  try {
    await session.loadMedia(request);
    state.lastError = null;
    log('receiver accepted media load');
    emit();
  } catch (error) {
    fail('Receiver rejected media load', error);
    throw error;
  }
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
