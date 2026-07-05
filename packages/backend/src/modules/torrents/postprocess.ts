/**
 * Torrent post-processing — runs after a torrent finishes downloading.
 * Copies files into the media library and fulfills associated requests.
 */
import { prisma } from '../../lib/db.js';
import { moviePlacement, episodePlacement } from '../../lib/media-paths.js';
import { isVideoFile, fileExtension } from '../../lib/filename.js';
import {
  type TorrentPostprocessJob,
} from '../../jobs/queues.js';
import { getDetail as getTmdbDetail } from '../tmdb/tmdb.service.js';
import { notifyRequestFulfilled } from '../notifications/notify.js';
import { copyFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import type { MediaType } from '@flux/shared';
import type { Job } from 'bullmq';

// webtorrent engine — imported from the lib created in parallel
import { getClient } from '../../lib/webtorrent.js';

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

export async function processTorrentPostprocess(
  job: Job<TorrentPostprocessJob>,
): Promise<void> {
  const { torrentId, infoHash } = job.data;

  try {
    // 1. Load Torrent from DB
    const torrent = await prisma.torrent.findUnique({
      where: { id: torrentId },
    });

    if (!torrent || torrent.status !== 'DOWNLOADING') {
      return;
    }

    // 2. Mark as processing
    await prisma.torrent.update({
      where: { id: torrentId },
      data: { status: 'PROCESSING' },
    });

    // 3. Look up in WebTorrent engine
    const client = getClient();
    // get() may return Torrent synchronously or Promise<Torrent> for magnets;
    // await handles both cases.
    const engineTorrent = await Promise.resolve(client.get(infoHash));

    if (!engineTorrent) {
      await prisma.torrent.update({
        where: { id: torrentId },
        data: { status: 'ERROR', errorMessage: 'Torrent not found in engine' },
      });
      return;
    }

    // 4. Fetch TMDb detail
    const tmdbDetail = await getTmdbDetail(
      torrent.category as MediaType,
      torrent.matchedTmdbId!,
    );

    let mediaItemId: string;

    if (torrent.category === 'MOVIE') {
      // ── MOVIE path ──
      const files = engineTorrent.files as unknown as TorrentFile[];
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

      const placement = moviePlacement(
        tmdbDetail.title,
        tmdbDetail.year,
        fileExtension(largestVideo.name),
      );

      await mkdir(placement.dir, { recursive: true });
      const source = path.join(engineTorrent.path, largestVideo.path);
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

      const files = engineTorrent.files as unknown as TorrentFile[];

      // Process each file mapping entry
      for (const mapping of fileMapping) {
        const matchedFile = files.find((f) => f.path === mapping.path);

        if (!matchedFile) {
          job.log(`File not found in torrent engine: ${mapping.path}`);
          continue;
        }

        const placement = episodePlacement(
          tmdbDetail.title,
          mapping.season,
          mapping.episode,
          fileExtension(matchedFile.name),
        );

        await mkdir(placement.seasonDir, { recursive: true });
        const source = path.join(engineTorrent.path, matchedFile.path);
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
            filePath: placement.file,
          },
          update: {
            filePath: placement.file,
          },
        });
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

    // 11. Fulfill matching Requests
    const requests = await prisma.request.findMany({
      where: {
        tmdbId: torrent.matchedTmdbId!,
        mediaType: torrent.category,
        status: { in: ['PENDING', 'APPROVED', 'DOWNLOADING'] },
      },
    });

    if (requests.length > 0) {
      await prisma.request.updateMany({
        where: {
          tmdbId: torrent.matchedTmdbId!,
          mediaType: torrent.category,
          status: { in: ['PENDING', 'APPROVED', 'DOWNLOADING'] },
        },
        data: {
          status: 'FULFILLED',
          torrentId,
        },
      });

      // Best-effort notifications
      for (const req of requests) {
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
