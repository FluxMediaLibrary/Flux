'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import type { SetupSnapshotDTO, SetupStatusDTO, StorageVolumeDTO, UpdateSettingsBundleRequest } from '@flux/shared';
import { api, FluxApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { formatBytes } from '@/lib/format';

type StepId = 'welcome' | 'admin' | 'server' | 'storage' | 'metadata' | 'downloads' | 'review';

const STEPS: { id: StepId; label: string }[] = [
  { id: 'welcome', label: 'Welcome' },
  { id: 'admin', label: 'Administrator' },
  { id: 'server', label: 'Server' },
  { id: 'storage', label: 'Storage' },
  { id: 'metadata', label: 'Metadata' },
  { id: 'downloads', label: 'Downloads' },
  { id: 'review', label: 'Review' },
];

const LANGUAGES = [
  ['en', 'English'], ['de', 'Deutsch'], ['es', 'Español'], ['fr', 'Français'], ['it', 'Italiano'],
  ['nl', 'Nederlands'], ['pt', 'Português'], ['sv', 'Svenska'], ['pl', 'Polski'], ['ja', '日本語'],
] as const;

function errorMessage(err: unknown, fallback: string): string {
  return err instanceof FluxApiError || err instanceof Error ? err.message : fallback;
}

function healthLabel(volume: StorageVolumeDTO): string {
  switch (volume.health) {
    case 'OFFLINE': return 'Not mounted';
    case 'READ_ONLY': return 'Read-only';
    case 'FULL': return 'No space after reserve';
    case 'WARNING': return 'Nearly full';
    default: return 'Ready';
  }
}

function Step({ title, lead, children }: { title: string; lead?: string; children: ReactNode }) {
  return (
    <section className="setup-step" aria-live="polite">
      <h1 className="setup-step-title">{title}</h1>
      {lead && <p className="setup-step-lead">{lead}</p>}
      {children}
    </section>
  );
}

export default function SetupPage() {
  const router = useRouter();
  const auth = useAuth();
  const [status, setStatus] = useState<SetupStatusDTO | null>(null);
  const [snapshot, setSnapshot] = useState<SetupSnapshotDTO | null>(null);
  const [step, setStep] = useState<StepId>('welcome');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Admin step
  const [adminEmail, setAdminEmail] = useState('');
  const [adminPassword, setAdminPassword] = useState('');
  const [adminPasswordConfirm, setAdminPasswordConfirm] = useState('');
  const [adminProfile, setAdminProfile] = useState('Admin');
  const [loginPassword, setLoginPassword] = useState('');

  // Server step
  const [serverName, setServerName] = useState('Flux');
  const [language, setLanguage] = useState('en');
  const [timezone, setTimezone] = useState('UTC');

  // Storage step
  const [reservedGb, setReservedGb] = useState(10);
  const [strategy, setStrategy] = useState<'MOST_FREE' | 'PREFERRED_FIRST'>('MOST_FREE');
  const [preferredRoot, setPreferredRoot] = useState<string>('');

  // Metadata step
  const [tmdbKey, setTmdbKey] = useState('');
  const [tmdbResult, setTmdbResult] = useState<{ ok: boolean; message: string } | null>(null);

  // Downloads step
  const [importBehavior, setImportBehavior] = useState<'COPY' | 'MOVE'>('COPY');
  const [automatedDownloads, setAutomatedDownloads] = useState(false);

  // Review step
  const [scanOnFinish, setScanOnFinish] = useState(true);

  const stepIndex = STEPS.findIndex((entry) => entry.id === step);
  const isAdmin = auth.status === 'authenticated' && auth.isAdmin;

  const loadStatus = useCallback(async () => {
    try {
      const next = await api.getSetupStatus();
      setStatus(next);
      if (next.completed && !next.needsAdmin) router.replace('/');
    } catch (err) {
      setError(errorMessage(err, 'Flux could not be reached. Check that the backend is running.'));
    }
  }, [router]);

  useEffect(() => { void loadStatus(); }, [loadStatus]);

  const loadSnapshot = useCallback(async () => {
    if (!isAdmin) return;
    try {
      const snap = await api.getSetupSnapshot();
      setSnapshot(snap);
      setServerName(snap.settings.general.serverName);
      setLanguage(snap.settings.general.language);
      setTimezone(snap.settings.general.timezone);
      setReservedGb(snap.settings.storage.reservedFreeSpaceGb);
      setStrategy(snap.settings.storage.placementStrategy);
      setPreferredRoot(snap.settings.storage.preferredMediaRoot ?? snap.environment.mediaRoots[0] ?? '');
      setImportBehavior(snap.settings.downloads.completedImportBehavior);
      setAutomatedDownloads(snap.settings.downloads.automatedDownloads);
      if (snap.settings.integrations.tmdbApiKeyConfigured) {
        setTmdbResult({ ok: true, message: `A TMDb key is already configured (${snap.settings.integrations.tmdbSource === 'ENVIRONMENT' ? 'from the environment' : 'saved in settings'}).` });
      }
    } catch (err) {
      setError(errorMessage(err, 'Could not load the current configuration.'));
    }
  }, [isAdmin]);

  useEffect(() => { void loadSnapshot(); }, [loadSnapshot]);

  useEffect(() => {
    if (typeof Intl !== 'undefined') {
      const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
      if (tz) setTimezone((current) => (current === 'UTC' ? tz : current));
    }
  }, []);

  const mediaVolumes = useMemo(() => snapshot?.volumes.filter((volume) => volume.role === 'media') ?? [], [snapshot]);

  function go(next: StepId) {
    setError(null);
    setStep(next);
    window.scrollTo({ top: 0 });
  }

  function next() {
    const following = STEPS[stepIndex + 1];
    if (following) go(following.id);
  }

  function back() {
    const previous = STEPS[stepIndex - 1];
    if (previous) go(previous.id);
  }

  async function saveSection(body: UpdateSettingsBundleRequest): Promise<boolean> {
    setBusy(true);
    setError(null);
    try {
      const updated = await api.updateSettings(body);
      setSnapshot((current) => (current ? { ...current, settings: updated } : current));
      return true;
    } catch (err) {
      setError(errorMessage(err, 'Saving failed.'));
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function submitAdmin(event: FormEvent) {
    event.preventDefault();
    setError(null);
    if (adminPassword !== adminPasswordConfirm) {
      setError('The passwords do not match.');
      return;
    }
    setBusy(true);
    try {
      const session = await api.createInitialAdmin({ email: adminEmail, password: adminPassword, profileName: adminProfile || undefined });
      auth.applySession(session);
      await loadStatus();
      next();
    } catch (err) {
      setError(errorMessage(err, 'The administrator could not be created.'));
    } finally {
      setBusy(false);
    }
  }

  async function submitLogin(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await auth.login({ email: adminEmail, password: loginPassword });
      next();
    } catch (err) {
      setError(errorMessage(err, 'Sign-in failed.'));
    } finally {
      setBusy(false);
    }
  }

  async function submitServer(event: FormEvent) {
    event.preventDefault();
    if (await saveSection({ general: { serverName: serverName.trim() || 'Flux', language, timezone } })) next();
  }

  async function submitStorage(event: FormEvent) {
    event.preventDefault();
    const ok = await saveSection({
      storage: {
        reservedFreeSpaceGb: Math.max(0, Math.round(reservedGb)),
        placementStrategy: strategy,
        preferredMediaRoot: strategy === 'PREFERRED_FIRST' && preferredRoot ? preferredRoot : null,
      },
    });
    if (ok) next();
  }

  async function testKey() {
    setBusy(true);
    setError(null);
    try {
      setTmdbResult(await api.testTmdbKey(tmdbKey.trim() || null));
    } catch (err) {
      setError(errorMessage(err, 'The key could not be tested.'));
    } finally {
      setBusy(false);
    }
  }

  async function submitMetadata(event: FormEvent) {
    event.preventDefault();
    if (tmdbKey.trim()) {
      const result = await api.testTmdbKey(tmdbKey.trim()).catch(() => ({ ok: false, message: 'Could not verify the key.' }));
      setTmdbResult(result);
      if (!result.ok) {
        setError(result.message);
        return;
      }
      if (!(await saveSection({ integrations: { tmdbApiKey: tmdbKey.trim() } }))) return;
    } else if (!snapshot?.settings.integrations.tmdbApiKeyConfigured) {
      setError('Flux needs a TMDb API key to identify media. Paste a key or configure TMDB_API_KEY in the environment.');
      return;
    }
    next();
  }

  async function submitDownloads(event: FormEvent) {
    event.preventDefault();
    if (await saveSection({ downloads: { completedImportBehavior: importBehavior, automatedDownloads } })) next();
  }

  async function finish() {
    setBusy(true);
    setError(null);
    try {
      await api.completeSetup();
      if (scanOnFinish) {
        // Best effort: the admin library page shows progress and any files
        // that need a manual match.
        await api.startLibraryScan().catch(() => undefined);
      }
      const profile = auth.profiles[0];
      if (profile && !auth.activeProfileId) await auth.activateProfile(profile.id);
      router.replace(scanOnFinish ? '/admin/library' : '/admin/overview');
    } catch (err) {
      setError(errorMessage(err, 'Setup could not be completed.'));
      setBusy(false);
    }
  }

  if (!status) {
    return (
      <div className="centered-viewport">
        <div className="spinner" aria-hidden />
        <p className="muted">{error ?? 'Checking setup state…'}</p>
      </div>
    );
  }

  const needsSignIn = !status.needsAdmin && !isAdmin;

  return (
    <main className="setup-shell">
      <div className="setup-frame">
        <aside className="setup-rail" aria-label="Setup progress">
          <div className="setup-brand"><span className="brand-mark">◈</span> Flux</div>
          <ol className="setup-steps">
            {STEPS.map((entry, index) => {
              const state = index < stepIndex ? 'done' : index === stepIndex ? 'current' : 'todo';
              return (
                <li key={entry.id} className={`setup-step-item is-${state}`} aria-current={state === 'current' ? 'step' : undefined}>
                  <span className="setup-step-index">{index + 1}</span>
                  <span>{entry.label}</span>
                </li>
              );
            })}
          </ol>
          <p className="setup-version">Flux {status.version}</p>
        </aside>

        <div className="setup-body">
          {error && <div className="form-error" role="alert">{error}</div>}

          {step === 'welcome' && (
            <Step title="Welcome to Flux" lead="This takes about two minutes. You will create an administrator, name the server, check storage, connect metadata and choose how downloads are imported. Everything can be changed later in Settings.">
              <ul className="setup-checklist">
                <li>Media is organised under each media root as <code>movies/</code> and <code>tv/</code>.</li>
                <li>Metadata, artwork and matching come from TMDb (free API key).</li>
                <li>Downloads are handled by the bundled Transmission client.</li>
              </ul>
              <div className="setup-actions">
                <button className="btn btn-primary" type="button" onClick={next}>Get started</button>
              </div>
            </Step>
          )}

          {step === 'admin' && status.needsAdmin && (
            <Step title="Create the administrator" lead="This account manages users, libraries and settings. It is the only account that can be created without an invite.">
              <form onSubmit={submitAdmin} noValidate className="setup-form">
                <div className="field">
                  <label htmlFor="setup-email">Email</label>
                  <input id="setup-email" className="input" type="email" autoComplete="username" value={adminEmail} onChange={(event) => setAdminEmail(event.target.value)} required />
                </div>
                <div className="setup-grid">
                  <div className="field">
                    <label htmlFor="setup-password">Password</label>
                    <input id="setup-password" className="input" type="password" autoComplete="new-password" minLength={10} value={adminPassword} onChange={(event) => setAdminPassword(event.target.value)} required />
                    <small className="dim">At least 10 characters.</small>
                  </div>
                  <div className="field">
                    <label htmlFor="setup-password-confirm">Confirm password</label>
                    <input id="setup-password-confirm" className="input" type="password" autoComplete="new-password" value={adminPasswordConfirm} onChange={(event) => setAdminPasswordConfirm(event.target.value)} required />
                  </div>
                </div>
                <div className="field">
                  <label htmlFor="setup-profile">Profile name</label>
                  <input id="setup-profile" className="input" type="text" maxLength={40} value={adminProfile} onChange={(event) => setAdminProfile(event.target.value)} />
                  <small className="dim">Profiles keep watch history separate. You can add more later.</small>
                </div>
                <div className="setup-actions">
                  <button className="btn btn-ghost" type="button" onClick={back} disabled={busy}>Back</button>
                  <button className="btn btn-primary" type="submit" disabled={busy || !adminEmail || adminPassword.length < 10}>{busy ? 'Creating…' : 'Create administrator'}</button>
                </div>
              </form>
            </Step>
          )}

          {step === 'admin' && needsSignIn && (
            <Step title="Sign in as an administrator" lead="An account already exists. Sign in with an administrator account to continue setup.">
              <form onSubmit={submitLogin} noValidate className="setup-form">
                <div className="field">
                  <label htmlFor="setup-login-email">Email</label>
                  <input id="setup-login-email" className="input" type="email" autoComplete="username" value={adminEmail} onChange={(event) => setAdminEmail(event.target.value)} required />
                </div>
                <div className="field">
                  <label htmlFor="setup-login-password">Password</label>
                  <input id="setup-login-password" className="input" type="password" autoComplete="current-password" value={loginPassword} onChange={(event) => setLoginPassword(event.target.value)} required />
                </div>
                <div className="setup-actions">
                  <button className="btn btn-ghost" type="button" onClick={back} disabled={busy}>Back</button>
                  <button className="btn btn-primary" type="submit" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
                </div>
              </form>
            </Step>
          )}

          {step === 'admin' && !status.needsAdmin && isAdmin && (
            <Step title="Administrator ready" lead={`You are signed in as ${auth.account?.email ?? 'an administrator'}.`}>
              <div className="setup-actions">
                <button className="btn btn-ghost" type="button" onClick={back}>Back</button>
                <button className="btn btn-primary" type="button" onClick={next}>Continue</button>
              </div>
            </Step>
          )}

          {step === 'server' && (
            <Step title="Name your server" lead="Shown in the app, on clients and in notifications.">
              <form onSubmit={submitServer} noValidate className="setup-form">
                <div className="field">
                  <label htmlFor="setup-server-name">Server name</label>
                  <input id="setup-server-name" className="input" type="text" maxLength={80} value={serverName} onChange={(event) => setServerName(event.target.value)} required />
                </div>
                <div className="setup-grid">
                  <div className="field">
                    <label htmlFor="setup-language">Language</label>
                    <select id="setup-language" className="input" value={language} onChange={(event) => setLanguage(event.target.value)}>
                      {LANGUAGES.map(([code, label]) => <option key={code} value={code}>{label}</option>)}
                    </select>
                  </div>
                  <div className="field">
                    <label htmlFor="setup-timezone">Time zone</label>
                    <input id="setup-timezone" className="input" type="text" value={timezone} onChange={(event) => setTimezone(event.target.value)} />
                    <small className="dim">Detected from this browser. Used for schedules and logs.</small>
                  </div>
                </div>
                {snapshot && (
                  <details className="setup-advanced">
                    <summary>Network details</summary>
                    <dl className="setup-kv">
                      <dt>Web address</dt><dd><code>{snapshot.environment.frontendOrigin}</code></dd>
                      <dt>API address for TVs and casting</dt><dd><code>{snapshot.environment.publicApiBaseUrl ?? 'Inferred from each request'}</code></dd>
                    </dl>
                    <p className="dim">These come from the deployment environment (<code>FRONTEND_ORIGIN</code>, <code>PUBLIC_API_BASE_URL</code>) and can be overridden later in Settings → General.</p>
                  </details>
                )}
                <div className="setup-actions">
                  <button className="btn btn-ghost" type="button" onClick={back} disabled={busy}>Back</button>
                  <button className="btn btn-primary" type="submit" disabled={busy}>{busy ? 'Saving…' : 'Continue'}</button>
                </div>
              </form>
            </Step>
          )}

          {step === 'storage' && (
            <Step title="Storage" lead="Flux writes movies to movies/ and series to tv/ inside each media root. When a root would drop below the reserve, new media goes to the next root with space.">
              <form onSubmit={submitStorage} noValidate className="setup-form">
                {!snapshot ? (
                  <p className="muted">Loading volumes…</p>
                ) : (
                  <div className="setup-volumes">
                    {snapshot.volumes.map((volume) => (
                      <div key={`${volume.role}-${volume.path}`} className={`setup-volume is-${volume.health.toLowerCase()}`}>
                        <div className="setup-volume-head">
                          <strong>{volume.role === 'media' ? 'Media root' : volume.role === 'download' ? 'Downloads' : 'Transcode cache'}</strong>
                          <span className="setup-volume-health">{healthLabel(volume)}</span>
                        </div>
                        <code>{volume.path}</code>
                        <div className="setup-volume-bar" aria-hidden>
                          <span style={{ width: `${Math.round((volume.percentUsed ?? 0) * 100)}%` }} />
                        </div>
                        <small className="dim">
                          {volume.freeBytes === null
                            ? 'Capacity unknown'
                            : `${formatBytes(volume.freeBytes)} free of ${formatBytes(volume.totalBytes ?? 0)}${volume.role !== 'transcode' ? ` · ${formatBytes(volume.availableBytes ?? 0)} usable after reserve` : ''}`}
                        </small>
                      </div>
                    ))}
                  </div>
                )}
                <div className="setup-grid">
                  <div className="field">
                    <label htmlFor="setup-reserve">Reserved free space (GB)</label>
                    <input id="setup-reserve" className="input" type="number" min={0} step={1} value={reservedGb} onChange={(event) => setReservedGb(Number(event.target.value))} />
                    <small className="dim">Kept free on every volume. Downloads and imports that would cut into it are refused or routed elsewhere.</small>
                  </div>
                  <div className="field">
                    <label htmlFor="setup-strategy">Placement</label>
                    <select id="setup-strategy" className="input" value={strategy} onChange={(event) => setStrategy(event.target.value as 'MOST_FREE' | 'PREFERRED_FIRST')}>
                      <option value="MOST_FREE">Most free space first</option>
                      <option value="PREFERRED_FIRST">Fill a preferred root first</option>
                    </select>
                  </div>
                </div>
                {strategy === 'PREFERRED_FIRST' && (
                  <div className="field">
                    <label htmlFor="setup-preferred">Preferred media root</label>
                    <select id="setup-preferred" className="input" value={preferredRoot} onChange={(event) => setPreferredRoot(event.target.value)}>
                      {mediaVolumes.map((volume) => <option key={volume.path} value={volume.path}>{volume.path}</option>)}
                    </select>
                  </div>
                )}
                <p className="dim">Add or change roots by editing <code>MEDIA_ROOTS</code> in the deployment and restarting Flux.</p>
                <div className="setup-actions">
                  <button className="btn btn-ghost" type="button" onClick={back} disabled={busy}>Back</button>
                  <button className="btn btn-primary" type="submit" disabled={busy || !snapshot}>{busy ? 'Saving…' : 'Continue'}</button>
                </div>
              </form>
            </Step>
          )}

          {step === 'metadata' && (
            <Step title="Metadata" lead="Flux identifies movies and series, fetches artwork, descriptions and cast from TMDb.">
              <form onSubmit={submitMetadata} noValidate className="setup-form">
                {tmdbResult && <div className={`setup-inline-result ${tmdbResult.ok ? 'is-ok' : 'is-bad'}`}>{tmdbResult.message}</div>}
                <div className="field">
                  <label htmlFor="setup-tmdb">TMDb API key (v3)</label>
                  <input id="setup-tmdb" className="input" type="password" autoComplete="off" value={tmdbKey} onChange={(event) => { setTmdbKey(event.target.value); setTmdbResult(null); }} placeholder={snapshot?.settings.integrations.tmdbApiKeyConfigured ? 'Leave blank to keep the configured key' : ''} />
                  <small className="dim">Create one for free at themoviedb.org → Settings → API.</small>
                </div>
                <div className="setup-actions">
                  <button className="btn btn-ghost" type="button" onClick={back} disabled={busy}>Back</button>
                  <button className="btn btn-ghost" type="button" onClick={() => void testKey()} disabled={busy || (!tmdbKey && !snapshot?.settings.integrations.tmdbApiKeyConfigured)}>Test key</button>
                  <button className="btn btn-primary" type="submit" disabled={busy}>{busy ? 'Saving…' : 'Continue'}</button>
                </div>
              </form>
            </Step>
          )}

          {step === 'downloads' && (
            <Step title="Downloads" lead="Requests are fulfilled through the bundled Transmission client. Choose how completed downloads enter the library.">
              <form onSubmit={submitDownloads} noValidate className="setup-form">
                {snapshot && (
                  <div className={`setup-inline-result ${snapshot.downloadClient.ok ? 'is-ok' : 'is-bad'}`}>
                    Transmission: {snapshot.downloadClient.message}
                    {!snapshot.downloadClient.ok && ' — you can continue and fix the connection later in Settings → Downloads.'}
                  </div>
                )}
                <div className="field">
                  <label htmlFor="setup-import">Completed download behaviour</label>
                  <select id="setup-import" className="input" value={importBehavior} onChange={(event) => setImportBehavior(event.target.value as 'COPY' | 'MOVE')}>
                    <option value="COPY">Copy into the library and keep seeding</option>
                    <option value="MOVE">Move into the library and stop seeding</option>
                  </select>
                  <small className="dim">Copy uses twice the space while seeding; Move frees the download folder immediately.</small>
                </div>
                <label className="setup-toggle">
                  <input type="checkbox" checked={automatedDownloads} onChange={(event) => setAutomatedDownloads(event.target.checked)} />
                  <span>Allow automated downloads for approved requests</span>
                </label>
                <div className="setup-actions">
                  <button className="btn btn-ghost" type="button" onClick={back} disabled={busy}>Back</button>
                  <button className="btn btn-primary" type="submit" disabled={busy}>{busy ? 'Saving…' : 'Continue'}</button>
                </div>
              </form>
            </Step>
          )}

          {step === 'review' && (
            <Step title="Review" lead="Everything below is saved. Finish to open Flux.">
              <dl className="setup-kv setup-review">
                <dt>Administrator</dt><dd>{auth.account?.email ?? '—'}</dd>
                <dt>Server</dt><dd>{serverName} · {language} · {timezone}</dd>
                <dt>Media roots</dt><dd>{(snapshot?.environment.mediaRoots ?? []).map((root) => <code key={root}>{root}</code>)}</dd>
                <dt>Storage policy</dt><dd>Keep {reservedGb} GB free · {strategy === 'MOST_FREE' ? 'most free space first' : `fill ${preferredRoot} first`}</dd>
                <dt>Metadata</dt><dd>{snapshot?.settings.integrations.tmdbApiKeyConfigured ? 'TMDb connected' : 'TMDb not configured'}</dd>
                <dt>Downloads</dt><dd>{importBehavior === 'COPY' ? 'Copy into library' : 'Move into library'}{automatedDownloads ? ' · automated' : ''}</dd>
              </dl>
              <label className="setup-toggle">
                <input type="checkbox" checked={scanOnFinish} onChange={(event) => setScanOnFinish(event.target.checked)} />
                <span>Index media already in the media folders (<code>movies/</code> and <code>tv/</code>) and fetch its metadata</span>
              </label>
              <div className="setup-actions">
                <button className="btn btn-ghost" type="button" onClick={back} disabled={busy}>Back</button>
                <button className="btn btn-primary" type="button" onClick={() => void finish()} disabled={busy}>{busy ? 'Finishing…' : 'Finish and open Flux'}</button>
              </div>
            </Step>
          )}
        </div>
      </div>
    </main>
  );
}
