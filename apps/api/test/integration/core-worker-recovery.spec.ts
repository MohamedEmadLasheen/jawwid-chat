/**
 * P2-a and P2-b: the two ways the pipeline could stall or lose work silently.
 *
 * P2-a  The outbox claim used to set `published` -- the TERMINAL state -- before
 *       delivery ran. A worker that died in between left the row `published`
 *       with nothing delivered, and drain() only selects `pending`, so nothing
 *       ever reclaimed it. The notification was lost permanently and silently.
 *       The claim is now a visibility lease: a crash lets it lapse.
 *
 * P2-b  The ledger drain ordered purely by id, so permanently failing events
 *       collected at the head and filled every batch. Measured before the fix:
 *       60 poison rows took all 50 slots on every tick and a valid event behind
 *       them was never selected. Never-failed events are now ordered first.
 *
 * Requires the migrated database (DATABASE_URL).
 */
import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { buildGraph, seed, truncate, Scenario } from './harness';

jest.setTimeout(60_000);

const g = buildGraph();
/** The lock holder, and an observer that is never blocked. */
const holder = new PrismaClient();
const observer = new PrismaClient();
let s: Scenario;
let coreChildId: string;

const HANDLED = ['class_session.upserted', 'class_session.cancelled', 'attendance.upserted'];

const sessionPayload = (over: Record<string, unknown> = {}) => ({
  core_class_session_id: randomUUID(),
  core_child_id: coreChildId,
  core_teacher_id: null,
  starts_at: new Date(Date.now() + 48 * 3600_000).toISOString(),
  ends_at: new Date(Date.now() + 48 * 3600_000 + 3600_000).toISOString(),
  join_url: 'https://core.invalid/room/abc',
  status: 'scheduled',
  ...over,
});

async function record(payload: unknown): Promise<string> {
  const id = randomUUID();
  await g.prisma.$executeRaw`
    insert into chat.core_event (source, external_event_id, event_type, payload,
                                 occurred_at, received_at)
    values ('jawwid_core', ${id}, 'class_session.upserted',
            ${JSON.stringify(payload)}::jsonb, now(), now())`;
  return id;
}

beforeEach(async () => {
  await truncate(g.prisma);
  s = await seed(g.prisma);
  g.coverage.onDutyId = s.ownerId;
  coreChildId = randomUUID();
  await g.prisma.$executeRaw`
    update chat.learner set core_child_id = ${coreChildId}::uuid where id = ${s.learnerId}::uuid`;
});

afterAll(async () => {
  await truncate(g.prisma);
  await Promise.all([g.prisma.$disconnect(), holder.$disconnect(), observer.$disconnect()]);
});

