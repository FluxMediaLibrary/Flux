'use client';

import { useCallback, useEffect, useState } from 'react';
import type { InviteDTO } from '@flux/shared';
import { api, FluxApiError } from '@/lib/api';

function formatDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString();
}

function isExpired(inv: InviteDTO): boolean {
  return new Date(inv.expiresAt).getTime() <= Date.now();
}

export default function AdminInvitesPage() {
  const [invites, setInvites] = useState<InviteDTO[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [expiresInHours, setExpiresInHours] = useState(72);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const list = await api.listInvites();
      setInvites(list);
    } catch (err) {
      setError(err instanceof FluxApiError ? err.message : 'Failed to load invites.');
      setInvites([]);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function createInvite() {
    setError(null);
    setCreating(true);
    try {
      const invite = await api.createInvite({ expiresInHours });
      setInvites((prev) => [invite, ...(prev ?? [])]);
    } catch (err) {
      setError(err instanceof FluxApiError ? err.message : 'Failed to create invite.');
    } finally {
      setCreating(false);
    }
  }

  async function copy(inv: InviteDTO) {
    try {
      await navigator.clipboard.writeText(inv.url);
      setCopiedId(inv.id);
      setTimeout(() => setCopiedId((c) => (c === inv.id ? null : c)), 1500);
    } catch {
      /* clipboard unavailable — ignore */
    }
  }

  return (
    <div>
      <div className="section-head">
        <h1>Invites</h1>
        <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end' }}>
          <div>
            <label htmlFor="hours">Expires in (hours)</label>
            <input
              id="hours"
              className="input"
              type="number"
              min={1}
              max={8760}
              value={expiresInHours}
              onChange={(e) => setExpiresInHours(Number(e.target.value))}
              style={{ width: 130 }}
            />
          </div>
          <button
            className="btn btn-primary"
            type="button"
            onClick={createInvite}
            disabled={creating}
          >
            {creating ? 'Creating…' : 'Create invite'}
          </button>
        </div>
      </div>

      {error && <div className="form-error">{error}</div>}

      {invites === null ? (
        <div className="empty">
          <div className="spinner" style={{ margin: '0 auto 12px' }} aria-hidden />
          Loading invites…
        </div>
      ) : invites.length === 0 ? (
        <div className="card empty">
          No invites yet. Create one to onboard a new member.
        </div>
      ) : (
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th>Code</th>
                <th>Status</th>
                <th>Expires</th>
                <th>Created</th>
                <th>Link</th>
              </tr>
            </thead>
            <tbody>
              {invites.map((inv) => {
                const used = inv.usedAt !== null;
                const expired = !used && isExpired(inv);
                return (
                  <tr key={inv.id}>
                    <td>
                      <span className="code">{inv.code}</span>
                    </td>
                    <td>
                      {used ? (
                        <span className="pill used">Used</span>
                      ) : expired ? (
                        <span className="pill used">Expired</span>
                      ) : (
                        <span className="pill ok">Active</span>
                      )}
                    </td>
                    <td>{formatDate(inv.expiresAt)}</td>
                    <td>{formatDate(inv.createdAt)}</td>
                    <td>
                      <button
                        className="copy-btn"
                        type="button"
                        onClick={() => copy(inv)}
                        disabled={used}
                        title={inv.url}
                      >
                        {copiedId === inv.id ? 'Copied!' : 'Copy link'}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
