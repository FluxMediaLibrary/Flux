/**
 * Intro detection engine — audio fingerprinting for recurring playback markers.
 *
 * Algorithm:
 *   1. Extract first 4 min of audio from each episode as raw PCM via FFmpeg.
 *   2. Compute RMS energy envelope per ~200 ms window.
 *   3. Cross-correlate envelopes between episode pairs to find matching segments.
 *   4. The intro is the segment near the start that appears consistently across
 *      most episodes.
 *
 * Generic by design — the same cross-correlation approach can find recaps
 * (earlier segment before the intro) or credits (end segment) by adjusting the
 * search window.
 */
import { execFile } from 'node:child_process';
import { createReadStream } from 'node:fs';
import { open, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { prisma } from './db.js';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface IntroDetectionResult {
  startSeconds: number;
  endSeconds: number;
  confidence: number; // 0..1
}

// ─── Configuration ───────────────────────────────────────────────────────────

const ANALYSIS_DURATION_SEC = 240;  // first 4 minutes
const TARGET_SAMPLE_RATE = 8000;    // 8 kHz mono (plenty for energy comparison)
const WINDOW_MS = 200;             // 200 ms per envelope point
const MAX_INTRO_END_SEC = 180;     // intro must end by 3 minutes
const MIN_MATCH_PAIR_FRAC = 0.6;   // intro segment must match in 60%+ of pairs
const CONFIDENCE_THRESHOLD = 0.90; // only store markers above this

// ─── FFmpeg audio extraction ─────────────────────────────────────────────────

/**
 * Extract the first `durationSec` seconds of audio from `filePath` as raw
 * 16-bit signed PCM, mono, at `sampleRate` Hz. Writes to a temp file; caller
 * must clean up.
 */
async function extractAudioPcm(
  filePath: string,
  durationSec: number,
  sampleRate: number,
): Promise<string> {
  const outPath = join(tmpdir(), `flux-intro-${randomUUID()}.pcm`);

  await new Promise<void>((resolve, reject) => {
    const args = [
      '-y',
      '-i', filePath,
      '-t', String(durationSec),
      '-vn',                     // no video
      '-ac', '1',               // mono
      '-ar', String(sampleRate), // target sample rate
      '-f', 's16le',           // raw 16-bit signed PCM, little-endian
      '-sample_fmt', 's16',
      outPath,
    ];
    const proc = execFile('ffmpeg', args, { timeout: 60_000 });
    proc.on('exit', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg exited ${code} for ${filePath}`));
    });
    proc.on('error', reject);
    // ffmpeg outputs info to stderr; suppress noise
    proc.stderr?.resume();
  });

  return outPath;
}

/**
 * Read a raw 16-bit signed PCM file and return the samples as Float64Array
 * (normalized to -1..1 range).
 */
async function readPcmSamples(pcmPath: string): Promise<Float64Array> {
  const fd = await open(pcmPath, 'r');
  try {
    const stat = await fd.stat();
    const totalBytes = stat.size;
    const sampleCount = Math.floor(totalBytes / 2); // 16-bit = 2 bytes per sample

    const buffer = Buffer.alloc(totalBytes);
    let offset = 0;
    const stream = createReadStream('', { fd: fd.fd, autoClose: false });

    for await (const chunk of stream) {
      chunk.copy(buffer, offset);
      offset += chunk.length;
    }

    const samples = new Float64Array(sampleCount);
    for (let i = 0; i < sampleCount; i++) {
      // Read as signed 16-bit little-endian
      const int16 = buffer.readInt16LE(i * 2);
      samples[i] = int16 / 32768; // normalize to -1..1
    }

    return samples;
  } finally {
    await fd.close();
  }
}

/**
 * Compute RMS energy envelope from PCM samples.
 * Each window is `windowSamples` wide; returns one RMS value per window.
 */
function computeEnergyEnvelope(
  samples: Float64Array,
  sampleRate: number,
  windowMs: number,
): Float64Array {
  const windowSamples = Math.round((sampleRate * windowMs) / 1000);
  const numWindows = Math.floor(samples.length / windowSamples);
  const envelope = new Float64Array(numWindows);

  for (let w = 0; w < numWindows; w++) {
    let sumSq = 0;
    const offset = w * windowSamples;
    for (let i = 0; i < windowSamples; i++) {
      const v = samples[offset + i]!;
      sumSq += v * v;
    }
    envelope[w] = Math.sqrt(sumSq / windowSamples);
  }

  return envelope;
}

// ─── Cross-correlation & intro detection ─────────────────────────────────────

/**
 * Normalized cross-correlation between two envelopes over a sliding window.
 * Returns the correlation score for each alignment offset (in envelope indices).
 */
function crossCorrelate(
  a: Float64Array,
  b: Float64Array,
  maxLag: number,
): number[] {
  const len = Math.min(a.length, b.length);
  const result: number[] = new Array(2 * maxLag + 1).fill(0);

  for (let lag = -maxLag; lag <= maxLag; lag++) {
    let sumAB = 0;
    let sumA2 = 0;
    let sumB2 = 0;

    for (let i = 0; i < len; i++) {
      const bi = i + lag;
      if (bi < 0 || bi >= len) continue;
      sumAB += a[i]! * b[bi]!;
      sumA2 += a[i]! * a[i]!;
      sumB2 += b[bi]! * b[bi]!;
    }

    if (sumA2 > 0 && sumB2 > 0) {
      result[lag + maxLag] = sumAB / Math.sqrt(sumA2 * sumB2);
    }
  }

  return result;
}

/**
 * Compute a per-window agreement score across all episode pairs.
 * For each time window position, how many episode pairs have high correlation
 * in that region? High agreement at early times = intro.
 */
function findCommonSegment(
  envelopes: Float64Array[],
  windowMs: number,
  searchEndSec: number,
): IntroDetectionResult | null {
  const n = envelopes.length;
  if (n < 2) return null; // need at least 2 episodes

  const windowDurationSec = windowMs / 1000;
  const searchWindows = Math.floor(searchEndSec / windowDurationSec);
  const maxLag = Math.floor(2 / windowDurationSec); // ±2 sec lag tolerance

  // For each window position, count pairs that agree (correlation > 0.7)
  const agreement: number[] = new Array(searchWindows).fill(0);
  let totalPairs = 0;

  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      totalPairs++;
      const xcorr = crossCorrelate(envelopes[i]!, envelopes[j]!, maxLag);

      for (let w = 0; w < searchWindows; w++) {
        // Check correlation at this exact offset (±small lag)
        let bestCorr = 0;
        for (let lag = -maxLag; lag <= maxLag; lag++) {
          const corr = xcorr[lag + maxLag]!;
          if (corr > bestCorr) bestCorr = corr;
        }
        if (bestCorr > 0.7) {
          agreement[w]! += 1;
        }
      }
    }
  }

  // Normalize agreement to 0..1 and find longest contiguous segment
  const minMatchFrac = MIN_MATCH_PAIR_FRAC;
  let bestStart = -1;
  let bestEnd = -1;
  let bestConfidence = 0;
  let segStart = -1;

  for (let w = 0; w < searchWindows; w++) {
    const frac = agreement[w]! / totalPairs;
    if (frac >= minMatchFrac) {
      if (segStart === -1) segStart = w;
    } else {
      if (segStart !== -1) {
        const startSec = segStart * windowDurationSec;
        if (startSec <= 60 && w - segStart >= 2) {
          const avgConf = avgOver(agreement, segStart, w) / totalPairs;
          if (avgConf > bestConfidence) {
            bestConfidence = avgConf;
            bestStart = segStart;
            bestEnd = w;
          }
        }
        segStart = -1;
      }
    }
  }

  // Handle segment at the end
  if (segStart !== -1) {
    const startSec = segStart * windowDurationSec;
    if (startSec <= 60 && searchWindows - segStart >= 2) {
      const avgConf = avgOver(agreement, segStart, searchWindows) / totalPairs;
      if (avgConf > bestConfidence) {
        bestConfidence = avgConf;
        bestStart = segStart;
        bestEnd = searchWindows;
      }
    }
  }

  if (bestStart === -1) return null;

  return {
    startSeconds: bestStart * windowDurationSec,
    endSeconds: bestEnd * windowDurationSec,
    confidence: bestConfidence,
  };
}

function avgOver(arr: number[], from: number, to: number): number {
  let sum = 0;
  let count = 0;
  for (let i = from; i < to && i < arr.length; i++) {
    sum += arr[i]!;
    count++;
  }
  return count > 0 ? sum / count : 0;
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Analyze a season for intro sequences. Extracts audio from each episode,
 * computes energy envelopes, cross-correlates, and returns the detected intro
 * segment if confidence is above threshold.
 */
export async function detectIntroForSeason(
  mediaItemId: string,
  season: number,
  log?: (msg: string) => void,
): Promise<IntroDetectionResult | null> {
  // Use raw query until prisma generate picks up the new model
  const episodes = await prisma.$queryRawUnsafe<
    { id: string; filePath: string | null; episode: number }[]
  >(
    `SELECT id, "filePath", "episode" FROM "episodes" WHERE "mediaItemId" = $1 AND "season" = $2 AND "filePath" IS NOT NULL ORDER BY "episode" ASC`,
    mediaItemId,
    season,
  );

  if (episodes.length < 2) {
    log?.(`Season ${season}: < 2 episodes with files; skipping.`);
    return null;
  }

  log?.(`Analyzing season ${season}: ${episodes.length} episodes with files.`);

  const envelopes: Float64Array[] = [];
  const tempFiles: string[] = [];

  try {
    for (const ep of episodes) {
      const fp = ep.filePath;
      if (!fp) continue;

      log?.(`  Extracting S${String(season).padStart(2, '0')}E${String(ep.episode).padStart(2, '0')}...`);

      const pcmPath = await extractAudioPcm(fp, ANALYSIS_DURATION_SEC, TARGET_SAMPLE_RATE);
      tempFiles.push(pcmPath);

      const samples = await readPcmSamples(pcmPath);
      const envelope = computeEnergyEnvelope(samples, TARGET_SAMPLE_RATE, WINDOW_MS);
      envelopes.push(envelope);
    }

    if (envelopes.length < 2) return null;

    log?.(`  Cross-correlating ${envelopes.length} envelopes...`);
    const result = findCommonSegment(envelopes, WINDOW_MS, MAX_INTRO_END_SEC);

    if (!result) {
      log?.('  No common segment found.');
      return null;
    }

    log?.(
      `  Detected: ${result.startSeconds.toFixed(1)}s – ${result.endSeconds.toFixed(1)}s (conf: ${(result.confidence * 100).toFixed(1)}%)`,
    );

    if (result.confidence < CONFIDENCE_THRESHOLD) {
      log?.(`  Below threshold ${(CONFIDENCE_THRESHOLD * 100).toFixed(0)}%; discarding.`);
    }

    return result;
  } finally {
    for (const tmp of tempFiles) {
      unlink(tmp).catch(() => {});
    }
  }
}

/**
 * Run intro detection for a season and persist the result.
 * Uses raw SQL until prisma generate picks up the new model.
 */
export async function analyzeAndStoreIntro(
  mediaItemId: string,
  season: number,
  log?: (msg: string) => void,
): Promise<boolean> {
  const result = await detectIntroForSeason(mediaItemId, season, log);

  if (!result || result.confidence < CONFIDENCE_THRESHOLD) {
    await prisma.$executeRawUnsafe(
      `DELETE FROM "playback_markers" WHERE "mediaItemId" = $1 AND "season" = $2 AND "markerType" = 'INTRO'`,
      mediaItemId,
      season,
    );
    return false;
  }

  // Upsert: try insert, on conflict update
  await prisma.$executeRawUnsafe(
    `INSERT INTO "playback_markers" ("id", "mediaItemId", "season", "markerType", "startSeconds", "endSeconds", "confidence", "createdAt", "updatedAt")
     VALUES ($1, $2, $3, 'INTRO', $4, $5, $6, NOW(), NOW())
     ON CONFLICT ("mediaItemId", "season", "markerType")
     DO UPDATE SET "startSeconds" = $4, "endSeconds" = $5, "confidence" = $6, "updatedAt" = NOW()`,
    randomUUID(),
    mediaItemId,
    season,
    result.startSeconds,
    result.endSeconds,
    result.confidence,
  );

  return true;
}

/**
 * Trigger intro detection for all seasons of a show that have episodes with
 * files. Returns the number of seasons queued.
 */
export async function queueIntroDetectionForShow(
  mediaItemId: string,
  enqueueFn: (mediaItemId: string, season: number) => Promise<void>,
  log?: (msg: string) => void,
): Promise<number> {
  const seasons = await prisma.$queryRawUnsafe<{ season: number }[]>(
    `SELECT DISTINCT "season" FROM "episodes" WHERE "mediaItemId" = $1 AND "filePath" IS NOT NULL`,
    mediaItemId,
  );

  const count = seasons.length;
  log?.(`Found ${count} seasons with files for show ${mediaItemId}.`);

  for (const { season } of seasons) {
    await enqueueFn(mediaItemId, season);
  }

  return count;
}
