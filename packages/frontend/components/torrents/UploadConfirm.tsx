'use client';

import Image from 'next/image';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  ConfirmTorrentRequest,
  MediaType,
  RequestDTO,
  TmdbEpisode,
  TmdbSearchResult,
  TorrentParseResult,
} from '@flux/shared';
import { api, FluxApiError } from '@/lib/api';

const TMDB_THUMB = 'https://image.tmdb.org/t/p/w92';

interface FileRow {
  path: string;
  season: string;
  episode: string;
}

export interface InitialTorrentMatch {
  tmdbId: number;
  mediaType: MediaType;
  title: string;
  year: number | null;
  season?: number | null;
  episode?: number | null;
}

function toRows(
  result: TorrentParseResult,
  preferredSeason?: number | null,
  preferredEpisode?: number | null,
): FileRow[] {
  return result.files.map((f, index) => ({
    path: f.path,
    season: f.season != null ? String(f.season) : preferredSeason ? String(preferredSeason) : '',
    episode: f.episode != null
      ? String(f.episode)
      : preferredEpisode
        ? String(preferredEpisode + index)
        : '',
  }));
}

function requestTargetLabel(request: RequestDTO): string {
  if (request.mediaType !== 'SHOW' || !request.season) return '';
  return ` - S${request.season}${request.episode ? ` E${request.episode}` : ''}`;
}

