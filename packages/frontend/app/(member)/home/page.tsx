'use client';

import { useAuth } from '@/lib/auth-context';

/**
 * Plex-like homepage shell, scoped to the active profile.
 *
 * TODO(phase-4): Replace skeleton rails with live data from
 *   GET /api/home  ->  HomeRowsDTO (continueWatching, recentlyAdded, byGenre).
 *   Render MediaItem posters (next/image, image.tmdb.org) linking to /library/[id].
 */
const SKELETON_ROWS = ['Continue Watching', 'Recently Added', 'Action', 'Comedy'];

export default function HomePage() {
  const { activeProfile } = useAuth();

  return (
    <div>
      <h1 style={{ fontSize: '1.9rem', marginBottom: 4 }}>
        Welcome back{activeProfile ? `, ${activeProfile.name}` : ''}
      </h1>
      <p className="muted" style={{ marginBottom: 28 }}>
        <span className="tag">TODO</span> phase-4 — wire these rows to
        <span className="code" style={{ marginLeft: 6 }}>
          GET /api/home
        </span>
      </p>

      {SKELETON_ROWS.map((title) => (
        <section className="row" key={title}>
          <h2>{title}</h2>
          <div className="rail">
            {Array.from({ length: 8 }).map((_, i) => (
              <div className="poster-skel" key={i} />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
