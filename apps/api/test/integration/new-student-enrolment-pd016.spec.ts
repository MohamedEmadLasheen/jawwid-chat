/**
 * PD-16 -- from Sales' subscription form to a family in Chat, and the parent's
 * own sign-up.
 *
 *   1. Assign: only the Operations manager (or the super admin); Chat creates
 *      the family, the parent and an account to sign up to, each child with
 *      Sales' teacher, the supervision, course and stated age; the form freezes
 *   2. who sees which entry on New Students
 *   3. the responsible supervisor opens the family's group (parent, teacher,
 *      supervisor) and the parent's direct chat with them
 *   4. the parent's sign-up: a relayed code, ten minutes, five tries, no
 *      enumeration; the parent lands signed in
 *
 * Synthetic fixtures only (QA gate G-16).
 */
import { randomUUID } from 'node:crypto';
import { PrismaAuditService } from '@platform/audit.service';
import { CommError, CommErrorCode } from '@platform/errors';
import { AuthService } from '@platform/auth/auth.service';
import { AuthError, AuthErrorCode } from '@platform/auth/auth.errors';
import { PrismaIdentityService } from '@platform/identity.service';
import { ParentSignupService } from '../../src/platform/auth/parent-signup.service';
import { LessonService } from '../../src/lessons/lesson.service';
import { SchedulingService } from '../../src/lessons/scheduling.service';
import { TrialGroupService } from '../../src/lessons/trial-group.service';
import { TrialService } from '../../src/lessons/trial.service';
import { EnrollmentService } from '../../src/lessons/enrollment.service';
import { NewStudentsService } from '../../src/new-students/new-students.service';
import { NewStudentEnrolmentService } from '../../src/new-students/enrolment.service';
import { CardPoster } from '../../src/supervision/card-poster';
import { buildGraph, seed, truncate, Scenario } from './harness';

process.env.JWT_ACCESS_SECRET ??= 'integration-access-secret-32-chars-min!';
process.env.JWT_REFRESH_SECRET ??= 'integration-refresh-secret-32-chars-min!';

// Each test seeds an organization and records a subscribed trial before it starts: a cold
// first run in the full suite overruns Jest's 5 s default for that hook.
jest.setTimeout(60_000);

const g = buildGraph();
const audit = new PrismaAuditService();
const lessons = new LessonService(g.prisma, g.authz, g.conversations, g.outbox, g.config, audit);
const scheduling = new SchedulingService(g.prisma, g.authz, g.conversations, lessons, g.outbox, g.config, g.reminders, audit);
const groups = new TrialGroupService(g.prisma, g.authz, g.conversations, g.outbox, new CardPoster(g.conversations, g.outbox, audit), g.config, audit);
const trials = new TrialService(g.prisma, g.conversations, lessons, scheduling, audit, groups, new NewStudentsService(g.prisma));
const enrolment = new NewStudentEnrolmentService(g.prisma, g.authz, g.conversations, new NewStudentsService(g.prisma), lessons, scheduling, audit);
const details = new EnrollmentService(g.prisma, g.authz, g.conversations, lessons, scheduling, audit);
const auth = new AuthService(g.prisma, new PrismaIdentityService(g.prisma), audit);
const signup = new ParentSignupService(g.prisma, audit);

const MIN = 60_000;
const PASSWORD = 'pd16-parent-password';

let s: Scenario;
let tsupId: string;
let salesId: string;
let trialId: string;
/** Accounts outlive the harness's truncate: a fresh e-mail per test. */
let EMAIL: string;
let LOWER: string;
let trialsMade = 0;

async function code(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (e) {
    if (e instanceof CommError || e instanceof AuthError) return e.code;
    throw e;
  }
  throw new Error('expected a refusal, got success');
}

