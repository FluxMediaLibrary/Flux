'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { TorrentClientHealthDTO, TorrentDTO, TorrentStatus } from '@flux/shared';
import { api, FluxApiError } from '@/lib/api';
import { useAdminSignal } from '@/components/admin/AdminControlCenter';
import { ConfirmDialog } from '@/components/admin/AdminUI';
import {
  formatBytes,
  formatEta,
  formatPercent,
  formatRatio,
  formatSince,
  formatSpeed,
} from '@/lib/format';

const STATUS_LABEL: Record<TorrentStatus, string> = {
  PENDING_CONFIRM: 'Pending',
  DOWNLOADING: 'Downloading',
  PROCESSING: 'Processing',
  SEEDING: 'Seeding',
  STOPPED: 'Stopped',
  ERROR: 'Error',
};

const REQUEST_STATUS_LABEL = {
  PENDING: 'Pending',
  APPROVED: 'Approved',
  DOWNLOADING: 'Request downloading',
  FULFILLED: 'Request fulfilled',
  REJECTED: 'Rejected',
} as const;

function statusPillClass(status: TorrentStatus): string {
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

/** Imperative handle so the parent can force a refresh after a confirm. */
export interface DashboardHandle {
  refresh: () => void;
}

export function TorrentDashboard({
  registerRefresh,
}: {
  registerRefresh?: (fn: () => void) => void;
}) {
  const [torrents, setTorrents] = useState<TorrentDTO[] | null>(null);
  const [health, setHealth] = useState<TorrentClientHealthDTO | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [removeTarget, setRemoveTarget] = useState<TorrentDTO | null>(null);
  const { signal } = useAdminSignal();

  // Keep a live ref so the polling interval always calls the latest loader.
  const loadRef = useRef<() => void>(() => {});

  const load = useCallback(async (signal?: AbortSignal) => {
    try {
      const [clientHealth, list] = await Promise.all([
        api.torrentHealth(signal),
        api.listTorrents(signal),
      ]);
      if (signal?.aborted) return;
      setHealth(clientHealth);
      setTorrents(list);
      setError(null);
    } catch (err) {
      if (signal?.aborted || (err instanceof DOMException && err.name === 'AbortError')) {
        return;
      }
      setError(
        err instanceof FluxApiError ? err.message : 'Failed to load torrents.',
      );
      setTorrents((prev) => prev ?? []);
    }
  }, []);

  useEffect(() => {
    loadRef.current = () => void load();
  }, [load]);

  // Load once. The shared admin SSE connection drives subsequent snapshots.
  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => {
      controller.abort();
    };
  }, [load]);

  useEffect(() => {
    if (signal) void load();
  }, [signal?.generatedAt, load]);

  // Expose a manual refresh (used right after a confirm).
  useEffect(() => {
    registerRefresh?.(() => loadRef.current());
  }, [registerRefresh]);

  async function stop(t: TorrentDTO) {
    setBusyId(t.id);
    try {
      const updated = await api.stopTorrent(t.id);
      setTorrents((prev) =>
        (prev ?? []).map((x) => (x.id === updated.id ? updated : x)),
      );
    } catch (err) {
      setError(err instanceof FluxApiError ? err.message : 'Failed to stop seeding.');
    } finally {
      setBusyId(null);
    }
  }

  async function retry(t: TorrentDTO) {
    setBusyId(t.id);
    try {
      const updated = await api.retryTorrent(t.id);
      setTorrents((prev) =>
        (prev ?? []).map((x) => (x.id === updated.id ? updated : x)),
      );
    } catch (err) {
      setError(err instanceof FluxApiError ? err.message : 'Failed to retry torrent.');
    } finally {
      setBusyId(null);
    }
  }

  async function remove(t: TorrentDTO) {
    setBusyId(t.id);
    try {
      await api.removeTorrent(t.id);
      setTorrents((prev) => (prev ?? []).filter((x) => x.id !== t.id));
      setRemoveTarget(null);
    } catch (err) {
      setError(err instanceof FluxApiError ? err.message : 'Failed to remove torrent.');
    } finally {
      setBusyId(null);
    }
  }

  return (
    <section className="torrent-dashboard">
      <div className="section-head" style={{ marginBottom: 16 }}>
        <h2 style={{ fontSize: '1.25rem', margin: 0 }}>Active &amp; seeding</h2>
        {torrents !== null && (
          <span className="muted" style={{ fontSize: '0.85rem' }}>
            Live · one shared server event stream
          </span>
        )}
      </div>

      {error && <div className="form-error">{error}</div>}
      {health && !health.ok && (
        <div className="form-error">
          Transmission is not reachable at {health.url}. {health.message}
        </div>
      )}
      {health?.ok && (
        <div className="torrent-client-status">
          Transmission connected{health.version ? ` - ${health.version}` : ''}.
          {health.peerPort ? ` Peer port ${health.peerPort} is ${health.peerPortOpen === false ? 'closed' : health.peerPortOpen === true ? 'open' : 'untested'}.` : ''}
          {health.dhtEnabled === false || health.pexEnabled === false ? ' DHT/PEX peer discovery is disabled.' : ''}
        </div>
      )}

      {torrents === null ? (
        <div className="empty">
          <div className="spinner" style={{ margin: '0 auto 12px' }} aria-hidden />
          Loading torrents…
        </div>
      ) : torrents.length === 0 ? (
        <div className="card empty">No torrents yet. Upload a .torrent to begin.</div>
      ) : (
        <div className="torrent-list">
          {torrents.map((t) => (
            <TorrentCard
              key={t.id}
              torrent={t}
              busy={busyId === t.id}
              onStop={() => void stop(t)}
              onRetry={() => void retry(t)}
              onRemove={() => setRemoveTarget(t)}
            />
          ))}
        </div>
      )}
      <ConfirmDialog
        open={removeTarget !== null}
        title="Remove this download?"
        description={`This stops the torrent and removes its transfer record. Media already imported into the library is kept.${removeTarget?.linkedRequest && removeTarget.linkedRequest.status !== 'FULFILLED' ? ' The linked request will return to approved.' : ''}`}
        confirmLabel="Remove download"
        dangerous
        busy={removeTarget ? busyId === removeTarget.id : false}
        onClose={() => setRemoveTarget(null)}
        onConfirm={() => { if (removeTarget) void remove(removeTarget); }}
      />
    </section>
  );
}

