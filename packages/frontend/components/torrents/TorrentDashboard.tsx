'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { TorrentDTO, TorrentStatus } from '@flux/shared';
import { api, FluxApiError } from '@/lib/api';
import {
  formatBytes,
  formatEta,
  formatPercent,
  formatRatio,
  formatSince,
  formatSpeed,
} from '@/lib/format';

const POLL_MS = 2000;

const STATUS_LABEL: Record<TorrentStatus, string> = {
  PENDING_CONFIRM: 'Pending',
  DOWNLOADING: 'Downloading',
  PROCESSING: 'Processing',
  SEEDING: 'Seeding',
  STOPPED: 'Stopped',
  ERROR: 'Error',
};

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
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  // Keep a live ref so the polling interval always calls the latest loader.
  const loadRef = useRef<() => void>(() => {});

  const load = useCallback(async (signal?: AbortSignal) => {
    try {
      const list = await api.listTorrents(signal);
      if (signal?.aborted) return;
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

  // Poll every ~2s. Abort the in-flight request and clear the interval on unmount.
  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    const id = setInterval(() => {
      void load(controller.signal);
    }, POLL_MS);
    return () => {
      clearInterval(id);
      controller.abort();
    };
  }, [load]);

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

  async function remove(t: TorrentDTO) {
    if (!window.confirm(`Remove "${t.name}"? This stops seeding and deletes the torrent.`)) {
      return;
    }
    setBusyId(t.id);
    try {
      await api.removeTorrent(t.id);
      setTorrents((prev) => (prev ?? []).filter((x) => x.id !== t.id));
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
            Live · updates every {POLL_MS / 1000}s
          </span>
        )}
      </div>

      {error && <div className="form-error">{error}</div>}

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
              onRemove={() => void remove(t)}
            />
          ))}
        </div>
      )}
    </section>
  );
}

function TorrentCard({
  torrent: t,
  busy,
  onStop,
  onRemove,
}: {
  torrent: TorrentDTO;
  busy: boolean;
  onStop: () => void;
  onRemove: () => void;
}) {
  const isDownloading = t.status === 'DOWNLOADING' || t.status === 'PROCESSING';
  const isSeeding = t.status === 'SEEDING';
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
