import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../platform/prisma.service';
import { AuthorizationService } from '../platform/authorization.service';
import { CommError, CommErrorCode } from '../platform/errors';
import { AUDIT_SERVICE } from '../platform/tokens';
import type { AuditService } from '../platform/audit.service';
import type { Actor } from '../platform/types';
import { OrgStructureService } from '../org/org-structure.service';
import { ConversationService, isUuid } from '../communication/conversations/conversation.service';
import { ActorKind, StaffRole } from '../communication/contracts/vocab';
import { LessonService } from '../lessons/lesson.service';
import { SchedulingService } from '../lessons/scheduling.service';
import { normalizeEmail, signupWrongCodes } from '../platform/auth/parent-signup.service';
import { subjectHash } from '../platform/auth/subject-hash';
import { PaymentLedger } from '../billing/payment-ledger.service';
import { NEW_STUDENTS_LIMIT, NewStudentsService } from './new-students.service';
import { dashboardTile, type DashboardTile } from '../dashboard/dashboard-tile';
import { seedFromEnrolment } from '../parent-profile/parent-record.service';
import { contactKeyHash } from './contact-key';
import { e164ForKey } from './intake-input';

type PresentedForm = NonNullable<Awaited<ReturnType<NewStudentsService['get']>>>;

/**
 * PD-16: from a subscription form to a family in Chat.
 *
 *   assign       the Operations manager (or the super admin) picks the
 *                responsible supervisor. In ONE transaction Chat creates the
 *                family, the parent (with an account to sign up to, the e-mail
 *                as its sign-in), each child with the teacher Sales chose
 *                (chat.enrol_learner), the supervision, and the child's course
 *                and stated age. The children's weekly times are then set from
 *                the form where the teacher is free (best effort; the page says
 *                which were not).
 *   createGroup  the responsible supervisor (or their manager) opens the
 *                family's group: the parent, the teacher(s) and the supervisor,
 *                plus the parent's direct chat with their supervisor.
 *   page         who sees which entry: an unassigned form -- Sales, the
 *                Operations manager, the super admin; an assigned one -- the
 *                children's supervisor (and their active backup), the
 *                Operations manager and the super admin.
 *
 * Lives in src/new-students because it reads the confined form (G-07); it is
 * provided by LessonModule, which owns the scheduling it calls. The parent's
 * phone and e-mail are copied to exactly one place: the parent's admin-only
 * file (PD-17, seedFromEnrolment), itself confined to src/parent-profile.
 */
@Injectable()
export class NewStudentEnrolmentService {
  private readonly log = new Logger('NewStudentEnrolment');

  constructor(
    private readonly prisma: PrismaService,
    private readonly authz: AuthorizationService,
    private readonly conversations: ConversationService,
    private readonly forms: NewStudentsService,
    private readonly lessons: LessonService,
    private readonly scheduling: SchedulingService,
    private readonly org: OrgStructureService,
    @Inject(AUDIT_SERVICE) private readonly audit: AuditService,
    // PD-27: what the trial's family paid before Assign moves onto the family.
    // Optional only for suites that build this service by hand.
    @Optional() private readonly payments?: PaymentLedger,
  ) {}

