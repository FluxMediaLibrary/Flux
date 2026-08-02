import { constants } from 'node:fs';
import fs from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import path from 'node:path';
import type {
  StorageDriveCandidateDTO,
  StorageLibraryRootDTO,
  StorageSettingsDTO,
} from '@flux/shared';
import { prisma } from '../../lib/db.js';
import { ApiError } from '../../lib/errors.js';
import { parseLinuxMountInfo, type DiscoveredMount } from '../../lib/mount-info.js';
import {
  environmentMediaRoots,
  getLibraryRootState,
  invalidateLibraryRootState,
} from '../../lib/library-roots.js';
import { getServerSettings } from './settings.service.js';

const PSEUDO_FILESYSTEMS = new Set([
  'autofs', 'bpf', 'cgroup', 'cgroup2', 'configfs', 'debugfs', 'devpts',
  'devtmpfs', 'efivarfs', 'fusectl', 'hugetlbfs', 'mqueue', 'overlay',
  'proc', 'pstore', 'securityfs', 'sysfs', 'tmpfs', 'tracefs',
]);

function isStorageMount(mount: DiscoveredMount): boolean {
  if (PSEUDO_FILESYSTEMS.has(mount.filesystem)) return false;
  if (mount.mountPath === '/') return false;
  const normalized = mount.mountPath.replace(/\\/g, '/');
  return ['/data', '/storage', '/mnt', '/media', '/srv'].some(
    (prefix) => normalized === prefix || normalized.startsWith(`${prefix}/`),
  );
}

async function discoverMounts(): Promise<DiscoveredMount[]> {
  if (process.platform === 'linux') {
    const input = await fs.readFile('/proc/self/mountinfo', 'utf8').catch(() => '');
    return parseLinuxMountInfo(input);
  }
  if (process.platform === 'win32') {
    const drives = await Promise.all(Array.from({ length: 26 }, async (_, index) => {
      const drive = `${String.fromCharCode(65 + index)}:\\`;
      try {
        await fs.stat(drive);
        return { mountPath: drive, filesystem: 'windows', source: drive, writableByMount: true };
      } catch {
        return null;
      }
    }));
    return drives.filter((drive): drive is DiscoveredMount => drive !== null);
  }
  return [];
}

function mountForPath(root: string, mounts: readonly DiscoveredMount[]): DiscoveredMount | null {
  const resolved = path.resolve(root);
  return mounts
    .filter((mount) => {
      const relative = path.relative(path.resolve(mount.mountPath), resolved);
      return relative === '' || relative === '.' || (!relative.startsWith('..') && !path.isAbsolute(relative));
    })
    .sort((a, b) => b.mountPath.length - a.mountPath.length)[0] ?? null;
}

function driveId(mountPath: string): string {
  return createHash('sha256').update(path.resolve(mountPath)).digest('hex').slice(0, 24);
}

function driveLabel(mountPath: string, source: string): string {
  if (process.platform === 'win32') return mountPath.replace(/[\\/]+$/, '');
  const base = path.basename(mountPath);
  if (base) return base.replace(/[-_]+/g, ' ');
  return path.basename(source) || 'Storage volume';
}

async function capacity(target: string): Promise<{ totalBytes: number | null; freeBytes: number | null }> {
  try {
    const stats = await fs.statfs(target);
    return { totalBytes: stats.blocks * stats.bsize, freeBytes: stats.bavail * stats.bsize };
  } catch {
    return { totalBytes: null, freeBytes: null };
  }
}

