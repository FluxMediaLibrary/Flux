'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { AdminPermission, AdminSignalDTO } from '@flux/shared';
import { useAuth } from '@/lib/auth-context';
import { subscribeAdminSignals } from '@/lib/api';
import { Avatar } from '@/components/Avatar';
import { SearchOverlay } from '@/components/SearchOverlay';

type NavItem = {
  href: string;
  label: string;
  icon: IconName;
  permission: AdminPermission;
};

type IconName = 'overview' | 'library' | 'requests' | 'downloads' | 'users' | 'playback' | 'storage' | 'activity' | 'system' | 'settings' | 'search' | 'bell' | 'menu' | 'close' | 'back' | 'chevron';

const NAV: NavItem[] = [
  { href: '/admin/overview', label: 'Overview', icon: 'overview', permission: 'VIEW_SYSTEM' },
  { href: '/admin/library', label: 'Library', icon: 'library', permission: 'MANAGE_LIBRARY' },
  { href: '/admin/requests', label: 'Requests', icon: 'requests', permission: 'MANAGE_REQUESTS' },
  { href: '/admin/downloads', label: 'Downloads', icon: 'downloads', permission: 'MANAGE_DOWNLOADS' },
  { href: '/admin/users', label: 'Users', icon: 'users', permission: 'MANAGE_USERS' },
  { href: '/admin/playback', label: 'Playback', icon: 'playback', permission: 'VIEW_SYSTEM' },
  { href: '/admin/storage', label: 'Storage', icon: 'storage', permission: 'VIEW_SYSTEM' },
  { href: '/admin/activity', label: 'Activity', icon: 'activity', permission: 'VIEW_LOGS' },
  { href: '/admin/system', label: 'System', icon: 'system', permission: 'VIEW_SYSTEM' },
  { href: '/admin/settings', label: 'Settings', icon: 'settings', permission: 'CHANGE_SETTINGS' },
];

const AdminSignalContext = createContext<{ signal: AdminSignalDTO | null; connected: boolean }>({ signal: null, connected: false });

export function useAdminSignal() {
  return useContext(AdminSignalContext);
}

