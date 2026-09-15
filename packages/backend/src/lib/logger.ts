/**
 * Application logger.
 *
 * One pino root shared with Fastify so request logs and background work
 * (imports, transcodes, scans, notifications) come out in the same format
 * with the same level, each tagged with a `category` an operator can filter
 * on. `getLogger('transcode')` returns a child with console-like helpers so
 * call sites can pass an error object as the second argument and have it
 * serialised (stack included) instead of stringified.
 *
 * Never log tokens, passwords or full stream URLs: `redactUrl` strips query
 * strings that carry credentials.
 */
import pino, { type Logger } from 'pino';

// Reads the environment directly (not config.ts) so pure helpers that only
// want a logger can be imported by unit tests without the full env contract.
const isProduction = process.env.NODE_ENV === 'production';

export const rootLogger: Logger = pino(
  isProduction
    ? { level: process.env.LOG_LEVEL ?? 'info' }
    : {
        level: process.env.LOG_LEVEL ?? 'debug',
        transport: { target: 'pino-pretty', options: { colorize: true } },
      },
);

export type LogCategory =
  | 'library'
  | 'metadata'
  | 'playback'
  | 'transcode'
  | 'downloads'
  | 'torrents'
  | 'requests'
  | 'casting'
  | 'storage'
  | 'auth'
  | 'database'
  | 'notifications'
  | 'jobs'
  | 'devices';

export interface CategoryLogger {
  debug(message: string, detail?: unknown): void;
  info(message: string, detail?: unknown): void;
  warn(message: string, detail?: unknown): void;
  error(message: string, error?: unknown): void;
  /** The underlying pino child, for structured `log.info({ ... }, msg)` calls. */
  raw: Logger;
}

function bindings(detail: unknown): Record<string, unknown> {
  if (detail === undefined) return {};
  if (detail instanceof Error) return { err: detail };
  if (detail && typeof detail === 'object') return detail as Record<string, unknown>;
  return { detail };
}

const cache = new Map<string, CategoryLogger>();

export function getLogger(category: LogCategory): CategoryLogger {
  const cached = cache.get(category);
  if (cached) return cached;
  const child = rootLogger.child({ category });
  const logger: CategoryLogger = {
    debug: (message, detail) => child.debug(bindings(detail), message),
    info: (message, detail) => child.info(bindings(detail), message),
    warn: (message, detail) => child.warn(bindings(detail), message),
    error: (message, error) => child.error(error === undefined ? {} : error instanceof Error ? { err: error } : { err: String(error) }, message),
    raw: child,
  };
  cache.set(category, logger);
  return logger;
}

/** Drop query strings (they carry stream tokens) before a URL reaches a log line. */
export function redactUrl(value: string): string {
  const index = value.indexOf('?');
  return index >= 0 ? `${value.slice(0, index)}?[redacted]` : value;
}
