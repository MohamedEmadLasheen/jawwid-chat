import { randomUUID } from 'node:crypto';
import type { PrismaClient } from '@prisma/client';
import { hashPassword, verifyPassword } from '../platform/auth/password';
import { AuthorizationService } from '../platform/authorization.service';
import { SqlCoverageService } from '../platform/coverage.service';
import { SqlStaffScope } from '../platform/staff-scope';
import { PrismaIdentityService } from '../platform/identity.service';
import { PrismaAuditService } from '../platform/audit.service';
import { PrismaRelationshipService } from '../platform/relationship.service';
import { AppConfigService } from '../platform/app-config.service';
import type { PrismaService } from '../platform/prisma.service';
import { ConversationService } from '../communication/conversations/conversation.service';
import { ConversationType } from '../communication/contracts/vocab';
import { MessageService } from '../communication/messages/message.service';
import { AttachmentService } from '../communication/attachments/attachment.service';
import type { ObjectStorage } from '../communication/attachments/object-storage';
import { OutboxService } from '../communication/outbox/outbox.service';
import { OrgStructureService } from '../org/org-structure.service';
import { LessonService } from '../lessons/lesson.service';
import { SchedulingService } from '../lessons/scheduling.service';
import type { ReminderService } from '../communication/notifications/reminder.service';
import { MAX_PASSWORD_LENGTH } from './super-admin-bootstrap';
import { insertLearnerWithTeacherForQa } from './qa-teacher-assignment';

/**
 * App Store / Google Play review accounts (store-readiness item 7, Play P-5).
 *
 * Owner decision 2026-11-07: the review accounts live in their OWN
 * organization, so a reviewer never sees a real family or a real member of
 * staff, and nothing a reviewer does (a report, a block, a message, a missed
 * lesson report) reaches Jawwid's own staff.
 *
 * Exactly three accounts can sign in, all ordinary, none with any admin
 * scope:
 *
 *   parent   -- the primary guardian of one family with one child
 *   teacher  -- that child's teacher
 *   parent2  -- the DISPOSABLE parent for the reviewers' account-deletion
 *               test (LR-05): the primary guardian of a second family of its
 *               own, with one child who has no teacher and no lessons, and a
 *               1:1 with the supervisor. It shares no conversation with the
 *               other two, so deleting it changes nothing they see.
 *
 * The organization around them -- an Operations Manager, a Teachers manager
 * and a supervisor -- is SYNTHETIC STAFF WITH NO ACCOUNT: there is no login for
 * any of them, so nobody can act as them through the API. The organization has
 * NO super admin at all. The staff exist because the product's own services,
 * which build everything here, need the real chain of authority: the
 * Operations Manager assigns the supervisor, the supervisor opens the family
 * group, the Teachers manager sets the timetable. Only the two departments are
 * written directly (an organization's owner would create them; this one has
 * none), as the scheduling suites do.
 *
 * Sign-in is the product's normal email + password login. Nothing here, and
 * nothing anywhere, bypasses the WhatsApp code: that code is asked for only
 * when a parent first sets their own password (PD-16), and these passwords are
 * set by the owner instead.
 *
 * Re-running is safe and is the repair procedure:
 *   - every row is found by a stable key inside the review organization first,
 *     and created only if it is missing;
 *   - any lockout is cleared, and each account's password is set from the
 *     owner's file; a changed password also ends that account's sessions;
 *   - a parent account a reviewer deleted (PD-56 erases it in place and frees
 *     the email; the family and child stay) is created again and given its
 *     seats back -- either parent, and the disposable one is expected to be
 *     deleted after every review;
 *   - a teacher account a reviewer deleted is created again too. With the
 *     child assigned, deleting it is a REQUEST (PD-56 O-3), and the account is
 *     erased in place within 30 days -- by staff, or by the worker at the
 *     deadline -- with the child left on the erased "Deleted user". The next
 *     run creates the teacher again and moves the child to it
 *     (chat.transfer_learner, as the Teachers manager): the family group seat
 *     and the lessons ahead follow, and the weekly times are set again. The
 *     review teacher is NOT kept out of the deadline: the 30-day promise App
 *     Review checks holds for this account as for any other. While a request
 *     is only pending, the account still signs in and nothing needs repair.
 *     The disposable parent's child has no teacher, so a teacher deletion
 *     never touches the disposable family.
 *
 * Synthetic people only (G-20). Passwords are hashed here and never stored,
 * returned or printed.
 */

