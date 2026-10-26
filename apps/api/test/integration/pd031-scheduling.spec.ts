/**
 * PD-31 -- moving lessons, changing weekly times and changing the teacher, with
 * nothing lost silently.
 *
 *   1. one lesson moves at once: the old row is rescheduled, the new one names
 *      it, a card is posted; it is never an apology or a violation; the family
 *      moves a lesson once and a child's lessons a few times a month; the
 *      materializer never brings a moved weekly lesson back
 *   2. weekly times: the options show the current times and the weeks a time
 *      would be skipped; a teacher may ask too; the approver sees a request
 *      that is no longer free BEFORE approving
 *   3. a weekly lesson the teacher's other lesson blocks is recorded and shown
 *      in Needs action -- scheduled elsewhere, dismissed, or cleared by itself
 *   4. changing the teacher: the child's PD-8 supervisor and the Operations
 *      Manager may; times the new teacher is not free at are refused, never
 *      dropped; new times apply in the same transaction; a group's children
 *      move together
 *   5. the "Change lesson time" ticket; the payment lock (PD-30) refuses
 *
 * Synthetic fixtures only (QA gate G-16).
 */
import { randomUUID } from 'node:crypto';
import { PrismaAuditService } from '@platform/audit.service';
import { CommError, CommErrorCode } from '@platform/errors';
import { LessonService } from '../../src/lessons/lesson.service';
import { SchedulingService } from '../../src/lessons/scheduling.service';
import { LifecycleService } from '../../src/lessons/lifecycle.service';
import { StatsService } from '../../src/lessons/stats.service';
import { SupervisionConversationService } from '../../src/supervision/supervision-conversation.service';
import { buildGraph, seed, truncate, Scenario } from './harness';

const g = buildGraph();
const audit = new PrismaAuditService();
const lessons = new LessonService(g.prisma, g.authz, g.conversations, g.outbox, g.config, audit);
const scheduling = new SchedulingService(g.prisma, g.authz, g.conversations, lessons, g.outbox, g.config, g.reminders, audit);
const supervisionChats = new SupervisionConversationService(g.prisma, g.authz, g.conversations, g.outbox, audit);
const lifecycle = new LifecycleService(g.prisma, g.conversations, lessons, scheduling, g.outbox, g.config, audit, supervisionChats);
const stats = new StatsService(g.prisma, g.conversations, lessons, scheduling, g.config);

const TZ = 'Africa/Cairo';
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const at = (ms: number) => new Date(Date.now() + ms).toISOString();

let s: Scenario;
let groupId: string;
let tsupId: string;

async function refusal(p: Promise<unknown>): Promise<{ code: string; message: string }> {
  try {
    await p;
  } catch (e) {
    if (e instanceof CommError) return { code: e.code, message: e.message };
    throw e;
  }
  throw new Error('expected a refusal, got success');
}
const code = async (p: Promise<unknown>) => (await refusal(p)).code;

async function weekdayIn(days: number): Promise<number> {
  const [{ d }] = await g.prisma.$queryRawUnsafe<Array<{ d: number }>>(
    `select extract(isodow from (now() at time zone '${TZ}')::date + ${days})::int as d`,
  );
  return d;
}

async function localDate(days: number): Promise<string> {
  const [{ d }] = await g.prisma.$queryRawUnsafe<Array<{ d: string }>>(
    `select to_char((now() at time zone '${TZ}')::date + ${days}, 'YYYY-MM-DD') as d`,
  );
  return d;
}

/** The instant of `HH:MM` Cairo time `days` from today. */
async function cairo(days: number, hhmm: string): Promise<Date> {
  const [{ t }] = await g.prisma.$queryRawUnsafe<Array<{ t: Date }>>(
    `select (((now() at time zone '${TZ}')::date + ${days}) + '${hhmm}'::time) at time zone '${TZ}' as t`,
  );
  return t;
}

async function openAllWeek(teacherId: string) {
  await scheduling.setAvailability(tsupId, teacherId, {
    timezone: TZ,
    windows: [1, 2, 3, 4, 5, 6, 7].map((weekday) => ({ weekday, start: '00:00', end: '24:00' })),
  });
}

async function cards(conversationId = groupId) {
  return g.prisma.message.findMany({ where: { conversationId, type: 'card' }, include: { card: true }, orderBy: { seq: 'asc' } });
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
  jest.restoreAllMocks();
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
});

