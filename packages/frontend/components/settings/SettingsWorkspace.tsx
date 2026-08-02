'use client';

import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';
import type {
  DownloadClientDTO,
  DownloadClientType,
  QualityProfileDTO,
  QualityRuleDTO,
  ReleaseScoreDTO,
  SaveDownloadClientRequest,
  SaveQualityProfileRequest,
  SettingsBundleDTO,
  StorageDriveCandidateDTO,
  StorageSettingsDTO,
} from '@flux/shared';
import { api, FluxApiError } from '@/lib/api';
import { LoadingState, PageError, PageHeader } from '@/components/admin/AdminUI';

type Tab = 'general' | 'storage' | 'downloads' | 'download-clients' | 'quality-profiles' | 'playback' | 'notifications' | 'integrations';
const TABS: { id: Tab; label: string }[] = [
  { id: 'general', label: 'General' },
  { id: 'storage', label: 'Storage' },
  { id: 'downloads', label: 'Downloads' },
  { id: 'download-clients', label: 'Download Clients' },
  { id: 'quality-profiles', label: 'Quality Profiles' },
  { id: 'playback', label: 'Playback' },
  { id: 'notifications', label: 'Notifications' },
  { id: 'integrations', label: 'Integrations' },
];

const EMPTY_CLIENT: SaveDownloadClientRequest = {
  name: '', type: 'TRANSMISSION', enabled: true, host: 'localhost', port: 9091,
  useHttps: false, username: '', credential: '', category: '', priority: 0, isDefault: false,
};

const EMPTY_PROFILE: SaveQualityProfileRequest = {
  name: '', enabled: true, allowedResolutions: ['1080p'], sourceTypes: ['WEB-DL'],
  videoCodecs: ['HEVC', 'H.264'], hdrFormats: [], audioFormats: [], audioChannels: [],
  languages: [], releaseGroups: [], minimumSizeMb: null, maximumSizeMb: null, rules: [],
  upgradeCutoffScore: 100, minimumScoreImprovement: 10,
};

type AndroidAppInfo = {
  versionName?: string;
  versionCode?: number;
  automaticUpdates?: boolean;
  updateServer?: string;
};

function same(a: unknown, b: unknown): boolean { return JSON.stringify(a) === JSON.stringify(b); }
function message(error: unknown, fallback: string): string { return error instanceof FluxApiError || error instanceof Error ? error.message : fallback; }

