/**
 * Transmission RPC client — replaces WebTorrent for private tracker support.
 *
 * Transmission is a battle-tested BitTorrent client that natively supports
 * HTTP/UDP trackers, private flags, and DHT/PEX/LPD control. We communicate
 * with it via its JSON-RPC API at http://localhost:9091/transmission/rpc.
 */
import { config } from '../config.js';
import { torrentDownloadDir, torrentFilePath, safeJoin } from './media-paths.js';
import { writeFile, mkdir, readdir, readFile, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import parseTorrent from 'parse-torrent';
import { getActiveTransmissionConfig } from '../modules/settings/settings.service.js';

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
  const transmission = await getActiveTransmissionConfig();
  const auth = Buffer.from(`${transmission.username}:${transmission.password}`).toString('base64');

  let res: Response;
  try {
    res = await fetch(transmission.url, {
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
    throw new Error(`Transmission RPC unavailable: ${message}`);
  }

  if (res.status === 401 || res.status === 403) {
    throw new Error('Transmission RPC authentication failed');
  }

  if (res.status === 409) {
    _sessionId = res.headers.get('X-Transmission-Session-Id');
    if (!_sessionId) throw new Error('Transmission: no session ID in 409 response');

    res = await fetch(transmission.url, {
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
  const done = t.leftUntilDone <= 0;
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
  const transmission = await getActiveTransmissionConfig();
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
      url: transmission.url,
      version: session.version,
      peerPort: session['peer-port'],
      peerPortOpen,
      dhtEnabled: session['dht-enabled'],
      pexEnabled: session['pex-enabled'],
    };
  } catch (err) {
    return {
      ok: false,
      url: transmission.url,
      message: err instanceof Error ? err.message : String(err),
    };
  }
}

export interface AddTorrentResult {
  infoHash: string;
  name: string;
  /** True when Transmission already had this torrent (duplicate add). */
  reused: boolean;
}

/**
 * Add a torrent to Transmission by its raw .torrent bytes.
 * Persists the .torrent file for seed-resume on boot.
 *
 * When `verifyExisting` is set and the torrent is newly added, Transmission is
 * asked to hash-check the local data before starting: files already on disk are
 * reused (complete torrents go straight to seeding, partial ones only download
 * missing pieces). Duplicate adds are simply started — the existing entry is
 * already in the right state.
 */
export async function addTorrent(
  buffer: Buffer,
  opts: { verifyExisting?: boolean } = {},
): Promise<AddTorrentResult> {
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
  if (opts.verifyExisting) {
    // Hash-check local data first so stale duplicate state cannot keep
    // claiming "complete" after the files were deleted from disk.
    await rpc('torrent-verify', { ids: [added.hashString] });
  }
  await rpc('torrent-start', { ids: [added.hashString] });

  // Persist .torrent bytes for seed-resume on boot
  const filePath = torrentFilePath(added.hashString);
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, buffer);

  console.log(
    `[Transmission] ${result['torrent-duplicate'] ? 'Reused' : 'Added'} torrent: ${added.name} (${added.hashString})`,
  );
  return {
    infoHash: added.hashString,
    name: added.name,
    reused: Boolean(result['torrent-duplicate']),
  };
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

/**
 * Ask Transmission to hash-check a torrent's local data. Torrents that already
 * have their data on disk move straight to seeding once the check completes;
 * torrents with partial data only download the pieces that are missing.
 */
export async function verifyTorrent(infoHash: string): Promise<void> {
  await rpc('torrent-verify', { ids: [infoHash] });
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

// ---------------------------------------------------------------------------
// Existing-data detection
// ---------------------------------------------------------------------------

export interface ExistingDataCheck {
  /** Files found on disk whose size matches the torrent's expectation. */
  filesOnDisk: number;
  /** Total files this torrent expects. */
  totalFiles: number;
  /** Bytes already present in files whose size matches the torrent metadata. */
  bytesOnDisk: number;
  /** Total bytes this torrent expects. */
  totalBytes: number;
  /** Bytes still missing from the download root. */
  missingBytes: number;
  /** True when every expected file is already present with the right size. */
  complete: boolean;
}

/**
 * Detect whether a torrent's data is already present in the download root.
 *
 * Transmission's layout is deterministic: multi-file torrents live in a
 * subfolder named after the torrent, single-file torrents drop the file
 * directly into the download dir. Size is compared per file (a cheap, reliable
 * signal without hashing); Transmission's own `torrent-verify` does the real
 * piece hash-check afterwards.
 *
 * Paths are asserted inside the download root, so a malicious torrent can't
 * probe arbitrary filesystem locations.
 */
export async function detectExistingData(
  buffer: Buffer,
  downloadRoot: string = config.DOWNLOAD_ROOT,
): Promise<ExistingDataCheck> {
  const parsed = await parseTorrent(buffer);
  // parse-torrent always flattens `files`. For multi-file torrents each
  // `path` includes the torrent-name prefix (`Name/Season/File.mkv`), matching
  // Transmission's subfolder layout; single-file torrents are just the
  // filename, which Transmission drops directly into the download root.
  const rawFiles = parsed.files ?? [];

  let filesOnDisk = 0;
  let bytesOnDisk = 0;
  let totalBytes = 0;
  for (const file of rawFiles) {
    totalBytes += file.length;
    let expected: string;
    try {
      expected = safeJoin(downloadRoot, file.path);
    } catch {
      continue; // path escapes the download root — treat as missing
    }
    try {
      const entry = await stat(expected);
      if (entry.isFile() && entry.size === file.length) {
        filesOnDisk++;
        bytesOnDisk += file.length;
      }
    } catch {
      // file not present yet
    }
  }

  return {
    filesOnDisk,
    totalFiles: rawFiles.length,
    bytesOnDisk,
    totalBytes,
    missingBytes: Math.max(0, totalBytes - bytesOnDisk),
    complete: rawFiles.length > 0 && filesOnDisk === rawFiles.length,
  };
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
  // Complete only when Transmission reports no bytes left for wanted files.
  if (!t || t.leftUntilDone > 0) return null;

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
