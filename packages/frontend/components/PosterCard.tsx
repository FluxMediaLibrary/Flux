'use client';

import type { Ref } from 'react';

const POSTER_BASE = 'https://image.tmdb.org/t/p/w342';

export interface PosterCardProps {
  posterPath: string | null;
  title: string;
  /** Secondary line, e.g. "2008–2013". */
  meta?: string;
  watched?: boolean;
  /** Unplayed episode count (shows). */
  count?: number | null;
  /** Upper-left labels, e.g. ["4K", "HDR"]. */
  tags?: string[];
  selected?: boolean;
  cardRef?: Ref<HTMLButtonElement>;
  onClick?: () => void;
  onHover?: () => void;
}

const Check = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
    <path d="M20 6 9 17l-5-5" />
  </svg>
);

export function PosterCard({
  posterPath,
  title,
  meta,
  watched,
  count,
  tags,
  selected,
  cardRef,
  onClick,
  onHover,
}: PosterCardProps) {
  return (
    <button
      ref={cardRef}
      type="button"
      className={`pcard${selected ? ' selected' : ''}`}
      onClick={onClick}
      onMouseEnter={onHover}
      onFocus={onHover}
    >
      <div className="pcard__art">
        {posterPath ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={`${POSTER_BASE}${posterPath}`} alt={title} loading="lazy" />
        ) : (
          <div className="pcard__ph">{title}</div>
        )}
        <div className="pcard__grad" />
        <div className="pcard__badges">
          <div className="pcard__badges-l">
            {tags?.map((t) => (
              <span key={t} className="badge2 accent">{t}</span>
            ))}
          </div>
          <div className="pcard__badges-r">
            {watched ? (
              <span className="badge2 watched" title="Watched">{Check}</span>
            ) : count && count > 0 ? (
              <span className="badge2 count" title={`${count} unplayed`}>{count}</span>
            ) : null}
          </div>
        </div>
      </div>
      <div className="pcard__title">{title}</div>
      {meta && <div className="pcard__meta">{meta}</div>}
    </button>
  );
}
