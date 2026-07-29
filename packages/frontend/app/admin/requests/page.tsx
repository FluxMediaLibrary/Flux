'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import type { MediaType, RequestDTO, RequestStatus, TorrentStatus } from '@flux/shared';
import { api, FluxApiError } from '@/lib/api';
import { PageHeader } from '@/components/admin/AdminUI';

const TMDB_POSTER = 'https://image.tmdb.org/t/p/w154';

const STATUS_LABEL: Record<RequestStatus, string> = {
  PENDING: 'Pending',
  APPROVED: 'Approved',
  DOWNLOADING: 'Downloading',
  FULFILLED: 'Fulfilled',
  REJECTED: 'Rejected',
};

const TORRENT_STATUS_LABEL: Record<TorrentStatus, string> = {
  PENDING_CONFIRM: 'Pending confirm',
  DOWNLOADING: 'Downloading',
  PROCESSING: 'Processing',
  SEEDING: 'Seeding',
  STOPPED: 'Stopped',
  ERROR: 'Error',
};

const STATUS_OPTIONS = ['ALL', 'PENDING', 'APPROVED', 'DOWNLOADING', 'FULFILLED', 'REJECTED'] as const;
type StatusFilter = (typeof STATUS_OPTIONS)[number];
type TypeFilter = 'ALL' | MediaType;

const STATUS_FILTER_LABEL: Record<StatusFilter, string> = {
  ALL: 'All',
  PENDING: 'Pending',
  APPROVED: 'Approved',
  DOWNLOADING: 'Downloading',
  FULFILLED: 'Fulfilled',
  REJECTED: 'Rejected',
};

function formatDate(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleString();
}