async function department(kind: string, staffIds: string[]) {
  const [{ id }] = await g.prisma.$queryRawUnsafe<Array<{ id: string }>>(
    `insert into chat.department (kind, display_name) values ($1, $1) returning id::text as id`, kind,
  );
  for (const staffId of staffIds) {
    await g.prisma.$executeRawUnsafe(
      `insert into chat.department_member (staff_id, organization_id, department_id, position)
       values ($1::uuid, chat.default_organization_id(), $2::uuid, 'supervisor')`,
      staffId, id,
    );
  }
}

/** A trial that took place an hour ago, for which Sales recorded "subscribed" with a form. */
async function subscribedTrial(email: string | null = EMAIL): Promise<string> {
  trialsMade += 1;
  const prospectId = (await trials.createProspect(salesId, { displayName: `prospect_${randomUUID().slice(0, 6)}` })).id;
  // A different hour for each trial of a test: one teacher, never two at once.
  const startsAt = new Date(Date.now() - (60 + 60 * trialsMade) * MIN);
  const lesson = await g.prisma.lesson.create({
    data: {
      organizationId: (await g.prisma.teacher.findUniqueOrThrow({ where: { id: s.teacherId } })).organizationId,
      kind: 'trial', prospectId, teacherId: s.teacherId, startsAt, endsAt: new Date(startsAt.getTime() + 45 * MIN),
      createdByKind: 'staff', createdBy: salesId,
    },
  });
  await trials.outcome(salesId, lesson.id, {
    result: 'subscribed',
    subscription: {
      parent: { name: 'parent_p', email, phone: '+99 000 333 444' },
      children: [
        { name: 'child_p1', age: 8, course: 'course_p', teacherId: s.teacherId, packagePrice: 1000, lessonPrice: 125,
          schedule: [{ weekday: 1, time: '17:00' }] },
        { name: 'child_p2', age: 11, course: 'Course_P', teacherId: s.teacherId, packagePrice: 1000, lessonPrice: 125,
          schedule: [{ weekday: 3, time: '18:00' }] },
      ],
      payment: { currency: 'EGP', method: 'invoice' },
    },
  });
  return lesson.id;
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
  tsupId = randomUUID();
  salesId = randomUUID();
  await g.prisma.$executeRawUnsafe(
    `insert into chat.staff (id, name, role, is_active) values ($1::uuid, 'tsup_p', 'admin', true), ($2::uuid, 'sales_p', 'admin', true)`,
    tsupId, salesId,
  );
  await department('teachers', [tsupId]);
  await department('sales', [salesId]);
  const tag = randomUUID().slice(0, 8);
  EMAIL = `Parent.${tag}@Example.Test`;
  LOWER = EMAIL.toLowerCase();
  trialId = await subscribedTrial();
});