export function SettingsWorkspace() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const requestedTab = searchParams.get('tab');
  const activeTab: Tab = TABS.some((tab) => tab.id === requestedTab) ? requestedTab as Tab : 'general';
  const [original, setOriginal] = useState<SettingsBundleDTO | null>(null);
  const [draft, setDraft] = useState<SettingsBundleDTO | null>(null);
  const [clients, setClients] = useState<DownloadClientDTO[]>([]);
  const [profiles, setProfiles] = useState<QualityProfileDTO[]>([]);
  const [storageDrives, setStorageDrives] = useState<StorageSettingsDTO | null>(null);
  const [driveCandidates, setDriveCandidates] = useState<StorageDriveCandidateDTO[]>([]);
  const [drivePickerOpen, setDrivePickerOpen] = useState(false);
  const [discoveringDrives, setDiscoveringDrives] = useState(false);
  const [activatingDriveId, setActivatingDriveId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [discordSecret, setDiscordSecret] = useState('');
  const [smtpSecret, setSmtpSecret] = useState('');
  const [tmdbSecret, setTmdbSecret] = useState('');
  const [clientEditor, setClientEditor] = useState<(SaveDownloadClientRequest & { id?: string }) | null>(null);
  const [clientBaseline, setClientBaseline] = useState<(SaveDownloadClientRequest & { id?: string }) | null>(null);
  const [profileEditor, setProfileEditor] = useState<(SaveQualityProfileRequest & { id?: string }) | null>(null);
  const [profileBaseline, setProfileBaseline] = useState<(SaveQualityProfileRequest & { id?: string }) | null>(null);
  const [testProfileId, setTestProfileId] = useState<string | null>(null);
  const [releaseTitle, setReleaseTitle] = useState('');
  const [releaseSize, setReleaseSize] = useState('');
  const [releaseResult, setReleaseResult] = useState<ReleaseScoreDTO | null>(null);
  const [testing, setTesting] = useState(false);
  const [androidInfo, setAndroidInfo] = useState<AndroidAppInfo | null>(null);
  const [androidAutomaticUpdates, setAndroidAutomaticUpdates] = useState(true);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [settings, clientRows, profileRows, storageSettings] = await Promise.all([
        api.getSettings(), api.listDownloadClients(), api.listQualityProfiles(), api.getStorageSettings(),
      ]);
      setOriginal(settings); setDraft(settings); setClients(clientRows); setProfiles(profileRows); setStorageDrives(storageSettings);
      setTestProfileId((current) => current && profileRows.some((profile) => profile.id === current) ? current : profileRows[0]?.id ?? null);
    } catch (err) { setError(message(err, 'Settings could not be loaded.')); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    const bridge = window.FluxNative;
    if (!bridge?.isNativeApp?.() || !bridge.getAppInfo) return;
    try {
      const info = JSON.parse(bridge.getAppInfo()) as AndroidAppInfo;
      setAndroidInfo(info);
      setAndroidAutomaticUpdates(info.automaticUpdates ?? true);
    } catch {
      setAndroidInfo({});
    }
  }, []);

  function setNativeAutomaticUpdates(enabled: boolean) {
    setAndroidAutomaticUpdates(enabled);
    window.FluxNative?.setAutomaticUpdates?.(enabled);
  }

  const sectionDirty = useMemo(() => {
    if (!draft || !original) return false;
    if (activeTab === 'download-clients') return Boolean(clientEditor && !same(clientEditor, clientBaseline));
    if (activeTab === 'quality-profiles') return Boolean(profileEditor && !same(profileEditor, profileBaseline));
    if (activeTab === 'notifications') return !same(draft.notifications, original.notifications) || Boolean(discordSecret || smtpSecret);
    if (activeTab === 'integrations') return Boolean(tmdbSecret);
    return !same(draft[activeTab], original[activeTab]);
  }, [activeTab, clientBaseline, clientEditor, discordSecret, draft, original, profileBaseline, profileEditor, smtpSecret, tmdbSecret]);

  const anyDirty = useMemo(() => {
    if (!draft || !original) return false;
    return !same(draft.general, original.general) || !same(draft.storage, original.storage) || !same(draft.downloads, original.downloads)
      || !same(draft.playback, original.playback) || !same(draft.notifications, original.notifications)
      || Boolean(discordSecret || smtpSecret || tmdbSecret)
      || Boolean(clientEditor && !same(clientEditor, clientBaseline))
      || Boolean(profileEditor && !same(profileEditor, profileBaseline));
  }, [clientBaseline, clientEditor, discordSecret, draft, original, profileBaseline, profileEditor, smtpSecret, tmdbSecret]);

  useEffect(() => {
    if (!anyDirty) return;
    const beforeUnload = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', beforeUnload);
    return () => window.removeEventListener('beforeunload', beforeUnload);
  }, [anyDirty]);

  function changeTab(tab: Tab) {
    if (tab === activeTab) return;
    if (sectionDirty && !window.confirm('Discard the unsaved changes in this tab?')) return;
    cancelCurrent();
    const params = new URLSearchParams(searchParams.toString());
    params.set('tab', tab);
    window.history.pushState(null, '', `${pathname}?${params.toString()}`);
  }

  function updateSection<K extends 'general' | 'storage' | 'downloads' | 'playback' | 'notifications'>(section: K, values: Partial<SettingsBundleDTO[K]>) {
    setDraft((current) => current ? { ...current, [section]: { ...current[section], ...values } } : current);
  }

  function cancelCurrent() {
    if (!original) return;
    if (activeTab === 'download-clients') { setClientEditor(null); setClientBaseline(null); }
    else if (activeTab === 'quality-profiles') { setProfileEditor(null); setProfileBaseline(null); }
    else if (activeTab === 'notifications') {
      setDraft((current) => current ? { ...current, notifications: original.notifications } : current);
      setDiscordSecret(''); setSmtpSecret('');
    } else if (activeTab === 'integrations') setTmdbSecret('');
    else setDraft((current) => current ? { ...current, [activeTab]: original[activeTab] } : current);
    setError(null); setNotice(null);
  }

  const validation = draft ? validateTab(activeTab, draft, { discordSecret, smtpSecret, tmdbSecret, clientEditor, profileEditor }) : {};
  const hasValidationErrors = Object.keys(validation).length > 0;

  async function saveCurrent() {
    if (!draft || hasValidationErrors) return;
    setSaving(true); setError(null); setNotice(null);
    try {
      if (activeTab === 'general' || activeTab === 'storage' || activeTab === 'downloads' || activeTab === 'playback') {
        const result = await api.updateSettings({ [activeTab]: draft[activeTab] });
        setOriginal(result); setDraft(result);
      } else if (activeTab === 'notifications') {
        const body = {
          discordEnabled: draft.notifications.discordEnabled,
          ...(discordSecret ? { discordWebhookUrl: discordSecret } : {}),
          smtpEnabled: draft.notifications.smtpEnabled,
          smtpHost: draft.notifications.smtpHost,
          smtpPort: draft.notifications.smtpPort,
          smtpUsername: draft.notifications.smtpUsername,
          ...(smtpSecret ? { smtpPassword: smtpSecret } : {}),
          smtpFromAddress: draft.notifications.smtpFromAddress,
        };
        const notifications = await api.updateNotificationSettings(body);
        const next = { ...draft, notifications };
        setDraft(next); setOriginal(next); setDiscordSecret(''); setSmtpSecret('');
      } else if (activeTab === 'integrations' && tmdbSecret) {
        const result = await api.updateSettings({ integrations: { tmdbApiKey: tmdbSecret } });
        setOriginal(result); setDraft(result); setTmdbSecret('');
      }
      setNotice('Settings saved.');
    } catch (err) { setError(message(err, 'Settings could not be saved.')); }
    finally { setSaving(false); }
  }

  function editClient(client?: DownloadClientDTO) {
    const value = client ? {
      id: client.id, name: client.name, type: client.type, enabled: client.enabled, host: client.host,
      port: client.port, useHttps: client.useHttps, username: client.username ?? '', credential: '',
      category: client.category ?? '', priority: client.priority, isDefault: client.isDefault,
    } : { ...EMPTY_CLIENT };
    setClientEditor(value); setClientBaseline(value); setError(null); setNotice(null);
  }

  async function saveClient() {
    if (!clientEditor || Object.keys(validateClient(clientEditor)).length) return;
    setSaving(true); setError(null);
    try {
      const { id, ...body } = clientEditor;
      if (id) await api.updateDownloadClient(id, body); else await api.createDownloadClient(body);
      setClientEditor(null); setClientBaseline(null); await load(); setNotice('Download client saved.');
    } catch (err) { setError(message(err, 'Download client could not be saved.')); }
    finally { setSaving(false); }
  }

  async function removeClient(client: DownloadClientDTO) {
    if (!window.confirm(`Delete download client “${client.name}”? Existing jobs will not be deleted.`)) return;
    setSaving(true); setError(null);
    try { await api.deleteDownloadClient(client.id); await load(); setNotice('Download client deleted.'); }
    catch (err) { setError(message(err, 'Download client could not be deleted.')); }
    finally { setSaving(false); }
  }

  async function testClient(client: DownloadClientDTO) {
    setTesting(true); setError(null); setNotice(null);
    try { const result = await api.testDownloadClient(client.id); result.ok ? setNotice(`${client.name}: ${result.message}${result.version ? ` Version ${result.version}.` : ''}`) : setError(`${client.name}: ${result.message}`); }
    catch (err) { setError(message(err, 'Connection test failed.')); }
    finally { setTesting(false); }
  }

  function editProfile(profile?: QualityProfileDTO) {
    const value = profile ? { ...profile, id: profile.id } : { ...EMPTY_PROFILE, rules: [] };
    if ('createdAt' in value) { delete (value as Partial<QualityProfileDTO>).createdAt; delete (value as Partial<QualityProfileDTO>).updatedAt; }
    setProfileEditor(value as SaveQualityProfileRequest & { id?: string });
    setProfileBaseline(value as SaveQualityProfileRequest & { id?: string });
    setError(null); setNotice(null);
  }

  async function saveProfile() {
    if (!profileEditor || Object.keys(validateProfile(profileEditor)).length) return;
    setSaving(true); setError(null);
    try {
      const { id, ...body } = profileEditor;
      if (id) await api.updateQualityProfile(id, body); else await api.createQualityProfile(body);
      setProfileEditor(null); setProfileBaseline(null); await load(); setNotice('Quality profile saved.');
    } catch (err) { setError(message(err, 'Quality profile could not be saved.')); }
    finally { setSaving(false); }
  }

  async function removeProfile(profile: QualityProfileDTO) {
    if (!window.confirm(`Delete quality profile “${profile.name}”? Downloads using it must be assigned another profile.`)) return;
    setSaving(true); setError(null);
    try { await api.deleteQualityProfile(profile.id); await load(); setNotice('Quality profile deleted.'); }
    catch (err) { setError(message(err, 'Quality profile could not be deleted.')); }
    finally { setSaving(false); }
  }

  async function runReleaseTest() {
    if (!testProfileId || !releaseTitle.trim()) return;
    setTesting(true); setError(null); setReleaseResult(null);
    try { setReleaseResult(await api.testRelease(testProfileId, { title: releaseTitle.trim(), sizeMb: releaseSize ? Number(releaseSize) : null })); }
    catch (err) { setError(message(err, 'Release could not be tested.')); }
    finally { setTesting(false); }
  }

  async function runNotificationTest(kind: 'discord' | 'email') {
    setTesting(true); setError(null); setNotice(null);
    try { const result = kind === 'discord' ? await api.testDiscordNotification() : await api.testEmailNotification(); setNotice(result.message); }
    catch (err) { setError(message(err, 'Notification test failed.')); }
    finally { setTesting(false); }
  }

  async function clearTmdbKey() {
    if (!window.confirm('Remove the stored TMDb key and return to the environment key?')) return;
    setSaving(true); setError(null);
    try { const result = await api.updateSettings({ integrations: { tmdbApiKey: null } }); setOriginal(result); setDraft(result); setTmdbSecret(''); setNotice('Stored TMDb key removed.'); }
    catch (err) { setError(message(err, 'TMDb key could not be removed.')); }
    finally { setSaving(false); }
  }

  async function openDrivePicker() {
    setDrivePickerOpen(true); setDiscoveringDrives(true); setError(null); setNotice(null);
    try { setDriveCandidates(await api.discoverStorageDrives()); }
    catch (err) { setError(message(err, 'Server drives could not be discovered.')); }
    finally { setDiscoveringDrives(false); }
  }

  async function addDrive(drive: StorageDriveCandidateDTO) {
    if (!drive.writable || drive.alreadyAdded) return;
    if (!window.confirm(`Add “${drive.label}” as an overflow library drive? Flux will prepare folders without moving existing media.`)) return;
    setActivatingDriveId(drive.id); setError(null); setNotice(null);
    try {
      const next = await api.addStorageDrive(drive.id);
      setStorageDrives(next); setDrivePickerOpen(false); setDriveCandidates([]);
      setNotice(`${drive.label} is ready as overflow storage. The primary drive remains unchanged.`);
    } catch (err) { setError(message(err, 'The drive could not be prepared.')); }
    finally { setActivatingDriveId(null); }
  }

  if (loading) return <div className="control-page"><PageHeader title="Settings" description="Server behavior, acquisition, playback, and integrations." /><LoadingState cards={4} /></div>;
  if (!draft || !original) return <div className="control-page"><PageHeader title="Settings" description="Server behavior, acquisition, playback, and integrations." /><PageError message={error ?? 'Settings could not be loaded.'} onRetry={() => { setLoading(true); void load(); }} /></div>;

  return (
    <div className="control-page control-settings-page">
      <PageHeader title="Settings" description="Configure Flux without leaving the existing Control Center." />
      <div className="settings-tabs" role="tablist" aria-label="Settings sections">
        {TABS.map((tab) => <button key={tab.id} role="tab" aria-selected={activeTab === tab.id} className={activeTab === tab.id ? 'active' : ''} onClick={() => changeTab(tab.id)}>{tab.label}</button>)}
      </div>
      {error && <div className="settings-banner error" role="alert">{error}</div>}
      {notice && <div className="settings-banner success" role="status">{notice}</div>}
      {sectionDirty && <div className="settings-unsaved"><span /> Unsaved changes</div>}

      {activeTab === 'general' && <GeneralTab value={draft.general} update={(values) => updateSection('general', values)} errors={validation} androidInfo={androidInfo} androidAutomaticUpdates={androidAutomaticUpdates} setAndroidAutomaticUpdates={setNativeAutomaticUpdates} />}
      {activeTab === 'storage' && storageDrives && <StorageTab drives={storageDrives} policy={draft.storage} update={(values) => updateSection('storage', values)} errors={validation} candidates={driveCandidates} pickerOpen={drivePickerOpen} discovering={discoveringDrives} addingId={activatingDriveId} openPicker={openDrivePicker} closePicker={() => setDrivePickerOpen(false)} add={addDrive} />}
      {activeTab === 'downloads' && <DownloadsTab value={draft.downloads} clients={clients} profiles={profiles} update={(values) => updateSection('downloads', values)} errors={validation} />}
      {activeTab === 'download-clients' && <ClientsTab clients={clients} editor={clientEditor} setEditor={setClientEditor} edit={editClient} remove={removeClient} test={testClient} errors={clientEditor ? validateClient(clientEditor) : {}} busy={saving || testing} />}
      {activeTab === 'quality-profiles' && <ProfilesTab profiles={profiles} editor={profileEditor} setEditor={setProfileEditor} edit={editProfile} remove={removeProfile} errors={profileEditor ? validateProfile(profileEditor) : {}} testProfileId={testProfileId} setTestProfileId={setTestProfileId} releaseTitle={releaseTitle} setReleaseTitle={setReleaseTitle} releaseSize={releaseSize} setReleaseSize={setReleaseSize} runTest={runReleaseTest} result={releaseResult} busy={saving || testing} />}
      {activeTab === 'playback' && <PlaybackTab value={draft.playback} update={(values) => updateSection('playback', values)} errors={validation} />}
      {activeTab === 'notifications' && <NotificationsTab value={draft.notifications} update={(values) => updateSection('notifications', values)} discordSecret={discordSecret} setDiscordSecret={setDiscordSecret} smtpSecret={smtpSecret} setSmtpSecret={setSmtpSecret} test={runNotificationTest} busy={testing} errors={validation} />}
      {activeTab === 'integrations' && <IntegrationsTab value={draft.integrations} secret={tmdbSecret} setSecret={setTmdbSecret} clear={clearTmdbKey} busy={saving} errors={validation} />}

      {(activeTab !== 'download-clients' && activeTab !== 'quality-profiles') && <SaveBar dirty={sectionDirty} saving={saving} invalid={hasValidationErrors} save={saveCurrent} cancel={cancelCurrent} />}
      {activeTab === 'download-clients' && clientEditor && <SaveBar dirty={sectionDirty} saving={saving} invalid={Object.keys(validateClient(clientEditor)).length > 0} save={saveClient} cancel={cancelCurrent} />}
      {activeTab === 'quality-profiles' && profileEditor && <SaveBar dirty={sectionDirty} saving={saving} invalid={Object.keys(validateProfile(profileEditor)).length > 0} save={saveProfile} cancel={cancelCurrent} />}
    </div>
  );
}

