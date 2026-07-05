'use client';

import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import type { ProfileDTO } from '@flux/shared';
import { useAuth } from '@/lib/auth-context';
import { FluxApiError } from '@/lib/api';
import { RequireAuth } from '@/components/Guards';

function initials(name: string): string {
  return name.trim().slice(0, 1).toUpperCase() || '?';
}

function ProfilePicker() {
  const { account, profiles, activateProfile, addProfile } = useAuth();
  const router = useRouter();

  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState('');
  const [creating, setCreating] = useState(false);

  async function choose(profile: ProfileDTO) {
    setError(null);
    setBusyId(profile.id);
    try {
      await activateProfile(profile.id);
      router.replace('/home');
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
      const profile = await addProfile({ name: newName.trim() });
      setNewName('');
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
        <h1>Who&apos;s watching?</h1>
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
              className="profile-card"
              onClick={() => choose(p)}
              disabled={busyId !== null}
            >
              <span className="profile-avatar">
                {busyId === p.id ? '…' : initials(p.name)}
              </span>
              <span className="profile-card-name">{p.name}</span>
            </button>
          ))}

          {!adding && (
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
                }}
                disabled={creating}
              >
                Cancel
              </button>
            </div>
          </form>
        )}
      </div>
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
