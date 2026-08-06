'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState, type FormEvent } from 'react';
import { useAuth } from '@/lib/auth-context';
import { FluxApiError } from '@/lib/api';

function SignupForm() {
  const { status, activeProfileId, signup } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [inviteCode, setInviteCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Prefill the invite code from an invite link (?code=...).
  useEffect(() => {
    const code = searchParams.get('code');
    if (code) setInviteCode(code);
  }, [searchParams]);

  useEffect(() => {
    if (status === 'authenticated') {
      router.replace(activeProfileId ? '/library' : '/profiles');
    }
  }, [status, activeProfileId, router]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await signup({ email, password, inviteCode });
      router.replace('/profiles');
    } catch (err) {
      setError(
        err instanceof FluxApiError
          ? err.message
          : 'Something went wrong. Please try again.',
      );
      setSubmitting(false);
    }
  }

  return (
    <div className="auth-card">
      <div className="auth-brand">
        <span className="brand-mark">◈</span> Flux
      </div>
      <p className="auth-sub">Create your account with an invite code.</p>

      {error && <div className="form-error">{error}</div>}

      <form onSubmit={onSubmit} noValidate>
        <div className="field">
          <label htmlFor="email">Email</label>
          <input
            id="email"
            className="input"
            type="email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
        </div>
        <div className="field">
          <label htmlFor="password">Password</label>
          <input
            id="password"
            className="input"
            type="password"
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            minLength={8}
            required
          />
        </div>
        <div className="field">
          <label htmlFor="invite">Invite code</label>
          <input
            id="invite"
            className="input"
            type="text"
            value={inviteCode}
            onChange={(e) => setInviteCode(e.target.value)}
            placeholder="e.g. FLUX-XXXX-XXXX"
            required
          />
        </div>
        <button
          className="btn btn-primary btn-block"
          type="submit"
          disabled={submitting}
        >
          {submitting ? 'Creating account…' : 'Create account'}
        </button>
      </form>

      <p className="auth-alt">
        Already have an account? <Link href="/login">Sign in</Link>
      </p>
      <p className="auth-alt">
        Want the native app? <Link href="/downloads">Get the apps</Link>
      </p>
    </div>
  );
}

export default function SignupPage() {
  return (
    <Suspense
      fallback={
        <div className="auth-card">
          <div className="spinner" aria-hidden />
        </div>
      }
    >
      <SignupForm />
    </Suspense>
  );
}