export const REVIEW_ORG_SLUG = 'app-review';
export const REVIEW_ORG_NAME = 'Jawwid App Review';
const WHY = 'App Store / Google Play review cohort';
export const REVIEW_REVOKE_REASON = 'review cohort: password changed';
export const REVIEW_AUDIT_ACTION = 'account.review_cohort_provisioned';

/** Synthetic, credential-less staff. Names are invented (G-20). */
export const REVIEW_STAFF = {
  operationsManager: { name: 'Sara Hamed', role: 'manager' },
  teachersManager: { name: 'Karim Saeed', role: 'manager' },
  supervisor: { name: 'Nada Fawzi', role: 'admin' },
} as const;

export const REVIEW_PEOPLE = {
  teacher: 'Hassan Mourad',
  parent: 'Mariam Adel',
  family: 'Adel family',
  child: 'Yahya Adel',
} as const;

/** The disposable family for the account-deletion test. Names are invented (G-20). */
export const REVIEW_DELETION_PEOPLE = {
  parent: 'Laila Hamdi',
  family: 'Hamdi family',
  child: 'Omar Hamdi',
} as const;

export interface ReviewCohortOptions {
  /** Subjects are `parent@<domain>`, `teacher@<domain>` and `parent2@<domain>`. */
  emailDomain: string;
  /** Plaintext, >= REVIEW_MIN_PASSWORD_LENGTH, one per account and all different. */
  parentPassword: string;
  teacherPassword: string;
  deletionParentPassword: string;
  /** Tests pass precomputed hashes so Argon2 does not dominate the suite. */
  parentPasswordHash?: string;
  teacherPasswordHash?: string;
  deletionParentPasswordHash?: string;
}

export interface ReviewCohortManifest {
  organizationId: string;
  parent: { subject: string; accountId: string; contactId: string; created: boolean };
  teacher: { subject: string; accountId: string; teacherId: string; created: boolean };
  /** The disposable parent: its own family, child and 1:1 with the supervisor. */
  deletionParent: {
    subject: string;
    accountId: string;
    contactId: string;
    created: boolean;
    familyId: string;
    learnerId: string;
    directId: string;
  };
  staff: { operationsManagerId: string; teachersManagerId: string; supervisorId: string };
  familyId: string;
  learnerId: string;
  familyGroupId: string;
  parentDirectId: string;
  teacherDirectId: string;
}

/**
 * Stricter than the product's own floor (PASSWORD_MIN_LENGTH): these three
 * passwords are handed to Apple and Google and sit on a production login.
 */
export const REVIEW_MIN_PASSWORD_LENGTH = 12;

export class ReviewCohortRefusal extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = 'ReviewCohortRefusal';
  }
}

export function validateOptions(opts: ReviewCohortOptions): void {
  const passwords = [
    ['parent', opts.parentPassword],
    ['teacher', opts.teacherPassword],
    ['deletion parent', opts.deletionParentPassword],
  ] as const;
  for (const [who, pw] of passwords) {
    if (typeof pw !== 'string' || pw.length < REVIEW_MIN_PASSWORD_LENGTH || pw.length > MAX_PASSWORD_LENGTH) {
      throw new ReviewCohortRefusal(
        'PASSWORD', `the ${who} password must be ${REVIEW_MIN_PASSWORD_LENGTH}-${MAX_PASSWORD_LENGTH} characters`,
      );
    }
  }
  for (let i = 0; i < passwords.length; i++) {
    for (let j = i + 1; j < passwords.length; j++) {
      if (passwords[i][1] === passwords[j][1]) {
        throw new ReviewCohortRefusal('PASSWORD', `the ${passwords[i][0]} and ${passwords[j][0]} passwords must be different`);
      }
    }
  }
  if (!/^[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}$/.test(opts.emailDomain)) {
    throw new ReviewCohortRefusal('USAGE', 'emailDomain must be a plain domain name');
  }
}

