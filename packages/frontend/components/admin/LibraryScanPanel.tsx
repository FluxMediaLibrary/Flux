'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { LibraryScanReportDTO, LibraryScanUnmatchedDTO, TmdbSearchResult } from '@flux/shared';
import { api, FluxApiError } from '@/lib/api';
import { formatBytes } from '@/lib/format';
import { StatusBadge } from '@/components/admin/AdminUI';

const POSTER_BASE = 'https://image.tmdb.org/t/p/w92';

function statusTone(status: LibraryScanReportDTO['status']): 'good' | 'warn' | 'bad' | 'info' | 'neutral' {
  switch (status) {
    case 'RUNNING':
    case 'QUEUED': return 'info';
    case 'COMPLETED': return 'good';
    case 'FAILED': return 'bad';
    default: return 'neutral';
  }
}

function fileName(filePath: string): string {
  const parts = filePath.split(/[\\/]/);
  return parts[parts.length - 1] ?? filePath;
}

/**
 * "Scan media folders" — indexes files already under the media roots and lets
 * an admin resolve anything the scanner could not match with confidence.
 * Polls while a scan is running; parent is told when new items may exist so
 * it can refresh the health table.
 */
export function LibraryScanPanel({ onLibraryChanged }: { onLibraryChanged?: () => void }) {
  const [report, setReport] = useState<LibraryScanReportDTO | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const wasActive = useRef(false);

  const load = useCallback(async () => {
    try {
      const next = await api.getLibraryScan();
      setReport(next);
      const active = next.status === 'RUNNING' || next.status === 'QUEUED';
      if (wasActive.current && !active) onLibraryChanged?.();
      wasActive.current = active;
    } catch (err) {
      setError(err instanceof FluxApiError ? err.message : 'Scan status unavailable.');
    }
  }, [onLibraryChanged]);

  useEffect(() => { void load(); }, [load]);

  const active = report?.status === 'RUNNING' || report?.status === 'QUEUED';
  useEffect(() => {
    if (!active) return;
    const timer = window.setInterval(() => void load(), 2000);
    return () => window.clearInterval(timer);
  }, [active, load]);

  async function start() {
    setStarting(true);
    setError(null);
    try {
      setReport(await api.startLibraryScan());
      wasActive.current = true;
      setExpanded(true);
    } catch (err) {
      setError(err instanceof FluxApiError ? err.message : 'The scan could not be started.');
    } finally {
      setStarting(false);
    }
  }

  const unmatchedCount = report?.unmatched.length ?? 0;

  return (
    <section className="control-section library-scan">
      <div className="control-section-heading">
        <h2>Media folders</h2>
        <span>Index files already present under the media roots</span>
      </div>
      <div className="control-panel library-scan-panel">
        <div className="library-scan-head">
          <div className="library-scan-status">
            <StatusBadge tone={statusTone(report?.status ?? 'IDLE')}>{report?.status ?? 'IDLE'}</StatusBadge>
            <span>{report?.progress.stage ?? 'Never scanned'}</span>
          </div>
          <div className="library-scan-actions">
            {(unmatchedCount > 0 || (report?.errors.length ?? 0) > 0) && (
              <button type="button" className="control-button" onClick={() => setExpanded((value) => !value)}>
                {expanded ? 'Hide details' : `Review ${unmatchedCount} unmatched`}
              </button>
            )}
            <button type="button" className="control-button primary" disabled={starting || active} onClick={() => void start()}>
              {active ? 'Scanning…' : starting ? 'Starting…' : 'Scan media folders'}
            </button>
          </div>
        </div>
        {error && <div className="admin-notice error">{error}</div>}
        {report && report.status !== 'IDLE' && (
          <div className="library-scan-stats">
            <div><span>Files seen</span><strong>{report.progress.filesSeen}</strong></div>
            <div><span>Already indexed</span><strong>{report.progress.filesSkipped}</strong></div>
            <div><span>Matched</span><strong>{report.progress.filesMatched}</strong></div>
            <div><span>Unmatched</span><strong>{report.progress.filesUnmatched}</strong></div>
            <div><span>Created</span><strong>{report.created.movies} movies · {report.created.shows} shows · {report.created.episodes} episodes</strong></div>
            <div><span>Errors</span><strong>{report.progress.errors}</strong></div>
          </div>
        )}
        <p className="library-scan-roots">
          Roots: {(report?.roots ?? []).map((root) => <code key={root}>{root}</code>)}
          <span className="dim"> — expected layout <code>movies/Title (Year)/file</code> and <code>tv/Show/Season 01/file</code>.</span>
        </p>
        {expanded && report && (
          <div className="library-scan-details">
            {report.unmatched.length > 0 && (
              <ul className="library-scan-unmatched">
                {report.unmatched.map((entry) => (
                  <UnmatchedRow key={entry.filePath} entry={entry} onResolved={() => { void load(); onLibraryChanged?.(); }} />
                ))}
              </ul>
            )}
            {report.errors.length > 0 && (
              <details className="library-scan-errors">
                <summary>{report.errors.length} error{report.errors.length === 1 ? '' : 's'}</summary>
                <ul>
                  {report.errors.map((entry, index) => <li key={`${entry.filePath}-${index}`}><code>{entry.filePath}</code><span>{entry.message}</span></li>)}
                </ul>
              </details>
            )}
          </div>
        )}
      </div>
    </section>
  );
}

