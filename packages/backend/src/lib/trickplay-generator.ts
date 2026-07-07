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

/** How often to sample a frame (seconds). */
const INTERVAL_SEC = 10;
/** Grid layout: tiles per row in the sprite sheet. */
const TILES_PER_ROW = 10;
/** Thumbnail width in pixels (height auto-scaled). */
const THUMB_WIDTH = 160;

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
  if (durationSec <= 0) return null;

  const spritePath = path.join(outputDir, 'trickplay-sprite.jpg');
  const vttPath = path.join(outputDir, 'trickplay.vtt');

  await mkdir(outputDir, { recursive: true });

  // ffmpeg: extract frames at intervals, tile into sprite sheet
  // tile=10xN: 10 columns, auto rows
  // fps=1/10: one frame every 10 seconds
  const frameCount = Math.ceil(durationSec / INTERVAL_SEC);
  const rows = Math.ceil(frameCount / TILES_PER_ROW);

  if (frameCount === 0) return null;

  const args = [
    '-skip_frame', 'nokey',  // only keyframes (faster)
    '-i', sourceFile,
    '-vf', `fps=1/${INTERVAL_SEC},scale=${THUMB_WIDTH}:-1,tile=${TILES_PER_ROW}x${rows}`,
    '-frames:v', '1',
    '-q:v', '4',
    '-y',
    spritePath,
  ];

  return new Promise((resolve) => {
    const proc = spawn('ffmpeg', args, { stdio: 'ignore' });
    let stderr = '';
    proc.stderr?.on('data', (c: Buffer) => { stderr += c.toString(); });
    proc.on('error', () => resolve(null));
    proc.on('exit', async (code) => {
      if (code !== 0) {
        console.error(`[Trickplay] ffmpeg failed: ${stderr.slice(-500)}`);
        resolve(null);
        return;
      }
      // Verify sprite was created
      const s = await stat(spritePath).catch(() => null);
      if (!s || s.size === 0) { resolve(null); return; }

      // Generate VTT metadata
      const vttLines: string[] = ['WEBVTT', ''];
      const thumbHeight = Math.round((THUMB_WIDTH * 9) / 16); // assume 16:9

      for (let i = 0; i < frameCount; i++) {
        const startTime = fmtVtt(i * INTERVAL_SEC);
        const endTime = fmtVtt(Math.min((i + 1) * INTERVAL_SEC, durationSec));
        const col = i % TILES_PER_ROW;
        const row = Math.floor(i / TILES_PER_ROW);
        const x = col * THUMB_WIDTH;
        const y = row * thumbHeight;

        vttLines.push(`${startTime} --> ${endTime}`);
        vttLines.push(`trickplay-sprite.jpg#xywh=${x},${y},${THUMB_WIDTH},${thumbHeight}`);
        vttLines.push('');
      }

      await writeFile(vttPath, vttLines.join('\n'));
      resolve(spritePath);
    });
  });
}

function fmtVtt(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${s.toFixed(3).padStart(6, '0')}`;
}
