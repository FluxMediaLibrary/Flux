'use client';

import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { api } from '@/lib/api';
import type { MediaItemDetailDTO, TmdbDetail } from '@flux/shared';

const BACKDROP_BASE = 'https://image.tmdb.org/t/p/w1280';
const POSTER_BASE = 'https://image.tmdb.org/t/p/w342';
const PROFILE_BASE = 'https://image.tmdb.org/t/p/w185';

function formatRuntime(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h > 0) return m > 0 ? `${h}h ${m}m` : `${h}h`;
  return `${m}m`;
}

function formatSeconds(s: number): string {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

export default function LibraryDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [item, setItem] = useState<MediaItemDetailDTO | null>(null);
  const [detail, setDetail] = useState<TmdbDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedSeason, setSelectedSeason] = useState<number | null>(null);

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
    return () => {
      cancelled = true;
    };
  }, [id]);

  useEffect(() => {
    if (!item) return;
    const controller = new AbortController();
    api
      .tmdbDetail(item.type, item.tmdbId, controller.signal)
      .then((d) => setDetail(d))
      .catch(() => {
        /* best-effort */
      });
    return () => controller.abort();
  }, [item]);

  const seasons = useMemo(() => {
    if (!item?.episodes) return [];
    const bySeason = new Map<number, NonNullable<typeof item.episodes>>();
    for (const ep of item.episodes) {
      if (!bySeason.has(ep.season)) bySeason.set(ep.season, []);
      bySeason.get(ep.season)!.push(ep);
    }
    return Array.from(bySeason.entries()).sort((a, b) => a[0] - b[0]);
  }, [item]);

  useEffect(() => {
    if (selectedSeason === null && seasons.length > 0) {
      setSelectedSeason(seasons[0][0]);
    }
  }, [seasons, selectedSeason]);

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
  const progressPct =
    hasProgress && item.progress!.durationSeconds
      ? Math.round(
          (item.progress!.positionSeconds / item.progress!.durationSeconds) * 100,
        )
      : 0;

  const runtime = detail?.runtime ?? null;
  const voteAverage = detail?.voteAverage ?? null;
  const cast = detail?.cast ?? [];
  const activeEpisodes =
    seasons.find(([s]) => s === selectedSeason)?.[1] ??
    seasons[0]?.[1] ??
    [];

  return (
    <div>
      {/* Backdrop hero — full-width */}
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
        <div className="detail-hero-overlay" />
      </div>

      <div className="page">
        {/* Poster + info section */}
        <div className="detail-header">
          <div className="detail-poster-wrap">
            {item.posterPath ? (
              <img
                src={`${POSTER_BASE}${item.posterPath}`}
                alt={item.title}
                className="detail-poster"
              />
            ) : (
              <div className="detail-poster detail-poster--ph">
                <span>{item.title.charAt(0)}</span>
              </div>
            )}
          </div>

          <div className="detail-info">
            <h1 className="detail-title">{item.title}</h1>

            <div className="detail-badges">
              {item.year && <span className="detail-badge">{item.year}</span>}
              {runtime && (
                <span className="detail-badge">{formatRuntime(runtime)}</span>
              )}
              {isShow && item.episodes && (
                <span className="detail-badge">
                  {item.episodes.filter((e) => e.available).length} episodes
                </span>
              )}
              {voteAverage !== null && (
                <span className="detail-badge rating">
                  ★ {voteAverage.toFixed(1)}
                </span>
              )}
              {item.genres.map((g) => (
                <span className="detail-badge" key={g}>
                  {g}
                </span>
              ))}
            </div>

            {item.overview && (
              <p className="detail-overview">{item.overview}</p>
            )}

            <div className="detail-actions">
              {hasProgress ? (
                <>
                  <Link href={`/watch/${item.id}`} className="btn btn-primary">
                    ▶ Resume{progressPct > 0 ? ` (${progressPct}%)` : ''}
                  </Link>
                  <span className="muted" style={{ fontSize: '0.85rem' }}>
                    {formatSeconds(item.progress!.positionSeconds)} watched
                  </span>
                </>
              ) : (
                <Link href={`/watch/${item.id}`} className="btn btn-primary">
                  ▶ Play{isShow ? '' : ''}
                </Link>
              )}
            </div>
          </div>
        </div>

        {/* Cast — horizontal rail */}
        {cast.length > 0 && (
          <section className="cast-section">
            <h2 className="section-label">Cast</h2>
            <div className="cast-rail">
              {cast.slice(0, 20).map((c, i) => (
                <div className="cast-card" key={`${c.name}-${i}`}>
                  {c.profilePath ? (
                    <img
                      src={`${PROFILE_BASE}${c.profilePath}`}
                      alt={c.name}
                      className="cast-avatar"
                      loading="lazy"
                    />
                  ) : (
                    <div className="cast-avatar cast-avatar--ph">
                      {c.name.charAt(0).toUpperCase()}
                    </div>
                  )}
                  <div className="cast-name">{c.name}</div>
                  {c.character && (
                    <div className="cast-role">{c.character}</div>
                  )}
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Episodes — TV only */}
        {isShow && seasons.length > 0 && (
          <section className="episodes-section">
            <h2 className="section-label">Episodes</h2>

            {/* Season tabs */}
            <div className="season-tabs">
              {seasons.map(([season]) => (
                <button
                  key={season}
                  className={`season-tab${selectedSeason === season ? ' active' : ''}`}
                  onClick={() => setSelectedSeason(season)}
                >
                  Season {season}
                </button>
              ))}
            </div>

            {/* Episode list */}
            <div className="episodes-list">
              {activeEpisodes.map((ep) => (
                <div key={ep.id} className="episode-row">
                  <span className="episode-num">{ep.episode}</span>
                  <div className="episode-info">
                    <div className="episode-head">
                      <span className="episode-title">
                        {ep.title ?? `Episode ${ep.episode}`}
                      </span>
                      {ep.runtime && (
                        <span className="episode-duration">{ep.runtime}m</span>
                      )}
                    </div>
                    {ep.overview && (
                      <p className="episode-overview">{ep.overview}</p>
                    )}
                  </div>
                  {ep.available ? (
                    <Link
                      href={`/watch/${item.id}?episode=${ep.id}`}
                      className="episode-play-btn"
                      aria-label={`Play episode ${ep.episode}`}
                    >
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M8 5v14l11-7z" />
                      </svg>
                    </Link>
                  ) : (
                    <span className="episode-unavailable">Unavailable</span>
                  )}
                </div>
              ))}
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
