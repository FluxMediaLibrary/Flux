/**
 * Transmission RPC client — replaces WebTorrent for private tracker support.
 *
 * Transmission is a battle-tested BitTorrent client that natively supports
 * HTTP/UDP trackers, private flags, and DHT/PEX/LPD control. We communicate
 * with it via its JSON-RPC API at http://localhost:9091/transmission/rpc.
 */
import { config } from '../config.js';
import { torrentDownloadDir, torrentFilePath } from './media-paths.js';
import { writeFile, mkdir, readdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

let _sessionId: string | null = null;

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
// Transmission RPC helpers
// ---------------------------------------------------------------------------

async function rpc(method: string, args: Record<string, unknown> = {}): Promise<unknown> {
  const auth = Buffer.from(`${config.TRANSMISSION_USER}:${config.TRANSMISSION_PASS}`).toString('base64');

  let res: Response;
  try {
    res = await fetch(config.TRANSMISSION_RPC_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Basic ${auth}`,
        ...(_sessionId ? { 'X-Transmission-Session-Id': _sessionId } : {}),
      },
      body: JSON.stringify({ method, arguments: args }),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`Transmission RPC unavailable at ${config.TRANSMISSION_RPC_URL}: ${message}`);
  }

  if (res.status === 401 || res.status === 403) {
    throw new Error(`Transmission RPC authentication failed at ${config.TRANSMISSION_RPC_URL}`);
  }

  if (res.status === 409) {
    _sessionId = res.headers.get('X-Transmission-Session-Id');
    if (!_sessionId) throw new Error('Transmission: no session ID in 409 response');

    res = await fetch(config.TRANSMISSION_RPC_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Basic ${auth}`,
        'X-Transmission-Session-Id': _sessionId,
      },
      body: JSON.stringify({ method, arguments: args }),
    });
  }

  if (!res.ok) {
    throw new Error(`Transmission RPC error: ${res.status} ${res.statusText}`);
  }

  const json = (await res.json()) as { result: string; arguments: unknown };
  if (json.result !== 'success') {
    throw new Error(`Transmission RPC failed: ${json.result}`);
  }
  return json.arguments;
}

// ---------------------------------------------------------------------------
// Torrent add / status mapping
// ---------------------------------------------------------------------------

interface TrTorrent {
  id: number;
  name: string;
  hashString: string;
  percentDone: number;
  leftUntilDone: number;
  rateDownload: number;
  rateUpload: number;
  peersConnected: number;
  totalSize: number;
  uploadedEver: number;
  uploadRatio: number;
  status: number;
  error: number;
  errorString: string;
}