function Section({ title, description, children }: { title: string; description: string; children: ReactNode }) {
  return <section className="settings-section"><div className="settings-section-copy"><h2>{title}</h2><p>{description}</p></div><div className="settings-section-fields">{children}</div></section>;
}
function Field({ label, error, hint, children }: { label: string; error?: string; hint?: string; children: ReactNode }) {
  return <label className={`settings-field${error ? ' invalid' : ''}`}><span>{label}</span>{children}{error ? <small className="field-error">{error}</small> : hint ? <small>{hint}</small> : null}</label>;
}
function Toggle({ label, detail, checked, onChange }: { label: string; detail?: string; checked: boolean; onChange: (checked: boolean) => void }) {
  return <label className="settings-toggle"><span><strong>{label}</strong>{detail && <small>{detail}</small>}</span><input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} /><i /></label>;
}
function SaveBar({ dirty, saving, invalid, save, cancel }: { dirty: boolean; saving: boolean; invalid: boolean; save: () => void; cancel: () => void }) {
  return <div className="settings-savebar"><span>{dirty ? 'Review and save your changes.' : 'No unsaved changes.'}</span><div><button className="control-button" disabled={!dirty || saving} onClick={cancel}>Cancel</button><button className="control-button primary" disabled={!dirty || saving || invalid} onClick={save}>{saving ? 'Saving…' : 'Save changes'}</button></div></div>;
}

