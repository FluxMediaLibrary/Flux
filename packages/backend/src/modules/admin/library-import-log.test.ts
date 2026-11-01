import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { importLogPath, writeImportLog } from './library-import-log.js';

test('persists every issue beyond the preview limit with totals and isolated job files', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'flux-import-log-'));
  try {
    const file = importLogPath(root, 'job-one');
    const entries = Array.from({ length: 66 }, (_, index) => `SKIPPED ${JSON.stringify({ file: `movie-${index}.mkv`, reason: 'No match' })}`);
    const summary = { id: 'job-one', root: '/nas/movies', kind: 'MOVIE', status: 'done', total: 440, processed: 440, imported: 374, skipped: 66 };
    await writeImportLog(file, summary, entries);
    const content = await fs.readFile(file, 'utf8');
    assert.equal(content.split('\n').filter((line) => line.startsWith('SKIPPED ')).length, 66);
    assert.ok(content.includes('imported: 374; skipped: 66'));
    assert.ok(content.includes('movie-65.mkv'));
    await writeImportLog(importLogPath(root, 'job-two'), { ...summary, id: 'job-two', status: 'failed' }, ['FAILED traversal error']);
    assert.equal(await fs.readFile(file, 'utf8'), content);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