describe('1. one lesson moves', () => {
  it('at once: the old row is rescheduled, the new one names it, the group reads a card -- no apology, no violation', async () => {
    const id = (await lessons.schedule(tsupId, { learnerId: s.learnerId, startsAt: at(3 * DAY), endsAt: at(3 * DAY + HOUR / 2) })).id;
    const offer = await scheduling.moveSlots(s.parentId, id);
    expect(offer.refusal).toBeNull();
    expect(offer.locked).toBeNull();
    expect(offer.familyMovesLeft).toBe(4);
    expect(offer.slots.length).toBeGreaterThan(50);

    const moved = await scheduling.moveLesson(s.parentId, id, { startsAt: offer.slots[30] });
    expect(moved.movedFrom).toBe(id);
    expect(moved.movedBy).toBe('family');
    expect(moved.startsAt).toBe(offer.slots[30]);
    expect(moved.kind).toBe('regular');

    const old = await lessons.get(tsupId, id);
    expect(old.outcome).toBe('rescheduled');
    expect(old.movedTo).toBe(offer.slots[30]);
    const card = (await cards()).find((m) => m.card?.kind === 'lesson_moved');
    expect(card?.card?.payload).toEqual(expect.objectContaining({ previousStartsAt: old.startsAt, startsAt: moved.startsAt, movedBy: 'family' }));
    expect(await g.prisma.teacherViolation.count({ where: { teacherId: s.teacherId } })).toBe(0);

    // Once per lesson for the family -- the supervisor may still move it.
    expect((await scheduling.moveSlots(s.parentId, moved.id)).refusal).toBe('family_already_moved');
    expect(await code(scheduling.moveLesson(s.parentId, moved.id, { startsAt: offer.slots[40] }))).toBe(CommErrorCode.LESSON_STATE);
    const again = await scheduling.moveLesson(s.ownerId, moved.id, { startsAt: offer.slots[40] });
    expect(again.movedBy).toBe('staff');
    // ... and the family still may not: the chain was moved by the family once.
    expect((await scheduling.moveSlots(s.parentId, again.id)).refusal).toBe('family_already_moved');
  });

  it('refuses the family a time that is not free, too close to the start, and beyond the monthly limit', async () => {
    const soon = (await lessons.schedule(tsupId, { learnerId: s.learnerId, startsAt: at(HOUR), endsAt: at(1.5 * HOUR) })).id;
    expect((await scheduling.moveSlots(s.parentId, soon)).refusal).toBe('too_late');
    // Staff may still move it.
    expect((await scheduling.moveSlots(tsupId, soon)).refusal).toBeNull();

    // AppConfigService caches a value for 30 s, so an inserted override could be
    // hidden by the default an earlier test read; answer this one key directly.
    const get = g.config.get.bind(g.config) as (key: string) => Promise<unknown>;
    jest.spyOn(g.config, 'get').mockImplementation((async (key: string) => (key === 'lesson.family_moves_per_month' ? 1 : get(key))) as never);
    const a = (await lessons.schedule(tsupId, { learnerId: s.learnerId, startsAt: at(4 * DAY), endsAt: at(4 * DAY + HOUR / 2) })).id;
    const b = (await lessons.schedule(tsupId, { learnerId: s.learnerId, startsAt: at(5 * DAY), endsAt: at(5 * DAY + HOUR / 2) })).id;
    const busy = (await lessons.schedule(tsupId, { learnerId: s.learnerId, startsAt: at(6 * DAY), endsAt: at(6 * DAY + HOUR / 2) })).startsAt;
    expect(await code(scheduling.moveLesson(s.parentId, a, { startsAt: busy }))).toBe(CommErrorCode.LESSON_STATE);
    const offer = await scheduling.moveSlots(s.parentId, a);
    await scheduling.moveLesson(s.parentId, a, { startsAt: offer.slots[5] });
    const second = await scheduling.moveSlots(s.parentId, b);
    expect(second.refusal).toBe('family_monthly_limit');
    expect(second.familyMovesLeft).toBe(0);
    expect(second.slots).toEqual([]);
  });

  it('a teacher\'s move is shown in their month, not counted against them', async () => {
    const id = (await lessons.schedule(tsupId, { learnerId: s.learnerId, startsAt: at(3 * DAY), endsAt: at(3 * DAY + HOUR / 2) })).id;
    const offer = await scheduling.moveSlots(s.teacherId, id);
    expect(offer.familyMovesLeft).toBeNull();
    const moved = await scheduling.moveLesson(s.teacherId, id, { startsAt: offer.slots[12] });
    expect(moved.movedBy).toBe('teacher');
    expect((await stats.mine(s.teacherId)).movesByTeacher).toBe(1);
    expect((await stats.teacher(tsupId, s.teacherId)).movesByTeacher).toBe(1);
    expect(await g.prisma.teacherViolation.count({ where: { teacherId: s.teacherId } })).toBe(0);
    // A stranger may not move it.
    expect(await code(scheduling.moveSlots(s.unrelatedTeacherId, moved.id))).toBe(CommErrorCode.LESSON_NOT_FOUND);
  });

  it('a weekly lesson moved away is never re-created at its old time', async () => {
    const wd = await weekdayIn(3);
    await scheduling.setSchedule(tsupId, s.learnerId, { slots: [{ weekday: wd, start: '18:00', durationMinutes: 30 }] });
    const first = await g.prisma.lesson.findFirstOrThrow({ where: { learnerId: s.learnerId, scheduleSlotId: { not: null } }, orderBy: { startsAt: 'asc' } });
    const offer = await scheduling.moveSlots(s.parentId, first.id);
    await scheduling.moveLesson(s.parentId, first.id, { startsAt: offer.slots[3] });
    expect(await scheduling.materialize()).toBe(0);
    const atOldTime = await g.prisma.lesson.findMany({ where: { scheduleSlotId: first.scheduleSlotId, startsAt: first.startsAt } });
    expect(atOldTime.map((l) => l.outcome)).toEqual(['rescheduled']);
    // Not a blocked lesson either: it was moved, not lost.
    await scheduling.collectBlocked();
    expect(await g.prisma.lessonBlockedOccurrence.count()).toBe(0);
  });
});

