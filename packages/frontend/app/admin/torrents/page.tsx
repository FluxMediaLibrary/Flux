import type { Metadata } from 'next';
import { PlaceholderPage } from '@/components/PlaceholderPage';

export const metadata: Metadata = { title: 'Torrents' };

/**
 * TODO(phase-7): Admin torrent acquisition.
 *  - Upload .torrent (multipart) -> POST /api/torrents/parse -> TorrentParseResult.
 *  - Confirm/correct match (TMDb search-and-confirm, season/episode mapping) ->
 *    POST /api/torrents/confirm (ConfirmTorrentRequest).
 *  - Live progress + seeding stats table polling GET /api/torrents -> TorrentDTO[].
 */
export default function AdminTorrentsPage() {
  return (
    <PlaceholderPage
      title="Torrents"
      todo="phase-7 — upload .torrent, confirm TMDb match + episode mapping, live download/seeding stats."
    />
  );
}
