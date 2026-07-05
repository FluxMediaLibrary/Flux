'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { useAuth } from '@/lib/auth-context';

/**
 * Entry redirector. Sends the visitor to the right place based on session:
 *   anonymous            -> /login
 *   authed, no profile   -> /profiles
 *   authed, has profile  -> /library
 */
export default function RootPage() {
  const { status, activeProfileId } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (status === 'loading') return;
    if (status === 'anonymous') router.replace('/login');
    else if (!activeProfileId) router.replace('/profiles');
    else router.replace('/library');
  }, [status, activeProfileId, router]);

  return (
    <div className="centered-viewport">
      <div className="spinner" aria-hidden />
      <p className="muted">Starting Flux…</p>
    </div>
  );
}
