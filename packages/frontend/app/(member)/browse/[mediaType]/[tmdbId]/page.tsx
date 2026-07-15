'use client';

import Link from 'next/link';
import { notFound, useParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { MediaType, RequestStatus, TmdbDetail } from '@flux/shared';
import { TmdbTitleDetails } from '@/components/TmdbTitleDetails';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';

function routeMediaType(value: string | string[] | undefined): MediaType | null {
  const segment = Array.isArray(value) ? value[0] : value;
  if (segment === 'movie') return 'MOVIE';
  if (segment === 'tv') return 'SHOW';
  return null;
}

function requestKey(tmdbId: number, mediaType: MediaType): string {
  return `${tmdbId}:${mediaType}`;
}

export default function BrowseTitleDetailsPage() {
  const params = useParams();
  const { activeProfile } = useAuth();
  const mediaType = routeMediaType(params.mediaType);
  const tmdbId = Number(Array.isArray(params.tmdbId) ? params.tmdbId[0] : params.tmdbId);
  const [requests, setRequests] = useState<Map<string, RequestStatus>>(new Map());
  const [requesting, setRequesting] = useState(false);

  if (!mediaType || !Number.isInteger(tmdbId) || tmdbId <= 0) {
    notFound();
  }

  const key = useMemo(() => requestKey(tmdbId, mediaType), [mediaType, tmdbId]);

  useEffect(() => {
    if (!activeProfile) return;
    const controller = new AbortController();
    api.listMyRequests(controller.signal).then(
      (reqs) => {
        const map = new Map<string, RequestStatus>();
        for (const request of reqs) {
          map.set(requestKey(request.tmdbId, request.mediaType), request.status);
        }
        setRequests(map);
      },
      () => {},
    );
    return () => controller.abort();
  }, [activeProfile]);

  const handleRequest = useCallback(async (detail: TmdbDetail) => {
    setRequesting(true);
    try {
      const request = await api.createRequest({
        tmdbId: detail.tmdbId,
        mediaType: detail.mediaType,
        title: detail.title,
      });
      setRequests((prev) => new Map(prev).set(requestKey(request.tmdbId, request.mediaType), request.status));
    } finally {
      setRequesting(false);
    }
  }, []);

  return (
    <div className="tmdb-page-shell">
      <Link className="player-back" href="/browse">
        ← Back to requests
      </Link>
      <TmdbTitleDetails
        tmdbId={tmdbId}
        mediaType={mediaType}
        variant="page"
        requestStatus={requests.get(key) ?? null}
        requesting={requesting}
        onRequest={(detail) => void handleRequest(detail)}
      />
    </div>
  );
}
