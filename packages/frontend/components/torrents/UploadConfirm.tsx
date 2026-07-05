'use client';

import Image from 'next/image';
import { useCallback, useRef, useState } from 'react';
import type {
  ConfirmTorrentRequest,
  MediaType,
  TmdbSearchResult,
  TorrentParseResult,
} from '@flux/shared';
import { api, FluxApiError } from '@/lib/api';

const TMDB_THUMB = 'https://image.tmdb.org/t/p/w92';

/** Editable per-file season/episode row (season packs). */
interface FileRow {
  path: string;
  season: string; // kept as strings for controlled inputs
  episode: string;
}

function toRows(result: TorrentParseResult): FileRow[] {
  return result.files.map((f) => ({
    path: f.path,
    season: f.season != null ? String(f.season) : '',
    episode: f.episode != null ? String(f.episode) : '',
  }));
}

export function UploadConfirm({ onConfirmed }: { onConfirmed: () => void }) {
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [uploading, setUploading] = useState(false);
  const [parsed, setParsed] = useState<TorrentParseResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Confirm-form state
  const [category, setCategory] = useState<MediaType>('MOVIE');
  const [rows, setRows] = useState<FileRow[]>([]);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<TmdbSearchResult[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [selected, setSelected] = useState<TmdbSearchResult | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const reset = useCallback(() => {
    setParsed(null);
    setError(null);
    setCategory('MOVIE');
    setRows([]);
    setQuery('');
    setResults(null);
    setSelected(null);
    setSearching(false);
    setSubmitting(false);
    if (fileInputRef.current) fileInputRef.current.value = '';
  }, []);

  async function handleFile(file: File) {
    setError(null);
    setUploading(true);
    setParsed(null);
    try {
      const result = await api.uploadTorrent(file);
      setParsed(result);
      setCategory(result.guessedType);
      setRows(toRows(result));
      setQuery(result.guessedTitle);
      setResults(null);
      setSelected(null);
    } catch (err) {
      setError(
        err instanceof FluxApiError ? err.message : 'Failed to parse the .torrent file.',
      );
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }

  async function runSearch() {
    const q = query.trim();
    if (!q) return;
    setSearching(true);
    setError(null);
    try {
      const list = await api.searchTmdb(q, category);
      setResults(list);
    } catch (err) {
      setError(
        err instanceof FluxApiError ? err.message : 'TMDb search failed. Try again.',
      );
      setResults([]);
    } finally {
      setSearching(false);
    }
  }

  function pickCategory(next: MediaType) {
    if (next === category) return;
    setCategory(next);
    // Results are type-specific; invalidate the current match/list.
    setResults(null);
    setSelected(null);
  }

  function updateRow(index: number, field: 'season' | 'episode', value: string) {
    setRows((prev) =>
      prev.map((r, i) =>
        i === index ? { ...r, [field]: value.replace(/[^0-9]/g, '') } : r,
      ),
    );
  }

  async function submit() {
    if (!parsed || !selected) return;
    setSubmitting(true);
    setError(null);

    const body: ConfirmTorrentRequest = {
      infoHash: parsed.infoHash,
      category,
      tmdbId: selected.tmdbId,
      title: selected.title,
      year: selected.year,
    };

    if (category === 'SHOW' && rows.length > 0) {
      body.fileMapping = rows.map((r) => ({
        path: r.path,
        season: Number(r.season) || 0,
        episode: Number(r.episode) || 0,
      }));
    }

    try {
      await api.confirmTorrent(body);
      reset();
      onConfirmed();
    } catch (err) {
      setError(
        err instanceof FluxApiError ? err.message : 'Failed to start the download.',
      );
      setSubmitting(false);
    }
  }

  return (
    <section className="card torrent-upload">
      <h2 style={{ fontSize: '1.15rem', marginBottom: 4 }}>Add a torrent</h2>
      <p className="muted" style={{ marginBottom: 18, fontSize: '0.9rem' }}>
        Upload a <span className="code">.torrent</span> file, confirm the TMDb match,
        then start the download.
      </p>

      {error && <div className="form-error">{error}</div>}

      {/* Step 1 — file input */}
      <div className="upload-drop">
        <input
          ref={fileInputRef}
          id="torrent-file"
          type="file"
          accept=".torrent,application/x-bittorrent"
          disabled={uploading}
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void handleFile(f);
          }}
          style={{ display: 'none' }}
        />
        <label
          htmlFor="torrent-file"
          className="btn btn-primary"
          style={{ margin: 0, color: '#fff' }}
        >
          {uploading ? 'Parsing…' : parsed ? 'Choose a different file' : 'Choose .torrent file'}
        </label>
        {uploading && <span className="spinner" aria-hidden style={{ width: 22, height: 22 }} />}
        {parsed && !uploading && (
          <button type="button" className="btn btn-ghost" onClick={reset}>
            Cancel
          </button>
        )}
      </div>

      {/* Step 2 — parse result + confirm form */}
      {parsed && (
        <div className="confirm-form">
          <div className="parse-summary">
            <div>
              <span className="dim">Torrent</span>
              <div className="parse-name">{parsed.name}</div>
            </div>
            <div>
              <span className="dim">Guessed</span>
              <div>
                {parsed.guessedTitle}
                {parsed.guessedYear ? ` (${parsed.guessedYear})` : ''}
              </div>
            </div>
            <div>
              <span className="dim">Info hash</span>
              <div className="code" style={{ fontSize: '0.72rem' }}>
                {parsed.infoHash}
              </div>
            </div>
          </div>

          {/* Category toggle */}
          <div className="field">
            <label>Category</label>
            <div className="toggle-group" role="group" aria-label="Category">
              <button
                type="button"
                className={category === 'MOVIE' ? 'toggle active' : 'toggle'}
                onClick={() => pickCategory('MOVIE')}
              >
                Movie
              </button>
              <button
                type="button"
                className={category === 'SHOW' ? 'toggle active' : 'toggle'}
                onClick={() => pickCategory('SHOW')}
              >
                TV Show
              </button>
            </div>
          </div>

          {/* TMDb search-and-confirm */}
          <div className="field">
            <label htmlFor="tmdb-q">Match against TMDb</label>
            <div className="search-row">
              <input
                id="tmdb-q"
                className="input"
                value={query}
                placeholder="Search TMDb…"
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    void runSearch();
                  }
                }}
              />
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => void runSearch()}
                disabled={searching || !query.trim()}
              >
                {searching ? 'Searching…' : 'Search'}
              </button>
            </div>

            {results && results.length === 0 && !searching && (
              <p className="muted" style={{ fontSize: '0.85rem', marginTop: 10 }}>
                No TMDb matches. Refine the search above.
              </p>
            )}

            {results && results.length > 0 && (
              <ul className="tmdb-results">
                {results.map((r) => {
                  const active = selected?.tmdbId === r.tmdbId;
                  return (
                    <li key={`${r.mediaType}-${r.tmdbId}`}>
                      <button
                        type="button"
                        className={active ? 'tmdb-result active' : 'tmdb-result'}
                        onClick={() => setSelected(r)}
                      >
                        {r.posterPath ? (
                          <Image
                            src={`${TMDB_THUMB}${r.posterPath}`}
                            alt=""
                            width={46}
                            height={69}
                            className="tmdb-poster"
                          />
                        ) : (
                          <span className="tmdb-poster placeholder" aria-hidden />
                        )}
                        <span className="tmdb-meta">
                          <span className="tmdb-title">
                            {r.title}
                            {r.year ? <span className="dim"> · {r.year}</span> : null}
                          </span>
                          <span className="tmdb-overview">
                            {r.overview || 'No synopsis available.'}
                          </span>
                        </span>
                        {active && <span className="tmdb-check" aria-hidden>✓</span>}
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          {/* Season/episode mapping for TV season packs */}
          {category === 'SHOW' && rows.length > 0 && (
            <div className="field">
              <label>Episode mapping</label>
              <p className="muted" style={{ fontSize: '0.82rem', marginBottom: 8 }}>
                Auto-parsed from filenames — correct any mismatches.
              </p>
              <div className="table-wrap">
                <table className="data mapping-table">
                  <thead>
                    <tr>
                      <th>File</th>
                      <th style={{ width: 90 }}>Season</th>
                      <th style={{ width: 90 }}>Episode</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row, i) => (
                      <tr key={row.path}>
                        <td className="mapping-path" title={row.path}>
                          {row.path}
                        </td>
                        <td>
                          <input
                            className="input mapping-input"
                            inputMode="numeric"
                            value={row.season}
                            onChange={(e) => updateRow(i, 'season', e.target.value)}
                          />
                        </td>
                        <td>
                          <input
                            className="input mapping-input"
                            inputMode="numeric"
                            value={row.episode}
                            onChange={(e) => updateRow(i, 'episode', e.target.value)}
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          <div className="confirm-actions">
            <button type="button" className="btn btn-ghost" onClick={reset}>
              Discard
            </button>
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => void submit()}
              disabled={!selected || submitting}
            >
              {submitting ? 'Starting…' : 'Confirm & download'}
            </button>
          </div>
          {!selected && (
            <p className="dim" style={{ fontSize: '0.8rem', marginTop: 8 }}>
              Select a TMDb match to enable download.
            </p>
          )}
        </div>
      )}
    </section>
  );
}
