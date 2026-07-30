import assert from 'node:assert/strict';
import test from 'node:test';
import {
  normalizeAvatarPresetId,
  normalizeProfileAvatarReference,
  SAFE_DEFAULT_AVATAR_ID,
} from '@flux/shared';
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

test('profile avatars allow Flux, Sins, and zodiac presets but reject retired ids', () => {
  assert.equal(createProfileSchema.parse({ name: 'Flux', avatar: 'flux-orbit' }).avatar, 'flux-orbit');
  assert.equal(createProfileSchema.parse({ name: 'Pride', avatar: 'sin-pride' }).avatar, 'sin-pride');
  assert.equal(
    createProfileSchema.parse({ name: 'Scorpio', avatar: '5375_zodiac_scorpio' }).avatar,
    '5375_zodiac_scorpio',
  );
  assert.equal(
    createProfileSchema.safeParse({ name: 'Legacy', avatar: '1734-vaultboy' }).success,
    false,
  );
});

test('stale avatar ids fall back without changing initials or original Flux selections', () => {
  assert.equal(normalizeAvatarPresetId(null), null);
  assert.equal(normalizeAvatarPresetId('robot'), 'flux-robot');
  assert.equal(normalizeAvatarPresetId('missing-retired-avatar'), SAFE_DEFAULT_AVATAR_ID);
  assert.equal(
    normalizeProfileAvatarReference('/uploads/avatars/user-owned.webp'),
    '/uploads/avatars/user-owned.webp',
  );
  assert.equal(
    normalizeProfileAvatarReference('/avatars/retired-preset.png'),
    SAFE_DEFAULT_AVATAR_ID,
  );
});
