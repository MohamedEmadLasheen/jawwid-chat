/**
 * PD-38 -- the academy scheduling calendar. One definition per number
 * (chat.calendar_capacity, 20261026210000), who may read and change what, and
 * a month of 100 teachers within budget.
 *
 * Every scenario uses fixed days in the past or the 2026 clock change, so no
 * assertion depends on the day the suite runs. Times are Cairo wall-clock.
 *
 * Synthetic fixtures only (QA gate G-16).
 */
import { randomUUID } from 'node:crypto';
import { PrismaAuditService } from '@platform/audit.service';
import { CommError, CommErrorCode } from '@platform/errors';
import { LessonService } from '../../src/lessons/lesson.service';
import { SchedulingService } from '../../src/lessons/scheduling.service';
import { StatsService } from '../../src/lessons/stats.service';
import { CalendarService } from '../../src/calendar/calendar.service';
import { WorkPatternService } from '../../src/calendar/work-pattern.service';
import { buildGraph, seed, truncate, withAssignmentGate, Scenario } from './harness';

jest.setTimeout(240_000);

const g = buildGraph();
const audit = new PrismaAuditService();
const lessons = new LessonService(g.prisma, g.authz, g.conversations, g.outbox, g.config, audit);
const scheduling = new SchedulingService(g.prisma, g.authz, g.conversations, lessons, g.outbox, g.config, g.reminders, audit);
const stats = new StatsService(g.prisma, g.conversations, lessons, scheduling, g.config);
const calendar = new CalendarService(g.prisma, g.conversations, lessons, g.config);
const patterns = new WorkPatternService(g.prisma, g.conversations, lessons, scheduling, calendar, g.config, audit);

const TZ = 'Africa/Cairo';
const SAT_TO_THU = [6, 7, 1, 2, 3, 4];

let s: Scenario;
/** The Teachers Manager (department manager) and a Teachers supervisor (member). */
let tmgrId: string;
let tsupId: string;
/** A second child of teacher_c, supervised by admin_b (the seed's other Operations supervisor). */
let learnerN: string;

async function code(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (e) {
    if (e instanceof CommError) return e.code;
    throw e;
  }
  throw new Error('expected a refusal, got success');
}

/** A lesson at a Cairo wall-clock time, written as staff would (overlaps allowed: the fixture is the point). */
async function lessonAt(learnerId: string, cairo: string, minutes: number): Promise<string> {
  const [{ id }] = await g.prisma.$queryRawUnsafe<Array<{ id: string }>>(
    `insert into chat.lesson (organization_id, learner_id, teacher_id, kind, starts_at, ends_at, created_by, created_by_kind)
     values (chat.default_organization_id(), $1::uuid, $2::uuid, 'regular',
             $3::timestamp at time zone '${TZ}', ($3::timestamp at time zone '${TZ}') + make_interval(mins => $4::int),
             $5::uuid, 'staff')
     returning id::text as id`,
    learnerId, s.teacherId, cairo, minutes, tsupId,
  );
  return id;
}

async function trialAt(cairo: string, minutes: number): Promise<string> {
  const [{ id: prospect }] = await g.prisma.$queryRawUnsafe<Array<{ id: string }>>(
    `insert into chat.trial_prospect (organization_id, display_name, created_by)
     values (chat.default_organization_id(), 'prospect_p', $1::uuid) returning id::text as id`,
    tsupId,
  );
  const [{ id }] = await g.prisma.$queryRawUnsafe<Array<{ id: string }>>(
    `insert into chat.lesson (organization_id, prospect_id, teacher_id, kind, starts_at, ends_at, created_by, created_by_kind)
     values (chat.default_organization_id(), $1::uuid, $2::uuid, 'trial',
             $3::timestamp at time zone '${TZ}', ($3::timestamp at time zone '${TZ}') + make_interval(mins => $4::int),
             $5::uuid, 'staff')
     returning id::text as id`,
    prospect, s.teacherId, cairo, minutes, tsupId,
  );
  return id;
}

/**
 * A lesson that was paused before it began and now lies in the past -- history
 * the calendar must show. The guard lets only a lesson that has not started be
 * suspended, and this suite's days are fixed in the past, so the fixture writes
 * that state directly, with triggers off for this one statement's transaction.
 */
async function pause(lessonId: string) {
  await g.prisma.$transaction([
    g.prisma.$executeRawUnsafe(`set local session_replication_role = replica`),
    g.prisma.$executeRawUnsafe(
      `update chat.lesson set outcome = 'suspended', outcome_by_kind = 'staff', outcome_by = $2::uuid,
              outcome_at = starts_at - interval '1 day', outcome_note = 'paused'
        where id = $1::uuid`,
      lessonId, tsupId,
    ),
  ]);
}

/**
 * Close a lesson as cancelled by the administration. Its slot stays booked
 * (time reserved for a student, whatever happened), and only now may another
 * lesson be put in the same time: the database forbids two OPEN lessons
 * overlapping (lesson_teacher_is_never_double_booked), so real overlaps are
 * exactly these -- a closed lesson and the one booked into its time.
 */