function formatShortDate(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function formatPercent(value: number): string {
  return `${Math.round(Math.max(0, Math.min(1, value)) * 100)}%`;
}

function statusTone(status: RequestStatus): 'pending' | 'approved' | 'active' | 'ok' | 'bad' {
  if (status === 'PENDING') return 'pending';
  if (status === 'APPROVED') return 'approved';
  if (status === 'DOWNLOADING') return 'active';
  if (status === 'FULFILLED') return 'ok';
  return 'bad';
}

function torrentTone(status: TorrentStatus): 'active' | 'ok' | 'bad' | 'idle' {
  if (status === 'SEEDING') return 'ok';
  if (status === 'ERROR') return 'bad';
  if (status === 'DOWNLOADING' || status === 'PROCESSING') return 'active';
  return 'idle';
}

function requestTargetLabel(request: RequestDTO): string {
  if (request.mediaType !== 'SHOW' || !request.season) return request.mediaType === 'SHOW' ? 'Series' : 'Movie';
  return `S${request.season}${request.episode ? ` E${request.episode}` : ''}`;
}

function titleDetailHref(request: RequestDTO): string {
  return `/browse/${request.mediaType === 'SHOW' ? 'tv' : 'movie'}/${request.tmdbId}`;
}

function libraryFocusHref(request: RequestDTO): string {
  const params = new URLSearchParams({
    tmdbId: String(request.tmdbId),
    type: request.mediaType,
    issue: 'ALL',
  });
  return `/admin/library?${params.toString()}`;
}

function torrentFulfillHref(request: RequestDTO): string {
  const params = new URLSearchParams({
    request: request.id,
    tmdbId: String(request.tmdbId),
    type: request.mediaType,
    title: request.title,
  });
  if (request.mediaType === 'SHOW' && request.season) params.set('season', String(request.season));
  if (request.mediaType === 'SHOW' && request.season && request.episode) params.set('episode', String(request.episode));
  return `/admin/downloads?${params.toString()}`;
}

function parseStatus(value: string | null): StatusFilter {
  return STATUS_OPTIONS.includes(value as StatusFilter) ? (value as StatusFilter) : 'ALL';
}

function countStatus(requests: RequestDTO[], status: StatusFilter): number {
  return status === 'ALL' ? requests.length : requests.filter((request) => request.status === status).length;
}

export default function AdminRequestsPage() {
  const searchParams = useSearchParams();
  const queryFilter = parseStatus(searchParams.get('status'));
  const [requests, setRequests] = useState<RequestDTO[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>(queryFilter);
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('ALL');
  const [genreFilter, setGenreFilter] = useState('ALL');
  const [query, setQuery] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [syncingFulfilled, setSyncingFulfilled] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      setRequests(await api.listAllRequests());
    } catch (err) {
      setError(err instanceof FluxApiError ? err.message : 'Failed to load requests.');
      setRequests((prev) => prev ?? []);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    setStatusFilter(queryFilter);
  }, [queryFilter]);

  async function approve(id: string) {
    setBusyId(id);
    setNotice(null);
    setError(null);
    try {
      const updated = await api.approveRequest(id);
      setRequests((prev) => (prev ?? []).map((request) => (request.id === updated.id ? { ...request, ...updated } : request)));
    } catch (err) {
      setError(err instanceof FluxApiError ? err.message : 'Failed to approve request.');
    } finally {
      setBusyId(null);
    }
  }

  async function reject(id: string) {
    setBusyId(id);
    setNotice(null);
    setError(null);
    try {
      const updated = await api.rejectRequest(id);
      setRequests((prev) => (prev ?? []).map((request) => (request.id === updated.id ? { ...request, ...updated } : request)));
    } catch (err) {
      setError(err instanceof FluxApiError ? err.message : 'Failed to reject request.');
    } finally {
      setBusyId(null);
    }
  }

  async function syncFulfilled() {
    setSyncingFulfilled(true);
    setNotice(null);
    setError(null);
    try {
      const result = await api.syncFulfilledRequests();
      setNotice(
        `Checked ${result.scanned.toLocaleString()} active request${result.scanned === 1 ? '' : 's'} and marked ${result.fulfilled.toLocaleString()} fulfilled.`,
      );
      await load();
    } catch (err) {
      setError(err instanceof FluxApiError ? err.message : 'Failed to sync fulfilled requests.');
    } finally {
      setSyncingFulfilled(false);
    }
  }

  const allRequests = requests ?? [];
  const genres = useMemo(() => {
    const counts = new Map<string, number>();
    for (const request of allRequests) {
      for (const genre of request.genres ?? []) counts.set(genre, (counts.get(genre) ?? 0) + 1);
    }
    return Array.from(counts.entries()).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  }, [allRequests]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return allRequests.filter((request) => {
      if (statusFilter !== 'ALL' && request.status !== statusFilter) return false;
      if (typeFilter !== 'ALL' && request.mediaType !== typeFilter) return false;
      if (genreFilter !== 'ALL' && !(request.genres ?? []).includes(genreFilter)) return false;
      if (!needle) return true;
      return [
        request.title,
        request.requestedBy?.profileName,
        request.requestedBy?.accountEmail,
        request.torrent?.name,
        ...(request.genres ?? []),
      ].some((value) => value?.toLowerCase().includes(needle));
    });
  }, [allRequests, genreFilter, query, statusFilter, typeFilter]);

  const priority = useMemo(
    () => allRequests.filter((request) => request.status === 'PENDING' || request.status === 'APPROVED' || request.status === 'DOWNLOADING'),
    [allRequests],
  );

  return (
    <div className="admin-requests-page control-page">
      <PageHeader title="Requests" description="Review demand, filter by genre, and move approved titles into acquisition." actions={
        <button type="button" className="control-button" onClick={() => void syncFulfilled()} disabled={syncingFulfilled}>
          {syncingFulfilled ? 'Checking...' : 'Sync fulfilled'}
        </button>
      } />

      {error && <div className="form-error">{error}</div>}
      {notice && <div className="admin-notice">{notice}</div>}

      <section className="request-command-panel" aria-label="Request filters">
        <div className="request-status-strip">
          {STATUS_OPTIONS.map((status) => (
            <button
              key={status}
              type="button"
              className={`request-status-tab${statusFilter === status ? ' active' : ''}`}
              onClick={() => setStatusFilter(status)}
            >
              <span>{STATUS_FILTER_LABEL[status]}</span>
              <strong>{requests === null ? '-' : countStatus(allRequests, status).toLocaleString()}</strong>
            </button>
          ))}
        </div>

        <div className="request-filter-grid">
          <label className="request-search">
            <span>Search</span>
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Title, requester, torrent, genre"
            />
          </label>
          <label>
            <span>Type</span>
            <select value={typeFilter} onChange={(event) => setTypeFilter(event.target.value as TypeFilter)}>
              <option value="ALL">All media</option>
              <option value="MOVIE">Movies</option>
              <option value="SHOW">TV shows</option>
            </select>
          </label>
          <label>
            <span>Genre</span>
            <select value={genreFilter} onChange={(event) => setGenreFilter(event.target.value)}>
              <option value="ALL">All genres</option>
              {genres.map(([genre, count]) => (
                <option key={genre} value={genre}>{genre} ({count})</option>
              ))}
            </select>
          </label>
          <button
            type="button"
            className="request-clear-button"
            onClick={() => {
              setStatusFilter('ALL');
              setTypeFilter('ALL');
              setGenreFilter('ALL');
              setQuery('');
            }}
          >
            Reset
          </button>
        </div>

        {genres.length > 0 && (
          <div className="request-genre-rail" aria-label="Genre shortcuts">
            {genres.slice(0, 14).map(([genre, count]) => (
              <button
                key={genre}
                type="button"
                className={genreFilter === genre ? 'active' : undefined}
                onClick={() => setGenreFilter(genreFilter === genre ? 'ALL' : genre)}
              >
                {genre}<span>{count}</span>
              </button>
            ))}
          </div>
        )}
      </section>

      <div className="request-ops-grid">
        <section className="request-queue-panel" aria-label="Request queue">
          <div className="request-section-head">
            <div>
              <span className="dim">Queue</span>
              <strong>{filtered.length.toLocaleString()} shown</strong>
            </div>
            <span>{priority.length.toLocaleString()} active workflow{priority.length === 1 ? '' : 's'}</span>
          </div>

          {requests === null ? (
            <div className="empty">
              <div className="spinner" style={{ margin: '0 auto 12px' }} aria-hidden />
              Loading requests...
            </div>
          ) : filtered.length === 0 ? (
            <div className="request-empty">No requests match the current filters.</div>
          ) : (
            <div className="request-card-list">
              {filtered.map((request) => (
                <RequestCard
                  key={request.id}
                  request={request}
                  busy={busyId === request.id}
                  onApprove={() => void approve(request.id)}
                  onReject={() => void reject(request.id)}
                />
              ))}
            </div>
          )}
        </section>

        <aside className="request-side-panel" aria-label="Request summary">
          <div className="request-side-card">
            <span className="dim">Needs decision</span>
            <strong>{countStatus(allRequests, 'PENDING').toLocaleString()}</strong>
            <small>Pending approval or rejection</small>
          </div>
          <div className="request-side-card">
            <span className="dim">Ready to acquire</span>
            <strong>{countStatus(allRequests, 'APPROVED').toLocaleString()}</strong>
            <small>Approved titles without a fulfilled library match</small>
          </div>
          <div className="request-side-card">
            <span className="dim">In motion</span>
            <strong>{countStatus(allRequests, 'DOWNLOADING').toLocaleString()}</strong>
            <small>Linked to active acquisition jobs</small>
          </div>
          <div className="request-side-card">
            <span className="dim">Top genres</span>
            <div className="request-top-genres">
              {genres.slice(0, 6).map(([genre, count]) => (
                <button key={genre} type="button" onClick={() => setGenreFilter(genre)}>
                  <span>{genre}</span><strong>{count}</strong>
                </button>
              ))}
              {genres.length === 0 && <small>No genre data loaded.</small>}
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}

