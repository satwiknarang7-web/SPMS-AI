import { PrismaClient, type Prisma } from '@prisma/client';

export const prisma = new PrismaClient({
  log: process.env.PRISMA_LOG === '1' ? ['query', 'warn', 'error'] : ['warn', 'error'],
});

let queue: Promise<unknown> = Promise.resolve();

/**
 * Run an interactive transaction. Writes are serialised in-process: SQLite allows a single
 * writer, and serialising also keeps the audit hash chain linear. When moving to PostgreSQL
 * with multiple API instances, replace this with a per-tenant advisory lock in `audit`.
 */
export function tx<T>(fn: (db: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  const run = queue.then(() => prisma.$transaction(fn, { timeout: 20_000, maxWait: 10_000 }));
  queue = run.catch(() => undefined);
  return run;
}

/** Either the root client or an interactive transaction client. */
export type Db = PrismaClient | Prisma.TransactionClient;

export const json = {
  parse<T>(value: string | null | undefined, fallback: T): T {
    if (value == null || value === '') return fallback;
    try {
      return JSON.parse(value) as T;
    } catch {
      return fallback;
    }
  },
  stringify: (value: unknown) => JSON.stringify(value ?? null),
};
