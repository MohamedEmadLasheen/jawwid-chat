/**
 * Performance baseline. Phase 8.
 *
 * WHAT THIS IS
 * ------------
 * Measured numbers for the paths that carry the product, produced by driving
 * the REAL service graph against the REAL migrated database -- the same graph
 * the integration suite uses, so a message here does everything a message does
 * in production: authorization, the BR-1 trigger, receipts, the outbox row.
 *
 * WHAT THIS IS NOT
 * ----------------
 * It is NOT a production capacity statement, and no number here should be
 * quoted as one. It runs on one developer machine against a container on
 * loopback, with no network between the application and the database, no load
 * balancer, no other tenants, and one process. A production topology differs on
 * every one of those.
 *
 * What it IS good for is exactly what Phase 8 lacked: a recorded starting
 * point. "Sending a message costs ~X ms at the service layer" is a fact that
 * can be re-measured after a change, and a regression against it is real
 * information even when the absolute number is not a capacity promise.
 *
 * It is deliberately NOT part of `npm test`. A timing assertion on a shared CI
 * runner is a flaky test, and a flaky test in a security pipeline gets
 * disabled. Run it deliberately:
 *
 *   DATABASE_URL=... npx jest --selectProjects perf
 *
 * Results are recorded in docs/qa/performance-baseline.md, with the machine
 * they came from, because a number without its conditions is not evidence.
 */
import { randomUUID } from 'node:crypto';
import { buildGraph, seed, truncate, Scenario } from '../integration/harness';

const g = buildGraph();
let s: Scenario;

/** Percentiles from a sample, nearest-rank. */
function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return NaN;
  const rank = Math.max(1, Math.ceil((p / 100) * sorted.length));
  return sorted[rank - 1];
}

interface Summary {
  n: number;
  p50: number;
  p95: number;
  p99: number;
  max: number;
  perSecond: number;
}

function summarise(samples: number[], wallMs: number): Summary {
  const sorted = [...samples].sort((a, b) => a - b);
  return {
    n: samples.length,
    p50: percentile(sorted, 50),
    p95: percentile(sorted, 95),
    p99: percentile(sorted, 99),
    max: sorted[sorted.length - 1],
    perSecond: (samples.length / wallMs) * 1000,
  };
}

const report: Array<{ scenario: string } & Summary> = [];

/** Times one operation, repeated, and records the distribution. */
async function measure(
  scenario: string,
  iterations: number,
  op: (i: number) => Promise<unknown>,
): Promise<Summary> {
  // Warm up first. The first call through any of these paths pays for Prisma's
  // lazy connect and Postgres's first plan of each statement, and folding that
  // into the sample makes p99 a measurement of startup rather than of the path.
  await op(-1);

  const samples: number[] = [];
  const started = Date.now();
  for (let i = 0; i < iterations; i += 1) {
    const t0 = process.hrtime.bigint();
    await op(i);
    samples.push(Number(process.hrtime.bigint() - t0) / 1e6);
  }
  const summary = summarise(samples, Date.now() - started);
  report.push({ scenario, ...summary });
  return summary;
}

jest.setTimeout(600_000);

let conversationId: string;

beforeAll(async () => {
  await truncate(g.prisma);
  s = await seed(g.prisma);
  // G-44: on_duty() is the sole authority for acting on a family, and it
  // refuses by default. Pinning it is what the integration suites do; the point
  // here is to measure the path, not to measure the refusal.
  g.coverage.onDutyId = s.ownerId;
  conversationId = (await g.conversations.getOrCreateDirect(s.ownerId, s.parentId)).id;
});

afterAll(async () => {
  // The report is the artefact. Printed as a table so it can be pasted into
  // docs/qa/performance-baseline.md without being retyped -- a number retyped
  // by hand is a number that drifts.
  const pad = (v: string | number, w: number) => String(v).padStart(w);
  const row = (c: string[], w: number[]) => c.map((v, i) => pad(v, w[i])).join('  ');
  const widths = [46, 6, 9, 9, 9, 9, 11];

  // eslint-disable-next-line no-console
  console.log(
    '\n=== PERFORMANCE BASELINE (measured) ===\n' +
      row(['scenario', 'n', 'p50 ms', 'p95 ms', 'p99 ms', 'max ms', 'ops/sec'], widths) +
      '\n' +
      report
        .map((r) =>
          row(
            [
              r.scenario,
              String(r.n),
              r.p50.toFixed(2),
              r.p95.toFixed(2),
              r.p99.toFixed(2),
              r.max.toFixed(2),
              r.perSecond.toFixed(1),
            ],
            widths,
          ),
        )
        .join('\n') +
      '\n',
  );
  await g.prisma.$disconnect();
});

