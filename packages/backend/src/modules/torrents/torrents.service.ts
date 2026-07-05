/**
 * Torrents service — handles .torrent parsing, confirm, live stats,
 * seeding stop, and removal. Admin-only at the route layer.
 */
import { Buffer } from 'node:buffer';
import type {
  TorrentDTO,
  TorrentFileGuess,
  TorrentParseResult,
} from '@flux/shared';
import type { MediaType } from '@flux/shared';
import type { Torrent } from '@prisma/client';
import parseTorrent from 'parse-torrent';
import { prisma } from '../../lib/db.js';
import { ApiError } from '../../lib/errors.js';
import {
  guessFromTorrentName,
  guessFileEpisode,
  isVideoFile,
} from '../../lib/filename.js';
import {
  addTorrent,
  getLiveStats,
  stopSeeding,
  removeTorrent,
  type TorrentLiveStats,
} from '../../lib/webtorrent.js';
import type { ConfirmTorrentInput } from './torrents.schema.js';
import { torrentPostprocessQueue } from '../../jobs/queues.js';

// Track torrents already enqueued for postprocessing (prevents duplicates)
const postprocessEnqueued = new Set<string>();

/**
 * Enqueue a finished download's post-process job exactly once. Gates on
 * Transmission's authoritative `done` flag (leftUntilDone === 0), NOT a
 * `progress >= 1` float compare — a finished torrent can report percentDone a
 * hair under 1.0, which would strand it in DOWNLOADING. Shared by the on-demand
 * dashboard listing and the background poller.
 */
function enqueuePostprocessIfDone(row: Torrent, live: TorrentLiveStats): void {
  if (row.status !== 'DOWNLOADING' || !live.done || postprocessEnqueued.has(row.id)) {
    return;
  }
  postprocessEnqueued.add(row.id);
  console.log(`[Torrent] Done! Triggering postprocess for ${row.name} (${row.infoHash})`);
  torrentPostprocessQueue
    .add('torrent-postprocess', {
      torrentId: row.id,
      infoHash: row.infoHash,
    })
    .catch((err) => {
      // Enqueue failed (e.g. a Redis blip). Drop the dedupe marker so the next
      // sweep can retry instead of stranding the torrent forever.
      postprocessEnqueued.delete(row.id);
      console.error('[Torrent] Failed to enqueue postprocess:', err);
    });
}

// ─── DTO mapping ─────────────────────────────────────────────────────────────

/** Map a Prisma Torrent row to the TorrentDTO wire shape. */
export function mapTorrentToDTO(row: Torrent): TorrentDTO {
  return {
    id: row.id,
    infoHash: row.infoHash,
    name: row.name,
    category: row.category as MediaType,
    matchedTmdbId: row.matchedTmdbId,
    status: row.status,
    progress: row.progress,
    downloadSpeed: row.downloadSpeed,
    uploadSpeed: row.uploadSpeed,
    peers: row.peers,
    totalBytes: Number(row.totalBytes),
    uploadedBytes: Number(row.uploadedBytes),
    ratio: row.ratio,
    seedingSince: row.seedingSince ? row.seedingSince.toISOString() : null,
    errorMessage: row.errorMessage,
    createdAt: row.createdAt.toISOString(),
  };
}

