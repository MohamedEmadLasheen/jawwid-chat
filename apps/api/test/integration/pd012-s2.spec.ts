/**
 * PD-12 S2 -- the teacher discipline ladder.
 *
 *   1. violations are recorded by the database when a lesson closes as the
 *      teacher's apology or absence; lateness is recorded by the Teachers
 *      department, from the threshold, on a held lesson; the academy's own
 *      cancellations are never violations
 *   2. the step is the rank in the teacher's month; an excused violation is
 *      kept but not counted; anything but the suggestion needs a reason
 *   3. what each decision does: the card, the Core event, the suspension's days
 *      off and cancelled lessons, the permanent suspension's deactivation
 *   4. who may, and the database backstop
 *
 * Synthetic fixtures only (QA gate G-16).
 */
import { randomUUID } from 'node:crypto';
import { PrismaAuditService } from '@platform/audit.service';
import { CommError, CommErrorCode } from '@platform/errors';
import { LessonService } from '../../src/lessons/lesson.service';
import { SupervisionConversationService } from '../../src/supervision/supervision-conversation.service';
import { CardPoster } from '../../src/supervision/card-poster';
import { LeaveService } from '../../src/leave/leave.service';
import { DisciplineService } from '../../src/discipline/discipline.service';
import { SchedulingService } from '../../src/lessons/scheduling.service';
import { TrialService } from '../../src/lessons/trial.service';
import { NewStudentsService } from '../../src/new-students/new-students.service';
import { TrialGroupService } from '../../src/lessons/trial-group.service';
import { buildGraph, seed, truncate, withAssignmentGate, Scenario } from './harness';

const g = buildGraph();
const audit = new PrismaAuditService();
const lessons = new LessonService(g.prisma, g.authz, g.conversations, g.outbox, g.config, audit);
const supervision = new SupervisionConversationService(g.prisma, g.authz, g.conversations, g.outbox, audit);
const cards = new CardPoster(g.conversations, g.outbox, audit);
const scheduling = new SchedulingService(g.prisma, g.authz, g.conversations, lessons, g.outbox, g.config, g.reminders, audit);
const groups = new TrialGroupService(g.prisma, g.authz, g.conversations, g.outbox, cards, g.config, audit);
const trials = new TrialService(g.prisma, g.conversations, lessons, scheduling, audit, groups, new NewStudentsService(g.prisma));
const leave = new LeaveService(g.prisma, g.conversations, supervision, cards, lessons, audit, trials);
const discipline = new DisciplineService(g.prisma, g.conversations, supervision, cards, lessons, g.outbox, g.config, audit, trials);

const HOUR = 3_600_000;
const at = (ms: number) => new Date(Date.now() + ms).toISOString();

let s: Scenario;
let groupId: string;
let tsupId: string;
let tmgrId: string;
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

async function sqlError(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
  throw new Error('expected the database to refuse');
}

/** A 30-minute lesson for learner_l (teacher_c), starting `ms` from now; each call a distinct slot. */
async function lesson(ms: number): Promise<string> {
  const start = ms + (slot++ % 20) * 40 * 60_000 * (ms < 0 ? -1 : 1);
  return (await lessons.schedule(tsupId, { learnerId: s.learnerId, startsAt: at(start), endsAt: at(start + HOUR / 2) })).id;
}

/** A violation the database records: the teacher apologises for a lesson tomorrow-ish. */
async function apology(): Promise<string> {
  const id = await lesson(3 * HOUR);
  await lessons.teacherApology(s.teacherId, id, { reason: 'ill' });
  return (await g.prisma.teacherViolation.findFirstOrThrow({ where: { lessonId: id } })).id;
}

