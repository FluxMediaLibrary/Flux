'use client';

import { useRouter } from 'next/navigation';
import { useEffect, type ReactNode } from 'react';
import { useAuth } from '@/lib/auth-context';

function FullPageLoader({ label = 'Loading…' }: { label?: string }) {
  return (
    <div className="centered-viewport">
      <div className="spinner" aria-hidden />
      <p className="muted">{label}</p>
    </div>
  );
}

/**
 * Requires an authenticated account. Unauthenticated -> /login.
 * Used by the profile picker (active profile not yet required).
 */
export function RequireAuth({ children }: { children: ReactNode }) {
  const { status } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (status === 'anonymous') router.replace('/login');
  }, [status, router]);

  if (status !== 'authenticated') return <FullPageLoader />;
  return <>{children}</>;
}

/**
 * Requires auth AND an active profile. No active profile -> /profiles.
 * The member app shell lives behind this.
 */
export function RequireProfile({ children }: { children: ReactNode }) {
  const { status, activeProfileId } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (status === 'anonymous') router.replace('/login');
    else if (status === 'authenticated' && !activeProfileId) {
      router.replace('/profiles');
    }
  }, [status, activeProfileId, router]);

  if (status !== 'authenticated' || !activeProfileId) return <FullPageLoader />;
  return <>{children}</>;
}

/**
 * Requires auth + active profile + ADMIN role. Non-admins -> /library.
 */
export function RequireAdmin({ children }: { children: ReactNode }) {
  const { status, activeProfileId, isAdmin } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (status === 'anonymous') router.replace('/login');
    else if (status === 'authenticated') {
      if (!activeProfileId) router.replace('/profiles');
      else if (!isAdmin) router.replace('/library');
    }
  }, [status, activeProfileId, isAdmin, router]);

  if (status !== 'authenticated' || !activeProfileId || !isAdmin) {
    return <FullPageLoader />;
  }
  return <>{children}</>;
}