export async function provisionReviewCohort(prisma: PrismaClient, opts: ReviewCohortOptions): Promise<ReviewCohortManifest> {
  validateOptions(opts);
  const db = prisma as unknown as PrismaService;
  const coverage = new SqlCoverageService(db);
  const authz = new AuthorizationService(coverage, new SqlStaffScope(db));
  const identity = new PrismaIdentityService(db);
  const audit = new PrismaAuditService();
  const outbox = new OutboxService();
  const conversations = new ConversationService(
    db, authz, outbox, identity, coverage, audit, new PrismaRelationshipService(db),
  );
  const orgStructure = new OrgStructureService(db, authz, conversations, audit);
  // Text only. Any use of object storage is a bug in this command.
  const noStorage = new Proxy({} as ObjectStorage, {
    get: (_t, prop) => () => {
      throw new ReviewCohortRefusal('STORAGE', `the review cohort does not use object storage (${String(prop)})`);
    },
  });
  const attachments = new AttachmentService(db, authz, conversations, noStorage);
  const config = new AppConfigService(db);
  const messages = new MessageService(db, authz, conversations, outbox, config, attachments, audit, identity);
  // No payment lock: the review child has no subscription, and a child with
  // none is never locked (chat.compute_learner_access, PD-30).
  const lessons = new LessonService(db, authz, conversations, outbox, config, audit);
  // Reminders are the worker's (scheduleDueReminders); the schedule written
  // here sends none, so any use is a bug in this command.
  const noReminders = new Proxy({} as ReminderService, {
    get: (_t, prop) => () => {
      throw new ReviewCohortRefusal('REMINDERS', `the review cohort sends no reminders itself (${String(prop)})`);
    },
  });
  const scheduling = new SchedulingService(db, authz, conversations, lessons, outbox, config, noReminders, audit);

  // --- the organization
  const org =
    (await prisma.organization.findUnique({ where: { slug: REVIEW_ORG_SLUG } })) ??
    (await prisma.organization.create({ data: { slug: REVIEW_ORG_SLUG, displayName: REVIEW_ORG_NAME } }));
  if (!org.isActive) throw new ReviewCohortRefusal('ORGANIZATION', 'the review organization is deactivated');
  const orgId = org.id;
  const defaultOrg = (await prisma.$queryRaw<{ id: string }[]>`select chat.default_organization_id()::text as id`)[0].id;
  if (orgId === defaultOrg) {
    throw new ReviewCohortRefusal('ORGANIZATION', 'the review organization must not be the default organization');
  }

  // --- synthetic staff, no account
  const staffRow = async (s: { name: string; role: string }) => {
    const found = await prisma.staff.findFirst({ where: { organizationId: orgId, name: s.name, role: s.role, leftAt: null } });
    if (found) {
      if (found.accountId) {
        throw new ReviewCohortRefusal('STAFF_ACCOUNT', `synthetic staff "${s.name}" has a login; the review cohort's staff never do`);
      }
      return found.id;
    }
    return (await prisma.staff.create({ data: { organizationId: orgId, name: s.name, role: s.role, isActive: true } })).id;
  };
  const operationsManagerId = await staffRow(REVIEW_STAFF.operationsManager);
  const teachersManagerId = await staffRow(REVIEW_STAFF.teachersManager);
  const supervisorId = await staffRow(REVIEW_STAFF.supervisor);

  const department = async (kind: 'operations' | 'teachers', displayName: string, managerId: string) =>
    prisma.department.upsert({
      where: { organizationId_kind: { organizationId: orgId, kind } },
      create: { organizationId: orgId, kind, displayName, managerId },
      update: { managerId },
    });
  const ops = await department('operations', 'Operations', operationsManagerId);
  await department('teachers', 'Teachers', teachersManagerId);
  await prisma.departmentMember.upsert({
    where: { staffId: supervisorId },
    create: { staffId: supervisorId, organizationId: orgId, departmentId: ops.id, position: 'supervisor', assignedBy: operationsManagerId },
    update: {},
  });

  // --- one login domain for the life of the organization: a different one
  // would make a second pair of logins (and a second teacher) beside the first.
  const live = await prisma.account.findFirst({
    where: { organizationId: orgId, isActive: true, kind: { in: ['family', 'teacher'] }, NOT: { subject: { startsWith: 'erased:' } } },
  });
  if (live && !live.subject.endsWith(`@${opts.emailDomain}`)) {
    throw new ReviewCohortRefusal('DOMAIN_CHANGED', 'the review accounts already use another login domain; pass the same --email-domain');
  }

  // --- accounts: found by subject; erased accounts free their subject (PD-56)
  const login = async (key: 'parent' | 'teacher' | 'parent2', kind: 'family' | 'teacher', password: string, preHashed?: string) => {
    const subject = `${key}@${opts.emailDomain}`;
    const passwordHash = preHashed ?? (await hashPassword(password));
    const existing = await prisma.account.findUnique({ where: { subject } });
    if (existing && existing.organizationId !== orgId) {
      throw new ReviewCohortRefusal('SUBJECT_TAKEN', `${subject} belongs to another organization`);
    }
    if (existing && existing.kind !== kind) {
      throw new ReviewCohortRefusal('SUBJECT_TAKEN', `${subject} is not a ${kind} account`);
    }
    const account =
      existing ??
      (await prisma.account.create({ data: { organizationId: orgId, subject, kind, status: 'active', isActive: true } }));
    if (existing && (!existing.isActive || existing.status !== 'active')) {
      throw new ReviewCohortRefusal('ACCOUNT_DEACTIVATED', `${subject} is deactivated; reactivate it from the admin console or investigate`);
    }
    // Every run: clear any lockout, and set the password from the owner's
    // file. A CHANGED password also ends every session on the account, as the
    // bootstrap's reset does -- a password changed after a leak must lock out
    // whoever already signed in with the old one.
    const current = await prisma.accountCredential.findUnique({ where: { accountId: account.id } });
    const changed = !current || !(await verifyPassword(password, current.passwordHash));
    await prisma.$transaction(async (tx) => {
      await tx.accountCredential.upsert({
        where: { accountId: account.id },
        create: { accountId: account.id, passwordHash },
        update: changed
          ? { passwordHash, passwordChangedAt: new Date(), failedAttempts: 0, lockedUntil: null }
          : { failedAttempts: 0, lockedUntil: null },
      });
      let sessionsRevoked = 0;
      if (changed && current) {
        sessionsRevoked = (await tx.session.updateMany({
          where: { accountId: account.id, revokedAt: null },
          data: { revokedAt: new Date(), revokedReason: REVIEW_REVOKE_REASON },
        })).count;
      }
      // THAT a credential was set or a lockout cleared, never what. No acting
      // staff member: whoever holds the database credentials ran this.
      const wasLocked = !!current && (current.failedAttempts > 0 || current.lockedUntil !== null);
      if (changed || wasLocked) {
        await tx.auditLog.create({
          data: {
            actorId: null,
            action: REVIEW_AUDIT_ACTION,
            entity: 'account',
            entityId: account.id,
            after: { created: !existing, passwordSet: changed, lockoutCleared: wasLocked, sessionsRevoked },
            reason: 'review cohort (out-of-band CLI, store-readiness item 7)',
          },
        });
      }
    });
    return { subject, accountId: account.id, created: !existing };
  };

  // --- the teacher
  const teacherLogin = await login('teacher', 'teacher', opts.teacherPassword, opts.teacherPasswordHash);
  const teacher =
    (await prisma.teacher.findFirst({ where: { organizationId: orgId, accountId: teacherLogin.accountId } })) ??
    (await prisma.teacher.create({
      data: { organizationId: orgId, name: REVIEW_PEOPLE.teacher, isActive: true, accountId: teacherLogin.accountId },
    }));

  // --- a family, found by name inside the review organization
  const familyNamed = async (displayName: string) =>
    (await prisma.family.findFirst({ where: { organizationId: orgId, displayName } })) ??
    (await prisma.family.create({
      data: { organizationId: orgId, displayName, ownerId: supervisorId, language: 'en' },
    }));
  // --- its primary guardian, found by account: a re-created (previously
  // deleted) account gets a new contact, made the family's primary again.
  const guardian = async (family: { id: string; primaryContactId: string | null }, name: string, accountId: string) => {
    const contact =
      (await prisma.contact.findFirst({ where: { familyId: family.id, accountId } })) ??
      (await prisma.contact.create({
        data: {
          organizationId: orgId,
          familyId: family.id,
          name,
          relationship: 'parent',
          rolePreset: 'primary_guardian',
          canMessage: true,
          canViewProgress: true,
          canManageSchedule: true,
          canManageBilling: true,
          canManageContacts: true,
          canCancel: true,
          accountId,
          isActive: true,
        },
      }));
    if (family.primaryContactId !== contact.id) {
      await prisma.family.update({ where: { id: family.id }, data: { primaryContactId: contact.id } });
    }
    return contact;
  };

  // --- the family, its parent and its child
  const family = await familyNamed(REVIEW_PEOPLE.family);
  const parentLogin = await login('parent', 'family', opts.parentPassword, opts.parentPasswordHash);
  const contact = await guardian(family, REVIEW_PEOPLE.parent, parentLogin.accountId);

  let learner = await prisma.learner.findFirst({ where: { familyId: family.id, name: REVIEW_PEOPLE.child } });
  if (!learner) {
    const learnerId = randomUUID();
    // learner.teacher_id is the academy's fact (Core-owned, trigger-guarded,
    // OD-04). Core's assignment ingestion does not exist yet; for this
    // synthetic child in the review organization only, the QA stand-in writes
    // it, exactly as the PD-8 seed does.
    await insertLearnerWithTeacherForQa(prisma, {
      learnerId, organizationId: orgId, familyId: family.id, name: REVIEW_PEOPLE.child, teacherId: teacher.id,
    });
    learner = await prisma.learner.findUniqueOrThrow({ where: { id: learnerId } });
  } else if (learner.teacherId !== teacher.id) {
    // The one way this happens through the app: a reviewer asked to delete the
    // teacher account (PD-56 O-3), and it was erased by staff or at its 30-day
    // deadline. The child stays assigned to the erased teacher ("Deleted user")
    // and the login above was created again. The child moves to the new
    // teacher, as a Teachers manager moves a learner (chat.transfer_learner:
    // the family group's seat and the lessons ahead follow; the erasure's
    // learner_needs_teacher task then settles itself). Anything else -- a
    // child whose teacher is someone live -- is refused rather than guessed.
    await moveChildFromErasedTeacher(prisma, orgId, learner.id, learner.teacherId, teacher.id, teachersManagerId);
    learner = await prisma.learner.findUniqueOrThrow({ where: { id: learner.id } });
  }
  await orgStructure.assignSupervisor(operationsManagerId, learner.id, { supervisorId, reason: WHY });

  // --- the weekly timetable, set by the Teachers manager (canManageLessons:
  // the Teachers department). The worker materializes lessons ahead from these slots for as long as the
  // schedule stands, so upcoming lessons never run out.
  const hasAvailability = await prisma.teacherAvailability.count({ where: { teacherId: teacher.id } });
  if (hasAvailability === 0) {
    await scheduling.setAvailability(teachersManagerId, teacher.id, {
      timezone: REVIEW_SCHEDULE.timezone,
      windows: [1, 2, 3, 4, 5, 6, 7].map((weekday) => ({ weekday, start: '08:00', end: '22:00' })),
    });
  }
  const standing = await prisma.learnerScheduleSlot.count({
    where: { learnerId: learner.id, teacherId: teacher.id, validTo: null },
  });
  if (standing === 0) {
    await scheduling.setSchedule(teachersManagerId, learner.id, {
      slots: REVIEW_SCHEDULE.slots.map((s) => ({ ...s })),
    });
  }

  // --- conversations
  const familyGroupId = await ensureFamilyGroup(prisma, conversations, supervisorId, learner.id, contact.id, teacher.id);
  const parentDirect = await conversations.getOrCreateDirect(contact.id, supervisorId);
  const teacherDirect = await conversations.getOrCreateDirect(teacher.id, supervisorId);

  const say = async (conversationId: string, senderId: string, key: string, body: string) => {
    // Once per conversation, whoever sent it: the product keys idempotency on
    // the author too, and a re-created parent is a new author.
    const clientMessageId = `review-${key}-${conversationId}`;
    if (await prisma.message.findFirst({ where: { conversationId, clientMessageId }, select: { id: true } })) return;
    await messages.send({ conversationId, senderId, body, clientMessageId });
  };
  for (const [i, line] of REVIEW_MESSAGES.familyGroup.entries()) {
    const sender = line.from === 'supervisor' ? supervisorId : line.from === 'teacher' ? teacher.id : contact.id;
    await say(familyGroupId, sender, `group-${i}`, line.body);
  }
  for (const [i, line] of REVIEW_MESSAGES.parentDirect.entries()) {
    await say(parentDirect.id, line.from === 'supervisor' ? supervisorId : contact.id, `pd-${i}`, line.body);
  }
  for (const [i, line] of REVIEW_MESSAGES.teacherDirect.entries()) {
    await say(teacherDirect.id, line.from === 'supervisor' ? supervisorId : teacher.id, `td-${i}`, line.body);
  }

  // --- the disposable parent for the account-deletion test: its own family
  // and child, so deleting it touches nothing the other two accounts see. The
  // child has NO teacher (no OD-04 stand-in, no lessons, no family group): the
  // parent and the supervisor share only a 1:1.
  const deletionFamily = await familyNamed(REVIEW_DELETION_PEOPLE.family);
  const deletionLogin = await login('parent2', 'family', opts.deletionParentPassword, opts.deletionParentPasswordHash);
  const deletionContact = await guardian(deletionFamily, REVIEW_DELETION_PEOPLE.parent, deletionLogin.accountId);
  const deletionLearner =
    (await prisma.learner.findFirst({ where: { familyId: deletionFamily.id, name: REVIEW_DELETION_PEOPLE.child } })) ??
    (await prisma.learner.create({
      data: { organizationId: orgId, familyId: deletionFamily.id, name: REVIEW_DELETION_PEOPLE.child },
    }));
  if (deletionLearner.teacherId !== null) {
    throw new ReviewCohortRefusal('TEACHER_CHANGED', 'the disposable review child has a teacher; it never should; investigate');
  }
  await orgStructure.assignSupervisor(operationsManagerId, deletionLearner.id, { supervisorId, reason: WHY });
  const deletionDirect = await conversations.getOrCreateDirect(deletionContact.id, supervisorId);
  for (const [i, line] of REVIEW_MESSAGES.deletionParentDirect.entries()) {
    await say(deletionDirect.id, line.from === 'supervisor' ? supervisorId : deletionContact.id, `dpd-${i}`, line.body);
  }

  return {
    organizationId: orgId,
    parent: { ...parentLogin, contactId: contact.id },
    teacher: { ...teacherLogin, teacherId: teacher.id },
    deletionParent: {
      ...deletionLogin,
      contactId: deletionContact.id,
      familyId: deletionFamily.id,
      learnerId: deletionLearner.id,
      directId: deletionDirect.id,
    },
    staff: { operationsManagerId, teachersManagerId, supervisorId },
    familyId: family.id,
    learnerId: learner.id,
    familyGroupId,
    parentDirectId: parentDirect.id,
    teacherDirectId: teacherDirect.id,
  };
}

