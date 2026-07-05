'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { useAuth } from '@/lib/auth-context';
import { api } from '@/lib/api';
import type { HomeRowsDTO } from '@flux/shared';

const POSTER_BASE = 'https://image.tmdb.org/t/p/w342';

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

  if (loading) {
    return (
      <div>
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
      <div>
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

  return (
    <div>
      <h1 style={{ fontSize: '1.9rem', marginBottom: 4 }}>
        Welcome back{activeProfile ? `, ${activeProfile.name}` : ''}
      </h1>

      {!hasContent && (
        <p className="muted" style={{ marginTop: 32, textAlign: 'center' }}>
          Nothing in the library yet. Browse and request something.
        </p>
      )}

      {continueWatching.length > 0 && (
        <section className="row">
          <h2>Continue Watching</h2>
          <div className="rail">
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
          </div>
        </section>
      )}

      {recentlyAdded.length > 0 && (
        <section className="row">
          <h2>Recently Added</h2>
          <div className="rail">
            {recentlyAdded.map((item) => (
              <Link
                key={item.id}
                href={`/library/${item.id}`}
                className="poster-card"
              >
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
          </div>
        </section>
      )}

      {byGenre.map(({ genre, items }) => (
        <section className="row" key={genre}>
          <h2>{genre}</h2>
          <div className="rail">
            {items.map((item) => (
              <Link
                key={item.id}
                href={`/library/${item.id}`}
                className="poster-card"
              >
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
          </div>
        </section>
      ))}
    </div>
  );
}
