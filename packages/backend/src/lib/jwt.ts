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
export type DecodedClaims = JwtClaims & { iat: number; exp: number };

/** Sign a JWT for an account, optionally carrying an active profile. */
export function signToken(claims: JwtClaims): string {
  const options: SignOptions = {
    expiresIn: config.JWT_EXPIRES_IN as SignOptions['expiresIn'],
  };
  // Pass a plain object copy so jsonwebtoken can attach iat/exp.
  return jwt.sign({ ...claims }, config.JWT_SECRET, options);
}

/** Verify + decode a JWT. Throws if invalid/expired. */
export function verifyToken(token: string): DecodedClaims {
  const decoded = jwt.verify(token, config.JWT_SECRET);
  if (typeof decoded === 'string') {
    throw new Error('Unexpected string JWT payload');
  }
  return decoded as DecodedClaims;
}