/**
 * The review child's teacher account was erased (a deletion request completed
 * by staff or at its deadline): the child moves to the re-created teacher.
 * Only from an ERASED teacher of the review organization -- a live one is
 * refused (TEACHER_CHANGED), never moved.
 */
async function moveChildFromErasedTeacher(
  prisma: PrismaClient,
  orgId: string,
  learnerId: string,
  fromTeacherId: string | null,
  toTeacherId: string,
  teachersManagerId: string,
): Promise<void> {
  const from = fromTeacherId
    ? await prisma.teacher.findUnique({ where: { id: fromTeacherId }, select: { organizationId: true, accountId: true } })
    : null;
  const fromAccount = from?.accountId
    ? await prisma.account.findUnique({ where: { id: from.accountId }, select: { subject: true } })
    : null;
  if (!from || from.organizationId !== orgId || !fromAccount?.subject.startsWith('erased:')) {
    throw new ReviewCohortRefusal('TEACHER_CHANGED', "the review child's teacher is not the teacher review account; investigate");
  }
  // The guarded writer of chat.learner.teacher_id (PD-11), acting as the
  // synthetic Teachers manager: the child's groups and lessons ahead move with it.
  await prisma.$queryRaw`
    SELECT count(*)::int AS n
      FROM chat.transfer_learner(${learnerId}::uuid, ${toTeacherId}::uuid, 'teacher_leaving',
                                 'review cohort: the teacher review account was deleted and created again',
                                 null, ${teachersManagerId}::uuid)`;
}

