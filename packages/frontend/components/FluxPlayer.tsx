'use client';

/**
 * FluxPlayer — a custom, Plex-style HTML5 video player.
 *
 * Playback strategy (reliability first):
 *   1. DIRECT PLAY the original file via the byte-range endpoint. This is
 *      instant, seekable, and works for browser-native containers (MP4/WebM/
 *      H.264+AAC) — the common case.
 *   2. If the browser can't decode the file (MEDIA_ERR_SRC_NOT_SUPPORTED /
 *      DECODE), FALL BACK to the on-demand FFmpeg HLS transcode.
 *
 * UI: big center play/pause, auto-hiding control bar with a scrubbable seek bar
 * (buffered + played), skip ±10s, volume, playback speed, fullscreen, title
 * overlay, spinner, and keyboard shortcuts.
 */
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { api } from '@/lib/api';

interface FluxPlayerProps {
  mediaItemId: string;
  episodeId?: string;
  title: string;
  subtitle?: string;
  startPositionSeconds?: number;
  /** Fill the parent (used for the full-window watch page). */
  fill?: boolean;
  onProgress?: (positionSeconds: number, durationSeconds: number) => void;
  onBack?: () => void;
}

type Mode = 'direct' | 'hls';

function fmt(t: number): string {
  if (!Number.isFinite(t) || t < 0) t = 0;
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const s = Math.floor(t % 60);
  const mm = h > 0 ? String(m).padStart(2, '0') : String(m);
  return `${h > 0 ? h + ':' : ''}${mm}:${String(s).padStart(2, '0')}`;
}

