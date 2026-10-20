/**
 * PD-11 T2 -- availability, regular times, make-ups, regular-time change
 * requests, the make-up follow-up and lesson reminders.
 *
 *   1. availability: the Teachers department sets it; a teacher reads their own
 *   2. regular times become lessons (materialized, idempotent)
 *   3. a family books the make-up a teacher-cancelled lesson owes -- instantly,
 *      only into a real free time, only once
 *   4. the follow-up: an unreplaced teacher-cancelled lesson reaches the queue;
 *      the supervisor's action is recorded and Core is told
 *   5. a family asks for new regular times; a supervisor approves and the
 *      schedule changes in one step
 *   6. reminders: scheduled once, never late, cancelled with the lesson
 *
 * Synthetic fixtures only (QA gate G-16).
 */
import { randomUUID } from 'node:crypto';
import { PrismaAuditService } from '@platform/audit.service';
import { AppConfigService } from '@platform/app-config.service';
import { CommError, CommErrorCode } from '@platform/errors';
import { LessonService } from '../../src/lessons/lesson.service';
import { SchedulingService } from '../../src/lessons/scheduling.service';
import { buildGraph, seed, truncate, withAssignmentGate, Scenario } from './harness';

const g = buildGraph();
const audit = new PrismaAuditService();
const lessons = new LessonService(g.prisma, g.authz, g.conversations, g.outbox, g.config, audit);
const scheduling = new SchedulingService(g.prisma, g.authz, g.conversations, lessons, g.outbox, g.config, g.reminders, audit);

const TZ = 'Africa/Cairo';
const HOUR = 3_600_000;
const at = (ms: number) => new Date(Date.now() + ms).toISOString();

let s: Scenario;
let groupId: string;
let tsupId: string;
/** A third child of family_x, taught by teacher_c too: the "other learner" of the same teacher. */
let siblingId: string;

async function code(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (e) {
    if (e instanceof CommError) return e.code;
    throw e;
  }
  throw new Error('expected a refusal, got success');
}

/** ISO weekday of the day after tomorrow in the teacher's zone -- safely in the future. */
async function weekdayIn(days: number): Promise<number> {
  const [{ d }] = await g.prisma.$queryRawUnsafe<Array<{ d: number }>>(
    `select extract(isodow from (now() at time zone '${TZ}')::date + ${days})::int as d`,
  );
  return d;
}

/** teacher_c works every day, all day: free time is decided only by lessons and days off. */
async function openAllWeek() {
  await scheduling.setAvailability(tsupId, s.teacherId, {
    timezone: TZ,
    windows: [1, 2, 3, 4, 5, 6, 7].map((weekday) => ({ weekday, start: '00:00', end: '24:00' })),
  });
}

async function cards() {
  return g.prisma.message.findMany({ where: { conversationId: groupId, type: 'card' }, include: { card: true }, orderBy: { seq: 'asc' } });
}

beforeAll(async () => {
  await g.prisma.$connect();
});
afterAll(async () => {
  await truncate(g.prisma);
  await g.prisma.$executeRawUnsafe(`delete from chat.config where key like 'lesson.%'`);
  await g.prisma.$disconnect();
});
beforeEach(async () => {
  await truncate(g.prisma);
  await g.prisma.$executeRawUnsafe(`delete from chat.config where key like 'lesson.%'`);
  await g.prisma.$executeRawUnsafe(`update chat.notification set status = status where false`);
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
  siblingId = randomUUID();
  await withAssignmentGate(
    g.prisma,
    `insert into chat.learner (id, family_id, name, teacher_id) values ('${siblingId}'::uuid, '${s.familyId}'::uuid, 'learner_n', '${s.teacherId}'::uuid)`,
  );
});

