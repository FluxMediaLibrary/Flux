import type { Metadata } from 'next';
import { TorrentsAdmin } from '@/components/torrents/TorrentsAdmin';

export const metadata: Metadata = { title: 'Torrents' };

/**
 * Admin torrent acquisition (spec §4 — Torrent Acquisition).
 * Upload a .torrent → confirm TMDb match + episode mapping → start download,
 * plus a live download/seeding dashboard. Admin-gated by app/admin/layout.tsx.
 */
export default function AdminTorrentsPage() {
  return <TorrentsAdmin />;
}
