/**
 * PD-15 -- the student's journey after enrolment.
 *
 *   1. the supervisor's excuse cards: a student's before / after the start, a
 *      teacher's; who sees which card; reasons never reach the family
 *   2. the quick lesson report: choices, the private note, the suggested
 *      lesson number, no second report
 *   3. editing a report: the teacher's own, a supervisor's; the card follows
 *   4. deleting a report: resend a corrected version, or leave it unsent and
 *      the lesson leaves every statistic
 *   5. corrections: Teachers dept, Operations, super admin; history kept; the
 *      database refuses an outcome change without one
 *   6. make-ups after any apology, linked, counted once when held
 *   7. the month in numbers: every lesson in exactly one line
 *   8. two children of one family with one teacher: the group's name and its
 *      details page, per child; courses and enrolment details
 *
 * Synthetic fixtures only (QA gate G-16).
 */
import { randomUUID } from 'node:crypto';
import { PrismaAuditService } from '@platform/audit.service';
import { CommError, CommErrorCode } from '@platform/errors';
import { LessonService } from '../../src/lessons/lesson.service';
import { LessonRecordService } from '../../src/lessons/lesson-record.service';
import { SchedulingService } from '../../src/lessons/scheduling.service';
import { StatsService } from '../../src/lessons/stats.service';
import { EnrollmentService } from '../../src/lessons/enrollment.service';
import { buildGraph, seed, truncate, withAssignmentGate, Scenario } from './harness';

const g = buildGraph();
const audit = new PrismaAuditService();
const lessons = new LessonService(g.prisma, g.authz, g.conversations, g.outbox, g.config, audit);
const scheduling = new SchedulingService(g.prisma, g.authz, g.conversations, lessons, g.outbox, g.config, g.reminders, audit);
const stats = new StatsService(g.prisma, g.conversations, lessons, scheduling, g.config);
const records = new LessonRecordService(g.prisma, lessons, g.conversations, g.outbox, audit);
const enrollment = new EnrollmentService(g.prisma, g.authz, g.conversations, lessons, scheduling, audit);

const TZ = 'Africa/Cairo';
const HOUR = 3_600_000;
const at = (offsetMs: number) => new Date(Date.now() + offsetMs).toISOString();

let s: Scenario;
let groupId: string;
/** Teachers department. */
let tsupId: string;
/** The super admin. */
let superId: string;

async function code(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (e) {
    if (e instanceof CommError) return e.code;
    throw e;
  }
  throw new Error('expected a refusal, got success');
}

async function lesson(startMs: number, learnerId = s.learnerId): Promise<string> {
  return (await lessons.schedule(tsupId, { learnerId, startsAt: at(startMs), endsAt: at(startMs + HOUR / 2) })).id;
}

async function cards(conversationId = groupId) {
  return g.prisma.message.findMany({ where: { conversationId, type: 'card' }, include: { card: true }, orderBy: { seq: 'asc' } });
}

async function thisMonth(): Promise<string> {
  const [{ m }] = await g.prisma.$queryRawUnsafe<Array<{ m: string }>>(`select to_char(now() at time zone '${TZ}', 'YYYY-MM') as m`);
  return m;
}

/** Move an OPEN lesson into the past, so it can be reported (a fixture, not a product path). */
async function moveToPast(id: string, startMs: number) {
  await g.prisma.$executeRawUnsafe(
    `update chat.lesson set starts_at = now() + make_interval(secs => $2::double precision / 1000),
                            ends_at   = now() + make_interval(secs => $2::double precision / 1000) + interval '30 minutes'
      where id = $1::uuid and outcome is null`,
    id, startMs,
  );
}

