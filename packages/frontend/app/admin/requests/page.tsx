import type { Metadata } from 'next';
import { PlaceholderPage } from '@/components/PlaceholderPage';

export const metadata: Metadata = { title: 'Requests' };

/**
 * TODO(phase-5): Admin request queue.
 *  - GET /api/requests (admin scope) -> RequestDTO[] incl. requestedBy.
 *  - Approve / reject, and link a request to a torrent to fulfill it.
 */
export default function AdminRequestsPage() {
  return (
    <PlaceholderPage
      title="Member Requests"
      todo="phase-5 — review member requests (approve/reject), link to torrents for fulfillment."
    />
  );
}
