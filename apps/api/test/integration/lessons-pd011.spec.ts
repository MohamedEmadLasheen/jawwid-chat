/**
 * PD-9 / PD-11 T1 -- lessons, their one outcome, and the tickets that record it.
 *
 *   1. scheduling: only the Teachers department; the learner's own teacher;
 *      never two lessons at once for one teacher
 *   2. the report closes a held lesson and is posted ONCE, as a card, published
 *      even where the group holds the teacher's messages for approval
 *   3. absence, apology, teacher apology, cancellation: who, and when
 *   4. the late apology: a ruling, never the teacher's call; only an excusing
 *      ruling may change an outcome
 *   5. the needs-action queue and the "+" ticket list
 *   6. the database refuses what the service would never send (the backstop)
 *
 * Synthetic fixtures only (QA gate G-16).
 */
import { randomUUID } from 'node:crypto';
import { PrismaAuditService } from '@platform/audit.service';
import { CommError, CommErrorCode } from '@platform/errors';
import { LessonService, REPORT_LOOKBACK_DAYS } from '../../src/lessons/lesson.service';
import { buildGraph, seed, truncate, Scenario } from './harness';

const g = buildGraph();
const lessons = new LessonService(g.prisma, g.authz, g.conversations, g.outbox, g.config, new PrismaAuditService());
let s: Scenario;
let groupId: string;
/** A Teachers-department supervisor: schedules lessons and decides rulings. */
let tsupId: string;

const HOUR = 3_600_000;
const at = (offsetMs: number) => new Date(Date.now() + offsetMs).toISOString();

async function code(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (e) {
    if (e instanceof CommError) return e.code;
    throw e;
  }
  throw new Error('expected a refusal, got success');
}

/** A lesson for learner_l (taught by teacher_c), starting `startMs` from now, lasting 30 minutes. */
async function lesson(startMs: number, durationMs = HOUR / 2): Promise<string> {
  const dto = await lessons.schedule(tsupId, { learnerId: s.learnerId, startsAt: at(startMs), endsAt: at(startMs + durationMs) });
  return dto.id;
}

async function cardsInGroup() {
  return g.prisma.message.findMany({
    where: { conversationId: groupId, type: 'card' },
    include: { card: true },
    orderBy: { seq: 'asc' },
  });
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
  await g.prisma.$executeRawUnsafe(
    `insert into chat.staff (id, name, role, is_active) values ($1::uuid, 'tsup_a', 'admin', true)`,
    tsupId,
  );
  const [{ id: dept }] = await g.prisma.$queryRawUnsafe<Array<{ id: string }>>(
    `insert into chat.department (kind, display_name) values ('teachers', 'teachers') returning id::text as id`,
  );
  await g.prisma.$executeRawUnsafe(
    `insert into chat.department_member (staff_id, organization_id, department_id, position)
     values ($1::uuid, chat.default_organization_id(), $2::uuid, 'supervisor')`,
    tsupId,
    dept,
  );
});

describe('1. scheduling', () => {
  it('the Teachers department schedules a lesson with the learner\'s assigned teacher', async () => {
    const dto = await lessons.schedule(tsupId, { learnerId: s.learnerId, startsAt: at(HOUR), endsAt: at(1.5 * HOUR) });
    expect(dto.teacher.id).toBe(s.teacherId);
    expect(dto.phase).toBe('upcoming');
    expect(dto.outcome).toBeNull();
  });

  it('an Operations supervisor, a teacher and a parent cannot schedule', async () => {
    const body = { learnerId: s.learnerId, startsAt: at(HOUR), endsAt: at(1.5 * HOUR) };
    expect(await code(lessons.schedule(s.ownerId, body))).toBe(CommErrorCode.LESSON_DENIED);
    expect(await code(lessons.schedule(s.teacherId, body))).toBe(CommErrorCode.LESSON_DENIED);
    expect(await code(lessons.schedule(s.parentId, body))).toBe(CommErrorCode.LESSON_DENIED);
  });

  it('a teacher is never booked twice at once; an excused lesson frees its slot', async () => {
    const first = await lesson(2 * HOUR);
    expect(await code(lessons.schedule(tsupId, { learnerId: s.learnerId, startsAt: at(2.25 * HOUR), endsAt: at(2.75 * HOUR) })))
      .toBe(CommErrorCode.LESSON_TEACHER_BUSY);
    await lessons.apology(s.parentId, first, { reason: 'travel' });
    await expect(lesson(2 * HOUR)).resolves.toBeDefined();
  });
});