describe('1. availability', () => {
  it('the Teachers department sets it; the teacher reads their own; nobody else touches it', async () => {
    const dto = await scheduling.setAvailability(tsupId, s.teacherId, {
      timezone: TZ,
      windows: [{ weekday: 1, start: '16:00', end: '20:00' }, { weekday: 3, start: '09:00', end: '12:30' }],
    });
    expect(dto.timezone).toBe(TZ);
    expect(dto.windows).toEqual([
      { weekday: 1, start: '16:00', end: '20:00' },
      { weekday: 3, start: '09:00', end: '12:30' },
    ]);
    expect((await scheduling.availability(s.teacherId, 'me')).windows).toHaveLength(2);
    expect(await code(scheduling.availability(s.parentId, s.teacherId))).toBe(CommErrorCode.LESSON_DENIED);
    expect(await code(scheduling.setAvailability(s.teacherId, s.teacherId, { timezone: TZ, windows: [] }))).toBe(CommErrorCode.LESSON_DENIED);
    expect(await code(scheduling.availability(s.unrelatedTeacherId, s.teacherId))).toBe(CommErrorCode.LESSON_DENIED);
  });

  it('refuses overlapping windows and an unknown time zone', async () => {
    expect(await code(scheduling.setAvailability(tsupId, s.teacherId, {
      timezone: TZ, windows: [{ weekday: 1, start: '10:00', end: '12:00' }, { weekday: 1, start: '11:00', end: '13:00' }],
    }))).toBe(CommErrorCode.VALIDATION);
    expect(await code(scheduling.setAvailability(tsupId, s.teacherId, {
      timezone: 'Mars/Olympus', windows: [{ weekday: 1, start: '10:00', end: '12:00' }],
    }))).toBe(CommErrorCode.VALIDATION);
  });
});

describe('2. regular times become lessons', () => {
  it('needs the teacher\'s availability, refuses a taken time, and materializes ~4 weeks idempotently', async () => {
    const wd = await weekdayIn(2);
    expect(await code(scheduling.setSchedule(tsupId, s.learnerId, { slots: [{ weekday: wd, start: '17:00', durationMinutes: 30 }] })))
      .toBe(CommErrorCode.LESSON_STATE);
    await openAllWeek();

    await scheduling.setSchedule(tsupId, siblingId, { slots: [{ weekday: wd, start: '17:00', durationMinutes: 30 }] });
    // The sibling holds 17:00; the same teacher cannot give it to learner_l too.
    expect(await code(scheduling.setSchedule(tsupId, s.learnerId, { slots: [{ weekday: wd, start: '17:15', durationMinutes: 30 }] })))
      .toBe(CommErrorCode.LESSON_STATE);

    const dto = await scheduling.setSchedule(tsupId, s.learnerId, { slots: [{ weekday: wd, start: '18:00', durationMinutes: 30 }] });
    expect(dto.slots).toEqual([expect.objectContaining({ weekday: wd, start: '18:00', durationMinutes: 30 })]);
    const made = await g.prisma.lesson.count({ where: { learnerId: s.learnerId, scheduleSlotId: { not: null } } });
    expect(made).toBeGreaterThanOrEqual(4);
    expect(made).toBeLessThanOrEqual(5);
    expect(await scheduling.materialize()).toBe(0);

    // Each materialized lesson is at 18:00 Cairo time.
    const first = await g.prisma.lesson.findFirstOrThrow({ where: { learnerId: s.learnerId }, orderBy: { startsAt: 'asc' } });
    const [{ local }] = await g.prisma.$queryRawUnsafe<Array<{ local: string }>>(
      `select to_char($1::timestamptz at time zone '${TZ}', 'HH24:MI') as local`, first.startsAt,
    );
    expect(local).toBe('18:00');
    expect(first.createdByKind).toBe('system');
  });
});

describe('2b. a teacher\'s day off', () => {
  it('no regular lesson is generated on it, however far ahead it was recorded', async () => {
    await openAllWeek();
    const [{ d, wd }] = await g.prisma.$queryRawUnsafe<Array<{ d: string; wd: number }>>(
      `select to_char((now() at time zone '${TZ}')::date + 9, 'YYYY-MM-DD') as d,
              extract(isodow from (now() at time zone '${TZ}')::date + 9)::int as wd`,
    );
    await scheduling.addDayOff(tsupId, s.teacherId, { date: d, reason: 'leave' });
    await scheduling.setSchedule(tsupId, s.learnerId, { slots: [{ weekday: wd, start: '18:00', durationMinutes: 30 }] });
    const days = await g.prisma.$queryRawUnsafe<Array<{ day: string }>>(
      `select to_char(starts_at at time zone '${TZ}', 'YYYY-MM-DD') as day from chat.lesson where learner_id = $1::uuid`, s.learnerId,
    );
    expect(days.length).toBeGreaterThanOrEqual(3);
    expect(days.map((x) => x.day)).not.toContain(d);
  });
});

