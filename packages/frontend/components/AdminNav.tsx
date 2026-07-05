'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const LINKS = [
  { href: '/admin/torrents', label: 'Torrents' },
  { href: '/admin/requests', label: 'Requests' },
  { href: '/admin/invites', label: 'Invites' },
  { href: '/admin/settings', label: 'Settings' },
];

export function AdminNav() {
  const pathname = usePathname();
  return (
    <aside className="admin-sidebar">
      <div className="admin-sidebar-head">
        <span className="tag admin">ADMIN</span>
      </div>
      <nav className="admin-links">
        {LINKS.map((l) => {
          const active = pathname === l.href || pathname.startsWith(l.href + '/');
          return (
            <Link
              key={l.href}
              href={l.href}
              className={active ? 'admin-link active' : 'admin-link'}
            >
              {l.label}
            </Link>
          );
        })}
      </nav>
      <Link href="/library" className="admin-back">
        ← Back to app
      </Link>
    </aside>
  );
}
