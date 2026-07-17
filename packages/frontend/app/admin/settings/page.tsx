'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import type { NotificationSettingsDTO } from '@flux/shared';
import { PageHeader } from '@/components/admin/AdminUI';

type AndroidAppInfo = {
  versionName?: string;
  versionCode?: number;
  automaticUpdates?: boolean;
  updateServer?: string;
};

declare global {
  interface Window {
    FLUX_NATIVE_APP?: boolean;
    FluxNative?: {
      isNativeApp?: () => boolean;
      getAppInfo?: () => string;
      requestCast?: () => void;
      checkForUpdates?: () => void;
      setAutomaticUpdates?: (enabled: boolean) => void;
      clearUpdateDownloads?: () => void;
      setPlaybackContext?: (payload: string) => void;
    };
  }
}

export default function AdminSettingsPage() {
  const [settings, setSettings] = useState<NotificationSettingsDTO | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [androidInfo, setAndroidInfo] = useState<AndroidAppInfo | null>(null);
  const [androidAutomaticUpdates, setAndroidAutomaticUpdates] = useState(true);

  // Form state
  const [discordEnabled, setDiscordEnabled] = useState(false);
  const [discordUrl, setDiscordUrl] = useState('');
  const [smtpEnabled, setSmtpEnabled] = useState(false);
  const [smtpHost, setSmtpHost] = useState('');
  const [smtpPort, setSmtpPort] = useState('');
  const [smtpUsername, setSmtpUsername] = useState('');
  const [smtpPassword, setSmtpPassword] = useState('');
  const [smtpFrom, setSmtpFrom] = useState('');

  useEffect(() => {
    api.getNotificationSettings().then(
      (data) => {
        setSettings(data);
        setDiscordEnabled(data.discordEnabled);
        setDiscordUrl(data.discordWebhookUrl ?? '');
        setSmtpEnabled(data.smtpEnabled);
        setSmtpHost(data.smtpHost ?? '');
        setSmtpPort(data.smtpPort ? String(data.smtpPort) : '');
        setSmtpUsername(data.smtpUsername ?? '');
        setSmtpFrom(data.smtpFromAddress ?? '');
        setLoading(false);
      },
      (err) => {
        setError(err.message ?? 'Failed to load settings');
        setLoading(false);
      },
    );
  }, []);

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

  function handleAndroidAutomaticUpdates(checked: boolean) {
    setAndroidAutomaticUpdates(checked);
    window.FluxNative?.setAutomaticUpdates?.(checked);
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    setSuccess(false);
    try {
      const body: any = {
        discordEnabled,
        discordWebhookUrl: discordEnabled ? discordUrl || null : null,
        smtpEnabled,
        smtpHost: smtpEnabled ? smtpHost || null : null,
        smtpPort: smtpEnabled && smtpPort ? parseInt(smtpPort, 10) : null,
        smtpUsername: smtpEnabled ? smtpUsername || null : null,
        smtpPassword: smtpEnabled && smtpPassword ? smtpPassword : undefined,
        smtpFromAddress: smtpEnabled ? smtpFrom || null : null,
      };
      await api.updateNotificationSettings(body);
      setSuccess(true);
      setSmtpPassword('');
      setTimeout(() => setSuccess(false), 3000);
    } catch (err: any) {
      setError(err.message ?? 'Failed to save');
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="centered-viewport">
        <div className="spinner" />
        <p className="muted">Loading settings...</p>
      </div>
    );
  }

  return (
    <div className="control-page control-settings-page">
      <PageHeader title="Settings" description="Server integrations, delivery channels, and Android application behavior." />

      {error && <div className="form-error">{error}</div>}
      {success && (
        <div
          style={{
            background: 'rgba(61,220,151,0.12)',
            border: '1px solid rgba(61,220,151,0.4)',
            color: '#3ddc97',
            padding: '10px 12px',
            borderRadius: 'var(--radius-sm)',
            marginBottom: 16,
          }}
        >
          Settings saved.
        </div>
      )}

      {androidInfo && (
        <section className="form-group" id="updates">
          <h2>Updates</h2>
          <div className="settings-meta-grid">
            <div>
              <span>Installed version</span>
              <strong>
                {androidInfo.versionName ?? 'Unknown'}
                {typeof androidInfo.versionCode === 'number' ? ` (${androidInfo.versionCode})` : ''}
              </strong>
            </div>
            {androidInfo.updateServer && (
              <div>
                <span>Update server</span>
                <strong>{androidInfo.updateServer}</strong>
              </div>
            )}
          </div>
          <div className="toggle-row">
            <span className="toggle-label">Check for updates automatically</span>
            <label className="toggle-switch">
              <input
                type="checkbox"
                checked={androidAutomaticUpdates}
                onChange={(e) => handleAndroidAutomaticUpdates(e.target.checked)}
              />
              <span className="toggle-track" />
            </label>
          </div>
          <div className="settings-actions">
            <button className="btn btn-primary" type="button" onClick={() => window.FluxNative?.checkForUpdates?.()}>
              Check for updates
            </button>
            <button className="btn btn-ghost" type="button" onClick={() => window.FluxNative?.clearUpdateDownloads?.()}>
              Clear downloaded files
            </button>
          </div>
        </section>
      )}

      <form onSubmit={handleSave}>
        {/* Discord */}
        <div className="form-group">
          <h2>Discord</h2>
          <div className="toggle-row">
            <span className="toggle-label">Enable Discord notifications</span>
            <label className="toggle-switch">
              <input
                type="checkbox"
                checked={discordEnabled}
                onChange={(e) => setDiscordEnabled(e.target.checked)}
              />
              <span className="toggle-track" />
            </label>
          </div>
          {discordEnabled && (
            <div className="field">
              <label>Webhook URL</label>
              <input
                className="input"
                type="url"
                placeholder="https://discord.com/api/webhooks/..."
                value={discordUrl}
                onChange={(e) => setDiscordUrl(e.target.value)}
              />
            </div>
          )}
        </div>

        {/* SMTP */}
        <div className="form-group">
          <h2>Email (SMTP)</h2>
          <div className="toggle-row">
            <span className="toggle-label">Enable email notifications</span>
            <label className="toggle-switch">
              <input
                type="checkbox"
                checked={smtpEnabled}
                onChange={(e) => setSmtpEnabled(e.target.checked)}
              />
              <span className="toggle-track" />
            </label>
          </div>
          {smtpEnabled && (
            <>
              <div className="form-row">
                <div className="field">
                  <label>SMTP Host</label>
                  <input
                    className="input"
                    placeholder="smtp.example.com"
                    value={smtpHost}
                    onChange={(e) => setSmtpHost(e.target.value)}
                  />
                </div>
                <div className="field">
                  <label>Port</label>
                  <input
                    className="input"
                    type="number"
                    placeholder="587"
                    value={smtpPort}
                    onChange={(e) => setSmtpPort(e.target.value)}
                  />
                </div>
              </div>
              <div className="form-row">
                <div className="field">
                  <label>Username</label>
                  <input
                    className="input"
                    value={smtpUsername}
                    onChange={(e) => setSmtpUsername(e.target.value)}
                  />
                </div>
                <div className="field">
                  <label>Password {settings && !settings.smtpUsername && '(write-only)'}</label>
                  <input
                    className="input"
                    type="password"
                    placeholder={settings ? '••••••••' : ''}
                    value={smtpPassword}
                    onChange={(e) => setSmtpPassword(e.target.value)}
                  />
                </div>
              </div>
              <div className="field">
                <label>From Address</label>
                <input
                  className="input"
                  type="email"
                  placeholder="flux@example.com"
                  value={smtpFrom}
                  onChange={(e) => setSmtpFrom(e.target.value)}
                />
              </div>
            </>
          )}
        </div>

        <button className="btn btn-primary" type="submit" disabled={saving}>
          {saving ? 'Saving...' : 'Save Settings'}
        </button>
      </form>
    </div>
  );
}
