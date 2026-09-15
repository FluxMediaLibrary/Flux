import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import type { StoragePolicy, VolumeStats } from './storage.js';

// config.ts fails fast when required env vars are absent; supply test values
// before importing the module that pulls it in.
process.env.DATABASE_URL ??= 'postgres://user:pass@localhost:5432/flux_test';
process.env.REDIS_URL ??= 'redis://127.0.0.1:1';
process.env.JWT_SECRET ??= 'test-secret-1234567890';
process.env.NODE_ENV = 'test';

const { evaluatePlacement } = await import('./storage.js');

const GIB = 1024 ** 3;

function volume(dir: string, freeGb: number, reservedGb: number, extra: Partial<VolumeStats> = {}): VolumeStats {
  const free = freeGb * GIB;
  const reserved = reservedGb * GIB;
  return {
    path: path.resolve(dir),
    role: 'media',
    exists: true,
    writable: true,
    totalBytes: 500 * GIB,
    freeBytes: free,
    reservedBytes: reserved,
    availableBytes: Math.max(0, free - reserved),
    deviceId: dir,
    ...extra,
  };
}

const policy = (overrides: Partial<StoragePolicy> = {}): StoragePolicy => ({
  reservedBytes: 5 * GIB,
  strategy: 'MOST_FREE',
  preferredMediaRoot: null,
  ...overrides,
});

test('spills over to the second drive when the first cannot keep its reserve', () => {
  // Drive A: 7 GB free, 5 GB reserved → 2 GB usable. Incoming movie: 3 GB.
  const a = volume('/mnt/a', 7, 5);
  const b = volume('/mnt/b', 40, 5);
  const result = evaluatePlacement([a, b], policy(), { requiredBytes: 3 * GIB });
  assert.equal(result.root, b.path);
  assert.equal(result.candidates[0]?.eligible, false);
  assert.match(result.candidates[0]?.reason ?? '', /reserved/);
});

test('uses the reserve from policy, not a fixed threshold', () => {
  const a = volume('/mnt/a', 7, 1);
  const b = volume('/mnt/b', 6, 1);
  const result = evaluatePlacement([a, b], policy({ reservedBytes: 1 * GIB }), { requiredBytes: 3 * GIB });
  assert.equal(result.root, a.path);
});

test('fails with an explanation for every volume when nothing fits', () => {
  const a = volume('/mnt/a', 4, 5);
  const b = volume('/mnt/b', 2, 5, { writable: false });
  const c = volume('/mnt/c', 0, 5, { exists: false, freeBytes: null, availableBytes: null, totalBytes: null });
  const result = evaluatePlacement([a, b, c], policy(), { requiredBytes: 1 * GIB });
  assert.equal(result.root, null);
  assert.equal(result.candidates.length, 3);
  assert.match(result.candidates[1]?.reason ?? '', /read-only/);
  assert.match(result.candidates[2]?.reason ?? '', /not mounted/);
});

test('PREFERRED_FIRST fills the preferred root until it hits the reserve', () => {
  const a = volume('/mnt/a', 20, 5);
  const b = volume('/mnt/b', 200, 5);
  const preferred = policy({ strategy: 'PREFERRED_FIRST', preferredMediaRoot: a.path });
  assert.equal(evaluatePlacement([a, b], preferred, { requiredBytes: 10 * GIB }).root, a.path);
  assert.equal(evaluatePlacement([a, b], preferred, { requiredBytes: 16 * GIB }).root, b.path);
});

test('affinity keeps a show on the drive that already holds it when there is room', () => {
  const a = volume('/mnt/a', 30, 5);
  const b = volume('/mnt/b', 300, 5);
  assert.equal(evaluatePlacement([a, b], policy(), { requiredBytes: 4 * GIB, affinityRoot: a.path }).root, a.path);
  assert.equal(evaluatePlacement([a, b], policy(), { requiredBytes: 40 * GIB, affinityRoot: a.path }).root, b.path);
});

test('applies a small overhead to the required size', () => {
  const a = volume('/mnt/a', 15, 5); // exactly 10 GB usable
  const result = evaluatePlacement([a], policy(), { requiredBytes: 10 * GIB });
  assert.equal(result.root, null);
  assert.ok(result.requiredBytes > 10 * GIB);
});