async function supervisionCards() {
  const conv = await g.prisma.conversation.findFirst({ where: { type: 'teacher_supervision', supervisedTeacherId: s.teacherId } });
  if (!conv) return [];
  return g.prisma.message.findMany({ where: { conversationId: conv.id, type: 'card' }, include: { card: true }, orderBy: { seq: 'asc' } });
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
  slot = 0;
  s = await seed(g.prisma);
  g.coverage.onDutyId = s.ownerId;
  groupId = (await g.conversations.ensureStudentGroup(s.learnerId, s.ownerId)).id;
  tsupId = randomUUID();
  tmgrId = randomUUID();
  await g.prisma.$executeRawUnsafe(
    `insert into chat.staff (id, name, role, is_active) values ($1::uuid, 'tsup_a', 'admin', true), ($2::uuid, 'tmgr_b', 'manager', true)`,
    tsupId,
    tmgrId,
  );
  const [{ id: dept }] = await g.prisma.$queryRawUnsafe<Array<{ id: string }>>(
    `insert into chat.department (kind, display_name, manager_id) values ('teachers', 'teachers', $1::uuid) returning id::text as id`,
    tmgrId,
  );
  await g.prisma.$executeRawUnsafe(
    `insert into chat.department_member (staff_id, organization_id, department_id, position)
     values ($1::uuid, chat.default_organization_id(), $2::uuid, 'supervisor')`,
    tsupId,
    dept,
  );
});

// ---------------------------------------------------------------------------

describe('1. what is a violation', () => {
  it('the teacher\'s apology and absence are recorded by the database; the academy\'s cancellation is not', async () => {
    const apologised = await lesson(3 * HOUR);
    await lessons.teacherApology(s.teacherId, apologised, { reason: 'ill' });
    const missed = await lesson(-2 * HOUR);
    await lessons.teacherNoShow(tsupId, missed, { note: 'did not join' });
    const cancelled = await lesson(5 * HOUR);
    await lessons.cancel(tsupId, cancelled, { reason: 'public holiday' });

    const rows = await g.prisma.teacherViolation.findMany({ orderBy: { occurredAt: 'asc' } });
    expect(rows.map((r) => [r.lessonId, r.kind]).sort()).toEqual(
      [[apologised, 'teacher_apology'], [missed, 'teacher_no_show']].sort(),
    );
    expect(rows.every((r) => r.decision === null && r.teacherId === s.teacherId)).toBe(true);
  });

  it('lateness: the Teachers department records it on a held lesson, from the threshold', async () => {
    const held = await lesson(-2 * HOUR);
    await lessons.report(s.teacherId, held, { covered: 'Al-Mulk' });
    expect(await code(discipline.recordLateness(tsupId, held, { minutes: 5 }))).toBe(CommErrorCode.DISCIPLINE_STATE);
    expect(await code(discipline.recordLateness(s.teacherId, held, { minutes: 15 }))).toBe(CommErrorCode.DISCIPLINE_DENIED);
    // PD-26 amendment: an Operations supervisor records it for her families' teachers
    // only (pd026-operations-access.spec); admin_b has no charge over teacher_c.
    expect(await code(discipline.recordLateness(s.otherAdminId, held, { minutes: 15 }))).toBe(CommErrorCode.DISCIPLINE_NOT_FOUND);

    const { violation } = await discipline.recordLateness(tsupId, held, { minutes: 15, note: 'joined at 18:15' });
    expect(violation).toMatchObject({ kind: 'late', lateMinutes: 15, step: 1, suggestedDecision: 'warning' });
    expect(await code(discipline.recordLateness(tsupId, held, { minutes: 20 }))).toBe(CommErrorCode.DISCIPLINE_STATE);

    const open = await lesson(4 * HOUR);
    expect(await code(discipline.recordLateness(tsupId, open, { minutes: 15 }))).toBe(CommErrorCode.DISCIPLINE_STATE);
  });
});

// ---------------------------------------------------------------------------

