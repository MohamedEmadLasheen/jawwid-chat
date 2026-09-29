/**
 * BLOCKER 1 — Core -> Chat ordering must be ATOMIC.
 *
 * The three Core-sync functions used to decide ordering in a non-locking SELECT
 * and then write unconditionally. Under READ COMMITTED two concurrent
 * deliveries for one occurrence both read the same pre-image, neither sees the
 * other, and `ON CONFLICT DO UPDATE` then applies the loser's SET against the
 * winner's freshly committed row -- so an OLDER event silently overwrote a
 * NEWER one.
 *
 * Serial delivery was always safe, which is why every other spec passed. These
 * tests are therefore CONCURRENT ON PURPOSE, and each one fails against the old
 * SQL semantics.
 *
 * THE BARRIER IS A REAL LOCK, NOT A SLEEP
 * ---------------------------------------
 * A holder session opens a transaction and writes the NEWER state without
 * committing. The event under test then calls the real SQL function from a
 * second connection, where it BLOCKS on the holder's row/index lock. We assert
 * it is genuinely blocked by reading pg_stat_activity from a third connection
 * before releasing the holder. Nothing here depends on timing luck.
 *
 * Requires the migrated database (DATABASE_URL).
 */
import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { buildGraph, seed, truncate, Scenario } from './harness';

// Each concurrency case opens a holder transaction and waits for a real lock
// to register in pg_stat_activity, which comfortably exceeds jest's 5s default.
jest.setTimeout(60_000);

const g = buildGraph();
let s: Scenario;
let coreChildId: string;

/** Separate connections: the lock holder, and an observer that is never blocked. */
const holder = new PrismaClient();
const observer = new PrismaClient();

type Outcome = { outcome: string; class_session_id?: string; attendance_id?: string };

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

/** Call the REAL migrated function, exactly as core-ingest.service.ts does. */
async function callFn(
  client: PrismaClient,
  fn: 'ingest_core_class_session' | 'cancel_core_class_session' | 'ingest_core_attendance',
  payload: Record<string, unknown>,
  occurredAt: Date,
): Promise<Outcome> {
  const sql =
    fn === 'ingest_core_class_session'
      ? `select chat.ingest_core_class_session($1::jsonb, $2::timestamptz) as result`
      : fn === 'cancel_core_class_session'
        ? `select chat.cancel_core_class_session($1::jsonb, $2::timestamptz) as result`
        : `select chat.ingest_core_attendance($1::jsonb, $2::timestamptz) as result`;
  const rows = await client.$queryRawUnsafe<{ result: Outcome }[]>(
    sql,
    JSON.stringify(payload),
    occurredAt,
  );
  return rows[0].result;
}

