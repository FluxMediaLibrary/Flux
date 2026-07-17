'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { AdminActivityEventDTO } from '@flux/shared';
import { api, FluxApiError } from '@/lib/api';
import { DataTable, LoadingState, PageError, PageHeader, StatusBadge, type DataColumn } from '@/components/admin/AdminUI';

export default function AdminActivityPage() {
  const [events, setEvents] = useState<AdminActivityEventDTO[] | null>(null);
  const [query, setQuery] = useState('');
  const [result, setResult] = useState('ALL');
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => { setError(null); try { setEvents(await api.getAdminActivity(100)); } catch (err) { setError(err instanceof FluxApiError ? err.message : 'The audit log could not be loaded.'); } }, []);
  useEffect(() => { void load(); }, [load]);
  const filtered = useMemo(() => (events ?? []).filter((event) => (result === 'ALL' || event.result === result) && (!query || `${event.actor} ${event.action} ${event.targetType} ${event.targetLabel ?? ''}`.toLowerCase().includes(query.toLowerCase()))), [events, query, result]);
  const columns: DataColumn<AdminActivityEventDTO>[] = [
    { key: 'time', label: 'Time', render: (event) => <span className="control-mono">{new Date(event.occurredAt).toLocaleString()}</span> },
    { key: 'actor', label: 'Actor', render: (event) => <strong>{event.actor}</strong> },
    { key: 'action', label: 'Action', render: (event) => <div><strong>{event.action.replaceAll('_', ' ').toLowerCase()}</strong><small>{event.targetType.toLowerCase()}</small></div> },
    { key: 'target', label: 'Affected object', render: (event) => <div>{event.targetLabel ?? event.targetId ?? 'System'}{event.targetId && <small className="control-mono">{event.targetId}</small>}</div> },
    { key: 'result', label: 'Result', render: (event) => <StatusBadge tone={event.result === 'FAILURE' ? 'bad' : event.result === 'INFO' ? 'info' : 'good'}>{event.result.toLowerCase()}</StatusBadge> },
    { key: 'details', label: 'Details', render: (event) => event.details ? <span title={event.details}>{event.details.length > 55 ? `${event.details.slice(0, 55)}…` : event.details}</span> : <span className="dim">—</span> },
  ];
  return <div className="control-page"><PageHeader title="Activity" description="Human-readable administrative actions, separate from technical service logs." actions={<button className="control-button" onClick={() => void load()}>Refresh log</button>} />{error && <PageError message={error} onRetry={() => void load()} />}<div className="control-toolbar"><input className="control-input" aria-label="Search audit log" placeholder="Search actor, action, or target" value={query} onChange={(event) => setQuery(event.target.value)} /><select className="control-select" value={result} onChange={(event) => setResult(event.target.value)}><option value="ALL">All results</option><option value="SUCCESS">Success</option><option value="FAILURE">Failure</option><option value="INFO">Information</option></select>{events && <span className="dim" style={{ fontSize: 11 }}>{filtered.length} event{filtered.length === 1 ? '' : 's'}</span>}</div>{!events ? <LoadingState cards={4} /> : <div className="control-panel"><DataTable rows={filtered} columns={columns} rowKey={(event) => event.id} empty="No administrative actions match these filters." /></div>}</div>;
}
