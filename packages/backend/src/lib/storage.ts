/**
 * Storage service — the single owner of "where does a file go" and "how full
 * is each volume".
 *
 * Deployment tells Flux *which* directories exist (MEDIA_ROOTS, DOWNLOAD_ROOT,
 * TRANSCODE_ROOT come from the container environment because they are bind
 * mounts). Policy — how much free space to reserve, which root to prefer and
 * how to spill over — lives in ServerSettings so it is editable in the UI and
 * consistent for every subsystem (imports, download admission, diagnostics).
 *
 * Nothing else in the backend may read the reserve threshold or pick a root.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { config } from '../config.js';
import { prisma } from './db.js';
import { ApiError } from './errors.js';
import { getServerSettings } from '../modules/settings/settings.service.js';
import type { StorageOverviewDTO, StorageVolumeDTO, StoragePlacementPlanDTO, StoragePlacementStrategy } from '@flux/shared';

export const GIB = 1024 ** 3;

/** Extra headroom applied to the incoming size to cover temp files/rounding. */
const PLACEMENT_OVERHEAD_RATIO = 0.02;
const WRITE_PROBE_TTL_MS = 60_000;

/** Absolute, de-duplicated media roots in configured order. */
export const MEDIA_ROOTS: readonly string[] = [...new Set(config.MEDIA_ROOTS.map((root) => path.resolve(root)))];
export const DOWNLOAD_ROOT = path.resolve(config.DOWNLOAD_ROOT);
export const TRANSCODE_ROOT = path.resolve(config.TRANSCODE_ROOT);

export type VolumeRole = StorageVolumeDTO['role'];

export interface VolumeStats {
  path: string;
  role: VolumeRole;
  exists: boolean;
  writable: boolean;
  totalBytes: number | null;
  freeBytes: number | null;
  /** Bytes the policy keeps untouched on this volume. */
  reservedBytes: number;
  /** freeBytes − reservedBytes, floored at zero. Null when unknown. */
  availableBytes: number | null;
  /** Filesystem identity so two roots on one disk are not double-counted. */
  deviceId: string | null;
}

const writeProbeCache = new Map<string, { writable: boolean; checkedAt: number }>();

/**
 * Real write probe: create + remove a uniquely named file. `fs.access(W_OK)`
 * lies inside containers (root can "write" to a read-only bind mount as far as
 * the permission bits are concerned).
 */
export async function probeWritable(dir: string): Promise<boolean> {
  const cached = writeProbeCache.get(dir);
  if (cached && Date.now() - cached.checkedAt < WRITE_PROBE_TTL_MS) return cached.writable;
  const probe = path.join(dir, `.flux-write-probe-${process.pid}-${Date.now()}`);
  let writable = false;
  try {
    const handle = await fs.open(probe, 'wx');
    await handle.close();
    await fs.unlink(probe);
    writable = true;
  } catch {
    writable = false;
  }
  writeProbeCache.set(dir, { writable, checkedAt: Date.now() });
  return writable;
}

export function invalidateWriteProbes(): void {
  writeProbeCache.clear();
}

export async function inspectVolume(dir: string, role: VolumeRole, reservedBytes: number): Promise<VolumeStats> {
  try {
    const [stats, stat] = await Promise.all([fs.statfs(dir), fs.stat(dir)]);
    const totalBytes = Number(stats.blocks) * Number(stats.bsize);
    const freeBytes = Number(stats.bavail) * Number(stats.bsize);
    const writable = await probeWritable(dir);
    return {
      path: dir,
      role,
      exists: true,
      writable,
      totalBytes,
      freeBytes,
      reservedBytes,
      availableBytes: Math.max(0, freeBytes - reservedBytes),
      deviceId: String(stat.dev),
    };
  } catch {
    return {
      path: dir,
      role,
      exists: false,
      writable: false,
      totalBytes: null,
      freeBytes: null,
      reservedBytes,
      availableBytes: null,
      deviceId: null,
    };
  }
}

export interface StoragePolicy {
  reservedBytes: number;
  strategy: StoragePlacementStrategy;
  preferredMediaRoot: string | null;
}

export async function getStoragePolicy(): Promise<StoragePolicy> {
  const settings = await getServerSettings();
  const preferred = settings.preferredMediaRoot ? path.resolve(settings.preferredMediaRoot) : null;
  return {
    reservedBytes: Math.max(0, settings.minimumFreeSpaceGb) * GIB,
    strategy: settings.storagePlacementStrategy === 'PREFERRED_FIRST' ? 'PREFERRED_FIRST' : 'MOST_FREE',
    // A preferred root that is no longer configured is ignored, not fatal.
    preferredMediaRoot: preferred && MEDIA_ROOTS.includes(preferred) ? preferred : null,
  };
}

