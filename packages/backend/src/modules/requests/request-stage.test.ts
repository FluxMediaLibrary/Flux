import assert from 'node:assert/strict';
import test from 'node:test';

process.env.DATABASE_URL ??= 'postgres://user:pass@localhost:5432/flux_test';
process.env.REDIS_URL ??= 'redis://127.0.0.1:1';
process.env.JWT_SECRET ??= 'test-secret-1234567890';
process.env.NODE_ENV = 'test';

const { deriveRequestStage } = await import('./requests.service.js');

test('stored terminal states win over torrent state', () => {
  assert.equal(deriveRequestStage('FULFILLED', { status: 'ERROR', progress: 0.2, errorMessage: 'x' }).stage, 'AVAILABLE');
  assert.equal(deriveRequestStage('REJECTED', null).stage, 'REJECTED');
});

test('a failed torrent surfaces as FAILED with its reason even while the request says downloading', () => {
  const result = deriveRequestStage('DOWNLOADING', { status: 'ERROR', progress: 0.4, errorMessage: 'No media volume has enough space for 12 GB' });
  assert.equal(result.stage, 'FAILED');
  assert.match(result.failureReason ?? '', /enough space/);
});

test('download progress flows through while downloading', () => {
  const result = deriveRequestStage('APPROVED', { status: 'DOWNLOADING', progress: 0.55, errorMessage: null });
  assert.equal(result.stage, 'DOWNLOADING');
  assert.equal(result.progress, 0.55);
});

test('post-download import states read as processing', () => {
  assert.equal(deriveRequestStage('DOWNLOADING', { status: 'PROCESSING', progress: 1, errorMessage: null }).stage, 'PROCESSING');
  assert.equal(deriveRequestStage('DOWNLOADING', { status: 'SEEDING', progress: 1, errorMessage: null }).stage, 'PROCESSING');
});

test('requests without a job map to requested/approved', () => {
  assert.equal(deriveRequestStage('PENDING', null).stage, 'REQUESTED');
  assert.equal(deriveRequestStage('APPROVED', undefined).stage, 'APPROVED');
});
