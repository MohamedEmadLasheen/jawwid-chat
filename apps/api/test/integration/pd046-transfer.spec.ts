/**
 * PD-46 PR-2b: a change of teacher moves what is live and leaves the rest as it
 * was -- and says so.
 *
 *   - TEACHER-026: a lesson apologised (with its make-up), moved by staff or
 *     moved by the teacher keeps its outcome, and nothing is re-created at its
 *     time -- not after one transfer, not after a transfer and back;
 *   - CHATSCHED-009: a transfer that keeps the weekly times leaves no closed
 *     "rescheduled" twin beside each weekly lesson: the open lessons are the
 *     same rows, before and after;
 *   - CHATSCHED-008: each group the old teacher left and the new one joined
 *     gets membership_changed (added: the new teacher, removed: the old);
 *   - the moved lessons are announced in the transfer's own transaction.
 *
 * Synthetic fixtures only (QA gate G-16).
 */
import { randomUUID } from 'node:crypto';
import { PrismaAuditService } from '@platform/audit.service';
import { CommEvent } from '@communication/contracts/events';
import { LessonService } from '../../src/lessons/lesson.service';
import { SchedulingService } from '../../src/lessons/scheduling.service';
import { LifecycleService } from '../../src/lessons/lifecycle.service';
import { SupervisionConversationService } from '../../src/supervision/supervision-conversation.service';
import { buildGraph, seed, truncate, Scenario } from './harness';

jest.setTimeout(180_000);

const g = buildGraph();
const audit = new PrismaAuditService();
const lessons = new LessonService(g.prisma, g.authz, g.conversations, g.outbox, g.config, audit);
const scheduling = new SchedulingService(g.prisma, g.authz, g.conversations, lessons, g.outbox, g.config, g.reminders, audit);
const supervisionChats = new SupervisionConversationService(g.prisma, g.authz, g.conversations, g.outbox, audit);
const lifecycle = new LifecycleService(g.prisma, g.conversations, lessons, scheduling, g.outbox, g.config, audit, supervisionChats);

const TZ = 'Africa/Cairo';
const DAY = 24 * 3_600_000;
let s: Scenario;
let tsupId: string;
let groupId: string;

async function weekdayIn(days: number): Promise<number> {
  const [{ d }] = await g.prisma.$queryRawUnsafe<Array<{ d: number }>>(
    `select extract(isodow from (now() at time zone '${TZ}')::date + ${days})::int as d`,
  );
  return d;
}
async function openAllWeek(teacherId: string) {
  await scheduling.setAvailability(tsupId, teacherId, {
    timezone: TZ,
    windows: [1, 2, 3, 4, 5, 6, 7].map((weekday) => ({ weekday, start: '00:00', end: '24:00' })),
  });
}
/** The learner's lessons from now on, as (start, outcome, moved-from) -- the family's view of them. */
async function future() {
  return g.prisma.lesson.findMany({
    where: { learnerId: s.learnerId, startsAt: { gt: new Date() } },
    select: { id: true, startsAt: true, outcome: true, outcomeNote: true, movedFrom: true, kind: true, teacherId: true },
    orderBy: [{ startsAt: 'asc' }, { createdAt: 'asc' }],
  });
}

beforeAll(async () => {
  await g.prisma.$connect();
});
const TRUNCATING_HOOK_MS = 60_000;
afterAll(async () => {
  await truncate(g.prisma);
  await g.prisma.$executeRawUnsafe(`delete from chat.config where key like 'lesson.%'`);
  await g.prisma.$disconnect();
}, TRUNCATING_HOOK_MS);
beforeEach(async () => {
  await truncate(g.prisma);
  await g.prisma.$executeRawUnsafe(`delete from chat.config where key like 'lesson.%'`);
  s = await seed(g.prisma);
  g.coverage.onDutyId = s.ownerId;
  groupId = (await g.conversations.ensureStudentGroup(s.learnerId, s.ownerId)).id;
  tsupId = randomUUID();
  await g.prisma.$executeRawUnsafe(`insert into chat.staff (id, name, role, is_active) values ($1::uuid, 'tsup_a', 'admin', true)`, tsupId);
  const [{ id: dept }] = await g.prisma.$queryRawUnsafe<Array<{ id: string }>>(
    `insert into chat.department (kind, display_name) values ('teachers', 'teachers') returning id::text as id`,
  );
  await g.prisma.$executeRawUnsafe(
    `insert into chat.department_member (staff_id, organization_id, department_id, position)
     values ($1::uuid, chat.default_organization_id(), $2::uuid, 'supervisor')`,
    tsupId, dept,
  );
  await openAllWeek(s.teacherId);
  await openAllWeek(s.newTeacherId);
}, TRUNCATING_HOOK_MS);