async function canWrite(target: string, mountWritable: boolean): Promise<boolean> {
  if (!mountWritable) return false;
  try {
    await fs.access(target, constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

export async function discoverStorageDrives(): Promise<StorageDriveCandidateDTO[]> {
  const [mounts, state] = await Promise.all([discoverMounts(), getLibraryRootState()]);
  const configuredRoots = environmentMediaRoots();
  const visible = mounts.filter((mount) => isStorageMount(mount));

  for (const root of state.roots) {
    if (!visible.some((mount) => path.resolve(mount.mountPath) === path.resolve(root))) {
      visible.push({ mountPath: root, filesystem: 'configured', source: root, writableByMount: true });
    }
  }

  const candidates = await Promise.all(visible.map(async (mount) => {
    const resolvedMount = path.resolve(mount.mountPath);
    const exactLibraryRoot = state.roots.find((root) => path.resolve(root) === resolvedMount);
    const suggestedRoot = exactLibraryRoot ?? path.join(resolvedMount, 'flux-media');
    const [{ totalBytes, freeBytes }, writable] = await Promise.all([
      capacity(resolvedMount),
      canWrite(resolvedMount, mount.writableByMount),
    ]);
    return {
      id: driveId(resolvedMount),
      mountPath: resolvedMount,
      suggestedRoot,
      label: driveLabel(resolvedMount, mount.source),
      filesystem: mount.filesystem,
      source: mount.source,
      writable,
      alreadyAdded: state.roots.some((root) => path.resolve(root) === path.resolve(suggestedRoot)),
      primary: path.resolve(state.primaryRoot) === path.resolve(suggestedRoot),
      totalBytes,
      freeBytes,
    } satisfies StorageDriveCandidateDTO;
  }));

  return [...new Map(candidates.map((candidate) => [candidate.id, candidate])).values()]
    .sort((a, b) => Number(b.primary) - Number(a.primary) || Number(b.writable) - Number(a.writable) || a.label.localeCompare(b.label));
}

export async function getStorageSettings(): Promise<StorageSettingsDTO> {
  const [state, mounts] = await Promise.all([getLibraryRootState(), discoverMounts()]);
  const environment = new Set(environmentMediaRoots().map((root) => path.resolve(root)));
  const roots = await Promise.all(state.roots.map(async (root) => {
    const resolved = path.resolve(root);
    const mount = mountForPath(resolved, mounts);
    const { totalBytes, freeBytes } = await capacity(resolved);
    return {
      path: resolved,
      mountPath: mount?.mountPath ?? resolved,
      label: driveLabel(mount?.mountPath ?? resolved, mount?.source ?? resolved),
      primary: resolved === path.resolve(state.primaryRoot),
      source: environment.has(resolved) ? 'ENVIRONMENT' : 'MANAGED',
      available: totalBytes !== null,
      totalBytes,
      freeBytes,
    } satisfies StorageLibraryRootDTO;
  }));
  return { primaryRoot: state.primaryRoot, roots };
}

export async function addStorageDrive(id: string): Promise<StorageSettingsDTO> {
  const candidate = (await discoverStorageDrives()).find((drive) => drive.id === id);
  if (!candidate) throw ApiError.notFound('That server drive is no longer available', 'STORAGE_DRIVE_NOT_FOUND');
  if (!candidate.writable) throw ApiError.badRequest('Flux does not have write access to that drive', 'STORAGE_DRIVE_READ_ONLY');

  const target = path.resolve(candidate.suggestedRoot);
  try {
    await fs.mkdir(path.join(target, 'movies'), { recursive: true });
    await fs.mkdir(path.join(target, 'tv'), { recursive: true });
    const probe = path.join(target, `.flux-write-${randomUUID()}`);
    try {
      await fs.writeFile(probe, 'Flux storage write check', { flag: 'wx' });
    } finally {
      await fs.unlink(probe).catch(() => undefined);
    }
  } catch {
    throw ApiError.badRequest('Flux could not prepare the library folders on that drive', 'STORAGE_SETUP_FAILED');
  }

  const settings = await getServerSettings();
  const managedMediaRoots = [...new Set([...settings.managedMediaRoots, target].map((root) => path.resolve(root)))];
  await prisma.serverSettings.update({
    where: { id: 'singleton' },
    data: { managedMediaRoots },
  });
  invalidateLibraryRootState();
  return getStorageSettings();
}

function samePath(a: string, b: string): boolean {
  return path.resolve(a) === path.resolve(b);
}

function isInsidePath(root: string, candidate: string): boolean {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return relative === '' || relative === '.' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

async function countAbsoluteLibraryFilesUnderRoot(root: string): Promise<number> {
  const [movies, episodes] = await Promise.all([
    prisma.mediaItem.findMany({ where: { filePath: { not: null } }, select: { filePath: true } }),
    prisma.episode.findMany({ where: { filePath: { not: null } }, select: { filePath: true } }),
  ]);

  return [...movies, ...episodes].filter((row) =>
    row.filePath !== null && path.isAbsolute(row.filePath) && isInsidePath(root, row.filePath),
  ).length;
}

export async function removeStorageDrive(rootPath: string): Promise<StorageSettingsDTO> {
  const target = path.resolve(rootPath);
  const environmentRoots = environmentMediaRoots();
  if (environmentRoots.some((root) => samePath(root, target))) {
    throw ApiError.badRequest(
      'Environment-configured library drives must be removed from server configuration',
      'STORAGE_DRIVE_ENVIRONMENT',
    );
  }

  const settings = await getServerSettings();
  const primaryRoot = settings.primaryMediaRoot ?? environmentRoots[0];
  if (primaryRoot && samePath(primaryRoot, target)) {
    throw ApiError.badRequest('The primary library drive cannot be removed', 'STORAGE_DRIVE_PRIMARY');
  }

  const managedMediaRoots = settings.managedMediaRoots.map((root) => path.resolve(root));
  if (!managedMediaRoots.some((root) => samePath(root, target))) {
    throw ApiError.notFound('That managed library drive is not configured', 'STORAGE_DRIVE_NOT_CONFIGURED');
  }

  const referencedFiles = await countAbsoluteLibraryFilesUnderRoot(target);
  if (referencedFiles > 0) {
    throw ApiError.badRequest(
      `This drive still has ${referencedFiles} library file reference${referencedFiles === 1 ? '' : 's'}. Delete or move that media before removing the drive.`,
      'STORAGE_DRIVE_IN_USE',
    );
  }

  await prisma.serverSettings.update({
    where: { id: 'singleton' },
    data: { managedMediaRoots: managedMediaRoots.filter((root) => !samePath(root, target)) },
  });
  invalidateLibraryRootState();
  return getStorageSettings();
}
