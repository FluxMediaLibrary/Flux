import assert from 'node:assert/strict';
import test from 'node:test';
import { isProgressComplete } from './progress-policy.js';

test('progress completion uses the shared 92 percent threshold', () => {
  assert.equal(isProgressComplete(919, 1000), false);
  assert.equal(isProgressComplete(920, 1000), true);
  assert.equal(isProgressComplete(1000, 1000), true);
});

test('progress without a valid duration remains incomplete', () => {
  assert.equal(isProgressComplete(100, undefined), false);
  assert.equal(isProgressComplete(100, null), false);
  assert.equal(isProgressComplete(100, 0), false);
});