function RequestCard({
  request,
  busy,
  onApprove,
  onReject,
}: {
  request: RequestDTO;
  busy: boolean;
  onApprove: () => void;
  onReject: () => void;
}) {
  const posterUrl = request.posterPath ? `${TMDB_POSTER}${request.posterPath}` : null;
  return (
    <article className={`request-card tone-${statusTone(request.status)}`}>
      <Link href={titleDetailHref(request)} className="request-poster" aria-label={`Open ${request.title}`}>
        {posterUrl ? <Image src={posterUrl} alt="" width={54} height={81} sizes="54px" /> : <span>{request.mediaType === 'SHOW' ? 'TV' : 'MOV'}</span>}
      </Link>
      <div className="request-main">
        <div className="request-title-line">
          <Link href={titleDetailHref(request)}>{request.title}</Link>
          <span>{request.year ?? requestTargetLabel(request)}</span>
        </div>
        <div className="request-meta-line">
          <span className="pill cat">{request.mediaType === 'SHOW' ? 'TV' : 'Movie'}</span>
          <span className={`request-status-pill tone-${statusTone(request.status)}`}>{STATUS_LABEL[request.status]}</span>
          <span>{requestTargetLabel(request)}</span>
          <time title={formatDate(request.createdAt)}>{formatShortDate(request.createdAt)}</time>
        </div>
        <div className="request-genre-line">
          {(request.genres ?? []).slice(0, 5).map((genre) => <span key={genre}>{genre}</span>)}
          {(request.genres ?? []).length === 0 && <span>No genre data</span>}
        </div>
        <div className="request-requester">
          {request.requestedBy ? (
            <>
              <strong>{request.requestedBy.profileName}</strong>
              <span>{request.requestedBy.accountEmail}</span>
            </>
          ) : (
            <span>Requester unavailable</span>
          )}
        </div>
      </div>
      <div className="request-acquisition-cell">
        {request.torrent ? (
          <div className="request-acq-card">
            <span className={`request-status-pill tone-${torrentTone(request.torrent.status)}`}>
              {TORRENT_STATUS_LABEL[request.torrent.status]}
            </span>
            <strong title={request.torrent.name}>{request.torrent.name}</strong>
            {request.torrent.status === 'DOWNLOADING' && (
              <div className="request-mini-progress" aria-label={`Download ${formatPercent(request.torrent.progress)}`}>
                <span style={{ width: formatPercent(request.torrent.progress) }} />
              </div>
            )}
            {request.torrent.status === 'ERROR' && request.torrent.errorMessage && (
              <small title={request.torrent.errorMessage}>{request.torrent.errorMessage}</small>
            )}
          </div>
        ) : (
          <div className="request-acq-card muted">
            <span>No acquisition linked</span>
            <Link href={libraryFocusHref(request)}>Library health</Link>
          </div>
        )}
      </div>
      <div className="request-actions">
        {request.status === 'PENDING' && (
          <>
            <button type="button" className="request-action primary" onClick={onApprove} disabled={busy}>
              {busy ? 'Working' : 'Approve'}
            </button>
            <button type="button" className="request-action danger" onClick={onReject} disabled={busy}>
              {busy ? 'Working' : 'Reject'}
            </button>
          </>
        )}
        {request.status === 'APPROVED' && (
          <a href={torrentFulfillHref(request)} className="request-action primary">
            Fulfill
          </a>
        )}
        {request.status !== 'PENDING' && request.status !== 'APPROVED' && (
          <Link href={libraryFocusHref(request)} className="request-action">
            Inspect
          </Link>
        )}
      </div>
    </article>
  );
}
