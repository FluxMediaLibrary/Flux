import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// config.ts fails fast when required env vars are absent; supply test values
// before importing the module that pulls it in.
process.env.DATABASE_URL ??= 'postgres://user:pass@localhost:5432/flux_test';
process.env.REDIS_URL ??= 'redis://localhost:6379';
process.env.JWT_SECRET ??= 'test-secret-1234567890';
process.env.TMDB_API_KEY ??= 'test';
process.env.NODE_ENV = 'test';

const { detectExistingData } = await import('./webtorrent.js');

// ---------------------------------------------------------------------------
// Minimal bencode encoder for constructing valid .torrent fixtures
// ---------------------------------------------------------------------------

function bencode(value: unknown): Buffer {
  if (typeof value === 'string') {
    const buf = Buffer.from(value, 'utf8');
    return Buffer.concat([Buffer.from(`${buf.length}:`), buf]);
  }
  if (Buffer.isBuffer(value)) {
    return Buffer.concat([Buffer.from(`${value.length}:`), value]);
  }
  if (typeof value === 'number') {
    return Buffer.from(`i${value}e`);
  }
  if (Array.isArray(value)) {
    return Buffer.concat([Buffer.from('l'), ...value.map((v) => bencode(v)), Buffer.from('e')]);
  }
  if (typeof value === 'object' && value !== null) {
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
      a < b ? -1 : a > b ? 1 : 0,
    );
    return Buffer.concat([
      Buffer.from('d'),
      ...entries.flatMap(([key, val]) => [bencode(key), bencode(val)]),
      Buffer.from('e'),
    ]);
  }
  throw new Error(`Cannot bencode ${typeof value}`);
}

function makeTorrent(opts: {
  name: string;
  singleFile?: { length: number };
  files?: { path: string[]; length: number }[];
}): Buffer {
  const info: Record<string, unknown> = {
    name: opts.name,
    'piece length': 16384,
    pieces: Buffer.alloc(20),
  };
  if (opts.singleFile) {
    info.length = opts.singleFile.length;
  } else {
    info.files = (opts.files ?? []).map((f) => ({
      length: f.length,
      path: f.path,
    }));
  }
  return bencode({ info, announce: 'udp://tracker.example.com:1337' });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test('detectExistingData finds a complete single-file torrent', async () => {
  const root = await mkdtemp(join(tmpdir(), 'flux-torrent-data-'));
  try {
    const torrent = makeTorrent({ name: 'Movie.mkv', singleFile: { length: 1000 } });
    await writeFile(join(root, 'Movie.mkv'), Buffer.alloc(1000));

    assert.deepEqual(await detectExistingData(torrent, root), {
      filesOnDisk: 1,
      totalFiles: 1,
      bytesOnDisk: 1000,
      totalBytes: 1000,
      missingBytes: 0,
      complete: true,
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('detectExistingData ignores a file with the wrong size', async () => {
  const root = await mkdtemp(join(tmpdir(), 'flux-torrent-data-'));
  try {
    const torrent = makeTorrent({ name: 'Movie.mkv', singleFile: { length: 1000 } });
    await writeFile(join(root, 'Movie.mkv'), Buffer.alloc(500));

    assert.deepEqual(await detectExistingData(torrent, root), {
      filesOnDisk: 0,
      totalFiles: 1,
      bytesOnDisk: 0,
      totalBytes: 1000,
      missingBytes: 1000,
      complete: false,
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('detectExistingData handles a multi-file torrent layout', async () => {
  const root = await mkdtemp(join(tmpdir(), 'flux-torrent-data-'));
  try {
    const torrent = makeTorrent({
      name: 'Show S01',
      files: [
        { path: ['S01E01.mkv'], length: 500 },
        { path: ['S01E02.mkv'], length: 700 },
      ],
    });
    await mkdir(join(root, 'Show S01'), { recursive: true });
    await writeFile(join(root, 'Show S01', 'S01E01.mkv'), Buffer.alloc(500));
    await writeFile(join(root, 'Show S01', 'S01E02.mkv'), Buffer.alloc(700));

    assert.deepEqual(await detectExistingData(torrent, root), {
      filesOnDisk: 2,
      totalFiles: 2,
      bytesOnDisk: 1200,
      totalBytes: 1200,
      missingBytes: 0,
      complete: true,
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('detectExistingData reports partial data as incomplete', async () => {
  const root = await mkdtemp(join(tmpdir(), 'flux-torrent-data-'));
  try {
    const torrent = makeTorrent({
      name: 'Show S01',
      files: [
        { path: ['S01E01.mkv'], length: 500 },
        { path: ['S01E02.mkv'], length: 700 },
      ],
    });
    await mkdir(join(root, 'Show S01'), { recursive: true });
    await writeFile(join(root, 'Show S01', 'S01E01.mkv'), Buffer.alloc(500));

    assert.deepEqual(await detectExistingData(torrent, root), {
      filesOnDisk: 1,
      totalFiles: 2,
      bytesOnDisk: 500,
      totalBytes: 1200,
      missingBytes: 700,
      complete: false,
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('detectExistingData reports no data when the download root is empty', async () => {
  const root = await mkdtemp(join(tmpdir(), 'flux-torrent-data-'));
  try {
    const torrent = makeTorrent({ name: 'Movie.mkv', singleFile: { length: 1000 } });

    assert.deepEqual(await detectExistingData(torrent, root), {
      filesOnDisk: 0,
      totalFiles: 1,
      bytesOnDisk: 0,
      totalBytes: 1000,
      missingBytes: 1000,
      complete: false,
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('detectExistingData never probes outside the download root', async () => {
  const root = await mkdtemp(join(tmpdir(), 'flux-torrent-data-'));
  try {
    const torrent = makeTorrent({
      name: 'Sneaky',
      files: [{ path: ['..', '..', 'escape.mkv'], length: 10 }],
    });

    assert.deepEqual(await detectExistingData(torrent, root), {
      filesOnDisk: 0,
      totalFiles: 1,
      bytesOnDisk: 0,
      totalBytes: 10,
      missingBytes: 10,
      complete: false,
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