// ---------------------------------------------------------------------------

describe('performance baseline', () => {
  it('message send, sequential', async () => {
    const summary = await measure('message send (sequential, 1 actor)', 200, (i) =>
      g.messages.send({
        conversationId,
        senderId: s.ownerId,
        body: `perf ${i}`,
        clientMessageId: randomUUID(),
      }),
    );
    // No threshold assertion -- see the header. The assertion is that the path
    // completed under load at all, which a hang or a leak would break.
    expect(summary.n).toBe(200);
  });

  it('message send, 20 concurrent', async () => {
    // Concurrency is where connection pooling, lock contention on the
    // conversation row and the outbox insert actually show up. A sequential
    // number alone would hide all three.
    const rounds = 10;
    const width = 20;
    const samples: number[] = [];
    const started = Date.now();

    for (let r = 0; r < rounds; r += 1) {
      await Promise.all(
        Array.from({ length: width }, async () => {
          const t0 = process.hrtime.bigint();
          await g.messages.send({
            conversationId,
            senderId: s.ownerId,
            body: 'perf concurrent',
            clientMessageId: randomUUID(),
          });
          samples.push(Number(process.hrtime.bigint() - t0) / 1e6);
        }),
      );
    }
    report.push({
      scenario: `message send (${width} concurrent)`,
      ...summarise(samples, Date.now() - started),
    });
    expect(samples).toHaveLength(rounds * width);
  });

  it('message history read (page of 50)', async () => {
    const summary = await measure('message history (page of 50)', 100, () =>
      g.messages.list({ conversationId, actorId: s.ownerId, limit: 50 }),
    );
    expect(summary.n).toBe(100);
  });

  it('unread count', async () => {
    const summary = await measure('unread count', 100, () =>
      g.messages.unreadCount(conversationId, s.parentId),
    );
    expect(summary.n).toBe(100);
  });

  it('conversation resolve (the authorization path)', async () => {
    const summary = await measure('conversation resolve + membership', 100, async () => {
      const conv = await g.conversations.requireConversation(conversationId);
      const actor = await g.conversations.requireActor(s.ownerId);
      return g.conversations.membershipOf(conv.id, actor.actorId);
    });
    expect(summary.n).toBe(100);
  });

  it('login (argon2 is deliberately expensive)', async () => {
    // Included because it is the one path whose cost is a DESIGN CHOICE rather
    // than an accident: password hashing is meant to be slow, and seeing it
    // next to the others stops somebody "optimising" it later.
    await g.accounts.setPassword(s.accounts[s.managerId], 'a-long-enough-test-password', {
      reason: 'perf fixture',
      invalidateSessions: false,
    });
    const summary = await measure('login (verify + session issue)', 20, () =>
      g.auth.login(`subject_${s.managerId}`, 'a-long-enough-test-password'),
    );
    expect(summary.n).toBe(20);
  });

  it('action throttle check (the Phase 8 overhead)', async () => {
    // The cost this phase ADDED to every rate-limited request. Measured rather
    // than assumed, because "one indexed upsert" is a claim until it is timed.
    await g.prisma.$executeRawUnsafe('delete from chat.auth_throttle');
    await g.prisma.config.upsert({
      where: { key: 'abuse.throttle.message_send_actor' },
      create: { key: 'abuse.throttle.message_send_actor', value: '1000000' },
      update: { value: '1000000' },
    });
    g.config.invalidate();

    const summary = await measure('action throttle check (added by Phase 8)', 200, () =>
      g.throttle.hitAction('message_send_actor', s.ownerId),
    );
    expect(summary.n).toBe(200);
  });
});
