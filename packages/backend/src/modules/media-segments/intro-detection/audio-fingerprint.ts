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
): Promise<EpisodeFingerprint | null> {
  const workDir = path.join(os.tmpdir(), `flux-intro-${randomUUID()}`);
  const wavPath = path.join(workDir, 'audio.wav');

  try {
    await fs.mkdir(workDir, { recursive: true });

    const extract = await runProcess(config.INTRO_FFMPEG_PATH, [
      '-y',
      '-v', 'error',
      '-ss', '0',
      '-t', String(windowSeconds),
      '-i', filePath,
      '-vn',
      '-ac', '1',
      '-ar', '22050',
      '-f', 'wav',
      wavPath,
    ], 10 * 60 * 1000);

    if (extract.code !== 0) {
      console.warn(
        `[IntroDetection] ffmpeg extraction failed for ${episodeId}: ` +
        (extract.stderr || `exit ${extract.code}`).slice(0, 400),
      );
      return null;
    }

    const calc = await runProcess(config.INTRO_FPCALC_PATH, [
      '-raw',
      '-json',
      // fpcalc only fingerprints the first 120s by default. Ask for the full
      // extracted window so cold-open intros beyond 2 minutes are still found.
      '-length', String(Math.max(1, Math.floor(windowSeconds))),
      wavPath,
    ], 10 * 60 * 1000);

    if (calc.code !== 0) {
      const stderr = calc.stderr.trim();
      const hint = /ENOENT|not found|is not recognized/i.test(stderr)
        ? 'fpcalc (libchromaprint-tools) is not installed on the server'
        : stderr.slice(0, 400);
      console.warn(`[IntroDetection] fpcalc failed for ${episodeId}: ${hint || `exit ${calc.code}`}`);
      return null;
    }

    let parsed: FpcalcJson;
    try {
      parsed = JSON.parse(calc.stdout) as FpcalcJson;
    } catch {
      console.warn(`[IntroDetection] fpcalc output was not JSON for ${episodeId}`);
      return null;
    }

    const raw = parsed.fingerprint;
    if (!Array.isArray(raw) || raw.length === 0) {
      console.warn(`[IntroDetection] empty fingerprint for ${episodeId}`);
      return null;
    }

    // fpcalc's reported duration is the *source file* duration, not the
    // fingerprinted window. The frame rate must be derived from the actual
    // analyzed audio (the extracted WAV) so frame<->time conversion is exact.
    // ffprobe ships with ffmpeg and is already used elsewhere in the backend.
    const probe = await runProcess('ffprobe', [
      '-v', 'error',
      '-show_entries', 'format=duration',
      '-of', 'csv=p=0',
      wavPath,
    ], 60_000);
    const probedDuration = Number.parseFloat(probe.stdout.trim());
    const durationSeconds =
      Number.isFinite(probedDuration) && probedDuration > 0
        ? probedDuration
        : Math.min(Number(parsed.duration) || windowSeconds, windowSeconds);
    const frames = Int32Array.from(raw);
    const rate = durationSeconds > 0 ? frames.length / durationSeconds : 0;
    if (rate <= 0 || !Number.isFinite(rate)) {
      console.warn(`[IntroDetection] invalid duration for ${episodeId}`);
      return null;
    }

    return { episodeId, frames, durationSeconds, rate };
  } catch (error) {
    console.warn(`[IntroDetection] fingerprinting failed for ${episodeId}: ${String(error)}`);
    return null;
  } finally {
    await fs.rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
}
