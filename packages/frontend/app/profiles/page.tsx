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
            <Avatar name={name || '?'} avatar={preset.id} size={52} />
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
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setError(null);
    setSaving(true);
    try {
      await editProfile(profile.id, { name: name.trim(), avatar });
      onClose();
    } catch (err) {
      setError(err instanceof FluxApiError ? err.message : 'Could not save changes.');
      setSaving(false);
    }
  }

  async function remove() {
    if (!window.confirm(`Delete the profile "${profile.name}"? This cannot be undone.`)) {
      return;
    }
    setError(null);
    setDeleting(true);
    try {
      await removeProfile(profile.id);
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

function ProfilePicker() {
  const { account, profiles, activateProfile, addProfile } = useAuth();
  const router = useRouter();

  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState('');
  const [newAvatar, setNewAvatar] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [managing, setManaging] = useState(false);
  const [editing, setEditing] = useState<ProfileDTO | null>(null);

  async function choose(profile: ProfileDTO) {
    setError(null);
    setBusyId(profile.id);
    try {
      await activateProfile(profile.id);
      router.replace('/library');
    } catch (err) {
      setError(err instanceof FluxApiError ? err.message : 'Could not select profile.');
      setBusyId(null);
    }
  }

  async function create(e: FormEvent) {
    e.preventDefault();
    if (!newName.trim()) return;
    setError(null);
    setCreating(true);
    try {
      const profile = await addProfile({
        name: newName.trim(),
        ...(newAvatar ? { avatar: newAvatar } : {}),
      });
      setNewName('');
      setNewAvatar(null);
      setAdding(false);
      await choose(profile);
    } catch (err) {
      setError(err instanceof FluxApiError ? err.message : 'Could not create profile.');
      setCreating(false);
    }
  }

  return (
    <main className="profiles-shell">
      <div className="profiles-inner">
        <h1>{managing ? 'Manage profiles' : "Who's watching?"}</h1>
        <p className="muted">{account?.email}</p>

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
