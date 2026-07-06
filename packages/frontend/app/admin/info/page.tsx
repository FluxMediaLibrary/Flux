'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import type { AdminInfoDTO } from '@flux/shared';

const UPTIME_UNITS: [number, string][] = [
  [86400, 'd'],
  [3600, 'h'],
  [60, 'm'],
  [1, 's'],
];

function fmtUptime(seconds: number): string {
  let remaining = Math.floor(seconds);
  const parts: string[] = [];
  for (const [sec, label] of UPTIME_UNITS) {
    const v = Math.floor(remaining / sec);
    if (v > 0 || parts.length > 0) {
      parts.push(`${v}${label}`);
      remaining %= sec;
    }
  }
  return parts.join(' ') || '0s';
}

function fmtBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / 1024 ** i).toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

export default function AdminInfoPage() {
  const [info, setInfo] = useState<AdminInfoDTO | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.getAdminInfo().then(
      (data) => {
        setInfo(data);
        setLoading(false);
      },
      (err) => {
        setError(err.message ?? 'Failed to load');
        setLoading(false);
      },
    );

    // Auto-refresh every 30s
    const interval = setInterval(() => {
      api.getAdminInfo().then(setInfo).catch(() => {});
    }, 30_000);
    return () => clearInterval(interval);
  }, []);

  if (loading) {
    return (
      <div className="centered-viewport">
        <div className="spinner" />
        <p className="muted">Loading dashboard...</p>
      </div>
    );
  }

  if (error || !info) {
    return (
      <div className="centered-viewport">
        <p style={{ color: 'var(--danger)' }}>{error ?? 'No data'}</p>
      </div>
    );
  }

  const memPct = ((info.system.memory.used / info.system.memory.total) * 100).toFixed(1);

  return (
    <div>
      <div className="section-head">
        <h1>System Info</h1>
      </div>

      {/* ── Key stats bar ───────────────────────────────────────────────── */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
          gap: 14,
          marginBottom: 28,
        }}
      >
        <Stat label="Users" value={info.database.users} />
        <Stat label="Profiles" value={info.database.profiles} />
        <Stat label="Media Items" value={info.database.mediaItems} />
        <Stat label="Episodes" value={info.database.episodes} />
        <Stat label="Torrents" value={info.database.torrents} />
        <Stat label="Requests" value={info.database.requests} />
      </div>

      {/* ── System + Storage ────────────────────────────────────────────── */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginBottom: 28 }}>
        {/* System */}
        <div className="card">
          <h2 style={{ fontSize: '1rem', fontWeight: 600, margin: '0 0 14px' }}>System</h2>
          <Rows>
            <Row label="Uptime" value={fmtUptime(info.system.uptime)} />
            <Row label="Node" value={info.system.nodeVersion} />
            <Row label="Platform" value={info.system.platform} />
            <Row
              label="Memory"
              value={`${fmtBytes(info.system.memory.used)} / ${fmtBytes(info.system.memory.total)} (${memPct}%)`}
            />
            <Row
              label="CPU Load"
              value={info.system.cpuLoad.map((l) => l.toFixed(1)).join(' / ')}
            />
          </Rows>
        </div>

        {/* Storage */}
        <div className="card">
          <h2 style={{ fontSize: '1rem', fontWeight: 600, margin: '0 0 14px' }}>Storage Paths</h2>
          <Rows>
            <Row label="Media" value={info.storage.mediaRoot} mono />
            <Row label="Downloads" value={info.storage.downloadRoot} mono />
            <Row label="Transcode" value={info.storage.transcodeRoot} mono />
          </Rows>
        </div>
      </div>

      {/* ── Torrents + Requests ─────────────────────────────────────────── */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginBottom: 28 }}>
        {/* Torrent status */}
        <div className="card">
          <h2 style={{ fontSize: '1rem', fontWeight: 600, margin: '0 0 14px' }}>Torrents</h2>
          <Rows>
            <Row label="Downloading" value={info.torrents.downloading} accent />
            <Row label="Seeding" value={info.torrents.seeding} accent />
            <Row label="Processing" value={info.torrents.processing} />
            <Row label="Stopped" value={info.torrents.stopped} />
            <Row
              label="Errors"
              value={info.torrents.error}
              danger={info.torrents.error > 0}
            />
          </Rows>
        </div>

        {/* Request status */}
        <div className="card">
          <h2 style={{ fontSize: '1rem', fontWeight: 600, margin: '0 0 14px' }}>Requests</h2>
          <Rows>
            <Row label="Pending" value={info.requests.pending} />
            <Row label="Approved" value={info.requests.approved} />
            <Row label="Downloading" value={info.requests.downloading} accent />
            <Row label="Fulfilled" value={info.requests.fulfilled} />
            <Row label="Rejected" value={info.requests.rejected} />
          </Rows>
        </div>
      </div>

      {/* ── Torrent errors ────────────────────────────────────────────────── */}
      {info.errors.length > 0 && (
        <div className="card" style={{ marginBottom: 28 }}>
          <h2 style={{ fontSize: '1rem', fontWeight: 600, margin: '0 0 14px', color: 'var(--danger)' }}>
            Torrent Errors ({info.errors.length})
          </h2>
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Error</th>
                  <th>Since</th>
                </tr>
              </thead>
              <tbody>
                {info.errors.map((e, i) => (
                  <tr key={i}>
                    <td style={{ maxWidth: 300, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {e.name}
                    </td>
                    <td style={{ color: 'var(--danger)', fontSize: '0.82rem' }}>{e.message}</td>
                    <td style={{ color: 'var(--text-dim)', fontSize: '0.82rem', whiteSpace: 'nowrap' }}>
                      {new Date(e.since).toLocaleString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── Refresh indicator ─────────────────────────────────────────────── */}
      <p style={{ color: 'var(--text-dim)', fontSize: '0.78rem', textAlign: 'right' }}>
        Auto-refreshes every 30s. Last updated: {new Date().toLocaleTimeString()}
      </p>
    </div>
  );
}

/* ── Dashboard building blocks ─────────────────────────────────────────────── */

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="card" style={{ textAlign: 'center', padding: '18px 14px' }}>
      <div style={{ fontSize: '1.7rem', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
        {value.toLocaleString()}
      </div>
      <div style={{ fontSize: '0.78rem', color: 'var(--text-dim)' }}>{label}</div>
    </div>
  );
}

function Rows({ children }: { children: React.ReactNode }) {
  return <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>{children}</div>;
}

function Row({
  label,
  value,
  mono,
  accent,
  danger,
}: {
  label: string;
  value: string | number;
  mono?: boolean;
  accent?: boolean;
  danger?: boolean;
}) {
  const valueStyle: React.CSSProperties = {
    fontFamily: mono ? "'SFMono-Regular', ui-monospace, Menlo, Consolas, monospace" : undefined,
    fontSize: mono ? '0.82rem' : undefined,
    fontWeight: danger ? 700 : undefined,
    color: danger ? 'var(--danger)' : accent ? 'var(--accent-2)' : undefined,
    fontVariantNumeric: 'tabular-nums',
  };

  return (
    <div
      style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        gap: 12,
      }}
    >
      <span style={{ color: 'var(--text-muted)', fontSize: '0.88rem' }}>{label}</span>
      <span style={valueStyle}>{typeof value === 'number' ? value.toLocaleString() : value}</span>
    </div>
  );
}
