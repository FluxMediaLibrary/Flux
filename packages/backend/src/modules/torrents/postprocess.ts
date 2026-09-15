/**
 * Torrent post-processing — runs after a torrent finishes downloading.
 * Copies files into the media library and fulfills associated requests.
 */
import { prisma } from '../../lib/db.js';
import { moviePlacement, episodePlacement, selectMediaRoot } from '../../lib/media-paths.js';
import { isVideoFile, fileExtension } from '../../lib/filename.js';
import { analyzeAndStoreMedia } from '../../lib/media-analyzer.js';
import { ensureTrickplay } from '../../lib/trickplay-generator.js';
import {
  enqueueIntroDetection,
  type TorrentPostprocessJob,
} from '../../jobs/queues.js';
import {
  getDetail as getTmdbDetail,
  getSeasonEpisodes as getTmdbSeasonEpisodes,
} from '../tmdb/tmdb.service.js';
import { notifyRequestFulfilled } from '../notifications/notify.js';
import { copyFile, mkdir, rename, unlink } from 'node:fs/promises';
import path from 'node:path';
import { containingMediaRoot } from '../../lib/storage.js';
import type { MediaType } from '@flux/shared';
import type { Prisma, RequestStatus } from '@prisma/client';
import type { Job } from 'bullmq';

// Transmission engine
import { getTorrentFiles, removeTorrent } from '../../lib/webtorrent.js';
import { getServerSettings } from '../settings/settings.service.js';
import { getLogger } from '../../lib/logger.js';

const log = getLogger('downloads');

interface FileMappingEntry {
  path: string;
  season: number;
  episode: number;
}

interface TorrentFile {
  name: string;
  path: string;
  length: number;
}

type ImportMode = 'COPY' | 'MOVE';

/**
 * Place `source` at `destination` without ever leaving a half-written file
 * under the final name: data lands in a `.flux-partial` sibling and is renamed
 * into place only once complete. MOVE tries a rename first (instant on the
 * same filesystem) and falls back to copy + unlink across devices.
 */
async function importFile(source: string, destination: string, mode: ImportMode): Promise<void> {
  await mkdir(path.dirname(destination), { recursive: true });
  if (mode === 'MOVE') {
    try {
      await rename(source, destination);
      return;
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code !== 'EXDEV' && code !== 'EPERM') throw err;
    }
  }
  const partial = `${destination}.flux-partial`;
  try {
    await copyFile(source, partial);
    await rename(partial, destination);
  } catch (err) {
    await unlink(partial).catch(() => undefined);
    throw err;
  }
  if (mode === 'MOVE') {
    await unlink(source).catch(() => undefined);
  }
}

/** Root that already holds this show's episodes, so seasons stay together. */
async function showAffinityRoot(tmdbId: number): Promise<string | null> {
  const existing = await prisma.episode.findFirst({
    where: { mediaItem: { tmdbId, type: 'SHOW' }, filePath: { not: null } },
    select: { filePath: true },
    orderBy: { addedAt: 'desc' },
  });
  return existing?.filePath ? containingMediaRoot(existing.filePath) : null;
}

async function analyzeMediaAssets(
  filePath: string,
  target: { mediaItemId: string } | { episodeId: string },
): Promise<void> {
  await analyzeAndStoreMedia(filePath, target);
  const mediaInfo = 'mediaItemId' in target
    ? await prisma.mediaInfo.findUnique({ where: { mediaItemId: target.mediaItemId } })
    : await prisma.mediaInfo.findUnique({ where: { episodeId: target.episodeId } });

  if (mediaInfo?.durationSec && mediaInfo.durationSec > 0) {
    const generated = await ensureTrickplay(filePath, mediaInfo.durationSec);
    if (generated) {
      log.info(`[Trickplay] Generated assets for ${path.basename(filePath)}`);
    }
  }
}

