import type { DownloadClient } from '@prisma/client';
import { prisma } from '../../lib/db.js';
import { getServerSettings } from './settings.service.js';
import { ApiError } from '../../lib/errors.js';

function clientUrl(client: DownloadClient): URL {
  const raw = /^https?:\/\//i.test(client.host) ? client.host : `${client.useHttps ? 'https' : 'http'}://${client.host}`;
  const url = new URL(raw);
  url.protocol = client.useHttps ? 'https:' : 'http:';
  url.port = String(client.port);
  url.username = '';
  url.password = '';
  return url;
}

function basicAuth(client: DownloadClient): Record<string, string> {
  if (!client.username && !client.credential) return {};
  return { Authorization: `Basic ${Buffer.from(`${client.username ?? ''}:${client.credential ?? ''}`).toString('base64')}` };
}

async function sabRequest(client: DownloadClient, params: Record<string, string>): Promise<unknown> {
  const url = clientUrl(client);
  url.pathname = `${url.pathname.replace(/\/$/, '')}/api`;
  url.search = new URLSearchParams({ output: 'json', ...(client.credential ? { apikey: client.credential } : {}), ...params }).toString();
  const response = await fetch(url, { signal: AbortSignal.timeout(10_000) });
  if (!response.ok) throw new Error(`SABnzbd maintenance returned HTTP ${response.status}`);
  return response.json();
}

async function nzbRequest(client: DownloadClient, method: string, params: unknown[]): Promise<unknown> {
  const url = clientUrl(client);
  url.pathname = `${url.pathname.replace(/\/$/, '')}/jsonrpc`;
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...basicAuth(client) },
    body: JSON.stringify({ method, params, id: 1 }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error(`NZBGet maintenance returned HTTP ${response.status}`);
  const body = await response.json() as { result?: unknown; error?: unknown };
  if (body.error) throw new Error('NZBGet rejected the maintenance request');
  return body.result;
}

export async function resolveUsenetClient(requestedId?: string | null): Promise<DownloadClient> {
  const settings = await getServerSettings();
  if (settings.preferredProtocol === 'TORRENT_ONLY') {
    throw ApiError.badRequest('Preferred protocol is set to Torrent only', 'USENET_DISABLED_BY_POLICY');
  }
  if (requestedId) {
    const requested = await prisma.downloadClient.findUnique({ where: { id: requestedId } });
    if (!requested || !requested.enabled || !['SABNZBD', 'NZBGET'].includes(requested.type)) {
      throw ApiError.badRequest('The requested Usenet client is unavailable', 'USENET_CLIENT_UNAVAILABLE');
    }
    return requested;
  }
  const defaultClient = settings.defaultDownloadClientId
    ? await prisma.downloadClient.findFirst({ where: { id: settings.defaultDownloadClientId, enabled: true, type: { in: ['SABNZBD', 'NZBGET'] } } })
    : null;
  const client = defaultClient ?? await prisma.downloadClient.findFirst({
    where: { enabled: true, type: { in: ['SABNZBD', 'NZBGET'] } },
    orderBy: [{ priority: 'desc' }, { id: 'asc' }],
  });
  if (!client) throw ApiError.badRequest('Configure and enable a SABnzbd or NZBGet client first', 'USENET_CLIENT_UNAVAILABLE');
  return client;
}

export async function enqueueUsenetDownload(client: DownloadClient, nzbUrl: string, title: string): Promise<string> {
  if (client.type === 'SABNZBD') {
    const body = await sabRequest(client, {
      mode: 'addurl', name: nzbUrl, nzbname: title, cat: client.category || '*', priority: '-100', pp: '-1',
    }) as { status?: boolean; nzo_ids?: string[] };
    const id = body.nzo_ids?.[0];
    if (!body.status || !id) throw ApiError.badRequest('SABnzbd did not accept the release', 'USENET_QUEUE_REJECTED');
    return id;
  }
  const filename = `${title.replace(/[^A-Za-z0-9._ -]+/g, '').slice(0, 180) || 'flux-release'}.nzb`;
  const result = await nzbRequest(client, 'append', [
    filename, nzbUrl, client.category ?? '', 0, false, false, '', 0, 'SCORE', false, [],
  ]);
  const id = typeof result === 'number' ? result : Number(result);
  if (!Number.isInteger(id) || id <= 0) throw ApiError.badRequest('NZBGet did not accept the release', 'USENET_QUEUE_REJECTED');
  return String(id);
}

async function cleanupSab(client: DownloadClient, removeCompleted: boolean, removeFailed: boolean): Promise<number> {
  const body = await sabRequest(client, { mode: 'history', limit: '100' }) as {
    history?: { slots?: { nzo_id?: string; status?: string; category?: string }[] };
  };
  const removable = (body.history?.slots ?? []).filter((job) => {
    const status = job.status?.toUpperCase() ?? '';
    const belongsToFlux = job.category?.toLowerCase() === client.category?.toLowerCase();
    return Boolean(job.nzo_id) && belongsToFlux && ((removeCompleted && status === 'COMPLETED') || (removeFailed && ['FAILED', 'VERIFICATION', 'REPAIR'].includes(status)));
  }).slice(0, 50);
  for (const job of removable) {
    await sabRequest(client, { mode: 'history', name: 'delete', value: job.nzo_id!, del_files: '0' });
  }
  return removable.length;
}

async function cleanupNzbGet(client: DownloadClient, removeCompleted: boolean, removeFailed: boolean): Promise<number> {
  const history = await nzbRequest(client, 'history', [false]) as { NZBID?: number; Status?: string; Category?: string }[];
  const ids = (Array.isArray(history) ? history : []).filter((job) => {
    const status = job.Status?.toUpperCase() ?? '';
    const belongsToFlux = job.Category?.toLowerCase() === client.category?.toLowerCase();
    return Number.isInteger(job.NZBID) && belongsToFlux && ((removeCompleted && status.startsWith('SUCCESS')) || (removeFailed && status.startsWith('FAILURE')));
  }).slice(0, 50).map((job) => job.NZBID!);
  if (ids.length > 0) await nzbRequest(client, 'editqueue', ['HistoryDelete', 0, '', ids]);
  return ids.length;
}

/** Best-effort cleanup for Flux-category Usenet jobs. */
export async function cleanupUsenetHistory(): Promise<number> {
  const settings = await getServerSettings();
  if (!settings.usenetRemoveCompleted && !settings.usenetRemoveFailed) return 0;
  const clients = await prisma.downloadClient.findMany({
    where: { enabled: true, type: { in: ['SABNZBD', 'NZBGET'] }, category: { not: null } },
    orderBy: [{ priority: 'desc' }, { id: 'asc' }],
  });
  let removed = 0;
  for (const client of clients) {
    try {
      removed += client.type === 'SABNZBD'
        ? await cleanupSab(client, settings.usenetRemoveCompleted, settings.usenetRemoveFailed)
        : await cleanupNzbGet(client, settings.usenetRemoveCompleted, settings.usenetRemoveFailed);
    } catch {
      // The maintenance sweep is deliberately best effort. Connection health
      // remains visible through the explicit backend Test Connection action.
    }
  }
  return removed;
}