export function FluxPlayer({
  mediaItemId,
  episodeId,
  title,
  subtitle,
  startPositionSeconds = 0,
  fill = false,
  onProgress,
  onBack,
}: FluxPlayerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const hlsRef = useRef<any>(null);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const startedAt = useRef(startPositionSeconds);
  // Last position we saw playing — used to resume in place after a transient
  // direct-play error instead of tearing the session down.
  const lastTimeRef = useRef(0);
  const directRecoverRef = useRef(0);

  const [mode, setMode] = useState<Mode>('direct');
  const [decided, setDecided] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [waiting, setWaiting] = useState(true);
  const [current, setCurrent] = useState(0);
  const [duration, setDuration] = useState(0);
  const [buffered, setBuffered] = useState(0);
  const [volume, setVolume] = useState(1);
  const [muted, setMuted] = useState(false);
  const [rate, setRate] = useState(1);
  const [fullscreen, setFullscreen] = useState(false);
  const [controlsVisible, setControlsVisible] = useState(true);
  const [scrubbing, setScrubbing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // ── Ask the server how to play this file (Plex-style decision) ──────────
  useEffect(() => {
    let cancelled = false;
    setDecided(false);
    api.getPlaybackInfo(mediaItemId, episodeId).then(
      (info) => {
        if (cancelled) return;
        setMode(info.directPlay ? 'direct' : 'hls');
        setDecided(true);
      },
      () => {
        // Probe failed — try direct play; the error handler will fall back.
        if (!cancelled) { setMode('direct'); setDecided(true); }
      },
    );
    return () => { cancelled = true; };
  }, [mediaItemId, episodeId]);

  // ── Source setup (uses the decided mode; direct → hls fallback on error) ─
  useEffect(() => {
    if (!decided) return;
    const video = videoRef.current;
    if (!video) return;
    let destroyed = false;
    setWaiting(true);

    async function attach() {
      if (mode === 'direct') {
        video!.src = api.getStreamUrl(mediaItemId, episodeId);
        video!.load();
        return;
      }
      // HLS mode
      const url = api.getHlsUrl(mediaItemId, episodeId);
      if (video!.canPlayType('application/vnd.apple.mpegurl')) {
        video!.src = url; // Safari native HLS
        return;
      }
      try {
        const Hls = (await import('hls.js')).default;
        if (destroyed) return;
        if (!Hls.isSupported()) {
          setError('Your browser cannot play this video.');
          return;
        }
        const hls = new Hls({
          enableWorker: true,
          lowLatencyMode: false,
          startPosition: 0, // start at the beginning, not the live edge
          // Buffer generously so playback stays well behind the transcode edge;
          // tight caps made it catch up and stall on longer titles.
          maxBufferLength: 60,
          maxMaxBufferLength: 600,
          manifestLoadingMaxRetry: 6,
          manifestLoadingRetryDelay: 1000,
          levelLoadingMaxRetry: 8,
          fragLoadingMaxRetry: 8,
          fragLoadingRetryDelay: 1000,
        });
        hlsRef.current = hls;
        hls.loadSource(url);
        hls.attachMedia(video!);

        // Self-heal. The transcode is produced live, so a fragment hls.js wants
        // may be a beat behind the encoder — back off and resume rather than
        // giving up. Budgets reset on every successfully buffered fragment, so
        // we only surface an error after sustained failure with no progress.
        let netRetry = 0;
        let recover = 0;
        hls.on(Hls.Events.FRAG_BUFFERED, () => {
          netRetry = 0;
          recover = 0;
        });
        hls.on(Hls.Events.ERROR, (_e: string, data: any) => {
          // Diagnostic: if playback still drops, this pinpoints the cause.
          console.warn(
            `[HLS] ${data.fatal ? 'FATAL' : 'warn'} type=${data.type} details=${data.details} code=${data?.response?.code ?? ''}`,
          );
          if (!data.fatal) return;
          const code = data?.response?.code;
          // Only the manifest itself 404ing means there's genuinely no stream.
          if (code === 404 && String(data.details ?? '').startsWith('manifest')) {
            setError('This title has no playable file yet — it may still be downloading or processing.');
            hls.destroy();
            return;
          }
          switch (data.type) {
            case Hls.ErrorTypes.NETWORK_ERROR:
              // Segment not flushed yet or a blip — wait a beat and resume.
              if (netRetry < 30) {
                netRetry += 1;
                setTimeout(() => { try { hls.startLoad(); } catch { /* destroyed */ } }, 1000);
              } else {
                setError('Playback keeps stalling. Retry in a moment.');
                hls.destroy();
              }
              break;
            case Hls.ErrorTypes.MEDIA_ERROR:
              if (recover < 6) { recover += 1; hls.recoverMediaError(); }
              else { setError('Playback keeps stalling. Retry in a moment.'); hls.destroy(); }
              break;
            default:
              setError('Playback error. Please retry.');
              hls.destroy();
          }
        });
      } catch {
        if (!destroyed) setError('Failed to initialize the player.');
      }
    }

    attach();
    return () => {
      destroyed = true;
      if (hlsRef.current) {
        hlsRef.current.destroy();
        hlsRef.current = null;
      }
    };
  }, [decided, mode, mediaItemId, episodeId]);

  // ── Video element event wiring ──────────────────────────────────────────
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const onLoaded = () => {
      setDuration(video.duration || 0);
      // Only resume for direct play — an HLS transcode isn't seekable past the
      // point it has produced yet, so resuming mid-file there causes stalls.
      if (
        mode === 'direct' &&
        startedAt.current > 0 &&
        startedAt.current < (video.duration || Infinity)
      ) {
        video.currentTime = startedAt.current;
        startedAt.current = 0;
      }
      video.playbackRate = rate;
      video.play().catch(() => { /* autoplay may be blocked; user can press play */ });
    };
    const onTime = () => {
      setCurrent(video.currentTime);
      if (video.currentTime > 0) lastTimeRef.current = video.currentTime;
    };
    const onProg = () => {
      if (video.buffered.length) {
        setBuffered(video.buffered.end(video.buffered.length - 1));
      }
    };
    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);
    const onWaiting = () => setWaiting(true);
    const onPlaying = () => {
      setWaiting(false);
      setError(null);
      directRecoverRef.current = 0; // healthy playback resets the recovery budget
    };
    const onVol = () => { setVolume(video.volume); setMuted(video.muted); };
    const onErr = () => {
      const code = video.error?.code;
      console.warn(
        `[Player] video error mode=${mode} code=${code ?? ''} msg=${video.error?.message ?? ''}`,
      );
      if (mode === 'direct') {
        const wasPlaying = lastTimeRef.current > 0;
        // Genuinely undecodable codec that never started → go straight to the
        // transcode. (DECODE=3 / SRC_NOT_SUPPORTED=4 before any playback.)
        if (!wasPlaying && (code === 3 || code === 4)) {
          setMode('hls');
          return;
        }
        // Otherwise it's a transient blip (network hiccup, a dropped range
        // request, a spurious error with no code). Recover direct play IN PLACE
        // by reloading and seeking back — don't nuke a working session into a
        // slow transcode. Bounded so a truly broken file eventually falls back.
        if (directRecoverRef.current < 3) {
          directRecoverRef.current += 1;
          startedAt.current = lastTimeRef.current; // onLoaded seeks back here
          video.src = api.getStreamUrl(mediaItemId, episodeId);
          video.load();
          return;
        }
        setMode('hls'); // repeated direct failures → last-resort transcode
      } else if (mode === 'hls') {
        setError('This file could not be played.');
      }
    };

    video.addEventListener('loadedmetadata', onLoaded);
    video.addEventListener('timeupdate', onTime);
    video.addEventListener('progress', onProg);
    video.addEventListener('play', onPlay);
    video.addEventListener('pause', onPause);
    video.addEventListener('waiting', onWaiting);
    video.addEventListener('playing', onPlaying);
    video.addEventListener('volumechange', onVol);
    video.addEventListener('error', onErr);
    return () => {
      video.removeEventListener('loadedmetadata', onLoaded);
      video.removeEventListener('timeupdate', onTime);
      video.removeEventListener('progress', onProg);
      video.removeEventListener('play', onPlay);
      video.removeEventListener('pause', onPause);
      video.removeEventListener('waiting', onWaiting);
      video.removeEventListener('playing', onPlaying);
      video.removeEventListener('volumechange', onVol);
      video.removeEventListener('error', onErr);
    };
  }, [mode, rate]);

  // ── Periodic progress reporting ─────────────────────────────────────────
  // Save every 5s plus on the events browsers actually deliver reliably: pause,
  // and the page being hidden (tab switch / navigation / mobile background).
  // `beforeunload` alone is routinely dropped, which is why resume points were
  // being lost.
  useEffect(() => {
    if (!onProgress) return;
    const report = () => {
      const v = videoRef.current;
      if (v && v.duration && v.currentTime > 0) onProgress(v.currentTime, v.duration);
    };
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') report();
    };
    const v = videoRef.current;
    const t = setInterval(report, 5000);
    v?.addEventListener('pause', report);
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pagehide', report);
    return () => {
      report();
      clearInterval(t);
      v?.removeEventListener('pause', report);
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pagehide', report);
    };
  }, [onProgress]);

  // ── Fullscreen tracking ─────────────────────────────────────────────────
  useEffect(() => {
    const onFs = () => setFullscreen(document.fullscreenElement === containerRef.current);
    document.addEventListener('fullscreenchange', onFs);
    return () => document.removeEventListener('fullscreenchange', onFs);
  }, []);

  // ── Controls auto-hide ──────────────────────────────────────────────────
  const revealControls = useCallback(() => {
    setControlsVisible(true);
    if (hideTimer.current) clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => {
      if (videoRef.current && !videoRef.current.paused) setControlsVisible(false);
    }, 2800);
  }, []);

  // ── Controls ────────────────────────────────────────────────────────────
  const togglePlay = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) v.play().catch(() => {});
    else v.pause();
    revealControls();
  }, [revealControls]);

  const seekBy = useCallback((delta: number) => {
    const v = videoRef.current;
    if (!v) return;
    v.currentTime = Math.min(Math.max(0, v.currentTime + delta), v.duration || 0);
    revealControls();
  }, [revealControls]);

  const seekTo = useCallback((frac: number) => {
    const v = videoRef.current;
    if (!v || !v.duration) return;
    v.currentTime = Math.min(Math.max(0, frac), 1) * v.duration;
  }, []);

  const toggleMute = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    v.muted = !v.muted;
  }, []);

  const setVol = useCallback((val: number) => {
    const v = videoRef.current;
    if (!v) return;
    v.volume = val;
    v.muted = val === 0;
  }, []);

  const toggleFullscreen = useCallback(() => {
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    else containerRef.current?.requestFullscreen().catch(() => {});
  }, []);

  const cycleRate = useCallback(() => {
    const rates = [0.5, 1, 1.25, 1.5, 2];
    const next = rates[(rates.indexOf(rate) + 1) % rates.length] ?? 1;
    setRate(next);
    if (videoRef.current) videoRef.current.playbackRate = next;
  }, [rate]);

  // ── Seek bar scrubbing ──────────────────────────────────────────────────
  const seekFromPointer = useCallback((clientX: number, el: HTMLElement) => {
    const rect = el.getBoundingClientRect();
    seekTo((clientX - rect.left) / rect.width);
  }, [seekTo]);

  const onSeekDown = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    setScrubbing(true);
    seekFromPointer(e.clientX, e.currentTarget);
  }, [seekFromPointer]);

  const onSeekMove = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    if (!scrubbing) return;
    seekFromPointer(e.clientX, e.currentTarget);
  }, [scrubbing, seekFromPointer]);

  const onSeekUp = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    setScrubbing(false);
    try { e.currentTarget.releasePointerCapture(e.pointerId); } catch { /* ignore */ }
  }, []);

  // ── Keyboard shortcuts ──────────────────────────────────────────────────
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      switch (e.key) {
        case ' ': case 'k': e.preventDefault(); togglePlay(); break;
        case 'ArrowLeft': e.preventDefault(); seekBy(-10); break;
        case 'ArrowRight': e.preventDefault(); seekBy(10); break;
        case 'ArrowUp': e.preventDefault(); setVol(Math.min(1, (videoRef.current?.volume ?? 0) + 0.1)); break;
        case 'ArrowDown': e.preventDefault(); setVol(Math.max(0, (videoRef.current?.volume ?? 0) - 0.1)); break;
        case 'f': toggleFullscreen(); break;
        case 'm': toggleMute(); break;
        default: return;
      }
      revealControls();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [togglePlay, seekBy, setVol, toggleFullscreen, toggleMute, revealControls]);

  const playedPct = duration ? (current / duration) * 100 : 0;
  const bufferedPct = duration ? (buffered / duration) * 100 : 0;

  return (
    <div
      ref={containerRef}
      className={`vp${fill ? ' vp--fill' : ''}${controlsVisible || !playing ? ' show' : ''}${fullscreen ? ' fs' : ''}`}
      onMouseMove={revealControls}
      onMouseLeave={() => playing && setControlsVisible(false)}
    >
      {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
      <video
        ref={videoRef}
        className="vp-video"
        playsInline
        onClick={togglePlay}
        onDoubleClick={toggleFullscreen}
      />

      {/* Top gradient + title */}
      <div className="vp-top">
        {onBack && (
          <button className="vp-icon" onClick={onBack} aria-label="Back">
            <BackIcon />
          </button>
        )}
        <div className="vp-titlewrap">
          <div className="vp-title">{title}</div>
          {subtitle && <div className="vp-subtitle">{subtitle}</div>}
        </div>
      </div>

      {/* Buffering spinner */}
      {waiting && !error && <div className="vp-spinner" />}

      {/* Center play/pause */}
      {!error && (
        <button className="vp-center" onClick={togglePlay} aria-label={playing ? 'Pause' : 'Play'}>
          {playing ? <PauseIcon big /> : <PlayIcon big />}
        </button>
      )}

      {/* Error overlay */}
      {error && (
        <div className="vp-error">
          <p>{error}</p>
          <button className="btn btn-primary" onClick={() => { setError(null); setMode('direct'); }}>
            Retry
          </button>
        </div>
      )}

      {/* Bottom controls */}
      <div className="vp-controls">
        <div
          className={`vp-seek${scrubbing ? ' active' : ''}`}
          onPointerDown={onSeekDown}
          onPointerMove={onSeekMove}
          onPointerUp={onSeekUp}
          role="slider"
          aria-label="Seek"
          aria-valuemin={0}
          aria-valuemax={Math.floor(duration)}
          aria-valuenow={Math.floor(current)}
          tabIndex={0}
        >
          <div className="vp-seek-track">
            <div className="vp-seek-buffered" style={{ width: `${bufferedPct}%` }} />
            <div className="vp-seek-played" style={{ width: `${playedPct}%` }} />
            <div className="vp-seek-thumb" style={{ left: `${playedPct}%` }} />
          </div>
        </div>

        <div className="vp-row">
          <button className="vp-icon" onClick={togglePlay} aria-label={playing ? 'Pause' : 'Play'}>
            {playing ? <PauseIcon /> : <PlayIcon />}
          </button>
          <button className="vp-icon" onClick={() => seekBy(-10)} aria-label="Back 10 seconds">
            <Back10 />
          </button>
          <button className="vp-icon" onClick={() => seekBy(10)} aria-label="Forward 10 seconds">
            <Fwd10 />
          </button>

          <div className="vp-vol">
            <button className="vp-icon" onClick={toggleMute} aria-label={muted ? 'Unmute' : 'Mute'}>
              {muted || volume === 0 ? <MuteIcon /> : <VolIcon />}
            </button>
            <input
              className="vp-vol-slider"
              type="range"
              min={0} max={1} step={0.05}
              value={muted ? 0 : volume}
              onChange={(e) => setVol(Number(e.target.value))}
              aria-label="Volume"
            />
          </div>

          <div className="vp-time">
            {fmt(current)} <span className="vp-time-sep">/</span> {fmt(duration)}
          </div>

          <div className="vp-spacer" />

          <button className="vp-rate" onClick={cycleRate} aria-label="Playback speed">
            {rate}×
          </button>
          <button className="vp-icon" onClick={toggleFullscreen} aria-label="Fullscreen">
            {fullscreen ? <FsExitIcon /> : <FsIcon />}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ── Icons ─────────────────────────────────────────────────────────────── */
const s = (big?: boolean) => ({ width: big ? 34 : 20, height: big ? 34 : 20 });
const PlayIcon = ({ big }: { big?: boolean }) => (
  <svg viewBox="0 0 24 24" fill="currentColor" style={s(big)}><path d="M8 5v14l11-7z" /></svg>
);
const PauseIcon = ({ big }: { big?: boolean }) => (
  <svg viewBox="0 0 24 24" fill="currentColor" style={s(big)}><path d="M6 5h4v14H6zM14 5h4v14h-4z" /></svg>
);
const Back10 = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={s()}><path d="M11 4 4 9l7 5V4z" /><path d="M20 5a9 9 0 1 1-9-1" /></svg>
);
const Fwd10 = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={s()}><path d="M13 4l7 5-7 5V4z" /><path d="M4 5a9 9 0 1 0 9-1" /></svg>
);
const VolIcon = () => (
  <svg viewBox="0 0 24 24" fill="currentColor" style={s()}><path d="M4 9v6h4l5 5V4L8 9H4z" /><path d="M16 8a4 4 0 0 1 0 8" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>
);
const MuteIcon = () => (
  <svg viewBox="0 0 24 24" fill="currentColor" style={s()}><path d="M4 9v6h4l5 5V4L8 9H4z" /><path d="M22 9l-6 6M16 9l6 6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>
);
const FsIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={s()}><path d="M8 3H3v5M16 3h5v5M21 16v5h-5M3 16v5h5" /></svg>
);
const FsExitIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={s()}><path d="M8 3v5H3M16 3v5h5M21 16h-5v5M3 16h5v5" /></svg>
);
const BackIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={s()}><path d="M19 12H5M12 19l-7-7 7-7" /></svg>
);
