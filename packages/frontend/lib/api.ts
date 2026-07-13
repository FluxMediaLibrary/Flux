import type {
  ActivateProfileResponse,
  AdminInfoDTO,
  ApiError,
  AuthResponse,
  ConfirmTorrentRequest,
  CreateInviteRequest,
  CreateProfileRequest,
  CreateRequestRequest,
  HomeRowsDTO,
  InviteDTO,
  LibraryItemDTO,
  LoginRequest,
  MediaItemDetailDTO,
  MediaType,
  NotificationSettingsDTO,
  PlaybackInfoDTO,
  TmdbDetail,
  TmdbEpisode,
  ProfileDTO,
  RequestDTO,
  SaveProgressRequest,
  SignupRequest,
  UpdateProfileRequest,
  TmdbGenreDTO,
  TmdbPersonResult,
  TmdbSearchResult,
  TrendingWindow,
  TorrentDTO,
  TorrentParseResult,
  UpdateNotificationSettingsRequest,
  WatchProgressDTO,
} from '@flux/shared';

const BASE_URL = (process.env.NEXT_PUBLIC_API_BASE_URL ?? '').replace(/\/$/, '');

const TOKEN_KEY = 'flux.token'; // effective Bearer (active-profile token when present)
const BASE_TOKEN_KEY = 'flux.baseToken'; // account token (no activeProfileId) for re-activation

// ─── Token storage ────────────────────────────────────────────────────────────
// JWT is stored in localStorage (see auth-context.tsx for the rationale). All
// access is guarded so this module is safe to import in Server Components.

export function getToken(): string | null {
  if (typeof window === 'undefined') return null;
  return window.localStorage.getItem(TOKEN_KEY);
}

export function getBaseToken(): string | null {
  if (typeof window === 'undefined') return null;
  return window.localStorage.getItem(BASE_TOKEN_KEY);
}

export function setTokens(opts: { token: string; baseToken?: string }): void {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(TOKEN_KEY, opts.token);
  if (opts.baseToken !== undefined) {
    window.localStorage.setItem(BASE_TOKEN_KEY, opts.baseToken);
  }
}

export function clearTokens(): void {
  if (typeof window === 'undefined') return;
  window.localStorage.removeItem(TOKEN_KEY);
  window.localStorage.removeItem(BASE_TOKEN_KEY);
}

// ─── Error type ───────────────────────────────────────────────────────────────

export class FluxApiError extends Error implements ApiError {
  readonly error: string;
  readonly statusCode: number;

  constructor(body: ApiError) {
    super(body.message);
    this.name = 'FluxApiError';
    this.error = body.error;
    this.statusCode = body.statusCode;
  }
}

// ─── Core request wrapper ─────────────────────────────────────────────────────

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  /** Explicit token override; defaults to the stored effective token. */
  token?: string | null;
  /** Skip attaching the Authorization header entirely. */
  anonymous?: boolean;
  signal?: AbortSignal;
}

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  if (!BASE_URL) {
    throw new FluxApiError({
      error: 'ConfigError',
      message: 'NEXT_PUBLIC_API_BASE_URL is not configured.',
      statusCode: 0,
    });
  }

  const headers: Record<string, string> = { Accept: 'application/json' };
  if (options.body !== undefined) headers['Content-Type'] = 'application/json';

  if (!options.anonymous) {
    const token = options.token ?? getToken();
    if (token) headers['Authorization'] = `Bearer ${token}`;
  }

  let res: Response;
  try {
    res = await fetch(`${BASE_URL}${path}`, {
      method: options.method ?? (options.body !== undefined ? 'POST' : 'GET'),
      headers,
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
      signal: options.signal,
      cache: 'no-store',
    });
  } catch {
    throw new FluxApiError({
      error: 'NetworkError',
      message: 'Could not reach the Flux API. Is the backend running?',
      statusCode: 0,
    });
  }

  return handleResponse<T>(res);
}

