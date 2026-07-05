import type { Metadata } from 'next';
import { PlaceholderPage } from '@/components/PlaceholderPage';

export const metadata: Metadata = { title: 'Browse / Request' };

/**
 * TODO(phase-5): TMDb request browser.
 *  - Search + genre filter via backend TMDb proxy (GET /api/tmdb/search, /api/tmdb/genres).
 *  - Result cards (TmdbSearchResult): if `inLibrary` show Play -> /watch/[mediaItemId],
 *    else Request -> POST /api/requests (CreateRequestRequest, per active profile).
 *  - Detail view (TmdbDetail): poster/backdrop, synopsis, cast, YouTube trailer embed.
 */
export default function BrowsePage() {
  return (
    <PlaceholderPage
      title="Browse & Request"
      todo="phase-5 — full TMDb browser: search, genre filter, and per-title Play (in library) vs Request (not yet acquired)."
    />
  );
}