function GeneralTab({ value, update, errors, androidInfo, androidAutomaticUpdates, setAndroidAutomaticUpdates }: { value: SettingsBundleDTO['general']; update: (value: Partial<SettingsBundleDTO['general']>) => void; errors: Record<string, string>; androidInfo: AndroidAppInfo | null; androidAutomaticUpdates: boolean; setAndroidAutomaticUpdates: (enabled: boolean) => void }) {
  return <div className="settings-stack"><Section title="Server identity" description="Shown to web, mobile, and connected clients."><div className="settings-grid"><Field label="Server name" error={errors.serverName}><input className="control-input" value={value.serverName} onChange={(event) => update({ serverName: event.target.value })} /></Field><Field label="Language" error={errors.language}><input className="control-input" value={value.language} onChange={(event) => update({ language: event.target.value })} placeholder="en" /></Field><Field label="Time zone" error={errors.timezone} hint="IANA name, for example America/Chicago"><input className="control-input" value={value.timezone} onChange={(event) => update({ timezone: event.target.value })} /></Field></div></Section><Section title="Public addresses" description="Used for invite links, client branding, and remote playback handoff."><div className="settings-grid"><Field label="Frontend URL" error={errors.frontendUrl}><input className="control-input" type="url" value={value.frontendUrl} onChange={(event) => update({ frontendUrl: event.target.value })} /></Field><Field label="Public API URL" error={errors.apiUrl} hint="Optional; incoming request origin is used when empty."><input className="control-input" type="url" value={value.apiUrl ?? ''} onChange={(event) => update({ apiUrl: event.target.value || null })} /></Field></div></Section><Section title="Invite defaults" description="Applied when an administrator creates an invite without choosing an expiry."><Field label="Default expiry (hours)" error={errors.defaultInviteExpiryHours}><input className="control-input" type="number" min="1" max="8760" value={value.defaultInviteExpiryHours} onChange={(event) => update({ defaultInviteExpiryHours: Number(event.target.value) })} /></Field></Section>{androidInfo && <Section title="Android app updates" description="Native app update controls preserved from the existing Settings page."><div className="settings-meta-grid"><div><span>Installed version</span><strong>{androidInfo.versionName ?? 'Unknown'}{typeof androidInfo.versionCode === 'number' ? ` (${androidInfo.versionCode})` : ''}</strong></div>{androidInfo.updateServer && <div><span>Update server</span><strong>{androidInfo.updateServer}</strong></div>}</div><Toggle label="Check for updates automatically" checked={androidAutomaticUpdates} onChange={setAndroidAutomaticUpdates} /><div className="settings-row-actions"><button className="control-button primary" type="button" onClick={() => window.FluxNative?.checkForUpdates?.()}>Check for updates</button><button className="control-button" type="button" onClick={() => window.FluxNative?.clearUpdateDownloads?.()}>Clear downloaded files</button></div></Section>}</div>;
}

function formatStorageBytes(bytes: number | null): string {
  if (bytes === null) return 'Unavailable';
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / (1024 ** index);
  return `${value >= 100 || index === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[index]}`;
}

function StorageTab({ drives, policy, update, errors, candidates, pickerOpen, discovering, addingId, openPicker, closePicker, add }: { drives: StorageSettingsDTO; policy: SettingsBundleDTO['storage']; update: (value: Partial<SettingsBundleDTO['storage']>) => void; errors: Record<string, string>; candidates: StorageDriveCandidateDTO[]; pickerOpen: boolean; discovering: boolean; addingId: string | null; openPicker: () => void; closePicker: () => void; add: (drive: StorageDriveCandidateDTO) => void }) {
  const primary = drives.roots.find((root) => root.primary) ?? drives.roots[0];
  const used = primary && primary.totalBytes !== null && primary.freeBytes !== null ? Math.max(0, primary.totalBytes - primary.freeBytes) : null;
  const percent = primary?.totalBytes && used !== null ? Math.min(100, (used / primary.totalBytes) * 100) : 0;
  return <div className="settings-stack">
    <section className="settings-storage-hero">
      <div className="settings-drive-mark" aria-hidden="true"><span /></div>
      <div className="settings-storage-copy"><span className="settings-eyebrow">Primary library drive</span><h2>{primary?.label ?? 'Storage unavailable'}</h2><code>{drives.primaryRoot}</code><p>Flux keeps importing here until the next item would cross your free-space reserve, then spills the whole import to the next drive.</p></div>
      <div className="settings-storage-capacity"><strong>{formatStorageBytes(primary?.freeBytes ?? null)}</strong><span>free of {formatStorageBytes(primary?.totalBytes ?? null)}</span><div className="settings-capacity-track" aria-label={`${percent.toFixed(0)}% used`}><i style={{ width: `${percent}%` }} /></div></div>
      <button className="control-button primary settings-add-drive" type="button" onClick={openPicker}>Add new drive</button>
    </section>
    <Section title="Automatic spillover" description="The incoming movie or show size is counted before Flux chooses a drive.">
      <div className="settings-policy-row"><Field label="Keep at least this much free (GB)" error={errors.reserveSpaceGb} hint="Default: 20 GB. Applied to every library drive before an import starts."><input className="control-input" type="number" min="0" step="1" value={policy.reserveSpaceGb} onChange={(event) => update({ reserveSpaceGb: Number(event.target.value) })} /></Field><div className="settings-policy-example"><span>Routing rule</span><strong>free space − incoming size ≥ {policy.reserveSpaceGb || 0} GB</strong><small>If false, Flux tries the next prepared drive in order.</small></div></div>
    </Section>
    <Section title="Library drive order" description="Existing files stay where they are. Overflow drives receive only imports that no longer fit safely on an earlier drive.">
      <div className="settings-root-list">{drives.roots.map((root, index) => <article key={root.path} className={`settings-root-row${root.primary ? ' active' : ''}`}><span className="settings-root-index">{String(index + 1).padStart(2, '0')}</span><div><strong>{root.label}</strong><code>{root.path}</code></div><div className="settings-root-space"><strong>{formatStorageBytes(root.freeBytes)}</strong><span>free</span></div><em>{root.primary ? 'Primary' : root.available ? 'Overflow' : 'Offline'}</em></article>)}</div>
    </Section>
    <Section title="What gets prepared" description="Adding a drive does not repartition, format, or mount the server disk.">
      <div className="settings-setup-strip"><div><span>01</span><strong>Verify access</strong><small>Real backend write check</small></div><div><span>02</span><strong>Create structure</strong><small>movies and tv folders</small></div><div><span>03</span><strong>Add overflow route</strong><small>Primary remains unchanged</small></div></div>
    </Section>
    {pickerOpen && <div className="settings-drive-overlay" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !addingId) closePicker(); }}><section className="settings-drive-dialog" role="dialog" aria-modal="true" aria-labelledby="drive-picker-title"><header><div><span className="settings-eyebrow">Server storage</span><h2 id="drive-picker-title">Add overflow drive</h2><p>Only mounted filesystems visible to the Flux backend are shown.</p></div><button className="settings-dialog-close" type="button" aria-label="Close drive picker" disabled={Boolean(addingId)} onClick={closePicker}>×</button></header>{discovering ? <div className="settings-drive-loading"><i /><span>Scanning mounted filesystems…</span></div> : candidates.length ? <div className="settings-drive-options">{candidates.map((drive) => { const driveUsed = drive.totalBytes !== null && drive.freeBytes !== null ? drive.totalBytes - drive.freeBytes : null; const drivePercent = drive.totalBytes && driveUsed !== null ? Math.min(100, (driveUsed / drive.totalBytes) * 100) : 0; return <article key={drive.id} className={`${drive.primary ? 'active' : ''}${!drive.writable ? ' disabled' : ''}`}><div className="settings-drive-option-head"><div className="settings-drive-mark small" aria-hidden="true"><span /></div><div><strong>{drive.label}</strong><code>{drive.mountPath}</code></div>{drive.primary && <em>Primary</em>}</div><div className="settings-drive-option-space"><span>{formatStorageBytes(drive.freeBytes)} free</span><span>{formatStorageBytes(drive.totalBytes)} total</span></div><div className="settings-capacity-track"><i style={{ width: `${drivePercent}%` }} /></div><footer><span>{drive.writable ? `Flux library: ${drive.suggestedRoot}` : 'Read-only for Flux'}</span><button className="control-button" type="button" disabled={!drive.writable || drive.alreadyAdded || Boolean(addingId)} onClick={() => add(drive)}>{addingId === drive.id ? 'Preparing…' : drive.alreadyAdded ? 'Already added' : 'Add as overflow'}</button></footer></article>; })}</div> : <div className="settings-drive-empty"><strong>No writable drives found</strong><p>Mount the drive under the host storage directory exposed to Flux, then scan again.</p><button className="control-button" type="button" onClick={openPicker}>Scan again</button></div>}</section></div>}
  </div>;
}

