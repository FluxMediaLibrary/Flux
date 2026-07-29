'use client';

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';
import { api } from '@/lib/api';
import { useAmbient } from '@/components/AmbientBackdrop';
import type {
  TmdbSearchResult,
  TmdbGenreDTO,
  MediaType,
  RequestStatus,
} from '@flux/shared';

const BACKDROP_BASE = 'https://image.tmdb.org/t/p/w1280';
const POSTER_BASE = 'https://image.tmdb.org/t/p/w342';
const HERO_ROTATE_MS = 7000;

function requestKey(tmdbId: number, mediaType: MediaType): string {
  return `${tmdbId}:${mediaType}`;
}

function titleDetailHref(tmdbId: number, mediaType: MediaType): string {
  return `/browse/${mediaType === 'SHOW' ? 'tv' : 'movie'}/${tmdbId}`;
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

export default function BrowsePage() {
  const { activeProfile } = useAuth();
  const router = useRouter();

  const [mediaType, setMediaType] = useState<MediaType>('MOVIE');
  const [genres, setGenres] = useState<TmdbGenreDTO[]>([]);
  const [activeGenre, setActiveGenre] = useState<number | null>(null);

  const [hero, setHero] = useState<TmdbSearchResult[]>([]);
  const [heroIndex, setHeroIndex] = useState(0);

  const [results, setResults] = useState<TmdbSearchResult[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [query, setQuery] = useState('');
  const [searching, setSearching] = useState(false);

  const [requests, setRequests] = useState<Map<string, RequestStatus>>(new Map());
  const [requestingIds, setRequestingIds] = useState<Set<string>>(new Set());

  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const gridAbortRef = useRef<AbortController>(undefined);

  useEffect(() => {
    if (!activeProfile) return;
    api
      .listMyRequests()
      .then((reqs) => {
        const map = new Map<string, RequestStatus>();
        for (const request of reqs) map.set(requestKey(request.tmdbId, request.mediaType), request.status);
        setRequests(map);
      })
      .catch(() => {
        /* Existing request state is helpful but not required to browse. */
      });
  }, [activeProfile]);

  useEffect(() => {
    const controller = new AbortController();
    setActiveGenre(null);
    setHeroIndex(0);

    api
      .listGenres(mediaType, controller.signal)
      .then(setGenres)
      .catch(() => setGenres([]));

    api
      .trending(mediaType, 'week', controller.signal)
      .then((items) => setHero(items.filter((item) => item.backdropPath).slice(0, 5)))
      .catch(() => setHero([]));

    return () => controller.abort();
  }, [mediaType]);

  useEffect(() => {
    if (hero.length <= 1) return;
    const timer = setInterval(() => setHeroIndex((index) => (index + 1) % hero.length), HERO_ROTATE_MS);
    return () => clearInterval(timer);
  }, [hero]);

  const loadFeed = useCallback(async (type: MediaType, genreId: number | null) => {
    if (gridAbortRef.current) gridAbortRef.current.abort();
    const controller = new AbortController();
    gridAbortRef.current = controller;
    setLoading(true);
    setError(null);
    try {
      const items = genreId === null
        ? await api.popular(type, controller.signal)
        : await api.discover(type, genreId, controller.signal);
      setResults(items);
    } catch (err: unknown) {
      if (err instanceof DOMException && err.name === 'AbortError') return;
      setError(err instanceof Error ? err.message : 'Failed to load titles.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (searching) return;
    void loadFeed(mediaType, activeGenre);
  }, [mediaType, activeGenre, searching, loadFeed]);

  const runSearch = useCallback(async (q: string, type: MediaType) => {
    if (gridAbortRef.current) gridAbortRef.current.abort();
    const controller = new AbortController();
    gridAbortRef.current = controller;
    setLoading(true);
    setError(null);
    try {
      const items = await api.searchTmdb(q, type, controller.signal);
      setResults(items);
    } catch (err: unknown) {
      if (err instanceof DOMException && err.name === 'AbortError') return;
      setError(err instanceof Error ? err.message : 'Search failed.');
    } finally {
      setLoading(false);
    }
  }, []);

  const clearSearch = useCallback(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    setQuery('');
    setSearching(false);
  }, []);

  const handleQueryChange = useCallback((value: string) => {
    setQuery(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    const trimmed = value.trim();
    if (!trimmed) {
      setSearching(false);
      return;
    }
    setSearching(true);
    debounceRef.current = setTimeout(() => void runSearch(trimmed, mediaType), 320);
  }, [mediaType, runSearch]);

  const submitSearch = useCallback(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    const trimmed = query.trim();
    if (!trimmed) {
      clearSearch();
      return;
    }
    setSearching(true);
    void runSearch(trimmed, mediaType);
  }, [clearSearch, mediaType, query, runSearch]);

  const switchMediaType = useCallback((type: MediaType) => {
    setMediaType(type);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    const trimmed = query.trim();
    if (trimmed) {
      setSearching(true);
      void runSearch(trimmed, type);
    }
  }, [query, runSearch]);

  const chooseGenre = useCallback((genreId: number | null) => {
    setActiveGenre(genreId);
    if (searching) clearSearch();
  }, [clearSearch, searching]);

  const handleRequest = useCallback(async (item: TmdbSearchResult) => {
    const key = requestKey(item.tmdbId, item.mediaType);
    setRequestingIds((prev) => new Set(prev).add(key));
    try {
      await api.createRequest({
        tmdbId: item.tmdbId,
        mediaType: item.mediaType,
        title: item.title,
      });
      setRequests((prev) => new Map(prev).set(key, 'PENDING'));
    } catch {
      /* Keep enabled so the user can retry. */
    } finally {
      setRequestingIds((prev) => {
        const next = new Set(prev);
        next.delete(key);
        return next;
      });
    }
  }, []);

  useEffect(
    () => () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      if (gridAbortRef.current) gridAbortRef.current.abort();
    },
    [],
  );

  const heroItem = hero[heroIndex];
  useAmbient(heroItem?.backdropPath ?? null);

  const activeGenreName = useMemo(
    () => genres.find((genre) => genre.id === activeGenre)?.name ?? null,
    [activeGenre, genres],
  );

  const sectionTitle = searching
    ? `Results for "${query.trim()}"`
    : activeGenreName ?? (mediaType === 'MOVIE' ? 'Popular Movies' : 'Popular Shows');

  return (
    <div className="page browse-page">
      <section className="browse-workbench" aria-label="Browse controls">
        <div className="browse-workbench-head">
          <div>
            <span className="browse-kicker">Requests</span>
            <h1>Browse</h1>
          </div>
          <div className="browse-type-switch" aria-label="Media type">
            {(['MOVIE', 'SHOW'] as const).map((type) => (
              <button
                key={type}
                type="button"
                className={mediaType === type ? 'active' : undefined}
                onClick={() => switchMediaType(type)}
              >
                {type === 'MOVIE' ? 'Movies' : 'TV Shows'}
              </button>
            ))}
          </div>
        </div>

        <form
          className="browse-search-panel"
          role="search"
          onSubmit={(event) => {
            event.preventDefault();
            submitSearch();
          }}
        >
          <label className="browse-search-field">
            <span>Search titles</span>
            <input
              type="search"
              placeholder={mediaType === 'MOVIE' ? 'Search movies' : 'Search TV shows'}
              value={query}
              onChange={(event) => handleQueryChange(event.target.value)}
            />
          </label>
          <label className="browse-genre-select">
            <span>Discover genre</span>
            <select
              value={activeGenre ?? 'POPULAR'}
              onChange={(event) => chooseGenre(event.target.value === 'POPULAR' ? null : Number(event.target.value))}
            >
              <option value="POPULAR">Popular</option>
              {genres.map((genre) => (
                <option key={genre.id} value={genre.id}>{genre.name}</option>
              ))}
            </select>
          </label>
          <div className="browse-search-actions">
            <button className="btn btn-primary" type="submit" disabled={!query.trim()}>
              Search
            </button>
            {(query || searching || activeGenre !== null) && (
              <button
                className="btn btn-ghost"
                type="button"
                onClick={() => {
                  setActiveGenre(null);
                  clearSearch();
                }}
              >
                Reset
              </button>
            )}
          </div>
        </form>

        {genres.length > 0 && (
          <div className="genre-grid" aria-label="Discover by genre">
            <button
              type="button"
              className={`genre-chip${activeGenre === null && !searching ? ' active' : ''}`}
              onClick={() => chooseGenre(null)}
            >
              Popular
            </button>
            {genres.map((genre) => (
              <button
                key={genre.id}
                type="button"
                className={`genre-chip${activeGenre === genre.id && !searching ? ' active' : ''}`}
                onClick={() => chooseGenre(genre.id)}
              >
                {genre.name}
              </button>
            ))}
          </div>
        )}
      </section>

      {!searching && heroItem && (
        <div className="disc-hero">
          <button
            className="disc-hero-hit"
            type="button"
            aria-label={`Open details for ${heroItem.title}`}
            onClick={() => router.push(titleDetailHref(heroItem.tmdbId, heroItem.mediaType))}
          />
          <div className="disc-hero-bg">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={`${BACKDROP_BASE}${heroItem.backdropPath}`} alt="" key={heroItem.tmdbId} />
          </div>
          <div className="disc-hero-content">
            <span className="disc-hero-kicker">Trending this week</span>
            <h2 className="disc-hero-title">{heroItem.title}</h2>
            <div className="disc-hero-meta">
              {heroItem.year && <span>{heroItem.year}</span>}
              <span>{heroItem.mediaType === 'MOVIE' ? 'Movie' : 'TV'}</span>
              {heroItem.voteAverage !== null && (
                <span style={{ color: '#ffd479' }}>Rating {heroItem.voteAverage.toFixed(1)}</span>
              )}
            </div>
            {heroItem.overview && <p className="disc-hero-overview">{heroItem.overview}</p>}
            <div className="disc-hero-actions">
              <HeroAction
                item={heroItem}
                status={requests.get(requestKey(heroItem.tmdbId, heroItem.mediaType)) ?? null}
                requesting={requestingIds.has(requestKey(heroItem.tmdbId, heroItem.mediaType))}
                onRequest={() => handleRequest(heroItem)}
                detailsHref={titleDetailHref(heroItem.tmdbId, heroItem.mediaType)}
              />
            </div>
          </div>
          {hero.length > 1 && (
            <div className="disc-hero-dots">
              {hero.map((item, index) => (
                <button
                  key={item.tmdbId}
                  className={`disc-hero-dot${index === heroIndex ? ' active' : ''}`}
                  onClick={() => setHeroIndex(index)}
                  aria-label={`Show ${item.title}`}
                />
              ))}
            </div>
          )}
        </div>
      )}

      <div className="disc-section-head">
        <div>
          <h2>{sectionTitle}</h2>
          {searching && activeGenreName && (
            <p className="browse-context-note">Genre selection applies when you return to discovery.</p>
          )}
        </div>
        {!loading && results.length > 0 && <span className="disc-count">{results.length} titles</span>}
      </div>

      {error && <div className="form-error">{error}</div>}

      {loading && (
        <div className="poster-grid">
          {Array.from({ length: 12 }).map((_, index) => (
            <div className="poster-skel" key={index} />
          ))}
        </div>
      )}

      {!loading && !error && results.length === 0 && (
        <div className="empty">
          <p>
            {searching
              ? 'No results found. Try a different search or switch media type.'
              : 'Nothing to show here yet.'}
          </p>
        </div>
      )}

      {!loading && results.length > 0 && (
        <div className="poster-grid">
          {results.map((item) => {
            const key = requestKey(item.tmdbId, item.mediaType);
            return (
              <MediaCard
                key={key}
                item={item}
                status={requests.get(key) ?? null}
                requesting={requestingIds.has(key)}
                onRequest={() => handleRequest(item)}
                onDetails={() => router.push(titleDetailHref(item.tmdbId, item.mediaType))}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}

function HeroAction({
  item,
  status,
  requesting,
  onRequest,
  detailsHref,
}: {
  item: TmdbSearchResult;
  status: RequestStatus | null;
  requesting: boolean;
  onRequest: () => void;
  detailsHref: string;
}) {
  if (item.inLibrary && item.mediaItemId) {
    return (
      <Link href={`/library/${item.mediaItemId}`} className="btn btn-primary">
        Play
      </Link>
    );
  }
  if (status) {
    return (
      <>
        <span className={statusPillClass(status)}>{statusLabel(status)}</span>
        <Link className="btn btn-ghost" href={detailsHref}>
          Details
        </Link>
      </>
    );
  }
  return (
    <>
      <button className="btn btn-primary" onClick={onRequest} disabled={requesting}>
        {requesting ? 'Requesting...' : '+ Request'}
      </button>
      <Link className="btn btn-ghost" href={detailsHref}>
        Details
      </Link>
    </>
  );
}

function MediaCard({
  item,
  status,
  requesting,
  onRequest,
  onDetails,
}: {
  item: TmdbSearchResult;
  status: RequestStatus | null;
  requesting: boolean;
  onRequest: () => void;
  onDetails: () => void;
}) {
  const inLibrary = item.inLibrary && item.mediaItemId;

  return (
    <div
      className="media-card"
      role="button"
      tabIndex={0}
      onClick={onDetails}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onDetails();
        }
      }}
    >
      <div className="media-poster">
        {item.posterPath ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={`${POSTER_BASE}${item.posterPath}`} alt={item.title} loading="lazy" />
        ) : (
          <div className="media-poster-ph">No poster</div>
        )}
        {item.voteAverage !== null && <span className="media-rating">Rating {item.voteAverage.toFixed(1)}</span>}
        {inLibrary ? (
          <span className="media-badge">In Library</span>
        ) : status && status !== 'REJECTED' ? (
          <span className="media-badge req">{statusLabel(status)}</span>
        ) : null}
      </div>
      <div className="media-caption">
        <p className="media-caption-title">{item.title}</p>
        <p className="media-caption-sub">
          {item.year ?? 'Unknown'} / {item.mediaType === 'MOVIE' ? 'Movie' : 'TV'}
        </p>
        <div style={{ marginTop: 8 }}>
          {inLibrary ? (
            <Link
              href={`/library/${item.mediaItemId}`}
              className="btn btn-sm btn-primary"
              style={{ width: '100%' }}
              onClick={(event) => event.stopPropagation()}
            >
              Play
            </Link>
          ) : status ? (
            <span className={statusPillClass(status)}>{statusLabel(status)}</span>
          ) : (
            <button
              className="btn btn-sm"
              style={{ width: '100%' }}
              onClick={(event) => {
                event.stopPropagation();
                onRequest();
              }}
              disabled={requesting}
            >
              {requesting ? 'Requesting...' : '+ Request'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
