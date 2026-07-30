import assert from 'node:assert/strict';
import test from 'node:test';
import {
  activateProfileSchema,
  createProfileSchema,
  updateProfileSchema,
} from './profiles.schema.js';

test('profile PINs are optional but exactly four numeric digits when supplied', () => {
  assert.equal(createProfileSchema.parse({ name: 'Family', pin: '0427' }).pin, '0427');
  assert.equal(activateProfileSchema.parse({ pin: '0000' }).pin, '0000');
  assert.equal(updateProfileSchema.parse({ pin: null, accountPassword: 'account-secret' }).pin, null);
  assert.equal(updateProfileSchema.safeParse({ pin: null }).success, false);

  for (const pin of ['123', '12345', '12a4', '１２３４']) {
    assert.equal(createProfileSchema.safeParse({ name: 'Family', pin }).success, false);
  }
});
