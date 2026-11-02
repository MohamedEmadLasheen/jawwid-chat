/**
 * TEACHER-008 (QA 2026-10-31, design approved by the department head): a
 * lesson the academy cancels BECAUSE OF THE TEACHER -- approved leave, a
 * suspension, the teacher leaving -- owes the family a make-up, as the
 * teacher's own apology does. It used to be an ordinary academy cancellation
 * (admin_cancelled), which owes nothing, so the family silently lost a paid
 * lesson.
 *
 *   cause     chat.lesson.cancel_cause: teacher_leave | teacher_suspended |
 *             teacher_deactivated, written by the three callers only, and
 *             only with outcome admin_cancelled (the database refuses the rest)
 *   owed      the 'teacher_cancelled' token: chat.lesson_owes_makeup and the
 *             API's owed list count such a lesson; PD-47's makeup_owed task
 *             reads the same rule (chat.work_task_makeup_causes)
 *   card      the family's lesson_cancelled card says a make-up is owed
 *   manual    an administrator's own cancellation stays make-up-free
 *
 * Synthetic fixtures only (G-16).
 */
import { randomUUID } from 'node:crypto';
import { PrismaAuditService } from '@platform/audit.service';
import { PrismaIdentityService } from '@platform/identity.service';
import { AuthService } from '@platform/auth/auth.service';
import { PasswordResetService } from '@platform/auth/password-reset.service';
import { TeacherScopeService } from '@platform/teacher-scope';
import { LessonService, MAKEUP_CAUSES } from '../../src/lessons/lesson.service';
import { SupervisionConversationService } from '../../src/supervision/supervision-conversation.service';
import { CardPoster } from '../../src/supervision/card-poster';
import { LeaveService } from '../../src/leave/leave.service';
import { DisciplineService } from '../../src/discipline/discipline.service';
import { SchedulingService } from '../../src/lessons/scheduling.service';
import { TrialService } from '../../src/lessons/trial.service';
import { NewStudentsService } from '../../src/new-students/new-students.service';
import { TrialGroupService } from '../../src/lessons/trial-group.service';
import { TeacherFileService } from '../../src/teacher-file/teacher-file.service';
import { TeacherOnboardingService } from '../../src/teacher-file/teacher-onboarding.service';
import { LessonRecordService } from '../../src/lessons/lesson-record.service';
import { TaskService } from '../../src/tasks/task.service';
import type { MailSender } from '../../src/account-recovery/recovery-delivery';
import { buildGraph, seed, truncate, withAssignmentGate, Scenario } from './harness';

const g = buildGraph();
const audit = new PrismaAuditService();
const lessons = new LessonService(g.prisma, g.authz, g.conversations, g.outbox, g.config, audit);
const scope = new TeacherScopeService(g.prisma);
const supervision = new SupervisionConversationService(g.prisma, g.authz, g.conversations, g.outbox, audit, scope);
const cards = new CardPoster(g.conversations, g.outbox, audit);
const scheduling = new SchedulingService(g.prisma, g.authz, g.conversations, lessons, g.outbox, g.config, g.reminders, audit);
const groups = new TrialGroupService(g.prisma, g.authz, g.conversations, g.outbox, cards, g.config, audit);
const trials = new TrialService(g.prisma, g.conversations, lessons, scheduling, audit, groups, new NewStudentsService(g.prisma));
const leave = new LeaveService(g.prisma, g.conversations, supervision, cards, lessons, audit, trials);
const discipline = new DisciplineService(g.prisma, g.conversations, supervision, cards, lessons, g.outbox, g.config, audit, trials);
const identity = new PrismaIdentityService(g.prisma);
const auth = new AuthService(g.prisma, identity, audit, undefined, g.authz);
const mailer: MailSender = { available: true, send: async () => undefined };
const onboarding = new TeacherOnboardingService(
  g.prisma, new TeacherFileService(g.prisma, g.authz, g.conversations, audit, scope), supervision,
  new PasswordResetService(g.prisma, auth, audit), auth, lessons, trials, mailer, g.notifications, scope,
);

const records = new LessonRecordService(g.prisma, lessons, g.conversations, g.outbox, audit);
const tasks = new TaskService(g.prisma, g.outbox);

jest.setTimeout(120_000);

const HOUR = 3_600_000;
let s: Scenario;
let groupId: string;
let tsupId: string;
let tmgrId: string;
let orgId: string;

/** The academy's calendar day (Cairo) of an instant: the day a leave covers. */
const cairoDay = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Cairo' }).format(d);

/** A 30-minute lesson of s.learnerId with s.teacherId, `ms` from now. */
async function lessonIn(ms: number): Promise<{ id: string; startsAt: Date }> {
  const startsAt = new Date(Date.now() + ms);
  const l = await lessons.schedule(tsupId, {
    learnerId: s.learnerId, startsAt: startsAt.toISOString(), endsAt: new Date(startsAt.getTime() + HOUR / 2).toISOString(),
  });
  return { id: l.id, startsAt };
}

