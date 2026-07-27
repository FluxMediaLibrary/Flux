'use client';

import { useCallback, useEffect, useState } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { api } from '@/lib/api';
import { FluxPlayer } from '@/components/FluxPlayer';
import type { EpisodeDTO, MediaItemDetailDTO } from '@flux/shared';

function episodeSubtitle(episode: Pick<EpisodeDTO, 'season' | 'episode'>): string {
  return `S${episode.season} E${episode.episode}`;
}

function findNextPlayableEpisode(
  episodes: EpisodeDTO[] | undefined,
  currentEpisodeId: string | undefined,
): EpisodeDTO | null {
  if (!episodes || !currentEpisodeId) return null;
  const currentIndex = episodes.findIndex((episode) => episode.id === currentEpisodeId);
  if (currentIndex < 0) return null;
  return episodes.slice(currentIndex + 1).find((episode) => episode.available) ?? null;
}

export default function WatchPage() {
  const { id } = useParams<{ id: string }>();
  const searchParams = useSearchParams();
  const router = useRouter();
  const episodeParam = searchParams.get('episode') ?? undefined;

  const [item, setItem] = useState<MediaItemDetailDTO | null>(null);
  const [target, setTarget] = useState<{ episodeId?: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api.getMediaItem(id).then(
      (data) => { if (!cancelled) setItem(data); },
      (err) => { if (!cancelled) setError(err?.message ?? 'Failed to load'); },
    );
    return () => { cancelled = true; };
  }, [id]);

  useEffect(() => {
    if (episodeParam) {
      setTarget({ episodeId: episodeParam });
      return;
    }
    if (!item) return;
    if (item.type === 'MOVIE') {
      setTarget({});
      return;
    }
    const firstPlayable = item.episodes?.find((episode) => episode.available);
    if (firstPlayable) setTarget({ episodeId: firstPlayable.id });
    else setError('No episodes are available to play yet.');
  }, [item, episodeParam]);

  const activeEpisodeId = target?.episodeId;
  const activeEpisode = activeEpisodeId
    ? item?.episodes?.find((episode) => episode.id === activeEpisodeId)
    : undefined;
  const nextEpisode = findNextPlayableEpisode(item?.episodes, activeEpisodeId);
  const nextEpisodePrompt = nextEpisode
    ? {
        title: nextEpisode.title || `Episode ${nextEpisode.episode}`,
        subtitle: episodeSubtitle(nextEpisode),
      }
    : null;

  const handleNearEnd = useCallback(() => {
    if (!item || !activeEpisodeId) return;
    const next = findNextPlayableEpisode(item.episodes, activeEpisodeId);
    if (next?.id) api.getPlaybackInfo(id, next.id).catch(() => {});
  }, [id, item, activeEpisodeId]);

  const handleNextEpisode = useCallback(() => {
    if (!nextEpisode) return;
    router.replace(`/watch/${id}?episode=${encodeURIComponent(nextEpisode.id)}`);
  }, [id, nextEpisode, router]);

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
        <p className="muted">Loading...</p>
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
            ? `${episodeSubtitle(activeEpisode)}${activeEpisode.title ? ` - ${activeEpisode.title}` : ''}`
            : undefined
        }
        startPositionSeconds={startPosition}
        fill
        onNearEnd={handleNearEnd}
        nextEpisode={nextEpisodePrompt}
        nextEpisodeMarkers={activeEpisode?.playbackMarkers ?? item?.playbackMarkers}
        onNextEpisode={nextEpisode ? handleNextEpisode : undefined}
        onBack={() => router.push(`/library/${id}`)}
      />
    </div>
  );
}
