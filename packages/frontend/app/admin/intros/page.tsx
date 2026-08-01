'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import type {
  AdminIntroDashboardDTO,
  AdminIntroScanJobDTO,
  AdminIntroScanJobState,
  AdminIntroSeasonDTO,
} from '@flux/shared';
import { api, FluxApiError } from '@/lib/api';
import { LoadingState, PageError, PageHeader, StatusBadge } from '@/components/admin/AdminUI';

function seasonKey(season: Pick<AdminIntroSeasonDTO, 'mediaItemId' | 'season'>): string {
  return `${season.mediaItemId}:${season.season}`;
}

function statusTone(state: AdminIntroScanJobState): 'good' | 'warn' | 'bad' | 'info' | 'neutral' {
  if (state === 'COMPLETED') return 'good';
  if (state === 'FAILED') return 'bad';
  if (state === 'ACTIVE') return 'info';
  if (state === 'WAITING' || state === 'DELAYED') return 'warn';
  return 'neutral';
}

function formatDate(value: string | null): string {
  if (!value) return 'Not started';
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(value));
}

function resultLabel(job: AdminIntroScanJobDTO): string {
  if (job.state === 'FAILED') return job.failedReason ?? 'The scan failed';
  if (!job.result) return job.progress.message;
  if (job.result.outcome === 'MATCHED') return `${job.result.matched} intro marker${job.result.matched === 1 ? '' : 's'} stored`;
  if (job.result.outcome === 'NO_MATCH') return 'No repeated intro met the detection threshold';
  if (job.result.outcome === 'DISABLED') return 'Detection is disabled on this server';
  return 'Skipped because there were not enough comparable episodes';
}