function UnmatchedRow({ entry, onResolved }: { entry: LibraryScanUnmatchedDTO; onResolved: () => void }) {
  const [query, setQuery] = useState(entry.guessTitle);
  const [results, setResults] = useState<TmdbSearchResult[] | null>(null);
  const [season, setSeason] = useState<string>(entry.season?.toString() ?? '');
  const [episode, setEpisode] = useState<string>(entry.episode?.toString() ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  async function search() {
    setBusy(true);
    setError(null);
    try {
      setResults(await api.searchTmdb(query, entry.kind));
    } catch (err) {
      setError(err instanceof FluxApiError ? err.message : 'Search failed.');
    } finally {
      setBusy(false);
    }
  }

  async function resolve(tmdbId: number) {
    setBusy(true);
    setError(null);
    try {
      await api.resolveLibraryScanFile({
        filePath: entry.filePath,
        mediaType: entry.kind,
        tmdbId,
        season: entry.kind === 'SHOW' ? Number(season) : null,
        episode: entry.kind === 'SHOW' ? Number(episode) : null,
      });
      onResolved();
    } catch (err) {
      setError(err instanceof FluxApiError ? err.message : 'Could not attach the file.');
      setBusy(false);
    }
  }

  const candidates = results ?? entry.candidates.map((candidate) => ({ tmdbId: candidate.tmdbId, title: candidate.title, year: candidate.year, posterPath: candidate.posterPath }));
  const episodeReady = entry.kind === 'MOVIE' || (season !== '' && episode !== '');

  return (
    <li className="library-scan-row">
      <button type="button" className="library-scan-row-head" onClick={() => setOpen((value) => !value)} aria-expanded={open}>
        <span className="library-scan-row-kind">{entry.kind === 'MOVIE' ? 'Movie' : 'Episode'}</span>
        <span className="library-scan-row-title">
          <strong>{entry.guessTitle}{entry.guessYear ? ` (${entry.guessYear})` : ''}</strong>
          {entry.kind === 'SHOW' && <small>{entry.season !== null ? `S${entry.season}` : 'S?'}{entry.episode !== null ? `E${entry.episode}` : 'E?'}</small>}
          <small title={entry.filePath}>{fileName(entry.filePath)} · {formatBytes(entry.sizeBytes)}</small>
        </span>
        <span className="library-scan-row-toggle">{open ? 'Close' : 'Match'}</span>
      </button>
      {open && (
        <div className="library-scan-row-body">
          {error && <div className="admin-notice error">{error}</div>}
          <div className="library-scan-search">
            <input className="control-input" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search TMDb" onKeyDown={(event) => { if (event.key === 'Enter') void search(); }} />
            <button type="button" className="control-button" disabled={busy || !query.trim()} onClick={() => void search()}>Search</button>
            {entry.kind === 'SHOW' && (
              <>
                <input className="control-input library-scan-num" type="number" min={0} placeholder="Season" value={season} onChange={(event) => setSeason(event.target.value)} />
                <input className="control-input library-scan-num" type="number" min={0} placeholder="Episode" value={episode} onChange={(event) => setEpisode(event.target.value)} />
              </>
            )}
          </div>
          {candidates.length === 0 ? (
            <p className="dim">No candidates yet — search above.</p>
          ) : (
            <ul className="library-scan-candidates">
              {candidates.map((candidate) => (
                <li key={candidate.tmdbId}>
                  {candidate.posterPath ? <img src={`${POSTER_BASE}${candidate.posterPath}`} alt="" loading="lazy" /> : <span className="library-scan-noposter" aria-hidden />}
                  <span><strong>{candidate.title}</strong><small>{candidate.year ?? '—'} · TMDb {candidate.tmdbId}</small></span>
                  <button type="button" className="control-button primary" disabled={busy || !episodeReady} onClick={() => void resolve(candidate.tmdbId)}>Use this</button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </li>
  );
}
