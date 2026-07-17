'use client';

import { useRef } from 'react';
import { useSearchParams } from 'next/navigation';
import { UploadConfirm } from './UploadConfirm';
import { TorrentDashboard } from './TorrentDashboard';
import type { InitialTorrentMatch } from './UploadConfirm';
import type { MediaType } from '@flux/shared';
import { PageHeader } from '@/components/admin/AdminUI';

/**
 * Admin torrent acquisition surface (spec §4.1):
 *  - Upload a .torrent → confirm TMDb match + episode mapping → start download.
 *  - Live progress / seeding dashboard polling GET /api/torrents.
 *
 * Gated by the admin layout's <RequireAdmin> guard (app/admin/layout.tsx).
 */
export function TorrentsAdmin() {
  const searchParams = useSearchParams();
  const initialRequestId = searchParams.get('request') ?? undefined;
  const initialMatch = parseInitialMatch(searchParams);
  // Bridge: let the confirm flow force an immediate dashboard refresh instead of
  // waiting for the next poll tick.
  const refreshRef = useRef<() => void>(() => {});

  return (
    <div className="torrents-page control-page">
      <PageHeader title="Downloads" description="Acquisition, transfer progress, processing, and failed job recovery." />

      <UploadConfirm
        initialRequestId={initialRequestId}
        initialMatch={initialMatch}
        onConfirmed={() => refreshRef.current()}
      />

      <TorrentDashboard
        registerRefresh={(fn) => {
          refreshRef.current = fn;
        }}
      />
    </div>
  );
}

function parseInitialMatch(searchParams: URLSearchParams): InitialTorrentMatch | undefined {
  const rawTmdbId = searchParams.get('tmdbId');
  const rawType = searchParams.get('type');
  const title = searchParams.get('title');
  const rawYear = searchParams.get('year');
  const rawSeason = searchParams.get('season');
  const rawEpisode = searchParams.get('episode');
  const tmdbId = Number(rawTmdbId);
  const mediaType = rawType === 'MOVIE' || rawType === 'SHOW' ? rawType : null;
  const year = rawYear ? Number(rawYear) : null;
  const season = rawSeason ? Number(rawSeason) : null;
  const episode = rawEpisode ? Number(rawEpisode) : null;
  const initialSeason = mediaType === 'SHOW' && season !== null && Number.isInteger(season) && season > 0
    ? season
    : null;
  const initialEpisode = initialSeason !== null && episode !== null && Number.isInteger(episode) && episode > 0
    ? episode
    : null;

  if (!Number.isInteger(tmdbId) || tmdbId <= 0 || !mediaType || !title) {
    return undefined;
  }

  return {
    tmdbId,
    mediaType: mediaType as MediaType,
    title,
    year: Number.isInteger(year) ? year : null,
    season: initialSeason,
    episode: initialEpisode,
  };
}
