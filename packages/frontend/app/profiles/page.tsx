'use client';

import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import {
  AVATAR_PRESETS,
  AVATAR_CATEGORY_ORDER,
  type AvatarCategory,
  type ProfileDTO,
} from '@flux/shared';
import { useAuth } from '@/lib/auth-context';
import { FluxApiError } from '@/lib/api';
import { RequireAuth } from '@/components/Guards';
import { Avatar } from '@/components/Avatar';

/**
 * Selectable premade avatars, organised into category tabs. `value` is a preset
 * id or null (initials fallback). One tab is shown at a time so the 80+ icons
 * stay browsable instead of an endless scroll.
 */
function AvatarPicker({
  name,
  value,
  onChange,
}: {
  name: string;
  value: string | null;
  onChange: (id: string | null) => void;
}) {
  // Open on the tab that holds the current selection (else the first tab).
  const initialTab: AvatarCategory =
    AVATAR_PRESETS.find((p) => p.id === value)?.category ?? AVATAR_CATEGORY_ORDER[0];
  const [tab, setTab] = useState<AvatarCategory>(initialTab);

  const presets = AVATAR_PRESETS.filter((p) => p.category === tab);

  return (
    <div className="avatar-picker">
      <div className="avatar-tabs" role="tablist" aria-label="Avatar categories">
        {AVATAR_CATEGORY_ORDER.map((cat: AvatarCategory) => (
          <button
            key={cat}
            type="button"
            role="tab"
            aria-selected={tab === cat}
            className={`avatar-tab${tab === cat ? ' active' : ''}`}
            onClick={() => setTab(cat)}
          >
            {cat}
          </button>
        ))}
      </div>

      <div
        className="avatar-option-grid"
        role="radiogroup"
        aria-label={`${tab} avatars`}
      >
        {presets.map((preset) => (
          <button
            key={preset.id}
            type="button"
            role="radio"
            aria-checked={value === preset.id}
            className={`avatar-option${value === preset.id ? ' selected' : ''}`}
            onClick={() => onChange(preset.id)}
            title={preset.label}
          >
            <Avatar name={name || '?'} avatar={preset.id} size={68} />
          </button>
        ))}
      </div>

      <button
        type="button"
        className={`avatar-clear${value === null ? ' active' : ''}`}
        onClick={() => onChange(null)}
      >
        Use my initial instead
      </button>
    </div>
  );
}

