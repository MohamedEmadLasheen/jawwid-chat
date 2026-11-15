import { Prisma } from '@prisma/client';
import { CommError, CommErrorCode } from './errors';

/**
 * RT-014: a transaction Postgres cancelled to break a deadlock (SQLSTATE
 * 40P01) or a serialization conflict (40001).
 *
 * Postgres rolls the cancelled transaction back whole, so nothing it wrote is
 * kept, and running the same work again from the start is safe. Prisma reports
 * these in three shapes, all recognised here:
 *   - a raw query (`$queryRaw`) that failed: P2010 with the SQLSTATE in `meta.code`;
 *   - a model query in a transaction: P2034 ("write conflict or a deadlock");
 *   - an unknown request error carrying the Postgres text.
 *
 * A CommError is never a conflict: it is a decision, and it is final.
 */
export function transactionConflictCode(e: unknown): '40P01' | '40001' | null {
  if (e instanceof CommError || !(e instanceof Error)) return null;
  if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2034') {
    return /\b40001\b|could not serialize/i.test(e.message) ? '40001' : '40P01';
  }
  const sqlstate = (e as { meta?: { code?: unknown } }).meta?.code;
  if (sqlstate === '40P01') return '40P01';
  if (sqlstate === '40001') return '40001';
  if (/\b40P01\b|deadlock detected/i.test(e.message)) return '40P01';
  if (/\b40001\b|could not serialize access/i.test(e.message)) return '40001';
  return null;
}

export interface ConflictRetryOptions {
  /** Further attempts after the first. Default 1: one retry, never a loop. */
  retries?: number;
  /** Milliseconds to wait before a retry. Default 20-80 ms, jittered so two victims do not collide again. */
  delayMs?: () => number;
  /** The wait itself (a test passes an instant one). */
  sleep?: (ms: number) => Promise<void>;
}

const jitteredDelay = () => 20 + Math.floor(Math.random() * 61);
const realSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** What a caller is told when the retry was cancelled too: nothing was saved, try again. 503. */
export function transactionConflictExhausted(): CommError {
  return new CommError(
    CommErrorCode.DATABASE_UNAVAILABLE,
    'the server is busy and nothing was saved; try again in a moment',
    503,
  );
}

/**
 * Runs `work`; when Postgres cancelled its transaction as a deadlock or a
 * serialization conflict, runs ALL of it again (re-reading everything it
 * decided on), at most `retries` times. A further conflict becomes a
 * retryable 503 (DATABASE_UNAVAILABLE), never a 500. Every other error,
 * including every CommError, is thrown unchanged and never retried.
 *
 * Only for work that is safe to repeat: the conflict must come from a
 * transaction that was rolled back, and nothing outside it may have taken
 * effect before the failure.
 */
export async function retryOnTransactionConflict<T>(
  work: () => Promise<T>,
  options: ConflictRetryOptions = {},
): Promise<T> {
  const retries = options.retries ?? 1;
  const delayMs = options.delayMs ?? jitteredDelay;
  const sleep = options.sleep ?? realSleep;
  for (let attempt = 0; ; attempt++) {
    try {
      return await work();
    } catch (e) {
      if (transactionConflictCode(e) === null) throw e;
      if (attempt >= retries) throw transactionConflictExhausted();
      await sleep(delayMs());
    }
  }
}
