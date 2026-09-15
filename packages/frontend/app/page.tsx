'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { useAuth } from '@/lib/auth-context';
import { useSetupGate } from '@/lib/setup-gate';

/**
 * Entry redirector. Sends the visitor to the right place based on session:
 *   setup not finished   -> /setup
 *   anonymous            -> /login
 *   authed, no profile   -> /profiles
 *   authed, has profile  -> /library
 */
export default function RootPage() {
  const { status, activeProfileId } = useAuth();
  const setup = useSetupGate();
  const router = useRouter();

  useEffect(() => {
    if (setup === 'checking') return;
    if (setup === 'needs-setup') {
      router.replace('/setup');
      return;
    }
    if (status === 'loading') return;
    if (status === 'anonymous') router.replace('/login');
    else if (!activeProfileId) router.replace('/profiles');
    else router.replace('/library');
  }, [setup, status, activeProfileId, router]);

  return (
    <div className="centered-viewport">
      <div className="spinner" aria-hidden />
      <p className="muted">{setup === 'unreachable' ? 'Flux server is not reachable. Retrying…' : 'Starting Flux…'}</p>
    </div>
  );
}
