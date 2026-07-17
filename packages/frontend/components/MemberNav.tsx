'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { useAuth } from '@/lib/auth-context';
import { Avatar } from '@/components/Avatar';

const LINKS = [
  { href: '/home', label: 'Home' },
  { href: '/library', label: 'Library' },
  { href: '/browse', label: 'Browse' },
];

export function MemberNav() {
  const pathname = usePathname();
  const router = useRouter();
  const { activeProfile, isAdmin, account, switchProfile, logout } = useAuth();
  const adminAccess = isAdmin || (account?.permissions?.length ?? 0) > 0;
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    }
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  function handleSwitch() {
    setMenuOpen(false);
    switchProfile();
    router.replace('/profiles');
  }

  function handleLogout() {
    setMenuOpen(false);
    logout();
    router.replace('/login');
  }

  return (
    <header className="topnav">
      <div className="topnav-inner">
        <Link href="/home" className="brand" aria-label="Flux home">
          <span className="brand-mark">◈</span> Flux
        </Link>

        <nav className="topnav-links">
          {LINKS.map((l) => {
            const active = pathname === l.href || pathname.startsWith(l.href + '/');
            return (
              <Link
                key={l.href}
                href={l.href}
                className={active ? 'navlink active' : 'navlink'}
              >
                {l.label}
              </Link>
            );
          })}
          {adminAccess && (
            <Link
              href="/admin/overview"
              className={
                pathname.startsWith('/admin') ? 'navlink active' : 'navlink'
              }
            >
              Admin
            </Link>
          )}
        </nav>

        <div className="profile-menu" ref={menuRef}>
          <button
            type="button"
            className="profile-trigger"
            onClick={() => setMenuOpen((o) => !o)}
            aria-haspopup="menu"
            aria-expanded={menuOpen}
          >
            <Avatar
              name={activeProfile?.name ?? '?'}
              avatar={activeProfile?.avatar}
              size={30}
              className="avatar-sm"
            />
            <span className="profile-name">{activeProfile?.name ?? 'Profile'}</span>
            <span className="chevron" aria-hidden>
              ▾
            </span>
          </button>
          {menuOpen && (
            <div className="dropdown" role="menu">
              <button type="button" role="menuitem" onClick={handleSwitch}>
                Switch profile
              </button>
              <button type="button" role="menuitem" onClick={handleLogout}>
                Log out
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
