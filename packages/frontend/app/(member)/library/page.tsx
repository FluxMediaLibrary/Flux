'use client';

import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { api } from '@/lib/api';
import { useAmbient } from '@/components/AmbientBackdrop';
import { PosterGrid } from '@/components/PosterGrid';
import { PosterCard } from '@/components/PosterCard';
import { AlphabetIndex } from '@/components/AlphabetIndex';
import { FilterToolbar, type SortKey, type WatchFilter } from '@/components/FilterToolbar';
import type { LibraryItemDTO, MediaType } from '@flux/shared';

type TypeFilter = 'ALL' | MediaType;

function sortTitleKey(title: string): string {
  return title.replace(/^(the|a|an)\s+/i, '').trim().toUpperCase();
}
function letterOf(title: string): string {
  const c = sortTitleKey(title).charAt(0);
  return c >= 'A' && c <= 'Z' ? c : '#';
}

export default function LibraryPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const typeParam = searchParams.get('type'); // movie | tv | null
  const typeFilter: TypeFilter =
    typeParam === 'movie' ? 'MOVIE' : typeParam === 'tv' ? 'SHOW' : 'ALL';

  const [items, setItems] = useState<LibraryItemDTO[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sort, setSort] = useState<SortKey>('title');
  const [watch, setWatch] = useState<WatchFilter>('all');
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const cardRefs = useRef<Map<string, HTMLButtonElement>>(new Map());

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    api
      .listLibrary(typeFilter, controller.signal)
      .then((data) => { setItems(data); setLoading(false); })
      .catch((err: unknown) => {
        if (err instanceof DOMException && err.name === 'AbortError') return;
        setError(err instanceof Error ? err.message : 'Failed to load library.');
        setLoading(false);
      });
    return () => controller.abort();
  }, [typeFilter]);

  // Sort + watched-filter
  const visible = useMemo(() => {
    let list = items;
    if (watch === 'watched') list = list.filter((i) => i.watched);
    else if (watch === 'unwatched') list = list.filter((i) => !i.watched);
    const sorted = [...list];
    if (sort === 'title') sorted.sort((a, b) => sortTitleKey(a.title).localeCompare(sortTitleKey(b.title)));
    else if (sort === 'year') sorted.sort((a, b) => (b.year ?? 0) - (a.year ?? 0));
    else sorted.sort((a, b) => (a.addedAt < b.addedAt ? 1 : -1));
    return sorted;
  }, [items, watch, sort]);

  // Selected item drives the backdrop; default to the first visible item.
  useEffect(() => {
    if (visible.length === 0) { setSelectedId(null); return; }
    setSelectedId((cur) => (cur && visible.some((i) => i.id === cur) ? cur : visible[0]!.id));
  }, [visible]);

  const selected = visible.find((i) => i.id === selectedId) ?? null;
  useAmbient(selected?.backdropPath ?? null);

  const presentLetters = useMemo(() => {
    const set = new Set<string>();
    for (const it of visible) set.add(letterOf(it.title));
    return set;
  }, [visible]);

  const firstIdByLetter = useMemo(() => {
    const map = new Map<string, string>();
    // Match against title order regardless of current sort.
    const byTitle = [...visible].sort((a, b) => sortTitleKey(a.title).localeCompare(sortTitleKey(b.title)));
    for (const it of byTitle) {
      const l = letterOf(it.title);
      if (!map.has(l)) map.set(l, it.id);
    }
    return map;
  }, [visible]);

  const jumpTo = useCallback((letter: string) => {
    const id = firstIdByLetter.get(letter);
    if (id) cardRefs.current.get(id)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [firstIdByLetter]);

  const title =
    typeFilter === 'MOVIE' ? 'Movies' : typeFilter === 'SHOW' ? 'Shows' : 'Library';

  return (
    <div className="lib2">
      <div className="lib2__head">
        <h1 className="lib2__title">{title}</h1>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          {!loading && !error && <span className="lib2__count">{visible.length} titles</span>}
          <FilterToolbar sort={sort} onSort={setSort} filter={watch} onFilter={setWatch} />
        </div>
      </div>

      {error && <div className="form-error">{error}</div>}

      {loading && (
        <PosterGrid>
          {Array.from({ length: 18 }).map((_, i) => (
            <div key={i} className="poster-skel" style={{ borderRadius: 14 }} />
          ))}
        </PosterGrid>
      )}

      {!loading && !error && visible.length === 0 && (
        <div className="state-center">
          {items.length === 0
            ? 'Nothing in the library yet. Browse and request something to fill it.'
            : 'No titles match this filter.'}
        </div>
      )}

      {!loading && visible.length > 0 && (
        <PosterGrid>
          {visible.map((item) => (
            <PosterCard
              key={item.id}
              cardRef={(el) => {
                if (el) cardRefs.current.set(item.id, el);
                else cardRefs.current.delete(item.id);
              }}
              posterPath={item.posterPath}
              title={item.title}
              meta={item.year ? String(item.year) : undefined}
              watched={item.watched}
              count={item.unplayedCount}
              selected={item.id === selectedId}
              onHover={() => setSelectedId(item.id)}
              onClick={() => router.push(`/library/${item.id}`)}
            />
          ))}
        </PosterGrid>
      )}

      {!loading && visible.length > 0 && (
        <AlphabetIndex present={presentLetters} onJump={jumpTo} />
      )}
    </div>
  );
}
