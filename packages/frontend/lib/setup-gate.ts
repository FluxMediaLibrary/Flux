'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';

/**
 * Cheap, cached check of the first-run state. Used by the entry redirector and
 * the login page so a fresh install lands in the wizard instead of a login
 * form that no account can pass. Once setup is complete the answer is cached
 * for the tab so later navigations do not pay for the request.
 */
const SESSION_KEY = 'flux.setupComplete';

export type SetupGateState = 'checking' | 'needs-setup' | 'ready' | 'unreachable';

export function useSetupGate(): SetupGateState {
  const [state, setState] = useState<SetupGateState>(() => {
    if (typeof window === 'undefined') return 'checking';
    try {
      return window.sessionStorage.getItem(SESSION_KEY) === '1' ? 'ready' : 'checking';
    } catch {
      return 'checking';
    }
  });

  useEffect(() => {
    if (state !== 'checking') return;
    let cancelled = false;
    api.getSetupStatus()
      .then((status) => {
        if (cancelled) return;
        const ready = status.completed && !status.needsAdmin;
        if (ready) {
          try { window.sessionStorage.setItem(SESSION_KEY, '1'); } catch { /* private mode */ }
        }
        setState(ready ? 'ready' : 'needs-setup');
      })
      .catch(() => {
        if (!cancelled) setState('unreachable');
      });
    return () => { cancelled = true; };
  }, [state]);

  return state;
}