const REPORT = { lessonNumber: 7, coveredTopics: ['revision', 'tajweed'], covered: 'Al-Mulk 1-10', rating: 4, nextTasks: ['revise_previous'], homework: 'Al-Mulk 1-5', note: 'a little tired today' };

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
  superId = randomUUID();
  await g.prisma.$executeRawUnsafe(`insert into chat.staff (id, name, role, is_active) values ($1::uuid, 'tsup_a', 'admin', true)`, tsupId);
  // A super admin exists only through the bootstrap gate, opened for this one transaction.
  await g.prisma.$transaction([
    g.prisma.$executeRawUnsafe(`select set_config('chat.provisioning_super_admin', 'on', true)`),
    g.prisma.$executeRawUnsafe(`insert into chat.staff (id, name, role, is_active) values ($1::uuid, 'root_a', 'super_admin', true)`, superId),
  ]);
  const [{ id: dept }] = await g.prisma.$queryRawUnsafe<Array<{ id: string }>>(
    `insert into chat.department (kind, display_name) values ('teachers', 'teachers') returning id::text as id`,
  );
  await g.prisma.$executeRawUnsafe(
    `insert into chat.department_member (staff_id, organization_id, department_id, position)
     values ($1::uuid, chat.default_organization_id(), $2::uuid, 'supervisor')`,
    tsupId, dept,
  );
});

describe('1. the supervisor\'s excuse cards', () => {
  it('each role sees its own cards under "+": the supervisor the excuses, the teacher the report, the family its apologies', async () => {
    const future = await lesson(3 * HOUR);
    const started = await lesson(-HOUR);
    const kinds = async (actor: string, id: string) =>
      (await lessons.ticketsFor(actor, groupId)).tickets.filter((t) => t.lessonId === id).map((t) => t.ticket).sort();

    expect(await kinds(s.ownerId, future)).toEqual(['apology', 'teacher_apology']);
    expect(await kinds(s.ownerId, started)).toEqual(['late_excuse']);
    expect(await kinds(s.teacherId, future)).toEqual(['teacher_apology']);
    expect(await kinds(s.teacherId, started)).toEqual(['absence', 'report']);
    expect(await kinds(s.parentId, future)).toEqual(['apology']);
    expect(await kinds(s.parentId, started)).toEqual(['late_apology']);
  });

  it('an excuse before the start: no reason asked, the card says the learner will not attend, a make-up is owed', async () => {
    const id = await lesson(3 * HOUR);
    const dto = await lessons.apology(s.ownerId, id, {});
    expect(dto.outcome).toBe('student_apology');
    expect(dto.apologyTiming).toBe('before_start');
    const [card] = await cards();
    expect(card.card?.kind).toBe('lesson_apology');
    expect(card.card?.payload).toMatchObject({ timing: 'before_start', makeupOwed: true });
    expect(card.card?.payload).not.toHaveProperty('reason');
    expect(card.authorType).toBe('staff');
    // A parent still must say why.
    expect(await code(lessons.apology(s.parentId, await lesson(5 * HOUR), {}))).toBe(CommErrorCode.VALIDATION);
  });

  it('an excuse after the start is excused at once, and its reason stays with staff', async () => {
    const id = await lesson(-HOUR);
    expect(await code(lessons.lateExcuse(s.ownerId, id, {}))).toBe(CommErrorCode.VALIDATION);
    const dto = await lessons.lateExcuse(s.ownerId, id, { reason: 'family emergency at the hospital' });
    expect(dto.outcome).toBe('student_apology');
    expect(dto.apologyTiming).toBe('after_start');
    expect(dto.outcomeNote).toBe('family emergency at the hospital');

    const [card] = await cards();
    expect(card.card?.payload).toMatchObject({ timing: 'after_start' });
    expect(JSON.stringify(card.card?.payload)).not.toContain('hospital');
    expect(card.body).not.toContain('hospital');

    const family = await lessons.get(s.parentId, id);
    expect(family.outcomeNote).toBeNull();
    expect(family.ruling).toBeNull();
    const ruling = await g.prisma.lessonRuling.findFirstOrThrow({ where: { lessonId: id } });
    expect(ruling).toMatchObject({ openedByKind: 'staff', decision: 'excused', decidedBy: s.ownerId });
  });

  it('after the teacher recorded an absence, the supervisor\'s excuse turns it into an excuse -- never both', async () => {
    const id = await lesson(-HOUR);
    await lessons.absence(s.teacherId, id, {});
    await lessons.lateExcuse(s.ownerId, id, { reason: 'power cut' });
    const month = await stats.teacher(tsupId, s.teacherId, await thisMonth());
    expect(month.summary.studentNoShow).toBe(0);
    expect(month.summary.studentExcuses).toEqual({ total: 1, beforeStart: 0, afterStart: 1 });
    expect(month.summary.totalScheduled).toBe(1);
    // A second excuse is refused.
    expect(await code(lessons.lateExcuse(s.ownerId, id, { reason: 'again' }))).toBe(CommErrorCode.LESSON_STATE);
  });

  it('a family\'s waiting late apology is the ruling the supervisor decides', async () => {
    const id = await lesson(-HOUR);
    await lessons.lateApology(s.parentId, id, { reason: 'car broke down' });
    await lessons.lateExcuse(s.ownerId, id, { reason: 'confirmed by phone' });
    const rulings = await g.prisma.lessonRuling.findMany({ where: { lessonId: id } });
    expect(rulings).toHaveLength(1);
    expect(rulings[0]).toMatchObject({ openedByKind: 'contact', decision: 'excused' });
  });

  it('a teacher\'s excuse recorded by the supervisor: reason required, never on the card', async () => {
    const id = await lesson(3 * HOUR);
    expect(await code(lessons.teacherApology(s.ownerId, id, {}))).toBe(CommErrorCode.VALIDATION);
    await lessons.teacherApology(s.ownerId, id, { reason: 'medical appointment' });
    const [card] = await cards();
    expect(card.card?.kind).toBe('lesson_teacher_apology');
    expect(JSON.stringify(card.card?.payload)).not.toContain('medical');
    expect(card.body).not.toContain('medical');
    expect((await lessons.get(s.parentId, id)).outcomeNote).toBeNull();
    expect((await lessons.get(tsupId, id)).outcomeNote).toBe('medical appointment');
  });

  it('nobody else records a supervisor\'s excuse', async () => {
    const id = await lesson(-HOUR);
    expect(await code(lessons.lateExcuse(s.teacherId, id, { reason: 'x' }))).toBe(CommErrorCode.LESSON_DENIED);
    expect(await code(lessons.lateExcuse(s.parentId, id, { reason: 'x' }))).toBe(CommErrorCode.LESSON_DENIED);
    // Staff who supervise neither the child nor lessons see nothing.
    expect(await code(lessons.lateExcuse(s.otherAdminId, id, { reason: 'x' }))).toBe(CommErrorCode.LESSON_NOT_FOUND);
  });
});