async function cancel(lessonId: string) {
  await g.prisma.$executeRawUnsafe(
    `update chat.lesson set outcome = 'admin_cancelled', outcome_by_kind = 'staff', outcome_by = $2::uuid, outcome_at = now(),
            outcome_note = 'holiday'
      where id = $1::uuid`,
    lessonId, tsupId,
  );
}

/**
 * Work patterns as history: the service accepts a change from today only (a
 * past month keeps the shift it was worked under), so past patterns are
 * written as the data they would be -- one transaction, windows with their
 * pattern, the default shift (Saturday-Thursday) of the category.
 */
async function history(teacherId: string, rows: Array<{ category: 'full_shift' | 'part_shift' | 'hourly'; from: string; to?: string }>) {
  for (const r of rows) {
    const [start, end] = r.category === 'full_shift' ? [720, 1140] : [840, 1080];
    await g.prisma.$transaction([
      g.prisma.$executeRawUnsafe(
        `insert into chat.teacher_work_pattern (id, organization_id, teacher_id, category, timezone, valid_from, valid_to, created_by)
         values ($1::uuid, chat.default_organization_id(), $2::uuid, $3, '${TZ}', $4::date, $5::date, $6::uuid)`,
        randomUUID(), teacherId, r.category, r.from, r.to ?? null, tmgrId,
      ),
      ...(r.category === 'hourly' ? [] : [g.prisma.$executeRawUnsafe(
        `insert into chat.teacher_work_window (organization_id, pattern_id, weekday, start_minute, end_minute)
         select p.organization_id, p.id, d, $3::int, $4::int
           from chat.teacher_work_pattern p, unnest(array[6, 7, 1, 2, 3, 4]) d
          where p.teacher_id = $1::uuid and p.valid_from = $2::date`,
        teacherId, r.from, start, end,
      )]),
    ]);
  }
}

async function fullShift(teacherId: string, validFrom: string) {
  await history(teacherId, [{ category: 'full_shift', from: validFrom }]);
}

/** Today on the academy's calendar, and days from it. */
async function academyDay(offset = 0): Promise<string> {
  const [{ d }] = await g.prisma.$queryRawUnsafe<Array<{ d: string }>>(
    `select to_char((now() at time zone '${TZ}')::date + $1::int, 'YYYY-MM-DD') as d`, offset,
  );
  return d;
}

/** Minutes covered by [[from, to], ...] intervals. */
function minutes(intervals: unknown): number {
  return (intervals as Array<[string, string]>).reduce((n, [a, b]) => n + (Date.parse(b) - Date.parse(a)) / 60_000, 0);
}

beforeAll(async () => {
  await g.prisma.$connect();
});
afterAll(async () => {
  await truncate(g.prisma);
  await g.prisma.$disconnect();
});
beforeEach(async () => {
  await truncate(g.prisma);
  s = await seed(g.prisma);
  tmgrId = randomUUID();
  tsupId = randomUUID();
  await g.prisma.$executeRawUnsafe(
    // A department's manager holds the manager role (chat.department's guard).
    `insert into chat.staff (id, name, role, is_active) values ($1::uuid, 'tmgr_a', 'manager', true), ($2::uuid, 'tsup_a', 'admin', true)`,
    tmgrId, tsupId,
  );
  const [{ id: dept }] = await g.prisma.$queryRawUnsafe<Array<{ id: string }>>(
    `insert into chat.department (kind, display_name, manager_id) values ('teachers', 'teachers', $1::uuid) returning id::text as id`,
    tmgrId,
  );
  await g.prisma.$executeRawUnsafe(
    `insert into chat.department_member (staff_id, organization_id, department_id, position)
     values ($1::uuid, chat.default_organization_id(), $2::uuid, 'supervisor')`,
    tsupId, dept,
  );
  learnerN = randomUUID();
  await withAssignmentGate(
    g.prisma,
    `insert into chat.learner (id, family_id, name, teacher_id)
     values ('${learnerN}'::uuid, '${s.familyId}'::uuid, 'learner_n', '${s.teacherId}'::uuid)`,
  );
  await g.prisma.$executeRawUnsafe(
    `insert into chat.learner_supervision (learner_id, organization_id, supervisor_id)
     values ($1::uuid, chat.default_organization_id(), $2::uuid)`,
    learnerN, s.otherAdminId,
  );
  g.config.invalidate();
});