describe('3. the make-up a family books', () => {
  it('is offered only after the teacher cancelled, only in real free time, and booked instantly once', async () => {
    await openAllWeek();
    const id = (await lessons.schedule(tsupId, { learnerId: s.learnerId, startsAt: at(48 * HOUR), endsAt: at(48.5 * HOUR) })).id;
    // Nothing is owed yet.
    expect(await code(scheduling.makeupSlots(s.parentId, id))).toBe(CommErrorCode.LESSON_STATE);

    await lessons.teacherApology(s.teacherId, id, { reason: 'ill' });
    const tickets = await lessons.ticketsFor(s.parentId, groupId);
    expect(tickets.tickets.filter((t) => t.ticket === 'book_makeup').map((t) => t.lessonId)).toEqual([id]);

    const offered = await scheduling.makeupSlots(s.parentId, id);
    expect(offered.durationMinutes).toBe(30);
    expect(offered.slots.length).toBeGreaterThan(100);
    // A time the teacher is busy is not offered: the sibling's lesson.
    const busyAt = new Date(offered.slots[10]);
    await lessons.schedule(tsupId, { learnerId: siblingId, startsAt: busyAt.toISOString(), endsAt: new Date(busyAt.getTime() + 30 * 60_000).toISOString() });
    const after = await scheduling.makeupSlots(s.parentId, id);
    expect(after.slots).not.toContain(busyAt.toISOString());
    expect(await code(scheduling.bookMakeup(s.parentId, id, { startsAt: busyAt.toISOString() }))).toBe(CommErrorCode.LESSON_STATE);

    const booked = await scheduling.bookMakeup(s.parentId, id, { startsAt: after.slots[20] });
    expect(booked.kind).toBe('makeup');
    expect(booked.makeupFor).toBe(id);
    const made = await g.prisma.lesson.findUniqueOrThrow({ where: { id: booked.id } });
    expect(made.createdByKind).toBe('contact');
    expect((await cards()).map((c) => c.card?.kind)).toEqual(['lesson_teacher_apology', 'lesson_makeup_booked']);

    // Once replaced, nothing more is owed.
    expect(await code(scheduling.bookMakeup(s.parentId, id, { startsAt: after.slots[30] }))).toBe(CommErrorCode.LESSON_STATE);
    expect((await lessons.ticketsFor(s.parentId, groupId)).tickets.some((t) => t.ticket === 'book_makeup')).toBe(false);
  });

  it('a day off removes the day; a teacher records an agreed time but never on a day off; a student apology owes a make-up too (PD-15); the database refuses a make-up nobody owed', async () => {
    await openAllWeek();
    const id = (await lessons.schedule(tsupId, { learnerId: s.learnerId, startsAt: at(48 * HOUR), endsAt: at(48.5 * HOUR) })).id;
    await lessons.teacherApology(s.teacherId, id, { reason: 'ill' });
    const [{ d }] = await g.prisma.$queryRawUnsafe<Array<{ d: string }>>(
      `select to_char((now() at time zone '${TZ}')::date + 3, 'YYYY-MM-DD') as d`,
    );
    await scheduling.addDayOff(tsupId, s.teacherId, { date: d, reason: 'leave' });
    const offered = await scheduling.makeupSlots(s.parentId, id);
    const onDayOff = await g.prisma.$queryRawUnsafe<Array<{ n: bigint }>>(
      `select count(*) as n from unnest($1::timestamptz[]) t where (t at time zone '${TZ}')::date = $2::date`,
      offered.slots, d,
    );
    expect(Number(onDayOff[0].n)).toBe(0);
    // PD-15: the teacher records the time agreed with the family -- not on a day off.
    const [{ t }] = await g.prisma.$queryRawUnsafe<Array<{ t: Date }>>(
      `select (($1::date + time '10:00') at time zone '${TZ}') as t`, d,
    );
    expect(await code(scheduling.bookMakeup(s.teacherId, id, { startsAt: t.toISOString() }))).toBe(CommErrorCode.LESSON_STATE);
    const booked = await scheduling.bookMakeup(s.teacherId, id, { startsAt: offered.slots[0] });
    expect((await g.prisma.lesson.findUniqueOrThrow({ where: { id: booked.id } })).createdByKind).toBe('teacher');

    // A family's own apology owes a make-up too, and its "+" offers it.
    const apologised = (await lessons.schedule(tsupId, { learnerId: s.learnerId, startsAt: at(72 * HOUR), endsAt: at(72.5 * HOUR) })).id;
    await lessons.apology(s.parentId, apologised, { reason: 'travel' });
    expect((await lessons.ticketsFor(s.parentId, groupId)).tickets.some((x) => x.ticket === 'book_makeup' && x.lessonId === apologised)).toBe(true);

    // A lesson that owes nothing (still open) cannot be "replaced" by a family.
    const open = (await lessons.schedule(tsupId, { learnerId: s.learnerId, startsAt: at(96 * HOUR), endsAt: at(96.5 * HOUR) })).id;
    await expect(g.prisma.$executeRawUnsafe(
      `insert into chat.lesson (learner_id, teacher_id, kind, makeup_for, starts_at, ends_at, created_by_kind, created_by)
       values ($1::uuid, $2::uuid, 'makeup', $3::uuid, now() + interval '5 days', now() + interval '5 days 30 minutes', 'contact', $4::uuid)`,
      s.learnerId, s.teacherId, open, s.parentId,
    )).rejects.toThrow(/only the make-up an apologised or teacher-cancelled lesson owes/);
  });
});