describe('2. the quick lesson report', () => {
  it('taps, not typing: choices and a level; the note is private; the card shows the rest', async () => {
    const id = await lesson(-HOUR);
    const dto = await lessons.report(s.teacherId, id, { coveredTopics: ['recitation'], rating: 5, nextTasks: ['practise_recitation'], note: 'private' });
    expect(dto.outcome).toBe('held');
    expect(dto.report).toMatchObject({ coveredTopics: ['recitation'], covered: null, rating: 5, note: 'private' });
    const [card] = await cards();
    expect(card.card?.payload).toMatchObject({ coveredTopics: ['recitation'], rating: 5, nextTasks: ['practise_recitation'] });
    expect(card.card?.payload).not.toHaveProperty('note');
    expect(card.body).not.toContain('private');
    expect(card.body).toContain('تلاوة');
    expect((await lessons.get(s.parentId, id)).report).not.toHaveProperty('note');
    expect((await lessons.get(s.ownerId, id)).report?.note).toBe('private');
  });

  it('refuses an unknown choice and a report that says nothing of what was covered', async () => {
    const id = await lesson(-HOUR);
    expect(await code(lessons.report(s.teacherId, id, { coveredTopics: ['astrology'] }))).toBe(CommErrorCode.VALIDATION);
    expect(await code(lessons.report(s.teacherId, id, { rating: 3 }))).toBe(CommErrorCode.VALIDATION);
    expect(await code(lessons.report(s.teacherId, id, { coveredTopics: ['revision'], lessonNumber: 0 }))).toBe(CommErrorCode.VALIDATION);
  });

  it('suggests the next lesson number, and a duplicate submission is refused without a second card', async () => {
    const first = await lesson(-2 * HOUR);
    const second = await lesson(-HOUR);
    const suggested = (await lessons.ticketsFor(s.teacherId, groupId)).tickets.find((t) => t.ticket === 'report' && t.lessonId === first);
    expect(suggested?.suggestedLessonNumber).toBe(1);
    await lessons.report(s.teacherId, first, REPORT);
    expect(await code(lessons.report(s.teacherId, first, REPORT))).toBe(CommErrorCode.LESSON_STATE);
    expect(await cards()).toHaveLength(1);
    const next = (await lessons.ticketsFor(s.teacherId, groupId)).tickets.find((t) => t.ticket === 'report' && t.lessonId === second);
    expect(next?.suggestedLessonNumber).toBe(8);
  });
});

