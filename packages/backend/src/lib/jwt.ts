/**
 * JWT signing/verification. The token payload is `JwtClaims` from @flux/shared:
 *   { sub: accountId, role, activeProfileId? }
 *
 * We use `jsonwebtoken` directly (rather than @fastify/jwt) so the claim shape
 * is fully typed and shared with the frontend contract.
 */
import jwt, { type SignOptions } from 'jsonwebtoken';
import type { JwtClaims } from '@flux/shared';
import { config } from '../config.js';

// jsonwebtoken bundles registered claims (iat/exp) alongside our custom claims.
export type DecodedClaims = JwtClaims & Partial<CastPlaybackClaims> & { iat: number; exp: number };

export interface CastPlaybackClaims extends JwtClaims {
  purpose: 'cast-playback';
  castSessionId: string;
  mediaItemId: string;
  episodeId?: string;
}

/** Sign a JWT for an account, optionally carrying an active profile. */
export function signToken(claims: JwtClaims): string {
  const options: SignOptions = {
    expiresIn: config.JWT_EXPIRES_IN as SignOptions['expiresIn'],
  };
  // Pass a plain object copy so jsonwebtoken can attach iat/exp.
  return jwt.sign({ ...claims }, config.JWT_SECRET, options);
}

/** Sign a short-lived token for browserless media clients such as Cast receivers. */
export function signStreamToken(claims: JwtClaims, expiresIn: SignOptions['expiresIn'] = '2h'): string {
  return jwt.sign({ ...claims, purpose: 'stream' }, config.JWT_SECRET, { expiresIn });
}

/** Sign a receiver-only token. It cannot be used as a normal account token. */
export function signCastPlaybackToken(
  claims: JwtClaims,
  grant: Pick<CastPlaybackClaims, 'castSessionId' | 'mediaItemId' | 'episodeId'>,
  expiresIn: SignOptions['expiresIn'],
): string {
  return jwt.sign({ ...claims, ...grant, purpose: 'cast-playback' }, config.JWT_SECRET, { expiresIn });
}

/** Verify + decode a JWT. Throws if invalid/expired. */
export function verifyToken(token: string): DecodedClaims {
  const decoded = jwt.verify(token, config.JWT_SECRET);
  if (typeof decoded === 'string') {
    throw new Error('Unexpected string JWT payload');
  }
  return decoded as DecodedClaims;
}
