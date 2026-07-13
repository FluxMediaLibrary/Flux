'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import type {
  AdminLibraryAcquisitionTargetDTO,
  AdminLibraryHealthDTO,
  AdminLibraryEpisodeDTO,
  AdminLibraryItemDTO,
  AdminLibraryRequestDTO,
  AdminLibrarySeasonDTO,
  MediaType,
} from '@flux/shared';
import { api, FluxApiError } from '@/lib/api';

const TMDB_POSTER = 'https://image.tmdb.org/t/p/w92';

type TypeFilter = 'ALL' | MediaType;
type IssueFilter = 'ALL' | 'ISSUES' | 'MISSING_FILES' | 'MISSING_ANALYSIS';
type RepairTarget = AdminLibraryAcquisitionTargetDTO & {
  item: AdminLibraryItemDTO;
  href: string;
};

const TYPE_LABEL: Record<TypeFilter, string> = {
  ALL: 'All',
  MOVIE: 'Movies',
  SHOW: 'Shows',
};

const ISSUE_LABEL: Record<IssueFilter, string> = {
  ALL: 'Everything',
  ISSUES: 'Needs work',
  MISSING_FILES: 'Missing files',
  MISSING_ANALYSIS: 'Missing analysis',
};

function parseTypeFilter(value: string | null): TypeFilter {
  return value === 'MOVIE' || value === 'SHOW' ? value : 'ALL';
}

function parseIssueFilter(value: string | null): IssueFilter {
  if (
    value === 'ALL' ||
    value === 'ISSUES' ||
    value === 'MISSING_FILES' ||
    value === 'MISSING_ANALYSIS'
  ) {
    return value;
  }
  return 'ISSUES';
}

