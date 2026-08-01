import assert from 'node:assert/strict';
import test from 'node:test';
import {
  detectRepeatedIntro,
  type EpisodeFingerprintInput,
} from './intro-detector.js';

/** Deterministic PRNG so tests are stable across runs. */
function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const RATE = 5.8; // frames per second (fpcalc raw)
const WINDOW_SECONDS = 900;
const TOTAL_FRAMES = Math.round(RATE * WINDOW_SECONDS);

function randomFrames(seed: number, length: number): Int32Array {
  const rng = mulberry32(seed);
  const frames = new Int32Array(length);
  for (let i = 0; i < length; i++) {
    frames[i] = (rng() * 2 ** 32) | 0;
  }
  return frames;
}

const SHARED_INTRO = randomFrames(777, Math.round(90 * RATE));

function makeEpisode(
  episodeId: string,
  seed: number,
  introOffsetSeconds: number,
  introSeconds: number,
): EpisodeFingerprintInput {
  const introOffsetFrames = Math.round(introOffsetSeconds * RATE);
  const introFrames = Math.round(introSeconds * RATE);
  const frames = randomFrames(seed, TOTAL_FRAMES);
  for (let i = 0; i < introFrames; i++) {
    frames[introOffsetFrames + i] = SHARED_INTRO[i]!;
  }
  return {
    episodeId,
    frames,
    durationSeconds: TOTAL_FRAMES / RATE,
  };
}

function makeCodecVariantEpisode(
  episodeId: string,
  seed: number,
  intro: Int32Array,
  introOffsetSeconds: number,
): EpisodeFingerprintInput {
  const frames = randomFrames(seed, TOTAL_FRAMES);
  const offset = Math.round(introOffsetSeconds * RATE);
  const rng = mulberry32(seed * 97);
  for (let i = 0; i < intro.length; i++) {
    let value = intro[i]!;
    // Flip 1-4 different bits in every frame. There are deliberately no exact
    // 32-bit frame matches, which models fingerprints from different encodes.
    const flips = 1 + Math.floor(rng() * 4);
    const used = new Set<number>();
    for (let bitIndex = 0; bitIndex < flips; bitIndex++) {
      let bit = Math.floor(rng() * 32);
      while (used.has(bit)) bit = (bit + 1) % 32;
      used.add(bit);
      value ^= 1 << bit;
    }
    frames[offset + i] = value;
  }
  return { episodeId, frames, durationSeconds: TOTAL_FRAMES / RATE };
}

test('detects a repeated intro at different offsets (cold opens)', () => {
  const episodes = [
    makeEpisode('ep1', 11, 0, 60),
    makeEpisode('ep2', 22, 20, 60),
    makeEpisode('ep3', 33, 8, 60),
  ];

  const matches = detectRepeatedIntro(episodes, { minCoverage: 0.6 });
  assert.ok(matches, 'expected a detection result');
  assert.equal(matches.length, 3);

  const byEpisode = new Map(matches.map((match) => [match.episodeId, match]));
  const ep1 = byEpisode.get('ep1')!;
  const ep2 = byEpisode.get('ep2')!;
  const ep3 = byEpisode.get('ep3')!;

  assert.ok(Math.abs(ep1.startMs - 0) <= 2000, `ep1 starts near 0s, got ${ep1.startMs}ms`);
  assert.ok(Math.abs(ep2.startMs - 20000) <= 2000, `ep2 starts near 20s, got ${ep2.startMs}ms`);
  assert.ok(Math.abs(ep3.startMs - 8000) <= 2000, `ep3 starts near 8s, got ${ep3.startMs}ms`);

  for (const match of matches) {
    assert.ok(match.confidence >= 0.9, `confidence ${match.confidence} for ${match.episodeId}`);
    assert.ok(match.endMs - match.startMs >= 50_000, `intro is at least ~50s for ${match.episodeId}`);
  }
});

test('detects codec-variant intros without any exact fingerprint frames', () => {
  const intro = randomFrames(500, Math.round(75 * RATE));
  const episodes = [
    makeCodecVariantEpisode('ep1', 101, intro, 0),
    makeCodecVariantEpisode('ep2', 202, intro, 18),
    makeCodecVariantEpisode('ep3', 303, intro, 7),
    makeCodecVariantEpisode('ep4', 404, intro, 31),
  ];

  const matches = detectRepeatedIntro(episodes, { minCoverage: 0.75 });
  assert.ok(matches, 'expected codec-tolerant intro detection');
  assert.equal(matches.length, 4);
  const expectedOffsets = new Map([['ep1', 0], ['ep2', 18], ['ep3', 7], ['ep4', 31]]);
  for (const match of matches) {
    const expected = expectedOffsets.get(match.episodeId)!;
    assert.ok(
      Math.abs(match.startMs / 1000 - expected) <= 3,
      `${match.episodeId} expected near ${expected}s, got ${match.startMs / 1000}s; ${JSON.stringify(matches)}`,
    );
    assert.ok(match.endMs - match.startMs >= 65_000);
    assert.ok(match.confidence >= 0.65);
  }
});

test('rejects when the segment does not appear in most episodes', () => {
  const episodes = [
    makeEpisode('ep1', 11, 0, 60),
    makeEpisode('ep2', 22, 0, 60),
    makeEpisode('ep3', 33, -1, 0), // no intro
    makeEpisode('ep4', 44, -1, 0), // no intro
  ];

  const matches = detectRepeatedIntro(episodes, { minCoverage: 0.6 });
  assert.equal(matches, null);
});

test('rejects segments shorter than the minimum duration', () => {
  const episodes = [
    makeEpisode('ep1', 11, 0, 20),
    makeEpisode('ep2', 22, 12, 20),
    makeEpisode('ep3', 33, 4, 20),
  ];

  const matches = detectRepeatedIntro(episodes, { minSeconds: 40, minCoverage: 0.6 });
  assert.equal(matches, null);
});

test('rejects matches below the confidence threshold', () => {
  const episodes = [
    makeEpisode('ep1', 11, 0, 60),
    makeEpisode('ep2', 22, 20, 60),
    makeEpisode('ep3', 33, 8, 60),
  ];

  // Corrupt half of each intro so the similarity score drops below threshold.
  for (const episode of episodes) {
    const introOffset = episode.episodeId === 'ep2' ? 116 : episode.episodeId === 'ep3' ? 46 : 0;
    const rng = mulberry32(9000 + episode.episodeId.charCodeAt(2));
    for (let i = introOffset; i < introOffset + Math.round(60 * RATE); i += 2) {
      episode.frames[i] = (rng() * 2 ** 32) | 0;
    }
  }

  const matches = detectRepeatedIntro(episodes, { minConfidence: 0.65, minCoverage: 0.6 });
  assert.equal(matches, null);
});

test('requires a minimum number of episodes', () => {
  const episodes = [
    makeEpisode('ep1', 11, 0, 60),
    makeEpisode('ep2', 22, 20, 60),
  ];
  assert.equal(detectRepeatedIntro(episodes), null);
});

test('returns null for empty input', () => {
  assert.equal(detectRepeatedIntro([]), null);
});