describe('2. the lesson report', () => {
  it('closes a started lesson as held and posts one published card (PD-14: nothing in the group is held)', async () => {
    const id = await lesson(-HOUR / 4);
    const conv = await g.prisma.conversation.findUniqueOrThrow({ where: { id: groupId } });
    expect(conv.teacherRequiresApproval).toBe(false);

    const dto = await lessons.report(s.teacherId, id, { covered: 'Al-Mulk 1-15', homework: 'revise 1-5', rating: 5 });
    expect(dto.outcome).toBe('held');
    expect(dto.report?.covered).toBe('Al-Mulk 1-15');

    const cards = await cardsInGroup();
    expect(cards).toHaveLength(1);
    expect(cards[0].moderation).toBe('published');
    expect(cards[0].authorType).toBe('teacher');
    expect(cards[0].card?.kind).toBe('lesson_report');
    expect(cards[0].card?.lessonId).toBe(id);
    expect(dto.report?.messageId).toBe(cards[0].id);

    // The parent reads it through the ordinary message path, structured.
    const page = await g.messages.list({ conversationId: groupId, actorId: s.parentId });
    const seen = page.messages.find((m) => m.id === cards[0].id);
    expect(seen?.card?.kind).toBe('lesson_report');
    expect(seen?.card?.payload.covered).toBe('Al-Mulk 1-15');
    expect(seen?.body).toContain('Al-Mulk 1-15');

    // Core is told, and the attendance vocabulary is emitted.
    const closed = await g.prisma.outboxEvent.findMany({ where: { type: 'lesson.closed' } });
    expect(closed.map((e) => (e.payload as { outcome: string }).outcome)).toEqual(['held']);
    expect(await g.prisma.eventLog.count({ where: { type: 'class_attended' } })).toBe(1);
  });

  it('is refused before the start, from anyone but the lesson\'s teacher, and a second time', async () => {
    const future = await lesson(HOUR);
    expect(await code(lessons.report(s.teacherId, future, { covered: 'x' }))).toBe(CommErrorCode.LESSON_STATE);

    const id = await lesson(-HOUR / 4);
    expect(await code(lessons.report(s.parentId, id, { covered: 'x' }))).toBe(CommErrorCode.LESSON_DENIED);
    expect(await code(lessons.report(tsupId, id, { covered: 'x' }))).toBe(CommErrorCode.LESSON_DENIED);
    // Another teacher cannot even tell the lesson exists.
    expect(await code(lessons.report(s.unrelatedTeacherId, id, { covered: 'x' }))).toBe(CommErrorCode.LESSON_NOT_FOUND);

    await lessons.report(s.teacherId, id, { covered: 'x' });
    expect(await code(lessons.report(s.teacherId, id, { covered: 'y' }))).toBe(CommErrorCode.LESSON_STATE);
    expect(await cardsInGroup()).toHaveLength(1);
  });

  it('requires what was covered, and a rating from 1 to 5', async () => {
    const id = await lesson(-HOUR / 4);
    expect(await code(lessons.report(s.teacherId, id, {}))).toBe(CommErrorCode.VALIDATION);
    expect(await code(lessons.report(s.teacherId, id, { covered: 'x', rating: 6 }))).toBe(CommErrorCode.VALIDATION);
  });
});