function parseTmdbFocus(value: string | null): number | null {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function formatDate(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleDateString();
}

function formatEpisodeNumbers(numbers: number[]): string {
  if (numbers.length === 0) return '';
  const shown = numbers.slice(0, 8).map((episode) => `E${episode}`).join(', ');
  return numbers.length > 8 ? `${shown}, +${numbers.length - 8}` : shown;
}

function hasMissingFiles(item: AdminLibraryItemDTO): boolean {
  return item.type === 'MOVIE'
    ? !item.available || item.fileExists === false
    : item.missingEpisodes > 0 || item.brokenEpisodes > 0;
}

function hasMissingAnalysis(item: AdminLibraryItemDTO): boolean {
  return item.type === 'MOVIE' ? item.available && !item.analyzed : item.unanalyzedEpisodes > 0;
}

function itemMatchesIssue(item: AdminLibraryItemDTO, filter: IssueFilter): boolean {
  if (filter === 'ALL') return true;
  if (filter === 'ISSUES') return item.issues.length > 0;
  if (filter === 'MISSING_FILES') return hasMissingFiles(item);
  return hasMissingAnalysis(item);
}

function issueTone(item: AdminLibraryItemDTO): 'ok' | 'warn' | 'bad' {
  if (hasMissingFiles(item)) return 'bad';
  if (hasMissingAnalysis(item) || item.issues.length > 0) return 'warn';
  return 'ok';
}

function episodeStatusText(episode: AdminLibraryEpisodeDTO): string {
  if (!episode.available) return 'Missing file';
  if (episode.fileExists === false) return 'Broken file';
  if (!episode.analyzed) return 'Needs analysis';
  return 'Ready';
}

function requestMatchesTarget(
  request: AdminLibraryRequestDTO,
  season?: number,
  episode?: number,
): boolean {
  if (!season) return request.season == null;
  if (request.season != null && request.season !== season) return false;
  if (!episode) return request.episode == null || request.season === season;
  return request.episode == null || request.episode === episode;
}

function requestTargetText(request: AdminLibraryRequestDTO): string {
  if (!request.season) return request.status;
  return `${request.status} S${request.season}${request.episode ? ` E${request.episode}` : ''}`;
}

function torrentPrefillHref(
  item: AdminLibraryItemDTO,
  season?: number,
  episode?: number,
  requestId?: string,
): string {
  const params = new URLSearchParams({
    tmdbId: String(item.tmdbId),
    type: item.type,
    title: item.title,
  });
  if (item.year) params.set('year', String(item.year));
  if (item.type === 'SHOW' && season && season > 0) params.set('season', String(season));
  if (item.type === 'SHOW' && season && season > 0 && episode && episode > 0) {
    params.set('episode', String(episode));
  }
  if (requestId) params.set('request', requestId);
  return `/admin/torrents?${params.toString()}`;
}

function buildRepairTargets(items: AdminLibraryItemDTO[]): RepairTarget[] {
  const targets = items.flatMap((item) =>
    item.acquisitionTargets.map((target): RepairTarget => ({
      ...target,
      item,
      href: torrentPrefillHref(
        item,
        target.season ?? undefined,
        target.episode ?? undefined,
        target.requestId ?? undefined,
      ),
    })),
  );

  return targets
    .sort((a, b) => b.priority - a.priority || a.item.title.localeCompare(b.item.title))
    .slice(0, 8);
}

export default function AdminLibraryPage() {
  const searchParams = useSearchParams();
  const queryTypeFilter = parseTypeFilter(searchParams.get('type'));
  const queryIssueFilter = parseIssueFilter(searchParams.get('issue'));
  const queryTmdbFocus = parseTmdbFocus(searchParams.get('tmdbId'));
  const [data, setData] = useState<AdminLibraryHealthDTO | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [typeFilter, setTypeFilter] = useState<TypeFilter>(queryTypeFilter);
  const [issueFilter, setIssueFilter] = useState<IssueFilter>(queryIssueFilter);
  const [tmdbFocus, setTmdbFocus] = useState<number | null>(queryTmdbFocus);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [syncingTarget, setSyncingTarget] = useState<string | null>(null);
  const [analyzingId, setAnalyzingId] = useState<string | null>(null);
  const [clearingTarget, setClearingTarget] = useState<string | null>(null);
  const [bulkAction, setBulkAction] = useState<'sync' | 'analyze' | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      setData(await api.getAdminLibrary());
    } catch (err) {
      setError(
        err instanceof FluxApiError ? err.message : 'Failed to load library health.',
      );
      setData((prev) => prev ?? { summary: emptySummary, items: [] });
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    setTypeFilter(queryTypeFilter);
    setIssueFilter(queryIssueFilter);
    setTmdbFocus(queryTmdbFocus);
  }, [queryIssueFilter, queryTmdbFocus, queryTypeFilter]);

  const filtered = useMemo(
    () =>
      (data?.items ?? []).filter((item) => {
        if (tmdbFocus !== null && item.tmdbId !== tmdbFocus) return false;
        if (typeFilter !== 'ALL' && item.type !== typeFilter) return false;
        return itemMatchesIssue(item, issueFilter);
      }),
    [data, issueFilter, tmdbFocus, typeFilter],
  );
  const focusedItem = useMemo(
    () => (tmdbFocus === null ? null : (data?.items ?? []).find((item) => item.tmdbId === tmdbFocus) ?? null),
    [data, tmdbFocus],
  );
  const repairTargets = useMemo(
    () => buildRepairTargets(data?.items ?? []),
    [data],
  );

  function toggleExpanded(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function syncEpisodes(item: AdminLibraryItemDTO, season?: number) {
    setSyncingTarget(season ? `${item.id}:s${season}` : item.id);
    setNotice(null);
    setError(null);
    try {
      const result = await api.syncAdminShowEpisodes(item.id, season);
      setNotice(
        `Synced ${result.episodes.toLocaleString()} episodes for ${item.title}` +
          (season ? ` season ${season}` : '') +
          ` (${result.created.toLocaleString()} new).`,
      );
      await load();
    } catch (err) {
      setError(
        err instanceof FluxApiError ? err.message : 'Failed to sync episodes.',
      );
    } finally {
      setSyncingTarget(null);
    }
  }

  async function analyzeMedia(item: AdminLibraryItemDTO) {
    setAnalyzingId(item.id);
    setNotice(null);
    setError(null);
    try {
      const result = await api.analyzeAdminMedia(item.id);
      setNotice(
        `Analyzed ${result.analyzed.toLocaleString()} file${result.analyzed === 1 ? '' : 's'} for ${item.title}.` +
          (result.skipped > 0 ? ` ${result.skipped.toLocaleString()} skipped.` : '') +
          (result.failed > 0 ? ` ${result.failed.toLocaleString()} failed.` : ''),
      );
      await load();
    } catch (err) {
      setError(
        err instanceof FluxApiError ? err.message : 'Failed to analyze media.',
      );
    } finally {
      setAnalyzingId(null);
    }
  }

  async function clearMissingFile(item: AdminLibraryItemDTO, episode?: AdminLibraryEpisodeDTO) {
    const targetKey = episode ? `episode:${episode.id}` : `item:${item.id}`;
    setClearingTarget(targetKey);
    setNotice(null);
    setError(null);
    try {
      const result = episode
        ? await api.clearMissingAdminEpisodeFile(episode.id)
        : await api.clearMissingAdminMovieFile(item.id);
      setNotice(
        result.cleared
          ? `Cleared stale file path for ${episode ? `S${episode.season} E${episode.episode}` : item.title}.`
          : `No stale file path needed clearing for ${episode ? `S${episode.season} E${episode.episode}` : item.title}.`,
      );
      await load();
    } catch (err) {
      setError(
        err instanceof FluxApiError ? err.message : 'Failed to clear stale file path.',
      );
    } finally {
      setClearingTarget(null);
    }
  }

  async function syncAllEpisodes() {
    setBulkAction('sync');
    setNotice(null);
    setError(null);
    try {
      const result = await api.syncAllAdminShowEpisodes();
      setNotice(
        `Synced ${result.episodes.toLocaleString()} episodes across ${result.shows.toLocaleString()} show${result.shows === 1 ? '' : 's'} ` +
          `(${result.created.toLocaleString()} new, ${result.updated.toLocaleString()} updated).` +
          (result.failed > 0 ? ` ${result.failed.toLocaleString()} failed.` : ''),
      );
      await load();
    } catch (err) {
      setError(
        err instanceof FluxApiError ? err.message : 'Failed to sync show episodes.',
      );
    } finally {
      setBulkAction(null);
    }
  }

  async function analyzeMissingMedia() {
    setBulkAction('analyze');
    setNotice(null);
    setError(null);
    try {
      const result = await api.analyzeMissingAdminMedia();
      setNotice(
        `Analyzed ${result.analyzed.toLocaleString()} missing file${result.analyzed === 1 ? '' : 's'} across ${result.items.toLocaleString()} title${result.items === 1 ? '' : 's'}.` +
          (result.skipped > 0 ? ` ${result.skipped.toLocaleString()} skipped.` : '') +
          (result.failed > 0 ? ` ${result.failed.toLocaleString()} failed.` : ''),
      );
      await load();
    } catch (err) {
      setError(
        err instanceof FluxApiError ? err.message : 'Failed to analyze missing media.',
      );
    } finally {
      setBulkAction(null);
    }
  }

  return (
    <div className="admin-library">
      <div className="section-head">
        <div>
          <h1>Library</h1>
          <p className="muted" style={{ margin: 0 }}>
            File availability, episode coverage, and media analysis state.
          </p>
        </div>
        <div className="admin-library-head-actions">
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() => void syncAllEpisodes()}
            disabled={bulkAction !== null}
          >
            {bulkAction === 'sync' ? 'Syncing...' : 'Sync all episodes'}
          </button>
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() => void analyzeMissingMedia()}
            disabled={bulkAction !== null}
          >
            {bulkAction === 'analyze' ? 'Analyzing...' : 'Analyze missing'}
          </button>
          <button type="button" className="btn btn-ghost" onClick={() => void load()} disabled={bulkAction !== null}>
            Refresh
          </button>
        </div>
      </div>

      {error && <div className="form-error">{error}</div>}
      {notice && <div className="admin-notice">{notice}</div>}

      {data === null ? (
        <div className="empty">
          <div className="spinner" style={{ margin: '0 auto 12px' }} aria-hidden />
          Loading library health...
        </div>
      ) : (
        <>
          <div className="admin-health-grid">
            <HealthStat label="Items" value={data.summary.items} />
            <HealthStat label="Available" value={data.summary.availableItems} tone="ok" />
            <HealthStat label="Broken files" value={data.summary.brokenFiles} tone={data.summary.brokenFiles > 0 ? 'bad' : 'ok'} />
            <HealthStat label="Missing files" value={data.summary.missingFiles + data.summary.unavailableEpisodes} tone={data.summary.missingFiles + data.summary.unavailableEpisodes > 0 ? 'bad' : 'ok'} />
            <HealthStat label="Missing analysis" value={data.summary.missingAnalysis} tone={data.summary.missingAnalysis > 0 ? 'warn' : 'ok'} />
          </div>

          <RepairQueue
            targets={repairTargets}
            syncingTarget={syncingTarget}
            onSync={(item, season) => void syncEpisodes(item, season)}
          />

          <div className="admin-filter-row">
            <div className="toggle-group">
              {(['ALL', 'MOVIE', 'SHOW'] as const).map((option) => (
                <button
                  key={option}
                  type="button"
                  className={typeFilter === option ? 'toggle active' : 'toggle'}
                  onClick={() => setTypeFilter(option)}
                >
                  {TYPE_LABEL[option]}
                </button>
              ))}
            </div>
            <div className="toggle-group">
              {(['ALL', 'ISSUES', 'MISSING_FILES', 'MISSING_ANALYSIS'] as const).map((option) => (
                <button
                  key={option}
                  type="button"
                  className={issueFilter === option ? 'toggle active' : 'toggle'}
                  onClick={() => setIssueFilter(option)}
                >
                  {ISSUE_LABEL[option]}
                </button>
              ))}
            </div>
            {tmdbFocus !== null && (
              <button
                type="button"
                className="toggle active"
                onClick={() => setTmdbFocus(null)}
                title={focusedItem ? `Focused on ${focusedItem.title}` : 'Focused on one TMDb title'}
              >
                {focusedItem ? focusedItem.title : `TMDb ${tmdbFocus}`} x
              </button>
            )}
            <span className="dim admin-filter-count">{filtered.length} shown</span>
          </div>

          {filtered.length === 0 ? (
            <div className="card empty">No titles match the current filters.</div>
          ) : (
            <div className="admin-library-list">
              {filtered.map((item) => (
                <LibraryHealthRow
                  key={item.id}
                  item={item}
                  expanded={expanded.has(item.id)}
                  syncingTarget={syncingTarget}
                  analyzing={analyzingId === item.id}
                  clearingTarget={clearingTarget}
                  onToggle={() => toggleExpanded(item.id)}
                  onSync={(season) => void syncEpisodes(item, season)}
                  onAnalyze={() => void analyzeMedia(item)}
                  onClearMissing={(episode) => void clearMissingFile(item, episode)}
                />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function RepairQueue({
  targets,
  syncingTarget,
  onSync,
}: {
  targets: RepairTarget[];
  syncingTarget: string | null;
  onSync: (item: AdminLibraryItemDTO, season?: number) => void;
}) {
  if (targets.length === 0) {
    return (
      <section className="admin-repair-queue is-empty" aria-label="Acquisition repair queue">
        <div>
          <span className="dim">Repair queue</span>
          <strong>No missing acquisition targets</strong>
        </div>
      </section>
    );
  }

  return (
    <section className="admin-repair-queue" aria-label="Acquisition repair queue">
      <div className="admin-repair-head">
        <div>
          <span className="dim">Repair queue</span>
          <strong>{targets.length} acquisition target{targets.length === 1 ? '' : 's'}</strong>
        </div>
      </div>
      <div className="admin-repair-list">
        {targets.map((target) => {
          const canSync = target.item.type === 'SHOW' && target.syncSeason !== undefined;
          const targetSyncKey = target.syncSeason ? `${target.item.id}:s${target.syncSeason}` : target.item.id;
          const syncing = canSync && syncingTarget === targetSyncKey;
          return (
            <div key={target.key} className={`admin-repair-item tone-${target.tone}`}>
              <span className="admin-repair-title">
                {target.item.title}
                {target.item.year ? <em>{target.item.year}</em> : null}
              </span>
              <span className="admin-repair-meta">
                <strong>{target.label}</strong>
                <span>{target.detail}</span>
              </span>
              <span className="admin-repair-actions">
                {canSync && (
                  <button
                    type="button"
                    className="admin-repair-cta"
                    onClick={() => onSync(target.item, target.syncSeason ?? undefined)}
                    disabled={syncing}
                  >
                    {syncing ? 'Syncing' : target.syncSeason ? 'Sync season' : 'Sync episodes'}
                  </button>
                )}
                <a className="admin-repair-cta" href={target.href}>
                  Add torrent
                </a>
              </span>
            </div>
          );
        })}
      </div>
    </section>
  );
}

const emptySummary: AdminLibraryHealthDTO['summary'] = {
  items: 0,
  movies: 0,
  shows: 0,
  availableItems: 0,
  missingFiles: 0,
  missingAnalysis: 0,
  brokenFiles: 0,
  unavailableEpisodes: 0,
};

function HealthStat({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone?: 'ok' | 'warn' | 'bad';
}) {
  const color =
    tone === 'ok'
      ? 'var(--ok)'
      : tone === 'warn'
        ? 'var(--warn)'
        : tone === 'bad'
          ? 'var(--danger)'
          : undefined;

  return (
    <div className="card admin-health-stat">
      <span>{label}</span>
      <strong style={{ color }}>{value.toLocaleString()}</strong>
    </div>
  );
}

function LibraryHealthRow({
  item,
  expanded,
  syncingTarget,
  analyzing,
  clearingTarget,
  onToggle,
  onSync,
  onAnalyze,
  onClearMissing,
}: {
  item: AdminLibraryItemDTO;
  expanded: boolean;
  syncingTarget: string | null;
  analyzing: boolean;
  clearingTarget: string | null;
  onToggle: () => void;
  onSync: (season?: number) => void;
  onAnalyze: () => void;
  onClearMissing: (episode?: AdminLibraryEpisodeDTO) => void;
}) {
  const tone = issueTone(item);
  const issues = item.issues.length > 0 ? item.issues : ['Healthy'];
  const posterUrl = item.posterPath ? `${TMDB_POSTER}${item.posterPath}` : null;

  return (
    <article className={`admin-library-row tone-${tone}`}>
      <div className="admin-library-main">
        <div className="admin-library-poster">
          {posterUrl ? <img src={posterUrl} alt="" /> : <span>{item.type === 'SHOW' ? 'TV' : 'MOV'}</span>}
        </div>
        <div className="admin-library-title">
          <div>
            <span className="pill cat">{item.type === 'SHOW' ? 'TV' : 'Movie'}</span>
            <h2>{item.title}</h2>
          </div>
          <p>
            {item.year ?? 'No year'} - Added {formatDate(item.addedAt)}
          </p>
          <div className="admin-library-issues">
            {issues.map((issue) => (
              <span key={issue}>{issue}</span>
            ))}
          </div>
        </div>
        <div className="admin-library-metrics">
          {item.type === 'SHOW' ? (
            <>
              <Metric
                label="Episodes"
                value={`${item.availableEpisodes}/${item.expectedEpisodes ?? item.episodeCount}`}
              />
              <Metric label="Missing" value={String(item.missingEpisodes)} bad={item.missingEpisodes > 0} />
              <Metric label="Unanalyzed" value={String(item.unanalyzedEpisodes)} warn={item.unanalyzedEpisodes > 0} />
              <Metric label="Requests" value={String(item.requests.length)} warn={item.requests.length > 0} />
            </>
          ) : (
            <>
              <Metric label="File" value={item.fileExists === false ? 'Broken' : item.available ? 'Ready' : 'Missing'} bad={!item.available || item.fileExists === false} />
              <Metric label="Analysis" value={item.analyzed ? 'Ready' : 'Missing'} warn={!item.analyzed && item.available} />
              <Metric label="Requests" value={String(item.requests.length)} warn={item.requests.length > 0} />
            </>
          )}
        </div>
        <div className="admin-library-actions">
          <a
            className="btn btn-primary btn-sm"
            href={torrentPrefillHref(item)}
          >
            Add torrent
          </a>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={onAnalyze}
            disabled={analyzing}
          >
            {analyzing ? 'Analyzing...' : 'Analyze'}
          </button>
          {item.type === 'MOVIE' && item.fileExists === false && (
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => onClearMissing()}
              disabled={clearingTarget === `item:${item.id}`}
            >
              {clearingTarget === `item:${item.id}` ? 'Clearing...' : 'Clear stale path'}
            </button>
          )}
          {item.type === 'SHOW' && (
            <>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => onSync()}
              disabled={syncingTarget === item.id}
            >
              {syncingTarget === item.id ? 'Syncing...' : 'Sync episodes'}
            </button>
            {(item.episodes?.length ?? 0) > 0 && (
              <button type="button" className="btn btn-ghost btn-sm" onClick={onToggle}>
                {expanded ? 'Hide episodes' : 'Episodes'}
              </button>
            )}
            </>
          )}
        </div>
      </div>

      {item.type === 'SHOW' && item.seasons && item.seasons.length > 0 && (
        <div className="admin-season-strip">
          {item.seasons.map((season) => {
            const bad = season.missingEpisodes > 0 || season.brokenEpisodes > 0;
            const warn = !bad && season.unanalyzedEpisodes > 0;
            const syncingSeason = syncingTarget === `${item.id}:s${season.season}`;
            return (
              <div
                key={season.season}
                className={`admin-season-pill${bad ? ' bad' : warn ? ' warn' : ''}`}
                title={[
                  `${season.syncedEpisodes} synced`,
                  `${season.availableEpisodes} available`,
                  season.missingEpisodes > 0 ? `${season.missingEpisodes} missing` : null,
                  season.missingEpisodeNumbers.length > 0
                    ? `Missing ${formatEpisodeNumbers(season.missingEpisodeNumbers)}`
                    : null,
                  season.brokenEpisodes > 0 ? `${season.brokenEpisodes} broken` : null,
                  season.brokenEpisodeNumbers.length > 0
                    ? `Broken ${formatEpisodeNumbers(season.brokenEpisodeNumbers)}`
                    : null,
                  season.unanalyzedEpisodes > 0 ? `${season.unanalyzedEpisodes} unanalyzed` : null,
                ].filter(Boolean).join(' - ')}
              >
                <strong>S{season.season}</strong>
                <span>
                  {season.availableEpisodes}/{season.expectedEpisodes ?? season.syncedEpisodes}
                </span>
                {bad && (
                  <a
                    className="admin-season-action"
                    href={torrentPrefillHref(item, season.season)}
                    aria-label={`Add torrent for ${item.title} season ${season.season}`}
                  >
                    Add
                  </a>
                )}
                {(bad || warn) && (
                  <button
                    type="button"
                    className="admin-season-action"
                    onClick={() => onSync(season.season)}
                    disabled={syncingSeason}
                  >
                    {syncingSeason ? 'Syncing' : 'Sync'}
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}

      {expanded && item.episodes && (
        <div className="admin-episode-grid">
          {item.episodes.map((episode) => {
            const missing = !episode.available || episode.fileExists === false;
            const syncingSeason = syncingTarget === `${item.id}:s${episode.season}`;
            const status = episodeStatusText(episode);
            const matchingRequests = item.requests.filter((request) =>
              requestMatchesTarget(request, episode.season, episode.episode),
            );
            return (
              <div
                key={episode.id}
                className={`admin-episode-chip${missing ? ' bad' : !episode.analyzed ? ' warn' : ''}`}
              >
                <strong>S{episode.season} E{episode.episode}</strong>
                <span>{episode.title ?? 'Untitled episode'}</span>
                <small>
                  {status}
                  {episode.runtime ? ` - ${episode.runtime} min` : ''}
                </small>
                {episode.filePath && (
                  <code className="admin-episode-path" title={episode.filePath}>
                    {episode.filePath}
                  </code>
                )}
                {episode.overview && (
                  <p className="admin-episode-overview">{episode.overview}</p>
                )}
                {matchingRequests.length > 0 && (
                  <div className="admin-episode-requests">
                    {matchingRequests.slice(0, 3).map((request) => (
                      <span key={request.id} title={request.requestedBy?.accountEmail ?? undefined}>
                        {requestTargetText(request)}
                        {request.requestedBy ? ` - ${request.requestedBy.profileName}` : ''}
                      </span>
                    ))}
                    {matchingRequests.length > 3 && (
                      <span>+{matchingRequests.length - 3} more</span>
                    )}
                  </div>
                )}
                {(missing || !episode.analyzed) && (
                  <div className="admin-episode-actions">
                    {missing ? (
                      <>
                        <button
                          type="button"
                          className="admin-episode-action"
                          onClick={() => onSync(episode.season)}
                          disabled={syncingSeason}
                        >
                          {syncingSeason ? 'Syncing' : 'Sync season'}
                        </button>
                        <a
                          className="admin-episode-action"
                          href={torrentPrefillHref(item, episode.season, episode.episode)}
                        >
                          Add torrent
                        </a>
                        {episode.fileExists === false && (
                          <button
                            type="button"
                            className="admin-episode-action"
                            onClick={() => onClearMissing(episode)}
                            disabled={clearingTarget === `episode:${episode.id}`}
                          >
                            {clearingTarget === `episode:${episode.id}` ? 'Clearing' : 'Clear stale path'}
                          </button>
                        )}
                      </>
                    ) : (
                      <button
                        type="button"
                        className="admin-episode-action"
                        onClick={onAnalyze}
                        disabled={analyzing}
                      >
                        {analyzing ? 'Analyzing' : 'Analyze'}
                      </button>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </article>
  );
}

function Metric({
  label,
  value,
  bad,
  warn,
}: {
  label: string;
  value: string;
  bad?: boolean;
  warn?: boolean;
}) {
  return (
    <div className="admin-library-metric">
      <span>{label}</span>
      <strong className={bad ? 'bad' : warn ? 'warn' : undefined}>{value}</strong>
    </div>
  );
}
