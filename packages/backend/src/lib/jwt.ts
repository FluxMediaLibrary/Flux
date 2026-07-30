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
export type DecodedClaims = JwtClaims & {
  castSessionId?: string;
  mediaItemId?: string;
  episodeId?: string;
  iat: number;
  exp: number;
};

export interface CastPlaybackClaims extends JwtClaims {
  purpose: 'cast-playback';
  castSessionId: string;
  mediaItemId: string;
  episodeId?: string;
}

export interface StreamPlaybackClaims extends JwtClaims {
  purpose: 'stream';
  mediaItemId: string;
  episodeId?: string;
}

const BASE_OPTIONS: SignOptions = {
  algorithm: 'HS256',
  issuer: 'flux',
  audience: 'flux-api',
};

/** Sign a JWT for an account, optionally carrying an active profile. */
export function signToken(claims: JwtClaims): string {
  const options: SignOptions = {
    ...BASE_OPTIONS,
    expiresIn: config.JWT_EXPIRES_IN as SignOptions['expiresIn'],
  };
  // Pass a plain object copy so jsonwebtoken can attach iat/exp.
  return jwt.sign({ ...claims, purpose: 'account' }, config.JWT_SECRET, options);
}

/** Sign a short-lived token restricted to one movie or episode. */
export function signStreamToken(
  claims: JwtClaims,
  grant: Pick<StreamPlaybackClaims, 'mediaItemId' | 'episodeId'>,
  expiresIn: SignOptions['expiresIn'] = `${config.STREAM_TOKEN_TTL_SECONDS}s`,
): string {
  return jwt.sign(
    { ...claims, ...grant, purpose: 'stream' },
    config.JWT_SECRET,
    { ...BASE_OPTIONS, expiresIn },
  );
}

/** Sign a receiver-only token. It cannot be used as a normal account token. */
export function signCastPlaybackToken(
  claims: JwtClaims,
  grant: Pick<CastPlaybackClaims, 'castSessionId' | 'mediaItemId' | 'episodeId'>,
  expiresIn: SignOptions['expiresIn'],
): string {
  return jwt.sign(
    { ...claims, ...grant, purpose: 'cast-playback' },
    config.JWT_SECRET,
    { ...BASE_OPTIONS, expiresIn },
  );
}

/** Verify + decode a JWT. Throws if invalid/expired. */
export function verifyToken(token: string): DecodedClaims {
  const decoded = jwt.verify(token, config.JWT_SECRET, {
    algorithms: ['HS256'],
    issuer: 'flux',
    audience: 'flux-api',
  });
  if (typeof decoded === 'string') {
    throw new Error('Unexpected string JWT payload');
  }
  return decoded as DecodedClaims;
}