describe('3. absence, apology, teacher apology, cancellation', () => {
  it('a parent apologises before the start: closed as a student apology, no report, card from the parent', async () => {
    const id = await lesson(3 * HOUR);
    const dto = await lessons.apology(s.parentId, id, { reason: 'fever' });
    expect(dto.outcome).toBe('student_apology');
    expect(dto.report).toBeNull();
    const [card] = await cardsInGroup();
    expect(card.authorType).toBe('contact');
    expect(card.card?.kind).toBe('lesson_apology');
    expect((card.card?.payload as { noticeMinutes: number }).noticeMinutes).toBeGreaterThan(170);
  });

  it('an apology after the start is refused and pointed at the late apology', async () => {
    const id = await lesson(-HOUR / 4);
    await expect(lessons.apology(s.parentId, id, { reason: 'x' })).rejects.toThrow(/late apology/);
  });

  it('the teacher records an absence after the start; it counts as the student\'s', async () => {
    const id = await lesson(-HOUR / 4);
    const dto = await lessons.absence(s.teacherId, id, {});
    expect(dto.outcome).toBe('student_no_show');
    expect((await cardsInGroup())[0].card?.kind).toBe('lesson_absence');
    expect(await g.prisma.eventLog.count({ where: { type: 'class_missed' } })).toBe(1);
  });

  it('a teacher apology is accepted only before the start, and owes a make-up', async () => {
    const started = await lesson(-HOUR / 4);
    expect(await code(lessons.teacherApology(s.teacherId, started, { reason: 'ill' }))).toBe(CommErrorCode.LESSON_STATE);
    const id = await lesson(HOUR);
    const dto = await lessons.teacherApology(s.teacherId, id, { reason: 'ill' });
    expect(dto.outcome).toBe('teacher_apology');
    expect((await cardsInGroup())[0].card?.payload).toMatchObject({ makeupOwed: true });
  });

  it('only the Teachers department cancels or records a teacher absence, and a cancellation names its reason', async () => {
    const id = await lesson(HOUR);
    expect(await code(lessons.cancel(s.teacherId, id, { reason: 'x' }))).toBe(CommErrorCode.LESSON_DENIED);
    expect(await code(lessons.cancel(tsupId, id, {}))).toBe(CommErrorCode.VALIDATION);
    const dto = await lessons.cancel(tsupId, id, { reason: 'public holiday' });
    expect(dto.outcome).toBe('admin_cancelled');
    const [card] = await cardsInGroup();
    expect(card.authorType).toBe('system');
    expect(card.card?.kind).toBe('lesson_cancelled');

    const missed = await lesson(-HOUR / 4 - 2 * HOUR);
    expect(await code(lessons.teacherNoShow(s.teacherId, missed, { note: 'x' }))).toBe(CommErrorCode.LESSON_DENIED);
    expect((await lessons.teacherNoShow(tsupId, missed, { note: 'did not join' })).outcome).toBe('teacher_no_show');
  });

  it('the family sees what happened, never who recorded it; the Operations supervisor reads but cannot act', async () => {
    const id = await lesson(-HOUR / 4);
    await lessons.absence(s.teacherId, id, {});
    const asParent = await lessons.get(s.parentId, id);
    expect(asParent.outcomeBy).toBeUndefined();
    const asSupervisor = await lessons.get(s.ownerId, id);
    expect(asSupervisor.outcomeBy).toEqual({ kind: 'teacher', id: s.teacherId });
    expect(await code(lessons.cancel(s.ownerId, await lesson(HOUR), { reason: 'x' }))).toBe(CommErrorCode.LESSON_DENIED);
    // An Operations supervisor who supervises nobody here sees nothing.
    expect(await code(lessons.get(s.otherAdminId, id))).toBe(CommErrorCode.LESSON_NOT_FOUND);
  });
});

