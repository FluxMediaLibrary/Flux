'use client';

import { useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { useAuth } from '@/lib/auth-context';
import { api, FluxApiError } from '@/lib/api';

export default function DeviceLinkPage() {
  const { status, account } = useAuth();
  const [code, setCode] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<'approved' | 'denied' | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function decide(approve: boolean) {
    setSubmitting(true);
    setError(null);
    try {
      const response = await api.approveDevice({ userCode: code, approve });
      setResult(response.state);
    } catch (requestError) {
      setError(requestError instanceof FluxApiError ? requestError.message : 'Flux could not process this device code.');
    } finally {
      setSubmitting(false);
    }
  }

  if (status === 'loading') {
    return <div className="centered-viewport"><div className="spinner" /></div>;
  }
  if (status === 'anonymous') {
    return (
      <main className="centered-viewport device-link-page">
        <Image src="/icon-192.png" width={96} height={96} alt="Flux" priority />
        <h1>Link a Roku</h1>
        <p className="muted">Sign in to approve the code shown on your television.</p>
        <Link className="btn btn-primary" href="/login">Sign in</Link>
      </main>
    );
  }
  if (result) {
    return (
      <main className="centered-viewport device-link-page">
        <Image src="/icon-192.png" width={96} height={96} alt="Flux" priority />
        <h1>{result === 'approved' ? 'Roku linked' : 'Link denied'}</h1>
        <p className="muted">
          {result === 'approved' ? 'Return to your television. Flux will continue automatically.' : 'The Roku was not granted access.'}
        </p>
        <Link className="btn btn-ghost" href="/library">Back to Flux</Link>
      </main>
    );
  }

  return (
    <main className="centered-viewport device-link-page">
      <Image src="/icon-192.png" width={96} height={96} alt="Flux" priority />
      <h1>Link a Roku</h1>
      <p className="muted">Signed in as {account?.email}. Enter the six-character code shown on your television.</p>
      <input
        className="input device-link-code"
        aria-label="Roku device code"
        autoComplete="one-time-code"
        autoCapitalize="characters"
        maxLength={7}
        value={code}
        onChange={(event) => setCode(event.target.value.toUpperCase())}
        placeholder="ABC-234"
      />
      {error && <div className="form-error">{error}</div>}
      <div className="device-link-actions">
        <button className="btn btn-primary" disabled={submitting || code.replace(/[^A-Z0-9]/g, '').length !== 6} onClick={() => void decide(true)}>
          {submitting ? 'Checking...' : 'Approve Roku'}
        </button>
        <button className="btn btn-ghost" disabled={submitting || code.replace(/[^A-Z0-9]/g, '').length !== 6} onClick={() => void decide(false)}>
          Deny
        </button>
      </div>
    </main>
  );
}
