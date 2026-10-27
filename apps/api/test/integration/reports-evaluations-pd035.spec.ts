/**
 * PD-35 part 3 -- report correction requests, teacher evaluations and
 * improvement plans.
 *
 *   1. "Request correction": a supervisor who stands to the lesson asks, with a
 *      reason; the teacher gets a card; one open request per lesson; the
 *      TEACHER's PD-15 edit resolves it in the same transaction with both
 *      versions; a supervisor's own edit is recorded as staff
 *   2. "the report is missing": only for a started lesson with none; filing the
 *      report resolves it
 *   3. withdraw: the asker or a manager; the list follows the caller's scope
 *   4. evaluations: active criteria, scores 1-5, append-only; the teacher reads
 *      one only once shared, and never the internal notes
 *   5. improvement plans: goals with due dates, status by update, shared as a card
 *   6. criteria: the Teachers Manager adds, renames, retires -- a supervisor cannot
 *
 * Synthetic fixtures only (G-16).
 */
import { randomUUID } from 'node:crypto';
import { PrismaAuditService } from '@platform/audit.service';
import { CommError, CommErrorCode } from '@platform/errors';
import { TeacherScopeService } from '@platform/teacher-scope';
import { LessonService } from '../../src/lessons/lesson.service';
import { LessonRecordService } from '../../src/lessons/lesson-record.service';
import { ReportCorrectionService } from '../../src/lessons/report-correction.service';
import { SupervisionConversationService } from '../../src/supervision/supervision-conversation.service';
import { CardPoster } from '../../src/supervision/card-poster';
import { TeacherFileService } from '../../src/teacher-file/teacher-file.service';
import { TeacherEvaluationService } from '../../src/teacher-file/teacher-evaluation.service';
import { buildGraph, seed, truncate, Scenario } from './harness';

const g = buildGraph();
const audit = new PrismaAuditService();
const scope = new TeacherScopeService(g.prisma);
const lessons = new LessonService(g.prisma, g.authz, g.conversations, g.outbox, g.config, audit, undefined, undefined, scope);
const records = new LessonRecordService(g.prisma, lessons, g.conversations, g.outbox, audit);
const supervisionChats = new SupervisionConversationService(g.prisma, g.authz, g.conversations, g.outbox, audit, scope);
const cards = new CardPoster(g.conversations, g.outbox, audit);
const corrections = new ReportCorrectionService(g.prisma, g.conversations, lessons, supervisionChats, cards, audit);
const files = new TeacherFileService(g.prisma, g.authz, g.conversations, audit, scope);
const evaluations = new TeacherEvaluationService(g.prisma, g.conversations, files, supervisionChats, cards, audit);

jest.setTimeout(120_000);

const HOUR = 3_600_000;
const REPORT = { lessonNumber: 7, coveredTopics: ['revision'], covered: 'Al-Mulk 1-10', rating: 4, nextTasks: ['revise_previous'], homework: 'Al-Mulk 1-5' };
const at = (ms: number) => new Date(Date.now() + ms).toISOString();
let s: Scenario;
let tmgr: string;
let tsupA: string;
let tsupB: string;
let slot = 0;

async function code(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (e) {
    if (e instanceof CommError) return e.code;
    throw e;
  }
  throw new Error('expected a refusal, got success');
}

async function lesson(ms: number): Promise<string> {
  const start = ms + (slot++ % 20) * 40 * 60_000 * (ms < 0 ? -1 : 1);
  return (await lessons.schedule(tmgr, { learnerId: s.learnerId, startsAt: at(start), endsAt: at(start + HOUR / 2) })).id;
}

const supervisionCards = async (kind: string) => {
  const conv = await g.prisma.conversation.findFirst({ where: { type: 'teacher_supervision', supervisedTeacherId: s.teacherId } });
  if (!conv) return [];
  return g.prisma.messageCard.findMany({ where: { kind, message: { conversationId: conv.id } } });
};