describe('2. the ladder', () => {
  it('steps by rank in the month; an excused violation is kept but not counted; another step needs a reason', async () => {
    const v1 = await apology();
    const v2 = await apology();
    const v3 = await apology();
    const steps = async () =>
      Object.fromEntries((await discipline.list(tsupId, { state: 'all' })).violations.map((v) => [v.id, [v.step, v.suggestedDecision]]));
    expect(await steps()).toEqual({ [v1]: [1, 'warning'], [v2]: [2, 'deduction_1'], [v3]: [3, 'deduction_2'] });

    expect(await code(discipline.decide(tsupId, v1, { decision: 'excused' }))).toBe(CommErrorCode.VALIDATION);
    await discipline.decide(tsupId, v1, { decision: 'excused', note: 'internet outage, proven' });
    // v1 stays at its step, but no longer counts: v2 becomes the first counted one.
    expect(await steps()).toEqual({ [v1]: [1, 'warning'], [v2]: [1, 'warning'], [v3]: [2, 'deduction_1'] });

    expect(await code(discipline.decide(tsupId, v2, { decision: 'deduction_2' }))).toBe(CommErrorCode.VALIDATION);
    const out = await discipline.decide(tsupId, v2, { decision: 'warning' });
    expect(out.violation).toMatchObject({ decision: 'warning', step: 1, decidedBy: { name: 'tsup_a' } });
    expect(await code(discipline.decide(tsupId, v2, { decision: 'warning' }))).toBe(CommErrorCode.DISCIPLINE_STATE);

    const month = await discipline.teacherMonth(tsupId, s.teacherId);
    expect(month).toMatchObject({ counted: 2, nextStep: 'deduction_2' });
  });
});

// ---------------------------------------------------------------------------

describe('3. what each decision does', () => {
  it('a warning is a card; a deduction is a card and a payroll event without an amount', async () => {
    const v1 = await apology();
    const v2 = await apology();
    await discipline.decide(tsupId, v1, { decision: 'warning' });
    await discipline.decide(tsupId, v2, { decision: 'deduction_1' });

    expect((await supervisionCards()).map((m) => m.card?.kind)).toEqual(['discipline_warning', 'discipline_deduction']);
    const deduction = (await supervisionCards())[1];
    // In the teacher's language (Arabic here): the amount is payroll's.
    expect(deduction.body).toMatch(/الرواتب|payroll/);
    const events = await g.prisma.outboxEvent.findMany({ where: { type: 'teacher.deduction_applied' } });
    expect(events).toHaveLength(1);
    expect(events[0].payload).toMatchObject({ teacherId: s.teacherId, violationId: v2, step: 1 });
    expect(JSON.stringify(events[0].payload)).not.toMatch(/amount/i);
  });

  it('a temporary suspension: open lessons must be confirmed, its days are days off but not leave, and the families are told', async () => {
    const v = await apology();
    const inside = await lesson(26 * HOUR);
    // PD-11 T4: a booked trial is the teacher's time too, and is cancelled as a trial.
    const prospect = await g.prisma.trialProspect.create({
      data: { organizationId: (await g.prisma.teacher.findUniqueOrThrow({ where: { id: s.teacherId } })).organizationId, displayName: 'prospect_q', createdBy: tsupId },
    });
    const trial = await g.prisma.lesson.create({
      data: {
        organizationId: prospect.organizationId, kind: 'trial', prospectId: prospect.id, teacherId: s.teacherId,
        startsAt: new Date(Date.now() + 30 * HOUR), endsAt: new Date(Date.now() + 30 * HOUR + 30 * 60_000),
        createdByKind: 'staff', createdBy: tsupId,
      },
    });
    await leave.setAllowance(tmgrId, s.teacherId, { year: new Date().getUTCFullYear(), days: 10 });

    expect(await code(discipline.decide(tsupId, v, { decision: 'temporary_suspension', note: 'repeated absences' }))).toBe(
      CommErrorCode.DISCIPLINE_LESSONS_COLLIDE,
    );
    const out = await discipline.decide(tsupId, v, { decision: 'temporary_suspension', note: 'repeated absences', cancelCollidingLessons: true });
    expect(out).toMatchObject({ cancelledLessons: 2, notCancelled: [] });
    expect((await g.prisma.lesson.findUniqueOrThrow({ where: { id: trial.id } })).outcome).toBe('admin_cancelled');
    expect(out.violation.suspension).toMatchObject({ kind: 'temporary' });

    const days = await g.prisma.teacherDayOff.findMany({ where: { suspensionId: out.violation.suspension!.id } });
    expect(days).toHaveLength(7);
    expect((await g.prisma.lesson.findUniqueOrThrow({ where: { id: inside } })).outcome).toBe('admin_cancelled');
    // Days off for scheduling, but never taken from the leave balance.
    expect((await leave.teacherLeave(tsupId, s.teacherId)).used).toBe(0);
    expect((await g.prisma.outboxEvent.findMany({ where: { type: 'teacher.suspended' } }))[0].payload).toMatchObject({ kind: 'temporary' });
    expect((await supervisionCards()).map((m) => m.card?.kind)).toContain('discipline_suspension');
    // The academy's cancellation is not a second violation.
    expect(await g.prisma.teacherViolation.count()).toBe(1);
    // A suspension day is not removed by deleting the day off.
    expect(await sqlError(g.prisma.teacherDayOff.deleteMany({ where: { suspensionId: out.violation.suspension!.id } }))).toMatch(
      /belongs to a suspension/,
    );
  });

  it('a permanent suspension waits until the students are moved, then deactivates the teacher', async () => {
    const v = await apology();
    expect(await code(discipline.decide(tsupId, v, { decision: 'permanent_suspension', note: 'serious' }))).toBe(
      CommErrorCode.DISCIPLINE_STATE,
    );
    await withAssignmentGate(g.prisma, `update chat.learner set teacher_id = '${s.newTeacherId}'::uuid where teacher_id = '${s.teacherId}'::uuid`);
    const out = await discipline.decide(tsupId, v, { decision: 'permanent_suspension', note: 'serious', cancelCollidingLessons: true });
    expect(out.violation.suspension).toMatchObject({ kind: 'permanent', endsOn: null });

    const teacher = await g.prisma.teacher.findUniqueOrThrow({ where: { id: s.teacherId } });
    expect(teacher.isActive).toBe(false);
    expect(teacher.leftAt).not.toBeNull();
    // RT-032: the deactivation is journaled, so every session is revoked through the barrier.
    const [{ n }] = await g.prisma.$queryRawUnsafe<Array<{ n: number }>>(
      `select count(*)::int as n from chat.principal_revocation where principal_kind = 'teacher' and principal_id = $1::uuid`,
      s.teacherId,
    );
    expect(n).toBe(1);
  });
});