describe('4. the late apology', () => {
  it('opens a ruling and leaves the absence credited to the teacher until a supervisor excuses it', async () => {
    const id = await lesson(-HOUR);
    await lessons.absence(s.teacherId, id, {});
    // The teacher is never the judge.
    expect(await code(lessons.lateApology(s.teacherId, id, { reason: 'x' }))).toBe(CommErrorCode.LESSON_DENIED);

    const filed = await lessons.lateApology(s.parentId, id, { reason: 'hospital' });
    expect(filed.outcome).toBe('student_no_show');
    expect(filed.ruling?.decision).toBeNull();
    expect(await code(lessons.lateApology(s.parentId, id, { reason: 'again' }))).toBe(CommErrorCode.LESSON_STATE);

    const queue = await lessons.needsAction(tsupId);
    expect(queue.rulings.map((r) => r.lesson.id)).toEqual([id]);

    // Deciding is the Teachers department's, not the teacher's or the Operations supervisor's.
    expect(await code(lessons.decideRuling(s.teacherId, filed.ruling!.id, { decision: 'excused' }))).toBe(CommErrorCode.LESSON_DENIED);
    expect(await code(lessons.decideRuling(s.unrelatedTeacherId, filed.ruling!.id, { decision: 'excused' }))).toBe(CommErrorCode.LESSON_NOT_FOUND);
    expect(await code(lessons.decideRuling(s.ownerId, filed.ruling!.id, { decision: 'excused' }))).toBe(CommErrorCode.LESSON_DENIED);

    const decided = await lessons.decideRuling(tsupId, filed.ruling!.id, { decision: 'excused', note: 'documented emergency' });
    expect(decided.outcome).toBe('student_apology');
    expect(decided.ruling?.decision).toBe('excused');
    expect(await code(lessons.decideRuling(tsupId, filed.ruling!.id, { decision: 'teacher_credited' }))).toBe(CommErrorCode.LESSON_STATE);

    // Outbox ids are uuids, so the two events are compared as a set.
    const closed = await g.prisma.outboxEvent.findMany({ where: { type: 'lesson.closed' } });
    expect(closed).toHaveLength(2);
    expect(closed.map((e) => e.payload)).toEqual(expect.arrayContaining([
      expect.objectContaining({ outcome: 'student_no_show', correction: false }),
      expect.objectContaining({ outcome: 'student_apology', correction: true }),
    ]));
    expect((await cardsInGroup()).map((m) => m.card?.kind)).toEqual(['lesson_absence', 'lesson_late_apology', 'lesson_ruling']);
  });

  it('credits the teacher on a lesson the teacher had not closed yet', async () => {
    const id = await lesson(-HOUR);
    const filed = await lessons.lateApology(s.parentId, id, { reason: 'power cut' });
    const decided = await lessons.decideRuling(tsupId, filed.ruling!.id, { decision: 'teacher_credited' });
    expect(decided.outcome).toBe('student_no_show');
  });

  it('is refused before the start, and more than 48 hours after it', async () => {
    expect(await code(lessons.lateApology(s.parentId, await lesson(HOUR), { reason: 'x' }))).toBe(CommErrorCode.LESSON_STATE);
    expect(await code(lessons.lateApology(s.parentId, await lesson(-49 * HOUR), { reason: 'x' }))).toBe(CommErrorCode.LESSON_STATE);
  });
});

