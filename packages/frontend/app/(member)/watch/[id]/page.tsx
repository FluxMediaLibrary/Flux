'use client';

import { useEffect, useState, useCallback } from 'react';
import { useParams, useSearchParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { api } from '@/lib/api';
import { FluxPlayer } from '@/components/FluxPlayer';
import type { MediaItemDetailDTO } from '@flux/shared';

export default function WatchPage() {
  const { id } = useParams<{ id: string }>();
  const searchParams = useSearchParams();
  const router = useRouter();
  const episodeParam = searchParams.get('episode') ?? undefined;

  const [item, setItem] = useState<MediaItemDetailDTO | null>(null);
  const [target, setTarget] = useState<{ episodeId?: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Load metadata
  useEffect(() => {
    let cancelled = false;
    api.getMediaItem(id).then(
      (data) => { if (!cancelled) setItem(data); },
      (err) => { if (!cancelled) setError(err?.message ?? 'Failed to load'); },
    );
    return () => { cancelled = true; };
  }, [id]);

  // Resolve what to play. A show opened at its root (no ?episode=) has no
  // movie-level file, so play its first available episode instead of 404-ing.
  useEffect(() => {
    if (episodeParam) { setTarget({ episodeId: episodeParam }); return; }
    if (!item) return;
    if (item.type === 'MOVIE') { setTarget({}); return; }
    const firstPlayable = item.episodes?.find((e) => e.available);
    if (firstPlayable) setTarget({ episodeId: firstPlayable.id });
    else setError('No episodes are available to play yet.');
  }, [item, episodeParam]);

  const activeEpisodeId = target?.episodeId;
  const activeEpisode = activeEpisodeId
    ? item?.episodes?.find((e) => e.id === activeEpisodeId)
    : undefined;

  const handleProgress = useCallback(
    (position: number, durationSeconds: number) => {
      if (!Number.isFinite(position) || position <= 0) return;
      // HLS reports Infinity/NaN for duration — omit it rather than send a
      // value that serializes to null and 400s the whole save.
      const duration =
        Number.isFinite(durationSeconds) && durationSeconds > 0
          ? durationSeconds
          : undefined;
      api.saveProgress({
        mediaItemId: activeEpisodeId ? undefined : id,
        episodeId: activeEpisodeId,
        positionSeconds: position,
        durationSeconds: duration,
      }).catch(() => { /* best-effort */ });
    },
    [id, activeEpisodeId],
  );

  // Resume position: episode-level for shows, movie-level otherwise. Skip when
  // the last session already completed the title (start fresh from 0).
  const resumeProgress = activeEpisodeId ? activeEpisode?.progress : item?.progress;
  const startPosition =
    resumeProgress && !resumeProgress.completed
      ? resumeProgress.positionSeconds
      : 0;

  if (error) {
    return (
      <div className="centered-viewport">
        <div className="form-error" style={{ marginBottom: 16 }}>{error}</div>
        <div style={{ display: 'flex', gap: 10 }}>
          <button className="btn btn-primary" onClick={() => window.location.reload()}>
            Retry
          </button>
          <Link href={`/library/${id}`} className="btn btn-ghost">Back to details</Link>
        </div>
      </div>
    );
  }

  if (!target) {
    return (
      <div className="centered-viewport">
        <div className="spinner" />
        <p className="muted">Loading…</p>
      </div>
    );
  }

  return (
    <div className="watch-stage">
      <FluxPlayer
        key={activeEpisodeId ?? 'movie'}
        mediaItemId={id}
        episodeId={activeEpisodeId}
        title={item?.title ?? 'Now playing'}
        subtitle={
          activeEpisode
            ? `S${activeEpisode.season} · E${activeEpisode.episode}${activeEpisode.title ? ` · ${activeEpisode.title}` : ''}`
            : undefined
        }
        season={activeEpisode?.season}
        startPositionSeconds={startPosition}
        fill
        onProgress={handleProgress}
        onBack={() => router.push(`/library/${id}`)}
      />
    </div>
  );
}
