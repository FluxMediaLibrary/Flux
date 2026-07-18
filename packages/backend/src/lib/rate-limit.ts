import { createHash } from 'node:crypto';
import { redisConnection } from './redis.js';
import { ApiError } from './errors.js';

export async function enforceRateLimit(
  scope: string,
  identity: string,
  limit: number,
  windowSeconds: number,
): Promise<void> {
  const identityHash = createHash('sha256').update(identity).digest('hex').slice(0, 24);
  const bucket = Math.floor(Date.now() / (windowSeconds * 1000));
  const key = `flux:rate:${scope}:${identityHash}:${bucket}`;
  const count = await redisConnection.incr(key);
  if (count === 1) await redisConnection.expire(key, windowSeconds + 5);
  if (count > limit) throw ApiError.tooManyRequests('Please wait before trying again');
}
