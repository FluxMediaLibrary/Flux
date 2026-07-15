'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import type { MediaType, RequestStatus, TmdbDetail } from '@flux/shared';
import { api, FluxApiError } from '@/lib/api';

const POSTER_BASE = 'https://image.tmdb.org/t/p/w342';
const BACKDROP_BASE = 'https://image.tmdb.org/t/p/w1280';
const PROFILE_BASE = 'https://image.tmdb.org/t/p/w185';

interface TmdbTitleDetailsProps {
  tmdbId: number;
  mediaType: MediaType;
  requestStatus?: RequestStatus | null;
  requesting?: boolean;
  variant?: 'modal' | 'page';
  onClose?: () => void;
  onRequest?: (detail: TmdbDetail) => void;
}

function formatRuntime(minutes: number | null): string | null {
  if (!minutes || minutes <= 0) return null;
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  if (hours <= 0) return `${mins}m`;
  return `${hours}h ${mins}m`;
}

function statusLabel(status: RequestStatus): string {
  switch (status) {
    case 'PENDING':
      return 'Pending';
    case 'APPROVED':
      return 'Approved';
    case 'DOWNLOADING':
      return 'Downloading';
    case 'FULFILLED':
      return 'In Library';
    case 'REJECTED':
      return 'Rejected';
  }
}

function statusPillClass(status: RequestStatus): string {
  switch (status) {
    case 'FULFILLED':
    case 'APPROVED':
      return 'pill ok';
    case 'REJECTED':
      return 'pill err';
    case 'DOWNLOADING':
      return 'pill active';
    default:
      return 'pill';
  }
}

