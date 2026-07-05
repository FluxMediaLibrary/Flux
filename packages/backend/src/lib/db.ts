/**
 * Prisma client singleton. Reused across the process (and across hot reloads
 * in dev) to avoid exhausting the database connection pool.
 */
import { PrismaClient } from '@prisma/client';
import { isProduction } from '../config.js';

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: isProduction ? ['warn', 'error'] : ['query', 'warn', 'error'],
  });

if (!isProduction) {
  globalForPrisma.prisma = prisma;
}