/** Which configured media root contains `filePath`, if any. */
export function containingMediaRoot(filePath: string): string | null {
  const resolved = path.resolve(filePath);
  for (const root of MEDIA_ROOTS) {
    const rel = path.relative(root, resolved);
    if (rel === '' || rel === '.' || (!rel.startsWith('..') && !path.isAbsolute(rel))) return root;
  }
  return null;
}

async function mediaCountsByRoot(): Promise<Map<string, { movies: number; episodes: number }>> {
  const counts = new Map<string, { movies: number; episodes: number }>();
  for (const root of MEDIA_ROOTS) counts.set(root, { movies: 0, episodes: 0 });
  const [movies, episodes] = await Promise.all([
    prisma.mediaItem.findMany({ where: { filePath: { not: null } }, select: { filePath: true } }),
    prisma.episode.findMany({ where: { filePath: { not: null } }, select: { filePath: true } }),
  ]);
  for (const row of movies) {
    const root = row.filePath ? containingMediaRoot(row.filePath) : null;
    if (root) counts.get(root)!.movies += 1;
  }
  for (const row of episodes) {
    const root = row.filePath ? containingMediaRoot(row.filePath) : null;
    if (root) counts.get(root)!.episodes += 1;
  }
  return counts;
}

/** Every volume Flux writes to, with capacity, reserve, health and content counts. */
export async function listStorageVolumes(): Promise<StorageVolumeDTO[]> {
  const policy = await getStoragePolicy();
  const [mediaStats, downloadStats, transcodeStats, counts] = await Promise.all([
    Promise.all(MEDIA_ROOTS.map((root) => inspectVolume(root, 'media', policy.reservedBytes))),
    inspectVolume(DOWNLOAD_ROOT, 'download', policy.reservedBytes),
    inspectVolume(TRANSCODE_ROOT, 'transcode', 0),
    mediaCountsByRoot(),
  ]);

  const toDto = (stats: VolumeStats, extra: Partial<StorageVolumeDTO> = {}): StorageVolumeDTO => {
    const percentUsed = stats.totalBytes && stats.freeBytes !== null && stats.totalBytes > 0
      ? (stats.totalBytes - stats.freeBytes) / stats.totalBytes
      : null;
    const health: StorageVolumeDTO['health'] = !stats.exists
      ? 'OFFLINE'
      : !stats.writable
        ? 'READ_ONLY'
        : stats.availableBytes !== null && stats.availableBytes <= 0
          ? 'FULL'
          : percentUsed !== null && percentUsed >= 0.9
            ? 'WARNING'
            : 'HEALTHY';
    return {
      path: stats.path,
      role: stats.role,
      exists: stats.exists,
      writable: stats.writable,
      totalBytes: stats.totalBytes,
      freeBytes: stats.freeBytes,
      reservedBytes: stats.reservedBytes,
      availableBytes: stats.availableBytes,
      percentUsed,
      health,
      isPreferred: false,
      movieCount: null,
      episodeCount: null,
      deviceId: stats.deviceId,
      ...extra,
    };
  };

  return [
    ...mediaStats.map((stats) => toDto(stats, {
      isPreferred: policy.preferredMediaRoot === stats.path,
      movieCount: counts.get(stats.path)?.movies ?? 0,
      episodeCount: counts.get(stats.path)?.episodes ?? 0,
    })),
    toDto(downloadStats),
    toDto(transcodeStats),
  ];
}

export interface PlacementCandidate {
  root: string;
  eligible: boolean;
  reason: string;
  freeBytes: number | null;
  availableBytes: number | null;
}

export interface PlacementOptions {
  /** Bytes the incoming content needs on the target volume. */
  requiredBytes: number;
  /**
   * Root that already holds related content (e.g. the show's other seasons).
   * Chosen when eligible so a series is not scattered across drives.
   */
  affinityRoot?: string | null;
}

export interface PlacementResult {
  root: string;
  requiredBytes: number;
  candidates: PlacementCandidate[];
  policy: StoragePolicy;
}

export class StorageFullError extends ApiError {
  constructor(message: string, public readonly candidates: PlacementCandidate[]) {
    super(507, 'STORAGE_INSUFFICIENT', message);
  }
}

function formatGb(bytes: number): string {
  return `${(bytes / GIB).toFixed(bytes >= 10 * GIB ? 0 : 1)} GB`;
}

/**
 * Pure placement decision. Evaluates each volume against the policy and the
 * size of the incoming content and picks one, or returns `null` with a
 * per-volume explanation. Kept free of I/O so it is unit-testable.
 */
