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
