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
      api.saveProgress({
        mediaItemId: activeEpisodeId ? undefined : id,
        episodeId: activeEpisodeId,
        positionSeconds: position,
        durationSeconds,
      }).catch(() => { /* best-effort */ });
    },
    [id, activeEpisodeId],
  );

  // Movie-level resume (episode progress isn't in this DTO).
  const startPosition =
    !activeEpisodeId && item?.progress && !item.progress.completed
      ? item.progress.positionSeconds
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
    <div style={{ maxWidth: 1280, margin: '0 auto', padding: '20px 20px 56px' }}>
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
        startPositionSeconds={startPosition}
        onProgress={handleProgress}
        onBack={() => router.push(`/library/${id}`)}
      />
    </div>
  );
}