describe('4. the make-up follow-up', () => {
  it('an unreplaced teacher-cancelled lesson reaches the queue; the supervisor\'s action is recorded and Core is told', async () => {
    await g.prisma.$executeRawUnsafe(`insert into chat.config (key, value) values ('lesson.makeup_window_days', '0'::jsonb)`);
    const config = new AppConfigService(g.prisma);
    const now0 = new LessonService(g.prisma, g.authz, g.conversations, g.outbox, config, audit);
    const sched0 = new SchedulingService(g.prisma, g.authz, g.conversations, now0, g.outbox, config, g.reminders, audit);

    const id = (await now0.schedule(tsupId, { learnerId: s.learnerId, startsAt: at(48 * HOUR), endsAt: at(48.5 * HOUR) })).id;
    await now0.teacherApology(s.teacherId, id, { reason: 'ill' });
    const queue = await now0.needsAction(tsupId);
    expect(queue.makeupsOverdue.map((l) => l.id)).toEqual([id]);

    expect(await code(sched0.resolveMakeup(s.teacherId, id, { action: 'family_credit' }))).toBe(CommErrorCode.LESSON_DENIED);
    expect(await code(sched0.resolveMakeup(tsupId, id, { action: 'refund_in_cash' }))).toBe(CommErrorCode.VALIDATION);
    await sched0.resolveMakeup(tsupId, id, { action: 'family_credit', note: 'family preferred credit' });

    const ruling = await g.prisma.lessonRuling.findFirstOrThrow({ where: { lessonId: id, kind: 'makeup_followup' } });
    expect(ruling.decision).toBe('family_credit');
    expect((await now0.needsAction(tsupId)).makeupsOverdue).toEqual([]);
    expect(await code(sched0.makeupSlots(s.parentId, id))).toBe(CommErrorCode.LESSON_STATE);
    const core = await g.prisma.outboxEvent.findMany({ where: { type: 'lesson.makeup_resolved' } });
    expect(core.map((e) => e.payload)).toEqual([expect.objectContaining({ lessonId: id, action: 'family_credit', durationMinutes: 30 })]);
    expect((await cards()).map((c) => c.card?.kind)).toContain('lesson_makeup_resolved');
  });
});

