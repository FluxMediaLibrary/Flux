'use client';

import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { api } from '@/lib/api';
import type { MediaItemDetailDTO, TmdbDetail } from '@flux/shared';

const BACKDROP_BASE = 'https://image.tmdb.org/t/p/w1280';
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

  // ── Load the library item ─────────────────────────────────────────────────
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

  // ── Enrich with TMDb detail (cast, runtime, rating, trailer) ──────────────
  useEffect(() => {
    if (!item) return;
    const controller = new AbortController();
    api
      .tmdbDetail(item.type, item.tmdbId, controller.signal)
      .then((d) => setDetail(d))
      .catch(() => {
        // Best-effort enrichment — cast/runtime just won't render.
      });
    return () => controller.abort();
  }, [item]);

  // ── Episodes grouped by season ────────────────────────────────────────────
  const seasons = useMemo(() => {
    if (!item?.episodes) return [];
    const bySeason = new Map<number, NonNullable<typeof item.episodes>>();
    for (const ep of item.episodes) {
      if (!bySeason.has(ep.season)) bySeason.set(ep.season, []);
      bySeason.get(ep.season)!.push(ep);
    }
    return Array.from(bySeason.entries()).sort((a, b) => a[0] - b[0]);
  }, [item]);

  // Default the season switcher to the first season once episodes are known.
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

          {item.overview && <p className="detail-overview">{item.overview}</p>}

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
                ▶ Play{isShow ? ' show' : ''}
              </Link>
            )}
          </div>
        </div>
      </div>

      <div className="detail-body">
        {/* Cast */}
        {cast.length > 0 && (
          <section style={{ marginBottom: 36 }}>
            <h2 style={{ fontSize: '1.2rem', marginBottom: 4 }}>Cast</h2>
            <div className="detail-cast">
              {cast.slice(0, 12).map((c, i) => (
                <div className="cast-member" key={`${c.name}-${i}`}>
                  {c.profilePath ? (
                    <img
                      src={`${PROFILE_BASE}${c.profilePath}`}
                      alt={c.name}
                      className="cast-avatar"
                      loading="lazy"
                    />
                  ) : (
                    <div className="cast-avatar cast-avatar-ph">
                      {c.name.charAt(0).toUpperCase()}
                    </div>
                  )}
                  <div className="cast-name">{c.name}</div>
                  {c.character && <div className="cast-role">{c.character}</div>}
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Episodes (TV) */}
        {isShow && seasons.length > 0 && (
          <section className="episodes-section">
            <h2 style={{ fontSize: '1.2rem', marginBottom: 14 }}>Episodes</h2>

            {seasons.length > 1 && (
              <div className="season-select toggle-group">
                {seasons.map(([season]) => (
                  <button
                    key={season}
                    className={`toggle${selectedSeason === season ? ' active' : ''}`}
                    onClick={() => setSelectedSeason(season)}
                  >
                    Season {season}
                  </button>
                ))}
              </div>
            )}

            <div className="episodes-list">
              {activeEpisodes.map((ep) => (
                <div key={ep.id} className="episode-row">
                  <span className="episode-num">{ep.episode}</span>
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
                      style={{
                        padding: '6px 14px',
                        fontSize: '0.85rem',
                        flexShrink: 0,
                      }}
                    >
                      ▶ Play
                    </Link>
                  ) : (
                    <span
                      className="tag"
                      style={{ opacity: 0.5, flexShrink: 0 }}
                    >
                      Unavailable
                    </span>
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