/** The family's live group for this child, created by the supervisor once; seats a re-created parent. */
async function ensureFamilyGroup(
  prisma: PrismaClient,
  conversations: ConversationService,
  supervisorId: string,
  learnerId: string,
  contactId: string,
  teacherId: string,
): Promise<string> {
  const anchors = await prisma.conversationLearner.findMany({ where: { learnerId }, select: { conversationId: true } });
  const existing = await prisma.conversation.findFirst({
    where: { id: { in: anchors.map((a) => a.conversationId) }, type: ConversationType.FAMILY_GROUP },
    orderBy: { createdAt: 'asc' },
  });
  if (!existing) {
    const conv = await conversations.createFamilyGroup(supervisorId, {
      learnerIds: [learnerId], contactIds: [contactId], teacherIds: [teacherId],
    });
    return conv.id;
  }
  for (const actorId of [contactId, teacherId]) {
    const seat = await prisma.conversationMember.findFirst({ where: { conversationId: existing.id, actorId, leftAt: null } });
    if (seat) continue;
    const spec = actorId === contactId
      ? { actorId, actorKind: 'contact', memberRole: 'parent' }
      : { actorId, actorKind: 'teacher', memberRole: 'teacher' };
    await conversations.setMembership(existing.id, supervisorId, spec, 'add', 'review account re-created');
  }
  return existing.id;
}

