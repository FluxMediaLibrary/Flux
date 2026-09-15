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
  const originalQueryRaw = prisma.$queryRaw;
  prisma.watchProgress.findMany = (async () => []) as typeof prisma.watchProgress.findMany;
  // New releases still go through findMany (year filter); the recently-added
  // and discovery pools use the light raw projection.
  prisma.mediaItem.findMany = (async () => []) as typeof prisma.mediaItem.findMany;
  let rawCalls = 0;
  prisma.$queryRaw = (async () => {
    rawCalls += 1;
    // First call: recently added (LIMIT 20). Second: discovery pool (cardinality filter).
    if (rawCalls === 2) throw new Error('simulated discovery failure');
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
      filePath: '/media/movie.mp4',
      addedAt: new Date('2026-01-01T00:00:00.000Z'),
      runtimeMinutes: null,
      contentRating: null,
      rating: null,
    }];
  }) as typeof prisma.$queryRaw;
  t.after(() => {
    prisma.watchProgress.findMany = originalProgressFindMany;
    prisma.mediaItem.findMany = originalMediaFindMany;
    prisma.$queryRaw = originalQueryRaw;
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