  /**
   * PD-44: the Dashboard's New Students tiles -- the page's own filters,
   * counted over the page's own forms (the NEW_STUDENTS_LIMIT newest live
   * ones) with `page`'s visibility rule, in one statement:
   *
   *   new_students.unassigned  no enrolment yet ("Not assigned"): the super
   *                            admin, the Operations manager and Sales see them
   *   new_students.waiting     enrolled, the parent not signed up yet ("Waiting
   *                            for the parent", a locked sign-up included): the
   *                            super admin, the Operations manager, and whoever
   *                            supervises one of the children
   *
   * Anyone the page refuses gets no tile; `capped` when there are more live
   * forms than the page lists. Unlike the page, no per-account wrong-code
   * lookup: a count does not need it.
   */
  async dashboardCounts(actorId: string): Promise<DashboardTile[]> {
    const actor = await this.conversations.requireActor(actorId);
    if (actor.kind !== ActorKind.STAFF) {
      throw new CommError(CommErrorCode.LESSON_DENIED, 'the New Students page belongs to Operations and Sales');
    }
    const viewer = await this.viewer(actor);
    if (!viewer.superAdmin && !viewer.opsManager && !viewer.operations && !viewer.sales) return [];
    const org = actor.organizationId as string;
    const all = viewer.superAdmin || viewer.opsManager;
    const [r] = await this.prisma.$queryRaw<Array<{ unassigned: number; unassigned_oldest: Date | null; waiting: number; total: number }>>`
      WITH forms AS (
        SELECT f.lesson_id, f.recorded_at
          FROM chat.trial_subscription f
         WHERE f.organization_id = ${org}::uuid AND f.withdrawn_at IS NULL
         ORDER BY f.recorded_at DESC
         LIMIT ${NEW_STUDENTS_LIMIT}
      ),
      entry AS (
        SELECT forms.recorded_at, e.lesson_id IS NOT NULL AS enrolled, e.learner_ids,
               (e.account_id IS NOT NULL AND EXISTS (SELECT 1 FROM chat.account_credential c WHERE c.account_id = e.account_id)) AS signed_up
          FROM forms
          LEFT JOIN chat.student_enrolment e ON e.lesson_id = forms.lesson_id AND e.organization_id = ${org}::uuid
      )
      SELECT count(*) FILTER (WHERE NOT enrolled AND (${all}::boolean OR ${viewer.sales}::boolean))::int AS unassigned,
             min(recorded_at) FILTER (WHERE NOT enrolled AND (${all}::boolean OR ${viewer.sales}::boolean)) AS unassigned_oldest,
             count(*) FILTER (WHERE enrolled AND NOT signed_up
                                AND (${all}::boolean OR learner_ids && ${viewer.supervised}::uuid[]))::int AS waiting,
             (SELECT count(*)::int FROM chat.trial_subscription f
               WHERE f.organization_id = ${org}::uuid AND f.withdrawn_at IS NULL) AS total
        FROM entry`;
    const capped = (r?.total ?? 0) > NEW_STUDENTS_LIMIT;
    return [
      dashboardTile('new_students.unassigned', r?.unassigned ?? 0, r?.unassigned_oldest ?? null, capped),
      dashboardTile('new_students.waiting', r?.waiting ?? 0, null, capped),
    ];
  }

  /** The New Students page, filtered for the viewer, each entry with its setup state. */
  async page(actorId: string) {
    const actor = await this.conversations.requireActor(actorId);
    const viewer = await this.viewer(actor);
    if (!viewer.superAdmin && !viewer.opsManager && !viewer.operations && !viewer.sales) {
      throw new CommError(CommErrorCode.LESSON_DENIED, 'the New Students page belongs to Operations and Sales');
    }
    const org = actor.organizationId as string;
    const forms = await this.forms.list(org);
    const enrolments = await this.prisma.studentEnrolment.findMany({
      where: { organizationId: org, lessonId: { in: forms.map((f) => f.trialId) } },
    });
    const byTrial = new Map(enrolments.map((e) => [e.lessonId, e]));
    const learnerIds = enrolments.flatMap((e) => e.learnerIds);
    const supervision = learnerIds.length
      ? await this.prisma.$queryRaw<Array<{ learner_id: string; id: string; name: string }>>`
          SELECT ls.learner_id::text AS learner_id, s.id::text AS id, s.name
            FROM chat.learner_supervision ls JOIN chat.staff s ON s.id = ls.supervisor_id
           WHERE ls.learner_id = ANY(${learnerIds}::uuid[])`
      : [];
    const supervisorOf = new Map(supervision.map((r) => [r.learner_id, { id: r.id, name: r.name }]));
    // PD-42: an enrolment may not have its parent's account yet (no sign-in e-mail).
    const accounts = enrolments.map((e) => e.accountId).filter((a): a is string => a !== null);
    const [credentials, codes] = await Promise.all([
      this.prisma.accountCredential.findMany({ where: { accountId: { in: accounts } }, select: { accountId: true } }),
      this.prisma.parentSignupCode.findMany({
        // PD-32: no time expiry; codes from before it keep theirs.
        where: { accountId: { in: accounts }, usedAt: null, supersededAt: null, OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] },
      }),
    ]);
    const signedUp = new Set(credentials.map((c) => c.accountId));
    const codeOf = new Map(codes.map((c) => [c.accountId, c]));
    // PD-32: the wrong-code cap, counted by account, for the accounts still signing up.
    const waiting = accounts.filter((a) => !signedUp.has(a));
    const wrongOf = new Map(
      await Promise.all(waiting.map(async (a) => [a, await signupWrongCodes(this.prisma, { accountId: a })] as const)),
    );
    const mine = new Set(viewer.supervised);