const row = (id: string) => g.prisma.lesson.findUniqueOrThrow({ where: { id } });
const owed = async () => (await lessons.owedMakeups(orgId, { learnerIds: [s.learnerId], causes: MAKEUP_CAUSES })).map((l) => l.id);
async function cancelCard(lessonId: string) {
  const messages = await g.prisma.message.findMany({
    where: { conversationId: groupId, type: 'card' }, include: { card: true }, orderBy: { seq: 'asc' },
  });
  return messages.find((m) => m.card?.lessonId === lessonId && m.card.kind === 'lesson_cancelled')?.card?.payload as Record<string, unknown> | undefined;
}
async function sqlError(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
  throw new Error('expected the database to refuse');
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
  orgId = (await g.prisma.teacher.findUniqueOrThrow({ where: { id: s.teacherId } })).organizationId;
  [tsupId, tmgrId] = [randomUUID(), randomUUID()];
  await g.prisma.$executeRawUnsafe(
    `insert into chat.staff (id, name, role, is_active) values ($1::uuid, 'tsup_e', 'admin', true), ($2::uuid, 'tmgr_e', 'manager', true)`,
    tsupId, tmgrId,
  );
  const [{ id: dept }] = await g.prisma.$queryRawUnsafe<Array<{ id: string }>>(
    `insert into chat.department (kind, display_name, manager_id) values ('teachers', 'teachers', $1::uuid) returning id::text as id`, tmgrId,
  );
  await g.prisma.$executeRawUnsafe(
    `insert into chat.department_member (staff_id, organization_id, department_id, position)
     values ($1::uuid, chat.default_organization_id(), $2::uuid, 'supervisor')`,
    tsupId, dept,
  );
});

