const test = require('node:test');
const assert = require('node:assert/strict');
const { isSameServer, normalizeServerUrl } = require('../src/server-url.cjs');

test('normalizes domains and defaults to HTTPS', () => {
  assert.equal(normalizeServerUrl(' flux.example.com/library '), 'https://flux.example.com');
});

test('preserves explicit HTTP and ports for local servers', () => {
  assert.equal(normalizeServerUrl('http://192.168.1.20:4938/'), 'http://192.168.1.20:4938');
});

test('rejects unsupported protocols and embedded credentials', () => {
  assert.throws(() => normalizeServerUrl('ftp://flux.example.com'), /http:\/\/ or https:\/\//);
  assert.throws(() => normalizeServerUrl('https://user:pass@flux.example.com'), /without credentials/);
});

test('compares navigation by exact origin', () => {
  assert.equal(isSameServer('https://flux.example.com/watch/1', 'https://flux.example.com'), true);
  assert.equal(isSameServer('https://evil.example.com', 'https://flux.example.com'), false);
});
