'use client';

import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api';
import { useAmbient } from '@/components/AmbientBackdrop';
import type { LibraryItemDTO, MediaType } from '@flux/shared';

const POSTER_BASE = 'https://image.tmdb.org/t/p/w342';
const LETTERS = '#ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');

type Filter = 'ALL' | MediaType;

/** Sort key: ignore a leading "The ", uppercase; non-letters bucket under '#'. */
function sortKey(title: string): string {
  return title.replace(/^(the|a|an)\s+/i, '').trim().toUpperCase();
}
function letterOf(title: string): string {
  const c = sortKey(title).charAt(0);
  return c >= 'A' && c <= 'Z' ? c : '#';
}

const CheckIcon = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
    <path d="M20 6 9 17l-5-5" />
  </svg>
);

export default function LibraryPage() {
  const [filter, setFilter] = useState<Filter>('ALL');
  const [items, setItems] = useState<LibraryItemDTO[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const cardRefs = useRef<Map<string, HTMLElement>>(new Map());

  const load = useCallback((f: Filter, signal?: AbortSignal) => {
    setLoading(true);
    setError(null);
    api
      .listLibrary(f, signal)
      .then((data) => {
        setItems(data);
        setLoading(false);
      })
      .catch((err: unknown) => {
        if (err instanceof DOMException && err.name === 'AbortError') return;
        setError(err instanceof Error ? err.message : 'Failed to load library.');
        setLoading(false);
      });
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    load(filter, controller.signal);
    return () => controller.abort();
  }, [filter, load]);

  // Feed the ambient backdrop from the first item that has one.
  const ambientSrc = items.find((i) => i.backdropPath)?.backdropPath ?? null;
  useAmbient(ambientSrc);

  // Letters that actually have titles → enable those jump buttons.
  const presentLetters = useMemo(() => {
    const set = new Set<string>();
    for (const it of items) set.add(letterOf(it.title));
    return set;
  }, [items]);

  const firstIdByLetter = useMemo(() => {
    const map = new Map<string, string>();
    for (const it of items) {
      const l = letterOf(it.title);
      if (!map.has(l)) map.set(l, it.id);
    }
    return map;
  }, [items]);

  const jumpTo = useCallback((letter: string) => {
    const id = firstIdByLetter.get(letter);
    if (!id) return;
    cardRefs.current
      .get(id)
      ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [firstIdByLetter]);

  return (
    <div className="lib-page">
      <div className="lib-head">
        <h1>Library</h1>
        {!loading && !error && (
          <span className="lib-count">{items.length} titles</span>
        )}
      </div>

      {/* Filter toolbar */}
      <div className="lib-toolbar" role="group" aria-label="Filter library">
        {(['ALL', 'MOVIE', 'SHOW'] as const).map((f) => (
          <button
            key={f}
            type="button"
            className={`lib-tool${filter === f ? ' active' : ''}`}
            aria-pressed={filter === f}
            onClick={() => setFilter(f)}
          >
            {f === 'ALL' ? 'All' : f === 'MOVIE' ? 'Movies' : 'TV Shows'}
          </button>
        ))}
      </div>

      {error && <div className="form-error">{error}</div>}

      {loading && (
        <div className="lib-grid">
          {Array.from({ length: 18 }).map((_, i) => (
            <div className="poster-skel" key={i} />
          ))}
        </div>
      )}

      {!loading && !error && items.length === 0 && (
        <div className="lib-empty">
          <p>Nothing in the library yet. Browse and request something to fill it.</p>
        </div>
      )}

      {!loading && !error && items.length > 0 && (
        <div className="lib-grid">
          {items.map((item) => (
            <Link
              key={item.id}
              href={`/library/${item.id}`}
              className="lib-card"
              ref={(el) => {
                if (el) cardRefs.current.set(item.id, el);
                else cardRefs.current.delete(item.id);
              }}
            >
              <div className="lib-poster">
                {item.posterPath ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={`${POSTER_BASE}${item.posterPath}`}
                    alt={item.title}
                    loading="lazy"
                  />
                ) : (
                  <div className="lib-poster-ph">{item.title}</div>
                )}
                {item.watched ? (
                  <span className="lib-badge check" title="Watched">
                    {CheckIcon}
                  </span>
                ) : item.unplayedCount && item.unplayedCount > 0 ? (
                  <span
                    className="lib-badge count"
                    title={`${item.unplayedCount} unplayed`}
                  >
                    {item.unplayedCount}
                  </span>
                ) : null}
              </div>
              <div className="lib-cap">
                <div className="lib-cap-title">{item.title}</div>
                <div className="lib-cap-sub">
                  {item.year ?? '—'}
                  {item.type === 'SHOW' && item.episodeCount > 0
                    ? ` · ${item.episodeCount} ep`
                    : ''}
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}

      {/* A–Z jump rail */}
      {!loading && items.length > 0 && (
        <nav className="az-rail" aria-label="Jump to letter">
          {LETTERS.map((l) => (
            <button
              key={l}
              type="button"
              disabled={!presentLetters.has(l)}
              onClick={() => jumpTo(l)}
            >
              {l}
            </button>
          ))}
        </nav>
      )}
    </div>
  );
}
