/**
 * THE LEDGER CLAIM MUST COMMIT WITH THE WORK IT AUTHORISES.
 *
 * The claim used to commit on its own connection, before apply()'s transaction
 * opened. A process that died in between left `processed_at` set with no
 * projection and no error -- indistinguishable from success. Core's retry was
 * then answered `duplicate`, drain() skipped the row (it filters on
 * processed_at is null), no lease sweeper exists for this ledger, and
 * sync_health counts only unprocessed rows. The event was lost silently.
 *
 * These tests hold the boundary to one invariant:
 *
 *   a Core event cannot be permanently marked processed unless its projection
 *   and its outbox work committed in the SAME transaction.
 *
 * Requires the migrated database (DATABASE_URL).
 */
import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { buildGraph, seed, truncate, Scenario } from './harness';

jest.setTimeout(60_000);

const g = buildGraph();
let s: Scenario;
let coreChildId: string;

/** A second connection, so a held transaction can be contended for real. */
const other = new PrismaClient();

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

async function record(eventType: string, payload: unknown, occurredAt = new Date()): Promise<string> {
  const id = randomUUID();
  await g.prisma.$executeRaw`
    insert into chat.core_event (source, external_event_id, event_type, payload,
                                 occurred_at, received_at)
    values ('jawwid_core', ${id}, ${eventType}, ${JSON.stringify(payload)}::jsonb,
            ${occurredAt}::timestamptz, now())`;
  return id;
}

const ledger = (externalId: string) =>
  g.prisma.coreEventRow.findUnique({
    where: { source_externalEventId: { source: 'jawwid_core', externalEventId: externalId } },
    select: { processedAt: true, error: true },
  });

const sessions = (coreId: string) =>
  g.prisma.classSession.count({ where: { coreClassSessionId: coreId } });

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
  await Promise.all([g.prisma.$disconnect(), other.$disconnect()]);
});

// =========================================================================
describe('the claim is part of the transaction', () => {
  /** Block until the DB reports a session genuinely waiting on a lock. */
  async function waitUntilBlocked(): Promise<void> {
    for (let i = 0; i < 200; i += 1) {
      const [{ n }] = await other.$queryRaw<{ n: bigint }[]>`
        select count(*)::bigint as n from pg_stat_activity
         where wait_event_type = 'Lock' and state = 'active'`;
      if (Number(n) > 0) return;
      await new Promise((r) => setTimeout(r, 25));
    }
    throw new Error('apply() never blocked: the barrier is not real');
  }

  /**
   * THE DISCRIMINATING TEST.
   *
   * While apply() is mid-transaction, the claim MUST be invisible to every
   * other connection -- that is what "the claim is part of the transaction"
   * means, and it is exactly what a crash relies on to roll back.
   *
   * Against the old boundary the claim was committed on its own connection
   * BEFORE the transaction opened, so a third connection could see
   * `processed_at` set while the work was still in flight. That is the state a
   * dying process used to leave behind permanently.
   */
  it('a concurrent reader cannot see the claim until the work commits', async () => {
    const p = sessionPayload();
    // The session already exists, so the projection takes the UPDATE path and
    // can be blocked on its row lock.
    await record('class_session.upserted', p, new Date('2026-09-28T10:00:00.000Z'));
    expect(await g.coreIngest.drain()).toBe(1);

    const externalId = await record('class_session.upserted',
      { ...p, join_url: 'https://core.invalid/SECOND' }, new Date('2026-09-28T10:05:00.000Z'));

    // A holder pins the projection's row, uncommitted, so apply() blocks with
    // its claim already executed but not yet committed.
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    let written!: () => void;
    const hasWritten = new Promise<void>((r) => { written = r; });

    const held = other.$transaction(async (tx) => {
      await tx.$executeRaw`
        update chat.class_session set join_url = 'https://core.invalid/HOLDER'
         where core_class_session_id = ${p.core_class_session_id}`;
      written();
      await gate;
    }, { timeout: 30_000, maxWait: 30_000 });

    await hasWritten;
    const draining = g.coreIngest.drain();
    await waitUntilBlocked();

    // THE ASSERTION. A third connection, mid-flight: the claim must be
    // invisible. Under the old boundary this read `processed_at` as SET.
    const midFlight = await other.$queryRaw<{ processed_at: Date | null }[]>`
      select processed_at from chat.core_event where external_event_id = ${externalId}`;
    expect(midFlight[0].processed_at).toBeNull();

    release();
    await held;
    await draining;

    // And once committed, everything lands together.
    expect((await ledger(externalId))!.processedAt).not.toBeNull();
    expect(await sessions(p.core_class_session_id)).toBe(1);
  });
});

