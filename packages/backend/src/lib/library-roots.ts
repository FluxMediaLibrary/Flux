import path from 'node:path';
import { config } from '../config.js';
import { prisma } from './db.js';

export interface LibraryRootState {
  primaryRoot: string;
  roots: string[];
  reserveSpaceBytes: number;
}

const ENVIRONMENT_ROOTS = config.MEDIA_ROOTS.map((root) => path.resolve(root));
let cachedState: { value: LibraryRootState; expiresAt: number } | null = null;

function uniqueRoots(roots: readonly string[]): string[] {
  return [...new Set(roots.map((root) => path.resolve(root)))];
}

export async function getLibraryRootState(): Promise<LibraryRootState> {
  if (cachedState && cachedState.expiresAt > Date.now()) return cachedState.value;

  let primaryRoot = ENVIRONMENT_ROOTS[0]!;
  let managedMediaRoots: string[] = [];
  let reserveSpaceBytes = config.MEDIA_SPILLOVER_THRESHOLD_BYTES;
  try {
    const row = await prisma.serverSettings.findUnique({
      where: { id: 'singleton' },
      select: { primaryMediaRoot: true, managedMediaRoots: true, storageReserveGb: true },
    });
    if (row?.primaryMediaRoot) primaryRoot = path.resolve(row.primaryMediaRoot);
    managedMediaRoots = row?.managedMediaRoots ?? [];
    if (row) reserveSpaceBytes = row.storageReserveGb * 1024 ** 3;
  } catch {
    // Keep environment roots usable while a newly shipped migration is pending.
  }

  const value = {
    primaryRoot,
    roots: uniqueRoots([primaryRoot, ...ENVIRONMENT_ROOTS, ...managedMediaRoots]),
    reserveSpaceBytes,
  };
  cachedState = { value, expiresAt: Date.now() + 30_000 };
  return value;
}

export function invalidateLibraryRootState(): void {
  cachedState = null;
}

export function environmentMediaRoots(): string[] {
  return [...ENVIRONMENT_ROOTS];
}
