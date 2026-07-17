'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import type { AdminOverviewDTO } from '@flux/shared';
import { api, FluxApiError } from '@/lib/api';
import { formatBytes } from '@/lib/format';
import { useAdminSignal } from '@/components/admin/AdminControlCenter';
import { DataTable, LoadingState, PageError, PageHeader, StatusBadge, type DataColumn } from '@/components/admin/AdminUI';

function formatTime(seconds: number): string {
  const safe = Math.max(0, Math.floor(seconds));
  return `${Math.floor(safe / 60)}:${String(safe % 60).padStart(2, '0')}`;
}

function relativeTime(value: string): string {
  const delta = Date.now() - new Date(value).getTime();
  const minutes = Math.max(0, Math.floor(delta / 60_000));
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

export default function AdminOverviewPage() {
  const [overview, setOverview] = useState<AdminOverviewDTO | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const { signal } = useAdminSignal();

  const load = useCallback(async () => {
    setRefreshing(true);
    setError(null);
    try {
      setOverview(await api.getAdminOverview());
    } catch (err) {
      setError(err instanceof FluxApiError ? err.message : 'The control center could not load.');
    } finally {
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    if (!signal) return;
    setOverview((current) => current ? {
      ...current,
      signal,
      stats: {
        ...current.stats,
        pendingRequests: signal.counts.pendingRequests,
        activeDownloads: signal.counts.activeDownloads,
        failedJobs: signal.counts.failedDownloads,
        activeStreams: signal.counts.activeStreams,
      },
    } : current);
  }, [signal]);

  const playbackColumns: DataColumn<AdminOverviewDTO['playback'][number]>[] = [
    { key: 'media', label: 'Now playing', render: (row) => <div><strong>{row.title}</strong><small>{row.subtitle ?? 'Movie'}</small></div> },
    { key: 'user', label: 'User', render: (row) => <div>{row.profileName}<small>{row.accountEmail}</small></div> },
    { key: 'mode', label: 'Session', render: (row) => <StatusBadge tone={row.state === 'ACTIVE' ? 'good' : 'neutral'}>{row.state.toLowerCase()}</StatusBadge> },
    { key: 'progress', label: 'Progress', render: (row) => <div style={{ minWidth: 130 }}><div className="control-progress"><span style={{ width: `${Math.round((row.progress ?? 0) * 100)}%` }} /></div><small>{formatTime(row.positionSeconds)}{row.durationSeconds ? ` / ${formatTime(row.durationSeconds)}` : ''}</small></div> },
    { key: 'updated', label: 'Last signal', render: (row) => <span className="control-mono">{relativeTime(row.updatedAt)}</span> },
  ];

  return <div className="control-page">
    <PageHeader title="Overview" description="Server health, live operations, and anything that needs intervention." actions={<button className="control-button" onClick={() => void load()} disabled={refreshing}>{refreshing ? 'Refreshing…' : 'Refresh snapshot'}</button>} />
    {error && <PageError message={error} onRetry={() => void load()} />}
    {!overview ? <LoadingState cards={8} /> : <>
      <section className="control-stat-grid" aria-label="Flux status summary">
        <Stat label="Server status" value={overview.signal.status === 'HEALTHY' ? 'Healthy' : overview.signal.status === 'DEGRADED' ? 'Attention' : 'Unhealthy'} detail={`Updated ${relativeTime(overview.signal.generatedAt)}`} tone={overview.signal.status === 'HEALTHY' ? 'good' : overview.signal.status === 'DEGRADED' ? 'warn' : 'bad'} />
        <Stat label="Active streams" value={String(overview.stats.activeStreams)} detail="Playback heartbeats" tone={overview.stats.activeStreams > 0 ? 'good' : undefined} />
        <Stat label="Pending requests" value={String(overview.stats.pendingRequests)} detail="Awaiting review" tone={overview.stats.pendingRequests > 0 ? 'warn' : undefined} />
        <Stat label="Active downloads" value={String(overview.stats.activeDownloads)} detail="Download + processing" />
        <Stat label="Failed jobs" value={String(overview.stats.failedJobs)} detail="Retry required" tone={overview.stats.failedJobs > 0 ? 'bad' : 'good'} />
        <Stat label="Storage used" value={overview.stats.storageUsedBytes === null ? '—' : formatBytes(overview.stats.storageUsedBytes)} detail={overview.stats.storageTotalBytes === null ? 'Capacity unavailable' : `${Math.round((overview.stats.storageUsedBytes! / overview.stats.storageTotalBytes) * 100)}% of ${formatBytes(overview.stats.storageTotalBytes)}`} tone={overview.signal.storagePercent !== null && overview.signal.storagePercent >= .85 ? 'warn' : undefined} />
        <Stat label="Media library" value={overview.stats.mediaItems.toLocaleString()} detail="Movies and series" />
        <Stat label="Users" value={overview.stats.users.toLocaleString()} detail="Registered accounts" />
      </section>

      <section className="control-section">
        <div className="control-section-heading"><h2>Live playback</h2><Link href="/admin/playback">View playback history →</Link></div>
        <div className="control-panel"><DataTable rows={overview.playback} columns={playbackColumns} rowKey={(row) => row.id} empty="No recent playback sessions. Active sessions appear here as progress reaches the server." /></div>
      </section>

      <div className="control-grid-two">
        <section className="control-section">
          <div className="control-section-heading"><h2>Attention required</h2><span>{overview.attention.length} active signal{overview.attention.length === 1 ? '' : 's'}</span></div>
          <div className="control-panel">{overview.attention.length === 0 ? <div className="control-empty">Nothing needs intervention. Flux is operating normally.</div> : <ul className="control-attention-list">{overview.attention.map((item) => <li key={item.id}><Link className="control-attention-item" href={item.href}><i className={item.severity.toLowerCase()} /><span><strong>{item.title}</strong><small>{item.detail}</small></span><em>{item.count}</em><span aria-hidden>›</span></Link></li>)}</ul>}</div>
        </section>
        <section className="control-section">
          <div className="control-section-heading"><h2>Recent activity</h2><Link href="/admin/activity">Open audit log →</Link></div>
          <div className="control-panel">{overview.activity.length === 0 ? <div className="control-empty">Administrative actions will be recorded here.</div> : <ul className="control-activity-list">{overview.activity.slice(0, 8).map((event) => <li className="control-activity-item" key={event.id}><i className={event.result.toLowerCase()} /><span><strong>{event.action.replaceAll('_', ' ').toLowerCase()}</strong><small>{event.actor}{event.targetLabel ? ` · ${event.targetLabel}` : ''}</small></span><time>{relativeTime(event.occurredAt)}</time></li>)}</ul>}</div>
        </section>
      </div>
    </>}
  </div>;
}

function Stat({ label, value, detail, tone }: { label: string; value: string; detail: string; tone?: 'good' | 'warn' | 'bad' }) {
  return <div className={`control-stat${tone ? ` tone-${tone}` : ''}`}><span>{label}</span><strong>{value}</strong><small>{detail}</small></div>;
}
