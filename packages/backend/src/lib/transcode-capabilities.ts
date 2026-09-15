/**
 * Hardware-acceleration discovery.
 *
 * Flux never enables an encoder it has not seen: `ffmpeg -encoders` is parsed
 * once (refreshable from the admin UI) and the presence of the matching
 * device node is checked so a build that *contains* h264_vaapi but has no
 * `/dev/dri/renderD128` mounted into the container is reported as unusable
 * with the reason, instead of failing at playback time.
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import { config } from '../config.js';
import type { HardwareAccelerationDTO, HardwareEncoderDTO } from '@flux/shared';

export type HardwareAcceleration = 'NONE' | 'AUTO' | 'VAAPI' | 'QSV' | 'NVENC' | 'VIDEOTOOLBOX';
type ConcreteAcceleration = Exclude<HardwareAcceleration, 'AUTO'>;

const ENCODERS: { id: Exclude<ConcreteAcceleration, 'NONE'>; encoder: string; devices: string[]; label: string }[] = [
  { id: 'NVENC', encoder: 'h264_nvenc', devices: ['/dev/nvidiactl', '/dev/nvidia0'], label: 'NVIDIA NVENC' },
  { id: 'QSV', encoder: 'h264_qsv', devices: ['/dev/dri/renderD128'], label: 'Intel Quick Sync' },
  { id: 'VAAPI', encoder: 'h264_vaapi', devices: ['/dev/dri/renderD128'], label: 'VA-API (Intel/AMD)' },
  { id: 'VIDEOTOOLBOX', encoder: 'h264_videotoolbox', devices: [], label: 'Apple VideoToolbox' },
];

/** Preference order for AUTO: dedicated GPU first, then integrated, then Apple. */
const AUTO_ORDER: Exclude<ConcreteAcceleration, 'NONE'>[] = ['NVENC', 'QSV', 'VAAPI', 'VIDEOTOOLBOX'];

interface Capabilities {
  ffmpegVersion: string | null;
  ffmpegAvailable: boolean;
  encoders: HardwareEncoderDTO[];
  detectedAt: string;
}

let cached: Capabilities | null = null;
let inflight: Promise<Capabilities> | null = null;

function run(bin: string, args: string[]): Promise<{ ok: boolean; stdout: string }> {
  return new Promise((resolve) => {
    let stdout = '';
    let settled = false;
    const finish = (ok: boolean) => {
      if (settled) return;
      settled = true;
      resolve({ ok, stdout });
    };
    try {
      const proc = spawn(bin, args, { stdio: ['ignore', 'pipe', 'ignore'] });
      proc.stdout.on('data', (chunk: Buffer) => { stdout += chunk.toString(); });
      proc.on('error', () => finish(false));
      proc.on('close', (code) => finish(code === 0));
      setTimeout(() => { proc.kill('SIGKILL'); finish(false); }, 10_000).unref();
    } catch {
      finish(false);
    }
  });
}

async function detect(): Promise<Capabilities> {
  const ffmpeg = config.INTRO_FFMPEG_PATH || 'ffmpeg';
  const [version, encoders] = await Promise.all([
    run(ffmpeg, ['-hide_banner', '-version']),
    run(ffmpeg, ['-hide_banner', '-encoders']),
  ]);
  const ffmpegVersion = version.ok ? (version.stdout.match(/ffmpeg version (\S+)/)?.[1] ?? null) : null;
  const available = new Set<string>();
  if (encoders.ok) {
    for (const line of encoders.stdout.split('\n')) {
      // " V....D h264_nvenc           NVIDIA NVENC H.264 encoder (codec h264)"
      const match = line.match(/^\s*[A-Z.]{6}\s+(\S+)\s/);
      if (match?.[1]) available.add(match[1]);
    }
  }

  const detected: HardwareEncoderDTO[] = ENCODERS.map((entry) => {
    const built = available.has(entry.encoder);
    const platformOk = entry.id !== 'VIDEOTOOLBOX' || process.platform === 'darwin';
    const missingDevice = entry.devices.length > 0 && !entry.devices.some((device) => fs.existsSync(device));
    let reason: string | null = null;
    if (!encoders.ok) reason = 'FFmpeg could not be executed';
    else if (!built) reason = `FFmpeg build has no ${entry.encoder} encoder`;
    else if (!platformOk) reason = 'Only available on macOS';
    else if (missingDevice) reason = `Device not visible to Flux (${entry.devices.join(' or ')}). Pass it through to the container.`;
    return {
      id: entry.id,
      label: entry.label,
      encoder: entry.encoder,
      encoderPresent: built,
      devicePresent: entry.devices.length === 0 ? true : !missingDevice,
      usable: reason === null,
      reason,
    };
  });

  return { ffmpegVersion, ffmpegAvailable: version.ok, encoders: detected, detectedAt: new Date().toISOString() };
}

export async function getTranscodeCapabilities(options: { refresh?: boolean } = {}): Promise<Capabilities> {
  if (cached && !options.refresh) return cached;
  if (!inflight) {
    inflight = detect().then((result) => { cached = result; return result; }).finally(() => { inflight = null; });
  }
  return inflight;
}

export interface ResolvedAcceleration {
  requested: HardwareAcceleration;
  effective: ConcreteAcceleration;
  /** Set when the effective value differs from the request. */
  fallbackReason: string | null;
}

/**
 * Turn the configured preference into an encoder Flux has actually verified.
 * AUTO picks the best usable option; an explicit choice that is not usable
 * falls back to software with the reason recorded (never silently).
 */
export async function resolveHardwareAcceleration(requested: HardwareAcceleration): Promise<ResolvedAcceleration> {
  if (requested === 'NONE') return { requested, effective: 'NONE', fallbackReason: null };
  const caps = await getTranscodeCapabilities();
  const usable = new Map(caps.encoders.map((encoder) => [encoder.id, encoder] as const));
  if (requested === 'AUTO') {
    const pick = AUTO_ORDER.find((id) => usable.get(id)?.usable);
    return { requested, effective: pick ?? 'NONE', fallbackReason: pick ? null : 'No usable hardware encoder detected; using software x264' };
  }
  const entry = usable.get(requested);
  if (entry?.usable) return { requested, effective: requested, fallbackReason: null };
  return { requested, effective: 'NONE', fallbackReason: `${entry?.label ?? requested} is not usable: ${entry?.reason ?? 'unknown'}. Using software x264.` };
}

export async function describeHardwareAcceleration(requested: HardwareAcceleration): Promise<HardwareAccelerationDTO> {
  const [caps, resolved] = await Promise.all([getTranscodeCapabilities(), resolveHardwareAcceleration(requested)]);
  return {
    ffmpegAvailable: caps.ffmpegAvailable,
    ffmpegVersion: caps.ffmpegVersion,
    detectedAt: caps.detectedAt,
    requested,
    effective: resolved.effective,
    fallbackReason: resolved.fallbackReason,
    encoders: caps.encoders,
  };
}
