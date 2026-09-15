'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import type { AdminInfoDTO, StorageOverviewDTO, StoragePlacementPlanDTO, StorageVolumeDTO } from '@flux/shared';
import { api, FluxApiError } from '@/lib/api';
import { formatBytes } from '@/lib/format';
import { ConfirmDialog, LoadingState, PageError, PageHeader, StatusBadge } from '@/components/admin/AdminUI';

type CacheAction = 'stale' | 'all';

const GIB = 1024 ** 3;

function roleLabel(volume: StorageVolumeDTO): { label: string; purpose: string } {
  switch (volume.role) {
    case 'media': return { label: 'Media root', purpose: 'Movies and series files' };
    case 'download': return { label: 'Downloads', purpose: 'Active and completed acquisitions' };
    default: return { label: 'Transcode cache', purpose: 'Temporary HLS sessions and segments' };
  }
}

function healthTone(health: StorageVolumeDTO['health']): 'good' | 'warn' | 'bad' {
  if (health === 'HEALTHY') return 'good';
  if (health === 'WARNING') return 'warn';
  return 'bad';
}

function healthLabel(health: StorageVolumeDTO['health']): string {
  switch (health) {
    case 'HEALTHY': return 'Writable';
    case 'WARNING': return 'Nearly full';
    case 'FULL': return 'No usable space';
    case 'READ_ONLY': return 'Read-only';
    default: return 'Offline';
  }
}

export default function AdminStoragePage() {
  const [overview, setOverview] = useState<StorageOverviewDTO | null>(null);
  const [info, setInfo] = useState<AdminInfoDTO | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [cacheAction, setCacheAction] = useState<CacheAction | null>(null);
  const [busy, setBusy] = useState(false);
  const [planGb, setPlanGb] = useState(10);
  const [plan, setPlan] = useState<StoragePlacementPlanDTO | null>(null);
  const [planning, setPlanning] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [next, system] = await Promise.all([api.getAdminStorage(), api.getAdminSystem()]);
      setOverview(next);
      setInfo(system);
      setPlan(next.samplePlacement);
      setPlanGb(Math.round(next.samplePlacement.requiredBytes / GIB) || 10);
    } catch (err) {
      setError(err instanceof FluxApiError ? err.message : 'Storage metrics could not be loaded.');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function runPlan() {
    setPlanning(true);
    try {
      setPlan(await api.getStoragePlacementPlan(Math.max(0, planGb) * GIB));
    } catch (err) {
      setError(err instanceof FluxApiError ? err.message : 'Placement check failed.');
    } finally {
      setPlanning(false);
    }
  }

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

  const mediaRootCount = overview?.volumes.filter((volume) => volume.role === 'media').length ?? 0;

  return (
    <div className="control-page">
      <PageHeader
        title="Storage"
        description="Capacity, reserve, write health and where the next import will land."
        actions={<button className="control-button" onClick={() => void load()}>Refresh volumes</button>}
      />
      {error && <PageError message={error} onRetry={() => void load()} />}
      {notice && <div className="admin-notice">{notice}</div>}
      {!overview || !info ? (
        <LoadingState cards={3} />
      ) : (
        <>
          <section className="control-section">
            <div className="control-section-heading">
              <h2>Policy</h2>
              <span>Authoritative for downloads, imports and diagnostics</span>
            </div>
            <div className="control-panel control-storage-breakdown">
              <div><span>Reserved free space</span><strong>{overview.policy.reservedFreeSpaceGb} GB</strong><small>kept free on every volume</small></div>
              <div><span>Placement</span><strong>{overview.policy.placementStrategy === 'MOST_FREE' ? 'Most free first' : 'Preferred first'}</strong><small>{overview.policy.preferredMediaRoot ?? 'no preferred root'}</small></div>
              <div><span>Media roots</span><strong>{mediaRootCount}</strong><small>configured via MEDIA_ROOTS</small></div>
              <div><span>Broken files</span><strong>{info.library.brokenFiles}</strong><small>database paths missing</small></div>
              <div className="control-storage-breakdown-action"><Link className="control-button" href="/admin/settings?tab=storage">Edit storage policy</Link></div>
            </div>
          </section>

          <div className="control-storage-grid">
            {overview.volumes.map((volume, index) => {
              const { label, purpose } = roleLabel(volume);
              const mediaIndex = overview.volumes.filter((entry, i) => entry.role === 'media' && i < index).length + 1;
              const used = volume.totalBytes !== null && volume.freeBytes !== null ? volume.totalBytes - volume.freeBytes : null;
              return (
                <article className="control-panel control-storage-card" key={`${volume.role}-${volume.path}`}>
                  <header>
                    <div>
                      <strong>{label}{volume.role === 'media' && mediaRootCount > 1 ? ` ${mediaIndex}` : ''}{volume.isPreferred ? ' · preferred' : ''}</strong>
                      <small>{purpose}</small>
                    </div>
                    <StatusBadge tone={healthTone(volume.health)}>{healthLabel(volume.health)}</StatusBadge>
                  </header>
                  <div className="control-storage-number">
                    {volume.availableBytes === null ? '—' : formatBytes(volume.availableBytes)} <span>usable after reserve</span>
                  </div>
                  <div className="control-progress">
                    <span style={{ width: `${Math.round((volume.percentUsed ?? 0) * 100)}%`, background: volume.percentUsed !== null && volume.percentUsed >= .9 ? 'var(--control-bad)' : undefined }} />
                  </div>
                  <div className="control-storage-meta">
                    <span>{volume.percentUsed === null ? 'Unknown capacity' : `${Math.round(volume.percentUsed * 100)}% used · ${formatBytes(used ?? 0)} of ${formatBytes(volume.totalBytes ?? 0)}`}</span>
                    <span>{volume.freeBytes === null ? 'Free space unavailable' : `${formatBytes(volume.freeBytes)} free · ${formatBytes(volume.reservedBytes)} reserved`}</span>
                  </div>
                  {volume.role === 'media' && (
                    <div className="control-storage-meta">
                      <span>{volume.movieCount ?? 0} movie{volume.movieCount === 1 ? '' : 's'}</span>
                      <span>{volume.episodeCount ?? 0} episode{volume.episodeCount === 1 ? '' : 's'}</span>
                    </div>
                  )}
                  <code>{volume.path}</code>
                </article>
              );
            })}
          </div>

          <section className="control-section">
            <div className="control-section-heading">
              <h2>Placement check</h2>
              <span>Where would an import of this size go right now?</span>
            </div>
            <div className="control-panel control-storage-plan">
              <div className="control-storage-plan-form">
                <label>
                  <span>Import size (GB)</span>
                  <input className="control-input" type="number" min="0" step="1" value={planGb} onChange={(event) => setPlanGb(Number(event.target.value))} />
                </label>
                <button className="control-button primary" type="button" disabled={planning} onClick={() => void runPlan()}>{planning ? 'Checking…' : 'Check placement'}</button>
              </div>
              {plan && (
                <div className="control-storage-plan-result">
                  {plan.selectedRoot
                    ? <p><StatusBadge tone="good">Would land on</StatusBadge> <code>{plan.selectedRoot}</code> ({formatBytes(plan.requiredBytes)} including overhead)</p>
                    : <p><StatusBadge tone="bad">Would fail</StatusBadge> {plan.error}</p>}
                  <ul>
                    {plan.candidates.map((candidate) => (
                      <li key={candidate.root} className={candidate.eligible ? 'is-eligible' : 'is-ineligible'}>
                        <code>{candidate.root}</code>
                        <span>{candidate.reason}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          </section>

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
