'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter, usePathname, useSearchParams } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';
import { SearchOverlay } from '@/components/SearchOverlay';
import { Avatar } from '@/components/Avatar';

declare global {
  interface Window {
    FLUX_NATIVE_APP?: boolean;
    FluxNative?: {
      isNativeApp?: () => boolean;
      checkForUpdates?: () => void;
      getAppInfo?: () => string;
      requestCast?: () => void;
      setAutomaticUpdates?: (enabled: boolean) => void;
      clearUpdateDownloads?: () => void;
      setPlaybackContext?: (payload: string) => void;
    };
  }
}

const TABS = [
  { label: 'Library', href: '/library', query: ''},
  { label: 'Movies', href: '/library', query: 'movie' },
  { label: 'Shows', href: '/library', query: 'tv' },
] as const;

export function Navbar() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { activeProfile, isAdmin, account, switchProfile, logout } = useAuth();
  const adminAccess = isAdmin || (account?.permissions?.length ?? 0) > 0;

  const [menu, setMenu] = useState<null | 'nav' | 'profile'>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [nativeApp, setNativeApp] = useState(false);
  const barRef = useRef<HTMLElement>(null);

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (barRef.current && !barRef.current.contains(e.target as Node)) setMenu(null);
    }
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  useEffect(() => {
    setNativeApp(Boolean(window.FLUX_NATIVE_APP || window.FluxNative?.isNativeApp?.()));
  }, []);

  const currentType = searchParams.get('type');
  const isActive = (t: (typeof TABS)[number], idx: number): boolean => {
    if (pathname.startsWith(t.href)) {
      if (t.href === '/library') {
        // Movies/Shows/Episodes disambiguate by ?type=
        const wantIdx = TABS.findIndex((x) => x.href === '/library' && x.query === (currentType ?? 'movie'));
        return idx === wantIdx;
      }
      return TABS.findIndex((x) => x.href === t.href) === idx; // first /browse tab
    }
    return false;
  };

  const go = (t: (typeof TABS)[number]) => {
    setMenu(null);
    router.push(`${t.href}?type=${t.query}`);
  };

  const handleUpdates = () => {
    setMenu(null);
    if (nativeApp && window.FluxNative?.checkForUpdates) {
      window.FluxNative.checkForUpdates();
      return;
    }
    if (isAdmin || account?.permissions?.includes('CHANGE_SETTINGS')) {
      router.push('/admin/settings#updates');
      return;
    }
    window.location.href = '/flux.apk';
  };

  return (
    <>
      <header className="navbar" ref={barRef}>
        <div className="navbar__left">
          <button
            className="nav-ic"
            aria-label="Menu"
            onClick={() => setMenu((m) => (m === 'nav' ? null : 'nav'))}
          >
            <IconMenu />
          </button>
          <button className="navbar__request" onClick={() => router.push('/browse')}>
            <IconPlus /> <span className="navbar__request-label">Request</span>
          </button>
        </div>

        <nav className="navbar__tabs">
          {TABS.map((t, i) => (
            <button
              key={t.label}
              className={`navbar__tab${isActive(t, i) ? ' active' : ''}`}
              onClick={() => go(t)}
            >
              {t.label}
            </button>
          ))}
        </nav>

        <div className="navbar__right">
          <button className="nav-ic nav-ic--opt" aria-label="Users" onClick={() => router.push('/profiles')}>
            <IconUsers />
          </button>
          {adminAccess && (
            <button
              className="nav-ic nav-ic--opt"
              aria-label="Admin"
              onClick={() => router.push('/admin/overview')}
              title="Admin"
            >
              <IconShield />
            </button>
          )}
          <button className="nav-ic" aria-label="Search" onClick={() => setSearchOpen(true)}>
            <IconSearch />
          </button>
          <button
            className="nav-ic"
            aria-label="Profile"
            onClick={() => setMenu((m) => (m === 'profile' ? null : 'profile'))}
          >
            <Avatar
              name={activeProfile?.name ?? '?'}
              avatar={activeProfile?.avatar}
              size={32}
              className="nav-avatar"
            />
          </button>
        </div>

        {menu === 'nav' && (
          <div className="nav-menu" style={{ left: 18, right: 'auto' }} role="menu">
            <button onClick={() => { setMenu(null); router.push('/library'); }}>Library</button>
            <button onClick={() => { setMenu(null); router.push('/browse'); }}>Browse &amp; Request</button>
            {adminAccess && (
              <button onClick={() => { setMenu(null); router.push('/admin/overview'); }}>Admin</button>
            )}
          </div>
        )}

        {menu === 'profile' && (
          <div className="nav-menu" role="menu">
            <button onClick={handleUpdates}>
              {nativeApp ? 'Check for updates' : isAdmin ? 'Updates' : 'Download Android app'}
            </button>
            <button onClick={() => { setMenu(null); switchProfile(); router.replace('/profiles'); }}>
              Switch profile
            </button>
            <button onClick={() => { setMenu(null); logout(); router.replace('/login'); }}>
              Log out
            </button>
          </div>
        )}
      </header>

      {searchOpen && <SearchOverlay onClose={() => setSearchOpen(false)} />}
    </>
  );
}

/* ── Monochrome outline icons ─────────────────────────────────────────────── */
const ico = { width: 21, height: 21, fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' } as const;
const IconMenu = () => (<svg viewBox="0 0 24 24" {...ico}><path d="M4 6h16M4 12h16M4 18h16" /></svg>);
const IconPlus = () => (<svg viewBox="0 0 24 24" {...ico}><path d="M12 5v14M5 12h14" /></svg>);
const IconUsers = () => (<svg viewBox="0 0 24 24" {...ico}><circle cx="9" cy="8" r="3.2" /><path d="M2.5 20a6.5 6.5 0 0 1 13 0" /><path d="M17 5.2a3.2 3.2 0 0 1 0 5.6" /><path d="M18.5 14.2A6.5 6.5 0 0 1 21.5 20" /></svg>);
const IconSearch = () => (<svg viewBox="0 0 24 24" {...ico}><circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" /></svg>);
const IconShield = () => (<svg viewBox="0 0 24 24" {...ico}><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" /></svg>);
