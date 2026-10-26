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
 *   4. the parent's sign-up: a relayed code, five tries, no enumeration; the
 *      parent lands signed in
 *   5. PD-32: no time expiry; invalidated by staff, by any password, by an
 *      inactive account; ten wrong codes a day lock the e-mail until staff reset
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
import { OrgStructureService } from '../../src/org/org-structure.service';
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
const enrolment = new NewStudentEnrolmentService(
  g.prisma, g.authz, g.conversations, new NewStudentsService(g.prisma), lessons, scheduling,
  new OrgStructureService(g.prisma, g.authz, g.conversations, audit), audit,
);
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
    // The phone stays confined: on no record the chat engine reads -- only in the
    // form and (PD-17) the parent's admin-only file, with the family's billing.
    const created = JSON.stringify({ family, contact, account, learners });
    expect(created).not.toContain('333 444');
    expect(await g.prisma.parentFile.findUniqueOrThrow({ where: { contactId: contact.id } })).toMatchObject({
      adminOnlyParentPhone: '+99 000 333 444',
      adminOnlyParentEmail: LOWER,
    });
    expect(await g.prisma.familyBilling.findUniqueOrThrow({ where: { familyId: family.id } })).toMatchObject({
      paymentMethod: 'invoice',
      currency: 'EGP',
    });
    const audits = await g.prisma.auditLog.findMany({ select: { before: true, after: true, reason: true } });
    expect(JSON.stringify(audits)).not.toContain('333 444');
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

