/**
 * PD-11 T5 -- statistics. One definition per number (20261019100000), and who
 * may read which (PD-10).
 *
 * Every scenario reads the month its own lessons fall in (in the academy's
 * zone), so no assertion depends on the day the suite runs.
 *
 * Synthetic fixtures only (QA gate G-16).
 */
import { randomUUID } from 'node:crypto';
import { PrismaAuditService } from '@platform/audit.service';
import { CommError, CommErrorCode } from '@platform/errors';
import { LessonService } from '../../src/lessons/lesson.service';
import { SchedulingService } from '../../src/lessons/scheduling.service';
import { StatsService } from '../../src/lessons/stats.service';
import { buildGraph, seed, truncate, Scenario } from './harness';

const g = buildGraph();
const audit = new PrismaAuditService();
const lessons = new LessonService(g.prisma, g.authz, g.conversations, g.outbox, g.config, audit);
const scheduling = new SchedulingService(g.prisma, g.authz, g.conversations, lessons, g.outbox, g.config, g.reminders, audit);
const stats = new StatsService(g.prisma, g.conversations, lessons, scheduling, g.config);

const TZ = 'Africa/Cairo';
const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

let s: Scenario;
let groupId: string;
let tsupId: string;

async function code(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (e) {
    if (e instanceof CommError) return e.code;
    throw e;
  }
  throw new Error('expected a refusal, got success');
}

async function monthOf(at: Date): Promise<string> {
  const [{ m }] = await g.prisma.$queryRawUnsafe<Array<{ m: string }>>(
    `select to_char($1::timestamptz at time zone '${TZ}', 'YYYY-MM') as m`, at,
  );
  return m;
}

/** A lesson for learner_l at a fixed instant, `minutes` long. */
async function lessonAt(startsAt: Date, minutes: number): Promise<string> {
  return (await lessons.schedule(tsupId, {
    learnerId: s.learnerId,
    startsAt: startsAt.toISOString(),
    endsAt: new Date(startsAt.getTime() + minutes * MIN).toISOString(),
  })).id;
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
});

describe('the numbers', () => {
  it('a past month: every category, by length, with rates that divide only what they should', async () => {
    // September 2026 in Cairo: all of it is in the past whenever this runs.
    const day = (d: number, h: number) => new Date(Date.UTC(2026, 8, d, h));
    await lessons.report(s.teacherId, await lessonAt(day(2, 15), 30), { covered: 'a' });
    await lessons.report(s.teacherId, await lessonAt(day(3, 15), 30), { covered: 'b' });
    await lessons.report(s.teacherId, await lessonAt(day(4, 15), 60), { covered: 'c' });
    await lessons.absence(s.teacherId, await lessonAt(day(5, 15), 30), {});
    await lessons.teacherNoShow(tsupId, await lessonAt(day(6, 15), 60), { note: 'did not join' });
    await lessons.cancel(tsupId, await lessonAt(day(7, 15), 30), { reason: 'holiday' });
    await lessonAt(day(8, 15), 30); // never closed

    const d = await stats.teacher(tsupId, s.teacherId, '2026-09');
    const cat = (k: string) => d.categories.find((c) => c.key === k)!;
    expect(cat('held')).toMatchObject({ lessons: 3, minutes: 120 });
    expect(cat('held').byDuration).toEqual([
      { durationMinutes: 30, lessons: 2, minutes: 60 },
      { durationMinutes: 60, lessons: 1, minutes: 60 },
    ]);
    expect(cat('student_no_show').lessons).toBe(1);
    expect(cat('teacher_no_show').lessons).toBe(1);
    expect(cat('admin_cancelled').lessons).toBe(1);
    expect(cat('unreported')).toMatchObject({ lessons: 1, counted: false });
    expect(d.totals.counted).toEqual({ lessons: 6, minutes: 240 });
    expect(d.rates.attendance).toBe(0.75); // 3 held of 3 held + 1 absent
    expect(d.rates.completion).toBe(0.5); // 3 held of 6 closed and counted
    expect(d.rates.teacherReliability).toBe(0.833); // 5 of 6 not lost by the teacher
    // Reports written weeks after the lesson are not on time.
    expect(d.reports).toMatchObject({ reports: 3, onTime: 0, onTimeRate: 0 });
    expect(d.trials).toEqual({
      total: 0, conducted: 0, subscribed: 0, notSubscribed: 0, noShow: 0, awaiting: 0, upcoming: 0, cancelled: 0, conversionRate: null,
    });

    const list = await stats.teachers(tsupId, '2026-09');
    const mine = list.teachers.find((t) => t.teacher.id === s.teacherId)!;
    expect(mine).toMatchObject({ held: { lessons: 3, minutes: 120 }, unreported: { lessons: 1, minutes: 30 } });
    expect(mine.notHeld.lessons).toBe(3);
    // A teacher with no lessons is still listed, with nothing to divide.
    const idle = list.teachers.find((t) => t.teacher.id === s.unrelatedTeacherId)!;
    expect(idle.held.lessons).toBe(0);
    expect(idle.attendanceRate).toBeNull();
  });

  it('a report within 24 hours of the end is on time', async () => {
    const start = new Date(Date.now() - 2 * HOUR);
    await lessons.report(s.teacherId, await lessonAt(start, 30), { covered: 'x' });
    const d = await stats.teacher(tsupId, s.teacherId, await monthOf(start));
    expect(d.reports).toMatchObject({ reports: 1, onTime: 1, onTimeRate: 1 });
    expect(d.reports.medianDelayMinutes).toBeLessThanOrEqual(120);
  });

  it('apologies count; moved and paused lessons are shown but never counted', async () => {
    const at = new Date(Date.now() + 40 * DAY);
    const month = await monthOf(at);
    await lessons.apology(s.parentId, await lessonAt(at, 30), { reason: 'travel' });
    await lessons.teacherApology(s.teacherId, await lessonAt(new Date(at.getTime() + 2 * HOUR), 30), { reason: 'ill' });
    const moved = await lessonAt(new Date(at.getTime() + 4 * HOUR), 30);
    await g.prisma.lesson.update({
      where: { id: moved },
      data: { outcome: 'rescheduled', outcomeByKind: 'staff', outcomeBy: tsupId, outcomeAt: new Date(), outcomeNote: 'moved' },
    });
    const d = await stats.teacher(tsupId, s.teacherId, month);
    const cat = (k: string) => d.categories.find((c) => c.key === k)!;
    expect(cat('student_apology').lessons).toBe(1);
    expect(cat('teacher_apology').lessons).toBe(1);
    expect(cat('rescheduled')).toMatchObject({ lessons: 1, counted: false });
    expect(d.totals.counted.lessons).toBe(2);
    expect(d.workload.scheduledMinutes).toBe(60);
  });

  it('reply time: a family message answered by the teacher, measured only on published messages', async () => {
    await g.prisma.conversation.update({ where: { id: groupId }, data: { parentRequiresApproval: false, teacherRequiresApproval: false } });
    const asked = await g.messages.send({ conversationId: groupId, senderId: s.parentId, body: 'question', clientMessageId: randomUUID() });
    await g.messages.send({ conversationId: groupId, senderId: s.teacherId, body: 'answer', clientMessageId: randomUUID() });
    await g.messages.send({ conversationId: groupId, senderId: s.parentId, body: 'thanks', clientMessageId: randomUUID() });
    const d = await stats.teacher(tsupId, s.teacherId, await monthOf(new Date(asked.createdAt)));
    expect(d.replies).toMatchObject({ familyMessages: 2, answeredWithin: 1, rate: 0.5 });
    expect(d.replies.medianReplyMinutes).toBe(0);
  });

  it('workload: available hours are the weekly windows over the month, minus days off', async () => {
    await scheduling.setAvailability(tsupId, s.teacherId, {
      timezone: TZ,
      windows: [1, 2, 3, 4, 5, 6, 7].map((weekday) => ({ weekday, start: '10:00', end: '12:00' })),
    });
    await scheduling.addDayOff(tsupId, s.teacherId, { date: '2026-09-15', reason: 'leave' });
    const d = await stats.teacher(tsupId, s.teacherId, '2026-09');
    expect(d.workload.availableMinutes).toBe((30 - 1) * 120);
    // No availability recorded: unknown, not zero.
    expect((await stats.teacher(tsupId, s.newTeacherId, '2026-09')).workload.availableMinutes).toBeNull();
  });
});

