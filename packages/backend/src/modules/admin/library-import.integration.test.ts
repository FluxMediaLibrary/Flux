import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { importLogPath, writeImportLog } from './library-import-log.js';

test('downloads the selected import log with every skipped file and survives loss of in-memory job state', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'flux-import-'));
  const media = path.join(root, 'media');
  const source = path.join(root, 'source');
  process.env.DATABASE_URL = 'postgresql://test:test@127.0.0.1:1/flux_test';
  process.env.REDIS_URL = 'redis://127.0.0.1:1';
  process.env.JWT_SECRET = 'import-test-secret-value';
  process.env.TMDB_API_KEY = 'test-key';
  process.env.MEDIA_ROOTS = `${media},${source}`;
  try {
    await fs.mkdir(source);
    await Promise.all(Array.from({ length: 66 }, (_, index) => fs.writeFile(path.join(source, `unrecognized-${index}.mkv`), '')));
    const { startImport, getImportJob, getImportLog } = await import('./library-import.service.js');
    const job = await startImport(source, 'SHOW');
    for (let attempts = 0; job.status === 'running' && attempts < 200; attempts++) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    assert.equal(job.status, 'done');
    assert.equal(getImportJob(job.id)?.skipped, 66);
    assert.equal(job.errors.length, 30);
    const log = await getImportLog(job.id);
    assert.equal(log.split('\n').filter((line) => line.startsWith('SKIPPED ')).length, 66);
    assert.ok(log.includes('unrecognized-65.mkv'));
    assert.ok(log.includes('Could not recognize title or season/episode numbers'));
    const archivedId = randomUUID();
    await writeImportLog(importLogPath(media, archivedId), { ...job, id: archivedId }, ['SKIPPED another import']);
    assert.ok((await getImportLog(archivedId)).includes('another import'));
    assert.equal(await getImportLog(job.id), log);
    await assert.rejects(getImportLog('../other-file'), /Invalid import job ID/);
    await assert.rejects(getImportLog(randomUUID()), /No log was saved/);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