describe('the numbers: one definition, nothing counted twice', () => {
  // Monday 2026-09-14 and Tuesday 2026-09-15; Cairo is UTC+3 all September.
  const window = { from: '2026-09-14', to: '2026-09-16', teacherIds: '' };

  beforeEach(async () => {
    window.teacherIds = s.teacherId;
    await fullShift(s.teacherId, '2026-09-01');
    // A cancelled lesson whose time was booked again: 13:00-14:30 is 90 minutes, not 120.
    await cancel(await lessonAt(s.learnerId, '2026-09-14 13:00', 60));
    await lessonAt(s.learnerId, '2026-09-14 13:30', 60);
    await lessonAt(learnerN, '2026-09-14 16:00', 30);
    await lessonAt(s.learnerId, '2026-09-14 20:00', 30); // after the shift
    await trialAt('2026-09-14 15:00', 30);
    await pause(await lessonAt(learnerN, '2026-09-14 17:00', 60));
    // Tuesday is a day off: the whole shift is leave, not empty.
    await scheduling.addDayOff(tmgrId, s.teacherId, { date: '2026-09-15', reason: 'leave' });
  });

  it('partitions the shift: booked (overlaps merged), paused, leave, and empty -- and keeps out-of-shift apart', async () => {
    const sum = await calendar.summary(tsupId, window);
    const mon = sum.cells.find((c) => c.day === '2026-09-14')!;
    expect(mon).toMatchObject({
      shiftMinutes: 420,
      bookedMinutes: 180, // 90 + 30 + 30 (trial) + 30 (outside)
      inShiftBookedMinutes: 150,
      inShiftPausedMinutes: 60,
      inShiftLeaveMinutes: 0,
      emptyMinutes: 210, // 420 - 150 - 60
      outsideMinutes: 30,
      lessons: 6,
    });
    const tue = sum.cells.find((c) => c.day === '2026-09-15')!;
    expect(tue).toMatchObject({ shiftMinutes: 420, inShiftLeaveMinutes: 420, emptyMinutes: 0, utilization: null });
  });

  it('the stats bar: distinct students once each, merged teaching time, utilization over shift minus leave', async () => {
    const st = await calendar.stats(tsupId, window);
    expect(st.students).toEqual({ distinct: 2, trial: 1, paused: 1 });
    expect(st.teaching.bookedMinutes).toBe(180);
    expect(st.teaching.lessons).toBe(5);
    expect(st.capacity).toMatchObject({
      shiftMinutes: 840, inShiftBookedMinutes: 150, inShiftLeaveMinutes: 420, emptyMinutes: 210, outsideMinutes: 30,
    });
    expect(st.capacity.utilization).toBe(0.357); // 150 / (840 - 420)
  });

  it('the stats equal the sums over the calendar for the same filters', async () => {
    const [cal, st] = await Promise.all([calendar.calendar(tsupId, window), calendar.stats(tsupId, window)]);
    const empty = cal.days.reduce((n, d) => n + minutes(d.empty), 0);
    const shift = cal.days.reduce((n, d) => n + minutes(d.shift), 0);
    const leaveInShift = st.teachers[0].totals.inShiftLeaveMinutes;
    expect(empty).toBe(st.capacity.emptyMinutes);
    expect(shift).toBe(st.capacity.shiftMinutes);
    expect(minutes(cal.days.find((d) => d.day === '2026-09-15')!.leave)).toBeGreaterThanOrEqual(leaveInShift);
    const outside = cal.lessons.filter((l) => l.outsideShift);
    expect(outside).toHaveLength(1);
    expect(cal.lessons.find((l) => l.kind === 'trial')).toMatchObject({ status: 'trial', prospect: { name: 'prospect_p' } });
    expect(cal.lessons.filter((l) => l.status === 'paused')).toHaveLength(1);
  });

  it('a lesson-level filter narrows the lessons and their numbers, never the capacity', async () => {
    const st = await calendar.stats(tsupId, { ...window, supervisorIds: s.otherAdminId });
    // learner_n's active lesson only; its paused one is not taught time.
    expect(st.teaching.bookedMinutes).toBe(30);
    expect(st.students.distinct).toBe(1);
    // Capacity still counts every lesson of the shown teacher: nothing turns red.
    expect(st.capacity.emptyMinutes).toBe(210);
    const cal = await calendar.calendar(tsupId, { ...window, supervisorIds: s.otherAdminId });
    expect(cal.lessons.filter((l) => l.matches)).toHaveLength(2);
    expect(cal.lessons.filter((l) => !l.matches).length).toBeGreaterThan(0);
  });

  it('teacher-level filters choose the rows; only-matching hides teachers without a match', async () => {
    const all = await calendar.stats(tsupId, { from: window.from, to: window.to });
    expect(all.teachers.map((t) => t.id)).toEqual(expect.arrayContaining([s.teacherId, s.newTeacherId]));
    const shifts = await calendar.stats(tsupId, { from: window.from, to: window.to, categories: 'full_shift' });
    expect(shifts.teachers.map((t) => t.id)).toEqual([s.teacherId]);
    const low = await calendar.stats(tsupId, { from: window.from, to: window.to, utilization: 'lt50' });
    expect(low.teachers.map((t) => t.id)).toEqual([s.teacherId]);
    const high = await calendar.stats(tsupId, { from: window.from, to: window.to, utilization: 'gte80' });
    expect(high.teachers).toEqual([]);
    const kids = await calendar.stats(tsupId, { from: window.from, to: window.to, learnerIds: learnerN });
    expect(kids.teachers.map((t) => t.id)).toEqual([s.teacherId]);
  });

  it('the Teacher File workload reads the same function, as one partition: available = booked + paused + free', async () => {
    const d = await stats.teacher(tsupId, s.teacherId, '2026-09');
    // September from the 1st: 26 Saturday-Thursday days less the day off, 7 hours each.
    expect(d.workload).toMatchObject({
      availableMinutes: 25 * 420,
      bookedWithinMinutes: 150, // 90 merged + 30 + the 30-minute trial
      pausedWithinMinutes: 60,
      freeMinutes: 24 * 420 + 210, // the 14th's empty 210 minutes, every other working day whole
      outsideMinutes: 30,
    });
    const w = d.workload as { availableMinutes: number; bookedWithinMinutes: number; pausedWithinMinutes: number; freeMinutes: number };
    expect(w.bookedWithinMinutes + w.pausedWithinMinutes + w.freeMinutes).toBe(w.availableMinutes);
  });
});