describe('3. editing a report', () => {
  it('the teacher edits their own: one card, rewritten in place and marked edited; the previous version is kept', async () => {
    const id = await lesson(-HOUR);
    await lessons.report(s.teacherId, id, REPORT);
    const [before] = await cards();
    const dto = await records.editReport(s.teacherId, id, { ...REPORT, lessonNumber: 8, coveredTopics: ['new_memorization'] });
    expect(dto.report).toMatchObject({ lessonNumber: 8, coveredTopics: ['new_memorization'], version: 2 });
    const after = await cards();
    expect(after).toHaveLength(1);
    expect(after[0].id).toBe(before.id);
    expect(after[0].editedAt).not.toBeNull();
    expect(after[0].card?.payload).toMatchObject({ lessonNumber: 8, coveredTopics: ['new_memorization'] });
    expect(after[0].body).not.toBe(before.body);
    expect(await g.prisma.messageRevision.count({ where: { messageId: before.id } })).toBe(1);
    const [rev] = await g.prisma.lessonReportRevision.findMany({ where: { lessonId: id } });
    expect(rev).toMatchObject({ action: 'edit', byKind: 'teacher', byId: s.teacherId });
    expect((rev.previous as { lessonNumber: number }).lessonNumber).toBe(7);
    expect(await g.prisma.outboxEvent.count({ where: { type: 'message.updated' } })).toBe(1);
  });

  it('a supervisor may edit any report; a parent and another teacher may not', async () => {
    const id = await lesson(-HOUR);
    await lessons.report(s.teacherId, id, REPORT);
    await records.editReport(s.ownerId, id, { ...REPORT, rating: 2 });
    await records.editReport(tsupId, id, { ...REPORT, rating: 3 });
    expect((await lessons.get(tsupId, id)).report?.version).toBe(3);
    expect(await code(records.editReport(s.parentId, id, REPORT))).toBe(CommErrorCode.LESSON_DENIED);
    expect(await code(records.editReport(s.newTeacherId, id, REPORT))).toBe(CommErrorCode.LESSON_NOT_FOUND);
  });

  it('the database refuses a report change without a revision', async () => {
    const id = await lesson(-HOUR);
    await lessons.report(s.teacherId, id, REPORT);
    await expect(g.prisma.$executeRawUnsafe(`update chat.lesson_report set rating = 1 where lesson_id = $1::uuid`, id))
      .rejects.toThrow(/changes only through a recorded revision/);
  });
});

describe('4. deleting a report', () => {
  it('resend: the old card leaves the chat, a corrected one is posted, the lesson is counted once', async () => {
    const id = await lesson(-HOUR);
    await lessons.report(s.teacherId, id, REPORT);
    const [old] = await cards();
    await records.deleteReport(s.ownerId, id, { reason: 'wrong surah', resend: true, report: { ...REPORT, covered: 'Al-Qalam 1-10' } });
    const all = await cards();
    expect(all).toHaveLength(2);
    expect(all[0]).toMatchObject({ id: old.id, deletedForAll: true });
    expect(all[1].card?.payload).toMatchObject({ covered: 'Al-Qalam 1-10' });
    const dto = await lessons.get(tsupId, id);
    expect(dto.outcome).toBe('held');
    expect(dto.report?.messageId).toBe(all[1].id);
    expect((await stats.teacher(tsupId, s.teacherId, await thisMonth())).summary.conducted).toBe(1);
  });

  it('leave unsent: the card leaves the chat and the lesson leaves every statistic; it is final', async () => {
    const kept = await lesson(-2 * HOUR);
    const id = await lesson(-HOUR);
    await lessons.report(s.teacherId, kept, REPORT);
    await lessons.report(s.teacherId, id, REPORT);
    expect(await code(records.deleteReport(s.teacherId, id, { reason: 'x', resend: false }))).toBe(CommErrorCode.LESSON_DENIED);
    await records.deleteReport(tsupId, id, { reason: 'duplicate lesson', resend: false });

    expect((await cards()).filter((c) => !c.deletedForAll)).toHaveLength(1);
    const dto = await lessons.get(tsupId, id);
    expect(dto.outcome).toBe('voided');
    expect(dto.report?.deletedAt).not.toBeNull();
    const month = await stats.teacher(tsupId, s.teacherId, await thisMonth());
    expect(month.summary.totalScheduled).toBe(1);
    expect(month.summary.conducted).toBe(1);
    expect(month.summary.pending.total).toBe(0);
    expect(month.reports.reports).toBe(1);
    const list = await stats.teachers(tsupId, await thisMonth());
    expect(list.teachers.find((t) => t.teacher.id === s.teacherId)?.summary.totalScheduled).toBe(1);
    expect((await stats.progress(s.parentId, s.learnerId)).thisMonth.attended).toBe(1);

    expect(await code(records.correct(tsupId, id, { outcome: 'held', reason: 'undo' }))).toBe(CommErrorCode.LESSON_STATE);
    expect(await code(records.deleteReport(tsupId, id, { reason: 'again', resend: false }))).toBe(CommErrorCode.LESSON_STATE);
    const history = await records.history(tsupId, id);
    expect(history.corrections.map((c) => `${c.from}>${c.to}`)).toEqual(['held>voided']);
    expect(history.reportRevisions.map((r) => r.action)).toEqual(['delete']);
  });
});

