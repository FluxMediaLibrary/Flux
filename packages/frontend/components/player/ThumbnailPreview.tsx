'use client';

import { useEffect, useMemo, useState } from 'react';
import { api } from '@/lib/api';

interface VttEntry {
  start: number;
  end: number;
  x: number;
  y: number;
  w: number;
  h: number;
}

interface ThumbnailPreviewProps {
  mediaItemId: string;
  episodeId?: string;
  streamToken: string;
  /** The time position in seconds the user is hovering over */
  time: number;
  /** Left offset in pixels from the timeline edge */
  left: number;
  /** Whether to show the preview */
  visible: boolean;
}

function parseTimecode(value: string): number {
  const parts = value.split(':');
  const seconds = parts.pop() ?? '0';
  const minutes = parts.pop() ?? '0';
  const hours = parts.pop() ?? '0';
  return Number(hours) * 3600 + Number(minutes) * 60 + Number(seconds);
}

function parseTrickplayVtt(vttText: string): VttEntry[] {
  const entries: VttEntry[] = [];
  const lines = vttText.split('\n');
  let currentStart = 0;
  let currentEnd = 0;

  for (const line of lines) {
    const timeMatch = line.match(/^((?:\d{2}:)?\d{2}:\d{2}\.\d{3})\s*-->\s*((?:\d{2}:)?\d{2}:\d{2}\.\d{3})/);
    if (timeMatch) {
      currentStart = parseTimecode(timeMatch[1]);
      currentEnd = parseTimecode(timeMatch[2]);
    }

    const xywhMatch = line.match(/#xywh=(\d+),(\d+),(\d+),(\d+)/);
    if (xywhMatch) {
      entries.push({
        start: currentStart,
        end: currentEnd,
        x: parseInt(xywhMatch[1]),
        y: parseInt(xywhMatch[2]),
        w: parseInt(xywhMatch[3]),
        h: parseInt(xywhMatch[4]),
      });
    }
  }

  return entries;
}

function fmt(t: number): string {
  if (!Number.isFinite(t) || t < 0) return '0:00';
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const s = Math.floor(t % 60);
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
}

/**
 * Thumbnail preview shown above the timeline during hover/scrub.
 * Fetches trickplay VTT metadata once and maps time → sprite coordinates.
 */
export function ThumbnailPreview({
  mediaItemId,
  episodeId,
  streamToken,
  time,
  left,
  visible,
}: ThumbnailPreviewProps) {
  const [entries, setEntries] = useState<VttEntry[]>([]);
  const [status, setStatus] = useState<'loading' | 'ready' | 'unavailable'>('loading');
  const [spriteReady, setSpriteReady] = useState(false);
  const spriteUrl = useMemo(
    () => api.getTrickplayUrl(mediaItemId, 'trickplay-sprite.jpg', episodeId, streamToken),
    [episodeId, mediaItemId, streamToken],
  );

  // Fetch VTT metadata when media changes
  useEffect(() => {
    const vttUrl = api.getTrickplayUrl(mediaItemId, 'trickplay.vtt', episodeId, streamToken);
    if (!vttUrl) return;

    const controller = new AbortController();
    setEntries([]);
    setStatus('loading');
    setSpriteReady(false);

    fetch(vttUrl, { signal: controller.signal })
      .then((r) => {
        if (r.status === 204) return '';
        if (!r.ok) throw new Error('VTT not found');
        return r.text();
      })
      .then((text) => {
        const parsed = parseTrickplayVtt(text);
        setEntries(parsed);
        setStatus(parsed.length > 0 ? 'ready' : 'unavailable');
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === 'AbortError') return;
        setEntries([]); // trickplay not available for this media
        setStatus('unavailable');
      });

    return () => controller.abort();
  }, [mediaItemId, episodeId, streamToken]);

  useEffect(() => {
    if (status !== 'ready') return;
    const image = new Image();
    image.onload = () => setSpriteReady(true);
    image.onerror = () => setStatus('unavailable');
    image.src = spriteUrl;
    return () => {
      image.onload = null;
      image.onerror = null;
    };
  }, [spriteUrl, status]);

  if (!visible) return null;

  // Find the matching entry for the current time
  const entry = entries.find((e) => time >= e.start && time < e.end)
    ?? (entries.length > 0 && time >= entries[entries.length - 1]!.end
      ? entries[entries.length - 1]
      : undefined);
  const showImage = status === 'ready' && spriteReady && entry;

  return (
    <div
      className={status === 'unavailable' ? 'fx-scrub-preview is-time-only' : 'fx-scrub-preview'}
      style={{ left: `${left}px` }}
    >
      {status !== 'unavailable' && (
        <div
          className={showImage ? 'fx-scrub-thumb' : 'fx-scrub-thumb is-loading'}
          style={showImage ? {
            backgroundImage: `url(${spriteUrl})`,
            backgroundPosition: `-${entry.x}px -${entry.y}px`,
            width: `${entry.w}px`,
            height: `${entry.h}px`,
          } : undefined}
        />
      )}
      <span className="fx-scrub-time">{fmt(time)}</span>
    </div>
  );
}