describe('2. weekly times', () => {
  it('options carry the current times and the weeks a time would be skipped', async () => {
    const wd = await weekdayIn(3);
    await scheduling.setSchedule(tsupId, s.learnerId, { slots: [{ weekday: wd, start: '17:00', durationMinutes: 30 }] });
    // A one-off of the sibling holds 19:00 that day: 19:00 is offered, except that week.
    const blocker = await cairo(3, '19:00');
    // The blocker must be teacher_c's (learner_m is teacher_d's): a third child.
    const thirdId = randomUUID();
    await g.prisma.$transaction([
      g.prisma.$executeRawUnsafe(`select set_config('chat.syncing_assignment', 'on', true)`),
      g.prisma.$executeRawUnsafe(`insert into chat.learner (id, family_id, name, teacher_id) values ('${thirdId}'::uuid, '${s.familyId}'::uuid, 'learner_n', '${s.teacherId}'::uuid)`),
    ]);
    await lessons.schedule(tsupId, { learnerId: thirdId, startsAt: blocker.toISOString(), endsAt: new Date(blocker.getTime() + HOUR / 2).toISOString() });

    const o = await scheduling.scheduleOptions(s.parentId, s.learnerId);
    expect(o.current).toEqual([expect.objectContaining({ weekday: wd, start: '17:00', durationMinutes: 30 })]);
    expect(o.current[0].nextStartsAt).not.toBeNull();
    const seven = o.options.find((x) => x.weekday === wd && x.start === '19:00');
    expect(seven?.except).toEqual([blocker.toISOString()]);
    expect(o.options.find((x) => x.weekday === wd && x.start === '17:00')?.except).toEqual([]);
  });

  it('a teacher may ask too; the request says from when; the approval applies from that day', async () => {
    const wd = await weekdayIn(3);
    await scheduling.setSchedule(tsupId, s.learnerId, { slots: [{ weekday: wd, start: '17:00', durationMinutes: 30 }] });
    const from = await localDate(8);
    const r = await scheduling.requestScheduleChange(s.teacherId, s.learnerId, { slots: [{ weekday: wd, start: '18:30' }], effectiveFrom: from });
    const sched = await scheduling.schedule(s.parentId, s.learnerId);
    expect(sched.pendingRequest).toEqual(expect.objectContaining({ effectiveFrom: from, requestedBy: 'teacher' }));
    expect(sched.teacher?.id).toBe(s.teacherId);
    expect(await code(scheduling.requestScheduleChange(s.newTeacherId, s.learnerId, { slots: [{ weekday: wd, start: '19:00' }] })))
      .toBe(CommErrorCode.LESSON_NOT_FOUND);

    await scheduling.decideScheduleChange(tsupId, r.id, { decision: 'approved' });
    const slots = await g.prisma.learnerScheduleSlot.findMany({ where: { learnerId: s.learnerId }, orderBy: { createdAt: 'asc' } });
    expect(slots.at(-1)?.validFrom.toISOString().slice(0, 10)).toBe(from);
    // The old 17:00 lessons before that day stay; after it they are rescheduled.
    const old = await g.prisma.lesson.findMany({ where: { learnerId: s.learnerId, scheduleSlotId: slots[0].id } });
    const cut = await cairo(8, '00:00');
    expect(old.filter((l) => l.startsAt < cut).every((l) => l.outcome === null)).toBe(true);
    expect(old.filter((l) => l.startsAt >= cut).every((l) => l.outcome === 'rescheduled')).toBe(true);
  });

  it('Needs action flags a request that is no longer free before anyone approves it', async () => {
    const wd = await weekdayIn(3);
    await scheduling.setSchedule(tsupId, s.learnerId, { slots: [{ weekday: wd, start: '17:00', durationMinutes: 30 }] });
    const r = await scheduling.requestScheduleChange(s.parentId, s.learnerId, { slots: [{ weekday: wd, start: '18:00' }] });
    let queue = await scheduling.enrichNeedsAction(tsupId, await lessons.needsAction(tsupId));
    const fresh = queue.scheduleRequests.find((x) => x.id === r.id);
    expect(fresh).toEqual(expect.objectContaining({
      stillFree: true,
      requestedBy: expect.objectContaining({ kind: 'family' }),
      current: [expect.objectContaining({ start: '17:00' })],
      requested: [expect.objectContaining({ start: '18:00', free: true })],
    }));

    // Another child of teacher_c takes 18:00 meanwhile.
    const thirdId = randomUUID();
    await g.prisma.$transaction([
      g.prisma.$executeRawUnsafe(`select set_config('chat.syncing_assignment', 'on', true)`),
      g.prisma.$executeRawUnsafe(`insert into chat.learner (id, family_id, name, teacher_id) values ('${thirdId}'::uuid, '${s.familyId}'::uuid, 'learner_n', '${s.teacherId}'::uuid)`),
    ]);
    await scheduling.setSchedule(tsupId, thirdId, { slots: [{ weekday: wd, start: '18:00', durationMinutes: 30 }] });
    queue = await scheduling.enrichNeedsAction(tsupId, await lessons.needsAction(tsupId));
    const stale = queue.scheduleRequests.find((x) => x.id === r.id);
    expect(stale?.stillFree).toBe(false);
    expect(stale?.requested[0].free).toBe(false);
    expect(await code(scheduling.decideScheduleChange(tsupId, r.id, { decision: 'approved' }))).toBe(CommErrorCode.LESSON_STATE);
    await scheduling.decideScheduleChange(tsupId, r.id, { decision: 'rejected', note: 'taken' });
  });
});

