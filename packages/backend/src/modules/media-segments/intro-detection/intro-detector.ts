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
 * Matching strategy (seed-and-verify, tolerant of codec differences):
 *   1. Index the upper 14 bits of individual subfingerprints, following the
 *      alignment strategy used by AcoustID's matcher. This still produces
 *      stable offset votes when a codec changes a few bits in every frame.
 *   2. For each candidate reference offset, cluster neighboring alignment
 *      votes, then verify the best alignment using normalized Hamming distance
 *      rather than exact 32-bit equality.
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

const ALIGNMENT_SEED_BITS = 14;
const ALIGNMENT_SEED_SHIFT = 32 - ALIGNMENT_SEED_BITS;
const MAX_SEED_OCCURRENCES = 128;

function alignmentSeed(frame: number): number {
  return frame >>> ALIGNMENT_SEED_SHIFT;
}

function popcount32(value: number): number {
  let bits = value >>> 0;
  bits -= (bits >>> 1) & 0x55555555;
  bits = (bits & 0x33333333) + ((bits >>> 2) & 0x33333333);
  return (((bits + (bits >>> 4)) & 0x0f0f0f0f) * 0x01010101) >>> 24;
}

/** AcoustID-style score: unrelated frames average near 0; identical is 1. */
function frameSimilarity(left: number, right: number): number {
  return Math.max(0, 1 - popcount32(left ^ right) / 16);
}

/**
 * Longest locally-similar window in `other` at one candidate alignment. A
 * two-second rolling score identifies the stable repeated region. A lower
 * activation threshold keeps codec noise from splitting one intro into several
 * fragments; the completed run must still clear `minConfidence` as a whole.
 */
function bestMatchingWindow(
  ref: Int32Array,
  refStart: number,
  refEnd: number,
  other: Int32Array,
  alignment: number,
  minConfidence: number,
  framesPerSecond: number,
): { start: number; end: number; confidence: number } | null {
  const lo = Math.max(refStart, -alignment);
  const hi = Math.min(refEnd, other.length - alignment);
  if (hi - lo < 1) return null;

  const similarities = new Float64Array(hi - lo);
  for (let i = lo; i < hi; i++) {
    similarities[i - lo] = frameSimilarity(ref[i]!, other[i + alignment]!);
  }

  const smoothingFrames = Math.max(3, Math.round(framesPerSecond * 2));
  if (similarities.length < smoothingFrames) return null;
  const maxGapFrames = Math.max(1, Math.round(framesPerSecond * 2));
  const activationConfidence = Math.max(0.25, minConfidence - 0.12);
  let rollingSum = 0;
  for (let i = 0; i < smoothingFrames; i++) rollingSum += similarities[i]!;

  let runStart = -1;
  let lastStrongStart = -1;
  let bestLen = 0;
  let bestStart = -1;
  let bestEnd = -1;

  const considerRun = () => {
    if (runStart < 0 || lastStrongStart < runStart) return;
    const end = Math.min(similarities.length, lastStrongStart + smoothingFrames);
    const len = end - runStart;
    if (len > bestLen) {
      bestLen = len;
      bestStart = runStart;
      bestEnd = end;
    }
  };

  const lastWindowStart = similarities.length - smoothingFrames;
  for (let start = 0; start <= lastWindowStart; start++) {
    if (start > 0) {
      rollingSum += similarities[start + smoothingFrames - 1]! - similarities[start - 1]!;
    }
    const strong = rollingSum / smoothingFrames >= activationConfidence;
    if (strong) {
      if (runStart < 0) runStart = start;
      lastStrongStart = start;
    } else if (runStart >= 0 && start - lastStrongStart > maxGapFrames) {
      considerRun();
      runStart = -1;
      lastStrongStart = -1;
    }
  }
  considerRun();

  if (bestLen < 1 || bestStart < 0 || bestEnd <= bestStart) return null;
  let similaritySum = 0;
  for (let i = bestStart; i < bestEnd; i++) similaritySum += similarities[i]!;
  const confidence = similaritySum / bestLen;
  if (confidence < minConfidence) return null;

  return {
    start: lo + bestStart,
    end: lo + bestEnd,
    confidence,
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

  // Upper-14-bit seed index mirrors AcoustID's alignment approach. Very common
  // values (typically silence) are ignored so they cannot dominate voting.
  const index = new Map<number, { episodeIndex: number; pos: number }[]>();
  for (const [episodeIndex, sample] of others.entries()) {
    const limit = Math.min(sample.frames.length, windowFrames);
    for (let i = 0; i < limit; i++) {
      const key = alignmentSeed(sample.frames[i]!);
      const bucket = index.get(key);
      if (bucket) bucket.push({ episodeIndex, pos: i });
      else index.set(key, [{ episodeIndex, pos: i }]);
    }
  }

  const refLimit = Math.min(ref.frames.length, windowFrames) - 1;
  const stepFrames = Math.max(1, Math.round(sharedRate)); // ~1s steps
  const lastRefStart = Math.max(0, Math.min(ref.frames.length - minFrames, windowFrames - minFrames));

  let best: DetectionHypothesis | null = null;
  let bestScore = -1;

  for (let r = 0; r <= lastRefStart; r += stepFrames) {
    const refChunkEnd = Math.min(ref.frames.length, r + windowFrames);
    if (refChunkEnd - r < minFrames) break;

    // Count stable 14-bit seed hits per (episode, alignment). `alignment` maps
    // reference frame i to episode frame i + alignment.
    const hitsByEpisode = new Map<number, Map<number, number>>();
    const queryLimit = Math.min(refChunkEnd - r - 1, refLimit - r);
    for (let i = 0; i <= queryLimit; i++) {
      const key = alignmentSeed(ref.frames[r + i]!);
      const entries = index.get(key);
      if (!entries || entries.length > MAX_SEED_OCCURRENCES) continue;
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
      // Rank several alignments after clustering codec-delay jitter. Repeated
      // musical motifs can outvote the true start by a small amount, so verify
      // the strongest candidates instead of trusting a single seed maximum.
      const rankedAlignments: { alignment: number; count: number }[] = [];
      for (const [alignment, count] of byAlignment) {
        let clusteredCount = count;
        for (let delta = -2; delta <= 2; delta++) {
          if (delta !== 0) clusteredCount += byAlignment.get(alignment + delta) ?? 0;
        }
        rankedAlignments.push({ alignment, count: clusteredCount });
      }
      rankedAlignments.sort((a, b) => b.count - a.count);

      let bestAlignment = 0;
      let window: ReturnType<typeof bestMatchingWindow> = null;
      let bestSeedCount = -1;
      const verifiedAlignments: number[] = [];
      for (const candidate of rankedAlignments) {
        if (candidate.count < 2 || verifiedAlignments.length >= 12) break;
        verifiedAlignments.push(candidate.alignment);
        const candidateWindow = bestMatchingWindow(
          ref.frames,
          r,
          refChunkEnd,
          sample.frames,
          candidate.alignment,
          minConfidence,
          sharedRate,
        );
        if (!candidateWindow || candidateWindow.end - candidateWindow.start < minFrames) continue;
        if (
          !window ||
          candidate.count > bestSeedCount ||
          (
            candidate.count === bestSeedCount &&
            (
              candidateWindow.confidence > window.confidence ||
              (
                candidateWindow.confidence === window.confidence &&
                candidateWindow.end - candidateWindow.start > window.end - window.start
              )
            )
          )
        ) {
          window = candidateWindow;
          bestAlignment = candidate.alignment;
          bestSeedCount = candidate.count;
        }
      }
      if (!window) continue;

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