function DownloadsTab({ value, clients, profiles, update, errors }: { value: SettingsBundleDTO['downloads']; clients: DownloadClientDTO[]; profiles: QualityProfileDTO[]; update: (value: Partial<SettingsBundleDTO['downloads']>) => void; errors: Record<string, string> }) {
  return <div className="settings-stack"><Section title="Automation" description="Global policy for backend acquisition jobs. Manual torrent upload remains available regardless of this switch."><Toggle label="Enable automated downloads" checked={value.automatedDownloads} onChange={(automatedDownloads) => update({ automatedDownloads })} /><Toggle label="Automatic search" checked={value.automaticSearch} onChange={(automaticSearch) => update({ automaticSearch })} /><Toggle label="Automatic upgrades" checked={value.automaticUpgrades} onChange={(automaticUpgrades) => update({ automaticUpgrades })} /><Toggle label="Retry failed downloads" checked={value.retryFailedDownloads} onChange={(retryFailedDownloads) => update({ retryFailedDownloads })} /></Section><Section title="Selection defaults" description="Controls protocol preference and which configured client/profile wins by default."><div className="settings-grid"><Field label="Preferred protocol"><select className="control-select" value={value.preferredProtocol} onChange={(event) => update({ preferredProtocol: event.target.value as SettingsBundleDTO['downloads']['preferredProtocol'] })}><option value="TORRENT_ONLY">Torrent only</option><option value="USENET_ONLY">Usenet only</option><option value="PREFER_TORRENT">Prefer Torrent</option><option value="PREFER_USENET">Prefer Usenet</option><option value="EITHER">Either</option></select></Field><Field label="Default download client" error={errors.defaultDownloadClientId}><select className="control-select" value={value.defaultDownloadClientId ?? ''} onChange={(event) => update({ defaultDownloadClientId: event.target.value || null })}><option value="">None</option>{clients.filter((client) => client.enabled).map((client) => <option key={client.id} value={client.id}>{client.name} · {client.type}</option>)}</select></Field><Field label="Default quality profile" error={errors.defaultQualityProfileId}><select className="control-select" value={value.defaultQualityProfileId ?? ''} onChange={(event) => update({ defaultQualityProfileId: event.target.value || null })}><option value="">None</option>{profiles.filter((profile) => profile.enabled).map((profile) => <option key={profile.id} value={profile.id}>{profile.name}</option>)}</select></Field></div></Section><Section title="Import and disk policy" description="Download staging has its own safety floor; library-drive spillover is configured in Storage."><div className="settings-grid"><Field label="Download staging reserve (GB)" error={errors.minimumFreeSpaceGb}><input className="control-input" type="number" min="0" value={value.minimumFreeSpaceGb} onChange={(event) => update({ minimumFreeSpaceGb: Number(event.target.value) })} /></Field><Field label="Completed import behavior"><select className="control-select" value={value.completedImportBehavior} onChange={(event) => update({ completedImportBehavior: event.target.value as 'COPY' | 'MOVE' })}><option value="COPY">Copy into library</option><option value="MOVE">Move into library</option></select></Field></div></Section><Section title="Torrent lifecycle" description="Seeding limits are optional. Removal never deletes library copies."><div className="settings-grid"><Field label="Seed ratio" error={errors.torrentSeedRatio}><input className="control-input" type="number" min="0" step="0.1" placeholder="Unlimited" value={value.torrentSeedRatio ?? ''} onChange={(event) => update({ torrentSeedRatio: event.target.value ? Number(event.target.value) : null })} /></Field><Field label="Seed time (minutes)" error={errors.torrentSeedTimeMinutes}><input className="control-input" type="number" min="1" placeholder="Unlimited" value={value.torrentSeedTimeMinutes ?? ''} onChange={(event) => update({ torrentSeedTimeMinutes: event.target.value ? Number(event.target.value) : null })} /></Field></div><Toggle label="Remove torrent after seeding limits are met" checked={value.torrentRemoveAfterSeeding} onChange={(torrentRemoveAfterSeeding) => update({ torrentRemoveAfterSeeding })} /></Section><Section title="Usenet cleanup" description="Removes only jobs matching a configured Flux category, leaving unrelated client history untouched."><Toggle label="Remove completed Usenet jobs" checked={value.usenetRemoveCompleted} onChange={(usenetRemoveCompleted) => update({ usenetRemoveCompleted })} /><Toggle label="Remove failed Usenet jobs" checked={value.usenetRemoveFailed} onChange={(usenetRemoveFailed) => update({ usenetRemoveFailed })} /></Section></div>;
}

function ClientsTab({ clients, editor, setEditor, edit, remove, test, errors, busy }: { clients: DownloadClientDTO[]; editor: (SaveDownloadClientRequest & { id?: string }) | null; setEditor: React.Dispatch<React.SetStateAction<(SaveDownloadClientRequest & { id?: string }) | null>>; edit: (client?: DownloadClientDTO) => void; remove: (client: DownloadClientDTO) => void; test: (client: DownloadClientDTO) => void; errors: Record<string, string>; busy: boolean }) {
  return <div className="settings-stack"><div className="settings-toolbar"><div><strong>Configured clients</strong><span>Transmission, SABnzbd, and NZBGet connections are tested only by the backend.</span></div><button className="control-button primary" onClick={() => edit()}>Add client</button></div><div className="settings-client-list">{clients.map((client) => <article key={client.id} className="settings-client"><div className={`settings-client-status${client.enabled ? ' online' : ''}`} /><div><strong>{client.name}</strong><span>{client.type} · {client.useHttps ? 'HTTPS' : 'HTTP'} · priority {client.priority}</span></div>{client.isDefault && <em>Default</em>}<div className="settings-row-actions"><button className="control-button" disabled={busy} onClick={() => test(client)}>Test</button><button className="control-button" onClick={() => edit(client)}>Edit</button><button className="control-button danger" onClick={() => remove(client)}>Delete</button></div></article>)}</div>{editor && <Section title={editor.id ? 'Edit download client' : 'Add download client'} description="Credentials are write-only. Leaving the credential blank preserves an existing value."><div className="settings-grid"><Field label="Name" error={errors.name}><input className="control-input" value={editor.name} onChange={(event) => setEditor((current) => current ? { ...current, name: event.target.value } : current)} /></Field><Field label="Type"><select className="control-select" value={editor.type} onChange={(event) => { const type = event.target.value as DownloadClientType; setEditor((current) => current ? { ...current, type, port: type === 'TRANSMISSION' ? 9091 : type === 'SABNZBD' ? 8080 : 6789 } : current); }}><option value="TRANSMISSION">Transmission</option><option value="SABNZBD">SABnzbd</option><option value="NZBGET">NZBGet</option></select></Field><Field label="Host or URL" error={errors.host}><input className="control-input" value={editor.host} onChange={(event) => setEditor((current) => current ? { ...current, host: event.target.value } : current)} placeholder="localhost or https://downloads.example.com" /></Field><Field label="Port" error={errors.port}><input className="control-input" type="number" min="1" max="65535" value={editor.port} onChange={(event) => setEditor((current) => current ? { ...current, port: Number(event.target.value) } : current)} /></Field><Field label="Username"><input className="control-input" value={editor.username ?? ''} onChange={(event) => setEditor((current) => current ? { ...current, username: event.target.value || null } : current)} /></Field><Field label={editor.type === 'SABNZBD' ? 'API key' : 'Password'} hint={editor.id ? 'Leave blank to keep the saved credential.' : undefined}><input className="control-input" type="password" autoComplete="new-password" value={editor.credential ?? ''} onChange={(event) => setEditor((current) => current ? { ...current, credential: event.target.value } : current)} placeholder={editor.id ? '••••••••' : ''} /></Field><Field label="Category"><input className="control-input" value={editor.category ?? ''} onChange={(event) => setEditor((current) => current ? { ...current, category: event.target.value || null } : current)} /></Field><Field label="Priority"><input className="control-input" type="number" value={editor.priority} onChange={(event) => setEditor((current) => current ? { ...current, priority: Number(event.target.value) } : current)} /></Field></div><Toggle label="Use HTTPS" checked={editor.useHttps} onChange={(useHttps) => setEditor((current) => current ? { ...current, useHttps } : current)} /><Toggle label="Enabled" checked={editor.enabled} onChange={(enabled) => setEditor((current) => current ? { ...current, enabled } : current)} /><Toggle label="Make default client" checked={editor.isDefault} onChange={(isDefault) => setEditor((current) => current ? { ...current, isDefault } : current)} /></Section>}</div>;
}

