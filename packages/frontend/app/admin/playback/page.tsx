'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { AdminPlaybackSessionDTO } from '@flux/shared';
import { api, FluxApiError } from '@/lib/api';
import { DataTable, LoadingState, PageError, PageHeader, StatusBadge, type DataColumn } from '@/components/admin/AdminUI';

function clock(seconds: number | null): string { if (seconds == null) return '—'; const value = Math.max(0, Math.floor(seconds)); return `${Math.floor(value / 3600)}:${String(Math.floor(value / 60) % 60).padStart(2, '0')}:${String(value % 60).padStart(2, '0')}`; }

export default function AdminPlaybackPage() {
  const [sessions, setSessions] = useState<AdminPlaybackSessionDTO[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => { setError(null); try { setSessions(await api.getAdminPlayback()); } catch (err) { setError(err instanceof FluxApiError ? err.message : 'Playback data could not be loaded.'); } }, []);
  useEffect(() => { void load(); }, [load]);
  const active = useMemo(() => sessions?.filter((session) => session.state === 'ACTIVE') ?? [], [sessions]);
  const uniqueUsers = new Set(sessions?.map((session) => session.profileId)).size;
  const averageProgress = sessions?.length ? sessions.reduce((sum, session) => sum + (session.progress ?? 0), 0) / sessions.length : 0;
  const columns: DataColumn<AdminPlaybackSessionDTO>[] = [
    { key: 'media', label: 'Media', render: (row) => <div><strong>{row.title}</strong><small>{row.subtitle ?? 'Movie'}</small></div> },
    { key: 'user', label: 'User', render: (row) => <div>{row.profileName}<small>{row.accountEmail}</small></div> },
    { key: 'state', label: 'State', render: (row) => <StatusBadge tone={row.state === 'ACTIVE' ? 'good' : 'neutral'}>{row.state.toLowerCase()}</StatusBadge> },
    { key: 'position', label: 'Position', render: (row) => <div className="control-mono">{clock(row.positionSeconds)}<small>{clock(row.durationSeconds)} total</small></div> },
    { key: 'progress', label: 'Progress', render: (row) => <div style={{ minWidth: 130 }}><div className="control-progress"><span style={{ width: `${Math.round((row.progress ?? 0) * 100)}%` }} /></div><small>{row.progress === null ? 'Unknown duration' : `${Math.round(row.progress * 100)}% watched`}</small></div> },
    { key: 'signal', label: 'Last heartbeat', render: (row) => new Date(row.updatedAt).toLocaleString() },
  ];
  return <div className="control-page"><PageHeader title="Playback" description="Active playback heartbeats and recent viewing history." actions={<button className="control-button" onClick={() => void load()}>Refresh</button>} />{error && <PageError message={error} onRetry={() => void load()} />}{!sessions ? <LoadingState cards={4} /> : <><div className="control-stat-grid" style={{ gridTemplateColumns: 'repeat(4,minmax(130px,1fr))' }}><PlaybackStat label="Active sessions" value={active.length} detail="Updated within 90 seconds" /><PlaybackStat label="Recent sessions" value={sessions.length} detail="Latest playback records" /><PlaybackStat label="Viewers" value={uniqueUsers} detail="Unique profiles" /><PlaybackStat label="Average progress" value={`${Math.round(averageProgress * 100)}%`} detail="Across recent sessions" /></div><section className="control-section"><div className="control-section-heading"><h2>Session history</h2><span>Progress telemetry</span></div><div className="control-panel"><DataTable rows={sessions} columns={columns} rowKey={(row) => row.id} empty="No playback heartbeats have reached Flux yet." /></div></section><div className="control-telemetry-note"><strong>Playback diagnostic coverage</strong><p>Flux currently records user, title, position, duration, and heartbeat time. Device, codec-selection reason, bitrate, buffer health, and network address are intentionally shown only after those values are emitted by the playback session service—this page does not guess them.</p></div></>}</div>;
}
function PlaybackStat({ label, value, detail }: { label: string; value: string | number; detail: string }) { return <div className="control-stat"><span>{label}</span><strong>{value}</strong><small>{detail}</small></div>; }
