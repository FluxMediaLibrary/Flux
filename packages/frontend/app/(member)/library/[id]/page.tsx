'use client';

import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { api } from '@/lib/api';
import type {
  EpisodeDTO,
  MediaItemDetailDTO,
  TmdbDetail,
  TmdbEpisode,
} from '@flux/shared';

const BACKDROP_BASE = 'https://image.tmdb.org/t/p/w1280';
const STILL_BASE = 'https://image.tmdb.org/t/p/w454';
const PROFILE_BASE = 'https://image.tmdb.org/t/p/w185';

/** A library episode enriched with TMDb still/synopsis metadata by number. */
interface DisplayEpisode extends EpisodeDTO {
  stillPath: string | null;
  displayTitle: string;
  displayOverview: string | null;
  displayRuntime: number | null;
}

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
  // Per-season TMDb episode metadata (stills, synopses), fetched lazily and cached.
  const [seasonMeta, setSeasonMeta] = useState<Record<number, TmdbEpisode[]>>({});

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
    const bySeason = new Map<number, EpisodeDTO[]>();
    for (const ep of item.episodes) {
      if (!bySeason.has(ep.season)) bySeason.set(ep.season, []);
      bySeason.get(ep.season)!.push(ep);
    }
    for (const list of bySeason.values()) {
      list.sort((a, b) => a.episode - b.episode);
    }
    return Array.from(bySeason.entries()).sort((a, b) => a[0] - b[0]);
  }, [item]);

  useEffect(() => {
    if (selectedSeason === null && seasons.length > 0) {
      setSelectedSeason(seasons[0][0]);
    }
  }, [seasons, selectedSeason]);

  // Fetch TMDb episode metadata for the active season once (cached in seasonMeta).
  useEffect(() => {
    if (!item || item.type !== 'SHOW' || selectedSeason === null) return;
    if (seasonMeta[selectedSeason] !== undefined) return;
    const controller = new AbortController();
    api
      .tmdbSeason(item.tmdbId, selectedSeason, controller.signal)
      .then((eps) =>
        setSeasonMeta((prev) => ({ ...prev, [selectedSeason]: eps })),
      )
      .catch(() => {
        /* best-effort — tiles fall back to the show backdrop */
      });
    return () => controller.abort();
  }, [item, selectedSeason, seasonMeta]);

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

  const localEpisodes =
    seasons.find(([s]) => s === selectedSeason)?.[1] ?? seasons[0]?.[1] ?? [];
  const activeSeason = seasons.find(([s]) => s === selectedSeason)?.[0] ?? seasons[0]?.[0];
  const metaForSeason =
    activeSeason !== undefined ? seasonMeta[activeSeason] : undefined;

  const activeEpisodes: DisplayEpisode[] = localEpisodes.map((ep) => {
    const meta = metaForSeason?.find((m) => m.episodeNumber === ep.episode);
    return {
      ...ep,
      stillPath: meta?.stillPath ?? null,
      displayTitle: meta?.name ?? ep.title ?? `Episode ${ep.episode}`,
      displayOverview: ep.overview ?? meta?.overview ?? null,
      displayRuntime: ep.runtime ?? meta?.runtime ?? null,
    };
  });

  const fallbackStill = item.backdropPath
    ? `${BACKDROP_BASE}${item.backdropPath}`
    : null;

  return (
    <div className="nfx-detail">
      {/* ── Cinematic hero ─────────────────────────────────────────────── */}
      <div className="nfx-hero">
        {item.backdropPath ? (
          <img
            src={`${BACKDROP_BASE}${item.backdropPath}`}
            alt=""
            className="nfx-hero-bg"
          />
        ) : (
          <div className="nfx-hero-bg nfx-hero-bg--ph" />
        )}
        <div className="nfx-hero-scrim" />
        <div className="nfx-hero-scrim-left" />

        <div className="nfx-hero-content">
          <h1 className="nfx-title">{item.title}</h1>

          <div className="nfx-meta">
            {item.year && <span>{item.year}</span>}
            {voteAverage !== null && (
              <span className="nfx-match">{Math.round(voteAverage * 10)}% Match</span>
            )}
            {runtime && <span>{formatRuntime(runtime)}</span>}
            {isShow && (
              <span>
                {seasons.length} Season{seasons.length === 1 ? '' : 's'}
              </span>
            )}
            <span className="nfx-hd">HD</span>
          </div>

          <div className="nfx-actions">
            {hasProgress ? (
              <Link href={`/watch/${item.id}`} className="nfx-btn nfx-btn--play">
                <PlayIcon />
                Resume{progressPct > 0 ? ` · ${progressPct}%` : ''}
              </Link>
            ) : (
              <Link href={`/watch/${item.id}`} className="nfx-btn nfx-btn--play">
                <PlayIcon />
                Play
              </Link>
            )}
            {hasProgress && (
              <span className="nfx-resume-note">
                {formatSeconds(item.progress!.positionSeconds)} watched
              </span>
            )}
          </div>

          {item.overview && <p className="nfx-overview">{item.overview}</p>}

          {item.genres.length > 0 && (
            <p className="nfx-genres">
              <span className="nfx-genres-label">Genres:</span>{' '}
              {item.genres.join(', ')}
            </p>
          )}
        </div>
      </div>

      <div className="page nfx-body">
        {/* ── Episodes ─────────────────────────────────────────────────── */}
        {isShow && seasons.length > 0 && (
          <section className="nfx-section">
            <div className="nfx-eps-head">
              <h2 className="nfx-section-title">Episodes</h2>
              {seasons.length > 1 ? (
                <select
                  className="nfx-season-select"
                  value={selectedSeason ?? seasons[0][0]}
                  onChange={(e) => setSelectedSeason(Number(e.target.value))}
                  aria-label="Select season"
                >
                  {seasons.map(([season, eps]) => (
                    <option key={season} value={season}>
                      Season {season} ({eps.length})
                    </option>
                  ))}
                </select>
              ) : (
                <span className="nfx-season-static">Season {seasons[0][0]}</span>
              )}
            </div>

            <div className="nfx-eps">
              {activeEpisodes.map((ep) => {
                const still = ep.stillPath
                  ? `${STILL_BASE}${ep.stillPath}`
                  : fallbackStill;
                const inner = (
                  <>
                    <div className="nfx-ep-thumb">
                      {still ? (
                        <img src={still} alt="" loading="lazy" />
                      ) : (
                        <div className="nfx-ep-thumb--ph">{ep.episode}</div>
                      )}
                      {ep.available && (
                        <div className="nfx-ep-thumb-play">
                          <PlayIcon />
                        </div>
                      )}
                      {!ep.available && (
                        <div className="nfx-ep-thumb-lock">Unavailable</div>
                      )}
                    </div>

                    <div className="nfx-ep-body">
                      <div className="nfx-ep-head">
                        <span className="nfx-ep-num">{ep.episode}</span>
                        <span className="nfx-ep-title">{ep.displayTitle}</span>
                        {ep.displayRuntime && (
                          <span className="nfx-ep-runtime">
                            {ep.displayRuntime}m
                          </span>
                        )}
                      </div>
                      {ep.displayOverview && (
                        <p className="nfx-ep-overview">{ep.displayOverview}</p>
                      )}
                    </div>
                  </>
                );

                return ep.available ? (
                  <Link
                    key={ep.id}
                    href={`/watch/${item.id}?episode=${ep.id}`}
                    className="nfx-ep nfx-ep--playable"
                  >
                    {inner}
                  </Link>
                ) : (
                  <div key={ep.id} className="nfx-ep nfx-ep--disabled">
                    {inner}
                  </div>
                );
              })}
            </div>
          </section>
        )}

        {/* ── Cast ─────────────────────────────────────────────────────── */}
        {cast.length > 0 && (
          <section className="nfx-section">
            <h2 className="nfx-section-title">Cast</h2>
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
                  {c.character && <div className="cast-role">{c.character}</div>}
                </div>
              ))}
            </div>
          </section>
        )}
      </div>
    </div>
  );
}

function PlayIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M8 5v14l11-7z" />
    </svg>
  );
}