function ProfilesTab({ profiles, editor, setEditor, edit, remove, errors, testProfileId, setTestProfileId, releaseTitle, setReleaseTitle, releaseSize, setReleaseSize, runTest, result, busy }: { profiles: QualityProfileDTO[]; editor: (SaveQualityProfileRequest & { id?: string }) | null; setEditor: React.Dispatch<React.SetStateAction<(SaveQualityProfileRequest & { id?: string }) | null>>; edit: (profile?: QualityProfileDTO) => void; remove: (profile: QualityProfileDTO) => void; errors: Record<string, string>; testProfileId: string | null; setTestProfileId: (id: string) => void; releaseTitle: string; setReleaseTitle: (title: string) => void; releaseSize: string; setReleaseSize: (size: string) => void; runTest: () => void; result: ReleaseScoreDTO | null; busy: boolean }) {
  const update = (value: Partial<SaveQualityProfileRequest>) => setEditor((current) => current ? { ...current, ...value } : current);
  return <div className="settings-stack"><div className="settings-toolbar"><div><strong>Quality profiles</strong><span>Hard constraints reject first; preferred rules score only valid releases.</span></div><button className="control-button primary" onClick={() => edit()}>New profile</button></div><div className="settings-profile-grid">{profiles.map((profile) => <article key={profile.id}><header><div><strong>{profile.name}</strong><span>{profile.allowedResolutions.join(', ') || 'Any resolution'}</span></div><i className={profile.enabled ? 'enabled' : ''}>{profile.enabled ? 'Enabled' : 'Disabled'}</i></header><p>{profile.sourceTypes.join(' · ') || 'Any source'} · cutoff {profile.upgradeCutoffScore}</p><div><button className="control-button" onClick={() => { setTestProfileId(profile.id); document.getElementById('test-release')?.scrollIntoView({ behavior: 'smooth' }); }}>Test release</button><button className="control-button" onClick={() => edit(profile)}>Edit</button><button className="control-button danger" onClick={() => remove(profile)}>Delete</button></div></article>)}</div>{editor && <Section title={editor.id ? 'Edit quality profile' : 'New quality profile'} description="Empty allow-lists mean unrestricted. Required and rejected rules remain hard constraints."><div className="settings-grid"><Field label="Profile name" error={errors.name}><input className="control-input" value={editor.name} onChange={(event) => update({ name: event.target.value })} /></Field><Field label="Minimum file size (MB)" error={errors.minimumSizeMb}><input className="control-input" type="number" min="0" value={editor.minimumSizeMb ?? ''} onChange={(event) => update({ minimumSizeMb: event.target.value ? Number(event.target.value) : null })} /></Field><Field label="Maximum file size (MB)" error={errors.maximumSizeMb}><input className="control-input" type="number" min="1" value={editor.maximumSizeMb ?? ''} onChange={(event) => update({ maximumSizeMb: event.target.value ? Number(event.target.value) : null })} /></Field><Field label="Upgrade cutoff score"><input className="control-input" type="number" value={editor.upgradeCutoffScore} onChange={(event) => update({ upgradeCutoffScore: Number(event.target.value) })} /></Field><Field label="Minimum score improvement"><input className="control-input" type="number" min="1" value={editor.minimumScoreImprovement} onChange={(event) => update({ minimumScoreImprovement: Number(event.target.value) })} /></Field></div><div className="settings-grid profile-lists"><CsvField label="Allowed resolutions" value={editor.allowedResolutions} onChange={(allowedResolutions) => update({ allowedResolutions })} placeholder="1080p, 2160p" /><CsvField label="Source types" value={editor.sourceTypes} onChange={(sourceTypes) => update({ sourceTypes })} placeholder="WEB-DL, BluRay, Remux" /><CsvField label="Video codecs" value={editor.videoCodecs} onChange={(videoCodecs) => update({ videoCodecs })} placeholder="HEVC, H.264, AV1" /><CsvField label="HDR formats" value={editor.hdrFormats} onChange={(hdrFormats) => update({ hdrFormats })} placeholder="Dolby Vision, HDR10" /><CsvField label="Audio formats" value={editor.audioFormats} onChange={(audioFormats) => update({ audioFormats })} placeholder="TrueHD, Atmos, DTS:X" /><CsvField label="Audio channels" value={editor.audioChannels} onChange={(audioChannels) => update({ audioChannels })} placeholder="7.1, 5.1, 2.0" /><CsvField label="Languages" value={editor.languages} onChange={(languages) => update({ languages })} placeholder="English, Japanese" /><CsvField label="Release groups" value={editor.releaseGroups} onChange={(releaseGroups) => update({ releaseGroups })} placeholder="GROUP, INTERNAL" /></div><RuleEditor rules={editor.rules} onChange={(rules) => update({ rules })} /><Toggle label="Profile enabled" checked={editor.enabled} onChange={(enabled) => update({ enabled })} /></Section>}<section className="settings-test-release" id="test-release"><div><h2>Test Release</h2><p>Runs the same backend parser and scoring selector used by release selection.</p></div><div className="settings-test-controls"><select className="control-select" value={testProfileId ?? ''} onChange={(event) => setTestProfileId(event.target.value)}>{profiles.map((profile) => <option key={profile.id} value={profile.id}>{profile.name}</option>)}</select><input className="control-input" value={releaseTitle} onChange={(event) => setReleaseTitle(event.target.value)} placeholder="Movie.2026.2160p.REMUX.DV.HEVC.TrueHD.Atmos-GROUP" /><input className="control-input size" type="number" min="0" value={releaseSize} onChange={(event) => setReleaseSize(event.target.value)} placeholder="Size MB" /><button className="control-button primary" disabled={busy || !releaseTitle.trim()} onClick={runTest}>{busy ? 'Testing…' : 'Test release'}</button></div>{result && <ReleaseResult result={result} />}</section></div>;
}