beforeAll(async () => {
  await g.prisma.$connect();
});
afterAll(async () => {
  await g.prisma.$executeRaw`UPDATE chat.config SET value = 'false'::jsonb WHERE key = 'teacher_supervisor.strict_scope'`;
  await truncate(g.prisma);
  await g.prisma.$disconnect();
});
beforeEach(async () => {
  await truncate(g.prisma);
  await g.prisma.$executeRaw`UPDATE chat.config SET value = 'false'::jsonb WHERE key = 'teacher_supervisor.strict_scope'`;
  slot = 0;
  s = await seed(g.prisma);
  g.coverage.onDutyId = s.ownerId;
  await g.conversations.ensureStudentGroup(s.learnerId, s.ownerId);
  [tmgr, tsupA, tsupB] = [randomUUID(), randomUUID(), randomUUID()];
  await g.prisma.$executeRawUnsafe(
    `insert into chat.staff (id, name, role, is_active) values ($1::uuid, 'tmgr_x', 'manager', true), ($2::uuid, 'tsup_a', 'admin', true), ($3::uuid, 'tsup_b', 'admin', true)`,
    tmgr, tsupA, tsupB,
  );
  const [{ id: dept }] = await g.prisma.$queryRawUnsafe<Array<{ id: string }>>(
    `insert into chat.department (kind, display_name, manager_id) values ('teachers', 'teachers', $1::uuid) returning id::text as id`, tmgr,
  );
  await g.prisma.$executeRawUnsafe(
    `insert into chat.department_member (staff_id, organization_id, department_id, position) values
       ($1::uuid, chat.default_organization_id(), $3::uuid, 'supervisor'), ($2::uuid, chat.default_organization_id(), $3::uuid, 'supervisor')`,
    tsupA, tsupB, dept,
  );
  await g.prisma.$executeRawUnsafe(
    `insert into chat.teacher_supervisor_assignment (teacher_id, organization_id, supervisor_id) values ($1::uuid, chat.default_organization_id(), $2::uuid)`,
    s.teacherId, tsupA,
  );
});

// ---------------------------------------------------------------------------

describe('1. Request correction', () => {
  it('is answered by the teacher\'s own PD-15 edit, with both versions, in that transaction', async () => {
    const id = await lesson(-HOUR);
    await lessons.report(s.teacherId, id, REPORT);

    const asked = await corrections.request(tsupA, id, { reason: 'The surah range is wrong', fields: ['covered'] });
    expect(asked).toMatchObject({ kind: 'correction', status: 'open', askedVersion: 1, resolvedVersion: null });
    expect(await supervisionCards('report_correction_requested')).toHaveLength(1);
    expect(await code(corrections.request(tmgr, id, { reason: 'again' }))).toBe(CommErrorCode.LESSON_STATE);
    // A parent and a teacher never ask.
    expect(await code(corrections.request(s.parentId, id, { reason: 'x' }))).toBe(CommErrorCode.LESSON_DENIED);
    expect(await code(corrections.request(s.teacherId, id, { reason: 'x' }))).toBe(CommErrorCode.LESSON_DENIED);

    await records.editReport(s.teacherId, id, { ...REPORT, covered: 'Al-Mulk 1-15' });
    const [done] = (await corrections.list(tsupA, { status: 'all' })).requests;
    expect(done).toMatchObject({ status: 'corrected', askedVersion: 1, resolvedVersion: 2, resolvedByKind: 'teacher' });
    expect((await corrections.mine(s.teacherId)).requests[0]).toMatchObject({ status: 'corrected' });

    // A supervisor who corrects it themselves is recorded as staff -- never silent.
    await corrections.request(tsupA, id, { reason: 'one more thing' });
    await records.editReport(tmgr, id, { ...REPORT, covered: 'Al-Mulk 1-20' });
    const latest = (await corrections.list(tsupA, { status: 'all' })).requests.find((r) => r.reason === 'one more thing');
    expect(latest).toMatchObject({ status: 'corrected', askedVersion: 2, resolvedVersion: 3, resolvedByKind: 'staff' });
  });
});

