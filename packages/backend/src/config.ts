/**
 * Environment configuration — loaded and validated at startup with zod.
 * Fail fast: if a required env var is missing/invalid, the process exits.
 */
import { z } from 'zod';

const envBoolean = (fallback: boolean) => z.preprocess((value) => {
  if (value === undefined || value === '') return fallback;
  if (typeof value === 'string') {
    if (value.toLowerCase() === 'true' || value === '1') return true;
    if (value.toLowerCase() === 'false' || value === '0') return false;
  }
  return value;
}, z.boolean());

const envSchema = z.object({
  NODE_ENV: z
    .enum(['development', 'production', 'test'])
    .default('development'),

  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  REDIS_URL: z.string().min(1, 'REDIS_URL is required'),

  JWT_SECRET: z
    .string()
    .min(16, 'JWT_SECRET must be at least 16 characters'),
  JWT_EXPIRES_IN: z.string().min(1).default('7d'),

  TMDB_API_KEY: z.string().min(1, 'TMDB_API_KEY is required'),

  BACKEND_PORT: z.coerce.number().int().positive().default(4000),
  FRONTEND_ORIGIN: z.string().url().default('http://localhost:3000'),
  /**
   * Absolute backend origin reachable by Cast receivers / smart TVs.
   * Leave unset to infer from the incoming request, but production casting
   * should set this to the HTTPS API URL instead of localhost.
   */
  PUBLIC_API_BASE_URL: z.preprocess(
    (value) => value === '' ? undefined : value,
    z.string().url().optional(),
  ),
  CAST_SESSION_TTL_SECONDS: z.coerce.number().int().min(60).max(86400).default(7200),
  ANDROID_RELEASE_ROOT: z.string().min(1).default('/data/releases/android'),
  FLUX_SERVER_ID: z.string().uuid().optional(),
  FLUX_SERVER_NAME: z.string().trim().min(1).max(80).default('Flux'),
  FLUX_SERVER_VERSION: z.string().regex(/^\d+\.\d+\.\d+$/).default('0.1.0'),

  /**
   * Comma-separated media root directories. Files placed during post-processing
   * go to the first root; playback and admin lookups search all roots.
   *
   * Defaults to MEDIA_ROOT env var (single path) for backward compatibility.
   */
  MEDIA_ROOTS: z.preprocess((value) => {
    if (typeof value === 'string' && value.trim()) {
      return value.split(',').map((s) => s.trim()).filter(Boolean);
    }
    if (typeof process.env.MEDIA_ROOT === 'string' && process.env.MEDIA_ROOT.trim()) {
      return [process.env.MEDIA_ROOT.trim()];
    }
    return ['/data/media'];
  }, z.array(z.string().min(1)).min(1)),
  DOWNLOAD_ROOT: z.string().min(1).default('/data/downloads'),
  TRANSCODE_ROOT: z.string().min(1).default('/data/transcode'),

  /** Fallback library reserve before database-backed settings are available.
   * The Settings storage policy takes ownership after migrations run. */
  MEDIA_SPILLOVER_THRESHOLD_BYTES: z.coerce.number().int().min(0).default(21_474_836_480),

  /** How often the background poller sweeps for finished torrents (ms). */
  TORRENT_POLL_INTERVAL_MS: z.coerce
    .number()
    .int()
    .min(1000)
    .default(15000),
  TRANSMISSION_RPC_URL: z
    .string()
    .url()
    .default('http://localhost:9091/transmission/rpc'),
  TRANSMISSION_USER: z.string().min(1).default('admin'),
  TRANSMISSION_PASS: z.string().min(1).default('flux'),

  /**
   * Automatic intro detection (FFmpeg audio extraction + Chromaprint fpcalc).
   * Runs as a background job when episodes are imported or an admin rescans a
   * season. Detected segments are stored as AUTOMATIC rows in media_segments
   * and never overwrite MANUAL markers unless a forced rescan is requested.
   */
  INTRO_DETECTION_ENABLED: envBoolean(true),
  /** Audio window (minutes) fingerprinted per episode. Default 15. */
  INTRO_DETECTION_WINDOW_MINUTES: z.coerce.number().int().min(1).max(60).default(15),
  /** Minimum accepted intro duration in seconds. Default 40. */
  INTRO_MIN_SECONDS: z.coerce.number().min(10).max(600).default(40),
  /** Minimum frame-match ratio (0..1) to accept a repeated segment. Default 0.65. */
  INTRO_MIN_CONFIDENCE: z.coerce.number().min(0).max(1).default(0.65),
  /** Minimum fraction of season episodes that must contain the segment. Default 0.6. */
  INTRO_MIN_COVERAGE: z.coerce.number().min(0.2).max(1).default(0.6),
  INTRO_FFMPEG_PATH: z.string().min(1).default('ffmpeg'),
  INTRO_FPCALC_PATH: z.string().min(1).default('fpcalc'),

  BOOTSTRAP_ADMIN_EMAIL: z.string().email().optional(),
  BOOTSTRAP_ADMIN_PASSWORD: z.string().min(8).optional(),
});

export type AppConfig = z.infer<typeof envSchema>;

function loadConfig(): AppConfig {
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('\n');
    // eslint-disable-next-line no-console
    console.error(`\nInvalid environment configuration:\n${issues}\n`);
    process.exit(1);
  }
  return parsed.data;
}

export const config = loadConfig();

export const isProduction = config.NODE_ENV === 'production';
