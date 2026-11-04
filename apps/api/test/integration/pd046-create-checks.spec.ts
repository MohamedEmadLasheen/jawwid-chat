/**
 * PD-46 PR-2c: a lesson someone adds by hand keeps to the rules the weekly
 * schedule and the free-time lists keep to, and a retried "Add lesson" is the
 * same lesson.
 *
 *   - TEACHER-API-002 / CHATSCHED-005: a one-off or make-up start in the past,
 *     or on one of the teacher's days off (an approved leave is its days off),
 *     is refused -- not created as an overdue lesson;
 *   - CHATSCHED-007: the same Idempotency-Key answers the lesson the first
 *     request created, concurrent or retried; another body under it is refused;
 *   - CHATSCHED-011: a move is offered times around the lesson's own date, and
 *     may land after it.
 *
 * Synthetic fixtures only (QA gate G-16).
 */
import { randomUUID } from 'node:crypto';
import { PrismaAuditService } from '@platform/audit.service';
import { CommError, CommErrorCode } from '@platform/errors';
import { LessonService } from '../../src/lessons/lesson.service';
import { SchedulingService } from '../../src/lessons/scheduling.service';
import { buildGraph, seed, truncate, Scenario } from './harness';

jest.setTimeout(180_000);

const g = buildGraph();
const audit = new PrismaAuditService();
const lessons = new LessonService(g.prisma, g.authz, g.conversations, g.outbox, g.config, audit);
const scheduling = new SchedulingService(g.prisma, g.authz, g.conversations, lessons, g.outbox, g.config, g.reminders, audit);

const TZ = 'Africa/Cairo';
const MIN = 60_000;
const DAY = 24 * 60 * MIN;
let s: Scenario;
let tsupId: string;

/** The Cairo calendar date `days` from today, and 10:00 that day as an instant. */
async function cairoDay(days: number): Promise<{ date: string; tenAm: Date }> {
  const [r] = await g.prisma.$queryRawUnsafe<Array<{ date: string; ten: Date }>>(
    `select ((now() at time zone '${TZ}')::date + ${days})::text as date,
            (((now() at time zone '${TZ}')::date + ${days})::timestamp + time '10:00') at time zone '${TZ}' as ten`,
  );
  return { date: r.date, tenAm: r.ten };
}
async function refusal(p: Promise<unknown>): Promise<{ code: string; message: string }> {
  const e = await p.then(() => null, (x: unknown) => x);
  expect(e).toBeInstanceOf(CommError);
  return { code: (e as CommError).code, message: (e as CommError).message };
}
const lessonsOf = (learnerId: string) => g.prisma.lesson.findMany({ where: { learnerId }, select: { id: true, startsAt: true } });

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
  await g.conversations.ensureStudentGroup(s.learnerId, s.ownerId);
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
  await scheduling.setAvailability(tsupId, s.teacherId, {
    timezone: TZ,
    windows: [1, 2, 3, 4, 5, 6, 7].map((weekday) => ({ weekday, start: '00:00', end: '24:00' })),
  });
}, TRUNCATING_HOOK_MS);

describe('TEACHER-API-002 / CHATSCHED-005: a lesson added by hand', () => {
  it('is refused in the past, and nothing is created', async () => {
    const startsAt = new Date(Date.now() - 10 * DAY);
    const r = await refusal(lessons.schedule(tsupId, {
      learnerId: s.learnerId, startsAt: startsAt.toISOString(), endsAt: new Date(startsAt.getTime() + 30 * MIN).toISOString(),
    }));
    expect(r).toEqual({ code: CommErrorCode.LESSON_STATE, message: 'a lesson is scheduled in the future' });
    expect(await lessonsOf(s.learnerId)).toEqual([]);
  });

  it('is refused on a day off of the teacher, one-off or make-up, and fine the day after', async () => {
    const off = await cairoDay(5);
    await scheduling.addDayOff(tsupId, s.teacherId, { date: off.date, reason: 'leave' });
    const body = (startsAt: Date) => ({
      learnerId: s.learnerId, startsAt: startsAt.toISOString(), endsAt: new Date(startsAt.getTime() + 30 * MIN).toISOString(),
    });
    expect((await refusal(lessons.schedule(tsupId, body(off.tenAm)))).message).toBe("that is one of the teacher's days off; agree on another day");

    const ok = await lessons.schedule(tsupId, body(new Date(off.tenAm.getTime() + DAY)));
    expect(new Date(ok.startsAt).getTime()).toBe(off.tenAm.getTime() + DAY);
    // A make-up for it, booked by hand on the day off, is refused the same way.
    await lessons.teacherApology(s.teacherId, ok.id, { reason: 'medical appointment' });
    const makeup = await refusal(lessons.schedule(tsupId, { ...body(new Date(off.tenAm.getTime() + 2 * 60 * MIN)), makeupFor: ok.id }));
    expect(makeup.message).toBe("that is one of the teacher's days off; agree on another day");
    expect(await lessonsOf(s.learnerId)).toHaveLength(1);
  });
});

