'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import { PosterGrid } from '@/components/PosterGrid';
import { PosterCard } from '@/components/PosterCard';
import type { TmdbPersonResult, TmdbSearchResult } from '@flux/shared';

const PROFILE_BASE = 'https://image.tmdb.org/t/p/w185';

export function SearchOverlay({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const debounce = useRef<ReturnType<typeof setTimeout>>(undefined);
  const abort = useRef<AbortController>(undefined);

  const [query, setQuery] = useState('');
  const [results, setResults] = useState<TmdbSearchResult[]>([]);
  const [people, setPeople] = useState<TmdbPersonResult[]>([]);
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
      const [movies, shows, peopleResults] = await Promise.all([
        api.searchTmdb(q, 'MOVIE', controller.signal),
        api.searchTmdb(q, 'SHOW', controller.signal),
        api.searchPeople(q, controller.signal),
      ]);
      // Interleave for a mixed feel, most-relevant first per list.
      const merged = [...movies, ...shows].sort(
        (a, b) => (b.voteAverage ?? 0) - (a.voteAverage ?? 0),
      );
      setResults(merged);
      setPeople(peopleResults);
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return;
      setResults([]);
      setPeople([]);
    } finally {
      setLoading(false);
    }
  }, []);

  const onChange = (v: string) => {
    setQuery(v);
    if (debounce.current) clearTimeout(debounce.current);
    if (!v.trim()) {
      setResults([]);
      setPeople([]);
      setSearched(false);
      return;
    }
    debounce.current = setTimeout(() => run(v.trim()), 300);
  };

  const pick = (item: TmdbSearchResult) => {
    onClose();
    if (item.inLibrary && item.mediaItemId) router.push(`/library/${item.mediaItemId}`);
    else router.push('/browse');
  };

  const pickPerson = (person: TmdbPersonResult) => {
    const localTitle = person.knownFor.find((item) => item.inLibrary && item.mediaItemId);
    onClose();
    if (localTitle?.mediaItemId) router.push(`/library/${localTitle.mediaItemId}`);
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
        {!loading && searched && results.length === 0 && people.length === 0 && (
          <div className="state-center">No results found.</div>
        )}
        {!loading && people.length > 0 && (
          <section className="soverlay__section">
            <h3>Actors</h3>
            <div className="person-results">
              {people.map((person) => (
                <button
                  className="person-result"
                  type="button"
                  key={person.tmdbId}
                  onClick={() => pickPerson(person)}
                >
                  {person.profilePath ? (
                    <img src={`${PROFILE_BASE}${person.profilePath}`} alt="" />
                  ) : (
                    <span className="person-result__avatar">{person.name.charAt(0)}</span>
                  )}
                  <span>
                    <strong>{person.name}</strong>
                    <small>
                      {[person.knownForDepartment, person.knownFor.slice(0, 2).map((item) => item.title).join(', ')]
                        .filter(Boolean)
                        .join(' · ')}
                    </small>
                  </span>
                </button>
              ))}
            </div>
          </section>
        )}
        {!loading && results.length > 0 && (
          <section className="soverlay__section">
            <h3>Movies & Shows</h3>
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
          </section>
        )}
      </div>
    </div>
  );
}