    const visible = forms.filter((f) => {
      const e = byTrial.get(f.trialId);
      if (viewer.superAdmin || viewer.opsManager) return true;
      if (!e) return viewer.sales;
      return e.learnerIds.some((l) => mine.has(l));
    });
    return {
      canAssign: viewer.superAdmin || viewer.opsManager,
      students: visible.map((f) => {
        const e = byTrial.get(f.trialId);
        if (!e) return { ...f, enrolment: null };
        const supervisor = supervisorOf.get(e.learnerIds[0]) ?? null;
        const code = e.accountId ? codeOf.get(e.accountId) : undefined;
        const responsible = viewer.superAdmin || viewer.opsManager || e.learnerIds.some((l) => mine.has(l));
        const wrong = e.accountId ? wrongOf.get(e.accountId) : undefined;
        // Only whoever is responsible sees the code, the wrong tries, and may act on them.
        const attempts = responsible && wrong ? { attempts: { wrong: wrong.wrong, cap: wrong.cap, locked: wrong.locked } } : {};
        return {
          ...f,
          enrolment: {
            familyId: e.familyId,
            learnerIds: e.learnerIds,
            supervisor,
            assignedAt: e.assignedAt.toISOString(),
            groupConversationId: e.groupConversationId,
            canCreateGroup: responsible && e.groupConversationId === null,
            parentSignup: e.accountId && signedUp.has(e.accountId)
              ? { state: 'signed_up' as const }
              : code
                ? {
                    state: 'code_waiting' as const,
                    // The code the supervisor relays on WhatsApp -- only to whoever is
                    // responsible. PD-32: it is valid until used or invalidated.
                    ...(responsible ? { code: code.relayCode, issuedAt: code.createdAt.toISOString() } : {}),
                    ...attempts,
                  }
                : { state: 'not_started' as const, ...attempts },
          },
        };
      }),
    };
  }

  async assign(actorId: string, trialId: string, body: Record<string, unknown>) {
    const actor = await this.conversations.requireActor(actorId);
    const org = actor.organizationId as string;
    const viewer = await this.viewer(actor);
    if (!viewer.superAdmin && !viewer.opsManager) {
      throw new CommError(CommErrorCode.LESSON_DENIED, 'new students are assigned by the Operations manager');
    }
    if (!isUuid(trialId)) throw notFound();
    const supervisorId = typeof body.supervisorId === 'string' && isUuid(body.supervisorId) ? body.supervisorId : null;
    // PD-42 PR-3: the trial's parent is already in Chat -- the children join that family.
    const attachTo = body.familyId === undefined || body.familyId === null ? null
      : typeof body.familyId === 'string' && isUuid(body.familyId) ? body.familyId.toLowerCase() : 'invalid';
    if (attachTo === 'invalid') throw invalid('familyId: the family to add the children to');
    const form = await this.forms.get(org, trialId);
    if (!form) throw notFound();
    if (await this.prisma.studentEnrolment.findUnique({ where: { lessonId: trialId } })) {
      throw new CommError(CommErrorCode.LESSON_STATE, 'this student is already assigned', 409);
    }
    const rawEmail = typeof body.email === 'string' && body.email.trim() ? body.email : form.parent.email ?? '';
    const email = normalizeEmail(rawEmail);
    // The sibling match is the form's own e-mail and number (review of #214):
    // an e-mail typed into Assign never satisfies it.
    if (attachTo) return this.attachSibling(actor, trialId, form, attachTo, supervisorId, normalizeEmail(form.parent.email ?? '') || null);
    if (!supervisorId) throw invalid('supervisorId: required');
    if (!email) throw invalid('email: the parent signs up with an e-mail address; enter a valid one');
    const holder = await this.prisma.account.findUnique({ where: { subject: email }, select: { id: true, kind: true } });
    if (holder) {
      // PD-42 PR-3: a parent already in Chat is answered with their family, so
      // the children can be added to it (the trial sibling, plan §1.7).
      const parent = holder.kind === 'family'
        ? await this.prisma.contact.findFirst({ where: { accountId: holder.id, organizationId: org }, select: { familyId: true } })
        : null;
      if (parent) throw await parentExists(this.prisma, parent.familyId);
      throw new CommError(CommErrorCode.LESSON_STATE, 'this e-mail already belongs to an account in Chat', 409);
    }
    const supervisor = await this.prisma.staff.findFirst({ where: { id: supervisorId, organizationId: org } });
    if (!supervisor) throw new CommError(CommErrorCode.LESSON_NOT_FOUND, 'supervisor not found', 404);
    // The same authority Organization -> Children uses: the manager of the
    // supervisor's department, or the super admin.
    const decision = this.authz.canAssignSupervision(actor, {
      organizationId: org,
      actsForNew: await this.authz.actsFor(actor, supervisorId, new Date()),
      currentSupervisorId: null,
      actsForCurrent: null,
    });
    if (!decision.allowed) throw new CommError(decision.code, decision.reason);

    const created = await this.lessons.write(() =>
      this.prisma.$transaction(async (tx) => {
        await this.conversations.assertActorLive(tx, actor);
        const family = await tx.family.create({
          data: { organizationId: org, displayName: form.parent.name, ownerId: supervisorId, language: 'ar' },
        });
        const account = await tx.account.create({
          data: { organizationId: org, subject: email, kind: 'family', status: 'active', isActive: true },
        });
        const contact = await tx.contact.create({
          data: {
            organizationId: org,
            familyId: family.id,
            name: form.parent.name,
            relationship: 'parent',
            rolePreset: 'primary_guardian',
            canMessage: true,
            canViewProgress: true,
            canManageSchedule: true,
            canManageBilling: true,
            canManageContacts: true,
            canCancel: true,
            accountId: account.id,
            isActive: true,
          },
        });
        await tx.family.update({ where: { id: family.id }, data: { primaryContactId: contact.id } });
        // PD-17: the administration's record of the parent, and how the family pays.
        await seedFromEnrolment(tx, {
          contactId: contact.id,
          familyId: family.id,
          organizationId: org,
          actorId: actor.actorId,
          phone: form.parent.phone,
          email,
          paymentMethod: form.payment.method,
          currency: form.payment.currency,
        });
        // PD-42 S1: the parent's contact keys, so the same parent is never a
        // second family -- entered by hand later, or already entered by hand.
        for (const k of parentContactKeys(email, form.parent.phone)) {
          await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`pd042:${k.hash}`}, 0))`;
          const other = await tx.familyContactKey.findFirst({ where: { organizationId: org, keyHash: k.hash }, select: { familyId: true } });
          if (other) throw await parentExists(tx, other.familyId);
          await tx.familyContactKey.create({ data: { organizationId: org, keyHash: k.hash, familyId: family.id, kind: k.kind, createdBy: actor.actorId } });
        }

        const learners: Array<{ id: string; child: PresentedForm['children'][number] }> = [];
        for (const child of form.children) {
          const [{ id }] = await tx.$queryRaw<Array<{ id: string }>>`
            SELECT chat.enrol_learner(${family.id}::uuid, ${child.name}, ${child.teacher.id}::uuid, ${actor.actorId}::uuid)::text AS id`;
          await tx.learnerSupervision.create({
            data: { learnerId: id, organizationId: org, supervisorId, assignedBy: actor.actorId, reason: 'enrolled from New Students' },
          });
          const courseId = await this.courseFor(tx, org, actor.actorId, child.course);
          await tx.learnerEnrollment.create({
            data: {
              learnerId: id,
              organizationId: org,
              courseId,
              statedAge: child.age,
              statedAgeOn: todayUtc(),
              updatedBy: actor.actorId,
            },
          });
          await this.audit.audit(tx, {
            actorId: actor.actorId,
            action: 'learner.supervisor_assigned',
            entity: 'learner',
            entityId: id,
            after: { supervisorId },
            reason: 'enrolled from New Students',
          });
          learners.push({ id, child });
        }
        await tx.studentEnrolment.create({
          data: {
            lessonId: trialId,
            organizationId: org,
            familyId: family.id,
            contactId: contact.id,
            accountId: account.id,
            learnerIds: learners.map((l) => l.id),
            assignedBy: actor.actorId,
          },
        });
        // PD-27: payment links, payments and invoices made for this trial before
        // the family existed now belong to it (and to the child, if one).
        await this.payments?.attachTrial(tx, trialId, family.id, learners.map((l) => l.id));
        await this.audit.audit(tx, {
          actorId: actor.actorId,
          action: 'new_student.enrolled',
          entity: 'family',
          entityId: family.id,
          after: { trialId, supervisorId, learnerIds: learners.map((l) => l.id), contactId: contact.id },
          reason: 'enrolled from New Students',
        });
        return { familyId: family.id, learners };
      }),
    );

    const schedules = await this.scheduleFromForm(actor, trialId, created.learners);
    return { familyId: created.familyId, learnerIds: created.learners.map((l) => l.id), schedules };
  }

  /**
   * PD-42 PR-3: the trial sibling (plan §1.7, §4.4). The trial's parent is
   * already a family in Chat, so Assign adds the form's children to it instead
   * of making a second family: no new family, parent or account; the children
   * go to the family's Operations supervisor (brothers and sisters share one;
   * PD-24 moves them together), and join its live group. Only to the family
   * the trial's parent is in: one of the form's contact keys -- or the sign-in
   * e-mail -- must be that family's.
   */
  private async attachSibling(
    actor: Actor,
    trialId: string,
    form: PresentedForm,
    familyId: string,
    requested: string | null,
    email: string | null,
  ) {
    const org = actor.organizationId as string;
    const family = await this.prisma.family.findFirst({ where: { id: familyId, organizationId: org }, select: { id: true, primaryContactId: true } });
    if (!family) throw notFound();
    const contact = family.primaryContactId
      ? await this.prisma.contact.findUnique({ where: { id: family.primaryContactId }, select: { id: true, accountId: true } })
      : null;
    const keys = parentContactKeys(email, form.parent.phone);
    const held = keys.length
      ? await this.prisma.familyContactKey.findMany({ where: { organizationId: org, keyHash: { in: keys.map((k) => k.hash) } }, select: { familyId: true } })
      : [];
    const account = email ? await this.prisma.account.findUnique({ where: { subject: email }, select: { id: true } }) : null;
    const same = held.some((k) => k.familyId === family.id) || (account !== null && account.id === contact?.accountId);
    if (!contact || !same || held.some((k) => k.familyId !== family.id)) {
      throw invalid('familyId: this trial\'s parent is not that family\'s parent');
    }
    const placed = await this.familySupervision(this.prisma, family.id);
    const supervisorId = placed.supervisorId ?? requested;
    if (!supervisorId) throw invalid('supervisorId: required -- the family has no Operations supervisor yet');
    if (requested && requested !== supervisorId) {
      throw invalid('supervisorId: brothers and sisters share their Operations supervisor; this family\'s is already chosen');
    }
    const decision = this.authz.canAssignSupervision(actor, {
      organizationId: org,
      actsForNew: await this.authz.actsFor(actor, supervisorId, new Date()),
      currentSupervisorId: null,
      actsForCurrent: null,
    });
    if (!decision.allowed) throw new CommError(decision.code, decision.reason);

    const learners = await this.lessons.write(() =>
      this.prisma.$transaction(async (tx) => {
        await this.conversations.assertActorLive(tx, actor);
        // The family's lock (the one PD-42's placing and Add child take), then
        // its supervision again: nothing changed since it was read.
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`pd042:${family.id}`}, 0))`;
        const now = await this.familySupervision(tx, family.id);
        if (now.supervisorId !== placed.supervisorId) {
          throw new CommError(CommErrorCode.LESSON_STATE, 'the family\'s supervisor changed meanwhile; reload', 409);
        }
        const created: Array<{ id: string; child: PresentedForm['children'][number] }> = [];
        for (const child of form.children) {
          const [{ id }] = await tx.$queryRaw<Array<{ id: string }>>`
            SELECT chat.enrol_learner(${family.id}::uuid, ${child.name}, ${child.teacher.id}::uuid, ${actor.actorId}::uuid)::text AS id`;
          await tx.learnerSupervision.create({
            data: { learnerId: id, organizationId: org, supervisorId, assignedBy: actor.actorId, reason: 'enrolled from New Students (sibling)' },
          });
          const courseId = await this.courseFor(tx, org, actor.actorId, child.course);
          await tx.learnerEnrollment.create({
            data: { learnerId: id, organizationId: org, courseId, statedAge: child.age, statedAgeOn: todayUtc(), updatedBy: actor.actorId },
          });
          await this.audit.audit(tx, {
            actorId: actor.actorId, action: 'learner.supervisor_assigned', entity: 'learner', entityId: id,
            after: { supervisorId }, reason: 'enrolled from New Students (sibling)',
          });
          created.push({ id, child });
        }
        // The form's keys the family does not hold yet become its own (S1).
        for (const k of keys) {
          await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`pd042:${k.hash}`}, 0))`;
          const other = await tx.familyContactKey.findFirst({ where: { organizationId: org, keyHash: k.hash }, select: { familyId: true } });
          if (other && other.familyId !== family.id) throw invalid('familyId: this trial\'s parent is not that family\'s parent');
          if (!other) await tx.familyContactKey.create({ data: { organizationId: org, keyHash: k.hash, familyId: family.id, kind: k.kind, createdBy: actor.actorId } });
        }
        await tx.studentEnrolment.create({
          data: {
            lessonId: trialId, organizationId: org, familyId: family.id, contactId: contact.id, accountId: contact.accountId,
            learnerIds: created.map((l) => l.id), assignedBy: actor.actorId, origin: 'trial', kind: 'added_children',
          },
        });
        await this.payments?.attachTrial(tx, trialId, family.id, created.map((l) => l.id));
        await this.audit.audit(tx, {
          actorId: actor.actorId, action: 'family.children_added', entity: 'family', entityId: family.id,
          after: { origin: 'trial', kind: 'added_children', trialId, learnerIds: created.map((l) => l.id), supervisorId },
          reason: 'trial sibling added to the family (PD-42)',
        });
        return created;
      }),
    );

    const schedules = await this.scheduleFromForm(actor, trialId, learners);
    let group: 'joined' | 'none' | 'not_joined' = 'none';
    try {
      const joined = await this.conversations.addLearnersToFamilyGroup(actor.actorId, { familyId: family.id, learnerIds: learners.map((l) => l.id) });
      if (joined) {
        // group_created_by: who put the enrolment's children in the group (student_enrolment_group_is_whole).
        await this.prisma.studentEnrolment.update({
          where: { lessonId: trialId },
          data: { groupConversationId: joined.conversationId, groupCreatedBy: actor.actorId },
        });
        group = 'joined';
      }
    } catch (e) {
      this.log.warn(`trial ${trialId}: children not added to the family group: ${e instanceof Error ? e.message : String(e)}`);
      group = 'not_joined';
    }
    return { familyId: family.id, learnerIds: learners.map((l) => l.id), schedules, attached: true, group };
  }

  /**
   * The family's one Operations supervisor, or null when none of its children
   * has one yet. A family partly placed (a child waiting) or split between two
   * supervisors is refused: brothers and sisters are placed together, and the
   * placing is the Operations manager's own step (review of #214) -- never a
   * partial supervision here.
   */
  private async familySupervision(db: Pick<Prisma.TransactionClient, '$queryRaw'>, familyId: string): Promise<{ supervisorId: string | null }> {
    const kids = await db.$queryRaw<Array<{ supervisor_id: string | null }>>`
      SELECT ls.supervisor_id::text AS supervisor_id
        FROM chat.learner l LEFT JOIN chat.learner_supervision ls ON ls.learner_id = l.id
       WHERE l.family_id = ${familyId}::uuid`;
    if (kids.some((k) => k.supervisor_id === null)) {
      throw new CommError(CommErrorCode.LESSON_STATE, 'this family is waiting for its Operations supervisor: assign the family\'s Operations supervisor first', 409);
    }
    const supervisors = [...new Set(kids.map((k) => k.supervisor_id as string))];
    if (supervisors.length > 1) {
      throw new CommError(CommErrorCode.LESSON_STATE, 'this family\'s children have different supervisors; transfer them to one first (PD-24)', 409);
    }
    return { supervisorId: supervisors[0] ?? null };
  }

  /** The children's weekly times, from the form, where the teacher is free (best effort; the answer says which were not). */
  private async scheduleFromForm(actor: Actor, trialId: string, learners: Array<{ id: string; child: PresentedForm['children'][number] }>) {
    const duration = await this.trialMinutes(trialId);
    const schedules: Array<{ learnerId: string; set: boolean; reason: string | null }> = [];
    for (const { id, child } of learners) {
      try {
        const learner = await this.prisma.learner.findUniqueOrThrow({ where: { id } });
        const slots = child.schedule.map((s) => ({ weekday: s.weekday, startMinute: minuteOf(s.time), durationMinutes: duration }));
        await this.scheduling.applySchedule(actor, learner, slots, null, null);
        schedules.push({ learnerId: id, set: true, reason: null });
      } catch (e) {
        const reason = e instanceof CommError ? e.message : 'the weekly times could not be set';
        this.log.warn(`learner ${id}: weekly times not set: ${reason}`);
        schedules.push({ learnerId: id, set: false, reason });
      }
    }
    return schedules;
  }

  /**
   * PD-24: the Operations manager (or the super admin) changes a new student's
   * supervisor at any time after Assign. The children of the enrolment -- with
   * any sibling who shares a group with them -- move together, and their
   * group, the parent's 1:1, billing and profiles follow
   * (OrgStructureService.transferLearners). Nothing is created again.
   */
  async changeSupervisor(actorId: string, trialId: string, body: Record<string, unknown>) {
    const actor = await this.conversations.requireActor(actorId);
    const viewer = await this.viewer(actor);
    if (!viewer.superAdmin && !viewer.opsManager) {
      throw new CommError(CommErrorCode.LESSON_DENIED, 'a new student\'s supervisor is changed by the Operations manager');
    }
    if (!isUuid(trialId)) throw notFound();
    const enrolment = await this.prisma.studentEnrolment.findFirst({ where: { lessonId: trialId, organizationId: actor.organizationId ?? '' } });
    if (!enrolment) throw notFound();
    return this.org.transferLearners(actor, enrolment.learnerIds, body);
  }

  async createGroup(actorId: string, trialId: string) {
    const actor = await this.conversations.requireActor(actorId);
    if (!isUuid(trialId)) throw notFound();
    const enrolment = await this.prisma.studentEnrolment.findFirst({ where: { lessonId: trialId, organizationId: actor.organizationId ?? '' } });
    if (!enrolment) throw notFound();
    if (enrolment.groupConversationId) {
      throw new CommError(CommErrorCode.LESSON_STATE, 'the family group already exists', 409);
    }
    const learners = await this.prisma.learner.findMany({
      where: { id: { in: enrolment.learnerIds } },
      select: { id: true, teacherId: true },
    });
    const teacherIds = [...new Set(learners.map((l) => l.teacherId).filter((t): t is string => !!t))];
    // Who may open it is createFamilyGroup's decision (the children's
    // supervisor, their active backup or manager, the super admin).
    const conv = await this.conversations.createFamilyGroup(actor.actorId, {
      learnerIds: enrolment.learnerIds,
      contactIds: [enrolment.contactId],
      teacherIds,
    });
    await this.prisma.studentEnrolment.update({
      where: { lessonId: trialId },
      data: { groupConversationId: conv.id, groupCreatedBy: actor.actorId },
    });
    // The parent also reaches their supervisor directly, as every family does.
    const supervision = await this.prisma.learnerSupervision.findUnique({ where: { learnerId: enrolment.learnerIds[0] } });
    if (supervision) {
      try {
        await this.conversations.getOrCreateDirect(enrolment.contactId, supervision.supervisorId);
      } catch (e) {
        this.log.warn(`direct chat with the supervisor not opened: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    return { conversationId: conv.id };
  }

  /**
   * PD-32: staff end the parent's live sign-up code (it leaked, or was sent to
   * the wrong number). The parent asks for a new one. The wrong-code count stays.
   */
  async invalidateSignupCode(actorId: string, trialId: string) {
    const { actor, enrolment } = await this.responsibleFor(actorId, trialId);
    const done = await this.prisma.$transaction(async (tx) => {
      const ended = await tx.parentSignupCode.updateMany({
        where: { accountId: enrolment.accountId, usedAt: null, supersededAt: null },
        data: { supersededAt: new Date(), relayCode: null },
      });
      if (ended.count > 0) {
        await this.audit.audit(tx, {
          actorId: actor.actorId, action: 'parent.signup_code_invalidated', entity: 'account', entityId: enrolment.accountId,
          after: { trialId }, reason: 'staff invalidated the parent sign-up code',
        });
      }
      return ended.count;
    });
    return { invalidated: done > 0 };
  }

  /**
   * PD-32: staff clear the parent's wrong-code count (the cap of ten in 24
   * hours), after checking with the parent. Audited; the rows are kept.
   */
  async resetSignupAttempts(actorId: string, trialId: string) {
    const { actor, enrolment } = await this.responsibleFor(actorId, trialId);
    const account = await this.prisma.account.findUniqueOrThrow({ where: { id: enrolment.accountId }, select: { subject: true } });
    const cleared = await this.prisma.$transaction(async (tx) => {
      // By account; and any counted against the current e-mail before it was the parent's.
      const rows = await tx.parentSignupFailure.updateMany({
        where: { clearedAt: null, OR: [{ accountId: enrolment.accountId }, { subjectHash: subjectHash(account.subject) }] },
        data: { clearedAt: new Date(), clearedBy: actor.actorId },
      });
      await this.audit.audit(tx, {
        actorId: actor.actorId, action: 'parent.signup_attempts_reset', entity: 'account', entityId: enrolment.accountId,
        after: { trialId, cleared: rows.count }, reason: 'staff reset the parent sign-up wrong-code count',
      });
      return rows.count;
    });
    return { cleared };
  }

  /** The enrolment, for its children's supervisor (or the Operations manager, or the super admin). */
  private async responsibleFor(actorId: string, trialId: string) {
    const actor = await this.conversations.requireActor(actorId);
    if (!isUuid(trialId)) throw notFound();
    const viewer = await this.viewer(actor);
    const enrolment = await this.prisma.studentEnrolment.findFirst({ where: { lessonId: trialId, organizationId: actor.organizationId ?? '' } });
    if (!enrolment) throw notFound();
    const mine = new Set(viewer.supervised);
    if (!viewer.superAdmin && !viewer.opsManager && !enrolment.learnerIds.some((l) => mine.has(l))) {
      throw new CommError(CommErrorCode.LESSON_DENIED, 'the parent\'s sign-up is handled by the children\'s supervisor');
    }
    // PD-42: no account yet means nothing to sign up to (no sign-in e-mail entered).
    const accountId = enrolment.accountId;
    if (!accountId) throw new CommError(CommErrorCode.LESSON_STATE, 'the parent has no sign-in e-mail yet', 409);
    if (await this.prisma.accountCredential.findUnique({ where: { accountId }, select: { accountId: true } })) {
      throw new CommError(CommErrorCode.LESSON_STATE, 'the parent has already signed up', 409);
    }
    return { actor, enrolment: { ...enrolment, accountId } };
  }

  // ------------------------------------------------------------------

  private async viewer(actor: Actor) {
    const staff = actor.kind === ActorKind.STAFF && actor.isActive && !!actor.organizationId;
    const superAdmin = staff && actor.staffRole === StaffRole.SUPER_ADMIN;
    const opsManager = staff && !superAdmin
      ? (await this.prisma.$queryRaw<Array<{ ok: boolean }>>`
          SELECT chat.is_operations_manager(${actor.actorId}::uuid, ${actor.organizationId}::uuid) AS ok`)[0]?.ok === true
      : superAdmin;
    return {
      superAdmin,
      opsManager,
      operations: staff && (await this.lessons.inDepartment(actor, 'operations')),
      sales: staff && (await this.lessons.inDepartment(actor, 'sales')),
      supervised: staff ? await this.lessons.supervisedLearnerIds(actor, new Date()) : [],
    };
  }

  /** The course a child's form names, from the academy's list -- added to it when new. */
  private async courseFor(tx: Prisma.TransactionClient, org: string, actorId: string, name: string): Promise<string | null> {
    return courseNamed(tx, this.audit, org, actorId, name, 'course named on a subscription form');
  }

  /** A regular lesson lasts as long as the trial did (30 minutes when unknown). */
  private async trialMinutes(trialId: string): Promise<number> {
    const trial = await this.prisma.lesson.findUnique({ where: { id: trialId }, select: { startsAt: true, endsAt: true } });
    const minutes = trial ? Math.round((trial.endsAt.getTime() - trial.startsAt.getTime()) / 60_000) : 30;
    return minutes >= 15 && minutes <= 240 ? minutes : 30;
  }
}