describe('a change of teacher, and back', () => {
  it('TEACHER-026 / CHATSCHED-009: what was apologised or moved stays so, nothing is re-created, no twin is left', async () => {
    // Two weekly times, a few weeks of lessons.
    await scheduling.setSchedule(tsupId, s.learnerId, {
      slots: [
        { weekday: await weekdayIn(3), start: '18:00', durationMinutes: 30 },
        { weekday: await weekdayIn(5), start: '11:30', durationMinutes: 30 },
      ],
    });
    const weekly = (await future()).filter((l) => l.outcome === null && l.kind === 'regular');
    expect(weekly.length).toBeGreaterThanOrEqual(4);
    const [apologised, staffMoved, teacherMoved] = weekly;

    // An apology by the teacher, with its make-up booked by the family.
    await lessons.teacherApology(s.teacherId, apologised.id, { reason: 'medical appointment' });
    const makeupOffer = await scheduling.makeupSlots(s.parentId, apologised.id);
    await scheduling.bookMakeup(s.parentId, apologised.id, { startsAt: makeupOffer.slots[3] });
    // Moved by staff, and moved by the teacher.
    const staffOffer = await scheduling.moveSlots(tsupId, staffMoved.id);
    await scheduling.moveLesson(tsupId, staffMoved.id, { startsAt: staffOffer.slots.find((x) => !weekly.some((w) => w.startsAt.toISOString() === x)) });
    const teacherOffer = await scheduling.moveSlots(s.teacherId, teacherMoved.id);
    await scheduling.moveLesson(s.teacherId, teacherMoved.id, { startsAt: teacherOffer.slots.find((x) => !weekly.some((w) => w.startsAt.toISOString() === x)) });

    const before = await future();
    const openBefore = before.filter((l) => l.outcome === null).map((l) => `${l.id}@${l.startsAt.toISOString()}`).sort();
    const usedUp = [apologised, staffMoved, teacherMoved].map((l) => l.startsAt.getTime());

    await lifecycle.transfer(s.ownerId, s.learnerId, { toTeacherId: s.newTeacherId, reason: 'schedule_fit' });
    await lifecycle.transfer(s.ownerId, s.learnerId, { toTeacherId: s.teacherId, reason: 'other' });
    await scheduling.materialize();

    const after = await future();
    // The originals keep what happened to them.
    for (const l of [apologised, staffMoved, teacherMoved]) {
      expect(after.find((x) => x.id === l.id)?.outcome).toBe(before.find((x) => x.id === l.id)?.outcome);
    }
    // Nothing open, or newly closed, at a time that was used up.
    for (const at of usedUp) {
      expect(after.filter((x) => x.startsAt.getTime() === at).map((x) => x.id)).toEqual(
        before.filter((x) => x.startsAt.getTime() === at).map((x) => x.id),
      );
    }
    // The open lessons are the same rows at the same times: nothing re-created,
    // nothing closed and re-opened beside itself.
    expect(after.filter((l) => l.outcome === null).map((l) => `${l.id}@${l.startsAt.toISOString()}`).sort()).toEqual(openBefore);
    expect(after.filter((l) => l.outcomeNote === 'regular times changed')).toEqual([]);
    expect(after.filter((l) => l.outcome === null).every((l) => l.teacherId === s.teacherId)).toBe(true);
  });

  it('re-materialising after a transfer leaves an apologised, absent or moved occurrence alone, twice over', async () => {
    await scheduling.setSchedule(tsupId, s.learnerId, { slots: [{ weekday: await weekdayIn(2), start: '17:00', durationMinutes: 30 }] });
    const weekly = (await future()).filter((l) => l.outcome === null && l.kind === 'regular');
    expect(weekly.length).toBeGreaterThanOrEqual(3);
    const [apologised, absent, moved] = weekly;
    await lessons.teacherApology(s.teacherId, apologised.id, { reason: 'medical appointment' });
    // An absence is recorded after the start; a future one is set directly (synthetic).
    await g.prisma.$executeRawUnsafe(`update chat.lesson set outcome = 'student_no_show' where id = $1::uuid`, absent.id);
    const offer = await scheduling.moveSlots(tsupId, moved.id);
    await scheduling.moveLesson(tsupId, moved.id, { startsAt: offer.slots.find((x) => !weekly.some((w) => w.startsAt.toISOString() === x)) });

    await lifecycle.transfer(s.ownerId, s.learnerId, { toTeacherId: s.newTeacherId, reason: 'schedule_fit' });
    const settled = await future();
    await scheduling.materialize();
    await scheduling.materialize();
    const after = await future();

    for (const l of [apologised, absent, moved]) {
      expect(after.filter((x) => x.startsAt.getTime() === l.startsAt.getTime()).map((x) => x.id)).toEqual([l.id]);
    }
    // Running it again changes nothing at all.
    expect(after.map((l) => `${l.id}:${l.outcome}`)).toEqual(settled.map((l) => `${l.id}:${l.outcome}`));
  });

  it('a real change of the weekly time still re-creates its occurrences, once', async () => {
    const first = { weekday: await weekdayIn(2), start: '17:00', durationMinutes: 30 };
    await scheduling.setSchedule(tsupId, s.learnerId, { slots: [first] });
    const original = (await future()).filter((l) => l.outcome === null).map((l) => l.startsAt.getTime());
    expect(original.length).toBeGreaterThanOrEqual(2);

    // Away and back: the first change closes them as "regular times changed"
    // (no lesson continues them), so the second must create them again.
    await scheduling.setSchedule(tsupId, s.learnerId, { slots: [{ ...first, start: '19:00' }] });
    expect((await future()).filter((l) => l.outcome === null).some((l) => original.includes(l.startsAt.getTime()))).toBe(false);
    await scheduling.setSchedule(tsupId, s.learnerId, { slots: [first] });
    await scheduling.materialize();
    await scheduling.materialize();

    const open = (await future()).filter((l) => l.outcome === null).map((l) => l.startsAt.getTime());
    for (const at of original) expect(open.filter((x) => x === at)).toHaveLength(1);
  });

  it('CHATSCHED-008: the group says who left and who joined; the moved lessons are announced in the transfer', async () => {
    await scheduling.setSchedule(tsupId, s.learnerId, { slots: [{ weekday: await weekdayIn(3), start: '18:00', durationMinutes: 30 }] });
    const open = (await future()).filter((l) => l.outcome === null).map((l) => l.id);
    await g.prisma.outboxEvent.deleteMany({});
    await g.prisma.lessonChangeUnannounced.deleteMany({});

    await lifecycle.transfer(s.ownerId, s.learnerId, { toTeacherId: s.newTeacherId, reason: 'schedule_fit' });

    const membership = await g.prisma.outboxEvent.findMany({ where: { type: CommEvent.MEMBERSHIP_CHANGED } });
    expect(membership.map((e) => e.payload)).toContainEqual({ conversationId: groupId, added: [s.newTeacherId], removed: [s.teacherId] });
    const transferred = (await g.prisma.outboxEvent.findMany({ where: { type: CommEvent.LESSON_CHANGED } }))
      .map((e) => e.payload as { lessonId: string; change: string })
      .filter((p) => p.change === 'transferred')
      .map((p) => p.lessonId);
    expect(new Set(transferred)).toEqual(new Set(open));
    // Taken back by the transfer: nothing of these lessons is left for the sweep.
    expect(await g.prisma.lessonChangeUnannounced.findMany({ where: { lessonId: { in: open } } })).toEqual([]);
  });
});
