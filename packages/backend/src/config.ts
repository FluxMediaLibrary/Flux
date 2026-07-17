/**
 * Environment configuration — loaded and validated at startup with zod.
 * Fail fast: if a required env var is missing/invalid, the process exits.
 */
import { z } from 'zod';

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

  MEDIA_ROOT: z.string().min(1).default('/data/media'),
  DOWNLOAD_ROOT: z.string().min(1).default('/data/downloads'),
  TRANSCODE_ROOT: z.string().min(1).default('/data/transcode'),

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