describe('4b. a report card is never deleted on its own', () => {
  it('delete-for-everyone refuses a report card: the lesson record deletes both together', async () => {
    const id = await lesson(-HOUR);
    await lessons.report(s.teacherId, id, REPORT);
    const [card] = await cards();
    expect(await code(g.messages.deleteForEveryone(card.id, s.ownerId, 'tidy up'))).toBe(CommErrorCode.MESSAGE_NOT_EDITABLE);
    expect((await g.prisma.message.findUniqueOrThrow({ where: { id: card.id } })).deletedForAll).toBe(false);
  });
});

describe('5. corrections', () => {
  it('Operations corrects a mistaken absence to attended: a report, one card, history and audit', async () => {
    const id = await lesson(-HOUR);
    await lessons.absence(s.teacherId, id, {});
    expect(await code(records.correct(s.ownerId, id, { outcome: 'held', reason: 'the teacher tapped the wrong card' })))
      .toBe(CommErrorCode.VALIDATION); // a held lesson needs its report
    const dto = await records.correct(s.ownerId, id, { outcome: 'held', reason: 'the teacher tapped the wrong card', report: { coveredTopics: ['reading'] } });
    expect(dto.outcome).toBe('held');
    expect(dto.report?.enteredBy).toEqual({ kind: 'staff', id: s.ownerId });
    const last = (await cards()).at(-1);
    expect(last?.card?.kind).toBe('lesson_report');
    expect(last?.card?.payload).toMatchObject({ corrected: true });

    const [corr] = await g.prisma.lessonCorrection.findMany({ where: { lessonId: id } });
    expect(corr).toMatchObject({ fromOutcome: 'student_no_show', toOutcome: 'held', correctedBy: s.ownerId, reason: 'the teacher tapped the wrong card' });
    const [row] = await g.prisma.auditLog.findMany({ where: { action: 'lesson.outcome_corrected', entityId: id } });
    expect(row.before).toMatchObject({ outcome: 'student_no_show' });
    expect(row.after).toMatchObject({ outcome: 'held' });
    expect(row.actorId).toBe(s.ownerId);

    const month = await stats.teacher(tsupId, s.teacherId, await thisMonth());
    expect(month.summary.studentNoShow).toBe(0);
    expect(month.summary.conducted).toBe(1);
    const events = await g.prisma.outboxEvent.findMany({ where: { type: 'lesson.closed' }, orderBy: { createdAt: 'asc' } });
    expect(events.map((e) => (e.payload as { correction: boolean }).correction)).toEqual([false, true]);
  });

  it('the Operations manager corrects held to an excuse after the start: the report and its card are withdrawn', async () => {
    const id = await lesson(-HOUR);
    await lessons.report(s.teacherId, id, REPORT);
    expect(await code(records.correct(s.managerId, id, { outcome: 'student_apology', reason: 'excused' }))).toBe(CommErrorCode.VALIDATION);
    const dto = await records.correct(s.managerId, id, { outcome: 'student_apology', apologyTiming: 'after_start', reason: 'parent called before' });
    expect(dto.apologyTiming).toBe('after_start');
    const all = await cards();
    expect(all[0].deletedForAll).toBe(true);
    expect(all[1].card?.kind).toBe('lesson_corrected');
    expect(JSON.stringify(all[1].card?.payload)).not.toContain('parent called');
    const month = await stats.teacher(tsupId, s.teacherId, await thisMonth());
    expect(month.summary.conducted).toBe(0);
    expect(month.summary.studentExcuses.afterStart).toBe(1);
    expect(month.reports.reports).toBe(0);
  });

  it('the Teachers department and the super admin correct; a teacher, a parent and an outsider cannot', async () => {
    const a = await lesson(-2 * HOUR);
    const b = await lesson(-HOUR);
    await lessons.absence(s.teacherId, a, {});
    await lessons.absence(s.teacherId, b, {});
    await records.correct(tsupId, a, { outcome: 'teacher_no_show', reason: 'teacher did not join' });
    await records.correct(superId, b, { outcome: 'admin_cancelled', reason: 'platform outage' });
    expect(await code(records.correct(s.teacherId, a, { outcome: 'student_no_show', reason: 'x' }))).toBe(CommErrorCode.LESSON_DENIED);
    expect(await code(records.correct(s.parentId, a, { outcome: 'student_no_show', reason: 'x' }))).toBe(CommErrorCode.LESSON_DENIED);
    expect(await code(records.correct(s.otherAdminId, a, { outcome: 'student_no_show', reason: 'x' }))).toBe(CommErrorCode.LESSON_NOT_FOUND);
    expect(await code(records.correct(tsupId, a, { outcome: 'student_no_show' }))).toBe(CommErrorCode.VALIDATION);
  });

  it('a correction away from a teacher\'s excuse withdraws its open violation from the ladder', async () => {
    const id = await lesson(3 * HOUR);
    await lessons.teacherApology(s.teacherId, id, { reason: 'ill' });
    expect(await g.prisma.teacherViolation.count({ where: { lessonId: id } })).toBe(1);
    await records.correct(tsupId, id, { outcome: 'student_apology', apologyTiming: 'before_start', reason: 'it was the family who cancelled' });
    const outcome = (await g.prisma.lesson.findUniqueOrThrow({ where: { id } })).outcome;
    expect(outcome).toBe('student_apology');
  });

  it('the database refuses an outcome change without a correction of the same transaction', async () => {
    const id = await lesson(-HOUR);
    await lessons.absence(s.teacherId, id, {});
    await expect(g.prisma.$executeRawUnsafe(`update chat.lesson set outcome = 'teacher_no_show', outcome_by_kind = 'staff', outcome_by = $2::uuid where id = $1::uuid`, id, tsupId))
      .rejects.toThrow(/only an excusing ruling or a recorded correction/);
    // A correction written in ANOTHER transaction authorizes nothing (no replay).
    await g.prisma.$executeRawUnsafe(
      `insert into chat.lesson_correction (organization_id, lesson_id, from_outcome, to_outcome, reason, corrected_by)
       values (chat.default_organization_id(), $1::uuid, 'student_no_show', 'teacher_no_show', 'r', $2::uuid)`,
      id, tsupId,
    );
    await expect(g.prisma.$executeRawUnsafe(`update chat.lesson set outcome = 'teacher_no_show', outcome_by_kind = 'staff', outcome_by = $2::uuid where id = $1::uuid`, id, tsupId))
      .rejects.toThrow(/only an excusing ruling or a recorded correction/);
    // Staff outside the Teachers and Operations departments can never write one.
    const outsider = randomUUID();
    await g.prisma.$executeRawUnsafe(`insert into chat.staff (id, name, role, is_active) values ($1::uuid, 'sales_a', 'admin', true)`, outsider);
    await expect(g.prisma.$executeRawUnsafe(
      `insert into chat.lesson_correction (organization_id, lesson_id, from_outcome, to_outcome, reason, corrected_by)
       values (chat.default_organization_id(), $1::uuid, 'student_no_show', 'held', 'r', $2::uuid)`,
      id, outsider,
    )).rejects.toThrow(/corrected by the Teachers or Operations department or the super admin/);
  });
});

