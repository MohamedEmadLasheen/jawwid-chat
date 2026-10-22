import { Inject, Injectable, Logger } from '@nestjs/common';
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
import { normalizeEmail } from '../platform/auth/parent-signup.service';
import { NewStudentsService } from './new-students.service';
import { seedFromEnrolment } from '../parent-profile/parent-record.service';

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
  ) {}

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
    const accounts = enrolments.map((e) => e.accountId);
    const [credentials, codes] = await Promise.all([
      this.prisma.accountCredential.findMany({ where: { accountId: { in: accounts } }, select: { accountId: true } }),
      this.prisma.parentSignupCode.findMany({
        where: { accountId: { in: accounts }, usedAt: null, supersededAt: null, expiresAt: { gt: new Date() } },
      }),
    ]);
    const signedUp = new Set(credentials.map((c) => c.accountId));
    const codeOf = new Map(codes.map((c) => [c.accountId, c]));
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
        const code = codeOf.get(e.accountId);
        const responsible = viewer.superAdmin || viewer.opsManager || e.learnerIds.some((l) => mine.has(l));
        return {
          ...f,
          enrolment: {
            familyId: e.familyId,
            learnerIds: e.learnerIds,
            supervisor,
            assignedAt: e.assignedAt.toISOString(),
            groupConversationId: e.groupConversationId,
            canCreateGroup: responsible && e.groupConversationId === null,
            parentSignup: signedUp.has(e.accountId)
              ? { state: 'signed_up' as const }
              : code
                ? {
                    state: 'code_waiting' as const,
                    // The code the supervisor relays on WhatsApp -- only to whoever is responsible.
                    ...(responsible ? { code: code.relayCode, expiresAt: code.expiresAt.toISOString() } : {}),
                  }
                : { state: 'not_started' as const },
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
    if (!supervisorId) throw invalid('supervisorId: required');
    const form = await this.forms.get(org, trialId);
    if (!form) throw notFound();
    if (await this.prisma.studentEnrolment.findUnique({ where: { lessonId: trialId } })) {
      throw new CommError(CommErrorCode.LESSON_STATE, 'this student is already assigned', 409);
    }
    const rawEmail = typeof body.email === 'string' && body.email.trim() ? body.email : form.parent.email ?? '';
    const email = normalizeEmail(rawEmail);
    if (!email) throw invalid('email: the parent signs up with an e-mail address; enter a valid one');
    if (await this.prisma.account.findUnique({ where: { subject: email }, select: { id: true } })) {
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

    // The children's weekly times, from the form, where the teacher is free.
    const duration = await this.trialMinutes(trialId);
    const schedules: Array<{ learnerId: string; set: boolean; reason: string | null }> = [];
    for (const { id, child } of created.learners) {
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
    return { familyId: created.familyId, learnerIds: created.learners.map((l) => l.id), schedules };
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
    const clean = name.trim().slice(0, 80);
    if (!clean) return null;
    const found = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT id::text AS id FROM chat.course WHERE organization_id = ${org}::uuid AND lower(btrim(name)) = lower(${clean}) LIMIT 1`;
    if (found[0]) return found[0].id;
    const course = await tx.course.create({ data: { organizationId: org, name: clean, createdBy: actorId } });
    await this.audit.audit(tx, {
      actorId, action: 'course.created', entity: 'course', entityId: course.id,
      after: { name: clean }, reason: 'course named on a subscription form',
    });
    return course.id;
  }

  /** A regular lesson lasts as long as the trial did (30 minutes when unknown). */
  private async trialMinutes(trialId: string): Promise<number> {
    const trial = await this.prisma.lesson.findUnique({ where: { id: trialId }, select: { startsAt: true, endsAt: true } });
    const minutes = trial ? Math.round((trial.endsAt.getTime() - trial.startsAt.getTime()) / 60_000) : 30;
    return minutes >= 15 && minutes <= 240 ? minutes : 30;
  }
}

function minuteOf(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

function todayUtc(): Date {
  return new Date(`${new Date().toISOString().slice(0, 10)}T00:00:00Z`);
}

function notFound() {
  return new CommError(CommErrorCode.LESSON_NOT_FOUND, 'new student not found', 404);
}

function invalid(reason: string) {
  return new CommError(CommErrorCode.VALIDATION, reason, 400);
}
