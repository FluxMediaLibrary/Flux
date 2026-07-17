'use client';

/**
 * Auth / session provider.
 *
 * JWT STORAGE DECISION
 * --------------------
 * The backend authenticates with `Authorization: Bearer <jwt>` (a token scheme
 * chosen so a future mobile/TV client can reuse the same API). The frontend must
 * therefore be able to READ the token from JS to attach it to each request — an
 * httpOnly cookie (unreadable to JS) would defeat that. We store the JWT in
 * `localStorage`:
 *   - `flux.baseToken`  — the account token from login/signup (no activeProfileId)
 *   - `flux.token`      — the *effective* Bearer; becomes the profile-scoped token
 *                         after activation, falls back to the base token otherwise.
 * Keeping the base token lets us re-activate a *different* profile when switching
 * without forcing a re-login.
 *
 * Trade-off: localStorage is readable by injected scripts (XSS). We mitigate by
 * never using `dangerouslySetInnerHTML`, relying on React's escaping, proxying all
 * secrets server-side, and treating client-decoded claims as advisory only — the
 * backend re-verifies the signature and re-authorizes every request.
 *
 * ROUTE PROTECTION is done client-side by guard components (see components/guards):
 * unauthenticated -> /login; authenticated but no active profile -> /profiles;
 * /admin/* requires role ADMIN. No Next middleware/proxy is used because the token
 * lives in JS-accessible storage and pages fetch on the client.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import type {
  AccountDTO,
  CreateProfileRequest,
  LoginRequest,
  ProfileDTO,
  Role,
  SignupRequest,
  UpdateProfileRequest,
} from '@flux/shared';
import {
  api,
  clearTokens,
  getBaseToken,
  getToken,
  setTokens,
} from './api';
import { decodeJwt, isExpired } from './jwt';

const ACCOUNT_KEY = 'flux.account';
const PROFILES_KEY = 'flux.profiles';

export interface AuthState {
  status: 'loading' | 'authenticated' | 'anonymous';
  account: AccountDTO | null;
  profiles: ProfileDTO[];
  activeProfileId: string | null;
  activeProfile: ProfileDTO | null;
  role: Role | null;
  isAdmin: boolean;
  login: (body: LoginRequest) => Promise<void>;
  signup: (body: SignupRequest) => Promise<void>;
  activateProfile: (profileId: string) => Promise<void>;
  addProfile: (body: CreateProfileRequest) => Promise<ProfileDTO>;
  editProfile: (
    profileId: string,
    body: UpdateProfileRequest,
  ) => Promise<ProfileDTO>;
  removeProfile: (profileId: string) => Promise<void>;
  switchProfile: () => void;
  logout: () => void;
}

const AuthContext = createContext<AuthState | null>(null);

function readCache<T>(key: string): T | null {
  if (typeof window === 'undefined') return null;
  const raw = window.localStorage.getItem(key);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function writeCache(key: string, value: unknown): void {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(key, JSON.stringify(value));
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthState['status']>('loading');
  const [account, setAccount] = useState<AccountDTO | null>(null);
  const [profiles, setProfiles] = useState<ProfileDTO[]>([]);
  const [activeProfileId, setActiveProfileId] = useState<string | null>(null);

  // Rehydrate session from storage on mount.
  useEffect(() => {
    const baseToken = getBaseToken();
    const effective = getToken();
    if (!baseToken || isExpired(baseToken)) {
      clearSession();
      setStatus('anonymous');
      return;
    }
    setAccount(readCache<AccountDTO>(ACCOUNT_KEY));
    setProfiles(readCache<ProfileDTO[]>(PROFILES_KEY) ?? []);
    const claims = effective ? decodeJwt(effective) : null;
    setActiveProfileId(claims?.activeProfileId ?? null);
    setStatus('authenticated');
  }, []);

  function persistAuth(token: string, acct: AccountDTO, profs: ProfileDTO[]) {
    // login/signup return the base (account) token — it doubles as the effective
    // token until a profile is activated.
    setTokens({ token, baseToken: token });
    writeCache(ACCOUNT_KEY, acct);
    writeCache(PROFILES_KEY, profs);
    setAccount(acct);
    setProfiles(profs);
    setActiveProfileId(null);
    setStatus('authenticated');
  }

  function clearSession() {
    clearTokens();
    if (typeof window !== 'undefined') {
      window.localStorage.removeItem(ACCOUNT_KEY);
      window.localStorage.removeItem(PROFILES_KEY);
    }
    setAccount(null);
    setProfiles([]);
    setActiveProfileId(null);
  }

  const login = useCallback(async (body: LoginRequest) => {
    const res = await api.login(body);
    persistAuth(res.token, res.account, res.profiles);
  }, []);

  const signup = useCallback(async (body: SignupRequest) => {
    const res = await api.signup(body);
    persistAuth(res.token, res.account, res.profiles);
  }, []);

  const activateProfile = useCallback(async (profileId: string) => {
    const res = await api.activateProfile(profileId, getBaseToken());
    // The activation response carries a NEW token with activeProfileId — it
    // becomes the effective Bearer; the base token is preserved for switching.
    setTokens({ token: res.token });
    setActiveProfileId(res.profile.id);
    // Ensure the activated profile is present in the cached list.
    setProfiles((prev) => {
      const exists = prev.some((p) => p.id === res.profile.id);
      const next = exists ? prev : [...prev, res.profile];
      writeCache(PROFILES_KEY, next);
      return next;
    });
  }, []);

  const addProfile = useCallback(async (body: CreateProfileRequest) => {
    const profile = await api.createProfile(body, getBaseToken());
    setProfiles((prev) => {
      const next = [...prev, profile];
      writeCache(PROFILES_KEY, next);
      return next;
    });
    return profile;
  }, []);

  const editProfile = useCallback(
    async (profileId: string, body: UpdateProfileRequest) => {
      const updated = await api.updateProfile(profileId, body, getBaseToken());
      setProfiles((prev) => {
        const next = prev.map((p) => (p.id === updated.id ? updated : p));
        writeCache(PROFILES_KEY, next);
        return next;
      });
      return updated;
    },
    [],
  );

  const removeProfile = useCallback(async (profileId: string) => {
    await api.deleteProfile(profileId, getBaseToken());
    setProfiles((prev) => {
      const next = prev.filter((p) => p.id !== profileId);
      writeCache(PROFILES_KEY, next);
      return next;
    });
  }, []);

  const switchProfile = useCallback(() => {
    // Revert the effective token to the account token (drops activeProfileId),
    // so the picker can activate a different profile.
    const baseToken = getBaseToken();
    if (baseToken) setTokens({ token: baseToken });
    setActiveProfileId(null);
  }, []);

  const logout = useCallback(() => {
    clearSession();
    setStatus('anonymous');
  }, []);

  const role: Role | null = useMemo(() => {
    if (account) return account.role;
    const base = getBaseToken();
    return base ? (decodeJwt(base)?.role ?? null) : null;
  }, [account]);

  const activeProfile = useMemo(
    () => profiles.find((p) => p.id === activeProfileId) ?? null,
    [profiles, activeProfileId],
  );

  const value: AuthState = useMemo(
    () => ({
      status,
      account,
      profiles,
      activeProfileId,
      activeProfile,
      role,
      isAdmin: role === 'ADMIN',
      login,
      signup,
      activateProfile,
      addProfile,
      editProfile,
      removeProfile,
      switchProfile,
      logout,
    }),
    [
      status,
      account,
      profiles,
      activeProfileId,
      activeProfile,
      role,
      login,
      signup,
      activateProfile,
      addProfile,
      editProfile,
      removeProfile,
      switchProfile,
      logout,
    ],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within <AuthProvider>');
  return ctx;
}