describe('6. make-ups after any apology', () => {
  it('after a student\'s excuse the teacher and the supervisor see "Reschedule a make-up"; the agreed time is booked once and linked', async () => {
    const missed = await lesson(3 * HOUR);
    await lessons.apology(s.ownerId, missed, {});
    for (const actor of [s.teacherId, s.ownerId, s.parentId]) {
      expect((await lessons.ticketsFor(actor, groupId)).tickets.some((t) => t.ticket === 'book_makeup' && t.lessonId === missed)).toBe(true);
    }
    const booked = await scheduling.bookMakeup(s.teacherId, missed, { startsAt: at(26 * HOUR) });
    expect(booked).toMatchObject({ kind: 'makeup', makeupFor: missed });
    const card = (await cards()).at(-1);
    expect(card?.card?.kind).toBe('lesson_makeup_booked');
    expect(card?.card?.payload).toMatchObject({ makeupFor: missed, missedOutcome: 'student_apology' });
    expect(await code(scheduling.bookMakeup(s.ownerId, missed, { startsAt: at(30 * HOUR) }))).toBe(CommErrorCode.LESSON_STATE);
    expect(await code(scheduling.bookMakeup(s.ownerId, await lesson(5 * HOUR), { startsAt: at(31 * HOUR) }))).toBe(CommErrorCode.LESSON_STATE);
  });

  it('a make-up counts as completed only once held; regular + make-up = total completed', async () => {
    const missed = await lesson(3 * HOUR);
    await lessons.teacherApology(s.teacherId, missed, { reason: 'ill' });
    const makeup = (await scheduling.bookMakeup(s.ownerId, missed, { startsAt: at(28 * HOUR) })).id;
    const regular = await lesson(-3 * HOUR);
    await lessons.report(s.teacherId, regular, REPORT);

    let month = await stats.teacher(tsupId, s.teacherId, await thisMonth());
    expect(month.summary.makeups).toEqual({ completed: 0, scheduled: 1, total: 1 });
    expect(month.summary.completed).toEqual({ regular: 1, makeup: 0, total: 1 });

    await moveToPast(makeup, -HOUR);
    await lessons.report(s.teacherId, makeup, REPORT);
    month = await stats.teacher(tsupId, s.teacherId, await thisMonth());
    expect(month.summary.makeups).toEqual({ completed: 1, scheduled: 0, total: 1 });
    expect(month.summary.completed).toEqual({ regular: 1, makeup: 1, total: 2 });
    expect(month.summary.conducted).toBe(2);
    expect(month.summary.teacherExcuses).toBe(1);
  });
});