/** Shared success/error parsing for both JSON and multipart requests. */
async function handleResponse<T>(res: Response): Promise<T> {
  if (res.status === 204) return undefined as T;

  const text = await res.text();
  const data = text ? safeJson(text) : undefined;

  if (!res.ok) {
    if (isApiError(data)) throw new FluxApiError(data);
    throw new FluxApiError({
      error: 'HttpError',
      message: (typeof data === 'object' && data && 'message' in data
        ? String((data as { message: unknown }).message)
        : res.statusText) || `Request failed (${res.status})`,
      statusCode: res.status,
    });
  }

  return data as T;
}

// ─── Multipart upload ─────────────────────────────────────────────────────────
// FormData bodies must NOT carry an explicit Content-Type — the browser sets the
// `multipart/form-data; boundary=…` header itself. We still attach the Bearer.

async function uploadForm<T>(
  path: string,
  form: FormData,
  options: { signal?: AbortSignal } = {},
): Promise<T> {
  if (!BASE_URL) {
    throw new FluxApiError({
      error: 'ConfigError',
      message: 'NEXT_PUBLIC_API_BASE_URL is not configured.',
      statusCode: 0,
    });
  }

  const headers: Record<string, string> = { Accept: 'application/json' };
  const token = getToken();
  if (token) headers['Authorization'] = `Bearer ${token}`;

  let res: Response;
  try {
    res = await fetch(`${BASE_URL}${path}`, {
      method: 'POST',
      headers, // intentionally no Content-Type — browser sets the boundary
      body: form,
      signal: options.signal,
      cache: 'no-store',
    });
  } catch {
    throw new FluxApiError({
      error: 'NetworkError',
      message: 'Could not reach the Flux API. Is the backend running?',
      statusCode: 0,
    });
  }

  return handleResponse<T>(res);
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function isApiError(x: unknown): x is ApiError {
  return (
    typeof x === 'object' &&
    x !== null &&
    'error' in x &&
    'message' in x &&
    'statusCode' in x
  );
}

// ─── Typed endpoints ──────────────────────────────────────────────────────────
// Only endpoints backed by the `@flux/shared` contract are exposed here.

export const api = {
  // Auth
  login(body: LoginRequest) {
    return request<AuthResponse>('/api/auth/login', { body, anonymous: true });
  },
  signup(body: SignupRequest) {
    return request<AuthResponse>('/api/auth/signup', { body, anonymous: true });
  },

  // Profiles
  activateProfile(profileId: string, baseToken?: string | null) {
    return request<ActivateProfileResponse>(
      `/api/profiles/${encodeURIComponent(profileId)}/activate`,
      { method: 'POST', token: baseToken ?? getBaseToken() },
    );
  },
  createProfile(body: CreateProfileRequest, baseToken?: string | null) {
    return request<ProfileDTO>('/api/profiles', {
      body,
      token: baseToken ?? getBaseToken(),
    });
  },
  updateProfile(
    profileId: string,
    body: UpdateProfileRequest,
    baseToken?: string | null,
  ) {
    return request<ProfileDTO>(
      `/api/profiles/${encodeURIComponent(profileId)}`,
      { method: 'PATCH', body, token: baseToken ?? getBaseToken() },
    );
  },
  deleteProfile(profileId: string, baseToken?: string | null) {
    return request<void>(`/api/profiles/${encodeURIComponent(profileId)}`, {
      method: 'DELETE',
      token: baseToken ?? getBaseToken(),
    });
  },

  // Invites (admin)
  listInvites() {
    return request<InviteDTO[]>('/api/invites');
  },
  createInvite(body: CreateInviteRequest = {}) {
    return request<InviteDTO>('/api/invites', { body });
  },

  // Requests (member)
  createRequest(body: CreateRequestRequest) {
    return request<RequestDTO>('/api/requests', { body });
  },
  listMyRequests(signal?: AbortSignal) {
    return request<RequestDTO[]>('/api/requests', { signal });
  },

  // TMDb search (admin confirm step) — the wire query uses movie|tv, while the
  // contract enum is MOVIE|SHOW, so map on the way out.
  searchTmdb(query: string, type: MediaType, signal?: AbortSignal) {
    const qs = new URLSearchParams({
      q: query,
      type: type === 'SHOW' ? 'tv' : 'movie',
    });
    return request<TmdbSearchResult[]>(`/api/tmdb/search?${qs.toString()}`, {
      signal,
    });
  },

  // TMDb discovery — trending / popular / discover / genres. The wire `type`
  // is movie|tv; map the shared MOVIE|SHOW enum on the way out.
  searchPeople(query: string, signal?: AbortSignal) {
    const qs = new URLSearchParams({ q: query });
    return request<TmdbPersonResult[]>(`/api/tmdb/people/search?${qs.toString()}`, {
      signal,
    });
  },
  trending(type: MediaType, window: TrendingWindow = 'week', signal?: AbortSignal) {
    const qs = new URLSearchParams({
      type: type === 'SHOW' ? 'tv' : 'movie',
      window,
    });
    return request<TmdbSearchResult[]>(`/api/tmdb/trending?${qs.toString()}`, {
      signal,
    });
  },
  popular(type: MediaType, signal?: AbortSignal) {
    const qs = new URLSearchParams({ type: type === 'SHOW' ? 'tv' : 'movie' });
    return request<TmdbSearchResult[]>(`/api/tmdb/popular?${qs.toString()}`, {
      signal,
    });
  },
  discover(type: MediaType, genreId?: number, signal?: AbortSignal) {
    const qs = new URLSearchParams({ type: type === 'SHOW' ? 'tv' : 'movie' });
    if (genreId !== undefined) qs.set('genre', String(genreId));
    return request<TmdbSearchResult[]>(`/api/tmdb/discover?${qs.toString()}`, {
      signal,
    });
  },
  listGenres(type: MediaType, signal?: AbortSignal) {
    const qs = new URLSearchParams({ type: type === 'SHOW' ? 'tv' : 'movie' });
    return request<TmdbGenreDTO[]>(`/api/tmdb/genres?${qs.toString()}`, {
      signal,
    });
  },
  /** Rich TMDb detail (cast, runtime, genres, trailer) for a known title. */
  tmdbDetail(type: MediaType, tmdbId: number, signal?: AbortSignal) {
    const segment = type === 'SHOW' ? 'tv' : 'movie';
    return request<TmdbDetail>(`/api/tmdb/${segment}/${tmdbId}`, { signal });
  },
  /** Per-episode TMDb metadata (stills, synopses) for one TV season. */
  tmdbSeason(tmdbId: number, season: number, signal?: AbortSignal) {
    return request<TmdbEpisode[]>(
      `/api/tmdb/tv/${tmdbId}/season/${season}`,
      { signal },
    );
  },

  // Torrents (admin)
  /** Upload a .torrent for parsing. Does NOT start a download. */
  uploadTorrent(file: File, signal?: AbortSignal) {
    const form = new FormData();
    form.append('file', file);
    return uploadForm<TorrentParseResult>('/api/torrents/upload', form, {
      signal,
    });
  },
  /** Confirm the parsed torrent + TMDb match → begins the download. */
  confirmTorrent(body: ConfirmTorrentRequest) {
    return request<TorrentDTO>('/api/torrents/confirm', { body });
  },
  listTorrents(signal?: AbortSignal) {
    return request<TorrentDTO[]>('/api/torrents', { signal });
  },
  getTorrent(id: string) {
    return request<TorrentDTO>(`/api/torrents/${encodeURIComponent(id)}`);
  },
  /** Stop seeding (SEEDING → STOPPED). */
  stopTorrent(id: string) {
    return request<TorrentDTO>(
      `/api/torrents/${encodeURIComponent(id)}/stop`,
      { method: 'POST' },
    );
  },
  /** Remove a torrent entirely. */
  removeTorrent(id: string) {
    return request<void>(`/api/torrents/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    });
  },

  // Admin request management
  listAllRequests(signal?: AbortSignal) {
    return request<RequestDTO[]>('/api/requests/admin', { signal });
  },
  approveRequest(id: string) {
    return request<RequestDTO>(
      `/api/requests/${encodeURIComponent(id)}/approve`,
      { method: 'POST' },
    );
  },
  rejectRequest(id: string) {
    return request<RequestDTO>(
      `/api/requests/${encodeURIComponent(id)}/reject`,
      { method: 'POST' },
    );
  },

  // Library
  homepage(signal?: AbortSignal) {
    return request<HomeRowsDTO>('/api/library/home', { signal });
  },
  /** Whole library as grid items with per-profile watched/unplayed badges. */
  listLibrary(type: MediaType | 'ALL' = 'ALL', signal?: AbortSignal) {
    const wire = type === 'ALL' ? 'all' : type === 'SHOW' ? 'tv' : 'movie';
    return request<LibraryItemDTO[]>(
      `/api/library/items?type=${wire}`,
      { signal },
    );
  },
  getMediaItem(id: string, signal?: AbortSignal) {
    return request<MediaItemDetailDTO>(
      `/api/library/items/${encodeURIComponent(id)}`,
      { signal },
    );
  },

  // Streaming
  // The token rides in the query string because <video> / hls.js segment
  // requests cannot set an Authorization header (see requireProfileStream).
  getStreamUrl(mediaItemId: string, episodeId?: string): string {
    if (typeof window === 'undefined') return '';
    const qs = new URLSearchParams();
    if (episodeId) qs.set('episodeId', episodeId);
    const token = getToken();
    if (token) qs.set('token', token);
    const q = qs.toString();
    return `${BASE_URL}/api/stream/${encodeURIComponent(mediaItemId)}${q ? `?${q}` : ''}`;
  },
  /** Ask the server whether this file can be direct-played or needs HLS. */
  getPlaybackInfo(mediaItemId: string, episodeId?: string, signal?: AbortSignal) {
    const qs = episodeId ? `?episodeId=${encodeURIComponent(episodeId)}` : '';
    return request<PlaybackInfoDTO>(`/api/stream/${encodeURIComponent(mediaItemId)}/info${qs}`, { signal });
  },
  getHlsUrl(mediaItemId: string, episodeId?: string, audioStreamIndex?: number | null): string {
    if (typeof window === 'undefined') return '';
    const qs = new URLSearchParams();
    if (episodeId) qs.set('episodeId', episodeId);
    if (typeof audioStreamIndex === 'number') qs.set('audioStream', String(audioStreamIndex));
    const token = getToken();
    if (token) qs.set('token', token);
    const q = qs.toString();
    return `${BASE_URL}/api/stream/${encodeURIComponent(mediaItemId)}/hls/index.m3u8${q ? `?${q}` : ''}`;
  },
  /** Build a thumbnail frame URL for the seek-bar preview. */
  getThumbUrl(mediaItemId: string, timeSeconds: number, episodeId?: string): string {
    if (typeof window === 'undefined') return '';
    const qs = new URLSearchParams({ t: String(Math.floor(timeSeconds)) });
    if (episodeId) qs.set('episodeId', episodeId);
    const token = getToken();
    if (token) qs.set('token', token);
    return `${BASE_URL}/api/stream/${encodeURIComponent(mediaItemId)}/thumb?${qs.toString()}`;
  },
  /** Build a trickplay asset URL (sprite sheet or VTT). */
  getTrickplayUrl(mediaItemId: string, file: string, episodeId?: string): string {
    if (typeof window === 'undefined') return '';
    const qs = new URLSearchParams();
    if (episodeId) qs.set('episodeId', episodeId);
    const token = getToken();
    if (token) qs.set('token', token);
    const q = qs.toString();
    return `${BASE_URL}/api/stream/${encodeURIComponent(mediaItemId)}/trickplay/${encodeURIComponent(file)}${q ? `?${q}` : ''}`;
  },

  // Watch progress
  saveProgress(body: SaveProgressRequest) {
    return request<WatchProgressDTO>('/api/library/progress', { body });
  },

  // Notification settings (admin)
  getNotificationSettings() {
    return request<NotificationSettingsDTO>('/api/notifications/settings');
  },
  updateNotificationSettings(body: UpdateNotificationSettingsRequest) {
    return request<NotificationSettingsDTO>('/api/notifications/settings', { method: 'PUT', body });
  },

  // Admin dashboard
  getAdminInfo() {
    return request<AdminInfoDTO>('/api/admin/info');
  },
};

export { BASE_URL as API_BASE_URL };
