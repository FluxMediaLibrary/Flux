'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import type { TranscodeDiagnosticsDTO, TranscodeSessionDTO } from '@flux/shared';
import { api, FluxApiError } from '@/lib/api';
import { DataTable, StatusBadge, type DataColumn } from '@/components/admin/AdminUI';

function clock(seconds: number | null): string {
  if (seconds == null) return '—';
  const value = Math.max(0, Math.floor(seconds));
  return `${Math.floor(value / 3600)}:${String(Math.floor(value / 60) % 60).padStart(2, '0')}:${String(value % 60).padStart(2, '0')}`;
}

function modeLabel(mode: TranscodeSessionDTO['mode']): string {
  switch (mode) {
    case 'remux': return 'Direct stream';
    case 'adaptive': return 'Transcode (ladder)';
    case 'cast': return 'Transcode (Cast)';
    default: return 'Transcode';
  }
}

/**
 * Live FFmpeg sessions + hardware-acceleration status. Polls every few
 * seconds while the page is open because sessions come and go quickly.
 */
export function TranscodePanel({ canDetect = false }: { canDetect?: boolean }) {
  const [data, setData] = useState<TranscodeDiagnosticsDTO | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setData(await api.getTranscodeDiagnostics());
      setError(null);
    } catch (err) {
      setError(err instanceof FluxApiError ? err.message : 'Transcode diagnostics could not be loaded.');
    }
  }, []);

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(), 4000);
    return () => window.clearInterval(timer);
  }, [load]);

  async function detect() {
    setBusy(true);
    try {
      setData(await api.detectTranscodeCapabilities());
    } catch (err) {
      setError(err instanceof FluxApiError ? err.message : 'Detection failed.');
    } finally {
      setBusy(false);
    }
  }

  async function stop(id: string) {
    setBusy(true);
    try {
      await api.stopTranscodeSession(id);
      await load();
    } catch (err) {
      setError(err instanceof FluxApiError ? err.message : 'The session could not be stopped.');
    } finally {
      setBusy(false);
    }
  }

  const columns: DataColumn<TranscodeSessionDTO>[] = [
    { key: 'media', label: 'Media', render: (row) => <div><strong>{row.title}</strong><small>{row.subtitle ?? 'Movie'}{row.profileName ? ` · ${row.profileName}` : ''}</small></div> },
    { key: 'mode', label: 'Decision', render: (row) => <div><StatusBadge tone={row.mode === 'remux' ? 'good' : 'info'}>{modeLabel(row.mode)}</StatusBadge><small className="control-wrap">{row.reason}</small></div> },
    { key: 'codec', label: 'Source → target', render: (row) => <div className="control-mono">{row.source.videoCodec ?? '?'}/{row.source.audioCodec ?? 'none'}{row.source.width && row.source.height ? ` ${row.source.width}×${row.source.height}` : ''}<small>→ {row.target.videoCodec}/{row.target.audioCodec} via {row.target.encoder}{row.target.hardwareAcceleration !== 'NONE' ? ` (${row.target.hardwareAcceleration})` : ''}</small></div> },
    { key: 'speed', label: 'Speed', render: (row) => <div className="control-mono">{row.speed == null ? '—' : `${row.speed.toFixed(2)}×`}<small>{row.bitrateKbps == null ? 'bitrate n/a' : `${Math.round(row.bitrateKbps)} kbps`}</small></div> },
    { key: 'position', label: 'Encoded', render: (row) => <div className="control-mono">{clock(row.outTimeSeconds == null ? null : row.outTimeSeconds + row.startTimeSeconds)}<small>from {clock(row.startTimeSeconds)}</small></div> },
    { key: 'state', label: 'State', render: (row) => <div><StatusBadge tone={row.state === 'FAILED' ? 'bad' : row.state === 'FINISHED' ? 'neutral' : 'good'}>{row.state.toLowerCase()}</StatusBadge><small>idle {row.idleSeconds}s</small>{row.failure && <small className="control-wrap">{row.failure}</small>}</div> },
    { key: 'actions', label: '', render: (row) => <button type="button" className="control-button danger" disabled={busy} onClick={() => void stop(row.id)}>Stop</button> },
  ];

  const acceleration = data?.acceleration;

  return (
    <>
      <section className="control-section">
        <div className="control-section-heading">
          <h2>Transcoding</h2>
          <span>Live FFmpeg sessions and why each one exists</span>
        </div>
        {error && <div className="admin-notice error">{error}</div>}
        <div className="control-panel">
          <DataTable rows={data?.sessions ?? []} columns={columns} rowKey={(row) => row.id} empty="No HLS sessions are running. Direct-play streams do not appear here." />
        </div>
      </section>

      <section className="control-section">
        <div className="control-section-heading">
          <h2>Hardware acceleration</h2>
          <span>{acceleration ? `FFmpeg ${acceleration.ffmpegVersion ?? 'unavailable'} · detected ${new Date(acceleration.detectedAt).toLocaleTimeString()}` : 'Detecting…'}</span>
        </div>
        <div className="control-panel transcode-accel">
          {acceleration && (
            <>
              <div className="transcode-accel-summary">
                <div>
                  <span>Configured</span>
                  <strong>{acceleration.requested}</strong>
                </div>
                <div>
                  <span>In use</span>
                  <strong>{acceleration.effective === 'NONE' ? 'Software (libx264)' : acceleration.effective}</strong>
                </div>
                <div className="transcode-accel-actions">
                  {canDetect && <button type="button" className="control-button" disabled={busy} onClick={() => void detect()}>{busy ? 'Detecting…' : 'Re-detect'}</button>}
                  <Link className="control-button" href="/admin/settings?tab=playback">Change</Link>
                </div>
              </div>
              {acceleration.fallbackReason && <div className="admin-notice warn">{acceleration.fallbackReason}</div>}
              {!acceleration.ffmpegAvailable && <div className="admin-notice error">FFmpeg is not available to the backend. Transcoding and media analysis will fail until it is installed.</div>}
              <ul className="transcode-encoders">
                {acceleration.encoders.map((encoder) => (
                  <li key={encoder.id}>
                    <StatusBadge tone={encoder.usable ? 'good' : 'neutral'}>{encoder.usable ? 'usable' : 'unavailable'}</StatusBadge>
                    <span><strong>{encoder.label}</strong><small>{encoder.encoder}{encoder.reason ? ` — ${encoder.reason}` : ''}</small></span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      </section>
    </>
  );
}
