'use client';

export type SortKey = 'title' | 'year' | 'added';
export type WatchFilter = 'all' | 'unwatched' | 'watched';

const SORTS: Record<SortKey, string> = {
  title: 'A–Z',
  year: 'Year',
  added: 'Recently Added',
};
const FILTERS: Record<WatchFilter, string> = {
  all: 'All',
  unwatched: 'Unwatched',
  watched: 'Watched',
};

const cycle = <T extends string>(order: T[], cur: T): T =>
  order[(order.indexOf(cur) + 1) % order.length] as T;

/** Minimal glass toolbar: grid view, sort, watched-filter (icon buttons). */
export function FilterToolbar({
  sort,
  onSort,
  filter,
  onFilter,
}: {
  sort: SortKey;
  onSort: (s: SortKey) => void;
  filter: WatchFilter;
  onFilter: (f: WatchFilter) => void;
}) {
  return (
    <div className="ftoolbar" role="group" aria-label="View options">
      <button className="ftoolbar__btn active" title="Grid view" aria-label="Grid view">
        <IconGrid />
      </button>
      <span className="ftoolbar__sep" />
      <button
        className={`ftoolbar__btn${sort !== 'title' ? ' active' : ''}`}
        onClick={() => onSort(cycle(['title', 'year', 'added'], sort))}
        title={`Sort: ${SORTS[sort]}`}
      >
        <IconSort />
        {SORTS[sort]}
      </button>
      <button
        className={`ftoolbar__btn${filter !== 'all' ? ' active' : ''}`}
        onClick={() => onFilter(cycle(['all', 'unwatched', 'watched'], filter))}
        title={`Filter: ${FILTERS[filter]}`}
      >
        <IconFilter />
        {FILTERS[filter]}
      </button>
    </div>
  );
}

const ico = { fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' } as const;
const IconGrid = () => (<svg viewBox="0 0 24 24" {...ico}><rect x="3" y="3" width="7" height="7" rx="1.5" /><rect x="14" y="3" width="7" height="7" rx="1.5" /><rect x="3" y="14" width="7" height="7" rx="1.5" /><rect x="14" y="14" width="7" height="7" rx="1.5" /></svg>);
const IconSort = () => (<svg viewBox="0 0 24 24" {...ico}><path d="M7 4v16M7 4 4 8M7 4l3 4" /><path d="M17 20V4M17 20l-3-4M17 20l3-4" /></svg>);
const IconFilter = () => (<svg viewBox="0 0 24 24" {...ico}><path d="M3 5h18l-7 8v6l-4-2v-4L3 5Z" /></svg>);