export function TmdbTitleDetails({
  tmdbId,
  mediaType,
  requestStatus = null,
  requesting = false,
  variant = 'modal',
  onClose,
  onRequest,
}: TmdbTitleDetailsProps) {
  const [detail, setDetail] = useState<TmdbDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const controller = new AbortController();
    setDetail(null);
    setError(null);
    setLoading(true);

    api.tmdbDetail(mediaType, tmdbId, controller.signal).then(
      (next) => {
        setDetail(next);
        setLoading(false);
      },
      (err) => {
        if (controller.signal.aborted) return;
        setError(
          err instanceof FluxApiError
            ? err.message
            : 'Failed to load title details.',
        );
        setLoading(false);
      },
    );

    return () => controller.abort();
  }, [mediaType, tmdbId]);

  useEffect(() => {
    if (variant !== 'modal' || !onClose) return;
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [onClose, variant]);

  const facts = useMemo(() => {
    if (!detail) return [];
    return [
      detail.year ? String(detail.year) : null,
      detail.mediaType === 'MOVIE' ? 'Movie' : 'TV Show',
      detail.ageRating,
      formatRuntime(detail.runtime),
      detail.voteAverage !== null ? `★ ${detail.voteAverage.toFixed(1)}` : null,
      detail.status,
    ].filter(Boolean);
  }, [detail]);

  return (
    <div
      className={variant === 'page' ? 'tmdb-page' : 'tmdb-modal'}
      role={variant === 'modal' ? 'dialog' : undefined}
      aria-modal={variant === 'modal' ? true : undefined}
      aria-label="Title details"
    >
      {variant === 'modal' && onClose && (
        <button className="tmdb-modal__scrim" type="button" aria-label="Close details" onClick={onClose} />
      )}
      <div className="tmdb-modal__panel">
        {variant === 'modal' && onClose && (
          <button className="tmdb-modal__close" type="button" onClick={onClose} aria-label="Close details">
          ×
          </button>
        )}

        {loading && (
          <div className="tmdb-modal__state">
            <div className="spinner" aria-hidden />
            Loading details...
          </div>
        )}

        {!loading && error && (
          <div className="tmdb-modal__state">
            <div className="form-error">{error}</div>
          </div>
        )}

        {!loading && detail && (
          <>
            <div className="tmdb-modal__hero">
              {detail.backdropPath && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={`${BACKDROP_BASE}${detail.backdropPath}`} alt="" />
              )}
              <div className="tmdb-modal__hero-shade" />
              <div className="tmdb-modal__intro">
                <div className="tmdb-modal__poster">
                  {detail.posterPath ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={`${POSTER_BASE}${detail.posterPath}`} alt={detail.title} />
                  ) : (
                    <span>No poster</span>
                  )}
                </div>
                <div className="tmdb-modal__copy">
                  <h2>{detail.title}</h2>
                  {detail.tagline && <p className="tmdb-modal__tagline">{detail.tagline}</p>}
                  <div className="tmdb-modal__facts">
                    {facts.map((fact) => (
                      <span key={fact}>{fact}</span>
                    ))}
                  </div>
                  {detail.genres.length > 0 && (
                    <div className="tmdb-modal__genres">
                      {detail.genres.slice(0, 5).map((genre) => (
                        <span key={genre}>{genre}</span>
                      ))}
                    </div>
                  )}
                  {detail.overview && <p className="tmdb-modal__overview">{detail.overview}</p>}
                  <div className="tmdb-modal__actions">
                    {detail.inLibrary && detail.mediaItemId ? (
                      <Link href={`/library/${detail.mediaItemId}`} className="btn btn-primary" onClick={onClose}>
                        ▶ Play
                      </Link>
                    ) : requestStatus && requestStatus !== 'REJECTED' ? (
                      <span className={statusPillClass(requestStatus)}>{statusLabel(requestStatus)}</span>
                    ) : onRequest ? (
                      <button className="btn btn-primary" type="button" onClick={() => onRequest(detail)} disabled={requesting}>
                        {requesting ? 'Requesting...' : '+ Request'}
                      </button>
                    ) : null}
                    {detail.imdbId && (
                      <a
                        className="btn btn-ghost"
                        href={`https://www.imdb.com/title/${detail.imdbId}`}
                        target="_blank"
                        rel="noreferrer"
                      >
                        IMDb
                      </a>
                    )}
                  </div>
                </div>
              </div>
            </div>

            <div className="tmdb-modal__body">
              {detail.trailerYoutubeKey && (
                <section className="tmdb-modal__section tmdb-modal__trailer">
                  <h3>Trailer</h3>
                  <iframe
                    src={`https://www.youtube-nocookie.com/embed/${detail.trailerYoutubeKey}`}
                    title={`${detail.title} trailer`}
                    allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                    allowFullScreen
                  />
                </section>
              )}

              {detail.reviews.length > 0 && (
                <section className="tmdb-modal__section">
                  <h3>Reviews</h3>
                  <div className="tmdb-reviews">
                    {detail.reviews.slice(0, 3).map((review) => (
                      <article className="tmdb-review" key={`${review.author}:${review.url ?? review.content.slice(0, 24)}`}>
                        <div>
                          <strong>{review.author}</strong>
                          {review.rating !== null && <span>★ {review.rating.toFixed(1)}</span>}
                        </div>
                        <p>{review.content}</p>
                        {review.url && (
                          <a href={review.url} target="_blank" rel="noreferrer">
                            Full review
                          </a>
                        )}
                      </article>
                    ))}
                  </div>
                </section>
              )}

              {detail.cast.length > 0 && (
                <section className="tmdb-modal__section">
                  <h3>Cast</h3>
                  <div className="tmdb-cast">
                    {detail.cast.slice(0, 10).map((person) => (
                      <div className="tmdb-cast__item" key={`${person.name}:${person.character}`}>
                        {person.profilePath ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={`${PROFILE_BASE}${person.profilePath}`} alt={person.name} loading="lazy" />
                        ) : (
                          <span>{person.name.slice(0, 1)}</span>
                        )}
                        <strong>{person.name}</strong>
                        <small>{person.character}</small>
                      </div>
                    ))}
                  </div>
                </section>
              )}

              {detail.seasons && detail.seasons.length > 0 && (
                <section className="tmdb-modal__section">
                  <h3>Seasons</h3>
                  <div className="tmdb-seasons">
                    {detail.seasons
                      .filter((season) => season.season > 0)
                      .slice(0, 12)
                      .map((season) => (
                        <span key={season.season}>
                          {season.name || `Season ${season.season}`} · {season.episodeCount} eps
                        </span>
                      ))}
                  </div>
                </section>
              )}

              {detail.similar.length > 0 && (
                <section className="tmdb-modal__section">
                  <h3>Similar</h3>
                  <div className="tmdb-similar">
                    {detail.similar.slice(0, 8).map((item) => (
                      <div className="tmdb-similar__item" key={`${item.mediaType}:${item.tmdbId}`}>
                        {item.posterPath ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={`${POSTER_BASE}${item.posterPath}`} alt={item.title} loading="lazy" />
                        ) : (
                          <span>No poster</span>
                        )}
                        <strong>{item.title}</strong>
                      </div>
                    ))}
                  </div>
                </section>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
