import assert from 'node:assert/strict';
import test from 'node:test';
import { chooseMediaRoot } from './storage-policy.js';

const GB = 1024 ** 3;

test('keeps the primary root while the import leaves the configured reserve', () => {
  const root = chooseMediaRoot([
    { root: '/primary', freeBytes: 50 * GB },
    { root: '/overflow', freeBytes: 500 * GB },
  ], 25 * GB, 20 * GB);
  assert.equal(root, '/primary');
});

test('spills the whole import to the next root before the primary crosses reserve', () => {
  const root = chooseMediaRoot([
    { root: '/primary', freeBytes: 35 * GB },
    { root: '/overflow', freeBytes: 500 * GB },
  ], 20 * GB, 20 * GB);
  assert.equal(root, '/overflow');
});

test('uses the roomiest available root when no drive can preserve the reserve', () => {
  const root = chooseMediaRoot([
    { root: '/primary', freeBytes: 15 * GB },
    { root: '/overflow', freeBytes: 18 * GB },
  ], 10 * GB, 20 * GB);
  assert.equal(root, '/overflow');
});

test('refuses placement when no drive can fit the incoming payload', () => {
  const root = chooseMediaRoot([
    { root: '/primary', freeBytes: 15 * GB },
    { root: '/overflow', freeBytes: 18 * GB },
  ], 20 * GB, 20 * GB);
  assert.equal(root, null);
});
