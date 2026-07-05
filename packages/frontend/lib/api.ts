import type {
  ActivateProfileResponse,
  ApiError,
  AuthResponse,
  CreateInviteRequest,
  CreateProfileRequest,
  CreateRequestRequest,
  InviteDTO,
  LoginRequest,
  ProfileDTO,
  RequestDTO,
  SignupRequest,
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

  // Invites (admin)
  listInvites() {
    return request<InviteDTO[]>('/api/invites');
  },
  createInvite(body: CreateInviteRequest = {}) {
    return request<InviteDTO>('/api/invites', { body });
  },

  // Requests (member) — used by browse/request flow later phases.
  createRequest(body: CreateRequestRequest) {
    return request<RequestDTO>('/api/requests', { body });
  },
};

export { BASE_URL as API_BASE_URL };
