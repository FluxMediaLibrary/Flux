import { createHash, randomInt } from 'node:crypto';

const USER_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function hashOpaqueToken(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

export function normalizeUserCode(value: string): string {
  const compact = value.toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (compact.length !== 6) return '';
  return `${compact.slice(0, 3)}-${compact.slice(3)}`;
}

export function generateUserCode(): string {
  let value = '';
  for (let index = 0; index < 6; index += 1) {
    value += USER_CODE_ALPHABET[randomInt(USER_CODE_ALPHABET.length)];
  }
  return `${value.slice(0, 3)}-${value.slice(3)}`;
}

export function isExpired(expiresAt: Date, nowMs = Date.now()): boolean {
  return expiresAt.getTime() <= nowMs;
}
