import assert from 'node:assert/strict';
import test from 'node:test';

process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/flux_test';
process.env.REDIS_URL = 'redis://localhost:6379';
process.env.JWT_SECRET = 'test-secret-with-at-least-sixteen-characters';
process.env.TMDB_API_KEY = 'test';

const { signStreamToken, signToken, verifyToken } = await import('./jwt.js');

test('account and playback tokens carry distinct purposes and media scope', () => {
  const account = verifyToken(signToken({ sub: 'account-1', role: 'MEMBER' }));
  assert.equal(account.purpose, 'account');
  assert.equal(account.mediaItemId, undefined);

  const playback = verifyToken(signStreamToken(
    { sub: 'account-1', role: 'MEMBER', activeProfileId: 'profile-1' },
    { mediaItemId: 'movie-1', episodeId: 'episode-1' },
    '5m',
  ));
  assert.equal(playback.purpose, 'stream');
  assert.equal(playback.activeProfileId, 'profile-1');
  assert.equal(playback.mediaItemId, 'movie-1');
  assert.equal(playback.episodeId, 'episode-1');
  assert.ok(playback.exp > playback.iat);
});
