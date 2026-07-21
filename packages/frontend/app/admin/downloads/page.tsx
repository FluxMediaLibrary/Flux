'use client';

import { Suspense } from 'react';
import { TorrentsAdmin } from '@/components/torrents/TorrentsAdmin';

export default function AdminDownloadsPage() {
  return (
    <Suspense fallback={<div className="control-loading-grid" aria-label="Loading"><div className="control-skeleton" /></div>}>
      <TorrentsAdmin />
    </Suspense>
  );
}
