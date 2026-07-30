/**
 * Trickplay thumbnail generator — produces sprite sheets and VTT metadata
 * for smooth seek-bar thumbnail previews.
 *
 * Pattern follows Jellyfin's trickplay plugin: extract frames at fixed
 * intervals, tile them into a sprite sheet, and generate a WebVTT file
 * mapping time ranges → sprite sheet coordinates.
 */
import { spawn } from 'node:child_process';
import path from 'node:path';
import { mkdir, writeFile, stat } from 'node:fs/promises';
import { config } from '../config.js';

/** How often to sample a frame (seconds). */
const INTERVAL_SEC = 10;
/** Grid layout: tiles per row in the sprite sheet. */
const TILES_PER_ROW = 10;
/** Fixed thumbnail dimensions used by both the sprite and VTT coordinates. */
const THUMB_WIDTH = 160;
const THUMB_HEIGHT = 90;
/** Avoid enormous single JPEGs for unusually long recordings. */
const MAX_FRAMES = 1200;
const TRICKPLAY_TIMEOUT_MS = 10 * 60 * 1000;

const trickplayJobs = new Map<string, Promise<boolean>>();
let activeTrickplayJobs = 0;

export const TRICKPLAY_FILES = new Set(['trickplay.vtt', 'trickplay-sprite.jpg']);

/** Keep each media file's assets isolated from other episodes in its folder. */
export function trickplayOutputDir(sourceFile: string): string {
  return path.join(path.dirname(sourceFile), '.flux-trickplay', path.basename(sourceFile));
}

export function trickplayAssetPath(sourceFile: string, file: string): string | null {
  if (!TRICKPLAY_FILES.has(file)) return null;
  return path.join(trickplayOutputDir(sourceFile), file);
}

/** Generate missing assets once per source file, coalescing concurrent requests. */
export function ensureTrickplay(sourceFile: string, durationSec: number): Promise<boolean> {
  const outputDir = trickplayOutputDir(sourceFile);
  const spritePath = path.join(outputDir, 'trickplay-sprite.jpg');
  const vttPath = path.join(outputDir, 'trickplay.vtt');
  const existing = trickplayJobs.get(sourceFile);
  if (existing) return existing;
  if (activeTrickplayJobs >= config.MAX_CONCURRENT_TRICKPLAY) {
    return Promise.resolve(false);
  }
  activeTrickplayJobs += 1;

  const job = Promise.all([
    stat(spritePath).catch(() => null),
    stat(vttPath).catch(() => null),
  ])
    .then(([sprite, vtt]) => {
      if (sprite?.size && vtt?.size) return true;
      return generateTrickplay(sourceFile, outputDir, durationSec).then(Boolean);
    })
    .catch(() => false)
    .finally(() => {
      trickplayJobs.delete(sourceFile);
      activeTrickplayJobs = Math.max(0, activeTrickplayJobs - 1);
    });

  trickplayJobs.set(sourceFile, job);
  return job;
}

/**
 * Generate trickplay sprite sheet + VTT for a media file.
 *
 * Output:
 *   outputDir/trickplay-sprite.jpg  — sprite sheet
 *   outputDir/trickplay.vtt         — WebVTT mapping
 */
export async function generateTrickplay(
  sourceFile: string,
  outputDir: string,
  durationSec: number,
): Promise<string | null> {
  if (!Number.isFinite(durationSec) || durationSec <= 0) return null;

  const spritePath = path.join(outputDir, 'trickplay-sprite.jpg');
  const vttPath = path.join(outputDir, 'trickplay.vtt');

  await mkdir(outputDir, { recursive: true });

  // ffmpeg: extract frames at intervals, tile into sprite sheet
  // tile=10xN: 10 columns, auto rows
  // fps=1/10: one frame every 10 seconds
  const sampleIntervalSec = Math.max(INTERVAL_SEC, Math.ceil(durationSec / MAX_FRAMES));
  const frameCount = Math.min(MAX_FRAMES, Math.ceil(durationSec / sampleIntervalSec));
  const rows = Math.ceil(frameCount / TILES_PER_ROW);

  if (frameCount === 0) return null;

  const args = [
    '-skip_frame', 'nokey',  // only keyframes (faster)
    '-i', sourceFile,
    '-vf', `fps=1/${sampleIntervalSec},scale=${THUMB_WIDTH}:${THUMB_HEIGHT}:force_original_aspect_ratio=decrease,pad=${THUMB_WIDTH}:${THUMB_HEIGHT}:(ow-iw)/2:(oh-ih)/2,tile=${TILES_PER_ROW}x${rows}`,
    '-frames:v', '1',
    '-q:v', '4',
    '-y',
    spritePath,
  ];

  return new Promise((resolve) => {
    const proc = spawn('ffmpeg', args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let settled = false;
    const finish = (result: string | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      resolve(result);
    };
    const timeout = setTimeout(() => {
      proc.kill('SIGKILL');
      finish(null);
    }, TRICKPLAY_TIMEOUT_MS);
    let stderr = '';
    proc.stderr?.on('data', (c: Buffer) => { stderr += c.toString(); });
    proc.on('error', () => finish(null));
    proc.on('exit', async (code) => {
      if (code !== 0) {
        console.error(`[Trickplay] ffmpeg failed: ${stderr.slice(-500)}`);
        finish(null);
        return;
      }
      // Verify sprite was created
      const s = await stat(spritePath).catch(() => null);
      if (!s || s.size === 0) { finish(null); return; }

      // Generate VTT metadata
      const vttLines: string[] = ['WEBVTT', ''];
      for (let i = 0; i < frameCount; i++) {
        const startTime = fmtVtt(i * sampleIntervalSec);
        const endTime = fmtVtt(Math.min((i + 1) * sampleIntervalSec, durationSec));
        const col = i % TILES_PER_ROW;
        const row = Math.floor(i / TILES_PER_ROW);
        const x = col * THUMB_WIDTH;
        const y = row * THUMB_HEIGHT;

        vttLines.push(`${startTime} --> ${endTime}`);
        vttLines.push(`trickplay-sprite.jpg#xywh=${x},${y},${THUMB_WIDTH},${THUMB_HEIGHT}`);
        vttLines.push('');
      }

      await writeFile(vttPath, vttLines.join('\n'));
      finish(spritePath);
    });
  });
}

function fmtVtt(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${s.toFixed(3).padStart(6, '0')}`;
}