export async function processTorrentPostprocess(
  job: Job<TorrentPostprocessJob>,
): Promise<void> {
  const { torrentId, infoHash } = job.data;

  try {
    // 1. Load Torrent from DB
    const torrent = await prisma.torrent.findUnique({
      where: { id: torrentId },
    });

    if (!torrent || (torrent.status !== 'DOWNLOADING' && torrent.status !== 'PROCESSING')) {
      return;
    }

    // 2. Mark as processing
    await prisma.torrent.update({
      where: { id: torrentId },
      data: { status: 'PROCESSING' },
    });

    // 3. Look up files in Transmission
    const torrentData = await getTorrentFiles(infoHash);

    if (!torrentData) {
      await prisma.torrent.update({
        where: { id: torrentId },
        data: { status: 'ERROR', errorMessage: 'Torrent not found or not yet complete in Transmission' },
      });
      return;
    }

    // 4. Fetch TMDb detail
    const tmdbDetail = await getTmdbDetail(
      torrent.category as MediaType,
      torrent.matchedTmdbId!,
    );

    let mediaItemId: string;
    const placedEpisodeMappings: FileMappingEntry[] = [];
    let moviePlacementFile: string | null = null;
    const importMode: ImportMode = (await getServerSettings()).completedImportBehavior === 'MOVE' ? 'MOVE' : 'COPY';

    if (torrent.category === 'MOVIE') {
      // ── MOVIE path ──
      const files = torrentData.files as unknown as TorrentFile[];
      const videoFiles = files.filter((f) => isVideoFile(f.name));

      if (videoFiles.length === 0) {
        await prisma.torrent.update({
          where: { id: torrentId },
          data: { status: 'ERROR', errorMessage: 'No video file found in torrent' },
        });
        return;
      }

      // Pick the largest video file
      const largestVideo = videoFiles.reduce((a, b) =>
        a.length > b.length ? a : b,
      );

      // Root is chosen once for this import so every derived path agrees.
      const root = await selectMediaRoot({ requiredBytes: largestVideo.length });
      const placement = moviePlacement(
        root,
        tmdbDetail.title,
        tmdbDetail.year,
        fileExtension(largestVideo.name),
      );
      moviePlacementFile = placement.file;

      const source = path.join(torrentData.downloadDir, largestVideo.path);
      await importFile(source, placement.file, importMode);

      // Upsert MediaItem
      const mediaItem = await prisma.mediaItem.upsert({
        where: {
          tmdbId_type: { tmdbId: torrent.matchedTmdbId!, type: torrent.category },
        },
        create: {
          tmdbId: torrent.matchedTmdbId!,
          type: torrent.category,
          title: tmdbDetail.title,
          year: tmdbDetail.year ?? null,
          overview: tmdbDetail.overview,
          posterPath: tmdbDetail.posterPath,
          backdropPath: tmdbDetail.backdropPath,
          genres: tmdbDetail.genres,
          filePath: placement.file,
          metadata: tmdbDetail as any,
        },
        update: {
          title: tmdbDetail.title,
          overview: tmdbDetail.overview,
          posterPath: tmdbDetail.posterPath,
          backdropPath: tmdbDetail.backdropPath,
          genres: tmdbDetail.genres,
          filePath: placement.file, // ensure a re-processed movie points at its file
          metadata: tmdbDetail as any,
        },
      });

      mediaItemId = mediaItem.id;
    } else {
      // ── SHOW path ──
      const fileMapping = torrent.fileMapping as unknown as FileMappingEntry[] | null;

      if (!fileMapping || fileMapping.length === 0) {
        await prisma.torrent.update({
          where: { id: torrentId },
          data: {
            status: 'ERROR',
            errorMessage: 'TV torrent confirmed without file mapping',
          },
        });
        return;
      }

      // Upsert MediaItem (no single filePath for shows)
      const mediaItem = await prisma.mediaItem.upsert({
        where: {
          tmdbId_type: { tmdbId: torrent.matchedTmdbId!, type: torrent.category },
        },
        create: {
          tmdbId: torrent.matchedTmdbId!,
          type: torrent.category,
          title: tmdbDetail.title,
          year: tmdbDetail.year ?? null,
          overview: tmdbDetail.overview,
          posterPath: tmdbDetail.posterPath,
          backdropPath: tmdbDetail.backdropPath,
          genres: tmdbDetail.genres,
          metadata: tmdbDetail as any,
        },
        update: {
          title: tmdbDetail.title,
          overview: tmdbDetail.overview,
          posterPath: tmdbDetail.posterPath,
          backdropPath: tmdbDetail.backdropPath,
          genres: tmdbDetail.genres,
          metadata: tmdbDetail as any,
        },
      });

      mediaItemId = mediaItem.id;

      const files = torrentData.files as unknown as TorrentFile[];
      const mappedBytes = fileMapping.reduce((sum, mapping) => {
        const file = files.find((candidate) => candidate.path === mapping.path);
        return sum + (file?.length ?? 0);
      }, 0);
      const showRoot = await selectMediaRoot({
        requiredBytes: mappedBytes,
        affinityRoot: await showAffinityRoot(torrent.matchedTmdbId!),
      });
      const seasons = [...new Set(fileMapping.map((mapping) => mapping.season))];
      const episodeMetaBySeason = new Map(
        await Promise.all(
          seasons.map(async (season) => [
            season,
            await getTmdbSeasonEpisodes(torrent.matchedTmdbId!, season),
          ] as const),
        ),
      );

      // Process each file mapping entry
      for (const mapping of fileMapping) {
        if (mapping.season <= 0 || mapping.episode <= 0) {
          job.log(`Skipping invalid episode mapping: S${mapping.season} E${mapping.episode} (${mapping.path})`);
          continue;
        }

        const matchedFile = files.find((f) => f.path === mapping.path);

        if (!matchedFile) {
          job.log(`File not found in torrent engine: ${mapping.path}`);
          continue;
        }

        const episodeMeta = episodeMetaBySeason
          .get(mapping.season)
          ?.find((episode) => episode.episodeNumber === mapping.episode);

        const placement = episodePlacement(
          showRoot,
          tmdbDetail.title,
          mapping.season,
          mapping.episode,
          fileExtension(matchedFile.name),
        );

        const source = path.join(torrentData.downloadDir, matchedFile.path);
        await importFile(source, placement.file, importMode);

        // Upsert Episode
        await prisma.episode.upsert({
          where: {
            mediaItemId_season_episode: {
              mediaItemId: mediaItem.id,
              season: mapping.season,
              episode: mapping.episode,
            },
          },
          create: {
            mediaItemId: mediaItem.id,
            season: mapping.season,
            episode: mapping.episode,
            title: episodeMeta?.name ?? null,
            overview: episodeMeta?.overview ?? null,
            runtime: episodeMeta?.runtime ?? null,
            filePath: placement.file,
          },
          update: {
            title: episodeMeta?.name ?? null,
            overview: episodeMeta?.overview ?? null,
            runtime: episodeMeta?.runtime ?? null,
            filePath: placement.file,
          },
        });
        placedEpisodeMappings.push(mapping);
      }
    }

    const moveImport = importMode === 'MOVE';
    if (moveImport) {
      // Library copies are complete at this point. Removing local data affects
      // only the download client payload, never the managed library files.
      await removeTorrent(infoHash, true);
    }

    // 10. COPY imports continue seeding; MOVE imports leave the client clean.
    await prisma.torrent.update({
      where: { id: torrentId },
      data: {
        status: moveImport ? 'STOPPED' : 'SEEDING',
        seedingSince: moveImport ? null : new Date(),
        mediaItemId,
      },
    });

    // Trigger automatic intro detection per season (best-effort, non-blocking).
    // The deterministic jobId dedupes imports; manual markers are preserved by
    // the job unless a forced admin rescan runs later.
    if (torrent.category === 'SHOW' && placedEpisodeMappings.length > 0) {
      const importedSeasons = [...new Set(placedEpisodeMappings.map((mapping) => mapping.season))];
      for (const season of importedSeasons) {
        enqueueIntroDetection(mediaItemId, season).catch((err) => {
          log.error(`[PostProcess] Intro detection enqueue failed for ${mediaItemId} S${season}:`, err);
        });
      }
    }

    // Trigger background media analysis (best-effort, non-blocking).
    // Runs ffprobe on each file and stores codec/stream info in the DB so
    // future playback decisions are instant instead of a fresh ffprobe spawn.
    if (torrent.category === 'MOVIE' && moviePlacementFile) {
      analyzeMediaAssets(moviePlacementFile, { mediaItemId }).catch((err) => {
        log.error(`[PostProcess] Media analysis failed for movie ${mediaItemId}:`, err);
      });
    } else {
      // For shows: analyze each episode file we just placed
      const fileMapping = torrent.fileMapping as unknown as FileMappingEntry[] | null;
      if (fileMapping) {
        for (const mapping of fileMapping) {
          const ep = await prisma.episode.findUnique({
            where: {
              mediaItemId_season_episode: {
                mediaItemId,
                season: mapping.season,
                episode: mapping.episode,
              },
            },
          });
          if (ep?.filePath) {
            analyzeMediaAssets(ep.filePath, { episodeId: ep.id }).catch((err) => {
              log.error(`[PostProcess] Media analysis failed for episode ${ep.id}:`, err);
            });
          }
        }
      }
    }

    // 11. Fulfill matching Requests. Episode-targeted requests should only be
    // fulfilled when this torrent actually placed that season/episode.
    const fulfillableStatuses: RequestStatus[] = ['PENDING', 'APPROVED', 'DOWNLOADING'];
    const fulfilledRequestWhere: Prisma.RequestWhereInput =
      torrent.category === 'SHOW'
        ? {
            tmdbId: torrent.matchedTmdbId!,
            mediaType: torrent.category,
            status: { in: fulfillableStatuses },
            OR: [
              { season: null },
              ...placedEpisodeMappings.map((mapping) => ({
                season: mapping.season,
                OR: [{ episode: null }, { episode: mapping.episode }],
              })),
            ],
          }
        : {
            tmdbId: torrent.matchedTmdbId!,
            mediaType: torrent.category,
            status: { in: fulfillableStatuses },
          };

    const requests = torrent.category === 'SHOW' && placedEpisodeMappings.length === 0
      ? []
      : await prisma.request.findMany({ where: fulfilledRequestWhere });

    if (requests.length > 0) {
      for (const req of requests) {
        await prisma.request.update({
          where: { id: req.id },
          data: {
            status: 'FULFILLED',
            torrentId,
          },
        });

        try {
          await notifyRequestFulfilled(req.id);
        } catch (err) {
          job.log(`Notification failed for request ${req.id}: ${String(err)}`);
        }
      }
    }

  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await prisma.torrent
      .update({
        where: { id: torrentId },
        data: { status: 'ERROR', errorMessage: message },
      })
      .catch(() => {
        // DB update itself failed — nothing we can do
      });
    throw err; // Let BullMQ handle retries
  }
}