/** Overlay live Transmission stats onto a DTO. Only meaningful while active. */
async function overlayLiveStats(dto: TorrentDTO): Promise<TorrentDTO> {
  if (dto.status !== 'DOWNLOADING' && dto.status !== 'SEEDING') {
    return dto;
  }
  const live = await getLiveStats(dto.infoHash);
  if (!live) return dto;
  return {
    ...dto,
    progress: live.progress,
    downloadSpeed: live.downloadSpeed,
    uploadSpeed: live.uploadSpeed,
    peers: live.numPeers,
    totalBytes: live.length,
    uploadedBytes: live.uploaded,
    ratio: live.ratio,
  };
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Parse a .torrent file buffer and return a TorrentParseResult for the
 * admin confirm/correct step.
 */
export async function parseUpload(
  fileBuffer: Buffer,
): Promise<TorrentParseResult> {
  const parsed = await parseTorrent(fileBuffer);
  const torrentName = parsed.name ?? 'Unknown';
  const guess = guessFromTorrentName(torrentName);

  // Build file list from parsed files (or a synthetic single-file entry).
  const rawFiles = parsed.files && parsed.files.length > 0
    ? parsed.files.map((f) => ({ path: f.path, name: f.name }))
    : [{ path: torrentName, name: torrentName }];

  // Filter to video files; fall back to all files if none look like video.
  let candidates = rawFiles.filter((f) => isVideoFile(f.path));
  if (candidates.length === 0) {
    candidates = rawFiles;
  }

  const files: TorrentFileGuess[] = candidates.map((f) => {
    const ep = guessFileEpisode(f.path);
    return { path: f.path, season: ep.season, episode: ep.episode };
  });

  return {
    infoHash: parsed.infoHash,
    name: torrentName,
    guessedTitle: guess.title,
    guessedYear: guess.year,
    guessedType: guess.type,
    files,
  };
}

/**
 * Confirm a parsed torrent and create the DB row. Does NOT start the
 * download itself — the route layer calls `startDownloading` after.
 */
export async function confirmTorrent(
  data: ConfirmTorrentInput,
): Promise<TorrentDTO> {
  // Guard against duplicate infoHash.
  const existing = await prisma.torrent.findUnique({
    where: { infoHash: data.infoHash },
  });
  if (existing) {
    throw ApiError.conflict(
      `A torrent with infoHash ${data.infoHash} already exists.`,
      'DUPLICATE_TORRENT',
    );
  }

  const row = await prisma.torrent.create({
    data: {
      infoHash: data.infoHash,
      name: data.title,
      category: data.category,
      matchedTmdbId: data.tmdbId,
      status: 'PENDING_CONFIRM',
      fileMapping: data.fileMapping ?? undefined,
    },
  });

  return mapTorrentToDTO(row);
}

/** List all torrents ordered by creation date. Also triggers post-process on completion. */
export async function listTorrents(): Promise<TorrentDTO[]> {
  const rows = await prisma.torrent.findMany({
    orderBy: { createdAt: 'desc' },
  });

  const dtos = await Promise.all(
    rows.map(async (row) => {
      const dto = mapTorrentToDTO(row);
      if (row.status !== 'DOWNLOADING' && row.status !== 'SEEDING') return dto;

      const live = await getLiveStats(row.infoHash);
      if (!live) return dto;

      const overlaid: TorrentDTO = {
        ...dto,
        progress: live.progress,
        downloadSpeed: live.downloadSpeed,
        uploadSpeed: live.uploadSpeed,
        peers: live.numPeers,
        totalBytes: live.length,
        uploadedBytes: live.uploaded,
        ratio: live.ratio,
      };

      // Trigger post-processing the moment the download completes.
      enqueuePostprocessIfDone(row, live);

      return overlaid;
    }),
  );

  return dtos;
}

/**
 * Background sweep: enqueue post-processing for any torrent that has finished
 * downloading. Runs on a timer (see jobs/torrent-poller.ts) so completion is
 * detected even when no admin has the dashboard open — the dashboard listing
 * does the same check on demand via {@link listTorrents}.
 */
export async function reconcileCompletedTorrents(): Promise<void> {
  const rows = await prisma.torrent.findMany({
    where: { status: 'DOWNLOADING' },
  });
  for (const row of rows) {
    const live = await getLiveStats(row.infoHash);
    if (live) enqueuePostprocessIfDone(row, live);
  }
}

/** Get a single torrent by id. */
export async function getTorrent(id: string): Promise<TorrentDTO> {
  const row = await prisma.torrent.findUnique({ where: { id } });
  if (!row) {
    throw ApiError.notFound(`Torrent ${id} not found`);
  }
  return overlayLiveStats(mapTorrentToDTO(row));
}

/** Stop seeding (pause) a torrent. */
export async function stopTorrent(id: string): Promise<TorrentDTO> {
  const row = await prisma.torrent.findUnique({ where: { id } });
  if (!row) {
    throw ApiError.notFound(`Torrent ${id} not found`);
  }

  await stopSeeding(row.infoHash);

  const updated = await prisma.torrent.update({
    where: { id },
    data: { status: 'STOPPED', seedingSince: null },
  });

  return mapTorrentToDTO(updated);
}

/** Remove a torrent and optionally delete its files. */
export async function removeTorrentById(
  id: string,
  deleteFiles: boolean,
): Promise<void> {
  const row = await prisma.torrent.findUnique({ where: { id } });
  if (!row) {
    throw ApiError.notFound(`Torrent ${id} not found`);
  }

  await removeTorrent(row.infoHash, deleteFiles);

  await prisma.torrent.delete({ where: { id } });
}

/**
 * Kick off the actual WebTorrent download. Called after confirm.
 * Stores the .torrent buffer and updates the row to DOWNLOADING.
 */
export async function startDownloading(
  torrentId: string,
  buffer: Buffer,
): Promise<void> {
  const row = await prisma.torrent.findUnique({ where: { id: torrentId } });
  if (!row) {
    throw ApiError.notFound(`Torrent ${torrentId} not found`);
  }

  await addTorrent(buffer);

  await prisma.torrent.update({
    where: { id: torrentId },
    data: { status: 'DOWNLOADING' },
  });
}