describe('3. a weekly lesson the teacher\'s other lesson blocks', () => {
  it('is recorded and shown, then scheduled elsewhere or dismissed', async () => {
    const wd = await weekdayIn(4);
    // teacher_c's make-up for another child sits at 18:00 on that day ...
    const thirdId = randomUUID();
    await g.prisma.$transaction([
      g.prisma.$executeRawUnsafe(`select set_config('chat.syncing_assignment', 'on', true)`),
      g.prisma.$executeRawUnsafe(`insert into chat.learner (id, family_id, name, teacher_id) values ('${thirdId}'::uuid, '${s.familyId}'::uuid, 'learner_n', '${s.teacherId}'::uuid)`),
    ]);
    const blockAt = await cairo(4, '18:00');
    const blocker = await lessons.schedule(tsupId, { learnerId: thirdId, startsAt: blockAt.toISOString(), endsAt: new Date(blockAt.getTime() + HOUR / 2).toISOString() });
    // ... and learner_l's new weekly time is 18:00 on that weekday.
    await scheduling.setSchedule(tsupId, s.learnerId, { slots: [{ weekday: wd, start: '18:00', durationMinutes: 30 }] });
    expect(await g.prisma.lesson.count({ where: { learnerId: s.learnerId, startsAt: blockAt } })).toBe(0);

    await scheduling.collectBlocked();
    const queue = await scheduling.enrichNeedsAction(tsupId, await lessons.needsAction(tsupId));
    expect(queue.blockedOccurrences).toEqual([
      expect.objectContaining({
        learner: { id: s.learnerId, name: 'learner_l' },
        startsAt: blockAt.toISOString(),
        blockedBy: expect.objectContaining({ lessonId: blocker.id, kind: 'regular' }),
      }),
    ]);
    const blockedId = queue.blockedOccurrences[0].id;
    // Idempotent.
    await scheduling.collectBlocked();
    expect(await g.prisma.lessonBlockedOccurrence.count()).toBe(1);
    // Only the Teachers department handles it.
    expect(await code(scheduling.blockedSlots(s.parentId, blockedId))).toBe(CommErrorCode.LESSON_DENIED);

    const free = await scheduling.blockedSlots(tsupId, blockedId);
    const lesson = await scheduling.scheduleBlocked(tsupId, blockedId, { startsAt: free.slots[0] });
    expect(lesson.learner.id).toBe(s.learnerId);
    const row = await g.prisma.lessonBlockedOccurrence.findUniqueOrThrow({ where: { id: blockedId } });
    expect(row).toEqual(expect.objectContaining({ resolution: 'scheduled', lessonId: lesson.id, resolvedBy: tsupId }));
    expect(await code(scheduling.dismissBlocked(tsupId, blockedId, {}))).toBe(CommErrorCode.LESSON_STATE);
  });

  it('clears itself when the blocking lesson moves away and the weekly lesson is created', async () => {
    const wd = await weekdayIn(4);
    const thirdId = randomUUID();
    await g.prisma.$transaction([
      g.prisma.$executeRawUnsafe(`select set_config('chat.syncing_assignment', 'on', true)`),
      g.prisma.$executeRawUnsafe(`insert into chat.learner (id, family_id, name, teacher_id) values ('${thirdId}'::uuid, '${s.familyId}'::uuid, 'learner_n', '${s.teacherId}'::uuid)`),
    ]);
    const blockAt = await cairo(4, '18:00');
    const blocker = await lessons.schedule(tsupId, { learnerId: thirdId, startsAt: blockAt.toISOString(), endsAt: new Date(blockAt.getTime() + HOUR / 2).toISOString() });
    await scheduling.setSchedule(tsupId, s.learnerId, { slots: [{ weekday: wd, start: '18:00', durationMinutes: 30 }] });
    await scheduling.collectBlocked();
    expect(await g.prisma.lessonBlockedOccurrence.count({ where: { resolution: null } })).toBe(1);

    const offer = await scheduling.moveSlots(tsupId, blocker.id);
    await scheduling.moveLesson(tsupId, blocker.id, { startsAt: offer.slots.find((x) => new Date(x).getTime() > blockAt.getTime() + DAY) });
    await scheduling.materialize();
    await scheduling.collectBlocked();
    expect(await g.prisma.lesson.count({ where: { learnerId: s.learnerId, startsAt: blockAt, outcome: null } })).toBe(1);
    expect((await g.prisma.lessonBlockedOccurrence.findFirstOrThrow()).resolution).toBe('cleared');
  });
});