/** Three 30-minute lessons a week, late afternoon in Cairo. */
export const REVIEW_SCHEDULE = {
  timezone: 'Africa/Cairo',
  slots: [
    { weekday: 1, start: '16:00', durationMinutes: 30 },
    { weekday: 3, start: '16:00', durationMinutes: 30 },
    { weekday: 5, start: '16:00', durationMinutes: 30 },
  ],
} as const;

/**
 * Sample conversation. Plain, everyday academy talk with no Quran or lesson
 * content: lesson material in the review data waits for the owner's approval.
 */
export const REVIEW_MESSAGES = {
  familyGroup: [
    { from: 'supervisor', body: "Welcome to Yahya's group. I am his supervisor; his teacher Hassan is here with us." },
    { from: 'teacher', body: 'Hello! I look forward to our lessons together.' },
    { from: 'parent', body: 'Thank you both. Yahya is excited to start.' },
  ],
  parentDirect: [
    { from: 'parent', body: "Hello, could you share this week's class schedule?" },
    { from: 'supervisor', body: 'Of course. You can also see it any time under Schedule.' },
  ],
  teacherDirect: [
    { from: 'teacher', body: 'My availability for next week is updated.' },
    { from: 'supervisor', body: 'Thank you, Hassan.' },
  ],
  deletionParentDirect: [
    { from: 'supervisor', body: "Welcome, Laila. I am Omar's supervisor; you can write to me here any time." },
    { from: 'parent', body: 'Thank you, Nada.' },
  ],
} as const;