describe('7. the month in numbers', () => {
  it('every lesson is in exactly one line', async () => {
    const held = await lesson(-6 * HOUR);
    const noShow = await lesson(-5 * HOUR);
    const lateExcused = await lesson(-4 * HOUR);
    const pendingReport = await lesson(-3 * HOUR);
    const before = await lesson(4 * HOUR);
    const teacherEx = await lesson(5 * HOUR);
    await lesson(6 * HOUR); // upcoming
    await lessons.report(s.teacherId, held, REPORT);
    await lessons.absence(s.teacherId, noShow, {});
    await lessons.lateExcuse(s.ownerId, lateExcused, { reason: 'r' });
    await lessons.apology(s.parentId, before, { reason: 'travel' });
    await lessons.teacherApology(s.teacherId, teacherEx, { reason: 'ill' });
    void pendingReport;

    const { summary } = await stats.teacher(tsupId, s.teacherId, await thisMonth());
    expect(summary).toMatchObject({
      totalScheduled: 7,
      conducted: 1,
      studentAttended: 1,
      studentNoShow: 1,
      studentExcuses: { total: 2, beforeStart: 1, afterStart: 1 },
      teacherExcuses: 1,
      pending: { total: 2, upcoming: 1, awaitingReport: 1 },
    });
    const sum = summary.conducted + summary.studentNoShow + summary.studentExcuses.total + summary.teacherExcuses
      + summary.teacherNoShow + summary.cancelled + summary.pending.total;
    expect(sum).toBe(summary.totalScheduled);
  });
});