function TorrentCard({
  torrent: t,
  busy,
  onStop,
  onRetry,
  onRemove,
}: {
  torrent: TorrentDTO;
  busy: boolean;
  onStop: () => void;
  onRetry: () => void;
  onRemove: () => void;
}) {
  const isDownloading = t.status === 'DOWNLOADING' || t.status === 'PROCESSING';
  const isSeeding = t.status === 'SEEDING';
  const canRetry = t.status === 'ERROR' || t.status === 'PENDING_CONFIRM';
  const remaining = Math.max(0, t.totalBytes * (1 - t.progress));

  return (
    <article className="torrent-card">
      <header className="torrent-card-head">
        <div className="torrent-title">
          <span className={statusPillClass(t.status)}>{STATUS_LABEL[t.status]}</span>
          <span className="pill cat">{t.category === 'SHOW' ? 'TV' : 'Movie'}</span>
          <span className="torrent-name" title={t.name}>
            {t.name}
          </span>
        </div>
        <div className="torrent-actions">
          {isSeeding && (
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={onStop}
              disabled={busy}
            >
              Stop
            </button>
          )}
          {canRetry && (
            <button
              type="button"
              className="btn btn-primary btn-sm"
              onClick={onRetry}
              disabled={busy}
            >
              {busy ? 'Retrying...' : 'Retry'}
            </button>
          )}
          <button
            type="button"
            className="btn btn-ghost btn-sm danger"
            onClick={onRemove}
            disabled={busy}
          >
            Remove
          </button>
        </div>
      </header>

      {t.status === 'ERROR' && t.errorMessage && (
        <p className="torrent-error">{t.errorMessage}</p>
      )}

      {t.linkedRequest && (
        <div className="torrent-request">
          <span className="pill active">{REQUEST_STATUS_LABEL[t.linkedRequest.status]}</span>
          <span className="torrent-request-title">{t.linkedRequest.title}</span>
          {t.linkedRequest.requestedBy && (
            <span className="dim">
              {t.linkedRequest.requestedBy.profileName}
              {t.linkedRequest.requestedBy.accountEmail
                ? ` - ${t.linkedRequest.requestedBy.accountEmail}`
                : ''}
            </span>
          )}
        </div>
      )}

      {isDownloading && (
        <>
          <div className="progress-track" aria-hidden>
            <div
              className="progress-fill"
              style={{ width: formatPercent(t.progress) }}
            />
          </div>
          <div className="stat-grid">
            <Stat label="Progress" value={formatPercent(t.progress)} />
            <Stat label="Down" value={formatSpeed(t.downloadSpeed)} />
            <Stat label="Peers" value={String(t.peers)} />
            <Stat label="ETA" value={formatEta(remaining, t.downloadSpeed)} />
            <Stat
              label="Size"
              value={`${formatBytes(t.totalBytes - remaining)} / ${formatBytes(t.totalBytes)}`}
            />
          </div>
        </>
      )}

      {isSeeding && (
        <div className="stat-grid">
          <Stat label="Ratio" value={formatRatio(t.ratio)} />
          <Stat label="Uploaded" value={formatBytes(t.uploadedBytes)} />
          <Stat label="Seeding for" value={formatSince(t.seedingSince)} />
          <Stat label="Up" value={formatSpeed(t.uploadSpeed)} />
          <Stat label="Down" value={formatSpeed(t.downloadSpeed)} />
          <Stat label="Peers" value={String(t.peers)} />
        </div>
      )}

      {!isDownloading && !isSeeding && t.status !== 'ERROR' && (
        <div className="stat-grid">
          <Stat label="Size" value={formatBytes(t.totalBytes)} />
          <Stat label="Uploaded" value={formatBytes(t.uploadedBytes)} />
          <Stat label="Ratio" value={formatRatio(t.ratio)} />
        </div>
      )}
    </article>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="stat">
      <span className="stat-label">{label}</span>
      <span className="stat-value">{value}</span>
    </div>
  );
}