describe('5. a family asks for new regular times', () => {
  it('offers only free times, files one request, and an approval moves the schedule in one step', async () => {
    await openAllWeek();
    const wd = await weekdayIn(2);
    await scheduling.setSchedule(tsupId, siblingId, { slots: [{ weekday: wd, start: '17:00', durationMinutes: 30 }] });
    await scheduling.setSchedule(tsupId, s.learnerId, { slots: [{ weekday: wd, start: '18:00', durationMinutes: 30 }] });
    const oldLessons = await g.prisma.lesson.findMany({ where: { learnerId: s.learnerId, outcome: null } });

    const options = await scheduling.scheduleOptions(s.parentId, s.learnerId);
    const starts = options.options.filter((o) => o.weekday === wd).map((o) => o.start);
    expect(starts).not.toContain('17:00'); // the sibling's
    expect(starts).toContain('18:00'); // their own current time stays offered
    expect(starts).toContain('19:00');

    expect((await lessons.ticketsFor(s.parentId, groupId)).tickets.some((t) => t.ticket === 'request_schedule_change')).toBe(true);
    expect(await code(scheduling.requestScheduleChange(s.parentId, s.learnerId, { slots: [{ weekday: wd, start: '17:00' }] })))
      .toBe(CommErrorCode.LESSON_STATE);
    expect(await code(scheduling.requestScheduleChange(s.teacherId, s.learnerId, { slots: [{ weekday: wd, start: '19:00' }] })))
      .toBe(CommErrorCode.LESSON_DENIED);
    const req = await scheduling.requestScheduleChange(s.parentId, s.learnerId, { slots: [{ weekday: wd, start: '19:00' }], note: 'school ends later' });
    expect(req.status).toBe('pending');
    expect(await code(scheduling.requestScheduleChange(s.parentId, s.learnerId, { slots: [{ weekday: wd, start: '19:30' }] })))
      .toBe(CommErrorCode.LESSON_STATE);
    expect((await lessons.ticketsFor(s.parentId, groupId)).tickets.some((t) => t.ticket === 'request_schedule_change')).toBe(false);
    expect((await lessons.needsAction(tsupId)).scheduleRequests.map((r) => r.id)).toEqual([req.id]);

    expect(await code(scheduling.decideScheduleChange(s.ownerId, req.id, { decision: 'approved' }))).toBe(CommErrorCode.LESSON_DENIED);
    await scheduling.decideScheduleChange(tsupId, req.id, { decision: 'approved', note: 'fine' });

    const now = (await scheduling.schedule(s.parentId, s.learnerId));
    expect(now.slots.map((x) => x.start)).toEqual(['19:00']);
    expect(now.pendingRequest).toBeNull();
    const moved = await g.prisma.lesson.findMany({ where: { id: { in: oldLessons.map((l) => l.id) } } });
    expect(moved.every((l) => l.outcome === 'rescheduled')).toBe(true);
    const fresh = await g.prisma.lesson.findMany({ where: { learnerId: s.learnerId, outcome: null } });
    expect(fresh.length).toBeGreaterThanOrEqual(4);
    expect((await cards()).map((c) => c.card?.kind)).toEqual(['schedule_change_requested', 'schedule_change_decided']);
  });
});

describe('6. reminders', () => {
  it('are scheduled once, never late, and cancelled when the lesson will not happen', async () => {
    const id = (await lessons.schedule(tsupId, { learnerId: s.learnerId, startsAt: at(3 * HOUR), endsAt: at(3.5 * HOUR) })).id;
    expect(await scheduling.scheduleDueReminders()).toBe(1);
    expect(await scheduling.scheduleDueReminders()).toBe(0);
    const rows = await g.prisma.notification.findMany({ where: { dedupeKey: { contains: `:${id}:` } } });
    // 24 h before has already passed: skipped, not sent late.
    expect(rows.map((r) => `${r.ruleKey}>${r.recipientId === s.teacherId ? 'teacher' : 'parent'}`).sort()).toEqual([
      'lesson_parent_t30m>parent',
      'lesson_parent_t30m>parent',
      'lesson_teacher_t15m>teacher',
    ]);
    await lessons.apology(s.parentId, id, { reason: 'travel' });
    const after = await g.prisma.notification.findMany({ where: { dedupeKey: { contains: `:${id}:` } } });
    expect(after.every((r) => r.status === 'cancelled')).toBe(true);
  });
});

describe('7. the roster the Schedules tab reads', () => {
  it('gives the Teachers department every teacher (with zone) and learner (with regular times); nobody else', async () => {
    await openAllWeek();
    const wd = await weekdayIn(2);
    await scheduling.setSchedule(tsupId, s.learnerId, { slots: [{ weekday: wd, start: '18:00', durationMinutes: 30 }] });
    const r = await scheduling.roster(tsupId);
    expect(r.teachers.find((t) => t.id === s.teacherId)).toMatchObject({ timezone: TZ, isActive: true });
    expect(r.teachers.find((t) => t.id === s.newTeacherId)?.timezone).toBeNull();
    const l = r.learners.find((x) => x.id === s.learnerId)!;
    expect(l).toMatchObject({ teacherId: s.teacherId, suspension: null, slots: [{ weekday: wd, start: '18:00', durationMinutes: 30 }] });
    expect(l.family.id).toBe(s.familyId);
    expect(await code(scheduling.roster(s.ownerId))).toBe(CommErrorCode.LESSON_DENIED);
    expect(await code(scheduling.roster(s.teacherId))).toBe(CommErrorCode.LESSON_DENIED);
  });
});
