'use client';

import { useCallback, useEffect, useState } from 'react';
import type { RequestDTO, RequestStatus } from '@flux/shared';
import { api, FluxApiError } from '@/lib/api';

// ─── Constants ────────────────────────────────────────────────────────────────

const STATUS_LABEL: Record<RequestStatus, string> = {
  PENDING: 'Pending',
  APPROVED: 'Approved',
  DOWNLOADING: 'Downloading',
  FULFILLED: 'Fulfilled',
  REJECTED: 'Rejected',
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

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function AdminRequestsPage() {
  const [requests, setRequests] = useState<RequestDTO[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>('ALL');
  const [busyId, setBusyId] = useState<string | null>(null);

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

  async function approve(id: string) {
    setBusyId(id);
    try {
      const updated = await api.approveRequest(id);
      setRequests((prev) =>
        (prev ?? []).map((r) => (r.id === updated.id ? updated : r)),
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
    try {
      const updated = await api.rejectRequest(id);
      setRequests((prev) =>
        (prev ?? []).map((r) => (r.id === updated.id ? updated : r)),
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

  const filtered =
    requests?.filter((r) => filter === 'ALL' || r.status === filter) ?? [];

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div>
      <div className="section-head">
        <h1>Member Requests</h1>
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
                <th>Date</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => (
                <tr key={r.id}>
                  <td>
                    <span style={{ fontWeight: 600 }}>{r.title}</span>
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
                        href="/admin/torrents"
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
    </div>
  );
}