// =========================================================================
describe('a failure inside the transaction', () => {
  it('rolls back projection AND claim together, and the retry succeeds', async () => {
    // `starts_at` after `ends_at` trips the table's own check constraint, so
    // the projection raises INSIDE the transaction -- a real failure, not a mock.
    const good = sessionPayload();
    const bad = { ...good, ends_at: new Date(Date.now() + 3600_000).toISOString(),
                  starts_at: new Date(Date.now() + 48 * 3600_000).toISOString() };
    const externalId = await record('class_session.upserted', bad);

    expect(await g.coreIngest.drain()).toBe(0);

    // Rolled back: not processed, no projection, no outbox -- and the error is
    // recorded so the row stays visible rather than silently stuck.
    const after = (await ledger(externalId))!;
    expect(after.processedAt).toBeNull();
    expect(after.error).not.toBeNull();
    expect(await sessions(good.core_class_session_id)).toBe(0);
    expect(await g.prisma.outboxEvent.count()).toBe(0);
  });
});

// =========================================================================
describe('concurrent consumers', () => {
  it('two processors applying one event produce ONE projection and ONE outbox row', async () => {
    const p = sessionPayload();
    await record('class_session.upserted', p);

    const outboxBefore = await g.prisma.outboxEvent.count();
    // Real concurrency against the real database, both through the real path.
    const [a, b] = await Promise.all([g.coreIngest.drain(), g.coreIngest.drain()]);

    expect(a + b).toBe(1);                                   // one logical application
    expect(await sessions(p.core_class_session_id)).toBe(1); // one projection
    expect(await g.prisma.outboxEvent.count()).toBe(outboxBefore + 1);
  });
});

// =========================================================================
describe('consumed-but-silent outcomes still commit the claim', () => {
  it('a STALE event is consumed with no outbox row (Blocker 1 semantics preserved)', async () => {
    const p = sessionPayload();
    await record('class_session.upserted', p, new Date('2026-09-28T10:01:00.000Z'));
    expect(await g.coreIngest.drain()).toBe(1);

    const outboxAfterFirst = await g.prisma.outboxEvent.count();
    const staleId = await record('class_session.upserted',
      { ...p, join_url: 'https://core.invalid/STALE' }, new Date('2026-09-28T10:00:00.000Z'));

    expect(await g.coreIngest.drain()).toBe(0);

    const row = (await ledger(staleId))!;
    expect(row.processedAt).not.toBeNull();   // consumed, not retried forever
    expect(row.error).toBeNull();
    expect(await g.prisma.outboxEvent.count()).toBe(outboxAfterFirst);
  });

  it('a NOT_APPLICABLE event (unknown learner) is consumed with no outbox row', async () => {
    const p = sessionPayload({ core_child_id: randomUUID() });   // learner Chat never mirrored
    const externalId = await record('class_session.upserted', p);

    expect(await g.coreIngest.drain()).toBe(0);

    const row = (await ledger(externalId))!;
    expect(row.processedAt).not.toBeNull();
    expect(row.error).toBeNull();
    expect(await sessions(p.core_class_session_id)).toBe(0);
    expect(await g.prisma.outboxEvent.count()).toBe(0);
  });
});
