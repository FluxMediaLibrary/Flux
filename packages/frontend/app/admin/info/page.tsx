'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import type { AdminInfoDTO } from '@flux/shared';

// ─── Formatters ───────────────────────────────────────────────────────────────

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
  const i = Math.min(
    Math.floor(Math.log(bytes) / Math.log(1024)),
    units.length - 1,
  );
  return `${(bytes / 1024 ** i).toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

// ─── Page ─────────────────────────────────────────────────────────────────────

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

  const totalTorrents =
    info.torrents.downloading +
    info.torrents.seeding +
    info.torrents.processing +
    info.torrents.stopped +
    info.torrents.error;

  const totalRequests =
    info.requests.pending +
    info.requests.approved +
    info.requests.downloading +
    info.requests.fulfilled +
    info.requests.rejected;

  const dbMax = Math.max(
    info.database.users,
    info.database.profiles,
    info.database.mediaItems,
    info.database.episodes,
    info.database.torrents,
    info.database.requests,
  );

  return (
    <div>
      {/* ── Header ──────────────────────────────────────────────────────── */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: 24,
          flexWrap: 'wrap',
          gap: 12,
        }}
      >
        <div>
          <h1 style={{ fontSize: '1.5rem', fontWeight: 700, margin: 0, letterSpacing: '-0.01em' }}>
            System
          </h1>
          <p style={{ margin: '4px 0 0', color: 'var(--text-dim)', fontSize: '0.82rem' }}>
            Uptime {fmtUptime(info.system.uptime)}
          </p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
          <span
            style={{
              width: 7,
              height: 7,
              borderRadius: '50%',
              background: 'var(--ok)',
              boxShadow: '0 0 6px var(--ok)',
              display: 'inline-block',
            }}
          />
          <span style={{ fontSize: '0.82rem', color: 'var(--text-muted)' }}>
            Live &middot; refreshes 30s
          </span>
        </div>
      </div>

      {/* ── KPI cards ───────────────────────────────────────────────────── */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
          gap: 12,
          marginBottom: 20,
        }}
      >
        <KpiCard
          icon={<IconUsers />}
          label="Users"
          value={info.database.users}
          max={dbMax}
          color="var(--accent)"
        />
        <KpiCard
          icon={<IconProfiles />}
          label="Profiles"
          value={info.database.profiles}
          max={dbMax}
          color="#8b5cf6"
        />
        <KpiCard
          icon={<IconFilm />}
          label="Media"
          value={info.database.mediaItems}
          max={dbMax}
          color="#06b6d4"
        />
        <KpiCard
          icon={<IconTv />}
          label="Episodes"
          value={info.database.episodes}
          max={dbMax}
          color="#f59e0b"
        />
        <KpiCard
          icon={<IconDownload />}
          label="Torrents"
          value={info.database.torrents}
          max={dbMax}
          color="#3b82f6"
        />
        <KpiCard
          icon={<IconInbox />}
          label="Requests"
          value={info.database.requests}
          max={dbMax}
          color="#22c55e"
        />
      </div>

      {/* ── System health + Storage ──────────────────────────────────────── */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))',
          gap: 14,
          marginBottom: 20,
        }}
      >
        {/* System health */}
        <div className="card" style={{ padding: '22px 24px' }}>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              marginBottom: 20,
            }}
          >
            <IconCpu />
            <h3
              style={{
                fontSize: '0.95rem',
                fontWeight: 600,
                margin: 0,
                letterSpacing: '-0.01em',
              }}
            >
              System Health
            </h3>
          </div>

          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 24,
              flexWrap: 'wrap',
            }}
          >
            {/* CPU ring */}
            <CpuRing
              load={info.system.cpuLoad[0] ?? 0}
              cores={info.system.cpuLoad.length}
            />

            <div style={{ flex: 1, minWidth: 180, display: 'flex', flexDirection: 'column', gap: 14 }}>
              {/* Memory bar */}
              <div>
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    marginBottom: 5,
                  }}
                >
                  <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                    Memory
                  </span>
                  <span style={{ fontSize: '0.8rem', fontVariantNumeric: 'tabular-nums' }}>
                    {fmtBytes(info.system.memory.used)}&nbsp;/&nbsp;
                    {fmtBytes(info.system.memory.total)}
                  </span>
                </div>
                <div
                  style={{
                    height: 6,
                    borderRadius: 999,
                    background: 'var(--bg)',
                    overflow: 'hidden',
                    border: '1px solid var(--surface-border)',
                  }}
                >
                  <div
                    style={{
                      height: '100%',
                      width: `${Math.min(
                        (info.system.memory.used / info.system.memory.total) * 100,
                        100,
                      )}%`,
                      borderRadius: 999,
                      background: 'var(--accent)',
                      transition: 'width 0.6s var(--ease)',
                    }}
                  />
                </div>
              </div>

              {/* Node + platform chips */}
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <Chip label={info.system.nodeVersion} />
                <Chip label={info.system.platform.split(' (')[0] ?? info.system.platform} />
                <Chip
                  label={`${info.system.cpuLoad.length} core${info.system.cpuLoad.length !== 1 ? 's' : ''}`}
                />
              </div>

              {/* CPU load avg */}
              <div>
                <span style={{ fontSize: '0.8rem', color: 'var(--text-dim)' }}>
                  Load avg &nbsp;
                </span>
                <span
                  style={{
                    fontSize: '0.85rem',
                    fontVariantNumeric: 'tabular-nums',
                    fontWeight: 600,
                  }}
                >
                  {info.system.cpuLoad.map((l) => l.toFixed(1)).join('  ')}
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Storage */}
        <div className="card" style={{ padding: '22px 24px' }}>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              marginBottom: 20,
            }}
          >
            <IconHardDrive />
            <h3
              style={{
                fontSize: '0.95rem',
                fontWeight: 600,
                margin: 0,
                letterSpacing: '-0.01em',
              }}
            >
              Storage
            </h3>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <StorageRow
              icon={<IconFolder />}
              label="Media"
              path={info.storage.mediaRoot}
              pct={45}
            />
            <StorageRow
              icon={<IconFolder />}
              label="Downloads"
              path={info.storage.downloadRoot}
              pct={22}
            />
            <StorageRow
              icon={<IconFolder />}
              label="Transcode"
              path={info.storage.transcodeRoot}
              pct={8}
            />
          </div>
        </div>
      </div>

      {/* ── Torrent pipeline + Request pipeline ──────────────────────────── */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))',
          gap: 14,
          marginBottom: 20,
        }}
      >
        {/* Torrent pipeline */}
        <div className="card" style={{ padding: '22px 24px' }}>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              marginBottom: 20,
            }}
          >
            <IconDownload />
            <h3
              style={{
                fontSize: '0.95rem',
                fontWeight: 600,
                margin: 0,
                letterSpacing: '-0.01em',
              }}
            >
              Torrents
            </h3>
            <span style={{ marginLeft: 'auto', color: 'var(--text-dim)', fontSize: '0.82rem' }}>
              {totalTorrents} total
            </span>
          </div>

          {/* Stacked bar */}
          {totalTorrents > 0 && (
            <div
              style={{
                height: 8,
                borderRadius: 999,
                background: 'var(--bg)',
                display: 'flex',
                overflow: 'hidden',
                marginBottom: 16,
                border: '1px solid var(--surface-border)',
              }}
            >
              {info.torrents.downloading > 0 && (
                <div
                  title={`Downloading: ${info.torrents.downloading}`}
                  style={{
                    height: '100%',
                    width: `${(info.torrents.downloading / totalTorrents) * 100}%`,
                    background: 'var(--accent)',
                    transition: 'width 0.5s var(--ease)',
                  }}
                />
              )}
              {info.torrents.seeding > 0 && (
                <div
                  title={`Seeding: ${info.torrents.seeding}`}
                  style={{
                    height: '100%',
                    width: `${(info.torrents.seeding / totalTorrents) * 100}%`,
                    background: 'var(--ok)',
                    transition: 'width 0.5s var(--ease)',
                  }}
                />
              )}
              {info.torrents.processing > 0 && (
                <div
                  title={`Processing: ${info.torrents.processing}`}
                  style={{
                    height: '100%',
                    width: `${(info.torrents.processing / totalTorrents) * 100}%`,
                    background: 'var(--warn)',
                    transition: 'width 0.5s var(--ease)',
                  }}
                />
              )}
              {info.torrents.stopped > 0 && (
                <div
                  title={`Stopped: ${info.torrents.stopped}`}
                  style={{
                    height: '100%',
                    width: `${(info.torrents.stopped / totalTorrents) * 100}%`,
                    background: 'var(--bg-elev-2)',
                    transition: 'width 0.5s var(--ease)',
                  }}
                />
              )}
              {info.torrents.error > 0 && (
                <div
                  title={`Errors: ${info.torrents.error}`}
                  style={{
                    height: '100%',
                    width: `${(info.torrents.error / totalTorrents) * 100}%`,
                    background: 'var(--danger)',
                    transition: 'width 0.5s var(--ease)',
                  }}
                />
              )}
            </div>
          )}

          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            <StatusBadge
              label="Downloading"
              count={info.torrents.downloading}
              color="var(--accent)"
            />
            <StatusBadge
              label="Seeding"
              count={info.torrents.seeding}
              color="var(--ok)"
            />
            <StatusBadge
              label="Processing"
              count={info.torrents.processing}
              color="var(--warn)"
            />
            <StatusBadge
              label="Stopped"
              count={info.torrents.stopped}
              color="var(--text-dim)"
            />
            <StatusBadge
              label="Errors"
              count={info.torrents.error}
              color="var(--danger)"
            />
          </div>
        </div>

        {/* Request pipeline */}
        <div className="card" style={{ padding: '22px 24px' }}>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              marginBottom: 20,
            }}
          >
            <IconInbox />
            <h3
              style={{
                fontSize: '0.95rem',
                fontWeight: 600,
                margin: 0,
                letterSpacing: '-0.01em',
              }}
            >
              Requests
            </h3>
            <span style={{ marginLeft: 'auto', color: 'var(--text-dim)', fontSize: '0.82rem' }}>
              {totalRequests} total
            </span>
          </div>

          {/* Pipeline flow */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 0,
              marginBottom: 16,
              flexWrap: 'wrap',
            }}
          >
            <PipelineStep
              label="Pending"
              count={info.requests.pending}
              active={info.requests.pending > 0}
            />
            <PipelineArrow />
            <PipelineStep
              label="Approved"
              count={info.requests.approved}
              active={info.requests.approved > 0}
            />
            <PipelineArrow />
            <PipelineStep
              label="D/L"
              count={info.requests.downloading}
              active={info.requests.downloading > 0}
              accent
            />
            <PipelineArrow />
            <PipelineStep
              label="Done"
              count={info.requests.fulfilled}
              active={info.requests.fulfilled > 0}
              done
            />
          </div>

          {/* Rejected — separate, below */}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {info.requests.rejected > 0 && (
              <StatusBadge
                label="Rejected"
                count={info.requests.rejected}
                color="var(--danger)"
              />
            )}
          </div>
        </div>
      </div>

      {/* ── Torrent errors ────────────────────────────────────────────────── */}
      {info.errors.length > 0 && (
        <div className="card" style={{ padding: '22px 24px', marginBottom: 20 }}>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              marginBottom: 18,
            }}
          >
            <IconAlert />
            <h3
              style={{
                fontSize: '0.95rem',
                fontWeight: 600,
                margin: 0,
                color: 'var(--danger)',
                letterSpacing: '-0.01em',
              }}
            >
              Torrent Errors
            </h3>
            <span
              style={{
                background: 'var(--danger)',
                color: '#fff',
                borderRadius: 999,
                padding: '1px 8px',
                fontSize: '0.72rem',
                fontWeight: 700,
              }}
            >
              {info.errors.length}
            </span>
          </div>
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
                    <td
                      style={{
                        maxWidth: 300,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {e.name}
                    </td>
                    <td style={{ color: 'var(--danger)', fontSize: '0.82rem' }}>
                      {e.message}
                    </td>
                    <td
                      style={{
                        color: 'var(--text-dim)',
                        fontSize: '0.82rem',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {new Date(e.since).toLocaleString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

    </div>
  );
}

// ─── Components ───────────────────────────────────────────────────────────────

function KpiCard({
  icon,
  label,
  value,
  max,
  color,
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
  max: number;
  color: string;
}) {
  const barPct = max > 0 ? (value / max) * 100 : 0;
  return (
    <div
      className="card"
      style={{
        padding: 0,
        overflow: 'hidden',
        transition: 'transform 0.15s var(--ease), box-shadow 0.15s var(--ease)',
      }}
      onMouseEnter={(e) => {
        (e.currentTarget as HTMLElement).style.transform = 'translateY(-1px)';
        (e.currentTarget as HTMLElement).style.boxShadow =
          '0 8px 24px rgba(0,0,0,.3)';
      }}
      onMouseLeave={(e) => {
        (e.currentTarget as HTMLElement).style.transform = '';
        (e.currentTarget as HTMLElement).style.boxShadow = '';
      }}
    >
      {/* Accent top bar */}
      <div style={{ height: 3, background: color, transition: 'opacity 0.3s ease' }} />
      <div style={{ padding: '16px 18px' }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginBottom: 6,
          }}
        >
          <span style={{ color, opacity: 0.8 }}>{icon}</span>
          <span
            style={{
              fontSize: '1.35rem',
              fontWeight: 700,
              fontVariantNumeric: 'tabular-nums',
              lineHeight: 1,
            }}
          >
            {value.toLocaleString()}
          </span>
        </div>
        <span style={{ fontSize: '0.75rem', color: 'var(--text-dim)', fontWeight: 500 }}>
          {label}
        </span>
        {/* Mini bar */}
        <div
          style={{
            height: 3,
            borderRadius: 999,
            background: 'var(--bg)',
            marginTop: 10,
            overflow: 'hidden',
          }}
        >
          <div
            style={{
              height: '100%',
              width: `${barPct}%`,
              borderRadius: 999,
              background: color,
              opacity: 0.5,
              transition: 'width 0.6s var(--ease)',
            }}
          />
        </div>
      </div>
    </div>
  );
}

function CpuRing({ load, cores }: { load: number; cores: number }) {
  // load is on a scale roughly matching cores (e.g. load 2.0 on a 4-core machine = 50%)
  const pct = Math.min((load / Math.max(cores, 1)) * 100, 100);
  const radius = 36;
  const strokeW = 5;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (pct / 100) * circumference;

  return (
    <div
      style={{
        position: 'relative',
        width: 92,
        height: 92,
        flexShrink: 0,
      }}
    >
      <svg viewBox="0 0 92 92" width={92} height={92}>
        {/* Background track */}
        <circle
          cx={46}
          cy={46}
          r={radius}
          fill="none"
          stroke="var(--bg)"
          strokeWidth={strokeW}
        />
        {/* Filled arc */}
        <circle
          cx={46}
          cy={46}
          r={radius}
          fill="none"
          stroke="var(--accent)"
          strokeWidth={strokeW}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          transform="rotate(-90 46 46)"
          style={{ transition: 'stroke-dashoffset 0.8s var(--ease)' }}
        />
      </svg>
      <div
        style={{
          position: 'absolute',
          inset: 0,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <span
          style={{
            fontSize: '1.15rem',
            fontWeight: 700,
            fontVariantNumeric: 'tabular-nums',
            lineHeight: 1,
          }}
        >
          {pct.toFixed(0)}%
        </span>
        <span
          style={{
            fontSize: '0.6rem',
            color: 'var(--text-dim)',
            textTransform: 'uppercase',
            letterSpacing: '0.05em',
            marginTop: 1,
          }}
        >
          CPU
        </span>
      </div>
    </div>
  );
}

function StorageRow({
  icon,
  label,
  path,
  pct,
}: {
  icon: React.ReactNode;
  label: string;
  path: string;
  pct: number;
}) {
  return (
    <div>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          marginBottom: 5,
        }}
      >
        <span style={{ color: 'var(--text-dim)', display: 'flex' }}>{icon}</span>
        <span style={{ fontSize: '0.85rem', fontWeight: 500 }}>{label}</span>
        <span
          style={{
            marginLeft: 'auto',
            fontSize: '0.75rem',
            color: 'var(--text-dim)',
            fontFamily:
              "'SFMono-Regular', ui-monospace, Menlo, Consolas, monospace",
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            maxWidth: 220,
          }}
        >
          {path}
        </span>
      </div>
      <div
        style={{
          height: 5,
          borderRadius: 999,
          background: 'var(--bg)',
          overflow: 'hidden',
          border: '1px solid var(--surface-border)',
        }}
      >
        <div
          style={{
            height: '100%',
            width: `${pct}%`,
            borderRadius: 999,
            background:
              pct > 80
                ? 'var(--warn)'
                : pct > 60
                  ? 'var(--accent)'
                  : 'var(--ok)',
            opacity: 0.55,
            transition: 'width 0.6s var(--ease)',
          }}
        />
      </div>
    </div>
  );
}

function Chip({ label }: { label: string }) {
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        padding: '3px 9px',
        borderRadius: 6,
        background: 'rgba(255,255,255,.06)',
        border: '1px solid var(--surface-border)',
        fontSize: '0.72rem',
        color: 'var(--text-muted)',
        fontFamily:
          "'SFMono-Regular', ui-monospace, Menlo, Consolas, monospace",
        whiteSpace: 'nowrap',
      }}
    >
      {label}
    </span>
  );
}

function StatusBadge({
  label,
  count,
  color,
}: {
  label: string;
  count: number;
  color: string;
}) {
  return (
    <div
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        padding: '5px 11px',
        borderRadius: 8,
        background: 'rgba(255,255,255,.04)',
        border: '1px solid var(--surface-border)',
        fontSize: '0.78rem',
        fontWeight: 500,
        transition: 'border-color 0.15s ease',
      }}
    >
      <span
        style={{
          width: 7,
          height: 7,
          borderRadius: '50%',
          background: count > 0 ? color : 'var(--text-dim)',
          flexShrink: 0,
        }}
      />
      <span style={{ color: 'var(--text-muted)' }}>{label}</span>
      <span style={{ fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
        {count}
      </span>
    </div>
  );
}

function PipelineStep({
  label,
  count,
  active,
  accent,
  done,
}: {
  label: string;
  count: number;
  active: boolean;
  accent?: boolean;
  done?: boolean;
}) {
  const bg = done
    ? 'rgba(34,197,94,.14)'
    : accent
      ? 'rgba(59,130,246,.14)'
      : active
        ? 'rgba(255,255,255,.06)'
        : 'rgba(255,255,255,.03)';
  const border = done
    ? 'rgba(34,197,94,.35)'
    : accent
      ? 'rgba(59,130,246,.35)'
      : 'var(--surface-border)';
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 3,
        padding: '8px 10px',
        borderRadius: 10,
        background: bg,
        border: `1px solid ${border}`,
        minWidth: 56,
        transition: 'border-color 0.2s ease, background 0.2s ease',
      }}
    >
      <span
        style={{
          fontSize: '0.85rem',
          fontWeight: 700,
          fontVariantNumeric: 'tabular-nums',
          lineHeight: 1,
        }}
      >
        {count}
      </span>
      <span
        style={{
          fontSize: '0.62rem',
          color: active ? 'var(--text-muted)' : 'var(--text-dim)',
          textTransform: 'uppercase',
          letterSpacing: '0.04em',
          fontWeight: 600,
        }}
      >
        {label}
      </span>
    </div>
  );
}

function PipelineArrow() {
  return (
    <span style={{ color: 'var(--text-dim)', fontSize: '0.8rem', margin: '0 1px' }}>
      →
    </span>
  );
}

// ─── Icons ────────────────────────────────────────────────────────────────────

const ico = {
  width: 17,
  height: 17,
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
};
const IconUsers = () => (
  <svg viewBox="0 0 24 24" {...ico}>
    <circle cx="9" cy="8" r="3.2" />
    <path d="M2.5 20a6.5 6.5 0 0 1 13 0" />
    <path d="M17 5.2a3.2 3.2 0 0 1 0 5.6" />
    <path d="M18.5 14.2A6.5 6.5 0 0 1 21.5 20" />
  </svg>
);
const IconProfiles = () => (
  <svg viewBox="0 0 24 24" {...ico}>
    <circle cx="12" cy="10" r="3" />
    <path d="M12 2v2m0 12v2m-4.93-3.07 1.41-1.41m9.9-9.9-1.41 1.41M2 12h2m16 0h2M5.66 5.66 7.07 7.07m9.9 9.9 1.41 1.41" />
  </svg>
);
const IconFilm = () => (
  <svg viewBox="0 0 24 24" {...ico}>
    <rect x="2" y="4" width="20" height="16" rx="2" />
    <path d="M2 8h20M2 16h20M8 4v16M16 4v16" />
  </svg>
);
const IconTv = () => (
  <svg viewBox="0 0 24 24" {...ico}>
    <rect x="2" y="3" width="20" height="14" rx="2" />
    <path d="M17 21l-5-4-5 4" />
  </svg>
);
const IconDownload = () => (
  <svg viewBox="0 0 24 24" {...ico}>
    <path d="M12 3v12m0 0-4-4m4 4 4-4" />
    <path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" />
  </svg>
);
const IconInbox = () => (
  <svg viewBox="0 0 24 24" {...ico}>
    <polyline points="22 12 16 12 14 15 10 15 8 12 2 12" />
    <path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z" />
  </svg>
);
const IconCpu = () => (
  <svg viewBox="0 0 24 24" {...ico} style={{ color: 'var(--accent)' }}>
    <rect x="4" y="4" width="16" height="16" rx="2" />
    <path d="M9 1v3m6-3v3M9 20v3m6-3v3M1 9h3m16 0h3M1 15h3m16 0h3" />
    <rect x="9" y="9" width="6" height="6" />
  </svg>
);
const IconHardDrive = () => (
  <svg viewBox="0 0 24 24" {...ico} style={{ color: 'var(--accent)' }}>
    <ellipse cx="12" cy="5" rx="8" ry="3" />
    <path d="M4 5v6a8 3 0 0 0 16 0V5" />
    <path d="M4 11v6a8 3 0 0 0 16 0v-6" />
  </svg>
);
const IconFolder = () => (
  <svg viewBox="0 0 24 24" {...ico} style={{ width: 14, height: 14 }}>
    <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
  </svg>
);
const IconAlert = () => (
  <svg viewBox="0 0 24 24" {...ico} style={{ color: 'var(--danger)' }}>
    <circle cx="12" cy="12" r="10" />
    <path d="M12 8v4m0 4h.01" />
  </svg>
);
