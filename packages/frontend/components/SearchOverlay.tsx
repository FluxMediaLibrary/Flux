'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import { PosterGrid } from '@/components/PosterGrid';
import { PosterCard } from '@/components/PosterCard';
import type { TmdbSearchResult } from '@flux/shared';

export function SearchOverlay({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const debounce = useRef<ReturnType<typeof setTimeout>>(undefined);
  const abort = useRef<AbortController>(undefined);

  const [query, setQuery] = useState('');
  const [results, setResults] = useState<TmdbSearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);

  useEffect(() => {
    inputRef.current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const run = useCallback(async (q: string) => {
    if (abort.current) abort.current.abort();
    const controller = new AbortController();
    abort.current = controller;
    setLoading(true);
    setSearched(true);
    try {
      const [movies, shows] = await Promise.all([
        api.searchTmdb(q, 'MOVIE', controller.signal),
        api.searchTmdb(q, 'SHOW', controller.signal),
      ]);
      // Interleave for a mixed feel, most-relevant first per list.
      const merged = [...movies, ...shows].sort(
        (a, b) => (b.voteAverage ?? 0) - (a.voteAverage ?? 0),
      );
      setResults(merged);
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return;
      setResults([]);
    } finally {
      setLoading(false);
    }
  }, []);

  const onChange = (v: string) => {
    setQuery(v);
    if (debounce.current) clearTimeout(debounce.current);
    if (!v.trim()) { setResults([]); setSearched(false); return; }
    debounce.current = setTimeout(() => run(v.trim()), 300);
  };

  const pick = (item: TmdbSearchResult) => {
    onClose();
    if (item.inLibrary && item.mediaItemId) router.push(`/library/${item.mediaItemId}`);
    else router.push('/browse');
  };

  useEffect(() => () => {
    if (debounce.current) clearTimeout(debounce.current);
    if (abort.current) abort.current.abort();
  }, []);

  return (
    <div className="soverlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <button className="soverlay__close" aria-label="Close search" onClick={onClose}>
        <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <path d="M6 6l12 12M18 6 6 18" />
        </svg>
      </button>

      <div className="soverlay__box">
        <input
          ref={inputRef}
          className="soverlay__field"
          type="text"
          placeholder="Search movies & shows…"
          value={query}
          onChange={(e) => onChange(e.target.value)}
        />
        <p className="soverlay__hint">Press Esc to close</p>
      </div>

      <div className="soverlay__results">
        {loading && <div className="state-center"><div className="spinner" /></div>}
        {!loading && searched && results.length === 0 && (
          <div className="state-center">No results found.</div>
        )}
        {!loading && results.length > 0 && (
          <PosterGrid>
            {results.map((r) => (
              <PosterCard
                key={`${r.mediaType}:${r.tmdbId}`}
                posterPath={r.posterPath}
                title={r.title}
                meta={r.year ? String(r.year) : undefined}
                tags={r.inLibrary ? ['In Library'] : undefined}
                onClick={() => pick(r)}
              />
            ))}
          </PosterGrid>
        )}
      </div>
    </div>
  );
}
