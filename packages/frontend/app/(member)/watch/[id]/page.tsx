'use client';

import { useParams } from 'next/navigation';
import { PlaceholderPage } from '@/components/PlaceholderPage';

/**
 * Video player.
 *
 * TODO(phase-6): hls.js player against a plain <video> element.
 *  - Try direct play (range-request stream) first; fall back to HLS transcode
 *    (GET /api/stream/:id/index.m3u8) when the browser can't play the source.
 *  - Report progress to POST /api/progress (SaveProgressRequest) on interval +
 *    on pause/unload; resume from WatchProgressDTO.positionSeconds.
 *  - `hls.js` is already a declared dependency for this phase.
 */
export default function WatchPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;

  return (
    <PlaceholderPage
      title="Player"
      todo={`phase-6 — hls.js player for item "${id}": direct play + HLS transcode fallback, per-profile resume.`}
    >
      <div
        style={{
          marginTop: 18,
          aspectRatio: '16 / 9',
          maxWidth: 900,
          background: '#000',
          border: '1px solid var(--surface-border)',
          borderRadius: 'var(--radius)',
          display: 'grid',
          placeItems: 'center',
          color: 'var(--text-dim)',
        }}
      >
        &lt;video&gt; + hls.js goes here
      </div>
    </PlaceholderPage>
  );
}
