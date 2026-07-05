'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { PlaceholderPage } from '@/components/PlaceholderPage';

/**
 * Library item detail (movie or show).
 *
 * TODO(phase-4): Fetch GET /api/library/:id -> MediaItemDetailDTO.
 *  - Movie: backdrop, metadata, resume/Play -> /watch/[id].
 *  - Show: season/episode list (EpisodeDTO), per-episode Play + progress.
 */
export default function LibraryDetailPage() {
  // Client hook returns params synchronously (avoids Next 16 async `params`).
  const params = useParams<{ id: string }>();
  const id = params.id;

  return (
    <PlaceholderPage
      title="Library item"
      todo={`phase-4 — detail view for media item "${id}" (GET /api/library/:id → MediaItemDetailDTO).`}
    >
      <p style={{ marginTop: 18 }}>
        <Link className="btn btn-primary" href={`/watch/${id}`}>
          ▶ Play (placeholder)
        </Link>
      </p>
    </PlaceholderPage>
  );
}
