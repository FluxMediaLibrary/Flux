import fs from 'node:fs/promises';
import path from 'node:path';

export type ImportLogSummary = {
  id: string; root: string; kind: string; status: string;
  total: number; processed: number; imported: number; skipped: number;
};

export function importLogPath(mediaRoot: string, id: string) {
  return path.join(mediaRoot, 'import-logs', id, 'dump.log');
}

export async function writeImportLog(file: string, job: ImportLogSummary, entries: string[]) {
  const header = [
    'Flux library import',
    `Completed: ${new Date().toISOString()}`,
    `Job: ${job.id}`,
    `Root: ${JSON.stringify(job.root)}`,
    `Kind: ${job.kind}`,
    `Status: ${job.status}`,
    `Files: ${job.total}; processed: ${job.processed}; imported: ${job.imported}; skipped: ${job.skipped}`,
    '',
  ];
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, [...header, ...entries, ''].join('\n'), 'utf8');
}
