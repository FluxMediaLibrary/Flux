/**
 * Torrent post-processing — runs after a torrent finishes downloading.
 * Copies files into the media library and fulfills associated requests.
 */
import { prisma } from '../../lib/db.js';
import { moviePlacement, episodePlacement } from '../../lib/media-paths.js';
import { isVideoFile, fileExtension } from '../../lib/filename.js';
import { analyzeAndStoreMedia } from '../../lib/media-analyzer.js';
import { ensureTrickplay } from '../../lib/trickplay-generator.js';
import {
  type TorrentPostprocessJob,
} from '../../jobs/queues.js';
import {
  getDetail as getTmdbDetail,
  getSeasonEpisodes as getTmdbSeasonEpisodes,
} from '../tmdb/tmdb.service.js';
import { notifyRequestFulfilled } from '../notifications/notify.js';
import { copyFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import type { MediaType } from '@flux/shared';
import type { Prisma, RequestStatus } from '@prisma/client';
import type { Job } from 'bullmq';

// Transmission engine
import { getTorrentFiles } from '../../lib/webtorrent.js';

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
      console.log(`[Trickplay] Generated assets for ${path.basename(filePath)}`);
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

      const placement = await moviePlacement(
        tmdbDetail.title,
        tmdbDetail.year,
        fileExtension(largestVideo.name),
      );

      await mkdir(placement.dir, { recursive: true });
      const source = path.join(torrentData.downloadDir, largestVideo.path);
      await copyFile(source, placement.file);

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

        const placement = await episodePlacement(
          tmdbDetail.title,
          mapping.season,
          mapping.episode,
          fileExtension(matchedFile.name),
        );

        await mkdir(placement.seasonDir, { recursive: true });
        const source = path.join(torrentData.downloadDir, matchedFile.path);
        await copyFile(source, placement.file);

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

    // 10. Update Torrent → SEEDING
    await prisma.torrent.update({
      where: { id: torrentId },
      data: {
        status: 'SEEDING',
        seedingSince: new Date(),
        mediaItemId,
      },
    });

    // Trigger background media analysis (best-effort, non-blocking).
    // Runs ffprobe on each file and stores codec/stream info in the DB so
    // future playback decisions are instant instead of a fresh ffprobe spawn.
    if (torrent.category === 'MOVIE') {
      const files = torrentData.files as unknown as TorrentFile[];
      const videoFiles = files.filter((f) => isVideoFile(f.name));
      const largestVideo = videoFiles.reduce((a, b) => a.length > b.length ? a : b);
      const placement = await moviePlacement(tmdbDetail.title, tmdbDetail.year, fileExtension(largestVideo.name));
      analyzeMediaAssets(placement.file, { mediaItemId }).catch((err) => {
        console.error(`[PostProcess] Media analysis failed for movie ${mediaItemId}:`, err);
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
              console.error(`[PostProcess] Media analysis failed for episode ${ep.id}:`, err);
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