/**
 * PD-42 S1: the keys a parent is known by -- the sign-in e-mail, and the phone
 * Sales typed when it reads as one number (E.164; a local number with no
 * country is not keyed rather than keyed wrong).
 */
export function parentContactKeys(email: string | null, phone: string | null): Array<{ kind: 'email' | 'phone'; hash: string }> {
  const keys: Array<{ kind: 'email' | 'phone'; hash: string }> = [];
  if (email) keys.push({ kind: 'email', hash: contactKeyHash('email', email.trim().toLowerCase()) });
  const e164 = phone ? e164ForKey(phone, null) : null;
  if (e164 && e164 !== 'ambiguous') keys.push({ kind: 'phone', hash: contactKeyHash('phone', e164) });
  return keys;
}

/**
 * The course a form names, from the academy's list -- added to it when new
 * (PD-16; PD-42's intake form too). Inside the caller's transaction.
 */
export async function courseNamed(
  tx: Prisma.TransactionClient,
  audit: AuditService,
  org: string,
  actorId: string,
  name: string,
  reason: string,
): Promise<string | null> {
  const clean = name.trim().slice(0, 80);
  if (!clean) return null;
  const found = await tx.$queryRaw<Array<{ id: string }>>`
    SELECT id::text AS id FROM chat.course WHERE organization_id = ${org}::uuid AND lower(btrim(name)) = lower(${clean}) LIMIT 1`;
  if (found[0]) return found[0].id;
  const course = await tx.course.create({ data: { organizationId: org, name: clean, createdBy: actorId } });
  await audit.audit(tx, {
    actorId, action: 'course.created', entity: 'course', entityId: course.id,
    after: { name: clean }, reason,
  });
  return course.id;
}

export function minuteOf(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

function todayUtc(): Date {
  return new Date(`${new Date().toISOString().slice(0, 10)}T00:00:00Z`);
}

function notFound() {
  return new CommError(CommErrorCode.LESSON_NOT_FOUND, 'new student not found', 404);
}

/**
 * PD-42: the trial's parent is already a family in Chat. The Operations manager
 * (the only one who assigns) reaches every family, so it is named: Assign with
 * its familyId adds the children there.
 */
async function parentExists(db: Pick<Prisma.TransactionClient, 'family'>, familyId: string): Promise<CommError> {
  const family = await db.family.findUnique({ where: { id: familyId }, select: { id: true, primaryContactId: true, displayName: true } });
  return new CommError(CommErrorCode.PARENT_EXISTS, 'this parent is already in Chat; add the children to their family', 409, {
    familyId, contactId: family?.primaryContactId ?? null, parentName: family?.displayName ?? null,
  });
}

function invalid(reason: string) {
  return new CommError(CommErrorCode.VALIDATION, reason, 400);
}