export function UploadConfirm({
  initialRequestId,
  initialMatch,
  onConfirmed,
}: {
  initialRequestId?: string;
  initialMatch?: InitialTorrentMatch;
  onConfirmed: () => void;
}) {
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [uploading, setUploading] = useState(false);
  const [parsed, setParsed] = useState<TorrentParseResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [category, setCategory] = useState<MediaType>('MOVIE');
  const [rows, setRows] = useState<FileRow[]>([]);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<TmdbSearchResult[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [selected, setSelected] = useState<TmdbSearchResult | null>(null);
  const [selectedRequestId, setSelectedRequestId] = useState('');
  const [requests, setRequests] = useState<RequestDTO[]>([]);
  const [requestError, setRequestError] = useState<string | null>(null);
  const [initialRequestApplied, setInitialRequestApplied] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [seasonEpisodes, setSeasonEpisodes] = useState<Record<number, TmdbEpisode[]>>({});
  const [seasonLoading, setSeasonLoading] = useState(false);
  const [seasonError, setSeasonError] = useState<string | null>(null);

  const [autoMatched, setAutoMatched] = useState(false);
  const [matchError, setMatchError] = useState(false);

  const initialSyntheticMatch = useMemo<TmdbSearchResult | null>(() => {
    if (!initialMatch) return null;
    return {
      tmdbId: initialMatch.tmdbId,
      mediaType: initialMatch.mediaType,
      title: initialMatch.title,
      year: initialMatch.year,
      overview: '',
      posterPath: null,
      backdropPath: null,
      voteAverage: null,
      inLibrary: true,
    };
  }, [initialMatch]);

  const preferredSeason = initialMatch?.mediaType === 'SHOW' ? initialMatch.season : null;
  const preferredEpisode = initialMatch?.mediaType === 'SHOW' ? initialMatch.episode : null;

  const mappedSeasons = useMemo(
    () =>
      [...new Set(rows.map((row) => Number(row.season)).filter((season) => season > 0))]
        .sort((a, b) => a - b),
    [rows],
  );

  const invalidMappingCount = useMemo(
    () => rows.filter((row) => Number(row.season) <= 0 || Number(row.episode) <= 0).length,
    [rows],
  );

  const episodeOverflowCount = useMemo(
    () =>
      rows.filter((row) => {
        const season = Number(row.season);
        const episode = Number(row.episode);
        const knownEpisodes = seasonEpisodes[season];
        return knownEpisodes && episode > knownEpisodes.length;
      }).length,
    [rows, seasonEpisodes],
  );
  const duplicateMappingCount = useMemo(() => {
    const seen = new Set<string>();
    const duplicates = new Set<string>();
    for (const row of rows) {
      const season = Number(row.season);
      const episode = Number(row.episode);
      if (season <= 0 || episode <= 0) continue;
      const key = `${season}:${episode}`;
      if (seen.has(key)) duplicates.add(key);
      else seen.add(key);
    }
    return duplicates.size;
  }, [rows]);
  const approvedRequests = useMemo(
    () => requests.filter((request) => request.status === 'APPROVED'),
    [requests],
  );

  const selectedRequest = useMemo(
    () => approvedRequests.find((request) => request.id === selectedRequestId) ?? null,
    [approvedRequests, selectedRequestId],
  );
  const selectedRequestSeason = selectedRequest?.mediaType === 'SHOW' ? selectedRequest.season : null;
  const selectedRequestEpisode = selectedRequest?.mediaType === 'SHOW' ? selectedRequest.episode : null;
  const mappingSeedSeason = selectedRequestSeason ?? preferredSeason;
  const mappingSeedEpisode = selectedRequestEpisode ?? preferredEpisode;
  const selectedRequestMappingError = useMemo(() => {
    if (!selectedRequest || selectedRequest.mediaType !== 'SHOW') return null;
    if (!selectedRequest.season) return null;
    if (rows.length === 0) return 'This request needs mapped TV episode files.';

    const mappedSeason = rows.some((row) => Number(row.season) === selectedRequest.season);
    if (!mappedSeason) {
      return `The mapping does not include requested season ${selectedRequest.season}.`;
    }

    if (!selectedRequest.episode) {
      const knownEpisodes = seasonEpisodes[selectedRequest.season];
      if (!knownEpisodes || knownEpisodes.length === 0) return null;
      const mappedEpisodes = new Set(
        rows
          .filter((row) => Number(row.season) === selectedRequest.season)
          .map((row) => Number(row.episode))
          .filter((episode) => episode > 0),
      );
      const missingEpisodes = knownEpisodes
        .map((episode) => episode.episodeNumber)
        .filter((episode) => episode > 0 && !mappedEpisodes.has(episode));
      if (missingEpisodes.length === 0) return null;
      const shown = missingEpisodes.slice(0, 6).map((episode) => `E${episode}`).join(', ');
      return `The mapping is missing ${missingEpisodes.length} episode${missingEpisodes.length === 1 ? '' : 's'} for requested season ${selectedRequest.season}: ${shown}${missingEpisodes.length > 6 ? ', ...' : ''}.`;
    }

    const mappedEpisode = rows.some(
      (row) =>
        Number(row.season) === selectedRequest.season &&
        Number(row.episode) === selectedRequest.episode,
    );
    return mappedEpisode
      ? null
      : `The mapping does not include requested episode S${selectedRequest.season} E${selectedRequest.episode}.`;
  }, [rows, seasonEpisodes, selectedRequest]);

  const canSubmit = Boolean(
    selected &&
      !submitting &&
      !selectedRequestMappingError &&
      duplicateMappingCount === 0 &&
      (category !== 'SHOW' || (rows.length > 0 && invalidMappingCount === 0)),
  );

  const existingDataNote = useMemo(() => {
    const existing = parsed?.existingData;
    if (!existing) return null;
    if (existing.filesOnDisk <= 0) {
      return 'No matching payload files were found on disk. Flux will not treat this upload as seedable.';
    }
    if (existing.complete) {
      return `All ${existing.totalFiles} file${existing.totalFiles === 1 ? '' : 's'} already exist on disk — this will verify the data and start seeding without re-downloading.`;
    }
    return `${existing.filesOnDisk} of ${existing.totalFiles} file${existing.totalFiles === 1 ? '' : 's'} already exist on disk — existing data will be reused and only missing pieces will download.`;
  }, [parsed]);

  const confirmLabel = useMemo(() => {
    const existing = parsed?.existingData;
    if (!existing || existing.filesOnDisk <= 0) return 'Confirm & download';
    return existing.complete ? 'Verify & seed' : 'Reuse data & download';
  }, [parsed]);

  const selectedRequestMatch = useMemo<TmdbSearchResult | null>(() => {
    if (!selectedRequest) return null;
    return {
      tmdbId: selectedRequest.tmdbId,
      mediaType: selectedRequest.mediaType,
      title: selectedRequest.title,
      year: null,
      overview: '',
      posterPath: null,
      backdropPath: null,
      voteAverage: null,
      inLibrary: false,
    };
  }, [selectedRequest]);

  const reset = useCallback(() => {
    setParsed(null);
    setError(null);
    setCategory(initialMatch?.mediaType ?? 'MOVIE');
    setRows([]);
    setQuery(initialMatch?.title ?? '');
    setResults(initialSyntheticMatch ? [initialSyntheticMatch] : null);
    setSelected(initialSyntheticMatch);
    setSelectedRequestId('');
    setSearching(false);
    setSubmitting(false);
    setSeasonEpisodes({});
    setSeasonLoading(false);
    setSeasonError(null);
    setAutoMatched(false);
    setMatchError(false);
    if (fileInputRef.current) fileInputRef.current.value = '';
  }, [initialMatch, initialSyntheticMatch]);

  useEffect(() => {
    if (parsed || initialRequestId || !initialSyntheticMatch) return;
    setCategory(initialSyntheticMatch.mediaType);
    setQuery(initialSyntheticMatch.title);
    setResults([initialSyntheticMatch]);
    setSelected(initialSyntheticMatch);
  }, [initialRequestId, initialSyntheticMatch, parsed]);

  useEffect(() => {
    const controller = new AbortController();
    api.listAllRequests(controller.signal).then(
      (list) => {
        if (controller.signal.aborted) return;
        setRequests(list);
        setRequestError(null);
      },
      (err) => {
        if (controller.signal.aborted) return;
        setRequestError(
          err instanceof FluxApiError ? err.message : 'Failed to load approved requests.',
        );
      },
    );
    return () => controller.abort();
  }, []);

  useEffect(() => {
    if (!initialRequestId || initialRequestApplied || approvedRequests.length === 0) {
      return;
    }

    if (approvedRequests.some((request) => request.id === initialRequestId)) {
      pickRequest(initialRequestId);
    } else {
      setRequestError('The linked request is no longer approved or could not be found.');
    }
    setInitialRequestApplied(true);
  }, [approvedRequests, initialRequestApplied, initialRequestId]);

  useEffect(() => {
    if (category !== 'SHOW' || !selected || mappedSeasons.length === 0) {
      setSeasonEpisodes({});
      setSeasonLoading(false);
      setSeasonError(null);
      return;
    }

    const controller = new AbortController();
    setSeasonLoading(true);
    setSeasonError(null);

    Promise.all(
      mappedSeasons.map(async (season) => [
        season,
        await api.tmdbSeason(selected.tmdbId, season, controller.signal),
      ] as const),
    ).then(
      (entries) => {
        if (controller.signal.aborted) return;
        setSeasonEpisodes(Object.fromEntries(entries));
        setSeasonLoading(false);
      },
      (err) => {
        if (controller.signal.aborted) return;
        setSeasonEpisodes({});
        setSeasonLoading(false);
        setSeasonError(
          err instanceof FluxApiError
            ? err.message
            : 'Could not load TMDb episode data.',
        );
      },
    );

    return () => controller.abort();
  }, [category, mappedSeasons, selected]);

  async function handleFile(file: File) {
    setError(null);
    setUploading(true);
    setParsed(null);
    setMatchError(false);
    try {
      const result = await api.uploadTorrent(file);
      setParsed(result);

      const seededMatch = selectedRequestMatch ?? initialSyntheticMatch;
      setRows(toRows(
        result,
        seededMatch?.mediaType === 'SHOW' ? mappingSeedSeason : null,
        seededMatch?.mediaType === 'SHOW' ? mappingSeedEpisode : null,
      ));
      setAutoMatched(false);

      if (seededMatch) {
        setCategory(seededMatch.mediaType);
        setQuery(seededMatch.title);
        setResults([seededMatch]);
        setSelected(seededMatch);
      } else {
        setCategory(result.guessedType);
        setQuery(result.guessedTitle);
        setResults(null);
        setSelected(null);
      }

      if (!selectedRequestMatch && !initialSyntheticMatch && result.guessedTitle) {
        try {
          const list = await api.searchTmdb(result.guessedTitle, result.guessedType);
          setResults(list);
          if (list.length > 0) {
            setSelected(list[0]);
            setAutoMatched(true);
          }
        } catch {
          setMatchError(true);
        }
      }
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
    setSelectedRequestId('');
    setAutoMatched(false);
    setMatchError(false);
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
    setResults(null);
    setSelected(null);
    setSelectedRequestId('');
  }

  function pickRequest(requestId: string) {
    setSelectedRequestId(requestId);
    setInitialRequestApplied(true);
    const request = approvedRequests.find((item) => item.id === requestId);
    if (!request) return;

    const syntheticMatch: TmdbSearchResult = {
      tmdbId: request.tmdbId,
      mediaType: request.mediaType,
      title: request.title,
      year: null,
      overview: '',
      posterPath: null,
      backdropPath: null,
      voteAverage: null,
      inLibrary: false,
    };

    setCategory(request.mediaType);
    setQuery(request.title);
    setResults([syntheticMatch]);
    setSelected(syntheticMatch);
    if (request.mediaType === 'SHOW' && parsed && (request.season || request.episode)) {
      setRows(toRows(parsed, request.season, request.episode));
    }
    setAutoMatched(false);
    setMatchError(false);
  }

  function updateRow(index: number, field: 'season' | 'episode', value: string) {
    setRows((prev) =>
      prev.map((r, i) =>
        i === index ? { ...r, [field]: value.replace(/[^0-9]/g, '') } : r,
      ),
    );
  }

  function fillEpisodeSequence() {
    const firstSeason = mappingSeedSeason
      ? String(mappingSeedSeason)
      : rows.find((row) => Number(row.season) > 0)?.season || '1';
    const firstEpisode = Number(rows.find((row) => Number(row.episode) > 0)?.episode) || 1;
    const defaultFirstEpisode = mappingSeedEpisode ?? firstEpisode;
    setRows((prev) =>
      prev.map((row, index) => ({
        ...row,
        season: row.season || firstSeason,
        episode: String(defaultFirstEpisode + index),
      })),
    );
  }

  function restoreFilenameGuesses() {
    if (!parsed) return;
    setRows(toRows(parsed, mappingSeedSeason, mappingSeedEpisode));
  }

  function episodeMatch(row: FileRow): TmdbEpisode | null {
    const season = Number(row.season);
    const episode = Number(row.episode);
    return seasonEpisodes[season]?.find((item) => item.episodeNumber === episode) ?? null;
  }

  async function submit() {
    if (!parsed || !selected) return;
    if (category === 'SHOW' && invalidMappingCount > 0) {
      setError('Every TV file needs a season and episode greater than 0.');
      return;
    }
    if (selectedRequestMappingError) {
      setError(selectedRequestMappingError);
      return;
    }
    if (category === 'SHOW' && duplicateMappingCount > 0) {
      setError('Two or more files are mapped to the same season and episode.');
      return;
    }

    setSubmitting(true);
    setError(null);

    const body: ConfirmTorrentRequest = {
      infoHash: parsed.infoHash,
      category,
      tmdbId: selected.tmdbId,
      title: selected.title,
      year: selected.year,
      requestId: selectedRequestId || undefined,
    };

    if (category === 'SHOW' && rows.length > 0) {
      body.fileMapping = rows.map((r) => ({
        path: r.path,
        season: Number(r.season),
        episode: Number(r.episode),
      }));
    }

    try {
      const linkedRequestId = selectedRequestId;
      const confirmed = await api.confirmTorrent(body);
      if (linkedRequestId && confirmed.linkedRequest?.status !== 'APPROVED') {
        setRequests((prev) => prev.filter((request) => request.id !== linkedRequestId));
      }
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
          {uploading ? 'Parsing...' : parsed ? 'Choose a different file' : 'Choose .torrent file'}
        </label>
        {uploading && <span className="spinner" aria-hidden style={{ width: 22, height: 22 }} />}
        {parsed && !uploading && (
          <button type="button" className="btn btn-ghost" onClick={reset}>
            Cancel
          </button>
        )}
      </div>

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
            {initialMatch && !selectedRequestId && (
              <div>
                <span className="dim">Repair target</span>
                <div>
                  {initialMatch.title}
                  {initialMatch.year ? ` (${initialMatch.year})` : ''}
                  {preferredSeason ? ` - Season ${preferredSeason}` : ''}
                  {preferredEpisode ? ` Episode ${preferredEpisode}` : ''}
                </div>
              </div>
            )}
            <div>
              <span className="dim">Info hash</span>
              <div className="code" style={{ fontSize: '0.72rem' }}>
                {parsed.infoHash}
              </div>
            </div>
          </div>

          {existingDataNote && (
            <div className="existing-data-note" role="status">
              {existingDataNote}
            </div>
          )}

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

          <div className="field">
            <label htmlFor="request-link">Fulfill approved request</label>
            <select
              id="request-link"
              className="input"
              value={selectedRequestId}
              onChange={(e) => pickRequest(e.target.value)}
            >
              <option value="">No linked request</option>
              {approvedRequests.map((request) => (
                <option key={request.id} value={request.id}>
                  {request.mediaType === 'SHOW' ? 'TV' : 'Movie'} - {request.title}
                  {requestTargetLabel(request)}
                  {request.requestedBy ? ` (${request.requestedBy.profileName})` : ''}
                </option>
              ))}
            </select>
            {requestError && (
              <p className="muted" style={{ fontSize: '0.82rem', marginTop: 8 }}>
                {requestError}
              </p>
            )}
            {selectedRequestId && (
              <p className="dim" style={{ fontSize: '0.8rem', marginTop: 8 }}>
                This torrent will move the selected request into downloading.
              </p>
            )}
          </div>

          <div className="field">
            <label htmlFor="tmdb-q">
              Match against TMDb
              {autoMatched && (
                <span className="auto-match-badge" aria-label="Auto-matched">
                  {' '}- auto-matched
                </span>
              )}
            </label>
            <div className="search-row">
              <input
                id="tmdb-q"
                className="input"
                value={query}
                placeholder="Search TMDb..."
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
                {searching ? 'Searching...' : 'Search'}
              </button>
            </div>

            {matchError && (
              <p className="muted" style={{ fontSize: '0.85rem', marginTop: 10 }}>
                Auto-match failed. Search manually above.
              </p>
            )}

            {results && results.length === 0 && !searching && !matchError && (
              <p className="muted" style={{ fontSize: '0.85rem', marginTop: 10 }}>
                No TMDb matches. Refine the search above.
              </p>
            )}

            {results && results.length > 0 && (
              <>
                <ul className="tmdb-results">
                  {results.map((r) => {
                    const active = selected?.tmdbId === r.tmdbId;
                    return (
                      <li key={`${r.mediaType}-${r.tmdbId}`}>
                        <button
                          type="button"
                          className={active ? 'tmdb-result active' : 'tmdb-result'}
                          onClick={() => {
                            setSelected(r);
                            setSelectedRequestId('');
                            setAutoMatched(false);
                          }}
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
                              {r.year ? <span className="dim"> - {r.year}</span> : null}
                            </span>
                            <span className="tmdb-overview">
                              {r.overview || 'No synopsis available.'}
                            </span>
                          </span>
                          {active && <span className="tmdb-check" aria-hidden>OK</span>}
                        </button>
                      </li>
                    );
                  })}
                </ul>
                {autoMatched && selected && (
                  <p className="dim" style={{ fontSize: '0.8rem', marginTop: 6 }}>
                    First result auto-selected. Wrong match? Edit the search query above and click Search.
                  </p>
                )}
              </>
            )}
          </div>

          {category === 'SHOW' && rows.length > 0 && (
            <div className="field">
              <div className="mapping-head">
                <div>
                  <label>Episode mapping</label>
                  <p className="muted" style={{ fontSize: '0.82rem', margin: 0 }}>
                    Match each downloaded file to its real season and episode.
                  </p>
                </div>
                <div className="mapping-tools">
                  {seasonLoading && <span className="dim">Loading TMDb episodes...</span>}
                  {seasonError && <span className="mapping-warn">{seasonError}</span>}
                  {invalidMappingCount > 0 && (
                    <span className="mapping-warn">{invalidMappingCount} missing</span>
                  )}
                  {episodeOverflowCount > 0 && (
                    <span className="mapping-warn">{episodeOverflowCount} beyond season count</span>
                  )}
                  {duplicateMappingCount > 0 && (
                    <span className="mapping-warn">{duplicateMappingCount} duplicate</span>
                  )}
                  {selectedRequestMappingError && (
                    <span className="mapping-warn">{selectedRequestMappingError}</span>
                  )}
                  <button type="button" className="btn btn-ghost btn-sm" onClick={restoreFilenameGuesses}>
                    Use filename guesses
                  </button>
                  <button type="button" className="btn btn-ghost btn-sm" onClick={fillEpisodeSequence}>
                    Fill sequence
                  </button>
                </div>
              </div>
              <div className="table-wrap">
                <table className="data mapping-table">
                  <thead>
                    <tr>
                      <th>File</th>
                      <th style={{ width: 90 }}>Season</th>
                      <th style={{ width: 90 }}>Episode</th>
                      <th>TMDb episode</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row, i) => {
                      const match = episodeMatch(row);
                      const season = Number(row.season);
                      const episode = Number(row.episode);
                      const knownEpisodes = seasonEpisodes[season];
                      const isInvalid = season <= 0 || episode <= 0;
                      const isOverflow = Boolean(knownEpisodes && episode > knownEpisodes.length);
                      const isDuplicate = !isInvalid && rows.some(
                        (other, otherIndex) =>
                          otherIndex !== i &&
                          Number(other.season) === season &&
                          Number(other.episode) === episode,
                      );

                      return (
                        <tr
                          key={row.path}
                          className={isInvalid || isOverflow || isDuplicate ? 'mapping-row-warn' : undefined}
                        >
                          <td className="mapping-path" title={row.path}>
                            {row.path}
                          </td>
                          <td>
                            <input
                              className="input mapping-input"
                              inputMode="numeric"
                              value={row.season}
                              aria-label={`Season for ${row.path}`}
                              onChange={(e) => updateRow(i, 'season', e.target.value)}
                            />
                          </td>
                          <td>
                            <input
                              className="input mapping-input"
                              inputMode="numeric"
                              value={row.episode}
                              aria-label={`Episode for ${row.path}`}
                              onChange={(e) => updateRow(i, 'episode', e.target.value)}
                            />
                          </td>
                          <td className="mapping-episode">
                            {isInvalid ? (
                              <span className="mapping-warn">Needs S/E</span>
                            ) : isDuplicate ? (
                              <span className="mapping-warn">Duplicate S{season} E{episode}</span>
                            ) : match ? (
                              <>
                                <strong>{match.name ?? `Episode ${episode}`}</strong>
                                <span>
                                  S{season} E{episode}
                                  {match.runtime ? ` - ${match.runtime}m` : ''}
                                  {match.airDate ? ` - ${match.airDate}` : ''}
                                </span>
                              </>
                            ) : isOverflow && knownEpisodes ? (
                              <span className="mapping-warn">
                                Season {season} only has {knownEpisodes.length} episodes
                              </span>
                            ) : seasonLoading ? (
                              <span className="dim">Checking...</span>
                            ) : (
                              <span className="dim">No TMDb match loaded</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
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
              disabled={!canSubmit}
            >
              {submitting ? 'Starting...' : confirmLabel}
            </button>
          </div>
          {!selected && (
            <p className="dim" style={{ fontSize: '0.8rem', marginTop: 8 }}>
              Select a TMDb match to enable download.
            </p>
          )}
          {selected && category === 'SHOW' && invalidMappingCount > 0 && (
            <p className="dim" style={{ fontSize: '0.8rem', marginTop: 8 }}>
              Complete every season and episode field before starting the download.
            </p>
          )}
          {selected && selectedRequestMappingError && (
            <p className="dim" style={{ fontSize: '0.8rem', marginTop: 8 }}>
              {selectedRequestMappingError}
            </p>
          )}
        </div>
      )}
    </section>
  );
}
