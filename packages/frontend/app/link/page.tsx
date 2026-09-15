'use client';

import { Suspense, useCallback, useEffect, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import type { LinkedDeviceDTO, PendingDeviceLinkDTO } from '@flux/shared';
import { api, FluxApiError } from '@/lib/api';
import { RequireAuth } from '@/components/Guards';

function formatCode(raw: string): string {
  const clean = raw.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);
  return clean.length > 4 ? `${clean.slice(0, 4)}-${clean.slice(4)}` : clean;
}

function platformLabel(platform: string): string {
  return platform === 'roku' ? 'Roku' : platform;
}

function LinkDevicePage() {
  const params = useSearchParams();
  const initialCode = formatCode(params.get('code') ?? '');
  const [code, setCode] = useState(initialCode);
  const [pending, setPending] = useState<PendingDeviceLinkDTO | null>(null);
  const [devices, setDevices] = useState<LinkedDeviceDTO[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<PendingDeviceLinkDTO | null>(null);

  const loadDevices = useCallback(async () => {
    try {
      setDevices(await api.listLinkedDevices());
    } catch {
      /* the list is informational */
    }
  }, []);

  useEffect(() => { void loadDevices(); }, [loadDevices]);

  const lookup = useCallback(async (value: string) => {
    if (value.replace('-', '').length !== 8) {
      setError('Enter the 8-character code shown on the TV.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      setPending(await api.getPendingDeviceLink(value));
    } catch (err) {
      setPending(null);
      setError(err instanceof FluxApiError ? err.message : 'That code could not be checked.');
    } finally {
      setBusy(false);
    }
  }, []);

  // A TV can show a QR/URL that carries the code; check it straight away.
  useEffect(() => {
    if (initialCode.replace('-', '').length === 8) void lookup(initialCode);
  }, [initialCode, lookup]);

  function submit(event: FormEvent) {
    event.preventDefault();
    void lookup(code);
  }

  async function approve() {
    if (!pending) return;
    setBusy(true);
    setError(null);
    try {
      const result = await api.approveDeviceLink(pending.userCode);
      setDone(result);
      setPending(null);
      setCode('');
      await loadDevices();
    } catch (err) {
      setError(err instanceof FluxApiError ? err.message : 'The device could not be linked.');
    } finally {
      setBusy(false);
    }
  }

  async function deny() {
    if (!pending) return;
    setBusy(true);
    try {
      await api.denyDeviceLink(pending.userCode);
      setPending(null);
      setCode('');
    } finally {
      setBusy(false);
    }
  }

  async function revoke(device: LinkedDeviceDTO) {
    if (!window.confirm(`Remove ${device.deviceName}? It will have to be linked again.`)) return;
    try {
      await api.revokeLinkedDevice(device.id);
      await loadDevices();
    } catch (err) {
      setError(err instanceof FluxApiError ? err.message : 'The device could not be removed.');
    }
  }

  return (
    <main className="link-shell">
      <div className="link-card">
        <div className="auth-brand"><span className="brand-mark">◈</span> Link a TV</div>
        <p className="auth-sub">Open Flux on your TV, then enter the code it shows here.</p>

        {error && <div className="form-error" role="alert">{error}</div>}
        {done && (
          <div className="link-success" role="status">
            <strong>{done.deviceName}</strong> is linked. It will sign in on its own within a few seconds.
          </div>
        )}

        {!pending ? (
          <form onSubmit={submit} noValidate className="link-form">
            <label htmlFor="link-code" className="link-label">Code from the TV</label>
            <input
              id="link-code"
              className="input link-input"
              value={code}
              onChange={(event) => { setCode(formatCode(event.target.value)); setDone(null); }}
              placeholder="ABCD-2345"
              autoComplete="off"
              autoCapitalize="characters"
              spellCheck={false}
              maxLength={9}
            />
            <button className="btn btn-primary btn-block" type="submit" disabled={busy || code.replace('-', '').length !== 8}>
              {busy ? 'Checking…' : 'Continue'}
            </button>
          </form>
        ) : (
          <div className="link-pending">
            <dl className="setup-kv">
              <dt>Device</dt><dd>{pending.deviceName}</dd>
              <dt>Platform</dt><dd>{platformLabel(pending.platform)} · app {pending.appVersion}</dd>
              <dt>Code</dt><dd><code>{pending.userCode}</code></dd>
            </dl>
            <p className="dim">Approving gives this device access to your account and its profiles until you remove it below.</p>
            <div className="setup-actions">
              <button className="btn btn-ghost" type="button" onClick={() => void deny()} disabled={busy}>Deny</button>
              <button className="btn btn-primary" type="button" onClick={() => void approve()} disabled={busy}>{busy ? 'Linking…' : 'Approve this TV'}</button>
            </div>
          </div>
        )}

        <section className="link-devices">
          <h2>Linked devices</h2>
          {devices.length === 0 ? (
            <p className="dim">No TVs are linked to your account yet.</p>
          ) : (
            <ul>
              {devices.map((device) => (
                <li key={device.id}>
                  <span>
                    <strong>{device.deviceName}</strong>
                    <small>{platformLabel(device.platform)} · last seen {new Date(device.lastSeenAt).toLocaleString()}</small>
                  </span>
                  <button className="btn btn-ghost btn-sm danger" type="button" onClick={() => void revoke(device)}>Remove</button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <p className="auth-alt"><Link href="/library">Back to Flux</Link></p>
      </div>
    </main>
  );
}

export default function LinkPage() {
  return (
    <RequireAuth>
      <Suspense fallback={<div className="centered-viewport"><div className="spinner" aria-hidden /></div>}>
        <LinkDevicePage />
      </Suspense>
    </RequireAuth>
  );
}
