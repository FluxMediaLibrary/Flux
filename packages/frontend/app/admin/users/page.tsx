'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { ADMIN_PERMISSIONS, type AdminPermission, type AdminUserDTO, type InviteDTO, type Role } from '@flux/shared';
import { api, FluxApiError } from '@/lib/api';
import { ConfirmDialog, DataTable, LoadingState, PageError, PageHeader, StatusBadge, type DataColumn } from '@/components/admin/AdminUI';

const PRESETS: Record<string, { role: Role; permissions: AdminPermission[] }> = {
  owner: { role: 'ADMIN', permissions: [...ADMIN_PERMISSIONS] },
  administrator: { role: 'ADMIN', permissions: [...ADMIN_PERMISSIONS] },
  media: { role: 'MEMBER', permissions: ['VIEW_SYSTEM', 'MANAGE_LIBRARY', 'MANAGE_DOWNLOADS'] },
  requests: { role: 'MEMBER', permissions: ['VIEW_SYSTEM', 'MANAGE_REQUESTS'] },
  viewer: { role: 'MEMBER', permissions: [] },
};

function relativeTime(value: string | null): string {
  if (!value) return 'Never';
  const minutes = Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 60_000));
  if (minutes < 1) return 'Now';
  if (minutes < 60) return `${minutes}m ago`;
  if (minutes < 1440) return `${Math.floor(minutes / 60)}h ago`;
  return `${Math.floor(minutes / 1440)}d ago`;
}

