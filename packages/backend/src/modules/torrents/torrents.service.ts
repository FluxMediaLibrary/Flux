/**
 * Torrents service — handles .torrent parsing, confirm, live stats,
 * seeding stop, and removal. Admin-only at the route layer.
 */
import { Buffer } from 'node:buffer';
import { readFile } from 'node:fs/promises';
import type {
  TorrentDTO,
  TorrentFileGuess,
  TorrentParseResult,
} from '@flux/shared';
import type { MediaType } from '@flux/shared';
import type { Request, Torrent } from '@prisma/client';
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
  checkTorrentClient,
  getLiveStats,
  stopSeeding,
  removeTorrent,
  type TorrentLiveStats,
} from '../../lib/webtorrent.js';
import type { ConfirmTorrentInput } from './torrents.schema.js';
import { torrentPostprocessQueue } from '../../jobs/queues.js';
import { torrentFilePath } from '../../lib/media-paths.js';
import { getSeasonEpisodes as getTmdbSeasonEpisodes } from '../tmdb/tmdb.service.js';

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
type TorrentWithRequests = Torrent & {
  requests?: (Request & {
    profile?: { id: string; name: string; user?: { email: string } | null } | null;
  })[];
};

export function mapTorrentToDTO(row: TorrentWithRequests): TorrentDTO {
  const linkedRequest = row.requests?.[0];
  return {
    id: row.id,
    infoHash: row.infoHash,
    name: row.name,
    category: row.category as MediaType,
    matchedTmdbId: row.matchedTmdbId,
    linkedRequest: linkedRequest
      ? {
          id: linkedRequest.id,
          title: linkedRequest.title,
          status: linkedRequest.status,
          requestedBy: linkedRequest.profile
            ? {
                profileId: linkedRequest.profile.id,
                profileName: linkedRequest.profile.name,
                accountEmail: linkedRequest.profile.user?.email ?? '',
              }
            : undefined,
        }
      : null,
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

export async function getTorrentClientHealth(): Promise<{
  ok: boolean;
  url: string;
  version?: string;
  message?: string;
}> {
  return checkTorrentClient();
}

async function persistLiveStats(row: Torrent, live: TorrentLiveStats): Promise<void> {
  await prisma.torrent.update({
    where: { id: row.id },
    data: {
      progress: live.progress,
      downloadSpeed: live.downloadSpeed,
      uploadSpeed: live.uploadSpeed,
      peers: live.numPeers,
      totalBytes: live.length,
      uploadedBytes: live.uploaded,
      ratio: live.ratio,
    },
  });
}

async function parseSavedTorrentFiles(infoHash: string): Promise<{ path: string; video: boolean }[]> {
  let buffer: Buffer;
  try {
    buffer = await readFile(torrentFilePath(infoHash));
  } catch {
    throw ApiError.badRequest(
      'The uploaded .torrent file is missing. Upload it again before confirming.',
      'TORRENT_FILE_MISSING',
    );
  }

  const parsed = await parseTorrent(buffer);
  const torrentName = parsed.name ?? 'Unknown';
  const rawFiles = parsed.files && parsed.files.length > 0
    ? parsed.files.map((file) => file.path)
    : [torrentName];

  return rawFiles.map((filePath) => ({
    path: filePath,
    video: isVideoFile(filePath),
  }));
}

async function validateShowFileMapping(data: ConfirmTorrentInput): Promise<void> {
  const mapping = data.fileMapping ?? [];
  if (mapping.length === 0) {
    throw ApiError.badRequest('TV torrents require mapped episode files', 'SHOW_MAPPING_MISSING');
  }

  const duplicateEpisode = mapping.find((entry, index) =>
    mapping.findIndex((other) => other.season === entry.season && other.episode === entry.episode) !== index,
  );
  if (duplicateEpisode) {
    throw ApiError.badRequest(
      `Multiple files are mapped to S${duplicateEpisode.season} E${duplicateEpisode.episode}`,
      'DUPLICATE_EPISODE_MAPPING',
    );
  }

  const duplicatePath = mapping.find((entry, index) =>
    mapping.findIndex((other) => other.path === entry.path) !== index,
  );
  if (duplicatePath) {
    throw ApiError.badRequest(
      `The same torrent file is mapped more than once: ${duplicatePath.path}`,
      'DUPLICATE_FILE_MAPPING',
    );
  }

  const torrentFiles = await parseSavedTorrentFiles(data.infoHash);
  const byPath = new Map(torrentFiles.map((file) => [file.path, file]));
  const missing = mapping.find((entry) => !byPath.has(entry.path));
  if (missing) {
    throw ApiError.badRequest(
      `Mapped file is not present in the uploaded torrent: ${missing.path}`,
      'MAPPED_FILE_NOT_FOUND',
    );
  }

  const nonVideo = mapping.find((entry) => byPath.get(entry.path)?.video === false);
  if (nonVideo) {
    throw ApiError.badRequest(
      `Mapped file does not look like a playable video: ${nonVideo.path}`,
      'MAPPED_FILE_NOT_VIDEO',
    );
  }
}

async function validateRequestCoverage(data: ConfirmTorrentInput, request: Request): Promise<void> {
  if (request.status !== 'APPROVED') {
    throw ApiError.badRequest('Only approved requests can be linked to a torrent', 'REQUEST_NOT_APPROVED');
  }
  if (request.tmdbId !== data.tmdbId || request.mediaType !== data.category) {
    throw ApiError.badRequest('Torrent match does not match the selected request', 'REQUEST_MATCH_MISMATCH');
  }
  if (request.mediaType !== 'SHOW') return;

  const mapping = data.fileMapping ?? [];
  if (request.season && !mapping.some((entry) => entry.season === request.season)) {
    throw ApiError.badRequest(
      `Torrent mapping does not include requested season ${request.season}`,
      'REQUEST_SEASON_MISMATCH',
    );
  }
  if (
    request.season &&
    request.episode &&
    !mapping.some((entry) => entry.season === request.season && entry.episode === request.episode)
  ) {
    throw ApiError.badRequest(
      `Torrent mapping does not include requested episode S${request.season} E${request.episode}`,
      'REQUEST_EPISODE_MISMATCH',
    );
  }
  if (!request.season || request.episode) return;

  const mappedEpisodes = new Set(
    mapping
      .filter((entry) => entry.season === request.season)
      .map((entry) => entry.episode),
  );
  const seasonEpisodes = await getTmdbSeasonEpisodes(request.tmdbId, request.season);
  const expectedEpisodes = seasonEpisodes
    .map((episode) => episode.episodeNumber)
    .filter((episodeNumber) => episodeNumber > 0);

  if (expectedEpisodes.length === 0 && mappedEpisodes.size <= 1) {
    throw ApiError.badRequest(
      `Season ${request.season} requests must be fulfilled by a season pack or exact episode request.`,
      'REQUEST_SEASON_INCOMPLETE',
    );
  }

  const missingEpisodes = expectedEpisodes.filter((episodeNumber) => !mappedEpisodes.has(episodeNumber));
  if (missingEpisodes.length > 0) {
    const shown = missingEpisodes.slice(0, 8).map((episode) => `E${episode}`).join(', ');
    throw ApiError.badRequest(
      `Torrent mapping is missing ${missingEpisodes.length} episode${missingEpisodes.length === 1 ? '' : 's'} for requested season ${request.season}: ${shown}${missingEpisodes.length > 8 ? ', ...' : ''}`,
      'REQUEST_SEASON_INCOMPLETE',
    );
  }
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

  if (data.requestId) {
    const request = await prisma.request.findUnique({ where: { id: data.requestId } });
    if (!request) {
      throw ApiError.notFound(`Request ${data.requestId} not found`);
    }
    await validateRequestCoverage(data, request);
  }
  if (data.category === 'SHOW') {
    await validateShowFileMapping(data);
  }

  const row = await prisma.torrent.create({
    data: {
      infoHash: data.infoHash,
      name: data.title,
      category: data.category,
      matchedTmdbId: data.tmdbId,
      status: 'PENDING_CONFIRM',
      fileMapping: data.fileMapping ?? undefined,
      requests: data.requestId
        ? { connect: { id: data.requestId } }
        : undefined,
    },
    include: {
      requests: {
        include: {
          profile: {
            select: {
              id: true,
              name: true,
              user: { select: { email: true } },
            },
          },
        },
        take: 1,
      },
    },
  });

  if (data.requestId) {
    await prisma.request.update({
      where: { id: data.requestId },
      data: { torrentId: row.id },
    });
  }

  return mapTorrentToDTO(row);
}

/** List all torrents ordered by creation date. Also triggers post-process on completion. */
export async function listTorrents(): Promise<TorrentDTO[]> {
  const rows = await prisma.torrent.findMany({
    orderBy: { createdAt: 'desc' },
    include: {
      requests: {
        include: {
          profile: {
            select: {
              id: true,
              name: true,
              user: { select: { email: true } },
            },
          },
        },
        take: 1,
      },
    },
  });

  const dtos = await Promise.all(
    rows.map(async (row) => {
      const dto = mapTorrentToDTO(row);
      if (row.status !== 'DOWNLOADING' && row.status !== 'SEEDING') return dto;

      let live: TorrentLiveStats | null;
      try {
        live = await getLiveStats(row.infoHash);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        await prisma.torrent.update({
          where: { id: row.id },
          data: {
            status: 'ERROR',
            errorMessage: message,
          },
        });
        return {
          ...dto,
          status: 'ERROR' as const,
          errorMessage: message,
        };
      }
      if (!live) return dto;
      await persistLiveStats(row, live);

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
    try {
      const live = await getLiveStats(row.infoHash);
      if (!live) {
        await prisma.torrent.update({
          where: { id: row.id },
          data: {
            status: 'ERROR',
            errorMessage: 'Torrent is marked downloading, but Transmission no longer has it. Retry the torrent or upload it again.',
          },
        });
        continue;
      }
      await persistLiveStats(row, live);
      enqueuePostprocessIfDone(row, live);
    } catch (err) {
      await prisma.torrent.update({
        where: { id: row.id },
        data: {
          status: 'ERROR',
          errorMessage: err instanceof Error ? err.message : String(err),
        },
      });
    }
  }
}

/** Get a single torrent by id. */
export async function getTorrent(id: string): Promise<TorrentDTO> {
  const row = await prisma.torrent.findUnique({
    where: { id },
    include: {
      requests: {
        include: {
          profile: {
            select: {
              id: true,
              name: true,
              user: { select: { email: true } },
            },
          },
        },
        take: 1,
      },
    },
  });
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

export async function retryTorrentDownload(id: string): Promise<TorrentDTO> {
  const row = await prisma.torrent.findUnique({
    where: { id },
    include: {
      requests: {
        include: {
          profile: {
            select: {
              id: true,
              name: true,
              user: { select: { email: true } },
            },
          },
        },
        take: 1,
      },
    },
  });
  if (!row) {
    throw ApiError.notFound(`Torrent ${id} not found`);
  }
  if (row.status !== 'PENDING_CONFIRM' && row.status !== 'ERROR') {
    throw ApiError.badRequest('Only pending or failed torrents can be retried', 'TORRENT_NOT_RETRYABLE');
  }

  let buffer: Buffer;
  try {
    buffer = await readFile(torrentFilePath(row.infoHash));
  } catch {
    throw ApiError.badRequest(
      'The saved .torrent file is missing. Upload this torrent again.',
      'TORRENT_FILE_MISSING',
    );
  }

  try {
    const added = await addTorrent(buffer);
    if (added.infoHash.toLowerCase() !== row.infoHash.toLowerCase()) {
      throw new Error(`Transmission returned infoHash ${added.infoHash}, expected ${row.infoHash}`);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await prisma.torrent.update({
      where: { id },
      data: {
        status: 'ERROR',
        errorMessage: message,
      },
    });
    throw ApiError.badRequest(`Failed to restart torrent: ${message}`, 'TORRENT_RETRY_FAILED');
  }

  await prisma.request.updateMany({
    where: {
      torrentId: id,
      status: { in: ['APPROVED', 'DOWNLOADING'] },
    },
    data: { status: 'DOWNLOADING' },
  });

  const updated = await prisma.torrent.update({
    where: { id },
    data: {
      status: 'DOWNLOADING',
      errorMessage: null,
    },
    include: {
      requests: {
        include: {
          profile: {
            select: {
              id: true,
              name: true,
              user: { select: { email: true } },
            },
          },
        },
        take: 1,
      },
    },
  });

  return overlayLiveStats(mapTorrentToDTO(updated));
}

export async function markTorrentStartFailed(
  id: string,
  error: unknown,
): Promise<void> {
  const message = error instanceof Error ? error.message : String(error);
  await prisma.torrent.update({
    where: { id },
    data: {
      status: 'ERROR',
      errorMessage: message || 'Failed to start torrent download.',
    },
  });
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

  await prisma.request.updateMany({
    where: {
      torrentId: id,
      status: { in: ['APPROVED', 'DOWNLOADING'] },
    },
    data: {
      status: 'APPROVED',
      torrentId: null,
    },
  });

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

  const added = await addTorrent(buffer);
  if (added.infoHash.toLowerCase() !== row.infoHash.toLowerCase()) {
    throw new Error(`Transmission returned infoHash ${added.infoHash}, expected ${row.infoHash}`);
  }
  const live = await getLiveStats(row.infoHash);

  await prisma.torrent.update({
    where: { id: torrentId },
    data: {
      status: 'DOWNLOADING',
      errorMessage: null,
      progress: live?.progress ?? 0,
      downloadSpeed: live?.downloadSpeed ?? 0,
      uploadSpeed: live?.uploadSpeed ?? 0,
      peers: live?.numPeers ?? 0,
      totalBytes: live?.length ?? 0,
      uploadedBytes: live?.uploaded ?? 0,
      ratio: live?.ratio ?? 0,
    },
  });

  await prisma.request.updateMany({
    where: {
      torrentId,
      status: 'APPROVED',
    },
    data: { status: 'DOWNLOADING' },
  });
}