describe('4. changing the teacher', () => {
  it('the child\'s supervisor and the Operations Manager may; another Operations supervisor may not', async () => {
    expect(await code(lifecycle.transferPreview(s.otherAdminId, s.learnerId, s.newTeacherId))).toBe(CommErrorCode.LESSON_NOT_FOUND);
    expect(await code(lifecycle.transfer(s.parentId, s.learnerId, { toTeacherId: s.newTeacherId, reason: 'schedule_fit' })))
      .toBe(CommErrorCode.LESSON_DENIED);
    const viaSupervisor = await lifecycle.transfer(s.ownerId, s.learnerId, { toTeacherId: s.newTeacherId, reason: 'schedule_fit' });
    expect(viaSupervisor.scheduleKept).toBe(true);
    expect((await g.prisma.learner.findUniqueOrThrow({ where: { id: s.learnerId } })).teacherId).toBe(s.newTeacherId);
    // The Operations Manager, through staff_principals, moves learner_m.
    await lifecycle.transfer(s.managerId, s.secondLearnerId, { toTeacherId: s.teacherId, reason: 'schedule_fit' });
    expect((await g.prisma.learner.findUniqueOrThrow({ where: { id: s.secondLearnerId } })).teacherId).toBe(s.teacherId);
    const cand = await lifecycle.candidates(s.ownerId);
    expect(cand.teachers.map((t) => t.name)).toEqual(expect.arrayContaining(['teacher_c', 'teacher_d']));
    expect(await code(lifecycle.candidates(s.parentId))).toBe(CommErrorCode.LESSON_DENIED);
  });

  it('refuses weekly times the new teacher is not free at -- nothing changes -- and applies chosen ones in the same step', async () => {
    const wd = await weekdayIn(3);
    await scheduling.setSchedule(tsupId, s.learnerId, { slots: [{ weekday: wd, start: '17:00', durationMinutes: 30 }] });
    // teacher_d's own student holds 17:00 on that weekday.
    await scheduling.setSchedule(tsupId, s.secondLearnerId, { slots: [{ weekday: wd, start: '17:00', durationMinutes: 30 }] });

    const preview = await lifecycle.transferPreview(tsupId, s.learnerId, s.newTeacherId);
    expect(preview.learners[0]).toEqual(expect.objectContaining({ allFree: false, slots: [expect.objectContaining({ start: '17:00', free: false })] }));

    const r = await refusal(lifecycle.transfer(tsupId, s.learnerId, { toTeacherId: s.newTeacherId, reason: 'schedule_fit' }));
    expect(r.code).toBe(CommErrorCode.LESSON_STATE);
    expect(r.message).toMatch(/^times_not_free/);
    expect((await g.prisma.learner.findUniqueOrThrow({ where: { id: s.learnerId } })).teacherId).toBe(s.teacherId);
    expect(await g.prisma.learnerTransfer.count()).toBe(0);
    expect(await g.prisma.learnerScheduleSlot.count({ where: { learnerId: s.learnerId, validTo: null, teacherId: s.teacherId } })).toBe(1);

    const options = await scheduling.scheduleOptions(tsupId, s.learnerId, s.newTeacherId);
    expect(options.options.some((o) => o.weekday === wd && o.start === '17:00')).toBe(false);
    const out = await lifecycle.transfer(tsupId, s.learnerId, {
      toTeacherId: s.newTeacherId, reason: 'schedule_fit', slots: [{ weekday: wd, start: '18:00' }],
    });
    expect(out.lessonsMoved).toBeGreaterThanOrEqual(3);
    const now = await g.prisma.learnerScheduleSlot.findMany({ where: { learnerId: s.learnerId, validTo: null } });
    expect(now.map((x) => [x.teacherId, x.startMinute])).toEqual([[s.newTeacherId, 18 * 60]]);
    const open = await g.prisma.lesson.findMany({ where: { learnerId: s.learnerId, outcome: null, startsAt: { gt: new Date() } } });
    expect(open.length).toBeGreaterThanOrEqual(3);
    expect(open.every((l) => l.teacherId === s.newTeacherId)).toBe(true);
    const [{ wrong }] = await g.prisma.$queryRawUnsafe<Array<{ wrong: number }>>(
      `select count(*)::int as wrong from chat.lesson where learner_id = $1::uuid and outcome is null and starts_at > now()
          and to_char(starts_at at time zone '${TZ}', 'HH24:MI') <> '18:00'`, s.learnerId,
    );
    expect(wrong).toBe(0);
    // Nothing was blocked by the learner's own old lessons.
    await scheduling.collectBlocked();
    expect(await g.prisma.lessonBlockedOccurrence.count({ where: { learnerId: s.learnerId } })).toBe(0);
    expect((await cards()).some((m) => m.card?.kind === 'learner_transferred')).toBe(true);
  });

  it('a group\'s children taught by the old teacher move together, in the same conversation', async () => {
    // learner_m moves to teacher_c first, so both children share a teacher.
    await lifecycle.transfer(tsupId, s.secondLearnerId, { toTeacherId: s.teacherId, reason: 'schedule_fit' });
    const fam = await g.conversations.createFamilyGroup(s.ownerId, {
      learnerIds: [s.learnerId, s.secondLearnerId], contactIds: [s.parentId], teacherIds: [s.teacherId],
    });
    const wd = await weekdayIn(3);
    await scheduling.setSchedule(tsupId, s.learnerId, { slots: [{ weekday: wd, start: '17:00', durationMinutes: 30 }] });
    await scheduling.setSchedule(tsupId, s.secondLearnerId, { slots: [{ weekday: wd, start: '17:30', durationMinutes: 30 }] });

    const preview = await lifecycle.groupPreview(s.ownerId, fam.id, s.newTeacherId, undefined);
    expect(preview.learners.map((l) => l.name).sort()).toEqual(['learner_l', 'learner_m']);
    // Two siblings may not be given the same new time.
    expect(await code(lifecycle.transferGroup(s.ownerId, fam.id, {
      toTeacherId: s.newTeacherId, reason: 'schedule_fit',
      slots: { [s.learnerId]: [{ weekday: wd, start: '19:00' }], [s.secondLearnerId]: [{ weekday: wd, start: '19:00' }] },
    }))).toBe(CommErrorCode.VALIDATION);

    const out = await lifecycle.transferGroup(s.ownerId, fam.id, { toTeacherId: s.newTeacherId, reason: 'schedule_fit' });
    expect(out.learners).toHaveLength(2);
    const both = await g.prisma.learner.findMany({ where: { id: { in: [s.learnerId, s.secondLearnerId] } } });
    expect(both.every((l) => l.teacherId === s.newTeacherId)).toBe(true);
    const members = await g.prisma.conversationMember.findMany({ where: { conversationId: fam.id, actorKind: 'teacher', leftAt: null } });
    expect(members.map((m) => m.actorId)).toEqual([s.newTeacherId]);
  });

  it('an inactive teacher cannot be chosen', async () => {
    await g.prisma.teacher.update({ where: { id: s.unrelatedTeacherId }, data: { isActive: false } });
    expect(await code(lifecycle.transfer(tsupId, s.learnerId, { toTeacherId: s.unrelatedTeacherId, reason: 'schedule_fit' })))
      .toBe(CommErrorCode.LESSON_STATE);
    const cand = await lifecycle.candidates(tsupId);
    expect(cand.teachers.find((t) => t.id === s.unrelatedTeacherId)?.isActive).toBe(false);
  });
});