describe('the clock change (Cairo, Thursday 2026-10-29 at midnight)', () => {
  it('a shift is 12:00-19:00 on the wall clock on both sides of it', async () => {
    await fullShift(s.teacherId, '2026-10-01');
    await lessonAt(s.learnerId, '2026-10-29 12:00', 60);
    await lessonAt(s.learnerId, '2026-10-31 12:00', 60);
    const sum = await calendar.summary(tsupId, { from: '2026-10-29', to: '2026-11-01', teacherIds: s.teacherId });
    const day = (d: string) => sum.cells.find((c) => c.day === d)!;
    expect(day('2026-10-29')).toMatchObject({ shiftMinutes: 420, inShiftBookedMinutes: 60, outsideMinutes: 0, emptyMinutes: 360 });
    expect(day('2026-10-30')).toMatchObject({ shiftMinutes: 0, outsideMinutes: 0 }); // Friday off
    expect(day('2026-10-31')).toMatchObject({ shiftMinutes: 420, inShiftBookedMinutes: 60, outsideMinutes: 0, emptyMinutes: 360 });
    const cal = await calendar.calendar(tsupId, { from: '2026-10-29', to: '2026-11-01', teacherIds: s.teacherId });
    expect(cal.days.find((d) => d.day === '2026-10-29')!.shift).toEqual([['2026-10-29T09:00:00+00:00', '2026-10-29T16:00:00+00:00']]);
    expect(cal.days.find((d) => d.day === '2026-10-31')!.shift).toEqual([['2026-10-31T10:00:00+00:00', '2026-10-31T17:00:00+00:00']]);
  });

  it('a pattern change mid-month: each day counts under the pattern in force', async () => {
    await history(s.teacherId, [
      { category: 'full_shift', from: '2026-09-01', to: '2026-09-16' },
      { category: 'part_shift', from: '2026-09-16' },
    ]);
    const sum = await calendar.summary(tsupId, { from: '2026-09-14', to: '2026-09-18', teacherIds: s.teacherId });
    expect(sum.cells.map((c) => c.shiftMinutes)).toEqual([420, 420, 240, 240]);
    expect(sum.teachers[0].category).toBe('part_shift');
  });
});

describe('who sees what', () => {
  beforeEach(async () => {
    await fullShift(s.teacherId, '2026-09-01');
    await lessonAt(s.learnerId, '2026-09-14 13:00', 60); // admin_a's child
    await lessonAt(learnerN, '2026-09-14 14:00', 60); // admin_b's child
    await patterns.setColor(s.managerId, s.ownerId, { colorKey: 'sky' });
  });
  const w = { from: '2026-09-14', to: '2026-09-15' };

  it('the Teachers department, the Operations Manager and the super admin read the academy, names included', async () => {
    for (const viewer of [tsupId, tmgrId, s.managerId]) {
      const cal = await calendar.calendar(viewer, w);
      expect(cal.lessons.every((l) => 'learner' in l && l.learner !== null)).toBe(true);
    }
    expect((await calendar.options(s.managerId)).viewer).toMatchObject({ scope: 'academy', canEditColors: true, canEditShifts: false });
    expect((await calendar.options(tmgrId)).viewer).toMatchObject({ scope: 'academy', canEditShifts: true, canEditColors: false });
  });

  it('an Operations supervisor reads the capacity; another supervisor\'s child is an anonymous colored block', async () => {
    const cal = await calendar.calendar(s.otherAdminId, w);
    const mine = cal.lessons.find((l) => 'learner' in l && l.learner?.id === learnerN);
    expect(mine).toBeDefined();
    const other = cal.lessons.find((l) => 'anonymous' in l)!;
    expect(other).toMatchObject({ anonymous: true, colorKey: 'sky' });
    expect(JSON.stringify(other)).not.toContain(s.learnerId);
    expect(JSON.stringify(cal)).not.toContain('learner_l');
    const opts = await calendar.options(s.otherAdminId);
    expect(opts.viewer.scope).toBe('supervisor');
    expect(opts.learners.map((l) => l.id)).toEqual([learnerN]);
    // Filtering by a child outside the scope is "not found", not a probe.
    expect(await code(calendar.calendar(s.otherAdminId, { ...w, learnerIds: s.learnerId }))).toBe(CommErrorCode.LESSON_NOT_FOUND);
  });

  it('a teacher, a parent and Sales have no academy schedule', async () => {
    expect(await code(calendar.calendar(s.teacherId, w))).toBe(CommErrorCode.LESSON_DENIED);
    expect(await code(calendar.stats(s.parentId, w))).toBe(CommErrorCode.LESSON_DENIED);
    const salesId = randomUUID();
    await g.prisma.$executeRawUnsafe(`insert into chat.staff (id, name, role, is_active) values ($1::uuid, 'sales_a', 'admin', true)`, salesId);
    expect(await code(calendar.options(salesId))).toBe(CommErrorCode.LESSON_DENIED);
  });

  it('the stats access flag offers the calendar to exactly those who may open it', async () => {
    expect((await stats.access(tsupId)).calendar).toBe(true);
    expect((await stats.access(s.otherAdminId)).calendar).toBe(true);
    expect((await stats.access(s.teacherId)).calendar).toBe(false);
  });

  it('a window over 42 days, a bad day and a bad filter are refused', async () => {
    expect(await code(calendar.summary(tsupId, { from: '2026-09-01', to: '2026-10-14' }))).toBe(CommErrorCode.VALIDATION);
    expect(await code(calendar.summary(tsupId, { from: '2026-09-31', to: '2026-10-02' }))).toBe(CommErrorCode.VALIDATION);
    expect(await code(calendar.summary(tsupId, { ...w, statuses: 'void' }))).toBe(CommErrorCode.VALIDATION);
  });
});

