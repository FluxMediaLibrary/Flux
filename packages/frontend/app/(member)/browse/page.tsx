'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import Link from 'next/link';
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

  const [requests, setRequests] = useState<Map<string, RequestStatus>>(
    new Map(),
  );
  const [requestingIds, setRequestingIds] = useState<Set<string>>(new Set());

  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const gridAbortRef = useRef<AbortController>(undefined);

  // ── Existing requests (to disable already-requested titles) ───────────────
  useEffect(() => {
    if (!activeProfile) return;
    api
      .listMyRequests()
      .then((reqs) => {
        const map = new Map<string, RequestStatus>();
        for (const r of reqs) map.set(requestKey(r.tmdbId, r.mediaType), r.status);
        setRequests(map);
      })
      .catch(() => {
        /* non-fatal */
      });
  }, [activeProfile]);

  // ── Genres + hero (trending) load on mediaType change ─────────────────────
  useEffect(() => {
    const controller = new AbortController();
    setActiveGenre(null);
    setHeroIndex(0);

    api
      .listGenres(mediaType, controller.signal)
      .then(setGenres)
      .catch(() => {
        /* non-fatal */
      });

    api
      .trending(mediaType, 'week', controller.signal)
      .then((items) => setHero(items.filter((i) => i.backdropPath).slice(0, 5)))
      .catch(() => {
        /* non-fatal — hero just won't render */
      });

    return () => controller.abort();
  }, [mediaType]);

  // ── Hero auto-rotation ────────────────────────────────────────────────────
  useEffect(() => {
    if (hero.length <= 1) return;
    const t = setInterval(
      () => setHeroIndex((i) => (i + 1) % hero.length),
      HERO_ROTATE_MS,
    );
    return () => clearInterval(t);
  }, [hero]);

  // ── Load the main grid: popular / discover(genre) — when not searching ────
  const loadFeed = useCallback(
    async (type: MediaType, genreId: number | null) => {
      if (gridAbortRef.current) gridAbortRef.current.abort();
      const controller = new AbortController();
      gridAbortRef.current = controller;
      setLoading(true);
      setError(null);
      try {
        const items =
          genreId === null
            ? await api.popular(type, controller.signal)
            : await api.discover(type, genreId, controller.signal);
        setResults(items);
      } catch (err: unknown) {
        if (err instanceof DOMException && err.name === 'AbortError') return;
        setError(err instanceof Error ? err.message : 'Failed to load titles.');
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  useEffect(() => {
    if (searching) return;
    loadFeed(mediaType, activeGenre);
  }, [mediaType, activeGenre, searching, loadFeed]);

  // ── Search ────────────────────────────────────────────────────────────────
  const runSearch = useCallback(
    async (q: string, type: MediaType) => {
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
    },
    [],
  );

  const handleQueryChange = useCallback(
    (val: string) => {
      setQuery(val);
      if (debounceRef.current) clearTimeout(debounceRef.current);
      const trimmed = val.trim();
      if (!trimmed) {
        setSearching(false);
        return;
      }
      setSearching(true);
      debounceRef.current = setTimeout(() => runSearch(trimmed, mediaType), 320);
    },
    [mediaType, runSearch],
  );

  const clearSearch = useCallback(() => {
    setQuery('');
    setSearching(false);
  }, []);

  // ── Request action ────────────────────────────────────────────────────────
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
      /* keep enabled so the user can retry */
    } finally {
      setRequestingIds((prev) => {
        const next = new Set(prev);
        next.delete(key);
        return next;
      });
    }
  }, []);

  // ── Cleanup ───────────────────────────────────────────────────────────────
  useEffect(
    () => () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      if (gridAbortRef.current) gridAbortRef.current.abort();
    },
    [],
  );

  const heroItem = hero[heroIndex];
  useAmbient(heroItem?.backdropPath ?? null);

  const sectionTitle = searching
    ? `Results for “${query.trim()}”`
    : activeGenre !== null
      ? genres.find((g) => g.id === activeGenre)?.name ?? 'Discover'
      : mediaType === 'MOVIE'
        ? 'Popular Movies'
        : 'Popular Shows';

  return (
    <div>
      <div className="section-head">
        <h1>Browse</h1>
      </div>

      {/* Search (secondary) */}
      <div className="search-row">
        <input
          className="input"
          type="text"
          placeholder="Search for a movie or TV show…"
          value={query}
          onChange={(e) => handleQueryChange(e.target.value)}
        />
        {query && (
          <button className="btn btn-ghost" onClick={clearSearch}>
            Clear
          </button>
        )}
      </div>

      {/* Hero carousel — hidden while searching */}
      {!searching && heroItem && (
        <div className="disc-hero" style={{ marginTop: 22 }}>
          <div className="disc-hero-bg">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={`${BACKDROP_BASE}${heroItem.backdropPath}`}
              alt=""
              key={heroItem.tmdbId}
            />
          </div>
          <div className="disc-hero-content">
            <span className="disc-hero-kicker">🔥 Trending this week</span>
            <h2 className="disc-hero-title">{heroItem.title}</h2>
            <div className="disc-hero-meta">
              {heroItem.year && <span>{heroItem.year}</span>}
              <span>{heroItem.mediaType === 'MOVIE' ? 'Movie' : 'TV'}</span>
              {heroItem.voteAverage !== null && (
                <span style={{ color: '#ffd479' }}>
                  ★ {heroItem.voteAverage.toFixed(1)}
                </span>
              )}
            </div>
            {heroItem.overview && (
              <p className="disc-hero-overview">{heroItem.overview}</p>
            )}
            <div className="disc-hero-actions">
              <HeroAction
                item={heroItem}
                status={requests.get(requestKey(heroItem.tmdbId, heroItem.mediaType)) ?? null}
                requesting={requestingIds.has(requestKey(heroItem.tmdbId, heroItem.mediaType))}
                onRequest={() => handleRequest(heroItem)}
              />
            </div>
          </div>
          {hero.length > 1 && (
            <div className="disc-hero-dots">
              {hero.map((h, i) => (
                <button
                  key={h.tmdbId}
                  className={`disc-hero-dot${i === heroIndex ? ' active' : ''}`}
                  onClick={() => setHeroIndex(i)}
                  aria-label={`Show ${h.title}`}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {/* Type + genre toolbar — hidden while searching */}
      {!searching && (
        <>
          <div className="browse-toolbar">
            <div className="toggle-group">
              {(['MOVIE', 'SHOW'] as const).map((t) => (
                <button
                  key={t}
                  className={`toggle${mediaType === t ? ' active' : ''}`}
                  onClick={() => setMediaType(t)}
                >
                  {t === 'MOVIE' ? 'Movies' : 'TV Shows'}
                </button>
              ))}
            </div>
          </div>

          {genres.length > 0 && (
            <div className="genre-bar">
              <button
                className={`genre-pill${activeGenre === null ? ' active' : ''}`}
                onClick={() => setActiveGenre(null)}
              >
                Popular
              </button>
              {genres.map((g) => (
                <button
                  key={g.id}
                  className={`genre-pill${activeGenre === g.id ? ' active' : ''}`}
                  onClick={() => setActiveGenre(g.id)}
                >
                  {g.name}
                </button>
              ))}
            </div>
          )}
        </>
      )}

      {/* Section header */}
      <div className="disc-section-head" style={{ marginTop: 20 }}>
        <h2>{sectionTitle}</h2>
        {!loading && results.length > 0 && (
          <span className="disc-count">{results.length} titles</span>
        )}
      </div>

      {/* Error */}
      {error && <div className="form-error">{error}</div>}

      {/* Loading skeleton */}
      {loading && (
        <div className="poster-grid">
          {Array.from({ length: 12 }).map((_, i) => (
            <div className="poster-skel" key={i} />
          ))}
        </div>
      )}

      {/* Empty */}
      {!loading && !error && results.length === 0 && (
        <div className="empty">
          <p>
            {searching
              ? 'No results found. Try a different search.'
              : 'Nothing to show here yet.'}
          </p>
        </div>
      )}

      {/* Grid */}
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
              />
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Hero call-to-action ───────────────────────────────────────────────────────

function HeroAction({
  item,
  status,
  requesting,
  onRequest,
}: {
  item: TmdbSearchResult;
  status: RequestStatus | null;
  requesting: boolean;
  onRequest: () => void;
}) {
  if (item.inLibrary && item.mediaItemId) {
    return (
      <Link href={`/library/${item.mediaItemId}`} className="btn btn-primary">
        ▶ Play
      </Link>
    );
  }
  if (status) {
    return <span className={statusPillClass(status)}>{statusLabel(status)}</span>;
  }
  return (
    <button className="btn btn-primary" onClick={onRequest} disabled={requesting}>
      {requesting ? 'Requesting…' : '+ Request'}
    </button>
  );
}

// ── Poster card ───────────────────────────────────────────────────────────────

function MediaCard({
  item,
  status,
  requesting,
  onRequest,
}: {
  item: TmdbSearchResult;
  status: RequestStatus | null;
  requesting: boolean;
  onRequest: () => void;
}) {
  const inLibrary = item.inLibrary && item.mediaItemId;

  return (
    <div className="media-card">
      <div className="media-poster">
        {item.posterPath ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={`${POSTER_BASE}${item.posterPath}`}
            alt={item.title}
            loading="lazy"
          />
        ) : (
          <div className="media-poster-ph">No poster</div>
        )}
        {item.voteAverage !== null && (
          <span className="media-rating">★ {item.voteAverage.toFixed(1)}</span>
        )}
        {inLibrary ? (
          <span className="media-badge">In Library</span>
        ) : status && status !== 'REJECTED' ? (
          <span className="media-badge req">{statusLabel(status)}</span>
        ) : null}
      </div>
      <div className="media-caption">
        <p className="media-caption-title">{item.title}</p>
        <p className="media-caption-sub">
          {item.year ?? '—'} · {item.mediaType === 'MOVIE' ? 'Movie' : 'TV'}
        </p>
        <div style={{ marginTop: 8 }}>
          {inLibrary ? (
            <Link
              href={`/library/${item.mediaItemId}`}
              className="btn btn-sm btn-primary"
              style={{ width: '100%' }}
            >
              ▶ Play
            </Link>
          ) : status ? (
            <span className={statusPillClass(status)}>{statusLabel(status)}</span>
          ) : (
            <button
              className="btn btn-sm"
              style={{ width: '100%' }}
              onClick={onRequest}
              disabled={requesting}
            >
              {requesting ? 'Requesting…' : '+ Request'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
