'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import Image from 'next/image';
import { useAuth } from '@/lib/auth-context';
import { api } from '@/lib/api';
import type {
  TmdbSearchResult,
  MediaType,
  RequestStatus,
} from '@flux/shared';

type FilterType = MediaType | 'ALL';

function requestKey(tmdbId: number, mediaType: MediaType): string {
  return `${tmdbId}:${mediaType}`;
}

export default function BrowsePage() {
  const { activeProfile } = useAuth();

  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<FilterType>('ALL');
  const [results, setResults] = useState<TmdbSearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searched, setSearched] = useState(false);
  const [requests, setRequests] = useState<Map<string, RequestStatus>>(
    new Map(),
  );
  const [requestingIds, setRequestingIds] = useState<Set<string>>(new Set());

  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const abortRef = useRef<AbortController>(undefined);

  // ── Fetch existing requests on mount ────────────────────────────────────
  useEffect(() => {
    if (!activeProfile) return;
    api
      .listMyRequests()
      .then((reqs) => {
        const map = new Map<string, RequestStatus>();
        for (const r of reqs) {
          map.set(requestKey(r.tmdbId, r.mediaType), r.status);
        }
        setRequests(map);
      })
      .catch(() => {
        // Silently fail — we just won't show disabled states.
      });
  }, [activeProfile]);

  // ── Search logic ────────────────────────────────────────────────────────
  const doSearch = useCallback(
    async (q: string, f: FilterType) => {
      if (abortRef.current) abortRef.current.abort();
      if (!q.trim()) {
        setResults([]);
        setSearched(false);
        setError(null);
        return;
      }

      const controller = new AbortController();
      abortRef.current = controller;
      setLoading(true);
      setError(null);
      setSearched(true);

      try {
        if (f === 'ALL') {
          const [movies, shows] = await Promise.all([
            api.searchTmdb(q, 'MOVIE', controller.signal),
            api.searchTmdb(q, 'SHOW', controller.signal),
          ]);
          setResults([...movies, ...shows]);
        } else {
          const res = await api.searchTmdb(q, f, controller.signal);
          setResults(res);
        }
      } catch (err: unknown) {
        if (err instanceof DOMException && err.name === 'AbortError') return;
        setError(err instanceof Error ? err.message : 'Search failed.');
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  // ── Debounced input handler ─────────────────────────────────────────────
  const handleInput = useCallback(
    (val: string) => {
      setQuery(val);
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => doSearch(val, filter), 300);
    },
    [filter, doSearch],
  );

  const handleSearch = useCallback(
    () => doSearch(query, filter),
    [query, filter, doSearch],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter') handleSearch();
    },
    [handleSearch],
  );

  const handleFilterChange = useCallback(
    (f: FilterType) => {
      setFilter(f);
      if (query.trim()) doSearch(query, f);
    },
    [query, doSearch],
  );

  // ── Request action ──────────────────────────────────────────────────────
  const handleRequest = useCallback(
    async (item: TmdbSearchResult) => {
      const key = requestKey(item.tmdbId, item.mediaType);
      setRequestingIds((prev) => {
        const next = new Set(prev);
        next.add(key);
        return next;
      });
      try {
        await api.createRequest({
          tmdbId: item.tmdbId,
          mediaType: item.mediaType,
          title: item.title,
        });
        setRequests((prev) => {
          const next = new Map(prev);
          next.set(key, 'PENDING');
          return next;
        });
      } catch {
        // Keep button enabled on failure so they can retry.
      } finally {
        setRequestingIds((prev) => {
          const next = new Set(prev);
          next.delete(key);
          return next;
        });
      }
    },
    [],
  );

  // ── Helpers ─────────────────────────────────────────────────────────────
  const getRequestStatus = useCallback(
    (item: TmdbSearchResult): RequestStatus | null =>
      requests.get(requestKey(item.tmdbId, item.mediaType)) ?? null,
    [requests],
  );

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

  // ── Cleanup debounce + abort on unmount ──────────────────────────────
  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      if (abortRef.current) abortRef.current.abort();
    };
  }, []);

  // ── Render ───────────────────────────────────────────────────────────
  return (
    <div>
      <div className="section-head">
        <h1>Browse &amp; Request</h1>
      </div>

      {/* Search bar */}
      <div className="search-row">
        <input
          className="input"
          type="text"
          placeholder="Search for a movie or TV show…"
          value={query}
          onChange={(e) => handleInput(e.target.value)}
          onKeyDown={handleKeyDown}
        />
        <button
          className="btn btn-primary"
          onClick={handleSearch}
          disabled={loading}
        >
          Search
        </button>
      </div>

      {/* Type filter */}
      <div className="browse-filter-row">
        <div className="toggle-group">
          {(['ALL', 'MOVIE', 'SHOW'] as const).map((t) => (
            <button
              key={t}
              className={`toggle${filter === t ? ' active' : ''}`}
              onClick={() => handleFilterChange(t)}
            >
              {t === 'ALL' ? 'All' : t === 'MOVIE' ? 'Movies' : 'TV Shows'}
            </button>
          ))}
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="form-error" style={{ marginTop: 16 }}>
          {error}
        </div>
      )}

      {/* Loading */}
      {loading && (
        <div className="browse-state">
          <div className="spinner" />
        </div>
      )}

      {/* Empty — before searching */}
      {!loading && !searched && !error && (
        <div className="empty">
          <p>Search for a movie or TV show to browse and request.</p>
        </div>
      )}

      {/* Empty — searched, no results */}
      {!loading && searched && results.length === 0 && !error && (
        <div className="empty">
          <p>No results found. Try a different search.</p>
        </div>
      )}

      {/* Results grid */}
      {results.length > 0 && !loading && (
        <div className="browse-grid">
          {results.map((item) => {
            const reqStatus = getRequestStatus(item);
            const isRequesting = requestingIds.has(
              requestKey(item.tmdbId, item.mediaType),
            );

            return (
              <article
                key={requestKey(item.tmdbId, item.mediaType)}
                className="browse-card"
              >
                <div className="browse-poster">
                  {item.posterPath ? (
                    <Image
                      src={`https://image.tmdb.org/t/p/w342${item.posterPath}`}
                      alt={item.title}
                      width={342}
                      height={513}
                      className="browse-poster-img"
                      sizes="(max-width: 600px) 140px, (max-width: 900px) 180px, 220px"
                    />
                  ) : (
                    <div className="browse-poster-placeholder">
                      <span className="dim">No Poster</span>
                    </div>
                  )}
                </div>
                <div className="browse-card-body">
                  <h3 className="browse-card-title">{item.title}</h3>
                  {item.year && (
                    <span className="browse-card-year dim">{item.year}</span>
                  )}
                  <p className="browse-card-overview">{item.overview}</p>
                  <div className="browse-card-action">
                    {item.inLibrary ? (
                      <span className="pill ok">In Library</span>
                    ) : reqStatus ? (
                      <span className={statusPillClass(reqStatus)}>
                        {statusLabel(reqStatus)}
                      </span>
                    ) : (
                      <button
                        className="btn btn-sm"
                        onClick={() => handleRequest(item)}
                        disabled={isRequesting}
                      >
                        {isRequesting ? 'Requesting…' : 'Request'}
                      </button>
                    )}
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}
