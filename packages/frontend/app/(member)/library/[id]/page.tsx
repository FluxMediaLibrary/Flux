'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { api, FluxApiError } from '@/lib/api';
import type {
  EpisodeDTO,
  MediaItemDetailDTO,
  RequestDTO,
  RequestStatus,
  TmdbDetail,
  TmdbEpisode,
} from '@flux/shared';

const BACKDROP_BASE = 'https://image.tmdb.org/t/p/w1280';
// TMDb serves stills only at w92 / w185 / w300 / original — w300 is the tile size.
const STILL_BASE = 'https://image.tmdb.org/t/p/w300';
const PROFILE_BASE = 'https://image.tmdb.org/t/p/w185';
const POSTER_BASE = 'https://image.tmdb.org/t/p/w342';

/** A library episode enriched with TMDb still/synopsis metadata by number. */
interface DisplayEpisode extends EpisodeDTO {
  stillPath: string | null;
  displayTitle: string;
  displayOverview: string | null;
  displayRuntime: number | null;
}

function episodeRequestKey(season: number, episode: number): string {
  return `${season}:${episode}`;
}

function requestStatusLabel(status: RequestStatus): string {
  switch (status) {
    case 'PENDING':
      return 'Requested';
    case 'APPROVED':
      return 'Approved';
    case 'DOWNLOADING':
      return 'Downloading';
    case 'FULFILLED':
      return 'Available';
    case 'REJECTED':
      return 'Rejected';
  }
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
  const sec = Math.floor(s % 60);
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${sec}s`;
  return `${sec}s`;
}

function formatMoney(value: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(value);
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
  const [episodeRequests, setEpisodeRequests] = useState<Map<string, RequestStatus>>(new Map());
  const [requestingEpisodes, setRequestingEpisodes] = useState<Set<string>>(new Set());
  const [requestError, setRequestError] = useState<string | null>(null);

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

  useEffect(() => {
    if (!item || item.type !== 'SHOW') {
      setEpisodeRequests(new Map());
      return;
    }

    const controller = new AbortController();
    api.listMyRequests(controller.signal).then(
      (requests: RequestDTO[]) => {
        if (controller.signal.aborted) return;
        const next = new Map<string, RequestStatus>();
        for (const request of requests) {
          if (
            request.tmdbId === item.tmdbId &&
            request.mediaType === 'SHOW' &&
            request.season &&
            request.episode &&
            request.status !== 'REJECTED'
          ) {
            next.set(episodeRequestKey(request.season, request.episode), request.status);
          }
        }
        setEpisodeRequests(next);
      },
      () => {
        if (!controller.signal.aborted) setEpisodeRequests(new Map());
      },
    );

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

  const requestEpisode = useCallback(
    async (episode: Pick<EpisodeDTO, 'season' | 'episode' | 'available'>) => {
      if (!item || item.type !== 'SHOW' || episode.available) return;
      const key = episodeRequestKey(episode.season, episode.episode);
      setRequestingEpisodes((prev) => new Set(prev).add(key));
      setRequestError(null);
      try {
        const request = await api.createRequest({
          tmdbId: item.tmdbId,
          mediaType: 'SHOW',
          title: item.title,
          season: episode.season,
          episode: episode.episode,
        });
        setEpisodeRequests((prev) => new Map(prev).set(key, request.status));
      } catch (err) {
        setRequestError(
          err instanceof FluxApiError ? err.message : 'Failed to request episode.',
        );
      } finally {
        setRequestingEpisodes((prev) => {
          const next = new Set(prev);
          next.delete(key);
          return next;
        });
      }
    },
    [item],
  );

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
  const crew = detail?.crew ?? [];
  const reviews = detail?.reviews ?? [];
  const similar = detail?.similar ?? [];

  // For shows: resume the most-recently-watched in-progress episode; otherwise
  // start the first available one. Movies use the movie-level progress above.
  const resumeEpisode = isShow
    ? (item.episodes ?? [])
        .filter(
          (e) =>
            e.available &&
            e.progress &&
            !e.progress.completed &&
            e.progress.positionSeconds > 0,
        )
        .sort((a, b) =>
          (b.progress!.updatedAt ?? '').localeCompare(a.progress!.updatedAt ?? ''),
        )[0] ?? null
    : null;
  const firstAvailableEpisode = isShow
    ? (item.episodes ?? []).find((e) => e.available) ?? null
    : null;
  const canPlayTitle = isShow ? firstAvailableEpisode !== null : true;

  // Unified hero play/resume target.
  let playHref = `/watch/${item.id}`;
  let playLabel = 'Play';
  let resumeNote: string | null = null;
  if (isShow) {
    if (resumeEpisode) {
      playHref = `/watch/${item.id}?episode=${resumeEpisode.id}`;
      playLabel = `Resume S${resumeEpisode.season} · E${resumeEpisode.episode}`;
    } else if (firstAvailableEpisode) {
      playHref = `/watch/${item.id}?episode=${firstAvailableEpisode.id}`;
    } else {
      playLabel = 'Unavailable';
      resumeNote = 'No episode files have been added yet';
    }
  } else if (hasProgress) {
    playLabel = `Resume${progressPct > 0 ? ` · ${progressPct}%` : ''}`;
    resumeNote = `${formatSeconds(item.progress!.positionSeconds)} watched`;
  }

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
            {detail?.ageRating && <span>{detail.ageRating}</span>}
            {isShow && (
              <span>
                {seasons.length} Season{seasons.length === 1 ? '' : 's'}
              </span>
            )}
            <span className="nfx-hd">HD</span>
          </div>

          <div className="nfx-actions">
            {canPlayTitle ? (
              <Link href={playHref} className="nfx-btn nfx-btn--play">
                <PlayIcon />
                {playLabel}
              </Link>
            ) : (
              <span className="nfx-btn nfx-btn--disabled" aria-disabled="true">
                <PlayIcon />
                {playLabel}
              </span>
            )}
            {resumeNote && (
              <span className="nfx-resume-note">{resumeNote}</span>
            )}
          </div>

          {item.overview && <p className="nfx-overview">{item.overview}</p>}
          {detail?.tagline && <p className="nfx-tagline">{detail.tagline}</p>}

          {item.genres.length > 0 && (
            <p className="nfx-genres">
              <span className="nfx-genres-label">Genres:</span>{' '}
              {item.genres.join(', ')}
            </p>
          )}
        </div>
      </div>

      <div className="page nfx-body">
        <section className="nfx-section nfx-facts">
          <div className="nfx-fact-grid">
            {detail?.status && <Fact label="Status" value={detail.status} />}
            {detail?.studios?.length ? <Fact label="Studio" value={detail.studios.join(', ')} /> : null}
            {detail?.spokenLanguages?.length ? <Fact label="Languages" value={detail.spokenLanguages.join(', ')} /> : null}
            {detail?.countries?.length ? <Fact label="Countries" value={detail.countries.join(', ')} /> : null}
            {detail?.imdbId && <Fact label="IMDb" value={detail.imdbId} />}
            {detail?.budget ? <Fact label="Budget" value={formatMoney(detail.budget)} /> : null}
            {detail?.revenue ? <Fact label="Revenue" value={formatMoney(detail.revenue)} /> : null}
          </div>
        </section>

        {detail?.trailerYoutubeKey && (
          <section className="nfx-section">
            <h2 className="nfx-section-title">Trailer</h2>
            <div className="nfx-trailer">
              <iframe
                src={`https://www.youtube.com/embed/${detail.trailerYoutubeKey}`}
                title={`${item.title} trailer`}
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                allowFullScreen
              />
            </div>
          </section>
        )}
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
            {requestError && <div className="form-error">{requestError}</div>}

            <div className="nfx-eps">
              {activeEpisodes.map((ep) => {
                const still = ep.stillPath
                  ? `${STILL_BASE}${ep.stillPath}`
                  : fallbackStill;
                const requestKey = episodeRequestKey(ep.season, ep.episode);
                const requestStatus = episodeRequests.get(requestKey) ?? null;
                const requesting = requestingEpisodes.has(requestKey);
                const inner = (
                  <>
                    <div className="nfx-ep-thumb">
                      {still ? (
                        <img
                          src={still}
                          alt=""
                          loading="lazy"
                          onError={(e) => {
                            const img = e.currentTarget;
                            // A missing still falls back to the show backdrop,
                            // then hides itself so the placeholder shows through.
                            if (fallbackStill && img.src !== fallbackStill) {
                              img.src = fallbackStill;
                            } else {
                              img.style.display = 'none';
                            }
                          }}
                        />
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
                      {ep.progress &&
                        !ep.progress.completed &&
                        ep.progress.positionSeconds > 0 &&
                        ep.progress.durationSeconds != null && (
                          <div className="nfx-ep-bar">
                            <div
                              className="nfx-ep-bar-fill"
                              style={{
                                width: `${Math.min(
                                  100,
                                  (ep.progress.positionSeconds /
                                    ep.progress.durationSeconds) *
                                    100,
                                )}%`,
                              }}
                            />
                          </div>
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
                      {!ep.available && (
                        <div className="nfx-ep-request">
                          {requestStatus ? (
                            <span className={`nfx-ep-request-status status-${requestStatus.toLowerCase()}`}>
                              {requestStatusLabel(requestStatus)}
                            </span>
                          ) : (
                            <button
                              type="button"
                              className="nfx-ep-request-btn"
                              onClick={() => void requestEpisode(ep)}
                              disabled={requesting}
                            >
                              {requesting ? 'Requesting...' : 'Request episode'}
                            </button>
                          )}
                        </div>
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

        {crew.length > 0 && (
          <section className="nfx-section">
            <h2 className="nfx-section-title">Crew</h2>
            <div className="nfx-crew-grid">
              {crew.map((member, i) => (
                <div className="nfx-crew-card" key={`${member.name}-${member.job}-${i}`}>
                  <span className="nfx-crew-job">{member.job}</span>
                  <span className="nfx-crew-name">{member.name}</span>
                </div>
              ))}
            </div>
          </section>
        )}

        {reviews.length > 0 && (
          <section className="nfx-section">
            <h2 className="nfx-section-title">Reviews</h2>
            <div className="nfx-review-rail">
              {reviews.map((review, i) => (
                <article className="nfx-review" key={`${review.author}-${i}`}>
                  <div className="nfx-review-head">
                    <strong>{review.author}</strong>
                    {review.rating !== null && <span>{review.rating}/10</span>}
                  </div>
                  <p>{review.content}</p>
                </article>
              ))}
            </div>
          </section>
        )}

        {similar.length > 0 && (
          <section className="nfx-section">
            <h2 className="nfx-section-title">More Like This</h2>
            <div className="nfx-similar-grid">
              {similar.map((entry) => {
                const card = (
                  <>
                    {entry.posterPath ? (
                      <img src={`${POSTER_BASE}${entry.posterPath}`} alt="" loading="lazy" />
                    ) : (
                      <div className="nfx-similar-ph">{entry.title.charAt(0)}</div>
                    )}
                    <span>{entry.title}</span>
                  </>
                );
                return entry.inLibrary && entry.mediaItemId ? (
                  <Link className="nfx-similar-card" href={`/library/${entry.mediaItemId}`} key={`${entry.mediaType}-${entry.tmdbId}`}>
                    {card}
                  </Link>
                ) : (
                  <div className="nfx-similar-card is-disabled" key={`${entry.mediaType}-${entry.tmdbId}`}>
                    {card}
                  </div>
                );
              })}
            </div>
          </section>
        )}
      </div>
    </div>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="nfx-fact">
      <span>{label}</span>
      <strong>{value}</strong>
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