function CsvField({ label, value, onChange, placeholder }: { label: string; value: string[]; onChange: (value: string[]) => void; placeholder: string }) { return <Field label={label}><input className="control-input" value={value.join(', ')} placeholder={placeholder} onChange={(event) => onChange(event.target.value.split(',').map((item) => item.trim()).filter(Boolean))} /></Field>; }
function RuleEditor({ rules, onChange }: { rules: QualityRuleDTO[]; onChange: (rules: QualityRuleDTO[]) => void }) {
  function updateRule(index: number, value: Partial<QualityRuleDTO>) { onChange(rules.map((rule, ruleIndex) => ruleIndex === index ? { ...rule, ...value } : rule)); }
  return <div className="settings-rules"><header><div><strong>Attribute rules</strong><span>Preferred rules may use positive or negative scores.</span></div><button className="control-button" onClick={() => onChange([...rules, { id: `rule-${Date.now()}`, attribute: '', kind: 'PREFERRED', score: 0 }])}>Add rule</button></header>{rules.length === 0 ? <p>No attribute rules.</p> : rules.map((rule, index) => <div className="settings-rule" key={rule.id}><input className="control-input" value={rule.attribute} onChange={(event) => updateRule(index, { attribute: event.target.value })} placeholder="Remux, Dolby Vision, CAM…" /><select className="control-select" value={rule.kind} onChange={(event) => updateRule(index, { kind: event.target.value as QualityRuleDTO['kind'] })}><option value="REQUIRED">Required</option><option value="PREFERRED">Preferred</option><option value="REJECTED">Rejected</option></select><input className="control-input score" type="number" disabled={rule.kind !== 'PREFERRED'} value={rule.score} onChange={(event) => updateRule(index, { score: Number(event.target.value) })} /><button className="control-button danger" aria-label={`Remove ${rule.attribute || 'rule'}`} onClick={() => onChange(rules.filter((_, ruleIndex) => ruleIndex !== index))}>×</button></div>)}</div>;
}
function ReleaseResult({ result }: { result: ReleaseScoreDTO }) { const parsed = result.parsed; return <div className={`settings-release-result ${result.accepted ? 'accepted' : 'rejected'}`}><header><strong>{result.accepted ? 'Accepted' : 'Rejected'}</strong><span>Total score {result.totalScore >= 0 ? '+' : ''}{result.totalScore}</span></header><dl><div><dt>Resolution</dt><dd>{parsed.resolution ?? 'Unknown'}</dd></div><div><dt>Source</dt><dd>{parsed.source ?? 'Unknown'}</dd></div><div><dt>Codec</dt><dd>{parsed.codec ?? 'Unknown'}</dd></div><div><dt>HDR</dt><dd>{parsed.hdr.join(', ') || 'Unknown'}</dd></div><div><dt>Audio</dt><dd>{[...parsed.audio, parsed.audioChannels].filter(Boolean).join(', ') || 'Unknown'}</dd></div><div><dt>Release group</dt><dd>{parsed.releaseGroup ?? 'Unknown'}</dd></div></dl>{result.matchedRules.length > 0 && <div className="settings-match-list"><strong>Matched rules</strong>{result.matchedRules.map((rule) => <span key={rule.id} className={rule.matched ? 'matched' : ''}>{rule.attribute} · {rule.kind.toLowerCase()}{rule.contribution ? ` · ${rule.contribution > 0 ? '+' : ''}${rule.contribution}` : ''}</span>)}</div>}{result.rejectionReasons.length > 0 && <div className="settings-rejections"><strong>Rejection reasons</strong>{result.rejectionReasons.map((reason) => <span key={reason}>{reason}</span>)}</div>}</div>; }

function PlaybackTab({ value, update, errors }: { value: SettingsBundleDTO['playback']; update: (value: Partial<SettingsBundleDTO['playback']>) => void; errors: Record<string, string> }) { return <div className="settings-stack"><Section title="Playback methods" description="These switches gate server playback decisions without changing the player implementation."><Toggle label="Direct Play" detail="Serve browser-compatible files without conversion." checked={value.directPlayEnabled} onChange={(directPlayEnabled) => update({ directPlayEnabled })} /><Toggle label="Direct Stream" detail="Allow remuxed HLS when only the container is incompatible." checked={value.directStreamEnabled} onChange={(directStreamEnabled) => update({ directStreamEnabled })} /><Toggle label="Transcoding" detail="Allow FFmpeg conversion for incompatible codecs and requested qualities." checked={value.transcodingEnabled} onChange={(transcodingEnabled) => update({ transcodingEnabled })} />{errors.playback && <small className="field-error">{errors.playback}</small>}</Section><Section title="Limits and acceleration" description="Bitrate limits are server policy for future adaptive sessions; empty values are unlimited."><div className="settings-grid"><Field label="Local bitrate limit (Mbps)"><input className="control-input" type="number" min="1" value={value.localBitrateLimitMbps ?? ''} onChange={(event) => update({ localBitrateLimitMbps: event.target.value ? Number(event.target.value) : null })} /></Field><Field label="Remote bitrate limit (Mbps)"><input className="control-input" type="number" min="1" value={value.remoteBitrateLimitMbps ?? ''} onChange={(event) => update({ remoteBitrateLimitMbps: event.target.value ? Number(event.target.value) : null })} /></Field><Field label="Hardware acceleration"><select className="control-select" value={value.hardwareAcceleration} onChange={(event) => update({ hardwareAcceleration: event.target.value as SettingsBundleDTO['playback']['hardwareAcceleration'] })}><option value="NONE">Disabled</option><option value="AUTO">Automatic</option><option value="VAAPI">VAAPI</option><option value="QSV">Intel Quick Sync</option><option value="NVENC">NVIDIA NVENC</option><option value="VIDEOTOOLBOX">VideoToolbox</option></select></Field></div></Section><Section title="Language preferences" description="Preferred audio selection is applied when a matching analyzed stream exists."><div className="settings-grid"><Field label="Audio language"><input className="control-input" value={value.preferredAudioLanguage ?? ''} onChange={(event) => update({ preferredAudioLanguage: event.target.value || null })} placeholder="English" /></Field><Field label="Subtitle language"><input className="control-input" value={value.preferredSubtitleLanguage ?? ''} onChange={(event) => update({ preferredSubtitleLanguage: event.target.value || null })} placeholder="English" /></Field><Field label="Subtitle mode"><select className="control-select" value={value.subtitlesMode} onChange={(event) => update({ subtitlesMode: event.target.value as SettingsBundleDTO['playback']['subtitlesMode'] })}><option value="OFF">Off</option><option value="FOREIGN_ONLY">Foreign audio only</option><option value="ALWAYS">Always</option></select></Field></div></Section><Section title="Playback behavior" description="Applied to playback preparation and the existing player controls."><Toggle label="Autoplay" checked={value.autoplayEnabled} onChange={(autoplayEnabled) => update({ autoplayEnabled })} /><Toggle label="Show Skip Intro" checked={value.skipIntroEnabled} onChange={(skipIntroEnabled) => update({ skipIntroEnabled })} /><Field label="Resume behavior"><select className="control-select" value={value.resumeBehavior} onChange={(event) => update({ resumeBehavior: event.target.value as SettingsBundleDTO['playback']['resumeBehavior'] })}><option value="ASK">Ask when progress exists</option><option value="ALWAYS">Always resume</option><option value="RESTART">Always restart</option></select></Field></Section></div>; }