function mapStats(t: TrTorrent): TorrentLiveStats {
  // `leftUntilDone === 0` is Transmission's authoritative "download complete"
  // signal (exact byte count for the wanted files). `percentDone` is a float
  // that can settle a hair below 1.0 on a finished torrent, so never gate
  // completion on `percentDone >= 1` alone.
  const done = t.leftUntilDone <= 0 || t.percentDone >= 1;
  return {
    progress: t.percentDone,
    downloadSpeed: t.rateDownload,
    uploadSpeed: t.rateUpload,
    downloaded: Math.round(t.totalSize * t.percentDone),
    uploaded: t.uploadedEver,
    numPeers: t.peersConnected,
    length: t.totalSize,
    ratio: t.uploadRatio,
    timeRemaining: t.rateDownload > 0 ? Math.round((t.totalSize * (1 - t.percentDone)) / t.rateDownload) * 1000 : 0,
    done,
    paused: t.status === 0, // TR_STATUS_STOPPED
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Placeholder — Transmission doesn't have a client singleton. */
let _initialized = false;

export function getClient(): { initialized: boolean } {
  _initialized = true;
  return { initialized: true };
}

export async function checkTorrentClient(): Promise<{
  ok: boolean;
  url: string;
  version?: string;
  peerPort?: number;
  peerPortOpen?: boolean;
  dhtEnabled?: boolean;
  pexEnabled?: boolean;
  message?: string;
}> {
  try {
    const session = (await rpc('session-get')) as {
      version?: string;
      'peer-port'?: number;
      'dht-enabled'?: boolean;
      'pex-enabled'?: boolean;
    };
    let peerPortOpen: boolean | undefined;
    try {
      const portTest = (await rpc('port-test')) as { 'port-is-open'?: boolean };
      peerPortOpen = portTest['port-is-open'];
    } catch {
      peerPortOpen = undefined;
    }
    return {
      ok: true,
      url: config.TRANSMISSION_RPC_URL,
      version: session.version,
      peerPort: session['peer-port'],
      peerPortOpen,
      dhtEnabled: session['dht-enabled'],
      pexEnabled: session['pex-enabled'],
    };
  } catch (err) {
    return {
      ok: false,
      url: config.TRANSMISSION_RPC_URL,
      message: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Add a torrent to Transmission by its raw .torrent bytes.
 * Persists the .torrent file for seed-resume on boot.
 */
export async function addTorrent(
  buffer: Buffer,
): Promise<{ infoHash: string; name: string }> {
  const b64 = buffer.toString('base64');
  const result = (await rpc('torrent-add', {
    'download-dir': config.DOWNLOAD_ROOT,
    metainfo: b64,
    paused: false,
  })) as {
    'torrent-added'?: { id: number; name: string; hashString: string };
    'torrent-duplicate'?: { id: number; name: string; hashString: string };
  };

  const added = result['torrent-added'] ?? result['torrent-duplicate'];
  if (!added) throw new Error('Transmission: torrent-add returned no torrent');

  // Explicitly start the torrent (paused: false doesn't always work), including
  // duplicate/existing torrents during admin retry.
  await rpc('torrent-start', { ids: [added.hashString] });

  // Persist .torrent bytes for seed-resume on boot
  const filePath = torrentFilePath(added.hashString);
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, buffer);

  console.log(`[Transmission] Added torrent: ${added.name} (${added.hashString})`);
  return { infoHash: added.hashString, name: added.name };
}

/** Return live stats for a torrent by its infoHash. */
export async function getLiveStats(infoHash: string): Promise<TorrentLiveStats | null> {
  const result = (await rpc('torrent-get', {
    ids: [infoHash],
    fields: ['id', 'name', 'hashString', 'percentDone', 'leftUntilDone', 'rateDownload', 'rateUpload',
      'peersConnected', 'totalSize', 'uploadedEver', 'uploadRatio', 'status', 'error', 'errorString'],
  })) as { torrents: TrTorrent[] };

  const t = result.torrents?.[0];
  if (!t) return null;
  return mapStats(t);
}

/** Stop a torrent (pause seeding). */
export async function stopSeeding(infoHash: string): Promise<boolean> {
  const result = (await rpc('torrent-get', {
    ids: [infoHash],
    fields: ['id'],
  })) as { torrents: { id: number }[] };

  if (!result.torrents?.[0]) return false;

  await rpc('torrent-stop', { ids: [infoHash] });
  return true;
}

/** Remove a torrent and optionally delete its files. */
export async function removeTorrent(
  infoHash: string,
  deleteFiles: boolean,
): Promise<boolean> {
  const result = (await rpc('torrent-get', {
    ids: [infoHash],
    fields: ['id'],
  })) as { torrents: { id: number }[] };

  if (!result.torrents?.[0]) return false;

  await rpc('torrent-remove', {
    ids: [infoHash],
    'delete-local-data': deleteFiles,
  });
  return true;
}

/** Resume all previously persisted torrents on boot. */
export async function resumeTorrents(): Promise<number> {
  const torrentsDir = join(config.DOWNLOAD_ROOT, '.torrents');

  let entries: string[];
  try {
    entries = await readdir(torrentsDir);
  } catch {
    return 0;
  }

  const torrentFiles = entries.filter((f) => f.endsWith('.torrent'));
  let resumed = 0;

  for (const file of torrentFiles) {
    try {
      const buffer = await readFile(join(torrentsDir, file));
      const b64 = buffer.toString('base64');
      const result = (await rpc('torrent-add', {
        'download-dir': config.DOWNLOAD_ROOT,
        metainfo: b64,
        paused: false,
      })) as { 'torrent-added'?: { hashString: string } };
      if (result['torrent-added']) {
        await rpc('torrent-start', { ids: [result['torrent-added'].hashString] });
      }
      resumed++;
    } catch (err) {
      console.error(`[Transmission] Failed to resume torrent ${file}:`, err);
    }
  }

  return resumed;
}

/** Get torrent file list + download path from Transmission for post-processing. */
export async function getTorrentFiles(
  infoHash: string,
): Promise<{ downloadDir: string; files: { name: string; path: string; length: number }[] } | null> {
  const result = (await rpc('torrent-get', {
    ids: [infoHash],
    fields: ['id', 'name', 'hashString', 'downloadDir', 'files', 'percentDone', 'leftUntilDone'],
  })) as { torrents: { downloadDir: string; percentDone: number; leftUntilDone: number; files: { name: string; length: number }[] }[] };

  const t = result.torrents?.[0];
  // Complete when no bytes remain (authoritative) or percentDone rounded to 1.
  if (!t || (t.leftUntilDone > 0 && t.percentDone < 1)) return null;

  return {
    downloadDir: t.downloadDir,
    files: t.files.map((f) => ({
      name: f.name,
      path: f.name,
      length: f.length,
    })),
  };
}

// Mark as initialized so existing code paths that call getClient() don't break
getClient();
