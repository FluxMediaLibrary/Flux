'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import type { NotificationSettingsDTO } from '@flux/shared';

export default function AdminSettingsPage() {
  const [settings, setSettings] = useState<NotificationSettingsDTO | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

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
    <div>
      <h1 style={{ fontSize: '1.9rem', marginBottom: 28 }}>Notification Settings</h1>

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