function NotificationsTab({ value, update, discordSecret, setDiscordSecret, smtpSecret, setSmtpSecret, test, busy, errors }: { value: SettingsBundleDTO['notifications']; update: (value: Partial<SettingsBundleDTO['notifications']>) => void; discordSecret: string; setDiscordSecret: (value: string) => void; smtpSecret: string; setSmtpSecret: (value: string) => void; test: (kind: 'discord' | 'email') => void; busy: boolean; errors: Record<string, string> }) { return <div className="settings-stack"><Section title="Discord" description="Webhook URLs are write-only and are never returned by the API."><Toggle label="Enable Discord notifications" checked={value.discordEnabled} onChange={(discordEnabled) => update({ discordEnabled })} /><Field label="Webhook URL" error={errors.discordWebhookUrl} hint={value.discordWebhookConfigured ? 'A webhook is saved. Leave blank to keep it.' : 'No webhook configured.'}><input className="control-input" type="password" autoComplete="new-password" value={discordSecret} onChange={(event) => setDiscordSecret(event.target.value)} placeholder={value.discordWebhookConfigured ? '••••••••' : 'https://discord.com/api/webhooks/…'} /></Field><button className="control-button" disabled={busy || !value.discordWebhookConfigured} onClick={() => test('discord')}>Test notification</button></Section><Section title="Email (SMTP)" description="The test email is delivered to the configured from address using the saved SMTP credentials."><Toggle label="Enable email notifications" checked={value.smtpEnabled} onChange={(smtpEnabled) => update({ smtpEnabled })} /><div className="settings-grid"><Field label="SMTP host" error={errors.smtpHost}><input className="control-input" value={value.smtpHost ?? ''} onChange={(event) => update({ smtpHost: event.target.value || null })} /></Field><Field label="Port" error={errors.smtpPort}><input className="control-input" type="number" min="1" max="65535" value={value.smtpPort ?? ''} onChange={(event) => update({ smtpPort: event.target.value ? Number(event.target.value) : null })} /></Field><Field label="Username"><input className="control-input" value={value.smtpUsername ?? ''} onChange={(event) => update({ smtpUsername: event.target.value || null })} /></Field><Field label="Password" error={errors.smtpPassword} hint={value.smtpPasswordConfigured ? 'A password is saved. Leave blank to keep it.' : 'No password configured.'}><input className="control-input" type="password" autoComplete="new-password" value={smtpSecret} onChange={(event) => setSmtpSecret(event.target.value)} placeholder={value.smtpPasswordConfigured ? '••••••••' : ''} /></Field><Field label="From address" error={errors.smtpFromAddress}><input className="control-input" type="email" value={value.smtpFromAddress ?? ''} onChange={(event) => update({ smtpFromAddress: event.target.value || null })} /></Field></div><button className="control-button" disabled={busy || !value.smtpHost || !value.smtpFromAddress} onClick={() => test('email')}>Test email</button></Section></div>; }

function IntegrationsTab({ value, secret, setSecret, clear, busy, errors }: { value: SettingsBundleDTO['integrations']; secret: string; setSecret: (value: string) => void; clear: () => void; busy: boolean; errors: Record<string, string> }) { return <div className="settings-stack"><Section title="TMDb metadata" description="Flux uses TMDb for discovery and media metadata. API keys remain write-only."><div className="settings-integration-status"><span className={value.tmdbApiKeyConfigured ? 'online' : ''} /><div><strong>{value.tmdbApiKeyConfigured ? 'Configured' : 'Not configured'}</strong><small>{value.tmdbSource === 'DATABASE' ? 'Using the server database value' : 'Using the server environment value'}</small></div></div><Field label="Replacement API key" error={errors.tmdbApiKey} hint="Leave blank to retain the current key."><input className="control-input" type="password" autoComplete="new-password" value={secret} onChange={(event) => setSecret(event.target.value)} placeholder={value.tmdbApiKeyConfigured ? '••••••••' : ''} /></Field>{value.tmdbSource === 'DATABASE' && <button className="control-button danger" disabled={busy} onClick={clear}>Remove stored key</button>}</Section></div>; }

function validateTab(tab: Tab, settings: SettingsBundleDTO, extra: { discordSecret: string; smtpSecret: string; tmdbSecret: string; clientEditor: SaveDownloadClientRequest | null; profileEditor: SaveQualityProfileRequest | null }): Record<string, string> {
  const errors: Record<string, string> = {};
  if (tab === 'general') {
    if (!settings.general.serverName.trim()) errors.serverName = 'Server name is required.';
    for (const key of ['frontendUrl', 'apiUrl'] as const) { const value = settings.general[key]; if (value) { try { new URL(value); } catch { errors[key] = 'Enter a valid absolute URL.'; } } }
    if (!settings.general.timezone.trim()) errors.timezone = 'Time zone is required.';
    if (!/^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/.test(settings.general.language)) errors.language = 'Use a language tag such as en or en-US.';
    if (settings.general.defaultInviteExpiryHours < 1) errors.defaultInviteExpiryHours = 'Expiry must be at least one hour.';
  } else if (tab === 'storage') {
    if (!Number.isInteger(settings.storage.reserveSpaceGb) || settings.storage.reserveSpaceGb < 0) errors.reserveSpaceGb = 'Reserve must be a whole number of gigabytes.';
  } else if (tab === 'downloads') {
    if (settings.downloads.minimumFreeSpaceGb < 0) errors.minimumFreeSpaceGb = 'Free space cannot be negative.';
  } else if (tab === 'playback') {
    if (!settings.playback.directPlayEnabled && !settings.playback.directStreamEnabled && !settings.playback.transcodingEnabled) errors.playback = 'At least one playback method must remain enabled.';
  } else if (tab === 'notifications') {
    const notification = settings.notifications;
    if (notification.discordEnabled && !notification.discordWebhookConfigured && !extra.discordSecret) errors.discordWebhookUrl = 'A webhook URL is required while Discord is enabled.';
    if (extra.discordSecret) { try { new URL(extra.discordSecret); } catch { errors.discordWebhookUrl = 'Enter a valid webhook URL.'; } }
    if (notification.smtpEnabled && !notification.smtpHost) errors.smtpHost = 'SMTP host is required.';
    if (notification.smtpEnabled && !notification.smtpPort) errors.smtpPort = 'SMTP port is required.';
    if (notification.smtpEnabled && !notification.smtpFromAddress) errors.smtpFromAddress = 'From address is required.';
    if (notification.smtpFromAddress && !/^\S+@\S+\.\S+$/.test(notification.smtpFromAddress)) errors.smtpFromAddress = 'Enter a valid email address.';
  } else if (tab === 'integrations' && extra.tmdbSecret && extra.tmdbSecret.trim().length < 8) errors.tmdbApiKey = 'TMDb keys must be at least 8 characters.';
  return errors;
}
function validateClient(client: SaveDownloadClientRequest): Record<string, string> {
  const errors: Record<string, string> = {};
  if (!client.name.trim()) errors.name = 'Name is required.';
  if (!client.host.trim()) errors.host = 'Host or URL is required.';
  else if (/^https?:\/\//i.test(client.host)) {
    try {
      const url = new URL(client.host);
      if (url.username || url.password) errors.host = 'Use the dedicated credential fields instead of URL credentials.';
    } catch { errors.host = 'Enter a valid host or absolute URL.'; }
  }
  if (!Number.isInteger(client.port) || client.port < 1 || client.port > 65535) errors.port = 'Port must be between 1 and 65535.';
  return errors;
}
function validateProfile(profile: SaveQualityProfileRequest): Record<string, string> { const errors: Record<string, string> = {}; if (!profile.name.trim()) errors.name = 'Name is required.'; if (profile.minimumSizeMb !== null && profile.maximumSizeMb !== null && profile.minimumSizeMb > profile.maximumSizeMb) errors.maximumSizeMb = 'Maximum must be greater than minimum.'; if (profile.minimumScoreImprovement < 1) errors.minimumScoreImprovement = 'Improvement must be at least 1.'; if (profile.rules.some((rule) => !rule.attribute.trim())) errors.rules = 'Every rule needs an attribute.'; return errors; }
