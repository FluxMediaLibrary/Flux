import type { JwtClaims } from '@flux/shared';

/**
 * Decode (NOT verify) a JWT payload on the client.
 *
 * The backend is the sole authority that *verifies* signatures. The frontend
 * only reads claims (`role`, `activeProfileId`, `sub`) to drive UI/routing.
 * Never trust these claims for anything security-sensitive — every protected
 * action is re-authorized server-side against the Bearer token.
 */
export function decodeJwt(token: string): JwtClaims | null {
  try {
    const [, payload] = token.split('.');
    if (!payload) return null;
    // base64url -> base64
    const base64 = payload.replace(/-/g, '+').replace(/_/g, '/');
    const json =
      typeof window === 'undefined'
        ? Buffer.from(base64, 'base64').toString('utf8')
        : decodeURIComponent(
            atob(base64)
              .split('')
              .map((c) => '%' + c.charCodeAt(0).toString(16).padStart(2, '0'))
              .join(''),
          );
    const claims = JSON.parse(json) as JwtClaims & { exp?: number };
    return claims;
  } catch {
    return null;
  }
}

/** True if the token carries an `exp` claim that is already in the past. */
export function isExpired(token: string): boolean {
  const claims = decodeJwt(token) as (JwtClaims & { exp?: number }) | null;
  if (!claims?.exp) return false;
  return claims.exp * 1000 <= Date.now();
}
