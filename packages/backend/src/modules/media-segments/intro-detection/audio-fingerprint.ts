/**
 * Audio fingerprinting for intro detection.
 *
 * Pipeline per episode:
 *   1. FFmpeg decodes the first `windowSeconds` of audio to a normalized mono
 *      22050 Hz WAV (consistent input = consistent fingerprints).
 *   2. `fpcalc -raw -json` (Chromaprint) converts that WAV into raw integer
 *      fingerprints, one value per ~0.12-0.17s frame.
 *
 * Raw fingerprints are used instead of the compressed/base64 form because
 * offset-aware matching needs per-frame integers, not one opaque blob.
 */
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { config } from '../../../config.js';
import { getFpcalcLengthSeconds } from './fingerprint-window.js';

export interface EpisodeFingerprint {
  episodeId: string;
  /** Raw Chromaprint integers (fpcalc -raw). */
  frames: Int32Array;
  /** Analyzed audio duration in seconds as reported by fpcalc. */
  durationSeconds: number;
  /** Frames per second measured from this sample. */
  rate: number;
}

interface FpcalcJson {
  duration: number;
  fingerprint: number[];
}

interface ProcessResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

const FPCALC_DECODE_TAIL_SECONDS = 2;

function runProcess(
  command: string,
  args: string[],
  timeoutMs: number,
): Promise<ProcessResult> {
  return new Promise((resolve) => {
    const proc = spawn(command, args, { windowsHide: true });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      proc.kill('SIGKILL');
    }, timeoutMs);
    proc.stdout.on('data', (chunk: Buffer) => { stdout += chunk.toString(); });
    proc.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString(); });
    proc.on('error', (error) => {
      clearTimeout(timer);
      resolve({ code: null, stdout, stderr: `${error.message}\n${stderr}` });
    });
    proc.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr });
    });
  });
}

/**
 * Fingerprint the first `windowSeconds` of a media file. Returns null when the
 * file cannot be decoded or fpcalc is unavailable, so one bad episode cannot
 * take down a whole season rescan.
 */
export async function fingerprintEpisodeAudio(
  filePath: string,
  episodeId: string,
  windowSeconds = config.INTRO_DETECTION_WINDOW_MINUTES * 60,
  onDiagnostic?: (message: string) => unknown | Promise<unknown>,
): Promise<EpisodeFingerprint | null> {
  const workDir = path.join(os.tmpdir(), `flux-intro-${randomUUID()}`);
  const wavPath = path.join(workDir, 'audio.wav');
  const reportFailure = async (message: string) => {
    console.warn(`[IntroDetection] ${message}`);
    try {
      await onDiagnostic?.(message);
    } catch {
      // Diagnostics must never turn one unreadable episode into a failed job.
    }
  };

  try {
    await fs.mkdir(workDir, { recursive: true });

    const extract = await runProcess(config.INTRO_FFMPEG_PATH, [
      '-y',
      '-v', 'error',
      '-ss', '0',
      // fpcalc must be able to decode beyond its requested fingerprint length.
      '-t', String(windowSeconds + FPCALC_DECODE_TAIL_SECONDS),
      '-i', filePath,
      '-vn',
      '-ac', '1',
      '-ar', '22050',
      '-c:a', 'pcm_s16le',
      '-f', 'wav',
      wavPath,
    ], 10 * 60 * 1000);

    if (extract.code !== 0) {
      await reportFailure(
        `ffmpeg extraction failed for ${episodeId}: ${(extract.stderr || `exit ${extract.code}`).slice(0, 400)}`,
      );
      return null;
    }

    const probe = await runProcess('ffprobe', [
      '-v', 'error',
      '-show_entries', 'format=duration',
      '-of', 'csv=p=0',
      wavPath,
    ], 60_000);
    const extractedDurationSeconds = Number.parseFloat(probe.stdout.trim());
    const fingerprintSeconds = getFpcalcLengthSeconds(windowSeconds, extractedDurationSeconds);
    if (probe.code !== 0 || fingerprintSeconds < 1) {
      await reportFailure(
        `extracted audio is too short or unreadable for ${episodeId}: ` +
        `${probe.stderr.trim() || `${extractedDurationSeconds || 0}s decoded`}`,
      );
      return null;
    }

    const calc = await runProcess(config.INTRO_FPCALC_PATH, [
      '-raw',
      '-json',
      // fpcalc defaults to 120s. Use the full configured window, but never ask
      // it to decode through the exact EOF boundary (fpcalc 1.5.x exits 1).
      '-length', String(fingerprintSeconds),
      wavPath,
    ], 10 * 60 * 1000);

    if (calc.code !== 0) {
      const stderr = calc.stderr.trim();
      const hint = /ENOENT|not found|is not recognized/i.test(stderr)
        ? 'fpcalc (libchromaprint-tools) is not installed on the server'
        : stderr.slice(0, 400);
      await reportFailure(`fpcalc failed for ${episodeId}: ${hint || `exit ${calc.code}`}`);
      return null;
    }

    let parsed: FpcalcJson;
    try {
      parsed = JSON.parse(calc.stdout) as FpcalcJson;
    } catch {
      await reportFailure(`fpcalc output was not JSON for ${episodeId}`);
      return null;
    }

    const raw = parsed.fingerprint;
    if (!Array.isArray(raw) || raw.length === 0) {
      await reportFailure(`empty fingerprint for ${episodeId}`);
      return null;
    }

    // fpcalc reports the intermediate file duration, not the requested range.
    // The explicit safe request length is the analyzed duration used to map
    // fingerprint frame offsets back to playback time.
    const durationSeconds = fingerprintSeconds;
    const frames = Int32Array.from(raw);
    const rate = durationSeconds > 0 ? frames.length / durationSeconds : 0;
    if (rate <= 0 || !Number.isFinite(rate)) {
      await reportFailure(`invalid fingerprint duration for ${episodeId}`);
      return null;
    }

    return { episodeId, frames, durationSeconds, rate };
  } catch (error) {
    await reportFailure(`fingerprinting failed for ${episodeId}: ${String(error)}`);
    return null;
  } finally {
    await fs.rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
}
