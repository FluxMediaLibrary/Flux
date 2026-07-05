'use client';

import { useEffect, useState, useCallback, useRef, type ReactNode } from 'react';
import Link from 'next/link';
import { useAuth } from '@/lib/auth-context';
import { api } from '@/lib/api';
import { useAmbient } from '@/components/AmbientBackdrop';
import type { HomeRowsDTO, MediaItemDTO } from '@flux/shared';

const POSTER_BASE = 'https://image.tmdb.org/t/p/w342';
const BACKDROP_BASE = 'https://image.tmdb.org/t/p/w1280';

/** Horizontally-scrollable rail with hover arrows. */
function Rail({ title, children }: { title: string; children: ReactNode }) {
  const railRef = useRef<HTMLDivElement>(null);
  const [atStart, setAtStart] = useState(true);
  const [atEnd, setAtEnd] = useState(false);

  const updateEdges = useCallback(() => {
    const el = railRef.current;
    if (!el) return;
    setAtStart(el.scrollLeft <= 4);
    setAtEnd(el.scrollLeft + el.clientWidth >= el.scrollWidth - 4);
  }, []);

  useEffect(() => {
    updateEdges();
    const el = railRef.current;
    if (!el) return;
    el.addEventListener('scroll', updateEdges, { passive: true });
    window.addEventListener('resize', updateEdges);
    return () => {
      el.removeEventListener('scroll', updateEdges);
      window.removeEventListener('resize', updateEdges);
    };
  }, [updateEdges]);

  const scroll = useCallback((dir: -1 | 1) => {
    const el = railRef.current;
    if (!el) return;
    // ~3 card widths (card 160 + gap 14).
    el.scrollBy({ left: dir * 3 * 174, behavior: 'smooth' });
  }, []);

  return (
    <section className="row">
      <h2>{title}</h2>
      <div className="rail-wrap">
        <button
          type="button"
          className="rail-arrow left"
          aria-label="Scroll left"
          onClick={() => scroll(-1)}
          disabled={atStart}
        >
          ‹
        </button>
        <div className="rail" ref={railRef}>
          {children}
        </div>
        <button
          type="button"
          className="rail-arrow right"
          aria-label="Scroll right"
          onClick={() => scroll(1)}
          disabled={atEnd}
        >
          ›
        </button>
      </div>
    </section>
  );
}

