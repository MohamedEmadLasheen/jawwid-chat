import { PrismaService } from '@platform/prisma.service';

/** A query no code under test sends: its log event marks a point in the stream. */
const MARK = 'statement-counter-mark';

/**
 * How many SQL statements a block of code sends -- the PD-44 N+1 guards.
 *
 * Prisma delivers `$on('query')` events asynchronously, after the query has
 * returned. A count that only resets a number before the block and reads it
 * after can therefore take in the last statement of whatever ran just before
 * (dashboard-teachers-pd044, 2026-10-31: the teacher-photo read at the end of
 * the credential upload fixture, on a slow first run against a cold database,
 * landed inside the next count) and miss the block's own last ones. So each
 * edge waits for a marker query's event: every event sent before it has been
 * delivered (they arrive in order), and the count covers the block exactly.
 */
export function statementCounter() {
  const prisma = new PrismaService({ log: [{ emit: 'event', level: 'query' }] });
  let statements = 0;
  let marked: (() => void) | null = null;
  (prisma as unknown as { $on(event: 'query', cb: (e: { query: string }) => void): void }).$on('query', (e) => {
    if (e.query.includes(MARK)) {
      marked?.();
      marked = null;
      return;
    }
    statements += 1;
  });

  /** Returns once every query sent so far has been reported. */
  async function settle(): Promise<void> {
    const seen = new Promise<void>((resolve) => {
      marked = resolve;
    });
    await prisma.$queryRawUnsafe(`SELECT '${MARK}' AS mark`);
    await seen;
  }

  /** How many statements `run` sends to the database. */
  async function counted<T>(run: () => Promise<T>): Promise<{ result: T; n: number }> {
    await settle();
    statements = 0;
    const result = await run();
    await settle();
    return { result, n: statements };
  }

  return { prisma, counted };
}
