import assert from 'node:assert/strict';
import test from 'node:test';
import { generateUserCode, hashOpaqueToken, isExpired, normalizeUserCode } from './device-auth.utils.js';

test('normalizes human-entered Roku codes', () => {
  assert.equal(normalizeUserCode('abc 234'), 'ABC-234');
  assert.equal(normalizeUserCode('ABC-23'), '');
  assert.equal(normalizeUserCode('ABC-2345'), '');
});

test('generates unambiguous display codes', () => {
  for (let index = 0; index < 100; index += 1) {
    assert.match(generateUserCode(), /^[A-HJ-NP-Z2-9]{3}-[A-HJ-NP-Z2-9]{3}$/);
  }
});

test('hashes opaque tokens deterministically without retaining the token', () => {
  const token = 'private-device-code';
  const hash = hashOpaqueToken(token);
  assert.equal(hash, hashOpaqueToken(token));
  assert.match(hash, /^[a-f0-9]{64}$/);
  assert.ok(!hash.includes(token));
});

test('treats token expiry boundaries deterministically', () => {
  const now = Date.parse('2026-07-17T12:00:00.000Z');
  assert.equal(isExpired(new Date(now - 1), now), true);
  assert.equal(isExpired(new Date(now), now), true);
  assert.equal(isExpired(new Date(now + 1), now), false);
});
