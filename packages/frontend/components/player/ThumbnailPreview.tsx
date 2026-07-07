'use client';

import { useEffect, useRef, useState } from 'react';
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
  /** The time position in seconds the user is hovering over */
  time: number;
  /** Left offset in pixels from the timeline edge */
  left: number;
  /** Whether to show the preview */
  visible: boolean;
}

function parseTrickplayVtt(vttText: string): VttEntry[] {
  const entries: VttEntry[] = [];
  const lines = vttText.split('\n');
  let currentStart = 0;
  let currentEnd = 0;

  for (const line of lines) {
    const timeMatch = line.match(
      /^(\d{2}):(\d{2}):(\d{2})\.(\d{3})\s*-->\s*(\d{2}):(\d{2}):(\d{2})\.(\d{3})/,
    );
    if (timeMatch) {
      currentStart =
        parseInt(timeMatch[1]) * 3600 +
        parseInt(timeMatch[2]) * 60 +
        parseInt(timeMatch[3]) +
        parseInt(timeMatch[4]) / 1000;
      currentEnd =
        parseInt(timeMatch[5]) * 3600 +
        parseInt(timeMatch[6]) * 60 +
        parseInt(timeMatch[7]) +
        parseInt(timeMatch[8]) / 1000;
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
  time,
  left,
  visible,
}: ThumbnailPreviewProps) {
  const [entries, setEntries] = useState<VttEntry[]>([]);
  const lastMediaRef = useRef('');

  // Fetch VTT metadata when media changes
  useEffect(() => {
    const key = `${mediaItemId}::${episodeId ?? ''}`;
    if (key === lastMediaRef.current) return;
    lastMediaRef.current = key;

    const vttUrl = api.getTrickplayUrl(mediaItemId, 'trickplay.vtt', episodeId);
    if (!vttUrl) return;

    fetch(vttUrl)
      .then((r) => {
        if (!r.ok) throw new Error('VTT not found');
        return r.text();
      })
      .then((text) => {
        setEntries(parseTrickplayVtt(text));
      })
      .catch(() => {
        setEntries([]); // trickplay not available for this media
      });
  }, [mediaItemId, episodeId]);

  if (!visible || entries.length === 0) return null;

  // Find the matching entry for the current time
  const entry = entries.find((e) => time >= e.start && time < e.end);
  if (!entry) return null;

  const spriteUrl = api.getTrickplayUrl(
    mediaItemId,
    'trickplay-sprite.jpg',
    episodeId,
  );

  return (
    <div className="fx-scrub-preview" style={{ left: `${left}px` }}>
      <div
        className="fx-scrub-thumb"
        style={{
          backgroundImage: `url(${spriteUrl})`,
          backgroundPosition: `-${entry.x}px -${entry.y}px`,
          width: `${entry.w}px`,
          height: `${entry.h}px`,
        }}
      />
      <span className="fx-scrub-time">{fmt(time)}</span>
    </div>
  );
}