describe('5. the needs-action queue and the "+" tickets', () => {
  it('lists open lessons past their end, overdue after the escalation delay', async () => {
    const overdue = await lesson(-26 * HOUR);
    const waiting = await lesson(-2 * HOUR);
    await lesson(HOUR);
    const q = await lessons.needsAction(tsupId);
    expect(q.overdue.map((l) => l.id)).toEqual([overdue]);
    expect(q.awaitingClose.map((l) => l.id)).toEqual([waiting]);
    expect(await code(lessons.needsAction(s.teacherId))).toBe(CommErrorCode.LESSON_DENIED);
  });

  it('offers each member only the tickets their role and the clock allow', async () => {
    const started = await lesson(-HOUR / 4);
    const upcoming = await lesson(2 * HOUR);
    const teacher = await lessons.ticketsFor(s.teacherId, groupId);
    // PD-31: both also get one "Change lesson time" for the child (no lesson of its own).
    const named = (t: { ticket: string; lessonId: string | null }, of: string) =>
      `${t.ticket}:${t.lessonId === null ? 'child' : t.lessonId === of ? 'match' : 'other'}`;
    expect(teacher.tickets.map((t) => named(t, started)).sort())
      .toEqual(['absence:match', 'change_lesson_time:child', 'report:match', 'teacher_apology:other']);
    const parent = await lessons.ticketsFor(s.parentId, groupId);
    expect(parent.tickets.map((t) => named(t, upcoming)).sort())
      .toEqual(['apology:match', 'change_lesson_time:child', 'late_apology:other']);
  });

  // Owner 2026-10-24: a lesson left unreported for more than two days vanished
  // from "+" (the query looked back only the 48 h of the late apology) while the
  // Schedule still counted it as needing a report. A report has no deadline.
  it('still offers the report for an open lesson that ended days ago, and never for a closed one', async () => {
    const DAY = 24 * HOUR;
    const fourDaysAgo = await lesson(-4 * DAY);
    const twoDaysAgo = await lesson(-2 * DAY - 3 * HOUR);
    const reported = await lesson(-6 * DAY);
    await lessons.report(s.teacherId, reported, { coveredTopics: ['revision'] });
    const tooOld = await lesson(-(REPORT_LOOKBACK_DAYS + 1) * DAY);
    const teacher = await lessons.ticketsFor(s.teacherId, groupId);
    const reports = teacher.tickets.filter((t) => t.ticket === 'report').map((t) => t.lessonId);
    expect(reports.sort()).toEqual([fourDaysAgo, twoDaysAgo].sort());
    expect(reports).not.toContain(reported);
    expect(reports).not.toContain(tooOld);
    // The late apology keeps its own 48 hours: the old lessons offer the parent nothing.
    const parent = await lessons.ticketsFor(s.parentId, groupId);
    expect(parent.tickets.filter((t) => [fourDaysAgo, twoDaysAgo].includes(t.lessonId as string))).toEqual([]);
    // And the report is accepted when it is sent.
    await lessons.report(s.teacherId, fourDaysAgo, { coveredTopics: ['revision'] });
  });

  it('a lesson names the acts its reader may open on it now (the teacher Schedule acts on any lesson)', async () => {
    const ended = await lesson(-3 * 24 * HOUR);
    const upcoming = await lesson(5 * HOUR);
    const held = await lesson(-5 * 24 * HOUR);
    await lessons.report(s.teacherId, held, { coveredTopics: ['revision'] });

    const endedDto = await lessons.get(s.teacherId, ended);
    expect([...endedDto.acts].sort()).toEqual(['absence', 'report']);
    expect(endedDto.suggestedLessonNumber).toEqual(expect.any(Number));
    expect((await lessons.get(s.teacherId, upcoming)).acts).toEqual(['teacher_apology']);
    expect((await lessons.get(s.teacherId, held)).acts).toEqual([]);
    expect((await lessons.get(s.parentId, upcoming)).acts).toEqual(['apology']);
    expect((await lessons.get(s.parentId, upcoming)).suggestedLessonNumber).toBeUndefined();

    const listed = await lessons.list(s.teacherId, { from: at(-6 * 24 * HOUR), to: at(24 * HOUR) });
    const acts = Object.fromEntries(listed.lessons.map((l) => [l.id, [...l.acts].sort()]));
    expect(acts).toEqual({ [ended]: ['absence', 'report'], [upcoming]: ['teacher_apology'], [held]: [] });
  });
});