export default function HomePage() {
  const { activeProfile } = useAuth();
  const [data, setData] = useState<HomeRowsDTO | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchHome = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await api.homepage();
      setData(result);
    } catch (err: any) {
      setError(err.message ?? 'Failed to load homepage');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchHome(); }, [fetchHome]);

  // Ambient backdrop — must run before any early return (hook order).
  const featuredBackdrop =
    data?.recentlyAdded.find((m) => m.backdropPath)?.backdropPath ??
    data?.continueWatching.find((c) => c.mediaItem.backdropPath)?.mediaItem
      .backdropPath ??
    data?.byGenre.flatMap((g) => g.items).find((m) => m.backdropPath)
      ?.backdropPath ??
    null;
  useAmbient(featuredBackdrop);

  if (loading) {
    return (
      <div className="page">
        <h1 style={{ fontSize: '1.9rem', marginBottom: 4 }}>
          Welcome back{activeProfile ? `, ${activeProfile.name}` : ''}
        </h1>
        {['Continue Watching', 'Recently Added', 'Genre'].map((title) => (
          <section className="row" key={title}>
            <h2>{title}</h2>
            <div className="rail">
              {Array.from({ length: 8 }).map((_, i) => (
                <div className="poster-skel" key={i} />
              ))}
            </div>
          </section>
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <div className="page">
        <h1 style={{ fontSize: '1.9rem', marginBottom: 4 }}>Home</h1>
        <div className="form-error">{error}</div>
        <button className="btn btn-primary" onClick={fetchHome} style={{ marginTop: 12 }}>
          Retry
        </button>
      </div>
    );
  }

  if (!data) return null;

  const { continueWatching, recentlyAdded, byGenre } = data;
  const hasContent = continueWatching.length > 0 || recentlyAdded.length > 0 || byGenre.length > 0;

  // Featured hero — first item with a backdrop, preferring recently added.
  const featured: MediaItemDTO | null =
    recentlyAdded.find((m) => m.backdropPath) ??
    continueWatching.find((c) => c.mediaItem.backdropPath)?.mediaItem ??
    byGenre.flatMap((g) => g.items).find((m) => m.backdropPath) ??
    recentlyAdded[0] ??
    continueWatching[0]?.mediaItem ??
    byGenre[0]?.items[0] ??
    null;

  return (
    <div className="page">
      {featured && (
        <div className="disc-hero">
          <div className="disc-hero-bg">
            {featured.backdropPath ? (
              <img src={`${BACKDROP_BASE}${featured.backdropPath}`} alt="" />
            ) : (
              <div className="disc-hero-bg--ph" style={{ width: '100%', height: '100%' }} />
            )}
          </div>
          <div className="disc-hero-content">
            <span className="disc-hero-kicker">★ Featured</span>
            <h1 className="disc-hero-title">{featured.title}</h1>
            <div className="disc-hero-meta">
              {featured.year && <span>{featured.year}</span>}
              <span>{featured.type === 'SHOW' ? 'TV Series' : 'Movie'}</span>
              {featured.genres.length > 0 && (
                <span>{featured.genres.slice(0, 3).join(' · ')}</span>
              )}
            </div>
            {featured.overview && (
              <p className="disc-hero-overview">{featured.overview}</p>
            )}
            <div className="disc-hero-actions">
              <Link href={`/watch/${featured.id}`} className="btn btn-primary">
                ▶ Play
              </Link>
              <Link href={`/library/${featured.id}`} className="btn btn-ghost">
                View details
              </Link>
            </div>
          </div>
        </div>
      )}

      <h1 style={{ fontSize: '1.5rem', marginBottom: 20 }}>
        Welcome back{activeProfile ? `, ${activeProfile.name}` : ''}
      </h1>

      {!hasContent && (
        <p className="muted" style={{ marginTop: 32, textAlign: 'center' }}>
          Nothing in the library yet. Browse and request something.
        </p>
      )}

      {continueWatching.length > 0 && (
        <Rail title="Continue Watching">
          {continueWatching.map((item) => (
            <Link
              key={item.mediaItem.id}
              href={`/watch/${item.mediaItem.id}`}
              className="poster-card"
            >
              <div className="poster-img-wrap">
                {item.mediaItem.posterPath ? (
                  <img
                    src={`${POSTER_BASE}${item.mediaItem.posterPath}`}
                    alt={item.mediaItem.title}
                    className="poster-img"
                    loading="lazy"
                  />
                ) : (
                  <div className="poster-img poster-img--placeholder" />
                )}
                {item.progress.durationSeconds && item.progress.durationSeconds > 0 && (
                  <div className="progress-bar-wrap">
                    <div
                      className="progress-bar-fill"
                      style={{
                        width: `${Math.min(
                          100,
                          (item.progress.positionSeconds / item.progress.durationSeconds) * 100,
                        )}%`,
                      }}
                    />
                  </div>
                )}
              </div>
              <p className="poster-title">{item.mediaItem.title}</p>
              {item.episode && (
                <p className="poster-sub">
                  S{item.episode.season} E{item.episode.episode}
                  {item.episode.title ? ` - ${item.episode.title}` : ''}
                </p>
              )}
            </Link>
          ))}
        </Rail>
      )}

      {recentlyAdded.length > 0 && (
        <Rail title="Recently Added">
          {recentlyAdded.map((item) => (
            <Link key={item.id} href={`/library/${item.id}`} className="poster-card">
              <div className="poster-img-wrap">
                {item.posterPath ? (
                  <img
                    src={`${POSTER_BASE}${item.posterPath}`}
                    alt={item.title}
                    className="poster-img"
                    loading="lazy"
                  />
                ) : (
                  <div className="poster-img poster-img--placeholder" />
                )}
              </div>
              <p className="poster-title">{item.title}</p>
              {item.year && <p className="poster-sub">{item.year}</p>}
            </Link>
          ))}
        </Rail>
      )}

      {byGenre.map(({ genre, items }) => (
        <Rail title={genre} key={genre}>
          {items.map((item) => (
            <Link key={item.id} href={`/library/${item.id}`} className="poster-card">
              <div className="poster-img-wrap">
                {item.posterPath ? (
                  <img
                    src={`${POSTER_BASE}${item.posterPath}`}
                    alt={item.title}
                    className="poster-img"
                    loading="lazy"
                  />
                ) : (
                  <div className="poster-img poster-img--placeholder" />
                )}
              </div>
              <p className="poster-title">{item.title}</p>
              {item.year && <p className="poster-sub">{item.year}</p>}
            </Link>
          ))}
        </Rail>
      ))}
    </div>
  );
}
