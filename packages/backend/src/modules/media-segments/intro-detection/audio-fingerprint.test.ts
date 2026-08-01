import assert from 'node:assert/strict';
import test from 'node:test';
import { getFpcalcLengthSeconds } from './fingerprint-window.js';

test('uses the full detection window when the extracted clip has a decode tail', () => {
  assert.equal(getFpcalcLengthSeconds(600, 602), 600);
});

test('backs off from the exact EOF boundary rejected by fpcalc', () => {
  assert.equal(getFpcalcLengthSeconds(600, 600), 599);
});

test('uses a safe length for media shorter than the configured window', () => {
  assert.equal(getFpcalcLengthSeconds(600, 75.4), 74);
});

test('rejects extracted audio that has no safe fingerprint range', () => {
  assert.equal(getFpcalcLengthSeconds(600, 1), 0);
  assert.equal(getFpcalcLengthSeconds(Number.NaN, 602), 0);
});
