/**
 * Live registry of HLS transcode sessions for diagnostics.
 *
 * The streaming routes own the FFmpeg processes; this module only mirrors
 * enough state to answer "what is transcoding right now, why, with which
 * encoder and how fast" for the admin Playback page, and to let an admin stop
 * a session. Progress comes from FFmpeg's `-progress pipe:1` key/value stream.
 */
import type { TranscodeSessionDTO } from '@flux/shared';

export interface TranscodeSessionInfo {
  key: string;
  mediaItemId: string;
  episodeId: string | null;
  profileId: string | null;
  accountId: string | null;
  /** 'remux' = stream copy, 'transcode' = re-encode single tier, 'adaptive' = ladder, 'cast' = receiver-optimised. */
  mode: TranscodeSessionDTO['mode'];
  reason: string;
  sourceVideoCodec: string | null;
  sourceAudioCodec: string | null;
  sourceWidth: number | null;
  sourceHeight: number | null;
  targetVideoCodec: string;
  targetAudioCodec: string;
  hardwareAcceleration: string;
  encoder: string;
  startTimeSeconds: number;
  startedAt: number;
  lastAccessAt: number;
  speed: number | null;
  outTimeSeconds: number | null;
  bitrateKbps: number | null;
  exited: boolean;
  failure: string | null;
  stop: () => void;
}

const sessions = new Map<string, TranscodeSessionInfo>();

export function registerTranscodeSession(info: TranscodeSessionInfo): void {
  sessions.set(info.key, info);
}

export function touchTranscodeSession(key: string): void {
  const session = sessions.get(key);
  if (session) session.lastAccessAt = Date.now();
}

export function unregisterTranscodeSession(key: string): void {
  sessions.delete(key);
}

export function getTranscodeSession(key: string): TranscodeSessionInfo | undefined {
  return sessions.get(key);
}

/** Feed one `-progress` line ("speed=1.23x", "out_time_us=...", "bitrate=...kbits/s"). */
export function applyProgressLine(key: string, line: string): void {
  const session = sessions.get(key);
  if (!session) return;
  const eq = line.indexOf('=');
  if (eq < 0) return;
  const field = line.slice(0, eq).trim();
  const value = line.slice(eq + 1).trim();
  switch (field) {
    case 'speed': {
      const parsed = Number.parseFloat(value.replace(/x$/, ''));
      session.speed = Number.isFinite(parsed) ? parsed : null;
      break;
    }
    case 'out_time_us': {
      const parsed = Number.parseInt(value, 10);
      if (Number.isFinite(parsed) && parsed >= 0) session.outTimeSeconds = parsed / 1_000_000;
      break;
    }
    case 'out_time_ms': {
      // Older FFmpeg builds report microseconds under this misleading name.
      const parsed = Number.parseInt(value, 10);
      if (Number.isFinite(parsed) && parsed >= 0 && session.outTimeSeconds === null) session.outTimeSeconds = parsed / 1_000_000;
      break;
    }
    case 'bitrate': {
      const parsed = Number.parseFloat(value.replace(/kbits\/s$/, ''));
      session.bitrateKbps = Number.isFinite(parsed) ? parsed : null;
      break;
    }
    default:
      break;
  }
}

export function markTranscodeExited(key: string, failure: string | null): void {
  const session = sessions.get(key);
  if (!session) return;
  session.exited = true;
  if (failure) session.failure = failure;
}

export function listTranscodeSessions(): TranscodeSessionDTO[] {
  const now = Date.now();
  return [...sessions.values()]
    .sort((a, b) => b.lastAccessAt - a.lastAccessAt)
    .map((session) => ({
      id: session.key,
      mediaItemId: session.mediaItemId,
      episodeId: session.episodeId,
      profileId: session.profileId,
      mode: session.mode,
      reason: session.reason,
      source: {
        videoCodec: session.sourceVideoCodec,
        audioCodec: session.sourceAudioCodec,
        width: session.sourceWidth,
        height: session.sourceHeight,
      },
      target: {
        videoCodec: session.targetVideoCodec,
        audioCodec: session.targetAudioCodec,
        hardwareAcceleration: session.hardwareAcceleration,
        encoder: session.encoder,
      },
      startTimeSeconds: session.startTimeSeconds,
      startedAt: new Date(session.startedAt).toISOString(),
      lastAccessAt: new Date(session.lastAccessAt).toISOString(),
      idleSeconds: Math.max(0, Math.round((now - session.lastAccessAt) / 1000)),
      speed: session.speed,
      outTimeSeconds: session.outTimeSeconds,
      bitrateKbps: session.bitrateKbps,
      state: session.failure ? 'FAILED' : session.exited ? 'FINISHED' : 'ENCODING',
      failure: session.failure,
    }));
}

/** Stop and forget a session by id. Returns false when it no longer exists. */
export function stopTranscodeSession(key: string): boolean {
  const session = sessions.get(key);
  if (!session) return false;
  session.stop();
  return true;
}