describe('5. tickets and the payment lock', () => {
  it('offers "Change lesson time" per child to the family and the child\'s teacher', async () => {
    const forParent = (await lessons.ticketsFor(s.parentId, groupId)).tickets.filter((t) => t.ticket === 'change_lesson_time');
    expect(forParent).toEqual([expect.objectContaining({ lessonId: null, learner: { id: s.learnerId, name: 'learner_l' } })]);
    const forTeacher = (await lessons.ticketsFor(s.teacherId, groupId)).tickets.filter((t) => t.ticket === 'change_lesson_time');
    expect(forTeacher).toHaveLength(1);
  });

  it('a locked child is offered no time and every change is refused', async () => {
    const id = (await lessons.schedule(tsupId, { learnerId: s.learnerId, startsAt: at(3 * DAY), endsAt: at(3 * DAY + HOUR / 2) })).id;
    const free = await scheduling.moveSlots(s.parentId, id);
    jest.spyOn(scheduling, 'lockOf').mockResolvedValue('balance');
    const offer = await scheduling.moveSlots(s.parentId, id);
    expect(offer).toEqual(expect.objectContaining({ locked: 'balance', slots: [] }));
    expect((await refusal(scheduling.moveLesson(s.parentId, id, { startsAt: free.slots[3] }))).message).toBe('locked');
    expect((await scheduling.scheduleOptions(s.parentId, s.learnerId)).locked).toBe('balance');
    expect((await refusal(scheduling.requestScheduleChange(s.parentId, s.learnerId, { slots: [{ weekday: 1, start: '10:00' }] }))).message).toBe('locked');
  });
});