describe('who counts, and history that stays put', () => {
  it('a teacher who left has no shift after leaving; one inactive without a date, or gone before the window, is not listed', async () => {
    await fullShift(s.newTeacherId, '2026-09-01');
    await fullShift(s.unrelatedTeacherId, '2026-09-01');
    // Left on Tuesday the 15th at 13:00 Cairo: one hour of that day's shift remains.
    await g.prisma.$executeRawUnsafe(
      `update chat.teacher set is_active = false, left_at = '2026-09-15 13:00'::timestamp at time zone '${TZ}' where id = $1::uuid`, s.newTeacherId,
    );
    const sum = await calendar.summary(tsupId, { from: '2026-09-14', to: '2026-09-17', teacherIds: s.newTeacherId });
    expect(sum.cells.map((c) => [c.day, c.shiftMinutes, c.emptyMinutes])).toEqual([
      ['2026-09-14', 420, 420], ['2026-09-15', 60, 60], ['2026-09-16', 0, 0],
    ]);
    // Inactive with no leaving date: not part of the academy's capacity at all.
    await g.prisma.$executeRawUnsafe(`update chat.teacher set is_active = false where id = $1::uuid`, s.unrelatedTeacherId);
    const all = await calendar.stats(tsupId, { from: '2026-09-14', to: '2026-09-17' });
    expect(all.teachers.map((t) => t.id)).not.toContain(s.unrelatedTeacherId);
    expect(all.teachers.map((t) => t.id)).toContain(s.newTeacherId);
    // A window that starts after the teacher left does not list them.
    const later = await calendar.stats(tsupId, { from: '2026-09-21', to: '2026-09-22' });
    expect(later.teachers.map((t) => t.id)).not.toContain(s.newTeacherId);
  });

  it('a past month keeps the hours it was worked under after a new shift replaces the bookable hours', async () => {
    await scheduling.setAvailability(tmgrId, s.teacherId, {
      timezone: TZ, windows: [1, 2, 3, 4, 5, 6, 7].map((weekday) => ({ weekday, start: '10:00', end: '12:00' })),
    });
    const week = { from: '2026-09-14', to: '2026-09-21', teacherIds: s.teacherId };
    const before = await calendar.summary(tsupId, week);
    const kpiBefore = (await stats.teacher(tsupId, s.teacherId, '2026-09')).workload;
    expect(before.teachers[0].totals.workMinutes).toBe(7 * 120);
    expect(kpiBefore.availableMinutes).toBe(30 * 120);

    // Today: a full shift that also becomes the bookable hours (12:00-19:00, Saturday-Thursday).
    await patterns.setPattern(tmgrId, s.teacherId, { category: 'full_shift', timezone: TZ, validFrom: await academyDay() });
    expect((await scheduling.availability(tmgrId, s.teacherId)).windows[0]).toMatchObject({ start: '12:00', end: '19:00' });

    const after = await calendar.summary(tsupId, week);
    expect(after.cells).toEqual(before.cells);
    expect((await stats.teacher(tsupId, s.teacherId, '2026-09')).workload).toEqual(kpiBefore);
  });

  it('filters naming another organization\'s teacher or child return nothing', async () => {
    const orgB = randomUUID();
    const staffB = randomUUID();
    const teacherB = randomUUID();
    const familyB = randomUUID();
    const learnerB = randomUUID();
    await g.prisma.$executeRawUnsafe(`insert into chat.organization (id, slug, display_name) values ($1::uuid, $2, 'org_b')`, orgB, `pd38-${orgB.slice(0, 8)}`);
    await g.prisma.$executeRawUnsafe(`insert into chat.staff (id, organization_id, name, role, is_active) values ($1::uuid, $2::uuid, 'admin_z', 'admin', true)`, staffB, orgB);
    await g.prisma.$executeRawUnsafe(`insert into chat.teacher (id, organization_id, name, is_active) values ($1::uuid, $2::uuid, 'teacher_z', true)`, teacherB, orgB);
    await g.prisma.$executeRawUnsafe(
      `insert into chat.family (id, organization_id, display_name, owner_id, language) values ($1::uuid, $2::uuid, 'family_z', $3::uuid, 'ar')`, familyB, orgB, staffB,
    );
    await withAssignmentGate(
      g.prisma,
      `insert into chat.learner (id, organization_id, family_id, name, teacher_id)
       values ('${learnerB}'::uuid, '${orgB}'::uuid, '${familyB}'::uuid, 'learner_z', '${teacherB}'::uuid)`,
    );
    await g.prisma.$executeRawUnsafe(
      `insert into chat.lesson (organization_id, learner_id, teacher_id, kind, starts_at, ends_at, created_by, created_by_kind)
       values ($1::uuid, $2::uuid, $3::uuid, 'regular', '2026-09-14 10:00+00', '2026-09-14 11:00+00', $4::uuid, 'staff')`,
      orgB, learnerB, teacherB, staffB,
    );
    const w = { from: '2026-09-14', to: '2026-09-15' };
    const byTeacher = await calendar.calendar(tsupId, { ...w, teacherIds: teacherB });
    expect(byTeacher.teachers).toEqual([]);
    expect(byTeacher.lessons).toEqual([]);
    const byChild = await calendar.stats(tsupId, { ...w, learnerIds: learnerB });
    expect(byChild.teachers).toEqual([]);
    expect(byChild.students.distinct).toBe(0);
    expect(byChild.teaching.lessons).toBe(0);
  });
});