describe('CHATSCHED-007: the same Idempotency-Key is the same lesson', () => {
  const body = (startsAt: Date) => ({
    learnerId: s.learnerId, startsAt: startsAt.toISOString(), endsAt: new Date(startsAt.getTime() + 30 * MIN).toISOString(),
  });

  it('three at once and a retry answer one lesson; another body under the key is refused', async () => {
    const { tenAm } = await cairoDay(3);
    const key = `add-${randomUUID()}`;
    const answers = await Promise.all([1, 2, 3].map(() => lessons.schedule(tsupId, body(tenAm), key)));
    const retry = await lessons.schedule(tsupId, body(tenAm), key);
    const ids = new Set([...answers, retry].map((a) => a.id));
    expect(ids.size).toBe(1);
    expect(await lessonsOf(s.learnerId)).toHaveLength(1);
    // One lesson, so one card and one announcement -- not one per request.
    const [lessonId] = [...ids];
    expect(await g.prisma.messageCard.count({ where: { lessonId, kind: 'lesson_scheduled' } })).toBe(1);

    const other = await refusal(lessons.schedule(tsupId, body(new Date(tenAm.getTime() + 60 * MIN)), key));
    expect(other).toEqual({ code: CommErrorCode.LESSON_STATE, message: 'this Idempotency-Key was used for another lesson; use a new key' });
    expect(await lessonsOf(s.learnerId)).toHaveLength(1);
  });

  it('without a key, a second request is still refused as an overlap (unchanged)', async () => {
    const { tenAm } = await cairoDay(3);
    await lessons.schedule(tsupId, body(tenAm));
    expect((await refusal(lessons.schedule(tsupId, body(tenAm)))).code).toBe(CommErrorCode.LESSON_TEACHER_BUSY);
  });

  it('a malformed key is refused before anything is written', async () => {
    const { tenAm } = await cairoDay(3);
    expect((await refusal(lessons.schedule(tsupId, body(tenAm), 'has space'))).code).toBe(CommErrorCode.VALIDATION);
    expect(await lessonsOf(s.learnerId)).toEqual([]);
  });
});

describe('CHATSCHED-011: a move is offered times around the lesson itself', () => {
  it('a lesson three weeks out may move to the day after it', async () => {
    const { tenAm } = await cairoDay(21);
    const lesson = await lessons.schedule(tsupId, {
      learnerId: s.learnerId, startsAt: tenAm.toISOString(), endsAt: new Date(tenAm.getTime() + 30 * MIN).toISOString(),
    });
    const offer = await scheduling.moveSlots(s.teacherId, lesson.id);
    const times = offer.slots.map((x) => new Date(x).getTime());
    const horizon = Number(await g.config.get('lesson.makeup_horizon_days'));
    // Around its own date, the horizon either side -- not now .. now + horizon.
    expect(Math.max(...times)).toBeGreaterThan(tenAm.getTime());
    expect(Math.max(...times)).toBeLessThanOrEqual(tenAm.getTime() + horizon * DAY);
    expect(Math.min(...times)).toBeGreaterThanOrEqual(tenAm.getTime() - horizon * DAY);

    const dayAfter = tenAm.getTime() + DAY;
    expect(times).toContain(dayAfter);
    const moved = await scheduling.moveLesson(s.teacherId, lesson.id, { startsAt: new Date(dayAfter).toISOString() });
    expect(new Date(moved.startsAt).getTime()).toBe(dayAfter);
  });

  it('a lesson near now keeps the whole horizon from now', async () => {
    const { tenAm } = await cairoDay(2);
    const lesson = await lessons.schedule(tsupId, {
      learnerId: s.learnerId, startsAt: tenAm.toISOString(), endsAt: new Date(tenAm.getTime() + 30 * MIN).toISOString(),
    });
    const times = (await scheduling.moveSlots(s.teacherId, lesson.id)).slots.map((x) => new Date(x).getTime());
    const lead = Number(await g.config.get('lesson.booking_lead_minutes'));
    expect(Math.min(...times)).toBeGreaterThanOrEqual(Date.now() + lead * MIN - MIN);
    expect(Math.min(...times)).toBeLessThan(tenAm.getTime());
  });
});