export function AdminControlCenter({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { account, activeProfile, isAdmin, switchProfile, logout } = useAuth();
  const [signal, setSignal] = useState<AdminSignalDTO | null>(null);
  const [connected, setConnected] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const [readFingerprint, setReadFingerprint] = useState<string | null>(null);
  const [dismissedNotifications, setDismissedNotifications] = useState<string[]>([]);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => subscribeAdminSignals(setSignal, setConnected), []);
  useEffect(() => {
    setMobileOpen(false);
    setNotificationsOpen(false);
    setAccountOpen(false);
  }, [pathname]);
  useEffect(() => {
    setReadFingerprint(window.localStorage.getItem('flux.admin.notificationsRead'));
    try {
      setDismissedNotifications(JSON.parse(window.localStorage.getItem('flux.admin.notificationsDismissed') ?? '[]') as string[]);
    } catch {
      setDismissedNotifications([]);
    }
  }, []);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setSearchOpen(true);
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);
  useEffect(() => {
    const close = (event: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(event.target as Node)) {
        setNotificationsOpen(false);
        setAccountOpen(false);
      }
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);

  const permissions = account?.permissions ?? [];
  const nav = isAdmin ? NAV : NAV.filter((item) => permissions.includes(item.permission));
  const notifications = useMemo(() => {
    if (!signal) return [];
    return [
      signal.counts.failedDownloads > 0 ? { id: 'downloads', tone: 'critical', title: `${signal.counts.failedDownloads} failed download${signal.counts.failedDownloads === 1 ? '' : 's'}`, href: '/admin/downloads?status=ERROR' } : null,
      signal.counts.pendingRequests > 0 ? { id: 'requests', tone: 'warning', title: `${signal.counts.pendingRequests} request${signal.counts.pendingRequests === 1 ? '' : 's'} waiting`, href: '/admin/requests?status=PENDING' } : null,
      signal.counts.libraryIssues > 0 ? { id: 'library', tone: 'warning', title: `${signal.counts.libraryIssues} library issue${signal.counts.libraryIssues === 1 ? '' : 's'}`, href: '/admin/library?issue=ALL' } : null,
      signal.storagePercent !== null && signal.storagePercent >= 0.85 ? { id: 'storage', tone: signal.storagePercent >= 0.95 ? 'critical' : 'warning', title: `Storage ${Math.round(signal.storagePercent * 100)}% full`, href: '/admin/storage' } : null,
    ].filter((item): item is NonNullable<typeof item> => item !== null);
  }, [signal]);
  const visibleNotifications = notifications.filter((item) => !dismissedNotifications.includes(`${item.id}:${item.title}`));
  const notificationFingerprint = visibleNotifications.map((item) => `${item.id}:${item.title}`).join('|');
  const unread = visibleNotifications.length > 0 && readFingerprint !== notificationFingerprint;

  const markRead = () => {
    setReadFingerprint(notificationFingerprint);
    window.localStorage.setItem('flux.admin.notificationsRead', notificationFingerprint);
  };
  const dismissNotification = (id: string) => {
    const next = [...dismissedNotifications, id];
    setDismissedNotifications(next);
    window.localStorage.setItem('flux.admin.notificationsDismissed', JSON.stringify(next));
  };

  return (
    <AdminSignalContext.Provider value={{ signal, connected }}>
      <div className="control-center">
        <aside className={`control-sidebar${mobileOpen ? ' is-open' : ''}`} aria-label="Admin navigation">
          <div className="control-brand">
            <Link href="/admin/overview" className="control-brand-mark" aria-label="Flux control center">F<span>X</span></Link>
            <div><strong>Flux</strong><small>Control center</small></div>
            <button className="control-icon-button control-mobile-close" onClick={() => setMobileOpen(false)} aria-label="Close navigation"><Icon name="close" /></button>
          </div>
          <nav className="control-nav">
            <span className="control-nav-label">Operations</span>
            {nav.map((item) => {
              const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
              const badge = item.label === 'Requests' && signal?.counts.pendingRequests
                ? String(signal.counts.pendingRequests)
                : item.label === 'Downloads' && signal?.counts.failedDownloads
                  ? `${signal.counts.failedDownloads} failed`
                  : null;
              const alert = item.label === 'System' && signal?.status === 'UNHEALTHY';
              const warning = item.label === 'Storage' && signal?.storagePercent != null && signal.storagePercent >= 0.85;
              return (
                <Link key={item.href} href={item.href} className={`control-nav-link${active ? ' active' : ''}`} aria-current={active ? 'page' : undefined}>
                  <Icon name={item.icon} />
                  <span>{item.label}</span>
                  {badge && <em className={item.label === 'Downloads' ? 'is-error' : ''}>{badge}</em>}
                  {(alert || warning) && <i className={alert ? 'is-error' : 'is-warning'} aria-label={alert ? 'Unhealthy' : 'Warning'} />}
                </Link>
              );
            })}
          </nav>
          <div className="control-sidebar-footer">
            <div className="control-live-state"><span className={connected ? 'online' : 'offline'} />{connected ? 'Live updates connected' : 'Reconnecting live updates'}</div>
            <Link href="/library" className="control-back-link"><Icon name="back" /> Return to Flux</Link>
          </div>
        </aside>

        <div className="control-workspace">
          <header className="control-topbar" ref={panelRef}>
            <button className="control-icon-button control-mobile-menu" onClick={() => setMobileOpen(true)} aria-label="Open navigation"><Icon name="menu" /></button>
            <button className="control-search" onClick={() => setSearchOpen(true)}><Icon name="search" /><span>Search the media library</span><kbd>⌘ K</kbd></button>
            <div className="control-topbar-actions">
              <div className={`control-server-chip tone-${signal?.status.toLowerCase() ?? 'unknown'}`}><span />{signal?.status === 'HEALTHY' ? 'All systems normal' : signal?.status === 'DEGRADED' ? 'Attention needed' : signal?.status === 'UNHEALTHY' ? 'System unhealthy' : 'Connecting'}</div>
              <button className="control-icon-button control-bell" onClick={() => { setNotificationsOpen((open) => !open); setAccountOpen(false); if (!notificationsOpen) markRead(); }} aria-label="Notifications"><Icon name="bell" />{unread && <span />}</button>
              <button className="control-account-button" onClick={() => { setAccountOpen((open) => !open); setNotificationsOpen(false); }} aria-label="Admin account menu">
                <Avatar name={activeProfile?.name ?? account?.email ?? '?'} avatar={activeProfile?.avatar} size={30} />
                <span>{activeProfile?.name ?? 'Administrator'}</span><Icon name="chevron" />
              </button>
            </div>

            {notificationsOpen && (
              <div className="control-popover control-notifications">
                <header><strong>Notifications</strong><span>{visibleNotifications.length} active</span></header>
                {visibleNotifications.length === 0 ? <p className="control-popover-empty">No active warnings. Flux is quiet.</p> : visibleNotifications.map((item) => {
                  const notificationId = `${item.id}:${item.title}`;
                  return <div className="control-notification-row" key={notificationId}><Link href={item.href} className="control-notification"><i className={`tone-${item.tone}`} /><span>{item.title}<small>Open affected items</small></span><Icon name="chevron" /></Link><button aria-label={`Dismiss ${item.title}`} onClick={() => dismissNotification(notificationId)}>×</button></div>;
                })}
              </div>
            )}
            {accountOpen && (
              <div className="control-popover control-account-menu">
                <div><strong>{activeProfile?.name ?? 'Administrator'}</strong><span>{account?.email}</span></div>
                <button onClick={() => { switchProfile(); router.replace('/profiles'); }}>Switch profile</button>
                <button onClick={() => { logout(); router.replace('/login'); }}>Log out</button>
              </div>
            )}
          </header>
          <main className="control-content">{children}</main>
        </div>
        {mobileOpen && <button className="control-scrim" onClick={() => setMobileOpen(false)} aria-label="Close navigation" />}
      </div>
      {searchOpen && <SearchOverlay onClose={() => setSearchOpen(false)} />}
    </AdminSignalContext.Provider>
  );
}