describe('TEACHER-008: cancelled because of the teacher, a make-up is owed', () => {
  it('approved leave: the lesson is cancelled for teacher_leave, owes a make-up, and the family is told', async () => {
    const l = await lessonIn(48 * HOUR);
    const day = cairoDay(l.startsAt);
    const { request } = await leave.request(s.teacherId, { firstDay: day, lastDay: day, reason: 'family' });
    await leave.approve(tsupId, request.id, { cancelCollidingLessons: true });

    expect(await row(l.id)).toMatchObject({ outcome: 'admin_cancelled', cancelCause: 'teacher_leave' });
    expect(await owed()).toContain(l.id);
    expect(await cancelCard(l.id)).toMatchObject({ outcome: 'admin_cancelled', makeupOwed: true });
    // PD-47 reads the same rule.
    const [{ owes }] = await g.prisma.$queryRaw<Array<{ owes: boolean }>>`
      SELECT chat.lesson_owes_makeup(${l.id}::uuid, chat.work_task_makeup_causes()) AS owes`;
    expect(owes).toBe(true);
  });

  it('a suspension: the colliding lesson is cancelled for teacher_suspended and owes a make-up', async () => {
    const apologised = await lessonIn(3 * HOUR);
    await lessons.teacherApology(s.teacherId, apologised.id, { reason: 'ill' });
    const v = (await g.prisma.teacherViolation.findFirstOrThrow({ where: { lessonId: apologised.id } })).id;
    const inside = await lessonIn(26 * HOUR);
    await discipline.decide(tsupId, v, { decision: 'temporary_suspension', note: 'repeated absences', cancelCollidingLessons: true });

    expect(await row(inside.id)).toMatchObject({ outcome: 'admin_cancelled', cancelCause: 'teacher_suspended' });
    expect(await owed()).toEqual(expect.arrayContaining([inside.id, apologised.id]));
    expect(await cancelCard(inside.id)).toMatchObject({ makeupOwed: true });
  });

  it('the teacher leaves the academy: their open lesson is cancelled for teacher_deactivated and owes a make-up', async () => {
    const l = await lessonIn(30 * HOUR);
    // Offboarding needs the teacher's students moved first; the lesson booked with them stays theirs.
    await withAssignmentGate(g.prisma, `update chat.learner set teacher_id = '${s.newTeacherId}'::uuid where teacher_id = '${s.teacherId}'::uuid`);
    // A signed-in manager has an account; offboarding records it.
    const account = await g.prisma.account.create({ data: { subject: `t008-${randomUUID()}@example.test`, kind: 'staff', status: 'active', isActive: true } });
    await g.prisma.staff.update({ where: { id: tmgrId }, data: { accountId: account.id } });
    try {
      await onboarding.offboard(tmgrId, s.teacherId, { reason: 'contract ended', cancelOpenLessons: true });
    } finally {
      await g.prisma.staff.update({ where: { id: tmgrId }, data: { accountId: null } });
      await g.prisma.account.delete({ where: { id: account.id } }).catch(() => undefined);
    }

    expect(await row(l.id)).toMatchObject({ outcome: 'admin_cancelled', cancelCause: 'teacher_deactivated' });
    expect(await owed()).toContain(l.id);
  });

  it('an administrator\'s own cancellation stays make-up-free: no cause, not owed, no make-up on the card', async () => {
    const l = await lessonIn(5 * HOUR);
    await lessons.cancel(tsupId, l.id, { reason: 'public holiday', cancelCause: 'teacher_leave' });
    expect(await row(l.id)).toMatchObject({ outcome: 'admin_cancelled', cancelCause: null });
    expect(await owed()).not.toContain(l.id);
    expect((await cancelCard(l.id))?.makeupOwed).toBeUndefined();
  });

  it('a make-up booked for it settles it, as for any owed lesson', async () => {
    const l = await lessonIn(48 * HOUR);
    const day = cairoDay(l.startsAt);
    const { request } = await leave.request(s.teacherId, { firstDay: day, lastDay: day, reason: 'family' });
    await leave.approve(tsupId, request.id, { cancelCollidingLessons: true });
    expect(await owed()).toContain(l.id);
    await g.prisma.lesson.create({
      data: {
        organizationId: orgId, kind: 'makeup', makeupFor: l.id, learnerId: s.learnerId, teacherId: s.teacherId,
        startsAt: new Date(Date.now() + 96 * HOUR), endsAt: new Date(Date.now() + 96 * HOUR + HOUR / 2),
        createdByKind: 'staff', createdBy: tsupId,
      },
    });
    expect(await owed()).not.toContain(l.id);
  });

  it('PD-47 raises the makeup_owed task for it (#396 review, P1): the task rule reads the cause, not the outcome alone', async () => {
    const config = ['tasks.raise_after_seconds', 'tasks.since.makeup_owed'];
    const saved = await g.prisma.config.findMany({ where: { key: { in: config } } });
    await g.prisma.$executeRawUnsafe(
      `insert into chat.teacher_supervisor_assignment (teacher_id, organization_id, supervisor_id, assigned_by)
       values ($1::uuid, chat.default_organization_id(), $2::uuid, $3::uuid)`, s.teacherId, tsupId, tmgrId,
    );
    await g.prisma.$executeRawUnsafe(`insert into chat.config (key, value) values ('tasks.raise_after_seconds', '0'::jsonb)
                                      on conflict (key) do update set value = excluded.value`);
    await g.prisma.$executeRawUnsafe(`insert into chat.config (key, value) values ('tasks.since.makeup_owed', to_jsonb('2000-01-01T00:00:00Z'::text))
                                      on conflict (key) do update set value = excluded.value`);
    try {
      const l = await lessonIn(48 * HOUR);
      const day = cairoDay(l.startsAt);
      const { request } = await leave.request(s.teacherId, { firstDay: day, lastDay: day, reason: 'family' });
      await leave.approve(tsupId, request.id, { cancelCollidingLessons: true });
      await tasks.sweep();
      const raised = await g.prisma.$queryRaw<Array<{ n: number }>>`
        SELECT count(*)::int AS n FROM chat.work_task WHERE source_type = 'makeup_owed' AND source_id = ${l.id}::uuid AND state <> 'done'`;
      expect(raised[0]!.n).toBe(1);
    } finally {
      await g.prisma.config.deleteMany({ where: { key: { in: config } } });
      for (const c of saved) await g.prisma.config.create({ data: { key: c.key, value: c.value as never, scope: c.scope } });
    }
  });

  it('a correction of such a lesson clears the cause -- never a 500 from the database (#396 review, P2)', async () => {
    const l = await lessonIn(48 * HOUR);
    const day = cairoDay(l.startsAt);
    const { request } = await leave.request(s.teacherId, { firstDay: day, lastDay: day, reason: 'family' });
    await leave.approve(tsupId, request.id, { cancelCollidingLessons: true });
    await records.correct(tsupId, l.id, { outcome: 'teacher_apology', reason: 'the teacher apologised before the leave' });
    expect(await row(l.id)).toMatchObject({ outcome: 'teacher_apology', cancelCause: null });
    expect(await owed()).toContain(l.id); // a teacher's apology owes one too
  });

  it('the database keeps the cause honest: one of three, and only on an academy cancellation', async () => {
    const l = await lessonIn(6 * HOUR);
    expect(await sqlError(g.prisma.$executeRawUnsafe(
      `update chat.lesson set outcome = 'admin_cancelled', outcome_note = 'x', outcome_at = now(), cancel_cause = 'weather' where id = $1::uuid`, l.id,
    ))).toMatch(/lesson_cancel_cause/);
    expect(await sqlError(g.prisma.$executeRawUnsafe(
      `update chat.lesson set cancel_cause = 'teacher_leave' where id = $1::uuid`, l.id,
    ))).toMatch(/lesson_cancel_cause/);
  });
});
