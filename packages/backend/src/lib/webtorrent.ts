import WebTorrent from 'webtorrent';
import parseTorrent from 'parse-torrent';
import { config } from '../config.js';
import { torrentDownloadDir, torrentFilePath } from './media-paths.js';
import { writeFile, mkdir, readdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

/** WebRTC STUN servers for NAT traversal — no DHT, no external trackers. */
const CLIENT_OPTS = {
  tracker: {
    rtcConfig: {
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
      ],
    },
  },
};

/** Stats snapshot returned by {@link getLiveStats}. */
export interface TorrentLiveStats {
  progress: number;
  downloadSpeed: number;
  uploadSpeed: number;
  downloaded: number;
  uploaded: number;
  numPeers: number;
  length: number;
  ratio: number;
  timeRemaining: number;
  done: boolean;
  paused: boolean;
}

// ---------------------------------------------------------------------------
// Lazy singleton
// ---------------------------------------------------------------------------

let _client: WebTorrent | null = null;

/**
 * Return the shared WebTorrent client, creating it on first call.
 *
 * Any `'error'` events emitted by the client are logged so they never surface
 * as unhandled rejections.
 */
export function getClient(): WebTorrent {
  if (!_client) {
    _client = new WebTorrent(CLIENT_OPTS);
    _client.on('error', (err: Error | string) => {
      console.error('[WebTorrent] client error:', err);
    });
    // Log peer connections for debugging
    _client.on('torrent', (t) => {
      console.log(`[WebTorrent] Torrent added: ${t.name} (${t.infoHash})`);
    });
  }
  return _client;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Add a torrent to the client by its raw `.torrent` bytes.
 *
 * Does **not** persist the `.torrent` file to disk — callers that need
 * seed-resume persistence should use {@link addTorrent} instead.
 */
async function _addToClient(
  buffer: Buffer,
): Promise<{ infoHash: string; name: string }> {
  const parsed = await parseTorrent(buffer);
  const infoHash = parsed.infoHash;
  const downloadPath = torrentDownloadDir(infoHash);

  return new Promise<{ infoHash: string; name: string }>((resolve, reject) => {
    let settled = false;

    const torrent = getClient().add(
      buffer,
      { path: downloadPath },
      (t) => {
        if (!settled) {
          settled = true;
          resolve({ infoHash: t.infoHash, name: t.name });
        }
      },
    );

    torrent.on('error', (err: Error | string) => {
      if (!settled) {
        settled = true;
        reject(err instanceof Error ? err : new Error(String(err)));
      }
    });
  });
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Add a torrent and persist its raw `.torrent` bytes so it can be resumed on
 * the next boot via {@link resumeTorrents}.
 *
 * @returns The torrent's `infoHash` and `name` once metadata is ready.
 */
export async function addTorrent(
  buffer: Buffer,
): Promise<{ infoHash: string; name: string }> {
  const parsed = await parseTorrent(buffer);
  const infoHash = parsed.infoHash;

  // Persist .torrent bytes for seed-resume on boot
  const filePath = torrentFilePath(infoHash);
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, buffer);

  return _addToClient(buffer);
}

/**
 * Return a live snapshot of a torrent's stats, or `null` if no torrent with
 * the given `infoHash` is currently tracked by the client.
 */
export function getLiveStats(infoHash: string): TorrentLiveStats | null {
  const torrent = getClient().get(infoHash);
  if (!torrent || torrent instanceof Promise) return null;

  return {
    progress: torrent.progress,
    downloadSpeed: torrent.downloadSpeed,
    uploadSpeed: torrent.uploadSpeed,
    downloaded: torrent.downloaded,
    uploaded: torrent.uploaded,
    numPeers: torrent.numPeers,
    length: torrent.length,
    ratio: torrent.ratio,
    timeRemaining: torrent.timeRemaining,
    done: torrent.done,
    paused: torrent.paused,
  };
}

/**
 * Stop seeding a torrent (keep downloaded files on disk).
 *
 * @returns `true` if the torrent was found and destroyed, `false` if no
 *   matching torrent was tracked.
 */
export function stopSeeding(infoHash: string): Promise<boolean> {
  const torrent = getClient().get(infoHash);
  if (!torrent || torrent instanceof Promise) return Promise.resolve(false);

  return new Promise<boolean>((resolve) => {
    torrent.destroy({ destroyStore: false }, () => {
      resolve(true);
    });
  });
}

/**
 * Remove a torrent from the client.
 *
 * @param infoHash    The torrent to remove.
 * @param deleteFiles When `true`, downloaded files are deleted from disk.
 * @returns `true` if the torrent was found and removed, `false` if no
 *   matching torrent was tracked.
 */
export function removeTorrent(
  infoHash: string,
  deleteFiles: boolean,
): Promise<boolean> {
  const torrent = getClient().get(infoHash);
  if (!torrent || torrent instanceof Promise) return Promise.resolve(false);

  return new Promise<boolean>((resolve, reject) => {
    getClient().remove(infoHash, { destroyStore: deleteFiles }, (err) => {
      if (err) {
        reject(err);
      } else {
        resolve(true);
      }
    });
  });
}

/**
 * Resume all previously persisted torrents on boot.
 *
 * Reads every `.torrent` file from the `.torrents` directory under
 * `DOWNLOAD_ROOT` and re-adds them to the client. Errors from individual
 * torrents are caught and logged so one bad file does not crash the loop.
 *
 * @returns The number of torrents successfully resumed.
 */
export async function resumeTorrents(): Promise<number> {
  const torrentsDir = join(config.DOWNLOAD_ROOT, '.torrents');

  let entries: string[];
  try {
    entries = await readdir(torrentsDir);
  } catch {
    // Directory doesn't exist yet — nothing to resume
    return 0;
  }

  const torrentFiles = entries.filter((f) => f.endsWith('.torrent'));
  let resumed = 0;

  for (const file of torrentFiles) {
    try {
      const buffer = await readFile(join(torrentsDir, file));
      await _addToClient(buffer);
      resumed++;
    } catch (err) {
      console.error(`[WebTorrent] Failed to resume torrent ${file}:`, err);
    }
  }

  return resumed;
}
