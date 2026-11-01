'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api';

type Kind = 'MOVIE' | 'SHOW';
type Preview = Awaited<ReturnType<typeof api.previewImport>>;
type Job = Awaited<ReturnType<typeof api.getImportJob>>;

export default function ImportLibraryPage() {
  const [folders, setFolders] = useState<string[]>([]);
  const [folder, setFolder] = useState('');
  const [kind, setKind] = useState<Kind>('MOVIE');
  const [preview, setPreview] = useState<Preview | null>(null);
  const [job, setJob] = useState<Job | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [downloading, setDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState('');

  useEffect(() => {
    api.getImportFolders().then((result) => {
      setFolders(result.folders);
      setFolder(result.folders[0] ?? '');
    }).catch((err: Error) => setError(err.message));
  }, []);

  useEffect(() => {
    if (!job || job.status !== 'running') return;
    const timer = window.setInterval(() => {
      api.getImportJob(job.id).then(setJob).catch((err: Error) => setError(err.message));
    }, 2000);
    return () => window.clearInterval(timer);
  }, [job?.id, job?.status]);

  async function inspect() {
    if (!folder) return;
    setBusy(true); setError(''); setPreview(null);
    try { setPreview(await api.previewImport(folder, kind)); }
    catch (err) { setError(err instanceof Error ? err.message : 'Preview failed'); }
    finally { setBusy(false); }
  }

  async function importAll() {
    if (!preview || job?.status === 'running') return;
    setBusy(true); setError('');
    try {
      const { id } = await api.startImport(preview.root, kind);
      setDownloadError('');
      setJob(await api.getImportJob(id));
    } catch (err) { setError(err instanceof Error ? err.message : 'Import failed'); }
    finally { setBusy(false); }
  }

  async function downloadLog() {
    if (!job || job.status === 'running' || downloading) return;
    setDownloading(true); setDownloadError('');
    try {
      const blob = await api.downloadImportLog(job.id);
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = 'dump.log';
      document.body.appendChild(link);
      try { link.click(); }
      finally {
        link.remove();
        window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      }
    } catch (err) {
      setDownloadError(err instanceof Error ? err.message : 'Log download failed');
    } finally { setDownloading(false); }
  }

  return (
    <main className="control-page" style={{ maxWidth: 900, margin: '0 auto', padding: 24 }}>
      <p><Link href="/admin/library">← Back to library</Link></p>
      <h1>Import existing media</h1>
      <p>Scan a mounted folder and register movies or TV episodes without moving, renaming, or deleting the original files.</p>
      <div style={{ display: 'grid', gap: 12, marginTop: 24 }}>
        <label htmlFor="import-folder">Mounted folder</label>
        <select id="import-folder" value={folder} onChange={(event) => { setFolder(event.target.value); setPreview(null); }}>
          {folders.map((item) => <option key={item} value={item}>{item}</option>)}
        </select>
        <label htmlFor="import-kind">Media type</label>
        <select id="import-kind" value={kind} onChange={(event) => { setKind(event.target.value as Kind); setPreview(null); }}>
          <option value="MOVIE">Movies</option>
          <option value="SHOW">TV shows</option>
        </select>
        <button type="button" onClick={inspect} disabled={busy || !folder || job?.status === 'running'}>{busy ? 'Working…' : 'Preview folder'}</button>
      </div>
      {error && <p role="alert" style={{ color: '#e87070' }}>{error}</p>}
      {preview && <section style={{ marginTop: 24 }}>
        <h2>Scan preview</h2>
        <p>{preview.files.toLocaleString()} video files found; {preview.recognized.toLocaleString()} filenames recognized.</p>
        <p>Unrecognized filenames and uncertain TMDb matches will be skipped. Existing library paths will not be overwritten.</p>
        <ul>{preview.sample.map((item) => <li key={item.file}>{item.file} → {item.title}{item.year ? ` (${item.year})` : ''}{item.season !== undefined ? ` S${item.season}E${item.episode}` : ''}</li>)}</ul>
        <button type="button" onClick={importAll} disabled={busy || Boolean(job?.status === 'running') || preview.recognized === 0}>Import recognized files</button>
      </section>}
      {job && <section aria-live="polite" style={{ marginTop: 24 }}>
        <h2>Import {job.status}</h2>
        <p>{job.processed.toLocaleString()} / {job.total.toLocaleString()} processed · {job.imported.toLocaleString()} imported · {job.skipped.toLocaleString()} skipped</p>
        <progress value={job.processed} max={Math.max(1, job.total)} style={{ width: '100%' }} />
        {job.status !== 'running' && <div style={{ marginTop: 12 }}>
          <button className="btn" type="button" onClick={downloadLog} disabled={downloading || Boolean(job.logError)} aria-busy={downloading} style={{ minHeight: 44, borderColor: 'var(--text-muted)' }}>
            {downloading ? 'Downloading…' : 'Download dump.log'}
          </button>
          <p>Full log for this import, including every skipped file and its reason.</p>
          {(downloadError || job.logError) && <p role="alert">{downloadError || job.logError}</p>}
        </div>}
        {job.errors.length > 0 && <details><summary>Issues ({job.errors.length} shown)</summary><ul>{job.errors.map((item, index) => <li key={index}>{item}</li>)}</ul></details>}
      </section>}
    </main>
  );
}