describe('changing a shift and a color', () => {
  it('only the Teachers Manager or the super admin sets a shift; defaults fill it; from today it becomes the bookable hours', async () => {
    const today = await academyDay();
    expect(await code(patterns.setPattern(tsupId, s.teacherId, { category: 'full_shift', timezone: TZ, validFrom: today })))
      .toBe(CommErrorCode.LESSON_DENIED);
    const r = await patterns.setPattern(tmgrId, s.teacherId, { category: 'part_shift', timezone: TZ, validFrom: today });
    expect(r.today).toBe(today);
    expect(r.patterns[0]).toMatchObject({ category: 'part_shift', validFrom: today, validTo: null });
    expect(r.patterns[0].windows).toEqual(SAT_TO_THU.map((weekday) => ({ weekday, start: '14:00', end: '18:00' })).sort((a, b) => a.weekday - b.weekday));
    const av = await scheduling.availability(tmgrId, s.teacherId);
    expect(av.windows).toHaveLength(6);
    expect(av.windows[0]).toMatchObject({ start: '14:00', end: '18:00' });
  });

  it('a change closes the pattern in force; one that began the same day is replaced; a past or earlier start is refused', async () => {
    const today = await academyDay();
    const in10 = await academyDay(10);
    const in30 = await academyDay(30);
    await fullShift(s.teacherId, '2026-09-01');
    await patterns.setPattern(tmgrId, s.teacherId, { category: 'hourly', timezone: TZ, validFrom: today });
    let r = await patterns.pattern(tsupId, s.teacherId);
    expect(r.patterns.map((p) => [p.category, p.validFrom, p.validTo])).toEqual([
      ['hourly', today, null],
      ['full_shift', '2026-09-01', today],
    ]);
    await patterns.setPattern(tmgrId, s.teacherId, { category: 'part_shift', timezone: TZ, validFrom: today, applyToAvailability: false });
    r = await patterns.pattern(tsupId, s.teacherId);
    expect(r.patterns.map((p) => p.category)).toEqual(['part_shift', 'full_shift']);
    // A future change, without bookable hours (they change at once).
    await patterns.setPattern(tmgrId, s.teacherId, { category: 'full_shift', timezone: TZ, validFrom: in30 });
    expect(await code(patterns.setPattern(tmgrId, s.teacherId, { category: 'hourly', timezone: TZ, validFrom: in10 })))
      .toBe(CommErrorCode.LESSON_STATE);
    expect(await code(patterns.setPattern(tmgrId, s.teacherId, { category: 'hourly', timezone: TZ, validFrom: '2026-09-15' })))
      .toBe(CommErrorCode.VALIDATION);
    expect(await code(patterns.setPattern(tmgrId, s.teacherId, {
      category: 'full_shift', timezone: TZ, validFrom: in30, applyToAvailability: true,
    }))).toBe(CommErrorCode.VALIDATION);
    expect(await code(patterns.setPattern(tmgrId, s.teacherId, {
      category: 'hourly', timezone: TZ, validFrom: in30, windows: [{ weekday: 1, start: '10:00', end: '12:00' }],
    }))).toBe(CommErrorCode.VALIDATION);
    const rows = await g.prisma.$queryRawUnsafe<Array<{ n: number }>>(
      `select count(*)::int as n from chat.audit_log where action = 'teacher.work_pattern_set' and entity_id = $1::uuid`, s.teacherId,
    );
    expect(rows[0].n).toBe(3);
  });

  it('a shift and its bookable hours commit together: when the hours are refused, nothing is written', async () => {
    // A weekly lesson in another zone: PD-11 refuses bookable hours in Cairo.
    await g.prisma.$executeRawUnsafe(
      `insert into chat.learner_schedule_slot (organization_id, learner_id, teacher_id, weekday, start_minute, duration_minutes, timezone, valid_from, created_by)
       values (chat.default_organization_id(), $1::uuid, $2::uuid, 1, 1020, 30, 'Asia/Riyadh', '2026-09-01', $3::uuid)`,
      s.learnerId, s.teacherId, tmgrId,
    );
    expect(await code(patterns.setPattern(tmgrId, s.teacherId, { category: 'full_shift', timezone: TZ, validFrom: await academyDay() })))
      .toBe(CommErrorCode.LESSON_STATE);
    expect(await g.prisma.$queryRawUnsafe<unknown[]>(`select 1 from chat.teacher_work_pattern where teacher_id = $1::uuid`, s.teacherId)).toHaveLength(0);
    expect(await g.prisma.$queryRawUnsafe<unknown[]>(`select 1 from chat.teacher_availability where teacher_id = $1::uuid`, s.teacherId)).toHaveLength(0);
  });

  it('a change\'s reason is the Teachers department\'s; Operations reads the shift without it', async () => {
    await patterns.setPattern(tmgrId, s.teacherId, { category: 'part_shift', timezone: TZ, validFrom: await academyDay(), reason: 'reason_x' });
    expect((await patterns.pattern(tsupId, s.teacherId)).patterns[0].reason).toBe('reason_x');
    expect((await patterns.pattern(s.managerId, s.teacherId)).patterns[0]).toMatchObject({ category: 'part_shift', reason: null });
    expect((await patterns.pattern(s.otherAdminId, s.teacherId)).patterns[0].reason).toBeNull();
  });

  it('the database keeps a pattern append-only', async () => {
    await fullShift(s.teacherId, '2026-09-01');
    await expect(g.prisma.$executeRawUnsafe(`update chat.teacher_work_pattern set category = 'hourly'`)).rejects.toThrow(/closed by setting valid_to/);
    await expect(g.prisma.$executeRawUnsafe(`delete from chat.teacher_work_pattern`)).rejects.toThrow(/never deleted/);
    await expect(g.prisma.$executeRawUnsafe(
      `insert into chat.teacher_work_window (organization_id, pattern_id, weekday, start_minute, end_minute)
       select organization_id, id, 5, 600, 660 from chat.teacher_work_pattern`,
    )).rejects.toThrow(/written with its pattern/);
  });

  it('colors are the Operations Manager\'s, for Operations staff only, and a palette key', async () => {
    expect(await code(patterns.setColor(s.otherAdminId, s.ownerId, { colorKey: 'red' }))).toBe(CommErrorCode.LESSON_DENIED);
    expect(await code(patterns.setColor(s.managerId, tsupId, { colorKey: 'red' }))).toBe(CommErrorCode.LESSON_NOT_FOUND);
    expect(await code(patterns.setColor(s.managerId, s.ownerId, { colorKey: '#ff0000' }))).toBe(CommErrorCode.VALIDATION);
    expect(await patterns.setColor(s.managerId, s.ownerId, { colorKey: 'red' })).toMatchObject({ colorKey: 'red' });
    expect(await patterns.setColor(s.managerId, s.ownerId, { colorKey: null })).toMatchObject({ colorKey: null });
  });
});

