'use client';

import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import type { RequestDTO, RequestStatus, TorrentStatus } from '@flux/shared';
import { api, FluxApiError } from '@/lib/api';
import { TmdbTitleDetails } from '@/components/TmdbTitleDetails';

// ─── Constants ────────────────────────────────────────────────────────────────

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

const FILTER_OPTIONS = [
  'ALL',
  'PENDING',
  'APPROVED',
  'DOWNLOADING',
  'FULFILLED',
  'REJECTED',
] as const;
type Filter = (typeof FILTER_OPTIONS)[number];

const FILTER_LABEL: Record<Filter, string> = {
  ALL: 'All',
  PENDING: 'Pending',
  APPROVED: 'Approved',
  DOWNLOADING: 'Downloading',
  FULFILLED: 'Fulfilled',
  REJECTED: 'Rejected',
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString();
}

function pillClass(status: RequestStatus): string {
  switch (status) {
    case 'FULFILLED':
      return 'pill ok';
    case 'REJECTED':
      return 'pill err';
    case 'DOWNLOADING':
      return 'pill active';
    default:
      return 'pill';
  }
}

function pillStyle(status: RequestStatus): React.CSSProperties | undefined {
  switch (status) {
    case 'PENDING':
      return { background: 'rgba(255, 180, 84, 0.15)', color: '#ffb454' };
    case 'APPROVED':
      return { background: 'rgba(86, 156, 255, 0.15)', color: '#569cff' };
    default:
      return undefined;
  }
}

function formatPercent(value: number): string {
  return `${Math.round(Math.max(0, Math.min(1, value)) * 100)}%`;
}

function requestTargetLabel(request: RequestDTO): string | null {
  if (request.mediaType !== 'SHOW' || !request.season) return null;
  return `S${request.season}${request.episode ? ` E${request.episode}` : ''}`;
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
  if (request.mediaType === 'SHOW' && request.season) {
    params.set('season', String(request.season));
  }
  if (request.mediaType === 'SHOW' && request.season && request.episode) {
    params.set('episode', String(request.episode));
  }
  return `/admin/torrents?${params.toString()}`;
}

function torrentPillClass(status: TorrentStatus): string {
  switch (status) {
    case 'SEEDING':
      return 'pill ok';
    case 'ERROR':
      return 'pill err';
    case 'DOWNLOADING':
    case 'PROCESSING':
      return 'pill active';
    default:
      return 'pill used';
  }
}

