import assert from 'node:assert/strict';
import test from 'node:test';
import { isAllowedDiscordWebhook } from './discord-webhook.js';

test('accepts only exact HTTPS Discord webhook endpoints', () => {
  assert.equal(
    isAllowedDiscordWebhook('https://discord.com/api/webhooks/123456/token-value'),
    true,
  );
  assert.equal(
    isAllowedDiscordWebhook('https://canary.discord.com/api/webhooks/123456/token-value'),
    true,
  );
  assert.equal(isAllowedDiscordWebhook('http://discord.com/api/webhooks/123/token'), false);
  assert.equal(isAllowedDiscordWebhook('https://discord.com.evil.test/api/webhooks/123/token'), false);
  assert.equal(isAllowedDiscordWebhook('https://discord.com/api/webhooks/123/token/extra'), false);
  assert.equal(isAllowedDiscordWebhook('https://127.0.0.1/api/webhooks/123/token'), false);
});