/** Block until the DB reports a session genuinely waiting on a lock. */
async function waitUntilBlocked(): Promise<void> {
  for (let i = 0; i < 200; i += 1) {
    const [{ n }] = await observer.$queryRaw<{ n: bigint }[]>`
      select count(*)::bigint as n from pg_stat_activity
       where wait_event_type = 'Lock' and state = 'active'`;
    if (Number(n) > 0) return;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error('the contending statement never blocked: the barrier is not real');
}

/**
 * Run `contender` concurrently with a holder transaction that writes NEWER
 * state first. Returns the contender's outcome once the holder has committed.
 */
async function raceAgainstHolder(
  holderWrite: (tx: PrismaClient) => Promise<void>,
  contender: () => Promise<Outcome>,
): Promise<Outcome> {
  let release!: () => void;
  const gate = new Promise<void>((r) => { release = r; });
  // The holder must have WRITTEN before the contender starts, or there is no
  // lock to contend for and the "race" would silently become sequential.
  let written!: () => void;
  const hasWritten = new Promise<void>((r) => { written = r; });

  const held = holder.$transaction(
    async (tx) => {
      await holderWrite(tx as unknown as PrismaClient);
      written();
      await gate;                       // hold the lock open, uncommitted
    },
    { timeout: 30_000, maxWait: 30_000 },
  );

  await hasWritten;                     // newer state is written but NOT committed
  const contending = contender();       // must now block on the holder's lock
  await waitUntilBlocked();             // proven blocked, not merely slow
  release();                            // holder commits
  await held;
  return contending;
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

const OLD = new Date('2026-09-28T10:00:00.000Z');
const NEW = new Date('2026-09-28T10:01:00.000Z');
const NEWER = new Date('2026-09-28T10:02:00.000Z');

// =========================================================================
describe('concurrent class-session ordering', () => {
  it('an OLDER event cannot overwrite a NEWER one committed concurrently', async () => {
    const p = sessionPayload();
    // Pre-image well before both contenders.
    await callFn(g.prisma, 'ingest_core_class_session', p, new Date('2026-09-28T09:00:00.000Z'));

    const outcome = await raceAgainstHolder(
      (tx) => callFn(tx, 'ingest_core_class_session',
        { ...p, join_url: 'https://core.invalid/NEWER' }, NEW).then(() => undefined),
      () => callFn(g.prisma, 'ingest_core_class_session',
        { ...p, join_url: 'https://core.invalid/OLDER' }, OLD),
    );

    expect(outcome.outcome).toBe('stale');
    const row = (await g.prisma.classSession.findUnique({
      where: { coreClassSessionId: p.core_class_session_id },
    }))!;
    expect(row.coreSyncedAt.toISOString()).toBe(NEW.toISOString());
    expect(row.joinUrl).toBe('https://core.invalid/NEWER');   // fields belong to the newer event
  });

  it('FIRST-INSERT race: no row yet, and the newer event still wins', async () => {
    const p = sessionPayload();

    const outcome = await raceAgainstHolder(
      (tx) => callFn(tx, 'ingest_core_class_session',
        { ...p, join_url: 'https://core.invalid/NEWER' }, NEW).then(() => undefined),
      () => callFn(g.prisma, 'ingest_core_class_session',
        { ...p, join_url: 'https://core.invalid/OLDER' }, OLD),
    );

    expect(outcome.outcome).toBe('stale');
    const rows = await g.prisma.classSession.findMany({
      where: { coreClassSessionId: p.core_class_session_id },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].coreSyncedAt.toISOString()).toBe(NEW.toISOString());
    expect(rows[0].joinUrl).toBe('https://core.invalid/NEWER');
  });

  it('a concurrent STALE upsert cannot resurrect a cancelled session', async () => {
    const p = sessionPayload();
    await callFn(g.prisma, 'ingest_core_class_session', p, new Date('2026-09-28T09:00:00.000Z'));

    const outcome = await raceAgainstHolder(
      (tx) => callFn(tx, 'cancel_core_class_session',
        { core_class_session_id: p.core_class_session_id }, NEW).then(() => undefined),
      () => callFn(g.prisma, 'ingest_core_class_session', { ...p, status: 'scheduled' }, OLD),
    );

    expect(outcome.outcome).toBe('stale');
    const row = (await g.prisma.classSession.findUnique({
      where: { coreClassSessionId: p.core_class_session_id },
    }))!;
    expect(row.status).toBe('cancelled');
    expect(row.coreSyncedAt.toISOString()).toBe(NEW.toISOString());
  });
});

// =========================================================================
describe('concurrent attendance ordering', () => {
  it('an older class_attended cannot overwrite a newer class_missed', async () => {
    const p = sessionPayload();
    await callFn(g.prisma, 'ingest_core_class_session', p, new Date('2026-09-28T09:00:00.000Z'));
    const att = (o: string) => ({
      core_class_session_id: p.core_class_session_id,
      core_child_id: coreChildId,
      outcome: o,
      recorded_at: new Date('2026-09-28T09:30:00.000Z').toISOString(),
    });
    // Seed an attendance row so the contenders race the UPDATE path too.
    await callFn(g.prisma, 'ingest_core_attendance', att('class_attended'),
      new Date('2026-09-28T09:40:00.000Z'));

    const outcome = await raceAgainstHolder(
      (tx) => callFn(tx, 'ingest_core_attendance', att('class_missed'), NEWER).then(() => undefined),
      () => callFn(g.prisma, 'ingest_core_attendance', att('class_attended'), NEW),
    );

    expect(outcome.outcome).toBe('stale');
    const row = (await g.prisma.classAttendance.findFirst({
      where: { classSession: { coreClassSessionId: p.core_class_session_id } },
    }))!;
    expect(row.outcome).toBe('class_missed');
    expect(row.coreSyncedAt.toISOString()).toBe(NEWER.toISOString());
  });
});

// =========================================================================
describe('the suppressed write contract', () => {
  it('a serial stale write returns `stale` with a real id and changes nothing', async () => {
    const p = sessionPayload();
    await callFn(g.prisma, 'ingest_core_class_session', p, NEW);
    const before = (await g.prisma.classSession.findUnique({
      where: { coreClassSessionId: p.core_class_session_id },
    }))!;

    const outcome = await callFn(g.prisma, 'ingest_core_class_session',
      { ...p, join_url: 'https://core.invalid/STALE' }, OLD);

    expect(outcome.outcome).toBe('stale');
    // No NULL identifier may ever reach the outbox.
    expect(outcome.class_session_id).toBe(before.id);

    const after = (await g.prisma.classSession.findUnique({
      where: { coreClassSessionId: p.core_class_session_id },
    }))!;
    expect(after.coreSyncedAt.toISOString()).toBe(NEW.toISOString());
    expect(after.joinUrl).toBe(before.joinUrl);
  });

  it('an EQUAL occurred_at still applies (guards `<=` against `<`)', async () => {
    const p = sessionPayload();
    await callFn(g.prisma, 'ingest_core_class_session', p, NEW);

    const outcome = await callFn(g.prisma, 'ingest_core_class_session',
      { ...p, join_url: 'https://core.invalid/EQUAL' }, NEW);

    expect(outcome.outcome).toBe('applied');
    const row = (await g.prisma.classSession.findUnique({
      where: { coreClassSessionId: p.core_class_session_id },
    }))!;
    expect(row.joinUrl).toBe('https://core.invalid/EQUAL');
    expect(row.coreSyncedAt.toISOString()).toBe(NEW.toISOString());
  });
});

// =========================================================================
describe('a stale delivery through the real application path', () => {
  it('is consumed without emitting any domain event', async () => {
    const p = sessionPayload();
    await callFn(g.prisma, 'ingest_core_class_session', p, NEW);

    const outboxBefore = await g.prisma.outboxEvent.count();

    // A genuinely older delivery, recorded on the boundary exactly as production does.
    await g.prisma.$executeRaw`
      insert into chat.core_event (source, external_event_id, event_type, payload,
                                   occurred_at, received_at)
      values ('jawwid_core', ${randomUUID()}, 'class_session.upserted',
              ${JSON.stringify({ ...p, join_url: 'https://core.invalid/STALE' })}::jsonb,
              ${OLD}::timestamptz, now())`;

    // Drained without throwing, and NOT counted as applied.
    await expect(g.coreIngest.drain()).resolves.toBe(0);

    // No domain event, so no notification can follow.
    expect(await g.prisma.outboxEvent.count()).toBe(outboxBefore);

    // The ledger row is consumed, not left for an endless retry.
    const [{ n }] = await g.prisma.$queryRaw<{ n: bigint }[]>`
      select count(*)::bigint as n from chat.core_event
       where processed_at is null and error is null`;
    expect(Number(n)).toBe(0);

    // And the projection is untouched.
    const row = (await g.prisma.classSession.findUnique({
      where: { coreClassSessionId: p.core_class_session_id },
    }))!;
    expect(row.coreSyncedAt.toISOString()).toBe(NEW.toISOString());
    expect(row.joinUrl).toBe(p.join_url);
  });
});
