import assert from 'node:assert/strict';
import test from 'node:test';

process.env.NODE_ENV = 'production';
process.env.DATABASE_URL = 'postgresql://test:test@127.0.0.1:1/flux_test';
process.env.REDIS_URL = 'redis://127.0.0.1:1';
process.env.JWT_SECRET = 'home-integration-test-secret-value';
process.env.TMDB_API_KEY = 'test-key';

test('home isolates a failed discovery query while preserving successful rows', async (t) => {
  const [{ prisma }, { getHomepage }] = await Promise.all([
    import('../../lib/db.js'),
    import('./library.service.js'),
  ]);

  const originalProgressFindMany = prisma.watchProgress.findMany;
  const originalMediaFindMany = prisma.mediaItem.findMany;
  prisma.watchProgress.findMany = (async () => []) as typeof prisma.watchProgress.findMany;
  prisma.mediaItem.findMany = (async (args: { where?: { genres?: unknown; year?: unknown } }) => {
    if (args.where?.genres) throw new Error('simulated discovery failure');
    if (args.where?.year) return [];
    return [{
      id: 'movie-1',
      tmdbId: 1,
      type: 'MOVIE',
      title: 'Available Movie',
      year: 2026,
      overview: null,
      posterPath: null,
      backdropPath: null,
      genres: [],
      metadata: null,
      filePath: '/media/movie.mp4',
      addedAt: new Date('2026-01-01T00:00:00.000Z'),
      updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    }] as never[];
  }) as typeof prisma.mediaItem.findMany;
  t.after(() => {
    prisma.watchProgress.findMany = originalProgressFindMany;
    prisma.mediaItem.findMany = originalMediaFindMany;
  });

  const home = await getHomepage('profile-1');
  assert.equal(home.recentlyAdded.length, 1);
  assert.equal(home.recentlyAdded[0]?.title, 'Available Movie');
  assert.deepEqual(
    home.errors?.map((error) => error.id).sort(),
    ['genres', 'random-picks', 'recommended', 'top-rated'],
  );
  assert.equal(home.errors?.every((error) => error.retryable), true);
});
