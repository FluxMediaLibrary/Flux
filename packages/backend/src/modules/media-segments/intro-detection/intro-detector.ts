/**
 * Offset-aware intro detection over raw Chromaprint fingerprints.
 *
 * Intros must not be assumed to start at zero: cold opens shift the intro to
 * different timestamps per episode. Instead of comparing episode starts, we
 * slide a candidate intro window across a reference episode and look for the
 * same fingerprint sequence (at any offset) in the other episodes of the
 * season. A hypothesis is only accepted when the repeated segment appears in
 * at least `minCoverage` of episodes and every match clears the minimum
 * duration and confidence thresholds.
 *
 * Matching strategy (seed-and-verify, tuned for exact- or near-exact audio):
 *   1. Build one k-mer index across all non-reference episodes (k ~= 0.5s of
 *      frames). Identical audio produces identical raw fingerprint ints, so
 *      exact k-mer hits land at the true alignment.
 *   2. For each candidate reference offset, count k-mer hits per
 *      (episode, alignment) pair, then verify only the top alignment with a
 *      tolerance-aware sliding window (allows occasional frame mismatches).
 *   3. Score hypotheses by coverage, average confidence, then duration.
 */

export interface EpisodeFingerprintInput {
  episodeId: string;
  frames: Int32Array;
  durationSeconds: number;
}

export interface IntroDetectionOptions {
  /** Audio window (seconds) searched per episode. Default 900 (15 min). */
  windowSeconds?: number;
  /** Minimum accepted intro duration in seconds. Default 40. */
  minSeconds?: number;
  /** Minimum frame-match ratio (0..1) for an individual match. Default 0.65. */
  minConfidence?: number;
  /** Minimum fraction of season episodes containing the segment. Default 0.6. */
  minCoverage?: number;
  /** Minimum number of episodes required to run detection. Default 3. */
  minEpisodes?: number;
}

export interface IntroMatch {
  episodeId: string;
  /** Start of the repeated segment, milliseconds from the episode start. */
  startMs: number;
  /** End of the repeated segment, milliseconds from the episode start. */
  endMs: number;
  /** Match ratio (0..1) for this episode's segment. */
  confidence: number;
}

export interface DetectionHypothesis {
  matches: IntroMatch[];
  /** Fraction of episodes (0..1) that contain the repeated segment. */
  coverage: number;
  averageConfidence: number;
  medianDurationMs: number;
}

