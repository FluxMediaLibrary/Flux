'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { api } from '@/lib/api';
import type { MediaItemDetailDTO } from '@flux/shared';

/** What we've decided to play: a specific episode, or the movie itself. */
type PlayTarget = { episodeId?: string };

export default function WatchPage() {
  const { id } = useParams<{ id: string }>();
  const searchParams = useSearchParams();
  const episodeParam = searchParams.get('episode') ?? undefined;

  const videoRef = useRef<HTMLVideoElement>(null);
  const hlsRef = useRef<any>(null);
  const [item, setItem] = useState<MediaItemDetailDTO | null>(null);
  const [target, setTarget] = useState<PlayTarget | null>(null);
  const [buffering, setBuffering] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [resumeMsg, setResumeMsg] = useState<string | null>(null);
  const progressTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  // Load metadata
  useEffect(() => {
    let cancelled = false;
    api.getMediaItem(id).then(
      (data) => { if (!cancelled) setItem(data); },
      (err) => { if (!cancelled) setError(err.message ?? 'Failed to load'); },
    );
    return () => { cancelled = true; };
  }, [id]);

  // Resolve what to play. A show opened at its root (no ?episode=) has no
  // movie-level file, so pick the first available episode instead of 404-ing.
  useEffect(() => {
    if (episodeParam) {
      setTarget({ episodeId: episodeParam });
      return;
    }
    if (!item) return; // wait for metadata

    if (item.type === 'MOVIE') {
      setTarget({});
      return;
    }

    const firstPlayable = item.episodes?.find((e) => e.available);
    if (firstPlayable) {
      setTarget({ episodeId: firstPlayable.id });
    } else {
      setError('No episodes are available to play yet.');
    }
  }, [item, episodeParam]);

  const activeEpisodeId = target?.episodeId;

  // Set up HLS player once we know the target
  useEffect(() => {
    if (!target || !videoRef.current) return;

    const hlsUrl = api.getHlsUrl(id, target.episodeId);
    if (!hlsUrl) return;

    let hls: any = null;
    let destroyed = false;

    function fail(data: any) {
      const code = data?.response?.code;
      const details = String(data?.details ?? '');
      if (code === 404) {
        setError(
          'This title has no playable file yet — it may still be downloading or processing.',
        );
      } else if (code === 401 || code === 403) {
        setError('Session expired. Go back and re-open the title to refresh access.');
      } else if (details.startsWith('manifestLoad')) {
        setError(
          'Could not start the stream. The server may still be transcoding — retry in a moment.',
        );
      } else {
        setError('Playback error. Please retry.');
      }
    }

    async function setup() {
      try {
        const Hls = (await import('hls.js')).default;
        if (destroyed) return;

        if (Hls.isSupported()) {
          hls = new Hls();
          hlsRef.current = hls;
          hls.loadSource(hlsUrl);
          hls.attachMedia(videoRef.current!);

          hls.on(Hls.Events.ERROR, (_event: string, data: any) => {
            if (data.fatal) fail(data);
          });
        } else if (videoRef.current!.canPlayType('application/vnd.apple.mpegurl')) {
          videoRef.current!.src = hlsUrl;
        } else {
          setError('Your browser does not support HLS playback.');
        }
      } catch (err: any) {
        if (!destroyed) setError(err.message ?? 'Failed to initialize player');
      }
    }

    setup();

    return () => {
      destroyed = true;
      if (hls) hls.destroy();
      hlsRef.current = null;
    };
  }, [id, target]);

  // Resume from saved position
  useEffect(() => {
    if (!videoRef.current || !item) return;

    const progress = item.progress;
    if (progress && progress.positionSeconds > 0 && !progress.completed) {
      if (videoRef.current.readyState >= 2) {
        videoRef.current.currentTime = progress.positionSeconds;
      } else {
        const onLoaded = () => {
          videoRef.current!.currentTime = progress.positionSeconds ?? 0;
          videoRef.current!.removeEventListener('loadedmetadata', onLoaded);
        };
        videoRef.current.addEventListener('loadedmetadata', onLoaded);
      }
      setResumeMsg(`Resuming from ${formatTime(progress.positionSeconds)}`);
      setTimeout(() => setResumeMsg(null), 3000);
    }
  }, [item]);

  // Progress reporting
  const reportProgress = useCallback(() => {
    if (!videoRef.current || !id) return;
    const v = videoRef.current;
    if (v.duration && v.currentTime > 0) {
      api.saveProgress({
        mediaItemId: activeEpisodeId ? undefined : id,
        episodeId: activeEpisodeId,
        positionSeconds: v.currentTime,
        durationSeconds: v.duration,
      }).catch(() => { /* best-effort */ });
    }
  }, [id, activeEpisodeId]);

  useEffect(() => {
    progressTimer.current = setInterval(reportProgress, 5000);
    const v = videoRef.current;
    const onPause = () => reportProgress();
    const onUnload = () => reportProgress();

    v?.addEventListener('pause', onPause);
    window.addEventListener('beforeunload', onUnload);

    return () => {
      if (progressTimer.current) clearInterval(progressTimer.current);
      v?.removeEventListener('pause', onPause);
      window.removeEventListener('beforeunload', onUnload);
    };
  }, [reportProgress]);

  if (error) {
    return (
      <div className="centered-viewport">
        <div className="form-error" style={{ marginBottom: 16 }}>{error}</div>
        <div style={{ display: 'flex', gap: 10 }}>
          <button className="btn btn-primary" onClick={() => window.location.reload()}>
            Retry
          </button>
          <Link href={`/library/${id}`} className="btn btn-ghost">
            Back to details
          </Link>
        </div>
      </div>
    );
  }

  const activeEpisode = activeEpisodeId
    ? item?.episodes?.find((e) => e.id === activeEpisodeId)
    : undefined;

  return (
    <div style={{ maxWidth: 1200, margin: '0 auto', padding: '24px 24px 64px' }}>
      <div className="player-topbar">
        <Link href={`/library/${id}`} className="player-back">
          ‹ Back
        </Link>
        {item && (
          <h2 style={{ margin: 0, fontSize: '1.2rem' }}>
            {item.title}
            {activeEpisode
              ? ` — S${activeEpisode.season} E${activeEpisode.episode}`
              : ''}
          </h2>
        )}
      </div>

      <div className="player-wrap">
        {resumeMsg && <div className="resume-toast">{resumeMsg}</div>}
        {buffering && (
          <div className="player-loading-overlay">
            <div className="spinner" />
            <p>Preparing stream…</p>
          </div>
        )}
        <video
          ref={videoRef}
          controls
          autoPlay
          playsInline
          className="player-video"
          onPlaying={() => setBuffering(false)}
          onWaiting={() => setBuffering(true)}
          onError={() => setError('Video failed to load')}
        />
      </div>
    </div>
  );
}

function formatTime(s: number): string {
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${String(sec).padStart(2, '0')}`;
}