export default function AdminUsersPage() {
  const [users, setUsers] = useState<AdminUserDTO[] | null>(null);
  const [invites, setInvites] = useState<InviteDTO[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [creatingInvite, setCreatingInvite] = useState(false);
  const [disableTarget, setDisableTarget] = useState<AdminUserDTO | null>(null);
  const [role, setRole] = useState<Role>('MEMBER');
  const [permissions, setPermissions] = useState<AdminPermission[]>([]);
  const [requestLimit, setRequestLimit] = useState('');
  const [streamLimit, setStreamLimit] = useState('');

  const load = useCallback(async () => {
    setError(null);
    try {
      const [userRows, inviteRows] = await Promise.all([api.listAdminUsers(), api.listInvites()]);
      setUsers(userRows);
      setInvites(inviteRows);
    } catch (err) {
      setError(err instanceof FluxApiError ? err.message : 'Users could not be loaded.');
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const selected = useMemo(() => users?.find((user) => user.id === selectedId) ?? null, [users, selectedId]);
  useEffect(() => {
    if (!selected) return;
    setRole(selected.role);
    setPermissions(selected.permissions);
    setRequestLimit(selected.requestLimit?.toString() ?? '');
    setStreamLimit(selected.streamLimit?.toString() ?? '');
  }, [selected]);

  const updateRow = (updated: AdminUserDTO) => setUsers((current) => current?.map((user) => user.id === updated.id ? updated : user) ?? null);
  const save = async () => {
    if (!selected) return;
    setSaving(true); setError(null);
    try {
      updateRow(await api.updateAdminUser(selected.id, {
        role,
        permissions: role === 'ADMIN' ? [...ADMIN_PERMISSIONS] : permissions,
        requestLimit: requestLimit ? Number(requestLimit) : null,
        streamLimit: streamLimit ? Number(streamLimit) : null,
      }));
      setSelectedId(null);
    } catch (err) { setError(err instanceof FluxApiError ? err.message : 'User changes could not be saved.'); }
    finally { setSaving(false); }
  };
  const disable = async () => {
    if (!disableTarget) return;
    setSaving(true); setError(null);
    try { updateRow(await api.updateAdminUser(disableTarget.id, { disabled: !disableTarget.disabled })); setDisableTarget(null); }
    catch (err) { setError(err instanceof FluxApiError ? err.message : 'Account status could not be changed.'); }
    finally { setSaving(false); }
  };
  const createInvite = async () => {
    setCreatingInvite(true); setError(null);
    try {
      const invite = await api.createInvite({});
      setInvites((current) => [invite, ...current]);
      await navigator.clipboard?.writeText(invite.code);
    } catch (err) { setError(err instanceof FluxApiError ? err.message : 'Invite could not be created.'); }
    finally { setCreatingInvite(false); }
  };

  const columns: DataColumn<AdminUserDTO>[] = [
    { key: 'user', label: 'Account', render: (user) => <div><strong>{user.profiles.map((profile) => profile.name).join(', ') || 'No profiles'}</strong><small>{user.email}</small></div> },
    { key: 'access', label: 'Access', render: (user) => <div><StatusBadge tone={user.disabled ? 'bad' : user.role === 'ADMIN' ? 'warn' : user.permissions.length > 0 ? 'info' : 'neutral'}>{user.disabled ? 'Disabled' : user.role === 'ADMIN' ? 'Administrator' : user.permissions.length > 0 ? 'Delegated' : 'Viewer'}</StatusBadge><small>{user.permissions.length} permission{user.permissions.length === 1 ? '' : 's'}</small></div> },
    { key: 'activity', label: 'Last active', render: (user) => <div>{relativeTime(user.lastActiveAt)}<small>{user.currentStreamCount} active stream{user.currentStreamCount === 1 ? '' : 's'}</small></div> },
    { key: 'usage', label: 'Requests', render: (user) => <div className="control-mono">{user.requestCount}<small>{user.requestLimit ? `Limit ${user.requestLimit}` : 'Unlimited'}</small></div> },
    { key: 'created', label: 'Created', render: (user) => new Date(user.createdAt).toLocaleDateString() },
    { key: 'actions', label: '', className: 'control-table-actions', render: (user) => <div className="control-table-actions"><button className="control-button" onClick={() => setSelectedId(user.id)}>Manage</button><button className={`control-button${user.disabled ? '' : ' danger'}`} onClick={() => setDisableTarget(user)}>{user.disabled ? 'Enable' : 'Disable'}</button></div> },
  ];

  return <div className="control-page">
    <PageHeader title="Users" description="Accounts, access scopes, request limits, and current usage." actions={<button className="control-button primary" disabled={creatingInvite} onClick={() => void createInvite()}>{creatingInvite ? 'Creating…' : 'Create invite'}</button>} />
    {error && <PageError message={error} onRetry={() => void load()} />}
    {!users ? <LoadingState cards={4} /> : <>
      <div className="control-stat-grid" style={{ gridTemplateColumns: 'repeat(4, minmax(130px, 1fr))' }}>
        <UserStat label="Accounts" value={users.length} detail={`${users.filter((user) => !user.disabled).length} active`} />
        <UserStat label="Administrators" value={users.filter((user) => user.role === 'ADMIN' && !user.disabled).length} detail="Full server access" />
        <UserStat label="Active streams" value={users.reduce((sum, user) => sum + user.currentStreamCount, 0)} detail="Recent playback heartbeats" />
        <UserStat label="Open invites" value={invites.filter((invite) => !invite.usedAt && new Date(invite.expiresAt) > new Date()).length} detail={invites[0] ? `Latest code ${invites[0].code}` : 'No invite created'} />
      </div>
      <section className="control-section"><div className="control-section-heading"><h2>All accounts</h2><span>{users.length} total</span></div><div className="control-panel"><DataTable rows={users} columns={columns} rowKey={(user) => user.id} empty="No accounts exist yet." /></div></section>
    </>}

    {selected && <div className="control-dialog-backdrop" onMouseDown={(event) => { if (event.currentTarget === event.target && !saving) setSelectedId(null); }}><div className="control-dialog control-user-editor" role="dialog" aria-modal="true"><h2>Manage {selected.email}</h2><p>Changes apply on the server immediately. Existing tokens keep their role claim until the user signs in again, while permission checks use current database state.</p><div className="control-field-grid" style={{ marginTop: 18 }}><div className="control-field"><label>Access preset</label><select className="control-select" value={role === 'ADMIN' ? 'administrator' : permissions.join(',') === PRESETS.media.permissions.join(',') ? 'media' : permissions.join(',') === PRESETS.requests.permissions.join(',') ? 'requests' : 'viewer'} onChange={(event) => { const preset = PRESETS[event.target.value]; setRole(preset.role); setPermissions(preset.permissions); }}><option value="administrator">Administrator</option><option value="media">Media manager</option><option value="requests">Request manager</option><option value="viewer">Viewer</option></select></div><div className="control-field"><label>Account role</label><select className="control-select" value={role} onChange={(event) => setRole(event.target.value as Role)}><option value="MEMBER">Member</option><option value="ADMIN">Administrator</option></select></div><div className="control-field"><label>Monthly request limit</label><input className="control-input" type="number" min="1" placeholder="Unlimited" value={requestLimit} onChange={(event) => setRequestLimit(event.target.value)} /></div><div className="control-field"><label>Concurrent stream limit</label><input className="control-input" type="number" min="1" placeholder="Unlimited" value={streamLimit} onChange={(event) => setStreamLimit(event.target.value)} /></div></div>{role === 'MEMBER' && <div className="control-permissions"><span>Granular permissions</span>{ADMIN_PERMISSIONS.map((permission) => <label key={permission}><input type="checkbox" checked={permissions.includes(permission)} onChange={(event) => setPermissions((current) => event.target.checked ? [...current, permission] : current.filter((item) => item !== permission))} />{permission.replaceAll('_', ' ').toLowerCase()}</label>)}</div>}<div><button className="control-button" onClick={() => setSelectedId(null)} disabled={saving}>Cancel</button><button className="control-button primary" onClick={() => void save()} disabled={saving}>{saving ? 'Saving…' : 'Save access'}</button></div></div></div>}
    <ConfirmDialog open={disableTarget !== null} title={disableTarget?.disabled ? 'Enable this account?' : 'Disable this account?'} description={disableTarget?.disabled ? 'The user will be able to sign in and use Flux again.' : 'New API requests will be rejected immediately and the user will no longer be able to sign in.'} confirmLabel={disableTarget?.disabled ? 'Enable account' : 'Disable account'} dangerous={!disableTarget?.disabled} busy={saving} onClose={() => setDisableTarget(null)} onConfirm={() => void disable()} />
  </div>;
}

function UserStat({ label, value, detail }: { label: string; value: number; detail: string }) { return <div className="control-stat"><span>{label}</span><strong>{value}</strong><small>{detail}</small></div>; }