interface EpisodeSample extends EpisodeFingerprintInput {
  rate: number;
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

function packKmer(frames: Int32Array, start: number, k: number): bigint {
  let key = 0n;
  for (let i = 0; i < k; i++) {
    key = (key << 32n) | BigInt(frames[start + i]! >>> 0);
  }
  return key;
}

/**
 * Longest window in `other` (aligned by `alignment`) whose exact-match ratio to
 * the reference chunk clears a strict run threshold. The window is then trimmed
 * to its first/last matching frames so tolerance cannot inflate the matched
 * duration by absorbing differing content. Returns the window in reference
 * frame coordinates plus the ratio. Null when no qualifying window exists.
 */
function bestMatchingWindow(
  ref: Int32Array,
  refStart: number,
  refEnd: number,
  other: Int32Array,
  alignment: number,
  minConfidence: number,
): { start: number; end: number; confidence: number } | null {
  const lo = Math.max(refStart, -alignment);
  const hi = Math.min(refEnd, other.length - alignment);
  if (hi - lo < 1) return null;

  // The extension threshold is stricter than the acceptance threshold so a
  // long identical run cannot drag in a long tail of differing content while
  // still clearing e.g. 0.65 average similarity.
  const runThreshold = Math.max(minConfidence, 0.8);
  let windowStart = lo;
  let matches = 0;
  let bestLen = 0;
  let bestStart = lo;
  let bestMatches = 0;

  for (let i = lo; i < hi; i++) {
    if (other[i + alignment] === ref[i]) matches += 1;
    while (windowStart <= i && matches / (i - windowStart + 1) < runThreshold) {
      if (other[windowStart + alignment] === ref[windowStart]) matches -= 1;
      windowStart += 1;
    }
    const len = i - windowStart + 1;
    if (len > bestLen) {
      bestLen = len;
      bestStart = windowStart;
      bestMatches = matches;
    }
  }

  if (bestLen < 1) return null;

  // Trim to the tightest run: the matched segment starts at the first matching
  // frame and ends at the last matching frame inside the window.
  let trimmedStart = bestStart;
  let trimmedEnd = bestStart + bestLen;
  while (trimmedStart < trimmedEnd && other[trimmedStart + alignment] !== ref[trimmedStart]) {
    trimmedStart += 1;
  }
  while (trimmedEnd > trimmedStart && other[trimmedEnd - 1 + alignment] !== ref[trimmedEnd - 1]) {
    trimmedEnd -= 1;
  }
  if (trimmedEnd - trimmedStart < 1) return null;

  return {
    start: trimmedStart,
    end: trimmedEnd,
    confidence: bestMatches / (trimmedEnd - trimmedStart),
  };
}

/**
 * Detect the repeated intro sequence across a season's fingerprints.
 * Returns per-episode matches for the winning hypothesis, or null when no
 * hypothesis clears the coverage/duration/confidence gates.
 */
export function detectRepeatedIntro(
  fingerprints: EpisodeFingerprintInput[],
  options: IntroDetectionOptions = {},
): IntroMatch[] | null {
  const windowSeconds = options.windowSeconds ?? 900;
  const minSeconds = options.minSeconds ?? 40;
  const minConfidence = options.minConfidence ?? 0.65;
  const minCoverage = options.minCoverage ?? 0.6;
  const minEpisodes = options.minEpisodes ?? 3;

  if (fingerprints.length < minEpisodes) return null;

  const samples: EpisodeSample[] = fingerprints.map((sample) => ({
    ...sample,
    rate: sample.durationSeconds > 0 ? sample.frames.length / sample.durationSeconds : 0,
  }));
  const valid = samples.filter((sample) => sample.rate > 0 && Number.isFinite(sample.rate));
  if (valid.length < minEpisodes) return null;

  const sharedRate = median(valid.map((sample) => sample.rate));
  if (sharedRate <= 0) return null;

  const minFrames = Math.max(2, Math.round(minSeconds * sharedRate));
  const windowFrames = Math.max(minFrames, Math.round(windowSeconds * sharedRate));

  // Reference episode: median length (most representative of the season).
  const sorted = [...valid].sort((a, b) => a.frames.length - b.frames.length);
  const ref = sorted[Math.floor(sorted.length / 2)]!;
  const others = valid.filter((sample) => sample.episodeId !== ref.episodeId);

  // k-mer index over all non-reference episodes. k ~= 0.5s keeps seeds tolerant
  // of slightly-different encodings while still being selective.
  const k = Math.max(2, Math.round(sharedRate * 0.5));
  const index = new Map<bigint, { episodeIndex: number; pos: number }[]>();
  const indexEpisodeIds: string[] = [];
  const byId = new Map<string, EpisodeSample>();
  for (const sample of valid) byId.set(sample.episodeId, sample);

  for (const sample of others) {
    const episodeIndex = indexEpisodeIds.length;
    indexEpisodeIds.push(sample.episodeId);
    const limit = sample.frames.length - k;
    for (let i = 0; i <= limit; i++) {
      const key = packKmer(sample.frames, i, k);
      const bucket = index.get(key);
      if (bucket) bucket.push({ episodeIndex, pos: i });
      else index.set(key, [{ episodeIndex, pos: i }]);
    }
  }

  const refLimit = ref.frames.length - k;
  const stepFrames = Math.max(1, Math.round(sharedRate)); // ~1s steps
  const lastRefStart = Math.max(0, Math.min(ref.frames.length - minFrames, windowFrames - minFrames));

  let best: DetectionHypothesis | null = null;
  let bestScore = -1;

  for (let r = 0; r <= lastRefStart; r += stepFrames) {
    const refChunkEnd = Math.min(ref.frames.length, r + windowFrames);
    if (refChunkEnd - r < minFrames) break;

    // Count exact k-mer hits per (episode, alignment). `alignment` maps
    // reference frame i to episode frame i + alignment.
    const hitsByEpisode = new Map<number, Map<number, number>>();
    const queryLimit = Math.min(refChunkEnd - r - k, refLimit - r);
    for (let i = 0; i <= queryLimit; i++) {
      const key = packKmer(ref.frames, r + i, k);
      const entries = index.get(key);
      if (!entries) continue;
      for (const entry of entries) {
        const alignment = entry.pos - (r + i);
        let byAlignment = hitsByEpisode.get(entry.episodeIndex);
        if (!byAlignment) {
          byAlignment = new Map();
          hitsByEpisode.set(entry.episodeIndex, byAlignment);
        }
        byAlignment.set(alignment, (byAlignment.get(alignment) ?? 0) + 1);
      }
    }

    const matches: IntroMatch[] = [];
    let matchedCount = 0;
    let confidenceSum = 0;
    const durationsMs: number[] = [];
    // Reference intro bounds, refined from the other episodes' matches: their
    // windows are expressed in reference-frame coordinates, so the intersection
    // of all matches pinpoints where the intro actually starts in the reference.
    const refWindowStarts: number[] = [];
    const refWindowEnds: number[] = [];

    for (const [episodeIndex, byAlignment] of hitsByEpisode) {
      const sample = others[episodeIndex]!;
      // Pick the highest-count alignment (cluster neighbors within +/-1 frame).
      let bestAlignment = -1;
      let bestCount = 0;
      for (const [alignment, count] of byAlignment) {
        if (count > bestCount) {
          bestCount = count;
          bestAlignment = alignment;
        }
      }
      if (bestCount < 2) continue;

      const window = bestMatchingWindow(
        ref.frames,
        r,
        refChunkEnd,
        sample.frames,
        bestAlignment,
        minConfidence,
      );
      if (!window || window.end - window.start < minFrames) continue;

      matchedCount += 1;
      const startMs = Math.round(((window.start + bestAlignment) / sharedRate) * 1000);
      const endMs = Math.round(((window.end + bestAlignment) / sharedRate) * 1000);
      matches.push({
        episodeId: sample.episodeId,
        startMs,
        endMs,
        confidence: window.confidence,
      });
      confidenceSum += window.confidence;
      durationsMs.push(endMs - startMs);
      refWindowStarts.push(window.start);
      refWindowEnds.push(window.end);
    }

    // The reference itself is included when the season's hypothesis is accepted:
    // its start/end are derived from the other episodes' matched windows (the
    // reference cannot self-verify a run length because it trivially matches).
    if (matchedCount > 0) {
      matchedCount += 1;
      const refStartFrame = refWindowStarts.length > 0 ? Math.min(...refWindowStarts) : r;
      const refEndFrame = refWindowEnds.length > 0 ? Math.max(...refWindowEnds) : refStartFrame + minFrames;
      const refConfidence = durationsMs.length > 0
        ? median(matches.map((m) => m.confidence))
        : 1;
      const startMs = Math.round((refStartFrame / sharedRate) * 1000);
      const endMs = Math.round((refEndFrame / sharedRate) * 1000);
      matches.push({
        episodeId: ref.episodeId,
        startMs,
        endMs,
        confidence: refConfidence,
      });
      confidenceSum += refConfidence;
      durationsMs.push(endMs - startMs);
    }

    const coverage = matchedCount / valid.length;
    if (coverage < minCoverage) continue;

    const averageConfidence = confidenceSum / matchedCount;
    const medianDurationMs = median(durationsMs);
    const score = coverage * 1_000_000 + averageConfidence * 1_000 + medianDurationMs / 1000;
    if (score > bestScore) {
      bestScore = score;
      best = { matches, coverage, averageConfidence, medianDurationMs };
    }
  }

  if (!best) return null;
  return best.matches.sort((a, b) => {
    const aIdx = fingerprints.findIndex((f) => f.episodeId === a.episodeId);
    const bIdx = fingerprints.findIndex((f) => f.episodeId === b.episodeId);
    return aIdx - bIdx;
  });
}
