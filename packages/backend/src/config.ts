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
  // Playback tokens are restricted to one profile and one title. Keep them long
  // enough for films, live seeking, and TV marathons without exposing the
  // reusable account session in media URLs.
  STREAM_TOKEN_TTL_SECONDS: z.coerce.number().int().min(300).max(86_400).default(43_200),
  MAX_CONCURRENT_TRANSCODES: z.coerce.number().int().min(1).max(32).default(4),
  MAX_CONCURRENT_THUMBNAILS: z.coerce.number().int().min(1).max(32).default(4),
  MAX_CONCURRENT_TRICKPLAY: z.coerce.number().int().min(1).max(16).default(2),

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
  // Existing installations may have a legacy short password. Accept it so an
  // upgrade cannot take the media server offline; setup enforces strong values
  // for new installs and startup emits a warning until the legacy value rotates.
  TRANSMISSION_PASS: z.string()
    .min(1, 'TRANSMISSION_PASS is required')
    .default('development-only-password'),

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