describe('6. review fixes', () => {
  async function zoneAllWeek(teacherId: string, timezone: string) {
    await scheduling.setAvailability(tsupId, teacherId, {
      timezone,
      windows: [1, 2, 3, 4, 5, 6, 7].map((weekday) => ({ weekday, start: '00:00', end: '24:00' })),
    });
  }
  async function openStarts(learnerId: string): Promise<string[]> {
    const rows = await g.prisma.lesson.findMany({
      where: { learnerId, outcome: null, startsAt: { gt: new Date() } },
      orderBy: { startsAt: 'asc' },
    });
    return rows.map((r) => r.startsAt.toISOString());
  }

  it('a kept weekly time keeps its INSTANTS across zones: Riyadh 18:00 becomes Dubai 19:00', async () => {
    await zoneAllWeek(s.teacherId, 'Asia/Riyadh');
    await zoneAllWeek(s.newTeacherId, 'Asia/Dubai');
    const wd = await weekdayIn(3);
    await scheduling.setSchedule(tsupId, s.learnerId, { slots: [{ weekday: wd, start: '18:00', durationMinutes: 30 }] });
    const before = await openStarts(s.learnerId);

    const preview = await lifecycle.transferPreview(tsupId, s.learnerId, s.newTeacherId);
    expect(preview.learners[0].slots[0]).toEqual(expect.objectContaining({ start: '18:00', keptAs: { weekday: wd, start: '19:00' }, free: true, zoneShift: false }));

    await lifecycle.transfer(tsupId, s.learnerId, { toTeacherId: s.newTeacherId, reason: 'schedule_fit' });
    const slots = await g.prisma.learnerScheduleSlot.findMany({ where: { learnerId: s.learnerId, validTo: null } });
    expect(slots.map((x) => [x.timezone, x.weekday, x.startMinute])).toEqual([['Asia/Dubai', wd, 19 * 60]]);
    // The family's lessons did not move by a minute.
    expect((await openStarts(s.learnerId)).slice(0, 3)).toEqual(before.slice(0, 3));
  });

  it('a time two zones cannot keep exactly (one changes its clocks) is refused, never shifted', async () => {
    // Cairo changes its clocks; Riyadh never does.
    await zoneAllWeek(s.newTeacherId, 'Asia/Riyadh');
    const wd = await weekdayIn(3);
    await scheduling.setSchedule(tsupId, s.learnerId, { slots: [{ weekday: wd, start: '18:00', durationMinutes: 30 }] });
    const preview = await lifecycle.transferPreview(tsupId, s.learnerId, s.newTeacherId);
    expect(preview.learners[0].slots[0]).toEqual(expect.objectContaining({ keptAs: null, zoneShift: true, free: false }));
    const r = await refusal(lifecycle.transfer(tsupId, s.learnerId, { toTeacherId: s.newTeacherId, reason: 'schedule_fit' }));
    expect(r.message).toMatch(/^times_not_free.*clocks/);
    expect((await g.prisma.learner.findUniqueOrThrow({ where: { id: s.learnerId } })).teacherId).toBe(s.teacherId);
    // Chosen times in the new teacher's zone are accepted.
    await lifecycle.transfer(tsupId, s.learnerId, { toTeacherId: s.newTeacherId, reason: 'schedule_fit', slots: [{ weekday: wd, start: '19:00' }] });
    expect((await g.prisma.learnerScheduleSlot.findFirstOrThrow({ where: { learnerId: s.learnerId, validTo: null } })).timezone).toBe('Asia/Riyadh');
  });

  it('a group preview tells someone who may not change the teacher nothing, not even names', async () => {
    const fam = await g.conversations.createFamilyGroup(s.ownerId, {
      learnerIds: [s.learnerId, s.secondLearnerId], contactIds: [s.parentId], teacherIds: [s.teacherId, s.newTeacherId],
    });
    for (const who of [s.parentId, s.otherParentId, s.otherAdminId, s.teacherId]) {
      const c = await code(lifecycle.groupPreview(who, fam.id, s.newTeacherId, undefined));
      expect([CommErrorCode.LESSON_NOT_FOUND, CommErrorCode.LESSON_DENIED]).toContain(c);
    }
    const ok = await lifecycle.groupPreview(s.ownerId, fam.id, s.newTeacherId, undefined);
    expect(ok.groupTeachers?.map((t) => t.name).sort()).toEqual(['teacher_c', 'teacher_d']);
    expect(ok.learners).toEqual([]);
  });

  it('two parallel family moves at 3 of 4: exactly one succeeds', async () => {
    const ids: string[] = [];
    for (let d = 3; d <= 7; d++) {
      ids.push((await lessons.schedule(tsupId, { learnerId: s.learnerId, startsAt: at(d * DAY), endsAt: at(d * DAY + HOUR / 2) })).id);
    }
    const free = (await scheduling.moveSlots(s.parentId, ids[0])).slots;
    const pick = (i: number) => free[40 + i * 7];
    for (let i = 0; i < 3; i++) await scheduling.moveLesson(s.parentId, ids[i], { startsAt: pick(i) });
    expect((await scheduling.moveSlots(s.parentId, ids[3])).familyMovesLeft).toBe(1);
    const results = await Promise.allSettled([
      scheduling.moveLesson(s.parentId, ids[3], { startsAt: pick(3) }),
      scheduling.moveLesson(s.parentId, ids[4], { startsAt: pick(4) }),
    ]);
    expect(results.filter((x) => x.status === 'fulfilled')).toHaveLength(1);
    const lost = results.find((x) => x.status === 'rejected') as PromiseRejectedResult;
    expect((lost.reason as CommError).code).toBe(CommErrorCode.LESSON_STATE);
    const [{ n }] = await g.prisma.$queryRawUnsafe<Array<{ n: number }>>(
      `select count(*)::int as n from chat.lesson where learner_id = $1::uuid and moved_from is not null and created_by_kind = 'contact'`, s.learnerId,
    );
    expect(n).toBe(4);
  });

  it('the database continues only a lesson moved away in the SAME transaction', async () => {
    const wd = await weekdayIn(3);
    await scheduling.setSchedule(tsupId, s.learnerId, { slots: [{ weekday: wd, start: '17:00', durationMinutes: 30 }] });
    await scheduling.setSchedule(tsupId, s.learnerId, { slots: [{ weekday: wd, start: '18:00', durationMinutes: 30 }] });
    // An older rescheduled lesson (the weekly change above), with no successor.
    const old = await g.prisma.lesson.findFirstOrThrow({ where: { learnerId: s.learnerId, outcome: 'rescheduled' }, orderBy: { startsAt: 'asc' } });
    await expect(g.prisma.$executeRawUnsafe(
      `insert into chat.lesson (organization_id, learner_id, teacher_id, kind, starts_at, ends_at, created_by_kind, created_by, moved_from)
       values (chat.default_organization_id(), $1::uuid, $2::uuid, 'regular', now() + interval '10 days', now() + interval '10 days 30 minutes', 'contact', $3::uuid, $4::uuid)`,
      s.learnerId, s.teacherId, s.parentId, old.id,
    )).rejects.toThrow(/moved away/);
  });

  it('PD-30\'s lock: any answer locks ("other" when unknown); tables without the function fail loudly', async () => {
    const id = (await lessons.schedule(tsupId, { learnerId: s.learnerId, startsAt: at(3 * DAY), endsAt: at(3 * DAY + HOUR / 2) })).id;
    try {
      await g.prisma.$executeRawUnsafe(`create function chat.learner_lesson_lock(p uuid) returns text language sql as $$ select 'frozen'::text $$`);
      expect((await scheduling.moveSlots(s.parentId, id)).locked).toBe('other');
      await g.prisma.$executeRawUnsafe(`drop function chat.learner_lesson_lock(uuid)`);
      await g.prisma.$executeRawUnsafe(`create table chat.learner_access (learner_id uuid)`);
      await expect(scheduling.lockOf(s.learnerId)).rejects.toThrow(/learner_lesson_lock/);
      await expect(scheduling.onApplicationBootstrap()).rejects.toThrow(/learner_lesson_lock/);
    } finally {
      await g.prisma.$executeRawUnsafe(`drop function if exists chat.learner_lesson_lock(uuid)`);
      await g.prisma.$executeRawUnsafe(`drop table if exists chat.learner_access`);
    }
    expect(await scheduling.lockOf(s.learnerId)).toBeNull();
  });

  it('a one-off the new teacher is busy for is listed and the family told -- never left behind', async () => {
    const clashAt = await cairo(3, '16:00');
    const oneOff = await lessons.schedule(tsupId, { learnerId: s.learnerId, startsAt: clashAt.toISOString(), endsAt: new Date(clashAt.getTime() + HOUR / 2).toISOString() });
    const busy = await lessons.schedule(tsupId, { learnerId: s.secondLearnerId, startsAt: clashAt.toISOString(), endsAt: new Date(clashAt.getTime() + HOUR / 2).toISOString() });
    const out = await lifecycle.transfer(tsupId, s.learnerId, { toTeacherId: s.newTeacherId, reason: 'schedule_fit' });
    expect(out.lessonsRescheduled).toBe(1);
    const row = await g.prisma.lessonBlockedOccurrence.findFirstOrThrow({ where: { strandedLesson: oneOff.id } });
    expect(row).toEqual(expect.objectContaining({ reason: 'teacher_changed', teacherId: s.newTeacherId, blockedBy: busy.id, resolution: null }));
    expect((await cards()).some((m) => m.card?.kind === 'lesson_unscheduled')).toBe(true);
    const queue = await scheduling.enrichNeedsAction(tsupId, await lessons.needsAction(tsupId));
    expect(queue.blockedOccurrences).toEqual([expect.objectContaining({ reason: 'teacher_changed', lessonKind: 'regular' })]);
    const free = await scheduling.blockedSlots(tsupId, row.id);
    const again = await scheduling.scheduleBlocked(tsupId, row.id, { startsAt: free.slots[5] });
    expect(again.teacher.id).toBe(s.newTeacherId);
  });

  it('a teacher moves a lesson only with notice', async () => {
    const id = (await lessons.schedule(tsupId, { learnerId: s.learnerId, startsAt: at(HOUR), endsAt: at(1.5 * HOUR) })).id;
    expect((await scheduling.moveSlots(s.teacherId, id)).refusal).toBe('too_late');
    expect((await scheduling.moveSlots(tsupId, id)).refusal).toBeNull();
  });

  it('only staff who may change some child\'s teacher list the candidates', async () => {
    expect((await lifecycle.candidates(s.ownerId)).teachers.length).toBeGreaterThan(0);
    expect((await lifecycle.candidates(s.managerId)).teachers.length).toBeGreaterThan(0);
    expect(await code(lifecycle.candidates(s.otherAdminId))).toBe(CommErrorCode.LESSON_DENIED);
  });
});