describe('2. the report is missing', () => {
  it('is asked only of a started lesson with none, and filing the report answers it', async () => {
    const future = await lesson(3 * HOUR);
    expect(await code(corrections.request(tsupA, future, { reason: 'write it', kind: 'missing' }))).toBe(CommErrorCode.LESSON_STATE);

    const id = await lesson(-HOUR);
    const asked = await corrections.request(tsupA, id, { reason: 'The report is missing' });
    expect(asked).toMatchObject({ kind: 'missing', askedVersion: null });
    await lessons.report(s.teacherId, id, REPORT);
    const [done] = (await corrections.list(tsupA, { status: 'resolved' })).requests;
    expect(done).toMatchObject({ status: 'filed', resolvedVersion: 1, resolvedByKind: 'teacher' });
    // There is a report now: a "missing" request is refused.
    expect(await code(corrections.request(tsupA, id, { reason: 'x', kind: 'missing' }))).toBe(CommErrorCode.LESSON_STATE);
  });
});

describe('3. withdraw and the list', () => {
  it('the asker or a manager withdraws; the list follows the caller\'s scope', async () => {
    const id = await lesson(-HOUR);
    await lessons.report(s.teacherId, id, REPORT);
    const asked = await corrections.request(s.ownerId, id, { reason: 'please check the rating' });
    // Neither the asker nor a manager of the lesson: the teacher, and (switch off) nobody else is refused.
    expect(await code(corrections.withdraw(s.teacherId, asked.id))).toBe(CommErrorCode.LESSON_DENIED);

    // The Operations supervisor of the child, the teacher's supervisor and the manager see it.
    for (const who of [s.ownerId, tsupA, tmgr]) {
      expect((await corrections.list(who, {})).requests.map((r) => r.id)).toEqual([asked.id]);
    }
    // With the switch on, a supervisor of other teachers does not.
    await g.prisma.$executeRaw`UPDATE chat.config SET value = 'true'::jsonb WHERE key = 'teacher_supervisor.strict_scope'`;
    expect((await corrections.list(tsupB, {})).requests).toEqual([]);
    expect(await code(corrections.request(tsupB, id, { reason: 'x' }))).toBe(CommErrorCode.LESSON_NOT_FOUND);

    expect(await corrections.withdraw(s.ownerId, asked.id)).toMatchObject({ status: 'withdrawn' });
    expect(await code(corrections.withdraw(s.ownerId, asked.id))).toBe(CommErrorCode.LESSON_STATE);
  });
});

describe('4. evaluations', () => {
  it('score the active criteria 1-5, append-only; the teacher reads one only once shared, without the notes', async () => {
    const { criteria } = await evaluations.criteria(tsupA);
    expect(criteria.map((c) => c.labelEn)).toEqual([
      'Recitation and tajweed accuracy', 'Lesson preparation', 'Punctuality', 'Report quality',
      'Student engagement', 'Communication', 'Student progress',
    ]);
    const [c1, c2] = criteria;
    const body = { periodFrom: '2026-10-01', periodTo: '2026-10-26', scores: { [c1!.id]: 4, [c2!.id]: 5 }, notes: 'internal', recommendations: 'Keep it up' };

    expect(await code(evaluations.evaluate(tsupA, s.teacherId, { ...body, scores: { [c1!.id]: 6 } }))).toBe(CommErrorCode.VALIDATION);
    expect(await code(evaluations.evaluate(tsupA, s.teacherId, { ...body, scores: { [randomUUID()]: 3 } }))).toBe(CommErrorCode.VALIDATION);
    expect(await code(evaluations.evaluate(s.ownerId, s.teacherId, body))).toBe(CommErrorCode.TEACHER_FILE_DENIED);

    const { evaluationId } = await evaluations.evaluate(tsupA, s.teacherId, body);
    expect((await evaluations.mine(s.teacherId)).evaluations).toEqual([]);
    await evaluations.shareEvaluation(tsupA, evaluationId);
    expect(await code(evaluations.shareEvaluation(tsupA, evaluationId))).toBe(CommErrorCode.TEACHER_FILE_CONFLICT);
    expect(await supervisionCards('evaluation_shared')).toHaveLength(1);
    const mine = (await evaluations.mine(s.teacherId)).evaluations;
    expect(mine).toHaveLength(1);
    expect(mine[0]).toMatchObject({ recommendations: 'Keep it up', notes: null });

    await expect(g.prisma.$executeRaw`UPDATE chat.teacher_evaluation SET notes = 'changed' WHERE id = ${evaluationId}::uuid`).rejects.toThrow();
    const again = await evaluations.evaluate(tsupA, s.teacherId, { ...body, supersedesId: evaluationId });
    const view = await evaluations.forTeacher(tmgr, s.teacherId);
    expect(view.evaluations.find((e) => e.id === evaluationId)?.superseded).toBe(true);
    expect(view.evaluations.find((e) => e.id === again.evaluationId)?.supersedesId).toBe(evaluationId);

    // With the switch on, a supervisor of other teachers reads none of it.
    await g.prisma.$executeRaw`UPDATE chat.config SET value = 'true'::jsonb WHERE key = 'teacher_supervisor.strict_scope'`;
    expect(await code(evaluations.forTeacher(tsupB, s.teacherId))).toBe(CommErrorCode.TEACHER_FILE_NOT_FOUND);
  });
});

