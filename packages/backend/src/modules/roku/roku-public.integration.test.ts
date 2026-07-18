import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import type { FastifyInstance } from 'fastify';

process.env.NODE_ENV = 'production';
process.env.DATABASE_URL = 'postgresql://test:test@127.0.0.1:1/flux_test';
process.env.REDIS_URL = 'redis://127.0.0.1:1';
process.env.JWT_SECRET = 'roku-integration-test-secret-value';
process.env.TMDB_API_KEY = 'test-key';
process.env.FRONTEND_ORIGIN = 'https://flux.test';
process.env.FLUX_SERVER_ID = '11111111-1111-4111-a111-111111111111';
process.env.FLUX_SERVER_NAME = 'Flux Test';
process.env.FLUX_SERVER_VERSION = '2.3.4';
process.env.ROKU_MIN_VERSION = '1.0.0';
process.env.ROKU_LATEST_VERSION = '1.4.0';
process.env.ROKU_FEATURE_REQUESTS = 'false';
process.env.ROKU_ANNOUNCEMENT = 'Integration announcement';
process.env.ROKU_RELEASE_NOTES = 'First note|Second note';

let app: FastifyInstance;

before(async () => {
  const [{ default: Fastify }, { clientRoutes }, { rokuClientRoutes }] = await Promise.all([
    import('fastify'),
    import('../client/client.routes.js'),
    import('./roku.routes.js'),
  ]);
  app = Fastify({ logger: false });
  await app.register(clientRoutes, { prefix: '/api/client' });
  await app.register(rokuClientRoutes, { prefix: '/api/clients' });
  await app.ready();
});

after(async () => {
  await app.close();
});

test('Roku bootstrap exposes server identity, compatibility, auth, branding, and disabled features', async () => {
  const response = await app.inject({ method: 'GET', url: '/api/client/bootstrap' });
  assert.equal(response.statusCode, 200);
  const body = response.json();
  assert.equal(body.product, 'flux');
  assert.equal(body.serverId, process.env.FLUX_SERVER_ID);
  assert.equal(body.serverName, 'Flux Test');
  assert.equal(body.serverVersion, '2.3.4');
  assert.deepEqual(body.authentication, { deviceLink: true, usernamePassword: false });
  assert.equal(body.features.requests, false);
  assert.equal(body.branding.logoUrl, 'https://flux.test/icon-512.png');
});

test('Roku version endpoint returns minimum/latest policy and parsed release notes', async () => {
  const response = await app.inject({ method: 'GET', url: '/api/clients/roku/version' });
  assert.equal(response.statusCode, 200);
  const body = response.json();
  assert.equal(body.minimumVersion, '1.0.0');
  assert.equal(body.latestVersion, '1.4.0');
  assert.deepEqual(body.releaseNotes, ['First note', 'Second note']);
});

test('Roku remote config exposes bounded defaults without executable payloads', async () => {
  const response = await app.inject({ method: 'GET', url: '/api/clients/roku/config' });
  assert.equal(response.statusCode, 200);
  const body = response.json();
  assert.equal(body.apiVersion, 1);
  assert.equal(body.features.requests, false);
  assert.equal(body.playbackDefaults.completionThreshold, 0.92);
  assert.equal(body.announcement, 'Integration announcement');
  assert.equal(body.ui.heroRotationSeconds, 8);
  assert.equal(Object.hasOwn(body, 'code'), false);
});