export function evaluatePlacement(
  volumes: readonly VolumeStats[],
  policy: StoragePolicy,
  options: PlacementOptions,
): { root: string | null; requiredBytes: number; candidates: PlacementCandidate[] } {
  const needed = Math.ceil(Math.max(0, options.requiredBytes) * (1 + PLACEMENT_OVERHEAD_RATIO));

  const candidates: PlacementCandidate[] = volumes.map((volume) => {
    if (!volume.exists) return { root: volume.path, eligible: false, reason: 'Volume is not mounted or not accessible', freeBytes: null, availableBytes: null };
    if (!volume.writable) return { root: volume.path, eligible: false, reason: 'Volume is read-only for the Flux process', freeBytes: volume.freeBytes, availableBytes: volume.availableBytes };
    const available = volume.availableBytes ?? 0;
    if (available < needed) {
      return {
        root: volume.path,
        eligible: false,
        reason: `Needs ${formatGb(needed)} but only ${formatGb(available)} is available after keeping ${formatGb(policy.reservedBytes)} reserved (${formatGb(volume.freeBytes ?? 0)} free)`,
        freeBytes: volume.freeBytes,
        availableBytes: volume.availableBytes,
      };
    }
    return { root: volume.path, eligible: true, reason: `${formatGb(available)} available after reserve`, freeBytes: volume.freeBytes, availableBytes: volume.availableBytes };
  });

  const eligible = candidates.filter((candidate) => candidate.eligible);
  if (eligible.length === 0) return { root: null, requiredBytes: needed, candidates };

  const byAvailable = [...eligible].sort((a, b) => (b.availableBytes ?? 0) - (a.availableBytes ?? 0));
  const affinity = options.affinityRoot ? path.resolve(options.affinityRoot) : null;
  const pick =
    (affinity && eligible.find((candidate) => candidate.root === affinity)) ||
    (policy.strategy === 'PREFERRED_FIRST' && policy.preferredMediaRoot
      ? eligible.find((candidate) => candidate.root === policy.preferredMediaRoot)
      : undefined) ||
    byAvailable[0]!;

  return { root: pick.root, requiredBytes: needed, candidates };
}

/**
 * Evaluate every media root and pick one. Throws `StorageFullError` with a
 * per-root explanation when nothing qualifies — callers surface that message
 * verbatim so admins learn *why* an import failed instead of finding a
 * half-written file on a full disk.
 */
export async function planMediaPlacement(options: PlacementOptions): Promise<PlacementResult> {
  const policy = await getStoragePolicy();
  const stats = await Promise.all(MEDIA_ROOTS.map((root) => inspectVolume(root, 'media', policy.reservedBytes)));
  const decision = evaluatePlacement(stats, policy, options);
  if (!decision.root) {
    const detail = decision.candidates.map((candidate) => `${candidate.root}: ${candidate.reason}`).join('; ');
    throw new StorageFullError(
      `No media volume has enough space for ${formatGb(decision.requiredBytes)}. ${detail}`,
      decision.candidates,
    );
  }
  return { root: decision.root, requiredBytes: decision.requiredBytes, candidates: decision.candidates, policy };
}

/** Dry-run used by the admin storage page ("where would a 12 GB file go?"). */
export async function describePlacement(requiredBytes: number): Promise<StoragePlacementPlanDTO> {
  try {
    const plan = await planMediaPlacement({ requiredBytes });
    return {
      requiredBytes: plan.requiredBytes,
      selectedRoot: plan.root,
      strategy: plan.policy.strategy,
      reservedBytes: plan.policy.reservedBytes,
      candidates: plan.candidates,
    };
  } catch (error) {
    if (error instanceof StorageFullError) {
      const policy = await getStoragePolicy();
      return {
        requiredBytes,
        selectedRoot: null,
        strategy: policy.strategy,
        reservedBytes: policy.reservedBytes,
        candidates: error.candidates,
        error: error.message,
      };
    }
    throw error;
  }
}

/** Everything the admin storage page needs in one call. */
export async function getStorageOverview(): Promise<StorageOverviewDTO> {
  const [policy, volumes, samplePlacement] = await Promise.all([
    getStoragePolicy(),
    listStorageVolumes(),
    describePlacement(10 * GIB),
  ]);
  return {
    generatedAt: new Date().toISOString(),
    policy: {
      reservedFreeSpaceGb: policy.reservedBytes / GIB,
      placementStrategy: policy.strategy,
      preferredMediaRoot: policy.preferredMediaRoot,
    },
    volumes,
    samplePlacement,
  };
}

/**
 * Admission check for a new download: the download root must keep the
 * reserve after the payload lands. Returns a human-readable failure or null.
 */
export async function checkDownloadAdmission(requiredBytes: number): Promise<string | null> {
  const policy = await getStoragePolicy();
  const volume = await inspectVolume(DOWNLOAD_ROOT, 'download', policy.reservedBytes);
  if (!volume.exists) {
    // Deployments may create the download mount lazily; the download client
    // stays authoritative when we cannot see the filesystem.
    return null;
  }
  const needed = Math.ceil(requiredBytes * (1 + PLACEMENT_OVERHEAD_RATIO));
  if ((volume.availableBytes ?? 0) < needed) {
    return `Download storage (${DOWNLOAD_ROOT}) has ${formatGb(volume.freeBytes ?? 0)} free but this download needs ${formatGb(needed)} while keeping ${formatGb(policy.reservedBytes)} reserved.`;
  }
  return null;
}