const iconProps = { width: 20, height: 20, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true } as const;

function Icon({ name }: { name: IconName }) {
  const paths: Record<IconName, ReactNode> = {
    overview: <><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="4" rx="1"/><rect x="14" y="11" width="7" height="10" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/></>,
    library: <><path d="M4 5.5 12 3l8 2.5v13L12 21l-8-2.5z"/><path d="M12 3v18M4 5.5l8 2.5 8-2.5"/></>,
    requests: <><path d="M6 3h12v18H6z"/><path d="M9 8h6M9 12h6M9 16h3"/></>,
    downloads: <><path d="M12 3v12m0 0 4-4m-4 4-4-4"/><path d="M4 20h16"/></>,
    users: <><circle cx="9" cy="8" r="3"/><path d="M3 20a6 6 0 0 1 12 0M17 5.5a3 3 0 0 1 0 5M18 14a6 6 0 0 1 3 6"/></>,
    playback: <><circle cx="12" cy="12" r="9"/><path d="m10 8 6 4-6 4z"/></>,
    storage: <><ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v7c0 1.7 3.6 3 8 3s8-1.3 8-3V5M4 12v7c0 1.7 3.6 3 8 3s8-1.3 8-3v-7"/></>,
    activity: <><path d="M3 12h4l2-6 4 12 2-6h6"/></>,
    system: <><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M7 9h4M7 13h7M17 8v8"/></>,
    settings: <><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-2.8 2.8-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6v.2h-4V21a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1L4.2 17l.1-.1a1.7 1.7 0 0 0 .3-1.9A1.7 1.7 0 0 0 3 14H2.8v-4H3a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9L4.2 7 7 4.2l.1.1A1.7 1.7 0 0 0 9 4.6 1.7 1.7 0 0 0 10 3V2.8h4V3a1.7 1.7 0 0 0 1 1.6 1.7 1.7 0 0 0 1.9-.3l.1-.1L19.8 7l-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.6 1h.2v4H21a1.7 1.7 0 0 0-1.6 1z"/></>,
    search: <><circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/></>, bell: <><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4"/></>,
    menu: <path d="M4 7h16M4 12h16M4 17h16"/>, close: <path d="m6 6 12 12M18 6 6 18"/>, back: <path d="m15 18-6-6 6-6"/>, chevron: <path d="m9 6 6 6-6 6"/>,
  };
  return <svg {...iconProps}>{paths[name]}</svg>;
}