function parseFilter(value: string | null): Filter {
  return FILTER_OPTIONS.includes(value as Filter) ? (value as Filter) : 'ALL';
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function AdminRequestsPage() {
  const searchParams = useSearchParams();
  const queryFilter = parseFilter(searchParams.get('status'));
  const [requests, setRequests] = useState<RequestDTO[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>(queryFilter);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [syncingFulfilled, setSyncingFulfilled] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [detailRequest, setDetailRequest] = useState<RequestDTO | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const list = await api.listAllRequests();
      setRequests(list);
    } catch (err) {
      setError(
        err instanceof FluxApiError
          ? err.message
          : 'Failed to load requests.',
      );
      setRequests((prev) => prev ?? []);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    setFilter(queryFilter);
  }, [queryFilter]);

  async function approve(id: string) {
    setBusyId(id);
    setNotice(null);
    try {
      const updated = await api.approveRequest(id);
      setRequests((prev) =>
        (prev ?? []).map((r) => (r.id === updated.id ? { ...r, ...updated } : r)),
      );
    } catch (err) {
      setError(
        err instanceof FluxApiError
          ? err.message
          : 'Failed to approve request.',
      );
    } finally {
      setBusyId(null);
    }
  }

  async function reject(id: string) {
    setBusyId(id);
    setNotice(null);
    try {
      const updated = await api.rejectRequest(id);
      setRequests((prev) =>
        (prev ?? []).map((r) => (r.id === updated.id ? { ...r, ...updated } : r)),
      );
    } catch (err) {
      setError(
        err instanceof FluxApiError
          ? err.message
          : 'Failed to reject request.',
      );
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
      setError(
        err instanceof FluxApiError
          ? err.message
          : 'Failed to sync fulfilled requests.',
      );
    } finally {
      setSyncingFulfilled(false);
    }
  }

  const filtered =
    requests?.filter((r) => filter === 'ALL' || r.status === filter) ?? [];

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div>
      <div className="section-head">
        <div>
          <h1>Member Requests</h1>
          <p className="muted" style={{ margin: 0 }}>
            Approvals, acquisition handoff, and stale fulfillment repair.
          </p>
        </div>
        <button
          type="button"
          className="btn btn-ghost"
          onClick={() => void syncFulfilled()}
          disabled={syncingFulfilled}
        >
          {syncingFulfilled ? 'Checking...' : 'Sync fulfilled'}
        </button>
      </div>

      {/* Filter tabs */}
      <div className="toggle-group" style={{ marginBottom: 20 }}>
        {FILTER_OPTIONS.map((opt) => (
          <button
            key={opt}
            type="button"
            className={`toggle${filter === opt ? ' active' : ''}`}
            onClick={() => setFilter(opt)}
          >
            {FILTER_LABEL[opt]}
          </button>
        ))}
      </div>

      {error && <div className="form-error">{error}</div>}
      {notice && <div className="admin-notice">{notice}</div>}

      {requests === null ? (
        <div className="empty">
          <div
            className="spinner"
            style={{ margin: '0 auto 12px' }}
            aria-hidden
          />
          Loading requests…
        </div>
      ) : filtered.length === 0 ? (
        <div className="card empty">
          {filter === 'ALL'
            ? 'No requests yet.'
            : `No ${FILTER_LABEL[filter].toLowerCase()} requests.`}
        </div>
      ) : (
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th>Title</th>
                <th>Type</th>
                <th>Status</th>
                <th>Requested by</th>
                <th>Acquisition</th>
                <th>Date</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => (
                <tr key={r.id}>
                  <td>
                    <button
                      type="button"
                      className="request-title-button"
                      onClick={() => setDetailRequest(r)}
                    >
                      {r.title}
                    </button>
                    {requestTargetLabel(r) && (
                      <span className="dim" style={{ marginLeft: 8 }}>
                        {requestTargetLabel(r)}
                      </span>
                    )}
                    <div style={{ marginTop: 6 }}>
                      <a className="inline-link" href={libraryFocusHref(r)}>
                        Library health
                      </a>
                    </div>
                  </td>
                  <td>
                    <span className="pill cat">
                      {r.mediaType === 'SHOW' ? 'TV' : 'Movie'}
                    </span>
                  </td>
                  <td>
                    <span
                      className={pillClass(r.status)}
                      style={pillStyle(r.status)}
                    >
                      {STATUS_LABEL[r.status]}
                    </span>
                  </td>
                  <td>
                    {r.requestedBy ? (
                      <>
                        <span style={{ fontWeight: 600 }}>
                          {r.requestedBy.profileName}
                        </span>
                        <span className="dim" style={{ marginLeft: 8 }}>
                          {r.requestedBy.accountEmail}
                        </span>
                      </>
                    ) : (
                      <span className="dim">—</span>
                    )}
                  </td>
                  <td>
                    {r.torrent ? (
                      <div className="request-acq">
                        <span className={torrentPillClass(r.torrent.status)}>
                          {TORRENT_STATUS_LABEL[r.torrent.status]}
                        </span>
                        <span className="request-acq-title" title={r.torrent.name}>
                          {r.torrent.name}
                        </span>
                        {r.torrent.status === 'DOWNLOADING' && (
                          <span className="dim">{formatPercent(r.torrent.progress)}</span>
                        )}
                        {r.torrent.status === 'ERROR' && r.torrent.errorMessage && (
                          <span className="request-acq-error" title={r.torrent.errorMessage}>
                            {r.torrent.errorMessage}
                          </span>
                        )}
                      </div>
                    ) : (
                      <span className="dim">-</span>
                    )}
                  </td>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    {formatDate(r.createdAt)}
                  </td>
                  <td>
                    {r.status === 'PENDING' && (
                      <div style={{ display: 'flex', gap: 8 }}>
                        <button
                          type="button"
                          className="btn btn-sm"
                          style={{
                            background: 'var(--ok)',
                            color: '#fff',
                            border: 'none',
                            fontWeight: 700,
                          }}
                          onClick={() => void approve(r.id)}
                          disabled={busyId === r.id}
                        >
                          {busyId === r.id ? '…' : 'Approve'}
                        </button>
                        <button
                          type="button"
                          className="btn btn-ghost btn-sm danger"
                          onClick={() => void reject(r.id)}
                          disabled={busyId === r.id}
                        >
                          {busyId === r.id ? '…' : 'Reject'}
                        </button>
                      </div>
                    )}
                    {r.status === 'APPROVED' && (
                      <a
                        href={torrentFulfillHref(r)}
                        className="btn btn-primary btn-sm"
                      >
                        Fulfill via Torrents
                      </a>
                    )}
                    {r.status !== 'PENDING' && r.status !== 'APPROVED' && (
                      <span className="dim">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {detailRequest && (
        <TmdbTitleDetails
          tmdbId={detailRequest.tmdbId}
          mediaType={detailRequest.mediaType}
          requestStatus={detailRequest.status}
          onClose={() => setDetailRequest(null)}
        />
      )}
    </div>
  );
}
