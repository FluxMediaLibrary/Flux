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
  ROKU_SUPPORTED: envBoolean(true),
  ROKU_MIN_VERSION: z.string().regex(/^\d+\.\d+\.\d+$/).default('1.0.0'),
  ROKU_LATEST_VERSION: z.string().regex(/^\d+\.\d+\.\d+$/).default('1.0.0'),
  ROKU_FEATURE_REQUESTS: envBoolean(true),
  ROKU_FEATURE_SKIP_INTRO: envBoolean(true),
  ROKU_FEATURE_SUBTITLES: envBoolean(true),
  ROKU_FEATURE_AUDIO_TRACKS: envBoolean(true),
  ROKU_ROW_ORDER: z.string().default('continue-watching,recently-added,new-releases,top-rated,recommended,random-picks'),
  ROKU_HERO_ROTATION_SECONDS: z.coerce.number().int().min(0).max(30).default(8),
  ROKU_ANNOUNCEMENT: z.preprocess((value) => value === '' ? undefined : value, z.string().trim().max(240).optional()),
  ROKU_UPDATE_MESSAGE: z.string().trim().max(240).default('Roku installs Flux updates automatically through its managed channel system.'),
  ROKU_RELEASE_NOTES: z.string().default(''),
  ROKU_LOG_LEVEL: z.enum(['error', 'warn', 'info', 'debug']).default('info'),
  DEVICE_CODE_TTL_SECONDS: z.coerce.number().int().min(120).max(1800).default(600),
  DEVICE_POLL_INTERVAL_SECONDS: z.coerce.number().int().min(3).max(30).default(5),
  DEVICE_SESSION_TTL_DAYS: z.coerce.number().int().min(1).max(365).default(90),
  ROKU_PLAYBACK_SESSION_TTL_SECONDS: z.coerce.number().int().min(300).max(86400).default(14400),

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

  /** When picking a media root for new files, skip roots with less than this
   * many free bytes. Default 10 GB. */
  MEDIA_SPILLOVER_THRESHOLD_BYTES: z.coerce.number().int().min(0).default(10_737_418_240),

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
