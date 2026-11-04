/**
 * TEACHER-027: what one lesson move costs the database.
 *
 * On systest under load (host ~90) a move failed 3/3 with P2028: its
 * interactive transaction outran Prisma's 5 s default. This measures the move
 * -- statements sent and wall time, for the whole request and for the
 * transaction alone -- and holds the statement count to a ceiling, so a later
 * change that adds round trips inside the transaction fails here instead of on
 * a loaded server.
 *
 * Synthetic fixtures only (QA gate G-16).
 */
import { randomUUID } from 'node:crypto';
import { PrismaService } from '@platform/prisma.service';
import { PrismaAuditService } from '@platform/audit.service';
import { LessonService } from '../../src/lessons/lesson.service';
import { SchedulingService } from '../../src/lessons/scheduling.service';
import { buildGraph, seed, truncate, Scenario } from './harness';

const MARK = 'teacher027-mark';
const prisma = new PrismaService({ log: [{ emit: 'event', level: 'query' }] });
const events: Array<{ at: number; query: string }> = [];
let marked: (() => void) | null = null;
(prisma as unknown as { $on(event: 'query', cb: (e: { query: string; timestamp: Date }) => void): void }).$on('query', (e) => {
  if (e.query.includes(MARK)) {
    marked?.();
    marked = null;
    return;
  }
  events.push({ at: e.timestamp.getTime(), query: e.query });
});
/** Every query sent so far has been reported (they arrive in order, after the marker's). */
async function settle(): Promise<void> {
  const seen = new Promise<void>((resolve) => {
    marked = resolve;
  });
  await prisma.$queryRawUnsafe(`SELECT '${MARK}' AS mark`);
  await seen;
}

const g = buildGraph(undefined, prisma);
const audit = new PrismaAuditService();
const lessons = new LessonService(g.prisma, g.authz, g.conversations, g.outbox, g.config, audit);
const scheduling = new SchedulingService(g.prisma, g.authz, g.conversations, lessons, g.outbox, g.config, g.reminders, audit);

const TZ = 'Africa/Cairo';
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const at = (ms: number) => new Date(Date.now() + ms).toISOString();

/**
 * Ceilings: 29 and 28 measured 2026-11-02, plus 2. History: 30/29 before
 * TEACHER-027 dropped the in-transaction include, 22/21 after it, 29/28 once
 * PD-46 PR-2a announces the move in the same transaction (two keyed
 * lesson.changed -- the closed row and the new one -- each a payload read, an
 * outbox insert and a safety-net delete; and the card's idempotency lookup).
 * A change that adds statements INSIDE the transaction (which holds the
 * learner and the group's row locks) must raise these on purpose.
 */
const MAX_TX_STATEMENTS = { family: 31, staff: 30 };

let s: Scenario;
let tsupId: string;

beforeAll(async () => {
  await prisma.$connect();
});
const TRUNCATING_HOOK_MS = 60_000;
afterAll(async () => {
  await truncate(prisma);
  await prisma.$disconnect();
}, TRUNCATING_HOOK_MS);
beforeEach(async () => {
  await truncate(prisma);
  await prisma.$executeRawUnsafe(`delete from chat.config where key like 'lesson.%'`);
  s = await seed(prisma);
  g.coverage.onDutyId = s.ownerId;
  await g.conversations.ensureStudentGroup(s.learnerId, s.ownerId);
  tsupId = randomUUID();
  await prisma.$executeRawUnsafe(`insert into chat.staff (id, name, role, is_active) values ($1::uuid, 'tsup_a', 'admin', true)`, tsupId);
  const [{ id: dept }] = await prisma.$queryRawUnsafe<Array<{ id: string }>>(
    `insert into chat.department (kind, display_name) values ('teachers', 'teachers') returning id::text as id`,
  );
  await prisma.$executeRawUnsafe(
    `insert into chat.department_member (staff_id, organization_id, department_id, position)
     values ($1::uuid, chat.default_organization_id(), $2::uuid, 'supervisor')`,
    tsupId, dept,
  );
  await scheduling.setAvailability(tsupId, s.teacherId, {
    timezone: TZ,
    windows: [1, 2, 3, 4, 5, 6, 7].map((weekday) => ({ weekday, start: '00:00', end: '24:00' })),
  });
}, TRUNCATING_HOOK_MS);

/** Moves one lesson and reports the request's and the transaction's statements and time. */
async function measure(who: 'family' | 'staff') {
  const id = (await lessons.schedule(tsupId, { learnerId: s.learnerId, startsAt: at(3 * DAY), endsAt: at(3 * DAY + HOUR / 2) })).id;
  const actor = who === 'family' ? s.parentId : s.ownerId;
  const offer = await scheduling.moveSlots(actor, id);
  const tx: { start: number; end: number } = { start: 0, end: 0 };
  const original = prisma.$transaction.bind(prisma);
  const spy = jest.spyOn(prisma, '$transaction').mockImplementation(((fn: unknown, opts?: unknown) => {
    tx.start = Date.now();
    return (original as (f: unknown, o?: unknown) => Promise<unknown>)(fn, opts).finally(() => {
      tx.end = Date.now();
    });
  }) as never);
  try {
    await settle();
    events.length = 0;
    const started = Date.now();
    await scheduling.moveLesson(actor, id, { startsAt: offer.slots[30] });
    const total = Date.now() - started;
    await settle();
    // The move's one transaction, BEGIN to COMMIT inclusive (both are round trips too).
    const begin = events.findIndex((e) => e.query === 'BEGIN');
    const commit = events.findIndex((e, i) => i > begin && e.query === 'COMMIT');
    expect(begin).toBeGreaterThanOrEqual(0);
    expect(commit).toBeGreaterThan(begin);
    const inTx = events.slice(begin, commit + 1);
    const row = { who, requestStatements: events.length, requestMs: total, txStatements: inTx.length, txMs: tx.end - tx.start };
    console.log(`TEACHER-027 move cost ${JSON.stringify(row)}`);
    if (process.env.TEACHER027_DUMP) console.log(inTx.map((e, i) => `${i + 1}. ${e.query.replace(/\s+/g, ' ').slice(0, 160)}`).join('\n'));
    return row;
  } finally {
    spy.mockRestore();
  }
}

describe('TEACHER-027: one lesson move', () => {
  it('a family move stays within its statement ceiling inside the transaction', async () => {
    const row = await measure('family');
    expect(row.txStatements).toBeGreaterThan(5);
    expect(row.txStatements).toBeLessThanOrEqual(MAX_TX_STATEMENTS.family);
  });

  it('a staff move stays within its statement ceiling inside the transaction', async () => {
    const row = await measure('staff');
    expect(row.txStatements).toBeGreaterThan(5);
    expect(row.txStatements).toBeLessThanOrEqual(MAX_TX_STATEMENTS.staff);
  });
});