describe('a month of 100 teachers', () => {
  it('the month summary and the stats answer within budget', async () => {
    const teacherIds = Array.from({ length: 100 }, () => randomUUID());
    await g.prisma.$executeRawUnsafe(
      `insert into chat.teacher (id, name, is_active) select unnest($1::uuid[]), 'perf_t', true`, teacherIds,
    );
    await g.prisma.$transaction([
      g.prisma.$executeRawUnsafe(`select set_config('chat.syncing_assignment', 'on', true)`),
      g.prisma.$executeRawUnsafe(
        `insert into chat.learner (family_id, name, teacher_id)
         select $1::uuid, 'perf_l', t from unnest($2::uuid[]) t, generate_series(1, 8)`,
        s.familyId, teacherIds,
      ),
    ]);
    // Two thirds on a shift, a third hourly with availability.
    await g.prisma.$transaction([
      g.prisma.$executeRawUnsafe(
        `insert into chat.teacher_work_pattern (organization_id, teacher_id, category, timezone, valid_from, created_by)
         select chat.default_organization_id(), t, case when n % 3 = 0 then 'hourly' when n % 3 = 1 then 'full_shift' else 'part_shift' end,
                '${TZ}', '2026-09-01', $2::uuid
           from unnest($1::uuid[]) with ordinality as x(t, n)`,
        teacherIds, tmgrId,
      ),
      g.prisma.$executeRawUnsafe(
        `insert into chat.teacher_work_window (organization_id, pattern_id, weekday, start_minute, end_minute)
         select p.organization_id, p.id, d, case when p.category = 'full_shift' then 720 else 840 end,
                case when p.category = 'full_shift' then 1140 else 1080 end
           from chat.teacher_work_pattern p, unnest(array[6, 7, 1, 2, 3, 4]) d
          where p.category <> 'hourly'`,
      ),
    ]);
    await g.prisma.$executeRawUnsafe(
      `insert into chat.teacher_availability (organization_id, teacher_id, weekday, start_minute, end_minute, timezone, created_by)
       select chat.default_organization_id(), p.teacher_id, d, 600, 1260, '${TZ}', $1::uuid
         from chat.teacher_work_pattern p, generate_series(1, 7) d where p.category = 'hourly'`,
      tmgrId,
    );
    // 8 lessons a day, 45 minutes each, every day of October (the clock change included).
    await g.prisma.$executeRawUnsafe(
      `insert into chat.lesson (organization_id, learner_id, teacher_id, kind, starts_at, ends_at, created_by, created_by_kind)
       select chat.default_organization_id(), l.id, l.teacher_id, 'regular', st, st + interval '45 minutes', $1::uuid, 'staff'
         from (select id, teacher_id, row_number() over (partition by teacher_id order by id) as k from chat.learner
                where name = 'perf_l') l,
              generate_series(date '2026-10-01', date '2026-10-31', interval '1 day') d,
              lateral (select ((d::date + time '12:00' + (l.k - 1) * interval '50 minutes') at time zone '${TZ}') as st) x`,
      tmgrId,
    );
    const [{ n }] = await g.prisma.$queryRawUnsafe<Array<{ n: number }>>(`select count(*)::int as n from chat.lesson`);
    expect(n).toBe(100 * 8 * 31);
    await g.prisma.$executeRawUnsafe('analyze chat.lesson');

    const month = { from: '2026-10-01', to: '2026-11-01' };
    const time = async <T>(f: () => Promise<T>): Promise<[T, number]> => {
      const t0 = performance.now();
      const r = await f();
      return [r, Math.round(performance.now() - t0)];
    };
    await calendar.summary(tmgrId, month); // warm
    const [sum, sumMs] = await time(() => calendar.summary(tmgrId, month));
    const [st, statsMs] = await time(() => calendar.stats(tmgrId, month));
    const [filtered, filteredMs] = await time(() => calendar.stats(tmgrId, { ...month, categories: 'full_shift', utilization: 'gte80' }));
    // The week view: every teacher's intervals and lessons, one statement.
    const [week, weekMs] = await time(() => calendar.calendar(tmgrId, { from: '2026-10-24', to: '2026-10-31' }));
    const [{ 'QUERY PLAN': plan }] = await g.prisma.$queryRawUnsafe<Array<{ 'QUERY PLAN': Array<{ 'Execution Time': number }> }>>(
      `explain (analyze, format json)
       select chat.mr_minutes(empty) from chat.calendar_capacity(chat.default_organization_id(), null, '2026-10-01', '2026-11-01', '${TZ}')`,
    );
    // eslint-disable-next-line no-console
    console.log(`PD-38 perf (100 teachers, ${n} lessons, one month): summary ${sumMs} ms, stats ${statsMs} ms, ` +
      `filtered stats ${filteredMs} ms, week calendar ${weekMs} ms, calendar_capacity ${Math.round(plan[0]['Execution Time'])} ms`);

    expect(sum.teachers.filter((t) => t.name === 'perf_t')).toHaveLength(100);
    expect(sum.cells.filter((c) => c.lessons === 8)).toHaveLength(100 * 31);
    expect(st.teaching.lessons).toBe(n);
    expect(st.students.distinct).toBe(800);
    // The day's lessons run 12:00-18:35. A full shift (12-19) holds them all; a
    // part shift (14-18) leaves 45 + 45 + 20 before it and 35 after it; on the 5
    // Fridays (no shift) all 360 minutes are outside. Hourly teachers' hours
    // (10-21, every day) hold them all. 34 full, 33 part, 33 hourly; 26 working days.
    expect(st.capacity.outsideMinutes).toBe(33 * (26 * 145 + 5 * 360) + 34 * 5 * 360);
    expect(filtered.teachers.every((t) => t.category === 'full_shift')).toBe(true);
    // The budget, with room for a loaded CI runner or laptop (measured there:
    // summary ~0.7-0.9 s, stats ~0.5 s, calendar_capacity ~0.2 s). Two traps
    // this guards: a per-lesson subquery (17 s) and a per-cell count (4.7 s).
    expect(week.lessons.filter((l) => l.teacherId !== s.teacherId)).toHaveLength(100 * 8 * 7);
    expect(week.days.filter((d) => (teacherIds as string[]).includes(d.teacherId))).toHaveLength(100 * 7);
    expect(sumMs).toBeLessThan(3_000);
    expect(statsMs).toBeLessThan(3_000);
    expect(weekMs).toBeLessThan(3_000);
  });
});