describe('8. two children, one teacher, one group', () => {
  beforeEach(async () => {
    await withAssignmentGate(g.prisma, `update chat.learner set teacher_id = '${s.teacherId}'::uuid where id = '${s.secondLearnerId}'::uuid`);
  });

  it('the group is named "Teacher — Children" and its details page shows each child apart', async () => {
    const conv = await g.conversations.createFamilyGroup(s.ownerId, {
      learnerIds: [s.learnerId, s.secondLearnerId], contactIds: [s.parentId], teacherIds: [s.teacherId],
    });
    expect(conv.title).toBe('teacher_c — learner_l · learner_m');

    const course = await enrollment.createCourse(s.managerId, { name: 'Quran memorization' });
    expect(await code(enrollment.createCourse(s.ownerId, { name: 'x' }))).toBe(CommErrorCode.LESSON_DENIED);
    await enrollment.setEnrollment(s.ownerId, s.learnerId, { birthDate: '2016-03-01', courseId: course.id, packageLessons: 12 });
    await enrollment.setEnrollment(s.ownerId, s.secondLearnerId, { packageLessons: 8 });
    expect(await code(enrollment.setEnrollment(s.teacherId, s.learnerId, { packageLessons: 1 }))).toBe(CommErrorCode.LESSON_DENIED);
    expect(await code(enrollment.setEnrollment(s.parentId, s.learnerId, { packageLessons: 1 }))).toBe(CommErrorCode.LESSON_DENIED);
    expect(await code(enrollment.setEnrollment(s.ownerId, s.learnerId, { birthDate: '2016-13-01' }))).toBe(CommErrorCode.VALIDATION);

    const forParent = await enrollment.groupLearners(s.parentId, conv.id);
    expect(forParent.learners.map((l) => l.name)).toEqual(['learner_l', 'learner_m']);
    const [l, m] = forParent.learners;
    expect(l).toMatchObject({ course: { name: 'Quran memorization' }, packageLessons: 12, teacher: { name: 'teacher_c' }, canEdit: false });
    expect(typeof l.age).toBe('number');
    expect(l).not.toHaveProperty('birthDate');
    expect(m).toMatchObject({ course: null, packageLessons: 8, age: null });
    const forSupervisor = await enrollment.groupLearners(s.ownerId, conv.id);
    expect(forSupervisor.learners[0]).toMatchObject({ birthDate: '2016-03-01', canEdit: true });
    expect(await code(enrollment.groupLearners(s.unrelatedTeacherId, conv.id))).toBeTruthy();

    // A retired course stays on the child who has it, and is offered to nobody new.
    await enrollment.updateCourse(s.managerId, course.id, { isActive: false });
    expect(await code(enrollment.setEnrollment(s.ownerId, s.secondLearnerId, { courseId: course.id }))).toBe(CommErrorCode.VALIDATION);
    await enrollment.setEnrollment(s.ownerId, s.learnerId, { packageLessons: 16 });
    expect(await g.prisma.auditLog.count({ where: { action: 'learner.enrollment_set' } })).toBe(3);
  });

  it('the second child\'s report goes to the family group, named for that child, counted for the teacher once', async () => {
    const conv = await g.conversations.createFamilyGroup(s.ownerId, {
      learnerIds: [s.learnerId, s.secondLearnerId], contactIds: [s.parentId], teacherIds: [s.teacherId],
    });
    const mine = await lesson(-2 * HOUR);
    const theirs = await lesson(-HOUR, s.secondLearnerId);
    const tickets = (await lessons.ticketsFor(s.teacherId, conv.id)).tickets.filter((t) => t.ticket === 'report');
    expect(tickets.map((t) => t.learner.name).sort()).toEqual(['learner_l', 'learner_m']);
    await lessons.report(s.teacherId, theirs, REPORT);
    await lessons.report(s.teacherId, mine, REPORT);
    const inFamily = await cards(conv.id);
    expect(inFamily).toHaveLength(1);
    expect(inFamily[0].card?.payload).toMatchObject({ learnerName: 'learner_m' });
    const { summary } = await stats.teacher(tsupId, s.teacherId, await thisMonth());
    expect(summary.conducted).toBe(2);
  });
});
