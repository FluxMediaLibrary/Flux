'use client';

import { useRef } from 'react';
import { UploadConfirm } from './UploadConfirm';
import { TorrentDashboard } from './TorrentDashboard';

/**
 * Admin torrent acquisition surface (spec §4.1):
 *  - Upload a .torrent → confirm TMDb match + episode mapping → start download.
 *  - Live progress / seeding dashboard polling GET /api/torrents.
 *
 * Gated by the admin layout's <RequireAdmin> guard (app/admin/layout.tsx).
 */
export function TorrentsAdmin() {
  // Bridge: let the confirm flow force an immediate dashboard refresh instead of
  // waiting for the next poll tick.
  const refreshRef = useRef<() => void>(() => {});

  return (
    <div className="torrents-page">
      <div className="section-head">
        <h1>Torrents</h1>
      </div>

      <UploadConfirm onConfirmed={() => refreshRef.current()} />

      <TorrentDashboard
        registerRefresh={(fn) => {
          refreshRef.current = fn;
        }}
      />
    </div>
  );
}