function EditProfileModal({
  profile,
  canDelete,
  onClose,
}: {
  profile: ProfileDTO;
  canDelete: boolean;
  onClose: () => void;
}) {
  const { editProfile, removeProfile } = useAuth();
  const [name, setName] = useState(profile.name);
  const [avatar, setAvatar] = useState<string | null>(profile.avatar);
  const [pin, setPin] = useState('');
  const [removePin, setRemovePin] = useState(false);
  const [accountPassword, setAccountPassword] = useState('');
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setError(null);
    setSaving(true);
    try {
      if (pin && !/^\d{4}$/.test(pin)) {
        setError('PIN must be exactly four digits.');
        setSaving(false);
        return;
      }
      if ((pin || removePin) && !accountPassword) {
        setError('Enter the account password to change this profile PIN.');
        setSaving(false);
        return;
      }
      await editProfile(profile.id, {
        name: name.trim(),
        avatar,
        ...(removePin ? { pin: null } : pin ? { pin } : {}),
        ...(pin || removePin ? { accountPassword } : {}),
      });
      onClose();
    } catch (err) {
      setError(err instanceof FluxApiError ? err.message : 'Could not save changes.');
      setSaving(false);
    }
  }

  async function remove() {
    if (profile.hasPin && !accountPassword) {
      setError('Enter the account password before deleting this protected profile.');
      return;
    }
    if (!window.confirm(`Delete the profile "${profile.name}"? This cannot be undone.`)) {
      return;
    }
    setError(null);
    setDeleting(true);
    try {
      await removeProfile(profile.id, profile.hasPin ? { accountPassword } : {});
      onClose();
    } catch (err) {
      setError(err instanceof FluxApiError ? err.message : 'Could not delete profile.');
      setDeleting(false);
    }
  }

  const busy = saving || deleting;

  return (
    <div className="modal-overlay" onClick={onClose} role="presentation">
      <div
        className="modal-card"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Edit profile"
      >
        <h2 style={{ marginBottom: 18 }}>Edit profile</h2>

        {error && <div className="form-error" style={{ marginBottom: 14 }}>{error}</div>}

        <form onSubmit={save}>
          <div className="field">
            <label htmlFor="edit-name">Profile name</label>
            <input
              id="edit-name"
              className="input"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={40}
              autoFocus
              required
            />
          </div>

          <div className="field">
            <label>Avatar</label>
            <AvatarPicker name={name} value={avatar} onChange={setAvatar} />
          </div>

          <div className="field profile-pin-field">
            <label htmlFor="edit-pin">{profile.hasPin ? 'Change profile PIN' : 'Add a profile PIN'}</label>
            <input
              id="edit-pin"
              className="input profile-pin-input"
              type="password"
              inputMode="numeric"
              autoComplete="new-password"
              pattern="\d{4}"
              maxLength={4}
              value={pin}
              disabled={removePin}
              placeholder={profile.hasPin ? 'Leave blank to keep current PIN' : 'Optional 4-digit PIN'}
              onChange={(event) => setPin(event.target.value.replace(/\D/g, '').slice(0, 4))}
            />
            <span className="field-hint">This PIN locks only this profile. Your account password remains the recovery key.</span>
            {profile.hasPin && (
              <button
                className="btn btn-ghost danger"
                type="button"
                onClick={() => {
                  setRemovePin((value) => !value);
                  setPin('');
                }}
              >
                {removePin ? 'Keep current PIN' : 'Remove PIN'}
              </button>
            )}
          </div>

          {(profile.hasPin || pin || removePin) && (
            <div className="field">
              <label htmlFor="profile-account-password">Account password</label>
              <input
                id="profile-account-password"
                className="input"
                type="password"
                autoComplete="current-password"
                value={accountPassword}
                onChange={(event) => setAccountPassword(event.target.value)}
                placeholder="Required for PIN changes or protected-profile deletion"
              />
              <span className="field-hint">Prevents someone at the profile picker from removing the lock.</span>
            </div>
          )}

          <div className="modal-actions">
            {canDelete && (
              <button
                className="btn btn-ghost danger"
                type="button"
                onClick={remove}
                disabled={busy}
              >
                {deleting ? 'Deleting…' : 'Delete'}
              </button>
            )}
            <div style={{ display: 'flex', gap: 10, marginLeft: 'auto' }}>
              <button
                className="btn btn-ghost"
                type="button"
                onClick={onClose}
                disabled={busy}
              >
                Cancel
              </button>
              <button className="btn btn-primary" type="submit" disabled={busy}>
                {saving ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}

function ProfilePinModal({
  profile,
  busy,
  error,
  onSubmit,
  onClose,
}: {
  profile: ProfileDTO;
  busy: boolean;
  error: string | null;
  onSubmit: (pin: string) => void;
  onClose: () => void;
}) {
  const [pin, setPin] = useState('');

  return (
    <div className="modal-overlay profile-pin-overlay" role="presentation" onClick={onClose}>
      <form
        className="modal-card profile-pin-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="profile-pin-title"
        onClick={(event) => event.stopPropagation()}
        onSubmit={(event) => {
          event.preventDefault();
          if (pin.length === 4) onSubmit(pin);
        }}
      >
        <div className="profile-pin-avatar">
          <Avatar name={profile.name} avatar={profile.avatar} size={82} />
          <span className="profile-lock-badge" aria-hidden>⌁</span>
        </div>
        <p className="profile-pin-kicker">Protected profile</p>
        <h2 id="profile-pin-title">Enter {profile.name}&apos;s PIN</h2>
        <p className="muted">Four digits unlock this profile for watching.</p>
        <input
          className="input profile-pin-entry"
          type="password"
          inputMode="numeric"
          autoComplete="one-time-code"
          aria-label="Four-digit profile PIN"
          pattern="\d{4}"
          maxLength={4}
          value={pin}
          autoFocus
          disabled={busy}
          onChange={(event) => setPin(event.target.value.replace(/\D/g, '').slice(0, 4))}
        />
        <div className="profile-pin-dots" aria-hidden>
          {[0, 1, 2, 3].map((index) => (
            <span key={index} className={index < pin.length ? 'filled' : ''} />
          ))}
        </div>
        {error && <div className="form-error">{error}</div>}
        <div className="modal-actions profile-pin-actions">
          <button className="btn btn-ghost" type="button" onClick={onClose} disabled={busy}>Back</button>
          <button className="btn btn-primary" type="submit" disabled={busy || pin.length !== 4}>
            {busy ? 'Unlocking…' : 'Continue'}
          </button>
        </div>
      </form>
    </div>
  );
}

function ProfilePicker() {
  const { profiles, activateProfile, addProfile } = useAuth();
  const router = useRouter();

  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState('');
  const [newAvatar, setNewAvatar] = useState<string | null>(null);
  const [newPin, setNewPin] = useState('');
  const [creating, setCreating] = useState(false);
  const [managing, setManaging] = useState(false);
  const [editing, setEditing] = useState<ProfileDTO | null>(null);
  const [lockedProfile, setLockedProfile] = useState<ProfileDTO | null>(null);
  const [pinError, setPinError] = useState<string | null>(null);

  async function choose(profile: ProfileDTO, pin?: string) {
    if (profile.hasPin && !pin) {
      setPinError(null);
      setLockedProfile(profile);
      return;
    }
    setError(null);
    setPinError(null);
    setBusyId(profile.id);
    try {
      await activateProfile(profile.id, pin);
      setLockedProfile(null);
      router.replace('/library');
    } catch (err) {
      const message = err instanceof FluxApiError ? err.message : 'Could not select profile.';
      if (profile.hasPin) setPinError(message);
      else setError(message);
      setBusyId(null);
    }
  }

  async function create(e: FormEvent) {
    e.preventDefault();
    if (!newName.trim()) return;
    setError(null);
    setCreating(true);
    try {
      const createdPin = newPin;
      const profile = await addProfile({
        name: newName.trim(),
        ...(newAvatar ? { avatar: newAvatar } : {}),
        ...(createdPin ? { pin: createdPin } : {}),
      });
      setNewName('');
      setNewAvatar(null);
      setNewPin('');
      setAdding(false);
      await choose(profile, createdPin || undefined);
    } catch (err) {
      setError(err instanceof FluxApiError ? err.message : 'Could not create profile.');
      setCreating(false);
    }
  }

  return (
    <main className="profiles-shell">
      <div className="profiles-inner">
        <h1>{managing ? 'Manage profiles' : "Who's watching?"}</h1>
        

        {error && (
          <div className="form-error" style={{ maxWidth: 360, margin: '18px auto 0' }}>
            {error}
          </div>
        )}

        <div className="profiles-grid">
          {profiles.map((p) => (
            <button
              key={p.id}
              type="button"
              className={`profile-card${managing ? ' managing' : ''}`}
              onClick={() => (managing ? setEditing(p) : choose(p))}
              disabled={busyId !== null}
            >
              <span className="profile-avatar-wrap">
                <Avatar name={p.name} avatar={p.avatar} size={118} />
                {managing && <span className="profile-edit-badge">✎</span>}
                {p.hasPin && !managing && (
                  <span className="profile-lock-badge" title="PIN protected" aria-label="PIN protected">⌁</span>
                )}
                {busyId === p.id && <span className="profile-avatar-busy">…</span>}
              </span>
              <span className="profile-card-name">{p.name}</span>
            </button>
          ))}

          {!adding && !managing && (
            <button
              type="button"
              className="profile-card"
              onClick={() => setAdding(true)}
              disabled={busyId !== null}
            >
              <span className="profile-avatar add">+</span>
              <span className="profile-card-name">Add profile</span>
            </button>
          )}
        </div>

        {adding && (
          <form className="inline-form" onSubmit={create}>
            <div className="field">
              <label htmlFor="pname">Profile name</label>
              <input
                id="pname"
                className="input"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                maxLength={40}
                autoFocus
                required
              />
            </div>
            <div className="field">
              <label>Avatar</label>
              <AvatarPicker name={newName} value={newAvatar} onChange={setNewAvatar} />
            </div>
            <div className="field">
              <label htmlFor="new-pin">Profile PIN</label>
              <input
                id="new-pin"
                className="input profile-pin-input"
                type="password"
                inputMode="numeric"
                autoComplete="new-password"
                pattern="\d{4}"
                maxLength={4}
                value={newPin}
                placeholder="Optional 4-digit PIN"
                onChange={(event) => setNewPin(event.target.value.replace(/\D/g, '').slice(0, 4))}
              />
            </div>
            <div style={{ display: 'flex', gap: 10 }}>
              <button className="btn btn-primary" type="submit" disabled={creating}>
                {creating ? 'Creating…' : 'Create & enter'}
              </button>
              <button
                className="btn btn-ghost"
                type="button"
                onClick={() => {
                  setAdding(false);
                  setNewName('');
                  setNewAvatar(null);
                  setNewPin('');
                }}
                disabled={creating}
              >
                Cancel
              </button>
            </div>
          </form>
        )}

        {!adding && (
          <button
            type="button"
            className="btn btn-ghost"
            style={{ marginTop: 30 }}
            onClick={() => setManaging((m) => !m)}
            disabled={busyId !== null}
          >
            {managing ? 'Done' : 'Manage profiles'}
          </button>
        )}
      </div>

      {editing && (
        <EditProfileModal
          profile={editing}
          canDelete={profiles.length > 1}
          onClose={() => setEditing(null)}
        />
      )}
      {lockedProfile && (
        <ProfilePinModal
          profile={lockedProfile}
          busy={busyId === lockedProfile.id}
          error={pinError}
          onSubmit={(pin) => void choose(lockedProfile, pin)}
          onClose={() => {
            if (busyId) return;
            setLockedProfile(null);
            setPinError(null);
          }}
        />
      )}
    </main>
  );
}

export default function ProfilesPage() {
  return (
    <RequireAuth>
      <ProfilePicker />
    </RequireAuth>
  );
}