describe('6. the database is the backstop', () => {
  it('a client cannot send a card', async () => {
    expect(await code(g.messages.send({ conversationId: groupId, senderId: s.parentId, type: 'card', body: 'forged' })))
      .toBe(CommErrorCode.VALIDATION);
  });

  it('an outcome is written once, a lesson is never reopened or deleted, a held lesson always has a report', async () => {
    const id = await lesson(-HOUR / 4);
    await lessons.absence(s.teacherId, id, {});
    await expect(g.prisma.$executeRawUnsafe(`update chat.lesson set outcome = 'held' where id = $1::uuid`, id))
      .rejects.toThrow(/written once/);
    await expect(g.prisma.$executeRawUnsafe(
      `update chat.lesson set outcome = null, outcome_by = null, outcome_by_kind = null, outcome_at = null where id = $1::uuid`, id,
    )).rejects.toThrow(/never reopened/);
    // Without an excusing ruling, an absence cannot become an apology.
    await expect(g.prisma.$executeRawUnsafe(`update chat.lesson set outcome = 'student_apology' where id = $1::uuid`, id))
      .rejects.toThrow(/excusing ruling/);
    await expect(g.prisma.$executeRawUnsafe(`delete from chat.lesson where id = $1::uuid`, id)).rejects.toThrow(/never deleted/);

    const other = await lesson(-3 * HOUR);
    await expect(g.prisma.$executeRawUnsafe(
      `update chat.lesson set outcome = 'held', outcome_by = $2::uuid, outcome_by_kind = 'teacher', outcome_at = now() where id = $1::uuid`,
      other, s.teacherId,
    )).rejects.toThrow(/held lesson has a report/);
  });

  it('the database clock decides: no apology after the start, no absence before it', async () => {
    const future = await lesson(HOUR);
    await expect(g.prisma.$executeRawUnsafe(
      `update chat.lesson set outcome = 'student_no_show', outcome_by = $2::uuid, outcome_by_kind = 'teacher', outcome_at = now() where id = $1::uuid`,
      future, s.teacherId,
    )).rejects.toThrow(/has not started/);
    const started = await lesson(-HOUR / 4);
    await expect(g.prisma.$executeRawUnsafe(
      `update chat.lesson set outcome = 'student_apology', outcome_by = $2::uuid, outcome_by_kind = 'contact', outcome_at = now() where id = $1::uuid`,
      started, s.parentId,
    )).rejects.toThrow(/late apology/);
  });

  it('a lesson is taught by the learner\'s assigned teacher; a card message must carry its card', async () => {
    await expect(g.prisma.$executeRawUnsafe(
      `insert into chat.lesson (learner_id, teacher_id, starts_at, ends_at, created_by)
       values ($1::uuid, $2::uuid, now() + interval '1 day', now() + interval '1 day 30 minutes', $3::uuid)`,
      s.learnerId, s.unrelatedTeacherId, tsupId,
    )).rejects.toThrow(/assigned teacher/);
    await expect(g.prisma.$executeRawUnsafe(
      `insert into chat.message (conversation_id, author_type, author_id, type, body, visibility, seq)
       values ($1::uuid, 'system', null, 'card', 'forged', 'customer', 999)`,
      groupId,
    )).rejects.toThrow(/carries its card/);
  });

  it('request roles have no access to the lesson tables at all', async () => {
    const grants = await g.prisma.$queryRawUnsafe<Array<{ n: bigint }>>(
      `select count(*) as n from information_schema.role_table_grants
        where table_schema = 'chat'
          and table_name in ('lesson', 'lesson_report', 'lesson_ruling', 'message_card')
          and grantee in ('chat_app', 'authenticated', 'anon', 'PUBLIC')`,
    );
    expect(Number(grants[0].n)).toBe(0);
    const rls = await g.prisma.$queryRawUnsafe<Array<{ relname: string; relrowsecurity: boolean }>>(
      `select c.relname, c.relrowsecurity from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'chat' and c.relname in ('lesson', 'lesson_report', 'lesson_ruling', 'message_card')`,
    );
    expect(rls.every((r) => r.relrowsecurity)).toBe(true);
  });
});