describe('1. Assign', () => {
  it('only the Operations manager assigns; Chat creates the family, parent, account and children', async () => {
    expect(await code(enrolment.assign(s.ownerId, trialId, { supervisorId: s.ownerId }))).toBe(CommErrorCode.LESSON_DENIED);
    expect(await code(enrolment.assign(salesId, trialId, { supervisorId: s.ownerId }))).toBe(CommErrorCode.LESSON_DENIED);
    expect(await code(enrolment.assign(s.managerId, trialId, {}))).toBe(CommErrorCode.VALIDATION);

    const done = await enrolment.assign(s.managerId, trialId, { supervisorId: s.ownerId });
    expect(done.learnerIds).toHaveLength(2);

    const family = await g.prisma.family.findUniqueOrThrow({ where: { id: done.familyId } });
    expect(family.ownerId).toBe(s.ownerId);
    const contact = await g.prisma.contact.findFirstOrThrow({ where: { familyId: family.id } });
    expect(contact).toMatchObject({ name: 'parent_p', canMessage: true, isActive: true });
    const account = await g.prisma.account.findUniqueOrThrow({ where: { id: contact.accountId as string }, include: { credential: true } });
    expect(account).toMatchObject({ subject: LOWER, kind: 'family' });
    expect(account.credential).toBeNull(); // the parent sets it at sign-up
    const learners = await g.prisma.learner.findMany({ where: { familyId: family.id }, orderBy: { name: 'asc' } });
    expect(learners.map((l) => [l.name, l.teacherId])).toEqual([['child_p1', s.teacherId], ['child_p2', s.teacherId]]);
    const supervision = await g.prisma.learnerSupervision.findMany({ where: { learnerId: { in: done.learnerIds } } });
    expect(supervision.map((x) => x.supervisorId)).toEqual([s.ownerId, s.ownerId]);
    // One course for "course_p" and "Course_P"; the stated age kept until a date of birth.
    expect(await g.prisma.course.count()).toBe(1);
    const enrolments = await g.prisma.learnerEnrollment.findMany({ where: { learnerId: { in: done.learnerIds } } });
    expect(enrolments.map((e) => e.statedAge).sort()).toEqual([11, 8].sort());
    // The phone stays in the confined form: it is on no record Chat created.
    const created = JSON.stringify({ family, contact, account, learners });
    expect(created).not.toContain('333 444');
    expect(await g.prisma.auditLog.count({ where: { action: 'new_student.enrolled' } })).toBe(1);
    // Weekly times: the teacher has no availability yet, so they wait (and the answer says so).
    expect(done.schedules.every((x) => !x.set && x.reason)).toBe(true);
  });

  it('sets the weekly times from the form where the teacher is free', async () => {
    await scheduling.setAvailability(tsupId, s.teacherId, {
      timezone: 'Africa/Cairo',
      windows: [1, 2, 3, 4, 5, 6, 7].map((weekday) => ({ weekday, start: '08:00', end: '22:00' })),
    });
    const done = await enrolment.assign(s.managerId, trialId, { supervisorId: s.ownerId });
    expect(done.schedules.map((x) => x.set)).toEqual([true, true]);
    const slots = await g.prisma.learnerScheduleSlot.findMany({ where: { learnerId: { in: done.learnerIds } } });
    expect(slots.map((x) => [x.weekday, x.startMinute, x.durationMinutes]).sort()).toEqual([[1, 1020, 45], [3, 1080, 45]]);
  });

  it('once, with a usable e-mail; the form then freezes', async () => {
    const noEmail = await subscribedTrial(null);
    expect(await code(enrolment.assign(s.managerId, noEmail, { supervisorId: s.ownerId }))).toBe(CommErrorCode.VALIDATION);
    await enrolment.assign(s.managerId, noEmail, { supervisorId: s.ownerId, email: `typed.${randomUUID().slice(0, 8)}@example.test` });

    await enrolment.assign(s.managerId, trialId, { supervisorId: s.ownerId });
    expect(await code(enrolment.assign(s.managerId, trialId, { supervisorId: s.ownerId }))).toBe(CommErrorCode.LESSON_STATE);
    // Sales can no longer edit or withdraw a form that became a family.
    await expect(g.prisma.$executeRawUnsafe(`update chat.trial_subscription set parent_name = 'x' where lesson_id = $1::uuid`, trialId))
      .rejects.toThrow(/already enrolled/);
    // The same e-mail cannot make a second account.
    const again = await subscribedTrial();
    expect(await code(enrolment.assign(s.managerId, again, { supervisorId: s.ownerId }))).toBe(CommErrorCode.LESSON_STATE);
  });

  it('the database refuses a child with a teacher from anyone but the Operations manager', async () => {
    const done = await enrolment.assign(s.managerId, trialId, { supervisorId: s.ownerId });
    await expect(g.prisma.$queryRawUnsafe(
      `select chat.enrol_learner($1::uuid, 'sneaky', $2::uuid, $3::uuid)`, done.familyId, s.teacherId, s.ownerId,
    )).rejects.toThrow(/Operations manager/);
    await expect(g.prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe('set local role chat_app');
      await tx.$queryRawUnsafe(`select chat.enrol_learner($1::uuid, 'sneaky', $2::uuid, $3::uuid)`, done.familyId, s.teacherId, s.managerId);
    })).rejects.toThrow(/permission denied/);
  });
});