// ---------------------------------------------------------------------------

describe('4. who may, and the database backstop', () => {
  it('only the Teachers department -- and, since PD-26\'s amendment, the teacher\'s Operations supervisor -- reads and decides', async () => {
    const v = await apology();
    for (const outsider of [s.teacherId, s.parentId]) {
      expect(await code(discipline.list(outsider, {}))).toBe(CommErrorCode.DISCIPLINE_DENIED);
      expect(await code(discipline.decide(outsider, v, { decision: 'warning' }))).toBe(CommErrorCode.DISCIPLINE_DENIED);
    }
    // An Operations supervisor with no charge over teacher_c: nothing to read, and not found.
    expect((await discipline.list(s.otherAdminId, {})).violations).toHaveLength(0);
    expect(await code(discipline.decide(s.otherAdminId, v, { decision: 'warning' }))).toBe(CommErrorCode.DISCIPLINE_NOT_FOUND);
    expect((await discipline.list(tmgrId, {})).violations).toHaveLength(1);
  });

  it('a violation is decided once, by the department, and never deleted', async () => {
    const v = await apology();
    expect(
      await sqlError(g.prisma.teacherViolation.update({ where: { id: v }, data: { decision: 'warning', suggestedStep: 1, decidedBy: s.otherAdminId } })),
    ).toMatch(/Teachers department/);
    await discipline.decide(tsupId, v, { decision: 'warning' });
    expect(
      await sqlError(g.prisma.teacherViolation.update({ where: { id: v }, data: { decision: 'excused', decisionNote: 'x' } })),
    ).toMatch(/decided once/);
    expect(await sqlError(g.prisma.teacherViolation.delete({ where: { id: v } }))).toMatch(/never deleted/);
  });
});
