'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { api } from '@/lib/api';
import type { MediaItemDetailDTO } from '@flux/shared';

const POSTER_BASE = 'https://image.tmdb.org/t/p/w342';
const BACKDROP_BASE = 'https://image.tmdb.org/t/p/w1280';

function formatSeconds(s: number): string {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

export default function LibraryDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [item, setItem] = useState<MediaItemDetailDTO | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const data = await api.getMediaItem(id);
        if (!cancelled) setItem(data);
      } catch (err: any) {
        if (!cancelled) setError(err.message ?? 'Failed to load');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, [id]);

  if (loading) {
    return (
      <div className="centered-viewport">
        <div className="spinner" />
        <p className="muted">Loading...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="centered-viewport">
        <div className="form-error">{error}</div>
        <button className="btn btn-primary" onClick={() => window.location.reload()}>
          Retry
        </button>
      </div>
    );
  }

  if (!item) {
    return (
      <div className="centered-viewport">
        <p className="muted">Not found</p>
      </div>
    );
  }

  const isShow = item.type === 'SHOW';
  const hasProgress = item.progress && item.progress.positionSeconds > 0;
  const progressPct = hasProgress && item.progress!.durationSeconds
    ? Math.round((item.progress!.positionSeconds / item.progress!.durationSeconds) * 100)
    : 0;

  return (
    <div>
      {/* Backdrop hero */}
      <div className="detail-hero">
        {item.backdropPath ? (
          <img
            src={`${BACKDROP_BASE}${item.backdropPath}`}
            alt=""
            className="detail-backdrop"
          />
        ) : (
          <div className="detail-backdrop detail-backdrop--placeholder" />
        )}
        <div className="detail-hero-overlay">
          <h1 className="detail-title">{item.title}</h1>
          <div className="detail-meta">
            {item.year && <span>{item.year}</span>}
            {item.genres.length > 0 && <span>{item.genres.join(', ')}</span>}
            {item.type === 'SHOW' && item.episodes && (
              <span>{item.episodes.filter((e) => e.available).length} episodes</span>
            )}
          </div>
          {item.overview && <p className="detail-overview">{item.overview}</p>}
          <div className="detail-actions">
            {hasProgress ? (
              <>
                <Link
                  href={`/watch/${item.id}`}
                  className="btn btn-primary"
                >
                  ▶ Resume{progressPct > 0 ? ` (${progressPct}%)` : ''}
                </Link>
                <span className="muted" style={{ fontSize: '0.85rem' }}>
                  {formatSeconds(item.progress!.positionSeconds)} watched
                </span>
              </>
            ) : (
              <Link
                href={`/watch/${item.id}`}
                className="btn btn-primary"
              >
                ▶ Play{isShow ? ' show' : ''}
              </Link>
            )}
          </div>
        </div>
      </div>

      {/* Episodes (TV) */}
      {isShow && item.episodes && item.episodes.length > 0 && (
        <div className="episodes-section" style={{ marginTop: 32 }}>
          {(() => {
            const bySeason = new Map<number, typeof item.episodes>();
            for (const ep of item.episodes!) {
              if (!bySeason.has(ep.season)) bySeason.set(ep.season, []);
              bySeason.get(ep.season)!.push(ep);
            }
            return Array.from(bySeason.entries()).map(([season, episodes]) => (
              <div key={season} className="season-group" style={{ marginBottom: 28 }}>
                <h2 style={{ fontSize: '1.15rem', marginBottom: 12 }}>Season {season}</h2>
                <div className="episodes-list">
                  {episodes.map((ep) => (
                    <div key={ep.id} className="episode-row">
                      <span className="episode-num">
                        {ep.episode}
                      </span>
                      <div className="episode-info">
                        <span className="episode-title">
                          {ep.title ?? `Episode ${ep.episode}`}
                        </span>
                        {ep.overview && (
                          <span className="episode-overview">{ep.overview}</span>
                        )}
                      </div>
                      {ep.available ? (
                        <Link
                          href={`/watch/${item.id}?episode=${ep.id}`}
                          className="btn btn-ghost"
                          style={{ padding: '6px 14px', fontSize: '0.85rem', flexShrink: 0 }}
                        >
                          ▶ Play
                        </Link>
                      ) : (
                        <span className="tag" style={{ opacity: 0.5, flexShrink: 0 }}>Unavailable</span>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            ));
          })()}
        </div>
      )}
    </div>
  );
}