describe('2. who sees which entry', () => {
  it('unassigned: Sales and the Operations manager; assigned: the supervisor and the manager, not Sales nor other supervisors', async () => {
    const ids = async (actor: string) => (await enrolment.page(actor)).students.map((x) => x.trialId);
    expect(await ids(salesId)).toEqual([trialId]);
    expect(await ids(s.managerId)).toEqual([trialId]);
    expect(await ids(s.ownerId)).toEqual([]);
    expect((await enrolment.page(s.managerId)).canAssign).toBe(true);
    expect((await enrolment.page(salesId)).canAssign).toBe(false);

    await enrolment.assign(s.managerId, trialId, { supervisorId: s.ownerId });
    expect(await ids(s.ownerId)).toEqual([trialId]);
    expect(await ids(s.managerId)).toEqual([trialId]);
    expect(await ids(salesId)).toEqual([]);
    expect(await ids(s.otherAdminId)).toEqual([]);
    const entry = (await enrolment.page(s.ownerId)).students[0];
    expect(entry.enrolment).toMatchObject({ supervisor: { id: s.ownerId }, canCreateGroup: true, parentSignup: { state: 'not_started' } });
  });
});

describe('3. the family group', () => {
  it('the responsible supervisor opens it with the parent and the teacher; it is named "Teacher — Children"', async () => {
    const done = await enrolment.assign(s.managerId, trialId, { supervisorId: s.ownerId });
    expect(await code(enrolment.createGroup(s.otherAdminId, trialId))).not.toBe('');
    const { conversationId } = await enrolment.createGroup(s.ownerId, trialId);
    const conv = await g.prisma.conversation.findUniqueOrThrow({ where: { id: conversationId } });
    expect(conv.type).toBe('family_group');
    expect(conv.title).toMatch(/^teacher_c — child_p[12] · child_p[12]$/);
    const members = await g.prisma.conversationMember.findMany({ where: { conversationId, leftAt: null } });
    const contact = await g.prisma.contact.findFirstOrThrow({ where: { familyId: done.familyId } });
    expect(members.map((m) => m.actorId).sort()).toEqual([contact.id, s.teacherId, s.ownerId].sort());
    // The parent's direct chat with their supervisor.
    expect(await g.prisma.conversation.count({ where: { type: 'direct', familyId: done.familyId } })).toBe(1);
    expect(await code(enrolment.createGroup(s.ownerId, trialId))).toBe(CommErrorCode.LESSON_STATE);
    expect((await enrolment.page(s.ownerId)).students[0].enrolment).toMatchObject({ groupConversationId: conversationId, canCreateGroup: false });
    // The group's details page shows each child with the age Sales recorded.
    const kids = await details.groupLearners(contact.id, conversationId);
    expect(kids.learners.map((k) => [k.name, k.age, k.course?.name]).sort()).toEqual([['child_p1', 8, 'course_p'], ['child_p2', 11, 'course_p']]);
  });
});