// =========================================================================
describe('P2-a: a worker that dies holding an outbox claim', () => {
  /**
   * THE DISCRIMINATING TEST.
   *
   * The only externally observable difference between a lease and a terminal
   * claim is the row's state WHILE delivery is in flight. So the delivery is
   * blocked on a real lock and the row is read from another connection.
   *
   * New behaviour : 'pending', its visibility pushed out -> a crash here lets
   *                 the lease lapse and the next drain reclaims it.
   * Old behaviour : 'published' -- terminal, and drain() only selects
   *                 'pending', so a crash here lost the notification forever.
   */
  it('leaves the row reclaimable while delivery is in flight, not terminal', async () => {
    const p = sessionPayload();
    await record(p);
    expect(await g.coreIngest.drain()).toBe(1);
    const queued = await g.prisma.outboxEvent.findFirst({ where: { status: 'pending' } });
    expect(queued).not.toBeNull();

    // A holder takes an EXCLUSIVE lock on the table publish() must insert into,
    // so the worker blocks after claiming. A real database barrier, not a sleep.
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    let locked!: () => void;
    const hasLock = new Promise<void>((r) => { locked = r; });

    const held = holder.$transaction(async (tx) => {
      await tx.$executeRawUnsafe('lock table chat.notification in exclusive mode');
      locked();
      await gate;
    }, { timeout: 30_000, maxWait: 30_000 });

    await hasLock;
    const draining = g.outboxWorker.drain(10);

    // Proven blocked, not merely slow.
    let blocked = false;
    for (let i = 0; i < 200 && !blocked; i += 1) {
      const [{ n }] = await observer.$queryRaw<{ n: bigint }[]>`
        select count(*)::bigint as n from pg_stat_activity
         where wait_event_type = 'Lock' and state = 'active'`;
      if (Number(n) > 0) blocked = true;
      else await new Promise((r) => setTimeout(r, 25));
    }
    expect(blocked).toBe(true);

    // THE ASSERTION. Mid-flight, from a third connection.
    const midFlight = await observer.$queryRaw<{ status: string }[]>`
      select status from chat.outbox_event where id = ${queued!.id}::uuid`;
    expect(midFlight[0].status).toBe('pending');

    release();
    await held;
    await draining;

    // And it becomes terminal only once delivery actually completed.
    const done = (await g.prisma.outboxEvent.findUnique({ where: { id: queued!.id } }))!;
    expect(done.status).toBe('published');
    expect(done.publishedAt).not.toBeNull();
  });

  it('marks published only after delivery, and a real drain still publishes once', async () => {
    const p = sessionPayload();
    await record(p);
    expect(await g.coreIngest.drain()).toBe(1);

    const pendingBefore = await g.prisma.outboxEvent.count({ where: { status: 'pending' } });
    expect(pendingBefore).toBeGreaterThan(0);

    await g.outboxWorker.drain(100);

    expect(await g.prisma.outboxEvent.count({ where: { status: 'pending' } })).toBe(0);
    const done = await g.prisma.outboxEvent.findMany({ where: { status: 'published' } });
    expect(done).toHaveLength(pendingBefore);
    // publishedAt is stamped by the success write, not by the claim.
    expect(done.every((e) => e.publishedAt !== null)).toBe(true);
  });
});

// =========================================================================
describe('P2-b: permanently failing events', () => {
  it('cannot starve legitimate events out of the batch', async () => {
    // Enough poison rows to fill a whole batch on their own, recorded FIRST so
    // they hold the lowest ids.
    const POISON = 60;
    for (let i = 0; i < POISON; i += 1) {
      await record({ core_class_session_id: `poison-${i}`, core_child_id: coreChildId });
    }
    // They must actually be failing, and must actually be marked with an error.
    expect(await g.coreIngest.drain(POISON)).toBe(0);
    expect(
      await g.prisma.coreEventRow.count({ where: { processedAt: null, error: { not: null } } }),
    ).toBe(POISON);

    // A legitimate event arrives behind all of them.
    const good = sessionPayload();
    await record(good);

    // One ordinary batch must reach it.
    const batch = await g.prisma.coreEventRow.findMany({
      where: { processedAt: null, eventType: { in: HANDLED } },
      orderBy: [{ error: { sort: 'asc', nulls: 'first' } }, { id: 'asc' }],
      take: 50,
      select: { error: true },
    });
    expect(batch[0].error).toBeNull();          // fresh work is at the head

    expect(await g.coreIngest.drain()).toBe(1); // and it is applied
    expect(
      await g.prisma.classSession.count({
        where: { coreClassSessionId: good.core_class_session_id },
      }),
    ).toBe(1);
  });

  it('keeps failing events visible rather than discarding them', async () => {
    await record({ core_class_session_id: 'poison', core_child_id: coreChildId });
    expect(await g.coreIngest.drain()).toBe(0);

    const row = (await g.prisma.coreEventRow.findFirst({ where: { processedAt: null } }))!;
    expect(row.error).not.toBeNull();           // operator-visible, counted by sync_health
    expect(row.processedAt).toBeNull();         // still retryable, never silently consumed
  });
});
