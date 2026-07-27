'use client';

import { useCallback, useEffect, useState } from 'react';
import type { AdminInfoDTO, StorageRootDTO } from '@flux/shared';
import { api, FluxApiError } from '@/lib/api';
import { formatBytes } from '@/lib/format';
import { ConfirmDialog, LoadingState, PageError, PageHeader, StatusBadge } from '@/components/admin/AdminUI';

type CacheAction = 'stale' | 'all';

function percent(root: StorageRootDTO): number | null {
  return root.usedBytes !== null && root.totalBytes ? root.usedBytes / root.totalBytes : null;
}

export default function AdminStoragePage() {
  const [info, setInfo] = useState<AdminInfoDTO | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [cacheAction, setCacheAction] = useState<CacheAction | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      setInfo(await api.getAdminSystem());
    } catch (err) {
      setError(err instanceof FluxApiError ? err.message : 'Storage metrics could not be loaded.');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function pruneCache() {
    if (!cacheAction) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const result = await api.pruneTranscodeCache(cacheAction === 'stale' ? 30 * 60 : 0);
      setNotice(
        `Removed ${result.deletedEntries.toLocaleString()} cache entr${result.deletedEntries === 1 ? 'y' : 'ies'} ` +
        `and freed ${formatBytes(result.deletedBytes)}.`,
      );
      setCacheAction(null);
      await load();
    } catch (err) {
      setError(err instanceof FluxApiError ? err.message : 'Transcode cache cleanup failed.');
    } finally {
      setBusy(false);
    }
  }

  const roots = info ? [
    ...info.storage.mediaRoots.map((root, i) => ({
      label: `Media library${info.storage.mediaRoots.length > 1 ? ` (${i + 1})` : ''}`,
      purpose: `Movies, series, and episode files - mount ${i + 1}`,
      root,
    })),
    { label: 'Download staging', purpose: 'Active and completed acquisitions', root: info.storage.downloadRoot },
    { label: 'Transcode cache', purpose: 'Temporary HLS sessions and segments', root: info.storage.transcodeRoot },
  ] : [];

  return (
    <div className="control-page">
      <PageHeader
        title="Storage"
        description="Capacity, mount health, and space consumed by Flux workloads."
        actions={<button className="control-button" onClick={() => void load()}>Refresh volumes</button>}
      />
      {error && <PageError message={error} onRetry={() => void load()} />}
      {notice && <div className="admin-notice">{notice}</div>}
      {!info ? (
        <LoadingState cards={3} />
      ) : (
        <>
          <div className="control-storage-grid">
            {roots.map(({ label, purpose, root }) => {
              const usage = percent(root);
              return (
                <article className="control-panel control-storage-card" key={label}>
                  <header>
                    <div>
                      <strong>{label}</strong>
                      <small>{purpose}</small>
                    </div>
                    <StatusBadge tone={!root.exists ? 'bad' : usage !== null && usage >= .85 ? 'warn' : 'good'}>
                      {!root.exists ? 'Offline' : 'Writable mount'}
                    </StatusBadge>
                  </header>
                  <div className="control-storage-number">
                    {root.usedBytes === null ? '-' : formatBytes(root.usedBytes)} <span>used</span>
                  </div>
                  <div className="control-progress">
                    <span style={{ width: `${Math.round((usage ?? 0) * 100)}%`, background: usage !== null && usage >= .9 ? 'var(--control-bad)' : undefined }} />
                  </div>
                  <div className="control-storage-meta">
                    <span>{usage === null ? 'Unknown capacity' : `${Math.round(usage * 100)}% full`}</span>
                    <span>{root.freeBytes === null ? 'Free space unavailable' : `${formatBytes(root.freeBytes)} free`}</span>
                  </div>
                  <code>{root.path}</code>
                </article>
              );
            })}
          </div>

          <section className="control-section">
            <div className="control-section-heading">
              <h2>Managed storage</h2>
              <span>Measured from the server filesystem</span>
            </div>
            <div className="control-panel control-storage-breakdown">
              <div><span>Movies</span><strong>{info.library.availableMovies}</strong><small>available titles</small></div>
              <div><span>Series</span><strong>{info.library.shows}</strong><small>catalog entries</small></div>
              <div><span>Episodes</span><strong>{info.library.availableEpisodes}</strong><small>available files</small></div>
              <div><span>Transcode cache</span><strong>{formatBytes(info.library.transcodeBytes)}</strong><small>{info.library.transcodeSessions} session folders</small></div>
              <div><span>Broken files</span><strong>{info.library.brokenFiles}</strong><small>database paths missing</small></div>
            </div>
          </section>

          <section className="control-section">
            <div className="control-section-heading">
              <h2>Cleanup</h2>
              <span>Backend-managed file removal</span>
            </div>
            <div className="control-panel control-cleanup-row">
              <div>
                <strong>Transcode cache</strong>
                <small>{formatBytes(info.library.transcodeBytes)} across {info.library.transcodeSessions.toLocaleString()} session folder{info.library.transcodeSessions === 1 ? '' : 's'}</small>
              </div>
              <div className="control-cleanup-actions">
                <button className="control-button" type="button" onClick={() => setCacheAction('stale')} disabled={busy}>
                  Prune stale
                </button>
                <button className="control-button danger" type="button" onClick={() => setCacheAction('all')} disabled={busy}>
                  Clear cache
                </button>
              </div>
            </div>
          </section>
        </>
      )}
      <ConfirmDialog
        open={cacheAction !== null}
        title={cacheAction === 'all' ? 'Clear the transcode cache?' : 'Prune stale transcodes?'}
        description={cacheAction === 'all'
          ? 'This removes every file under the transcode cache root. Active HLS sessions may need to restart.'
          : 'This removes transcode cache entries older than 30 minutes and leaves newer sessions in place.'}
        confirmLabel={cacheAction === 'all' ? 'Clear cache' : 'Prune stale'}
        dangerous={cacheAction === 'all'}
        busy={busy}
        onClose={() => {
          if (!busy) setCacheAction(null);
        }}
        onConfirm={() => void pruneCache()}
      />
    </div>
  );
}