describe('5. improvement plans', () => {
  it('goals with due dates, status by update, shared as a card', async () => {
    const { planId } = await evaluations.plan(tsupA, s.teacherId, {
      title: 'Reports on time',
      goals: [{ body: 'File every report the same day', dueOn: '2026-11-30' }, { body: 'Use the quick report' }],
    });
    const goals = (await evaluations.forTeacher(tsupA, s.teacherId)).plans[0]!.goals;
    expect(goals.map((g0) => [g0.position, g0.status, g0.dueOn])).toEqual([[1, 'open', '2026-11-30'], [2, 'open', null]]);
    await evaluations.goalStatus(tsupA, goals[0]!.id, { status: 'met', note: 'all filed' });
    expect(await code(evaluations.goalStatus(tsupA, goals[1]!.id, { status: 'done' }))).toBe(CommErrorCode.VALIDATION);
    expect((await evaluations.forTeacher(tsupA, s.teacherId)).plans[0]!.goals[0]).toMatchObject({ status: 'met', note: 'all filed' });

    expect((await evaluations.mine(s.teacherId)).plans).toEqual([]);
    await evaluations.sharePlan(tsupA, planId);
    expect(await supervisionCards('improvement_plan_shared')).toHaveLength(1);
    expect((await evaluations.mine(s.teacherId)).plans.map((p) => p.title)).toEqual(['Reports on time']);
  });
});

describe('6. criteria', () => {
  it('the Teachers Manager adds, renames and retires them; a supervisor cannot; a retired one is not scored', async () => {
    expect(await code(evaluations.addCriterion(tsupA, { labelEn: 'X', labelAr: 'س' }))).toBe(CommErrorCode.TEACHER_FILE_DENIED);
    const added = await evaluations.addCriterion(tmgr, { labelEn: 'Parent feedback', labelAr: 'آراء أولياء الأمور' });
    const fresh = added.criteria.find((c) => c.labelEn === 'Parent feedback')!;
    await evaluations.updateCriterion(tmgr, fresh.id, { labelEn: 'Parent satisfaction', isActive: false });
    const after = (await evaluations.criteria(tmgr)).criteria.find((c) => c.id === fresh.id)!;
    expect(after).toMatchObject({ labelEn: 'Parent satisfaction', isActive: false });
    expect(await code(evaluations.evaluate(tsupA, s.teacherId, {
      periodFrom: '2026-10-01', periodTo: '2026-10-26', scores: { [fresh.id]: 3 },
    }))).toBe(CommErrorCode.VALIDATION);
    await expect(g.prisma.$executeRaw`DELETE FROM chat.evaluation_criterion WHERE id = ${fresh.id}::uuid`).rejects.toThrow(/retired, never deleted/);
  });
});