describe('4. the parent signs up', () => {
  it('asks for a code, the supervisor relays it, the parent sets a password and is signed in', async () => {
    await enrolment.assign(s.managerId, trialId, { supervisorId: s.ownerId });
    expect(await signup.request(` ${EMAIL.toUpperCase()} `)).toEqual({ ok: true, delivery: 'relay' });
    const entry = (await enrolment.page(s.ownerId)).students[0];
    expect(entry.enrolment?.parentSignup.state).toBe('code_waiting');
    const relayed = (entry.enrolment?.parentSignup as { code: string }).code;
    expect(relayed).toMatch(/^[0-9]{6}$/);
    // Sales never sees the code (nor the entry, once assigned).
    expect((await enrolment.page(salesId)).students).toEqual([]);

    expect(await code(signup.verify(EMAIL, relayed, 'short'))).toBe(AuthErrorCode.PASSWORD_TOO_WEAK);
    expect(await signup.verify(EMAIL, relayed, PASSWORD)).toEqual({ ok: true });
    // The app then signs in like anyone else.
    expect((await auth.login(LOWER, PASSWORD)).accessToken).toBeTruthy();
    expect((await enrolment.page(s.ownerId)).students[0].enrolment?.parentSignup).toEqual({ state: 'signed_up' });
    // The code is spent.
    expect(await code(signup.verify(EMAIL, relayed, PASSWORD))).toBe(AuthErrorCode.SIGNUP_CODE_INVALID);
    expect(await signup.request(EMAIL)).toEqual({ ok: true, delivery: 'relay' });
    expect(await g.prisma.parentSignupCode.count({ where: { usedAt: null, supersededAt: null } })).toBe(0);
    expect(await g.prisma.auditLog.count({ where: { action: 'parent.signed_up' } })).toBe(1);
  });

  it('five wrong tries spend the code; an expired code is refused; a new request supersedes the old', async () => {
    await enrolment.assign(s.managerId, trialId, { supervisorId: s.ownerId });
    await signup.request(EMAIL);
    const first = await g.prisma.parentSignupCode.findFirstOrThrow({ where: { usedAt: null, supersededAt: null } });
    await signup.request(EMAIL);
    expect((await g.prisma.parentSignupCode.findUniqueOrThrow({ where: { id: first.id } })).supersededAt).not.toBeNull();
    const live = await g.prisma.parentSignupCode.findFirstOrThrow({ where: { usedAt: null, supersededAt: null } });
    const wrong = live.relayCode === '000000' ? '111111' : '000000';
    for (let i = 0; i < 5; i++) expect(await code(signup.verify(EMAIL, wrong, PASSWORD))).toBe(AuthErrorCode.SIGNUP_CODE_INVALID);
    expect(await code(signup.verify(EMAIL, live.relayCode as string, PASSWORD))).toBe(AuthErrorCode.SIGNUP_CODE_INVALID);

    await signup.request(EMAIL);
    const next = await g.prisma.parentSignupCode.findFirstOrThrow({ where: { usedAt: null, supersededAt: null } });
    await g.prisma.$executeRawUnsafe(
      `update chat.parent_signup_code set attempts = attempts where id = $1::uuid`, next.id,
    );
    // Age it past its life (a fixture: the guard keeps expires_at, so the row is recreated already expired).
    await g.prisma.$executeRawUnsafe(`alter table chat.parent_signup_code disable trigger parent_signup_code_is_coherent`);
    await g.prisma.$executeRawUnsafe(`update chat.parent_signup_code set created_at = now() - interval '20 minutes', expires_at = now() - interval '10 minutes' where id = $1::uuid`, next.id);
    await g.prisma.$executeRawUnsafe(`alter table chat.parent_signup_code enable trigger parent_signup_code_is_coherent`);
    expect(await code(signup.verify(EMAIL, next.relayCode as string, PASSWORD))).toBe(AuthErrorCode.SIGNUP_CODE_INVALID);
  });

  it('answers alike for an unknown e-mail, issues nothing for it, and never for staff or teachers', async () => {
    expect(await signup.request('nobody@example.test')).toEqual({ ok: true, delivery: 'relay' });
    expect(await g.prisma.parentSignupCode.count()).toBe(0);
    expect(await code(signup.verify('nobody@example.test', '123456', PASSWORD))).toBe(AuthErrorCode.SIGNUP_CODE_INVALID);
    // An e-mail Chat holds for an unassigned form is not an account yet either.
    expect(await signup.request(EMAIL)).toEqual({ ok: true, delivery: 'relay' });
    expect(await g.prisma.parentSignupCode.count()).toBe(0);
  });
});
