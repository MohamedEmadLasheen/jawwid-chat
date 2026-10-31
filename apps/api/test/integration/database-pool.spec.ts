/**
 * DATABASE_POOL_MAX is the pool, against a real Postgres.
 *
 * N interactive transactions must all be open at the same moment (a barrier
 * inside each). N is one more than Prisma's own default pool on this machine
 * (CPUs x 2 + 1), so the test passes only if the configured size reached the
 * client: with the default pool the (default + 1)th transaction cannot get a
 * connection, fails its maxWait, and the barrier is never reached.
 */
import { cpus } from 'node:os';
import { PrismaService } from '../../src/platform/prisma.service';
import { MATERIALIZE_STATEMENT_TIMEOUT_MS, SchedulingService } from '../../src/lessons/scheduling.service';

const PRISMA_DEFAULT_POOL = cpus().length * 2 + 1;
const N = PRISMA_DEFAULT_POOL + 1;

let prisma: PrismaService;
const saved = process.env.DATABASE_POOL_MAX;

beforeAll(async () => {
  process.env.DATABASE_POOL_MAX = String(N);
  prisma = new PrismaService();
  await prisma.$connect();
});
afterAll(async () => {
  await prisma?.$disconnect();
  if (saved === undefined) delete process.env.DATABASE_POOL_MAX;
  else process.env.DATABASE_POOL_MAX = saved;
});

it(`${N} transactions open at once all get a connection (pool = DATABASE_POOL_MAX, not ${PRISMA_DEFAULT_POOL})`, async () => {
  let arrived = 0;
  let release!: () => void;
  const allIn = new Promise<void>((r) => (release = r));
  const barrier = () =>
    Promise.race([
      allIn,
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error(`only ${arrived} of ${N} transactions got a connection`)), 8_000)),
    ]);

  const results = await Promise.allSettled(
    Array.from({ length: N }, () =>
      prisma.$transaction(
        async (tx) => {
          await tx.$queryRaw`select 1`;
          if (++arrived === N) release();
          await barrier();
          return (await tx.$queryRaw<Array<{ pid: number }>>`select pg_backend_pid() as pid`)[0]!.pid;
        },
        { maxWait: 3_000, timeout: 15_000 },
      ),
    ),
  );

  const failed = results.filter((r) => r.status === 'rejected').map((r) => String((r as PromiseRejectedResult).reason));
  expect(failed).toEqual([]);
  const pids = new Set(results.map((r) => (r as PromiseFulfilledResult<number>).value));
  expect(pids.size).toBe(N); // N distinct backends, all at once
}, 30_000);

/**
 * DATABASE_STATEMENT_TIMEOUT_MS reaches every API/worker session (URL options),
 * cuts a runaway statement, leaves a long transaction of short statements alone,
 * and the lesson materializer -- the one academy-wide statement -- runs under
 * its own limit and hands the caller's limit back.
 */
describe('statement timeout', () => {
  let timed: PrismaService;
  const savedTimeout = process.env.DATABASE_STATEMENT_TIMEOUT_MS;

  beforeAll(async () => {
    process.env.DATABASE_STATEMENT_TIMEOUT_MS = '500';
    timed = new PrismaService();
    await timed.$connect();
  });
  afterAll(async () => {
    await timed?.$disconnect();
    if (savedTimeout === undefined) delete process.env.DATABASE_STATEMENT_TIMEOUT_MS;
    else process.env.DATABASE_STATEMENT_TIMEOUT_MS = savedTimeout;
  });

  it('is set on the session', async () => {
    const [{ statement_timeout }] = await timed.$queryRawUnsafe<Array<{ statement_timeout: string }>>('SHOW statement_timeout');
    expect(statement_timeout).toBe('500ms');
  });

  it('a slow statement is cancelled with a clear error (SQLSTATE 57014)', async () => {
    const started = Date.now();
    const error = await timed.$executeRawUnsafe('SELECT pg_sleep(3)').then(() => null, (e: Error) => e);
    expect(String(error?.message)).toMatch(/57014|statement timeout/);
    expect(Date.now() - started).toBeLessThan(2_500);
  });

  it('a normal transaction of short statements is unaffected, though it lasts longer than the limit', async () => {
    const n = await timed.$transaction(async (tx) => {
      for (let i = 0; i < 4; i++) await tx.$executeRawUnsafe('SELECT pg_sleep(0.2)'); // 800 ms > 500 ms in total
      const [{ one }] = await tx.$queryRawUnsafe<Array<{ one: number }>>('SELECT 1 AS one');
      return one;
    }, { timeout: 10_000 });
    expect(n).toBe(1);
  });

  it('the materializer runs under its own limit and gives a caller\'s transaction its limit back', async () => {
    const scheduling = new SchedulingService(
      timed, {} as never, {} as never, {} as never, {} as never,
      { get: async () => 1 } as never, {} as never, {} as never,
    );
    const during: number[] = [];
    const after = await timed.$transaction(async (tx) => {
      // The caller's transaction, observed at the moment the materializer's statement runs.
      const spy = {
        $queryRaw: async (strings: TemplateStringsArray, ...values: unknown[]) => {
          if (strings.join('?').includes('materialize_lessons')) {
            // pg_settings gives milliseconds (SHOW would say "2min").
            const [{ ms }] = await tx.$queryRawUnsafe<Array<{ ms: number }>>(`SELECT setting::int AS ms FROM pg_settings WHERE name = 'statement_timeout'`);
            during.push(ms);
          }
          return (tx.$queryRaw as (s: TemplateStringsArray, ...v: unknown[]) => Promise<unknown>)(strings, ...values);
        },
      };
      await scheduling.materialize(spy as never);
      const [{ v }] = await tx.$queryRawUnsafe<Array<{ v: string }>>(`SELECT current_setting('statement_timeout') AS v`);
      return v;
    }, { timeout: 30_000 });
    expect(during).toEqual([MATERIALIZE_STATEMENT_TIMEOUT_MS]);
    expect(after).toBe('500ms');
    // And on its own (no caller transaction) it still completes.
    await expect(scheduling.materialize()).resolves.toBeGreaterThanOrEqual(0);
  });
});