describe('3b. changing the supervisor (PD-24)', () => {
  it('only the Operations manager; the same group, the parent\'s 1:1 and the card follow the children', async () => {
    const done = await enrolment.assign(s.managerId, trialId, { supervisorId: s.ownerId });
    const { conversationId } = await enrolment.createGroup(s.ownerId, trialId);
    const contact = await g.prisma.contact.findFirstOrThrow({ where: { familyId: done.familyId } });
    const direct = await g.prisma.conversation.findFirstOrThrow({ where: { type: 'direct', familyId: done.familyId } });

    for (const who of [s.ownerId, s.otherAdminId, salesId, tsupId]) {
      expect(await code(enrolment.changeSupervisor(who, trialId, { supervisorId: s.otherAdminId, reason: 'probe' }))).toBe(CommErrorCode.LESSON_DENIED);
    }
    expect(await code(enrolment.changeSupervisor(s.managerId, trialId, { supervisorId: s.otherAdminId }))).toBe(CommErrorCode.VALIDATION);

    const r = await enrolment.changeSupervisor(s.managerId, trialId, { supervisorId: s.otherAdminId, reason: 'supervisor on leave' });
    expect(r).toMatchObject({ changed: true, groups: 1, directChats: 1 });
    expect(r.learners.map((l) => l.id).sort()).toEqual([...done.learnerIds].sort());

    // The card: now the new supervisor's, and gone from the previous one's page.
    const ids = async (actor: string) => (await enrolment.page(actor)).students.map((x) => x.trialId);
    expect(await ids(s.otherAdminId)).toEqual([trialId]);
    expect(await ids(s.ownerId)).toEqual([]);
    expect((await enrolment.page(s.managerId)).students[0].enrolment).toMatchObject({
      supervisor: { id: s.otherAdminId },
      groupConversationId: conversationId,
    });
    // The same group and the same 1:1, with the new supervisor seated in place of the old.
    const seated = async (id: string) =>
      (await g.prisma.conversationMember.findMany({ where: { conversationId: id, leftAt: null } })).map((m) => m.actorId).sort();
    expect(await seated(conversationId)).toEqual([contact.id, s.teacherId, s.otherAdminId].sort());
    expect(await seated(direct.id)).toEqual([contact.id, s.otherAdminId].sort());
    expect(await g.prisma.conversation.count({ where: { familyId: done.familyId } })).toBe(2);
    expect((await g.prisma.family.findUniqueOrThrow({ where: { id: done.familyId } })).ownerId).toBe(s.otherAdminId);
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

  it('five wrong tries spend the code; a code from before PD-32 keeps its expiry; a new request supersedes the old', async () => {
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

describe('5. PD-32: valid until used or invalidated; ten wrong codes a day lock the e-mail', () => {
  const relayed = async () => (await g.prisma.parentSignupCode.findFirstOrThrow({ where: { usedAt: null, supersededAt: null } })).relayCode as string;
  const wrongFor = (right: string) => (right === '000000' ? '111111' : '000000');
  const signupOf = async (viewer: string) => (await enrolment.page(viewer)).students[0].enrolment?.parentSignup as Record<string, unknown>;

  it('a code has no expiry and still works a month later; the page shows no deadline', async () => {
    await enrolment.assign(s.managerId, trialId, { supervisorId: s.ownerId });
    await signup.request(EMAIL);
    const row = await g.prisma.parentSignupCode.findFirstOrThrow({ where: { usedAt: null, supersededAt: null } });
    expect(row.expiresAt).toBeNull();
    const shown = await signupOf(s.ownerId);
    expect(shown).toMatchObject({ state: 'code_waiting', code: row.relayCode, attempts: { wrong: 0, cap: 10, locked: false } });
    expect(shown).not.toHaveProperty('expiresAt');
    // A month old (a fixture: created_at is part of the code's identity).
    await g.prisma.$executeRawUnsafe(`alter table chat.parent_signup_code disable trigger parent_signup_code_is_coherent`);
    await g.prisma.$executeRawUnsafe(`update chat.parent_signup_code set created_at = now() - interval '30 days' where id = $1::uuid`, row.id);
    await g.prisma.$executeRawUnsafe(`alter table chat.parent_signup_code enable trigger parent_signup_code_is_coherent`);
    expect(await signup.verify(EMAIL, row.relayCode as string, PASSWORD)).toEqual({ ok: true });
    // A code is never issued with a deadline.
    await expect(g.prisma.$executeRawUnsafe(
      `insert into chat.parent_signup_code (organization_id, account_id, code_hash, expires_at)
       select organization_id, id, repeat('a', 64), now() + interval '1 hour' from chat.account where subject = $1`, LOWER,
    )).rejects.toThrow();
  });

  it('staff invalidate the live code; only the responsible may; the parent asks for a new one', async () => {
    await enrolment.assign(s.managerId, trialId, { supervisorId: s.ownerId });
    await signup.request(EMAIL);
    const old = await relayed();
    expect(await code(enrolment.invalidateSignupCode(salesId, trialId))).toBe(CommErrorCode.LESSON_DENIED);
    expect(await enrolment.invalidateSignupCode(s.ownerId, trialId)).toEqual({ invalidated: true });
    expect(await signupOf(s.ownerId)).toMatchObject({ state: 'not_started' });
    expect(await code(signup.verify(EMAIL, old, PASSWORD))).toBe(AuthErrorCode.SIGNUP_CODE_INVALID);
    expect(await g.prisma.auditLog.count({ where: { action: 'parent.signup_code_invalidated' } })).toBe(1);
    await signup.request(EMAIL);
    expect(await signup.verify(EMAIL, await relayed(), PASSWORD)).toEqual({ ok: true });
    // Signed up: nothing left to invalidate.
    expect(await code(enrolment.invalidateSignupCode(s.ownerId, trialId))).toBe(CommErrorCode.LESSON_STATE);
  });

  it('ten wrong codes in a day lock the e-mail across codes; a new code does not reset it; staff Reset attempts does', async () => {
    await enrolment.assign(s.managerId, trialId, { supervisorId: s.ownerId });
    for (let round = 0; round < 2; round++) {
      await signup.request(EMAIL);
      const right = await relayed();
      for (let i = 0; i < 5; i++) expect(await code(signup.verify(EMAIL, wrongFor(right), PASSWORD))).toBe(AuthErrorCode.SIGNUP_CODE_INVALID);
    }
    // Ten wrong: locked, even with a right code, and no new code is issued.
    await signup.request(EMAIL);
    expect(await g.prisma.parentSignupCode.count({ where: { usedAt: null, supersededAt: null } })).toBe(0);
    expect(await signupOf(s.ownerId)).toMatchObject({ state: 'not_started', attempts: { wrong: 10, cap: 10, locked: true } });
    expect(await code(signup.verify(EMAIL, '123456', PASSWORD))).toBe(AuthErrorCode.SIGNUP_LOCKED);

    // Invalidating codes is not a reset.
    await enrolment.invalidateSignupCode(s.ownerId, trialId);
    expect(await code(signup.verify(EMAIL, '123456', PASSWORD))).toBe(AuthErrorCode.SIGNUP_LOCKED);

    expect(await code(enrolment.resetSignupAttempts(salesId, trialId))).toBe(CommErrorCode.LESSON_DENIED);
    expect(await enrolment.resetSignupAttempts(s.ownerId, trialId)).toEqual({ cleared: 10 });
    expect(await g.prisma.auditLog.count({ where: { action: 'parent.signup_attempts_reset' } })).toBe(1);
    expect(await g.prisma.parentSignupFailure.count()).toBe(10); // cleared, never deleted
    await signup.request(EMAIL);
    expect(await signup.verify(EMAIL, await relayed(), PASSWORD)).toEqual({ ok: true });
  });

  it('an unknown e-mail locks exactly the same way, so the lock enumerates nothing', async () => {
    for (let i = 0; i < 10; i++) {
      expect(await code(signup.verify('nobody@example.test', '123456', PASSWORD))).toBe(AuthErrorCode.SIGNUP_CODE_INVALID);
    }
    expect(await code(signup.verify('nobody@example.test', '123456', PASSWORD))).toBe(AuthErrorCode.SIGNUP_LOCKED);
    // Stored by hash only.
    const rows = await g.prisma.parentSignupFailure.findMany();
    expect(JSON.stringify(rows)).not.toContain('nobody');
  });

  it('a password set by another path, or an account that stops being active, ends the live code', async () => {
    const done = await enrolment.assign(s.managerId, trialId, { supervisorId: s.ownerId });
    const contact = await g.prisma.contact.findFirstOrThrow({ where: { familyId: done.familyId } });
    const accountId = contact.accountId as string;
    await signup.request(EMAIL);
    await g.prisma.account.update({ where: { id: accountId }, data: { status: 'suspended', isActive: false } });
    expect(await g.prisma.parentSignupCode.count({ where: { usedAt: null, supersededAt: null } })).toBe(0);
    expect(await g.prisma.parentSignupCode.count({ where: { relayCode: { not: null } } })).toBe(0);
    await g.prisma.account.update({ where: { id: accountId }, data: { status: 'active', isActive: true } });

    await signup.request(EMAIL);
    expect(await g.prisma.parentSignupCode.count({ where: { usedAt: null, supersededAt: null } })).toBe(1);
    await g.prisma.accountCredential.create({ data: { accountId, passwordHash: 'x'.repeat(40) } });
    expect(await g.prisma.parentSignupCode.count({ where: { usedAt: null, supersededAt: null } })).toBe(0);
  });

  it('20 parallel wrong codes: exactly the cap is compared, the rest are refused as locked', async () => {
    await enrolment.assign(s.managerId, trialId, { supervisorId: s.ownerId });
    await signup.request(EMAIL);
    const right = await relayed();
    const results = await Promise.all(Array.from({ length: 20 }, () => code(signup.verify(EMAIL, wrongFor(right), PASSWORD))));
    expect(results.filter((r) => r === AuthErrorCode.SIGNUP_CODE_INVALID)).toHaveLength(10);
    expect(results.filter((r) => r === AuthErrorCode.SIGNUP_LOCKED)).toHaveLength(10);
    const account = await g.prisma.account.findUniqueOrThrow({ where: { subject: LOWER } });
    expect(await g.prisma.parentSignupFailure.count({ where: { accountId: account.id } })).toBe(10);
    // The code itself took exactly its five tries, then was spent.
    const tried = await g.prisma.parentSignupCode.findFirstOrThrow({ where: { accountId: account.id }, orderBy: { createdAt: 'desc' } });
    expect(tried.attempts).toBe(5);
    expect(tried.supersededAt).not.toBeNull();
  });

  it('the cap is kept by account: changing the e-mail mid-cap does not reset it; Reset attempts clears it by account', async () => {
    await enrolment.assign(s.managerId, trialId, { supervisorId: s.ownerId });
    const account = await g.prisma.account.findUniqueOrThrow({ where: { subject: LOWER } });
    for (let i = 0; i < 6; i++) await code(signup.verify(EMAIL, '000000', PASSWORD));
    // Staff (or PD-25) change the sign-in e-mail.
    const renamed = `renamed.${randomUUID().slice(0, 8)}@example.test`;
    await g.prisma.account.update({ where: { id: account.id }, data: { subject: renamed } });
    for (let i = 0; i < 4; i++) expect(await code(signup.verify(renamed, '000000', PASSWORD))).toBe(AuthErrorCode.SIGNUP_CODE_INVALID);
    expect(await code(signup.verify(renamed, '000000', PASSWORD))).toBe(AuthErrorCode.SIGNUP_LOCKED);
    expect(await signupOf(s.ownerId)).toMatchObject({ attempts: { wrong: 10, locked: true } });
    // The old e-mail is no one's now: counted apart, by its hash.
    expect(await code(signup.verify(EMAIL, '000000', PASSWORD))).toBe(AuthErrorCode.SIGNUP_CODE_INVALID);
    expect(await enrolment.resetSignupAttempts(s.ownerId, trialId)).toEqual({ cleared: 10 });
    await signup.request(renamed);
    expect(await signup.verify(renamed, await relayed(), PASSWORD)).toEqual({ ok: true });
  });

  it('wrong codes are purged after a week, by the purge only', async () => {
    await code(signup.verify('nobody@example.test', '123456', PASSWORD));
    await code(signup.verify('nobody@example.test', '123456', PASSWORD));
    const [old] = await g.prisma.parentSignupFailure.findMany({ take: 1 });
    await expect(g.prisma.$executeRawUnsafe(`delete from chat.parent_signup_failure where id = $1::uuid`, old!.id)).rejects.toThrow();
    await g.prisma.$executeRawUnsafe(`alter table chat.parent_signup_failure disable trigger parent_signup_failure_is_coherent`);
    await g.prisma.$executeRawUnsafe(`update chat.parent_signup_failure set created_at = now() - interval '8 days' where id = $1::uuid`, old!.id);
    await g.prisma.$executeRawUnsafe(`alter table chat.parent_signup_failure enable trigger parent_signup_failure_is_coherent`);
    // Even a week-old row cannot be deleted outside the purge.
    await expect(g.prisma.$executeRawUnsafe(`delete from chat.parent_signup_failure where id = $1::uuid`, old!.id)).rejects.toThrow();
    const [{ n }] = await g.prisma.$queryRawUnsafe<Array<{ n: number }>>(`select chat.purge_parent_signup_failures() as n`);
    expect(n).toBe(1);
    expect(await g.prisma.parentSignupFailure.count()).toBe(1);
  });
});