describe('who reads what (PD-10)', () => {
  it('the organization\'s statistics are the Teachers department\'s; a teacher reads only their own', async () => {
    expect((await stats.access(tsupId)).lessonManager).toBe(true);
    expect((await stats.access(s.ownerId)).lessonManager).toBe(false);
    expect((await stats.access(s.teacherId)).lessonManager).toBe(false);
    expect(await code(stats.teachers(s.ownerId))).toBe(CommErrorCode.LESSON_DENIED);
    expect(await code(stats.teacher(s.teacherId, s.teacherId))).toBe(CommErrorCode.LESSON_DENIED);
    expect(await code(stats.mine(s.parentId))).toBe(CommErrorCode.LESSON_DENIED);
    const own = await stats.mine(s.teacherId, '2026-09');
    expect(own.teacher.id).toBe(s.teacherId);
    // The movements of learners are the department's, not the teacher's view.
    expect(own).not.toHaveProperty('movements');
    expect(await code(stats.teachers(tsupId, '2026-13'))).toBe(CommErrorCode.VALIDATION);
  });

  it('a family reads its child\'s progress, and nothing about anyone else\'s child', async () => {
    const day = (d: number) => new Date(Date.UTC(2026, 8, d, 15));
    await lessons.report(s.teacherId, await lessonAt(day(1), 30), { covered: 'Al-Fatiha', rating: 5 });
    await lessons.absence(s.teacherId, await lessonAt(day(2), 30), {});
    await lessons.report(s.teacherId, await lessonAt(day(3), 30), { covered: 'Al-Ikhlas' });
    await lessons.report(s.teacherId, await lessonAt(day(4), 30), { covered: 'Al-Falaq' });
    const missed = await lessonAt(new Date(Date.now() + 3 * DAY), 30);
    await lessons.teacherApology(s.teacherId, missed, { reason: 'ill' });

    const p = await stats.progress(s.parentId, s.learnerId, '2026-09');
    expect(p.thisMonth).toMatchObject({ attended: 3, absent: 1, apologised: 0 });
    expect(p.allTime.attended).toBe(3);
    expect(p.streak).toBe(2); // the absence on the 2nd ended the earlier run
    expect(p.makeupsOwed).toBe(1);
    expect(p.lastReport?.covered).toBe('Al-Falaq');
    expect(p.certificates).toEqual([]);
    expect(await code(stats.progress(s.unrelatedTeacherId, s.learnerId))).toBe(CommErrorCode.LESSON_NOT_FOUND);
  });
});