export default function AdminIntrosPage() {
  const [dashboard, setDashboard] = useState<AdminIntroDashboardDTO | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);
  const [jobDetail, setJobDetail] = useState<AdminIntroScanJobDTO | null>(null);
  const [query, setQuery] = useState('');
  const [force, setForce] = useState(false);
  const [queueing, setQueueing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async (quiet = false) => {
    if (!quiet) setError(null);
    try {
      const next = await api.getAdminIntros();
      setDashboard(next);
      setSelected((current) => {
        const valid = new Set(next.seasons.map(seasonKey));
        return new Set([...current].filter((key) => valid.has(key)));
      });
      setSelectedJobId((current) => current ?? next.jobs.find((job) => job.state === 'ACTIVE')?.id ?? next.jobs[0]?.id ?? null);
    } catch (err) {
      if (!quiet) setError(err instanceof FluxApiError ? err.message : 'Intro diagnostics could not be loaded.');
    }
  }, []);

  const loadJob = useCallback(async (jobId: string, quiet = false) => {
    try {
      setJobDetail(await api.getAdminIntroJob(jobId));
    } catch (err) {
      if (!quiet) setError(err instanceof FluxApiError ? err.message : 'The intro scan log could not be loaded.');
    }
  }, []);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    const timer = window.setInterval(() => void load(true), 3000);
    return () => window.clearInterval(timer);
  }, [load]);
  useEffect(() => {
    if (!selectedJobId) {
      setJobDetail(null);
      return;
    }
    void loadJob(selectedJobId);
    const timer = window.setInterval(() => void loadJob(selectedJobId, true), 1800);
    return () => window.clearInterval(timer);
  }, [loadJob, selectedJobId]);

  const visibleSeasons = useMemo(() => {
    if (!dashboard) return [];
    const needle = query.trim().toLowerCase();
    if (!needle) return dashboard.seasons;
    return dashboard.seasons.filter((season) => (
      season.title.toLowerCase().includes(needle) || `s${season.season}`.includes(needle)
    ));
  }, [dashboard, query]);
  const selectedJob = jobDetail?.id === selectedJobId
    ? jobDetail
    : dashboard?.jobs.find((job) => job.id === selectedJobId) ?? null;

  async function startQueue() {
    if (!dashboard || selected.size === 0) return;
    const targets = dashboard.seasons
      .filter((season) => selected.has(seasonKey(season)))
      .map((season) => ({ mediaItemId: season.mediaItemId, season: season.season }));
    setQueueing(true);
    setError(null);
    setNotice(null);
    try {
      const result = await api.queueAdminIntroScans({ targets, force });
      const freshJobs = result.jobs.filter((job) => !job.deduplicated).length;
      const reusedJobs = result.jobs.length - freshJobs;
      setNotice(
        `${freshJobs} scan${freshJobs === 1 ? '' : 's'} added to the queue` +
        (reusedJobs > 0 ? `; ${reusedJobs} already running.` : '.'),
      );
      setSelectedJobId(result.jobs[0]?.jobId ?? null);
      setSelected(new Set());
      await load(true);
    } catch (err) {
      setError(err instanceof FluxApiError ? err.message : 'The intro scan queue could not be started.');
    } finally {
      setQueueing(false);
    }
  }

  if (!dashboard && !error) return <div className="control-page"><LoadingState cards={6} /></div>;

  return (
    <div className="control-page intro-workbench">
      <PageHeader
        kicker="Media analysis"
        title="Intro scanner"
        description="Queue season fingerprint scans, watch every stage, and verify the markers that power Skip Intro."
        actions={
          <>
            <button className="control-button" type="button" onClick={() => void load()} disabled={queueing}>Refresh</button>
            <button className="control-button primary" type="button" onClick={() => void startQueue()} disabled={queueing || selected.size === 0 || !dashboard?.enabled}>
              {queueing ? 'Starting…' : `Start queue${selected.size > 0 ? ` (${selected.size})` : ''}`}
            </button>
          </>
        }
      />
      {error && <PageError message={error} onRetry={() => void load()} />}
      {notice && <div className="intro-notice" role="status">{notice}</div>}
      {dashboard && !dashboard.enabled && <div className="control-error" role="alert"><span>Intro detection is disabled. Set INTRO_DETECTION_ENABLED=true on the backend before starting scans.</span></div>}

      {dashboard && (
        <>
          <div className="control-stat-grid intro-stat-grid">
            <IntroStat label="Shows" value={dashboard.summary.shows} detail={`${dashboard.summary.seasons} seasons`} />
            <IntroStat label="Available episodes" value={dashboard.summary.availableEpisodes} detail="Files ready to compare" />
            <IntroStat label="Marked episodes" value={dashboard.summary.markedEpisodes} detail={`${Math.round((dashboard.summary.markedEpisodes / Math.max(1, dashboard.summary.availableEpisodes)) * 100)}% coverage`} tone="good" />
            <IntroStat label="Queued" value={dashboard.summary.queued} detail="Waiting for worker" tone={dashboard.summary.queued ? 'warn' : undefined} />
            <IntroStat label="Active" value={dashboard.summary.active} detail="Fingerprinting now" tone={dashboard.summary.active ? 'good' : undefined} />
            <IntroStat label="Failed" value={dashboard.summary.failed} detail="Retained for debugging" tone={dashboard.summary.failed ? 'bad' : undefined} />
          </div>

          <div className="intro-config-strip">
            <span>Window <strong>{dashboard.configuration.windowMinutes} min</strong></span>
            <span>Minimum length <strong>{dashboard.configuration.minimumSeconds}s</strong></span>
            <span>Confidence <strong>{Math.round(dashboard.configuration.minimumConfidence * 100)}%</strong></span>
            <span>Season coverage <strong>{Math.round(dashboard.configuration.minimumCoverage * 100)}%</strong></span>
          </div>

          <div className="intro-layout">
            <section className="control-panel intro-catalog" aria-label="Shows and seasons">
              <header className="intro-panel-header">
                <div><h2>Season queue</h2><p>Select one or more seasons to analyze.</p></div>
                <span>{selected.size} selected</span>
              </header>
              <div className="intro-toolbar">
                <input className="control-input" type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Filter shows or seasons" aria-label="Filter shows and seasons" />
                <button className="control-button" type="button" onClick={() => setSelected(new Set(visibleSeasons.map(seasonKey)))}>Select shown</button>
                <button className="control-button" type="button" onClick={() => setSelected(new Set(visibleSeasons.filter((season) => season.coverage < 1).map(seasonKey)))}>Select incomplete</button>
                <button className="control-button" type="button" onClick={() => setSelected(new Set())} disabled={selected.size === 0}>Clear</button>
              </div>
              <label className="intro-force-toggle">
                <input type="checkbox" checked={force} onChange={(event) => setForce(event.target.checked)} />
                <span><strong>Overwrite manual markers</strong><small>Use only when intentionally replacing admin-authored timings.</small></span>
              </label>
              <div className="intro-season-list">
                {visibleSeasons.length === 0 ? <div className="control-empty">No seasons match this filter.</div> : visibleSeasons.map((season) => {
                  const key = seasonKey(season);
                  const checked = selected.has(key);
                  const latest = season.latestJob;
                  return (
                    <label className={`intro-season-row${checked ? ' is-selected' : ''}`} key={key}>
                      <input type="checkbox" checked={checked} onChange={(event) => setSelected((current) => {
                        const next = new Set(current);
                        if (event.target.checked) next.add(key); else next.delete(key);
                        return next;
                      })} />
                      <span className="intro-season-identity"><strong>{season.title}</strong><small>Season {season.season} · {season.availableEpisodes}/{season.episodes} files available</small></span>
                      <span className="intro-coverage"><strong>{season.introMarkers}/{season.availableEpisodes}</strong><small>markers</small><i><b style={{ width: `${Math.round(season.coverage * 100)}%` }} /></i></span>
                      <span className="intro-season-source">{season.manualMarkers > 0 ? `${season.manualMarkers} manual` : season.automaticMarkers > 0 ? `${season.automaticMarkers} automatic` : 'Not scanned'}</span>
                      {latest ? <button className="intro-job-link" type="button" onClick={(event) => { event.preventDefault(); setSelectedJobId(latest.id); }}><StatusBadge tone={statusTone(latest.state)}>{latest.state.toLowerCase()}</StatusBadge></button> : <span className="intro-no-job">No run</span>}
                    </label>
                  );
                })}
              </div>
            </section>

            <aside className="control-panel intro-console-panel" aria-label="Intro scanner console">
              <header className="intro-panel-header">
                <div><h2>Run console</h2><p>Worker output and final detection result.</p></div>
                {selectedJob && <StatusBadge tone={statusTone(selectedJob.state)}>{selectedJob.state.toLowerCase()}</StatusBadge>}
              </header>
              {!selectedJob ? <div className="intro-console-empty"><span>&gt;_</span><p>Start a queue or select a previous run to inspect its output.</p></div> : (
                <>
                  <div className="intro-run-summary">
                    <div><strong>{selectedJob.title}</strong><span>Season {selectedJob.season}{selectedJob.force ? ' · forced overwrite' : ''}</span></div>
                    <time>{formatDate(selectedJob.processedAt ?? selectedJob.createdAt)}</time>
                  </div>
                  <div className="intro-run-progress">
                    <div><span>{selectedJob.progress.stage.toLowerCase()}</span><strong>{selectedJob.progress.percent}%</strong></div>
                    <div className="control-progress"><span style={{ width: `${selectedJob.progress.percent}%` }} /></div>
                    <p>{selectedJob.progress.message}</p>
                  </div>
                  <div className={`intro-result tone-${statusTone(selectedJob.state)}`}>
                    <strong>{resultLabel(selectedJob)}</strong>
                    {selectedJob.result && <span>{selectedJob.result.fingerprinted}/{selectedJob.result.episodes} fingerprinted · {selectedJob.result.failed} failed · {selectedJob.result.skippedManual} manual skipped</span>}
                  </div>
                  <div className="intro-console" role="log" aria-live="polite">
                    {(selectedJob.logs ?? []).length === 0 ? <div><em>000</em><span>Waiting for worker output…</span></div> : selectedJob.logs!.map((line, index) => <div key={`${index}:${line}`}><em>{String(index + 1).padStart(3, '0')}</em><span>{line}</span></div>)}
                  </div>
                  <div className="intro-history">
                    <span>Recent runs</span>
                    {dashboard.jobs.slice(0, 12).map((job) => <button className={job.id === selectedJobId ? 'active' : ''} type="button" key={job.id} onClick={() => setSelectedJobId(job.id)}><i className={`tone-${statusTone(job.state)}`} /><span>{job.title}<small>S{job.season} · {formatDate(job.createdAt)}</small></span></button>)}
                  </div>
                </>
              )}
            </aside>
          </div>
        </>
      )}
    </div>
  );
}

function IntroStat({ label, value, detail, tone }: { label: string; value: number; detail: string; tone?: 'good' | 'warn' | 'bad' }) {
  return <div className={`control-stat${tone ? ` tone-${tone}` : ''}`}><span>{label}</span><strong>{value.toLocaleString()}</strong><small>{detail}</small></div>;
}
