import { createHash } from 'node:crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../platform/prisma.service';
import { CommError, CommErrorCode } from '../platform/errors';
import { AUDIT_SERVICE } from '../platform/tokens';
import type { AuditService } from '../platform/audit.service';
import type { Actor } from '../platform/types';
import { ConversationService, isUuid } from '../communication/conversations/conversation.service';
import { ActorKind } from '../communication/contracts/vocab';
import { LessonService } from '../lessons/lesson.service';
import { SchedulingService } from '../lessons/scheduling.service';
import { recordSignInEmail, seedFromEnrolment } from '../parent-profile/parent-record.service';
import { contactKeyHash } from './contact-key';
import { courseNamed, minuteOf } from './enrolment.service';
import {
  foldName,
  parseAddChildren,
  parseCarriedOver,
  parseIntake,
  parseSignInEmail,
  type CarriedOverInput,
  type IntakeChild,
} from './intake-input';

type Tx = Prisma.TransactionClient;

/** Who is entering, in the terms PD-42's rules use (plan §4.3, D5). */
export type IntakeStanding = 'super_admin' | 'operations_manager' | 'sales_manager' | 'operations_supervisor' | 'sales_member';

interface Standing {
  actor: Actor;
  org: string;
  standing: IntakeStanding;
  /** May decide completed lessons above a package (F1) and corrections after 14 days: PD-30's three roles. */
  manager: boolean;
}

/** Who the new family belongs to. */
interface Ownership {
  /** The Operations supervisor its children are placed on, or null (a Sales-entered family waits for one). */
  supervisorId: string | null;
  /** The Sales member who owns it, or null. */
  salesOwnerId: string | null;
  /** Set when a manager entered it for a supervisor (D5). */
  onBehalfOf: string | null;
}

/**
 * PD-42: Sales and Operations supervisors enter the families they already
 * handle in Jawwid Core, by hand, without a trial; and add a child to a family
 * that is theirs. It is PD-16's enrolment, written by the supervisor instead of
 * Assigned by the Operations manager: the family, the parent (with an account
 * when there is an e-mail), the children, their supervision or Sales owner,
 * the parent file, the package each child already had in Core, and one intake
 * record -- in ONE transaction.
 *
 *   enter         a new family. An Operations supervisor places the children on
 *                 themself; a Sales member owns the family (its Operations
 *                 supervisor is set later by the Operations manager); a manager
 *                 enters for one of their supervisors (D5).
 *   addChildren   more children for a family the caller owns.
 *   carryOver     a child's Core package after the intake (within 14 days for
 *                 the supervisor who entered them; PD-30-amendment-carried-over).
 *   voidCarryOver correct it (the entrant within 14 days, or the three managers).
 *   setSignInEmail the parent's e-mail, when it was not known at intake.
 *
 * The database decides every rule again (20261028110000, 20261028210000): this
 * service asks first only to answer in words. Duplicates (S1): the parent's
 * e-mail and E.164 number are keyed (contactKeyHash) and locked
 * (pg_advisory_xact_lock) for the transaction, so two supervisors entering the
 * same parent at once make one family. A replay of the same intake id writes
 * nothing and answers what the first wrote.
 *
 * G-07: the phone and e-mail reach the parent file through seedFromEnrolment
 * (src/parent-profile) only; audit rows never carry them.
 */
@Injectable()
export class FamilyIntakeService {
  private readonly log = new Logger('FamilyIntake');

  constructor(
    private readonly prisma: PrismaService,
    private readonly conversations: ConversationService,
    private readonly lessons: LessonService,
    private readonly scheduling: SchedulingService,
    @Inject(AUDIT_SERVICE) private readonly audit: AuditService,
  ) {}

  /** What the form needs: who the caller enters as, who they may enter for, the teachers. */
  async options(actorId: string) {
    const s = await this.standing(actorId);
    const onBehalfOf = isManager(s) ? await this.enterableFor(s) : [];
    const teachers = await this.prisma.teacher.findMany({
      where: { organizationId: s.org, isActive: true, leftAt: null },
      select: { id: true, name: true },
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
    });
    // QA on #202: a manager with nobody to enter a family for is told so,
    // instead of a form that cannot be saved. They never own it themself.
    const noTeam = isManager(s) && onBehalfOf.length === 0;
    return { standing: s.standing, manager: s.manager, ready: await this.ready(), onBehalfOf, noTeam, teachers };
  }

  /** The supervisors a manager may enter a family for (D5): their department's. */
  private async enterableFor(s: Standing) {
    return this.prisma.$queryRaw<Array<{ id: string; name: string; kind: 'operations' | 'sales' }>>`
      SELECT st.id::text AS id, st.name, d.kind
        FROM chat.department_member m
        JOIN chat.department d ON d.id = m.department_id
        JOIN chat.staff st ON st.id = m.staff_id AND st.is_active AND st.left_at IS NULL
       WHERE st.organization_id = ${s.org}::uuid
         AND ((d.kind = 'operations' AND m.position = 'supervisor' AND ${s.standing !== 'sales_manager'})
           OR (d.kind = 'sales' AND ${s.standing !== 'operations_manager'}))
       ORDER BY st.name, st.id`;
  }

  async enter(actorId: string, body: unknown) {
    const s = await this.standing(actorId);
    await this.requireReady();
    const input = parseIntake(body);
    const hash = payloadHash({ route: 'enter', parent: input.parent, children: input.children, payment: input.payment, onBehalfOf: input.onBehalfOf, confirmOver: input.confirmOver });
    const owner = await this.ownership(s, input.onBehalfOf);
    this.requireOverConfirmed(s, input.children, input.confirmOver);
    for (const c of input.children) if (c.teacherId) await this.requireTeacher(s.org, c.teacherId);
    const keys = [
      ...(input.parent.email ? [{ kind: 'email' as const, hash: contactKeyHash('email', input.parent.email) }] : []),
      ...(input.parent.phoneE164 ? [{ kind: 'phone' as const, hash: contactKeyHash('phone', input.parent.phoneE164) }] : []),
    ];

    const created = await this.write(s, async (tx) => {
      await this.lock(tx, [input.intakeId, ...keys.map((k) => k.hash)]);
      const replay = await this.replay(tx, s, input.intakeId, hash, null);
      if (replay) return replay;
      await this.refuseExistingParent(tx, s, input.parent.email, keys.map((k) => k.hash));

      const [{ id: familyId }] = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT chat.create_intake_family(${input.parent.name}, ${s.actor.actorId}::uuid)::text AS id`;
      const account = input.parent.email
        ? await tx.account.create({ data: { organizationId: s.org, subject: input.parent.email, kind: 'family', status: 'active', isActive: true } })
        : null;
      const contact = await tx.contact.create({ data: this.parentContact(s.org, familyId, input.parent.name, account?.id ?? null) });
      await tx.family.update({ where: { id: familyId }, data: { primaryContactId: contact.id } });
      if (owner.salesOwnerId) {
        await tx.familySalesOwner.create({
          data: { familyId, organizationId: s.org, staffId: owner.salesOwnerId, assignedBy: s.actor.actorId, reason: 'entered by hand (PD-42)' },
        });
      }
      for (const k of keys) {
        await tx.familyContactKey.create({ data: { organizationId: s.org, keyHash: k.hash, familyId, kind: k.kind, createdBy: s.actor.actorId } });
      }
      await seedFromEnrolment(tx, {
        contactId: contact.id, familyId, organizationId: s.org, actorId: s.actor.actorId,
        phone: input.parent.phone, email: input.parent.email,
        paymentMethod: input.payment.method, currency: input.payment.currency,
      });
      if (owner.onBehalfOf) {
        await tx.$executeRaw`SELECT chat.transfer_ownership(${familyId}::uuid, ${owner.onBehalfOf}::uuid,
          'entered by their manager on their behalf (PD-42)', ${s.actor.actorId}::uuid)`;
      }
      const learners = await this.createChildren(tx, s, familyId, owner.supervisorId, input.children);
      await tx.studentEnrolment.create({
        data: {
          id: input.intakeId, organizationId: s.org, familyId, contactId: contact.id, accountId: account?.id ?? null,
          learnerIds: learners.map((l) => l.id), origin: 'intake', kind: 'new_family', assignedBy: s.actor.actorId,
          intakePayloadHash: hash,
        },
      });
      await this.carryOverAll(tx, s, learners);
      await this.audit.audit(tx, {
        actorId: s.actor.actorId, action: 'family.entered', entity: 'family', entityId: familyId,
        after: {
          origin: 'intake', kind: 'new_family', learnerIds: learners.map((l) => l.id), contactId: contact.id,
          supervisorId: owner.supervisorId, salesOwnerId: owner.salesOwnerId, onBehalfOf: owner.onBehalfOf,
          signIn: account ? 'e-mail' : 'none yet',
        },
        reason: 'entered by hand (PD-42)',
      });
      if (owner.salesOwnerId) {
        await this.audit.audit(tx, {
          actorId: s.actor.actorId, action: 'family.sales_owner_set', entity: 'family', entityId: familyId,
          after: { salesOwnerId: owner.salesOwnerId }, reason: 'entered by hand (PD-42)',
        });
      }
      if (owner.supervisorId) {
        await this.audit.audit(tx, {
          actorId: s.actor.actorId, action: 'family.operations_supervisor_set', entity: 'family', entityId: familyId,
          after: { supervisorId: owner.supervisorId, learnerIds: learners.map((l) => l.id) }, reason: 'entered by hand (PD-42)',
        });
      }
      return { replay: false as const, enrolmentId: input.intakeId, familyId, contactId: contact.id, learners };
    });

    if (created.replay) return created.result;
    const schedules = await this.schedule(s, created.learners);
    return {
      enrolmentId: created.enrolmentId,
      familyId: created.familyId,
      contactId: created.contactId,
      learnerIds: created.learners.map((l) => l.id),
      supervision: owner.supervisorId ? 'placed' : 'needs_operations_supervisor',
      salesOwnerId: owner.salesOwnerId,
      schedules,
      replay: false,
    };
  }

  async addChildren(actorId: string, familyId: string, body: unknown) {
    const s = await this.standing(actorId);
    await this.requireReady();
    const input = parseAddChildren(body);
    const family = await this.requireOwnFamily(s, familyId);
    this.requireOverConfirmed(s, input.children, input.confirmOver);
    for (const c of input.children) if (c.teacherId) await this.requireTeacher(s.org, c.teacherId);
    const hash = payloadHash({ route: 'add_children', familyId: family.id, children: input.children, confirmDuplicate: input.confirmDuplicate, confirmOver: input.confirmOver });

    const created = await this.write(s, async (tx) => {
      await this.lock(tx, [input.intakeId, family.id]);
      const replay = await this.replay(tx, s, input.intakeId, hash, family.id);
      if (replay) return replay;
      // The family's Operations supervisor, read under the family's lock: placed
      // by them, or by the Operations manager / super admin. A Sales owner adds
      // the child; the manager places it.
      const supervisors = await tx.$queryRaw<Array<{ supervisor_id: string }>>`
        SELECT DISTINCT ls.supervisor_id::text AS supervisor_id
          FROM chat.learner_supervision ls JOIN chat.learner l ON l.id = ls.learner_id
         WHERE l.family_id = ${family.id}::uuid`;
      const only = supervisors.length === 1 ? supervisors[0]!.supervisor_id : null;
      const supervisorId = only && (only === s.actor.actorId || s.standing === 'operations_manager' || s.standing === 'super_admin') ? only : null;
      if (!input.confirmDuplicate) {
        // The same child: the same name (folded), and the same date of birth when both are known.
        const existing = await tx.$queryRaw<Array<{ name: string; birth: string | null }>>`
          SELECT l.name, to_char(e.birth_date, 'YYYY-MM-DD') AS birth
            FROM chat.learner l LEFT JOIN chat.learner_enrollment e ON e.learner_id = l.id
           WHERE l.family_id = ${family.id}::uuid`;
        const clash = input.children
          .filter((c) => existing.some((x) => foldName(x.name) === foldName(c.name) && (!c.birthDate || !x.birth || x.birth === c.birthDate)))
          .map((c) => c.name);
        if (clash.length > 0) {
          throw new CommError(CommErrorCode.CHILD_EXISTS, 'a child with this name is already in the family; confirm it is another child (twins)', 409, { names: clash });
        }
      }
      const learners = await this.createChildren(tx, s, family.id, supervisorId, input.children);
      await tx.studentEnrolment.create({
        data: {
          id: input.intakeId, organizationId: s.org, familyId: family.id, contactId: family.contactId, accountId: family.accountId,
          learnerIds: learners.map((l) => l.id), origin: 'intake', kind: 'added_children', assignedBy: s.actor.actorId,
          intakePayloadHash: hash,
        },
      });
      await this.carryOverAll(tx, s, learners);
      await this.audit.audit(tx, {
        actorId: s.actor.actorId, action: 'family.children_added', entity: 'family', entityId: family.id,
        after: { origin: 'intake', kind: 'added_children', learnerIds: learners.map((l) => l.id), supervisorId },
        reason: 'child added by hand (PD-42)',
      });
      return { replay: false as const, enrolmentId: input.intakeId, familyId: family.id, contactId: family.contactId, learners, supervisorId };
    });

    if (created.replay) return { ...created.result, group: null };
    const schedules = await this.schedule(s, created.learners);
    // PD-42 PR-3: placed on the family's supervisor, they join its live group.
    const group = created.supervisorId ? await this.joinGroup(s, created.familyId, created.learners.map((l) => l.id)) : 'none';
    return {
      enrolmentId: created.enrolmentId,
      familyId: created.familyId,
      learnerIds: created.learners.map((l) => l.id),
      supervision: created.supervisorId ? 'placed' : 'needs_operations_supervisor',
      schedules,
      group,
      replay: false,
    };
  }

  /** { total, completed, planMonths?, confirmOver? } -- a child's Core package, after the intake. */
  async carryOver(actorId: string, learnerId: string, body: unknown) {
    const s = await this.standing(actorId);
    const raw = (typeof body === 'object' && body !== null ? body : {}) as Record<string, unknown>;
    const pkg = parseCarriedOver(raw, 'body');
    const learner = await this.requireOwnLearner(s, learnerId);
    if (pkg.completed > pkg.total && (!s.manager || raw.confirmOver !== true)) {
      throw new CommError(CommErrorCode.INTAKE_INVALID, 'completed lessons above the package are entered and confirmed by the super admin, the Operations Manager or the Sales Manager', 400);
    }
    await this.write(s, async (tx) => {
      await this.insertCarriedOver(tx, s, learner.id, pkg);
      await this.audit.audit(tx, {
        actorId: s.actor.actorId, action: 'subscription.carried_over', entity: 'learner', entityId: learner.id,
        after: { total: pkg.total, completed: pkg.completed, planMonths: pkg.planMonths }, reason: 'package carried over from Jawwid Core (PD-42)',
      });
    });
    return { learnerId: learner.id, total: pkg.total, completed: pkg.completed, planMonths: pkg.planMonths };
  }

  /** { reason } -- correct a carried-over package: void it (then enter it again). */
  async voidCarryOver(actorId: string, learnerId: string, body: unknown) {
    const s = await this.standing(actorId);
    const raw = (typeof body === 'object' && body !== null ? body : {}) as Record<string, unknown>;
    const reason = typeof raw.reason === 'string' ? raw.reason.trim() : '';
    if (reason.length < 1 || reason.length > 500) throw new CommError(CommErrorCode.INTAKE_INVALID, 'reason: required, at most 500 characters', 400);
    const learner = await this.requireOwnLearner(s, learnerId);
    const voided = await this.write(s, async (tx) => {
      const rows = await tx.$executeRaw`
        UPDATE chat.learner_subscription
           SET voided_at = now(), voided_by = ${s.actor.actorId}::uuid, void_reason = ${reason}
         WHERE learner_id = ${learner.id}::uuid AND source = 'carried_over' AND voided_at IS NULL`;
      if (rows === 0) throw new CommError(CommErrorCode.INTAKE_STATE, 'this child has no carried-over package to correct', 409);
      await this.audit.audit(tx, {
        actorId: s.actor.actorId, action: 'subscription.voided', entity: 'learner', entityId: learner.id,
        after: { source: 'carried_over' }, reason,
      });
      return rows;
    });
    return { learnerId: learner.id, voided: voided > 0 };
  }

  /** { email } -- the sign-in e-mail of a parent entered without one; their account is made now. */
  async setSignInEmail(actorId: string, familyId: string, body: unknown) {
    const s = await this.standing(actorId);
    await this.requireReady();
    const email = parseSignInEmail(body);
    const family = await this.requireOwnFamily(s, familyId);
    if (family.accountId) throw new CommError(CommErrorCode.INTAKE_STATE, 'this parent already has a sign-in e-mail', 409);
    const hash = contactKeyHash('email', email);
    const accountId = await this.write(s, async (tx) => {
      await this.lock(tx, [hash, family.id]);
      const own = await tx.familyContactKey.findUnique({ where: { organizationId_keyHash: { organizationId: s.org, keyHash: hash } } });
      if (own && own.familyId !== family.id) await this.refuseExistingParent(tx, s, null, [hash]);
      await this.refuseExistingParent(tx, s, email, []);
      const account = await tx.account.create({ data: { organizationId: s.org, subject: email, kind: 'family', status: 'active', isActive: true } });
      await tx.contact.update({ where: { id: family.contactId }, data: { accountId: account.id } });
      await tx.studentEnrolment.updateMany({ where: { familyId: family.id, kind: 'new_family', accountId: null }, data: { accountId: account.id } });
      if (!own) await tx.familyContactKey.create({ data: { organizationId: s.org, keyHash: hash, familyId: family.id, kind: 'email', createdBy: s.actor.actorId } });
      await recordSignInEmail(tx, { contactId: family.contactId, email, actorId: s.actor.actorId });
      await this.audit.audit(tx, {
        actorId: s.actor.actorId, action: 'parent.sign_in_email_set', entity: 'contact', entityId: family.contactId,
        after: { accountId: account.id }, reason: 'sign-in e-mail entered after the intake (PD-42)',
      });
      return account.id;
    });
    return { familyId: family.id, contactId: family.contactId, accountId };
  }

  // ------------------------------------------------------------------
  // PR-3: the Operations side

  /**
   * New Students' families entered by hand (plan §10.3), to whoever owns them:
   * the entrant's supervision or Sales ownership, their department manager,
   * the Operations manager and the super admin; the Sales manager, the
   * families with a Sales owner. No contact channel (G-07): the parent's name,
   * the children, who entered them and when, who owns them, and the sign-up.
   */
  async entered(actorId: string) {
    const s = await this.standing(actorId);
    const everyFamily = s.standing === 'super_admin' || s.standing === 'operations_manager';
    const rows = await this.prisma.$queryRaw<Array<{
      id: string; kind: string; family_id: string; contact_id: string; parent_name: string | null; account_id: string | null;
      learner_ids: string[]; entered_by: string; entered_by_name: string | null; entered_at: Date; group_id: string | null;
    }>>`
      SELECT e.id::text AS id, e.kind, e.family_id::text AS family_id, e.contact_id::text AS contact_id, c.name AS parent_name,
             c.account_id::text AS account_id, e.learner_ids::text[] AS learner_ids, e.assigned_by::text AS entered_by,
             st.name AS entered_by_name, e.assigned_at AS entered_at, e.group_conversation_id::text AS group_id
        FROM chat.student_enrolment e
        JOIN chat.contact c ON c.id = e.contact_id
        LEFT JOIN chat.staff st ON st.id = e.assigned_by
       WHERE e.organization_id = ${s.org}::uuid AND e.origin = 'intake'
         AND (${everyFamily}
              OR (${s.standing === 'sales_manager'} AND EXISTS (SELECT 1 FROM chat.family_sales_owner o WHERE o.family_id = e.family_id))
              OR (${s.standing !== 'sales_manager'} AND chat.staff_owns_family(${s.actor.actorId}::uuid, e.family_id)))
       ORDER BY e.assigned_at DESC, e.id`;
    const families = [...new Set(rows.map((r) => r.family_id))];
    const owners = await this.ownersOf(families);
    const learnerIds = rows.flatMap((r) => r.learner_ids);
    const children = learnerIds.length
      ? await this.prisma.learner.findMany({ where: { id: { in: learnerIds } }, select: { id: true, name: true } })
      : [];
    const nameOf = new Map(children.map((c) => [c.id, c.name]));
    const signup = await this.signupStates(rows.map((r) => r.account_id).filter((a): a is string => a !== null));
    return {
      viewer: s.standing,
      canAssignSupervisor: everyFamily,
      families: rows.map((r) => {
        const o = owners.get(r.family_id)!;
        // Who relays the sign-up code (review of #214, as PD-16): the super
        // admin and the Operations manager; the children's supervisor; while
        // no child has one yet, the Sales owner and the Sales manager.
        const responsible = everyFamily || o.supervisorIds.includes(s.actor.actorId)
          || (o.supervisorIds.length === 0 && (o.salesOwner?.id === s.actor.actorId || s.standing === 'sales_manager'));
        const signupState = r.account_id ? (signup.get(r.account_id) ?? { state: 'not_started' as const }) : { state: 'no_email' as const };
        return {
          enrolmentId: r.id,
          kind: r.kind as 'new_family' | 'added_children',
          familyId: r.family_id,
          contactId: r.contact_id,
          parentName: r.parent_name,
          children: r.learner_ids.map((id) => ({ id, name: nameOf.get(id) ?? null })),
          enteredBy: { id: r.entered_by, name: r.entered_by_name },
          enteredAt: r.entered_at.toISOString(),
          supervisor: o.supervisor,
          needsOperationsSupervisor: o.needsOperationsSupervisor,
          salesOwner: o.salesOwner,
          suggestion: o.needsOperationsSupervisor ? o.suggestion : null,
          // D1: only the family's Sales owner suggests (review of #214).
          canSuggestSupervisor: o.needsOperationsSupervisor && o.salesOwner?.id === s.actor.actorId,
          groupConversationId: r.group_id ?? o.groupConversationId,
          parentSignup: signupState.state === 'code_waiting' && !responsible
            ? { state: 'code_waiting' as const, issuedAt: signupState.issuedAt }
            : signupState,
        };
      }),
    };
  }

  /** The family as the Parent Profile reads it: its sign-in, its owners, and what the viewer may do. */
  async family(actorId: string, familyId: string) {
    const s = await this.standing(actorId);
    const family = await this.requireOwnFamily(s, familyId);
    const o = (await this.ownersOf([family.id])).get(family.id)!;
    const assigner = s.standing === 'super_admin' || s.standing === 'operations_manager';
    const salesChanger = s.standing === 'super_admin' || s.standing === 'sales_manager';
    const suggester = o.salesOwner?.id === s.actor.actorId;
    const can = {
      setSignInEmail: family.accountId === null,
      addChild: true,
      suggestSupervisor: suggester && o.needsOperationsSupervisor,
      assignOperationsSupervisor: assigner && o.needsOperationsSupervisor,
      changeSalesOwner: salesChanger,
    };
    return {
      familyId: family.id,
      contactId: family.contactId,
      signIn: family.accountId !== null,
      supervisor: o.supervisor,
      needsOperationsSupervisor: o.needsOperationsSupervisor,
      salesOwner: o.salesOwner,
      suggestion: o.needsOperationsSupervisor ? o.suggestion : null,
      can,
      // Placing: the manager's own Operations department (the super admin: any); suggesting: any.
      supervisorChoices: can.assignOperationsSupervisor ? await this.operationsSupervisors(s, 'place')
        : can.suggestSupervisor ? await this.operationsSupervisors(s, 'suggest') : [],
      salesOwnerChoices: can.changeSalesOwner ? await this.salesStaff(s.org) : [],
    };
  }

  /**
   * D1 / §4.2: the Operations manager (or the super admin) places a family's
   * children who have no Operations supervisor on one -- the family's own, when
   * some of its children already have one (siblings share it; PD-24 moves them
   * together). family.owner_id follows. Once: moving them later is PD-24's.
   */
  async assignOperationsSupervisor(actorId: string, familyId: string, body: unknown) {
    const s = await this.standing(actorId);
    if (s.standing !== 'super_admin' && s.standing !== 'operations_manager') {
      throw new CommError(CommErrorCode.INTAKE_DENIED, 'a family\'s Operations supervisor is chosen by the Operations manager');
    }
    const supervisorId = uuidField(body, 'supervisorId');
    const family = await this.requireOwnFamily(s, familyId);
    // The Operations manager places on a supervisor of their own department, as
    // canAssignSupervision does; the super admin on any (review of #214).
    if (!(await this.isOperationsSupervisor(s, supervisorId, 'place'))) {
      throw new CommError(CommErrorCode.INTAKE_INVALID, 'supervisorId: a live Operations supervisor of your department', 400);
    }
    const placed = await this.write(s, async (tx) => {
      await this.lock(tx, [family.id]);
      const kids = await tx.$queryRaw<Array<{ id: string; supervisor_id: string | null }>>`
        SELECT l.id::text AS id, ls.supervisor_id::text AS supervisor_id
          FROM chat.learner l LEFT JOIN chat.learner_supervision ls ON ls.learner_id = l.id
         WHERE l.family_id = ${family.id}::uuid
         ORDER BY l.created_at, l.id`;
      const waiting = kids.filter((k) => k.supervisor_id === null).map((k) => k.id);
      if (waiting.length === 0) {
        throw new CommError(CommErrorCode.INTAKE_STATE, 'this family already has its Operations supervisor; a change is a transfer (PD-24)', 409);
      }
      const current = [...new Set(kids.map((k) => k.supervisor_id).filter((x): x is string => x !== null))];
      if (current.length > 0 && (current.length > 1 || current[0] !== supervisorId)) {
        throw new CommError(CommErrorCode.INTAKE_INVALID, 'supervisorId: brothers and sisters share their Operations supervisor; this family\'s is already chosen', 400, { supervisorId: current[0] });
      }
      for (const learnerId of waiting) {
        await tx.learnerSupervision.create({
          data: { learnerId, organizationId: s.org, supervisorId, assignedBy: s.actor.actorId, reason: 'Operations supervisor chosen (PD-42)' },
        });
        await this.audit.audit(tx, {
          actorId: s.actor.actorId, action: 'learner.supervisor_assigned', entity: 'learner', entityId: learnerId,
          after: { supervisorId }, reason: 'Operations supervisor chosen (PD-42)',
        });
      }
      const [owner] = await tx.$queryRaw<Array<{ owner_id: string }>>`SELECT owner_id::text AS owner_id FROM chat.family WHERE id = ${family.id}::uuid`;
      if (owner?.owner_id !== supervisorId) {
        await tx.$executeRaw`SELECT chat.transfer_ownership(${family.id}::uuid, ${supervisorId}::uuid,
          'Operations supervisor chosen by the Operations manager (PD-42)', ${s.actor.actorId}::uuid)`;
      }
      await this.audit.audit(tx, {
        actorId: s.actor.actorId, action: 'family.operations_supervisor_set', entity: 'family', entityId: family.id,
        after: { supervisorId, learnerIds: waiting }, reason: 'Operations supervisor chosen (PD-42)',
      });
      return waiting;
    });
    const group = await this.joinGroup(s, family.id, placed);
    return { familyId: family.id, supervisorId, learnerIds: placed, group };
  }

  /** D1: a Sales owner suggests the Operations supervisor of a family waiting for one. It places nothing. */
  async suggestSupervisor(actorId: string, familyId: string, body: unknown) {
    const s = await this.standing(actorId);
    const supervisorId = uuidField(body, 'supervisorId');
    const family = await this.requireOwnFamily(s, familyId);
    const owner = await this.prisma.familySalesOwner.findUnique({ where: { familyId: family.id }, select: { staffId: true } });
    if (owner?.staffId !== s.actor.actorId) {
      throw new CommError(CommErrorCode.INTAKE_DENIED, 'a supervisor is suggested by the family\'s Sales owner; the Operations manager places it');
    }
    if (!(await this.isOperationsSupervisor(s, supervisorId, 'suggest'))) {
      throw new CommError(CommErrorCode.INTAKE_INVALID, 'supervisorId: a live Operations supervisor of this academy', 400);
    }
    await this.write(s, async (tx) => {
      await this.lock(tx, [family.id]);
      const [{ waiting }] = await tx.$queryRaw<Array<{ waiting: boolean }>>`
        SELECT EXISTS (SELECT 1 FROM chat.learner l
                        WHERE l.family_id = ${family.id}::uuid
                          AND NOT EXISTS (SELECT 1 FROM chat.learner_supervision ls WHERE ls.learner_id = l.id)) AS waiting`;
      if (!waiting) throw new CommError(CommErrorCode.INTAKE_STATE, 'this family already has its Operations supervisor', 409);
      await tx.$executeRaw`
        INSERT INTO chat.family_supervisor_suggestion (family_id, organization_id, supervisor_id, suggested_by)
        VALUES (${family.id}::uuid, ${s.org}::uuid, ${supervisorId}::uuid, ${s.actor.actorId}::uuid)
        ON CONFLICT (family_id) DO UPDATE SET supervisor_id = EXCLUDED.supervisor_id, suggested_by = EXCLUDED.suggested_by`;
      await this.audit.audit(tx, {
        actorId: s.actor.actorId, action: 'family.supervisor_suggested', entity: 'family', entityId: family.id,
        after: { supervisorId }, reason: 'suggested by the family\'s Sales owner (PD-42)',
      });
    });
    return { familyId: family.id, supervisorId };
  }

  /** { staffId, reason } -- the Sales manager (or the super admin) sets or changes a family's Sales owner. */
  async changeSalesOwner(actorId: string, familyId: string, body: unknown) {
    const s = await this.standing(actorId);
    if (s.standing !== 'super_admin' && s.standing !== 'sales_manager') {
      throw new CommError(CommErrorCode.INTAKE_DENIED, 'a family\'s Sales owner is changed by the Sales manager');
    }
    const staffId = uuidField(body, 'staffId');
    const raw = (typeof body === 'object' && body !== null ? body : {}) as Record<string, unknown>;
    const reason = typeof raw.reason === 'string' ? raw.reason.trim() : '';
    if (reason.length < 1 || reason.length > 500) throw new CommError(CommErrorCode.INTAKE_INVALID, 'reason: required, at most 500 characters', 400);
    const family = await this.requireOwnFamily(s, familyId);
    const [target] = await this.prisma.$queryRaw<Array<{ sales: string | null }>>`
      SELECT chat.sales_department_role(st.id) AS sales FROM chat.staff st
       WHERE st.id = ${staffId}::uuid AND st.organization_id = ${s.org}::uuid AND st.is_active AND st.left_at IS NULL`;
    if (!target?.sales) throw new CommError(CommErrorCode.INTAKE_INVALID, 'staffId: a live member of the Sales department', 400);
    const result = await this.write(s, async (tx) => {
      await this.lock(tx, [family.id]);
      const current = await tx.familySalesOwner.findUnique({ where: { familyId: family.id } });
      if (current?.staffId === staffId) throw new CommError(CommErrorCode.INTAKE_STATE, 'this is already the family\'s Sales owner', 409);
      if (current) {
        await tx.familySalesOwner.update({ where: { familyId: family.id }, data: { staffId, assignedBy: s.actor.actorId, reason } });
        await this.audit.audit(tx, {
          actorId: s.actor.actorId, action: 'family.sales_owner_changed', entity: 'family', entityId: family.id,
          before: { salesOwnerId: current.staffId }, after: { salesOwnerId: staffId }, reason,
        });
      } else {
        await tx.familySalesOwner.create({ data: { familyId: family.id, organizationId: s.org, staffId, assignedBy: s.actor.actorId, reason } });
        await this.audit.audit(tx, {
          actorId: s.actor.actorId, action: 'family.sales_owner_set', entity: 'family', entityId: family.id,
          after: { salesOwnerId: staffId }, reason,
        });
      }
      return { from: current?.staffId ?? null, to: staffId };
    });
    return { familyId: family.id, salesOwnerId: result.to, previousSalesOwnerId: result.from };
  }

  /** The Student Profile's "Current package": the carried-over row, the balance, and what the viewer may do. */
  async carriedOverOf(actorId: string, learnerId: string) {
    const s = await this.standing(actorId);
    const learner = await this.requireOwnLearner(s, learnerId);
    const [row] = await this.prisma.$queryRaw<Array<{
      total: number; completed: number; plan_months: number | null; created_by: string; created_by_name: string | null;
      created_at: Date; in_window: boolean;
    }>>`
      SELECT ls.lessons_included AS total, ls.lessons_used_before AS completed, ls.plan_months::int AS plan_months,
             ls.created_by::text AS created_by, st.name AS created_by_name, ls.created_at,
             ls.created_at > now() - interval '14 days' AS in_window
        FROM chat.learner_subscription ls LEFT JOIN chat.staff st ON st.id = ls.created_by
       WHERE ls.learner_id = ${learner.id}::uuid AND ls.source = 'carried_over' AND ls.voided_at IS NULL
       LIMIT 1`;
    const [facts] = await this.prisma.$queryRaw<Array<{ entered_by: string | null; entry_open: boolean; standing_rows: number }>>`
      SELECT i.entered_by::text AS entered_by,
             coalesce(i.entered_at > now() - interval '14 days', false) AS entry_open,
             (SELECT count(*)::int FROM chat.learner_subscription x WHERE x.learner_id = ${learner.id}::uuid AND x.voided_at IS NULL) AS standing_rows
        FROM (SELECT 1) one
        LEFT JOIN chat.learner_intake i ON i.learner_id = ${learner.id}::uuid`;
    const access = await this.prisma.learnerAccess.findUnique({ where: { learnerId: learner.id } });
    const entrant = facts?.entered_by === s.actor.actorId;
    return {
      learnerId: learner.id,
      package: row
        ? {
            total: row.total,
            completed: row.completed,
            remaining: row.total - row.completed,
            planMonths: row.plan_months,
            enteredBy: { id: row.created_by, name: row.created_by_name },
            enteredAt: row.created_at.toISOString(),
          }
        : null,
      access: access ? { state: access.state, balance: access.balance } : null,
      can: {
        carryOver: !row && !!facts?.entered_by && facts.standing_rows === 0 && ((entrant && facts.entry_open) || s.manager),
        correct: !!row && ((row.created_by === s.actor.actorId && row.in_window) || s.manager),
      },
    };
  }

  /** Each family's supervision, Sales owner, suggestion and live group, for the lists above. */
  private async ownersOf(familyIds: string[]) {
    const out = new Map<string, {
      supervisor: { id: string; name: string | null } | null;
      supervisorIds: string[];
      needsOperationsSupervisor: boolean;
      salesOwner: { id: string; name: string | null } | null;
      suggestion: { id: string; name: string | null } | null;
      groupConversationId: string | null;
    }>();
    if (familyIds.length === 0) return out;
    const rows = await this.prisma.$queryRaw<Array<{
      family_id: string; children: number; supervised: number; supervisor_ids: string[]; supervisor_name: string | null;
      sales_id: string | null; sales_name: string | null; suggested_id: string | null; suggested_name: string | null; group_id: string | null;
    }>>`
      SELECT f.id::text AS family_id,
             (SELECT count(*)::int FROM chat.learner l WHERE l.family_id = f.id) AS children,
             (SELECT count(*)::int FROM chat.learner l JOIN chat.learner_supervision ls ON ls.learner_id = l.id WHERE l.family_id = f.id) AS supervised,
             coalesce((SELECT array_agg(DISTINCT ls.supervisor_id::text) FROM chat.learner l JOIN chat.learner_supervision ls ON ls.learner_id = l.id
                        WHERE l.family_id = f.id), '{}') AS supervisor_ids,
             (SELECT st.name FROM chat.learner l JOIN chat.learner_supervision ls ON ls.learner_id = l.id JOIN chat.staff st ON st.id = ls.supervisor_id
               WHERE l.family_id = f.id ORDER BY l.created_at LIMIT 1) AS supervisor_name,
             o.staff_id::text AS sales_id, so.name AS sales_name,
             sg.supervisor_id::text AS suggested_id, ss.name AS suggested_name,
             (SELECT c.id::text FROM chat.conversation c WHERE c.family_id = f.id AND c.type = 'family_group' AND c.archived_at IS NULL
               ORDER BY c.created_at, c.id LIMIT 1) AS group_id
        FROM chat.family f
        LEFT JOIN chat.family_sales_owner o ON o.family_id = f.id
        LEFT JOIN chat.staff so ON so.id = o.staff_id
        LEFT JOIN chat.family_supervisor_suggestion sg ON sg.family_id = f.id
        LEFT JOIN chat.staff ss ON ss.id = sg.supervisor_id
       WHERE f.id = ANY(${familyIds}::uuid[])`;
    for (const r of rows) {
      out.set(r.family_id, {
        supervisor: r.supervisor_ids.length === 1 ? { id: r.supervisor_ids[0]!, name: r.supervisor_name } : null,
        supervisorIds: r.supervisor_ids,
        needsOperationsSupervisor: r.children > 0 && r.supervised < r.children,
        salesOwner: r.sales_id ? { id: r.sales_id, name: r.sales_name } : null,
        suggestion: r.suggested_id ? { id: r.suggested_id, name: r.suggested_name } : null,
        groupConversationId: r.group_id,
      });
    }
    return out;
  }

  /** The parent's sign-up, by account: signed up, a code waiting (shown to the family's owners), or not started. */
  private async signupStates(accountIds: string[]) {
    const out = new Map<string, { state: 'signed_up' } | { state: 'code_waiting'; code: string | null; issuedAt: string } | { state: 'not_started' }>();
    if (accountIds.length === 0) return out;
    const [credentials, codes] = await Promise.all([
      this.prisma.accountCredential.findMany({ where: { accountId: { in: accountIds } }, select: { accountId: true } }),
      this.prisma.parentSignupCode.findMany({
        where: { accountId: { in: accountIds }, usedAt: null, supersededAt: null, OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] },
      }),
    ]);
    for (const c of codes) out.set(c.accountId, { state: 'code_waiting', code: c.relayCode, issuedAt: c.createdAt.toISOString() });
    for (const c of credentials) out.set(c.accountId, { state: 'signed_up' });
    return out;
  }

  /** Children just placed or added join the family's live group, after their own transaction (best effort, said in the answer). */
  private async joinGroup(s: Standing, familyId: string, learnerIds: string[]): Promise<'joined' | 'none' | 'not_joined'> {
    if (learnerIds.length === 0) return 'none';
    try {
      const joined = await this.conversations.addLearnersToFamilyGroup(s.actor.actorId, { familyId, learnerIds });
      if (!joined) return 'none';
      // The enrolments that listed these children now name the group they are in.
      await this.prisma.$executeRaw`
        UPDATE chat.student_enrolment
           SET group_conversation_id = ${joined.conversationId}::uuid, group_created_by = ${s.actor.actorId}::uuid
         WHERE family_id = ${familyId}::uuid AND group_conversation_id IS NULL AND learner_ids && ${learnerIds}::uuid[]`;
      return 'joined';
    } catch (e) {
      this.log.warn(`family ${familyId}: children not added to the family group: ${e instanceof Error ? e.message : String(e)}`);
      return 'not_joined';
    }
  }

  /**
   * The Operations supervisors a family may go to. To PLACE it: the Operations
   * manager's own department's (the super admin: every one); to SUGGEST one:
   * every one of the academy.
   */
  private async operationsSupervisors(s: Standing, purpose: 'place' | 'suggest') {
    const own = purpose === 'place' && s.standing !== 'super_admin' ? s.actor.actorId : null;
    return this.prisma.$queryRaw<Array<{ id: string; name: string }>>`
      SELECT DISTINCT st.id::text AS id, st.name
        FROM chat.staff st
        JOIN chat.department_member m ON m.staff_id = st.id AND m.position = 'supervisor'
        JOIN chat.department d ON d.id = m.department_id AND d.kind = 'operations'
       WHERE st.organization_id = ${s.org}::uuid AND st.is_active AND st.left_at IS NULL
         AND (${own}::uuid IS NULL OR d.manager_id = ${own}::uuid)
       ORDER BY name, id`;
  }

  private async isOperationsSupervisor(s: Standing, staffId: string, purpose: 'place' | 'suggest'): Promise<boolean> {
    return (await this.operationsSupervisors(s, purpose)).some((x) => x.id === staffId);
  }

  private async salesStaff(org: string) {
    return this.prisma.$queryRaw<Array<{ id: string; name: string }>>`
      SELECT st.id::text AS id, st.name
        FROM chat.staff st
       WHERE st.organization_id = ${org}::uuid AND st.is_active AND st.left_at IS NULL
         AND chat.sales_department_role(st.id) IS NOT NULL
       ORDER BY st.name, st.id`;
  }

  // ------------------------------------------------------------------

  /** Who the caller is, for PD-42; refused before any lookup when they enter nothing. */
  private async standing(actorId: string): Promise<Standing> {
    const actor = await this.conversations.requireActor(actorId);
    if (actor.kind !== ActorKind.STAFF || !actor.isActive || !actor.organizationId) {
      throw new CommError(CommErrorCode.INTAKE_DENIED, 'families are entered by Sales and Operations supervisors and their managers');
    }
    const [row] = await this.prisma.$queryRaw<Array<{
      role: string; may: boolean; ops_manager: boolean; sales: string | null; ops_supervisor: boolean; grantor: boolean;
    }>>`
      SELECT s.role,
             chat.staff_has_permission(s.id, 'new_students.manage') AS may,
             chat.is_operations_manager(s.id, s.organization_id) AS ops_manager,
             chat.sales_department_role(s.id) AS sales,
             EXISTS (SELECT 1 FROM chat.department_member m JOIN chat.department d ON d.id = m.department_id
                      WHERE m.staff_id = s.id AND d.kind = 'operations' AND m.position = 'supervisor') AS ops_supervisor,
             chat.can_grant_subscription_exception(s.id) AS grantor
        FROM chat.staff s
       WHERE s.id = ${actor.actorId}::uuid AND s.organization_id = ${actor.organizationId}::uuid
         AND s.is_active AND s.left_at IS NULL`;
    const standing: IntakeStanding | null = !row || !row.may ? null
      : row.role === 'super_admin' ? 'super_admin'
      : row.ops_manager && row.role === 'manager' ? 'operations_manager'
      : row.sales === 'manager' ? 'sales_manager'
      : row.ops_supervisor && (row.role === 'admin' || row.role === 'coverage') ? 'operations_supervisor'
      : row.sales === 'member' ? 'sales_member'
      : null;
    if (!standing) throw new CommError(CommErrorCode.INTAKE_DENIED, 'families are entered by Sales and Operations supervisors and their managers');
    return { actor, org: actor.organizationId, standing, manager: row!.grantor };
  }

  private async ownership(s: Standing, onBehalfOf: string | null): Promise<Ownership> {
    const self = s.actor.actorId;
    if (s.standing === 'operations_supervisor' || s.standing === 'sales_member') {
      if (onBehalfOf && onBehalfOf !== self) throw new CommError(CommErrorCode.INTAKE_DENIED, 'a supervisor enters their own families; their manager enters for them');
      return s.standing === 'operations_supervisor'
        ? { supervisorId: self, salesOwnerId: null, onBehalfOf: null }
        : { supervisorId: null, salesOwnerId: self, onBehalfOf: null };
    }
    if (!onBehalfOf) {
      if ((await this.enterableFor(s)).length === 0) {
        throw new CommError(CommErrorCode.INTAKE_INVALID, 'a family belongs to a supervisor of your department, and it has none yet: add one first', 400);
      }
      throw new CommError(CommErrorCode.INTAKE_INVALID, 'onBehalfOf: a manager names the supervisor the family belongs to', 400);
    }
    const [t] = await this.prisma.$queryRaw<Array<{ ops: boolean; sales: string | null }>>`
      SELECT EXISTS (SELECT 1 FROM chat.department_member m JOIN chat.department d ON d.id = m.department_id
                      WHERE m.staff_id = st.id AND d.kind = 'operations' AND m.position = 'supervisor') AS ops,
             chat.sales_department_role(st.id) AS sales
        FROM chat.staff st
       WHERE st.id = ${onBehalfOf}::uuid AND st.organization_id = ${s.org}::uuid AND st.is_active AND st.left_at IS NULL`;
    if (t?.ops && s.standing !== 'sales_manager') return { supervisorId: onBehalfOf, salesOwnerId: null, onBehalfOf };
    if (t?.sales === 'member' && s.standing !== 'operations_manager') return { supervisorId: null, salesOwnerId: onBehalfOf, onBehalfOf };
    throw new CommError(CommErrorCode.INTAKE_INVALID, 'onBehalfOf: one of your department\'s supervisors', 400);
  }

  /** F1: completed above a package is a manager's own, confirmed entry. */
  private requireOverConfirmed(s: Standing, children: IntakeChild[], confirmOver: boolean) {
    const over = children.some((c) => c.carriedOver && c.carriedOver.completed > c.carriedOver.total);
    if (over && (!s.manager || !confirmOver)) {
      throw new CommError(
        CommErrorCode.INTAKE_INVALID,
        'completed lessons above the package are entered and confirmed by the super admin, the Operations Manager or the Sales Manager',
        400,
      );
    }
  }

  private async requireTeacher(org: string, teacherId: string) {
    const ok = await this.prisma.teacher.count({ where: { id: teacherId, organizationId: org, isActive: true, leftAt: null } });
    if (!ok) throw new CommError(CommErrorCode.INTAKE_INVALID, 'teacherId: an active teacher of this academy', 400);
  }

  private parentContact(org: string, familyId: string, name: string, accountId: string | null) {
    return {
      organizationId: org, familyId, name, relationship: 'parent', rolePreset: 'primary_guardian',
      canMessage: true, canViewProgress: true, canManageSchedule: true, canManageBilling: true,
      canManageContacts: true, canCancel: true, accountId, isActive: true,
    };
  }

  private async createChildren(tx: Tx, s: Standing, familyId: string, supervisorId: string | null, children: IntakeChild[]) {
    const out: Array<{ id: string; child: IntakeChild }> = [];
    for (const child of children) {
      const [{ id }] = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT chat.enrol_learner(${familyId}::uuid, ${child.name}, ${child.teacherId}::uuid, ${s.actor.actorId}::uuid)::text AS id`;
      if (supervisorId) {
        await tx.learnerSupervision.create({
          data: { learnerId: id, organizationId: s.org, supervisorId, assignedBy: s.actor.actorId, reason: 'entered by hand (PD-42)' },
        });
        await this.audit.audit(tx, {
          actorId: s.actor.actorId, action: 'learner.supervisor_assigned', entity: 'learner', entityId: id,
          after: { supervisorId }, reason: 'entered by hand (PD-42)',
        });
      }
      const courseId = child.course ? await courseNamed(tx, this.audit, s.org, s.actor.actorId, child.course, 'course named when a family was entered') : null;
      if (courseId || child.age !== null || child.birthDate) {
        await tx.learnerEnrollment.create({
          data: {
            learnerId: id, organizationId: s.org, courseId,
            ...(child.birthDate ? { birthDate: new Date(`${child.birthDate}T00:00:00Z`) } : {}),
            ...(child.age !== null && !child.birthDate ? { statedAge: child.age, statedAgeOn: todayUtc() } : {}),
            updatedBy: s.actor.actorId,
          },
        });
      }
      out.push({ id, child });
    }
    return out;
  }

  private async carryOverAll(tx: Tx, s: Standing, learners: Array<{ id: string; child: IntakeChild }>) {
    for (const { id, child } of learners) {
      if (!child.carriedOver) continue;
      await this.insertCarriedOver(tx, s, id, child.carriedOver);
      await this.audit.audit(tx, {
        actorId: s.actor.actorId, action: 'subscription.carried_over', entity: 'learner', entityId: id,
        after: { total: child.carriedOver.total, completed: child.carriedOver.completed, planMonths: child.carriedOver.planMonths },
        reason: 'package carried over from Jawwid Core (PD-42)',
      });
    }
  }

  /** The row PD-30 counts: starting on the child's intake day; the database checks the five conditions. */
  private async insertCarriedOver(tx: Tx, s: Standing, learnerId: string, pkg: CarriedOverInput) {
    const over = pkg.completed > pkg.total ? s.actor.actorId : null;
    await tx.$executeRaw`
      INSERT INTO chat.learner_subscription (learner_id, organization_id, family_id, plan_months, lessons_included,
             lessons_used_before, over_confirmed_by, starts_on, source, created_by)
      SELECT l.id, l.organization_id, l.family_id, ${pkg.planMonths}::smallint, ${pkg.total}::int, ${pkg.completed}::int,
             ${over}::uuid,
             coalesce((SELECT (i.entered_at AT TIME ZONE chat.pd030_zone())::date FROM chat.learner_intake i WHERE i.learner_id = l.id),
                      chat.pd030_today()),
             'carried_over', ${s.actor.actorId}::uuid
        FROM chat.learner l WHERE l.id = ${learnerId}::uuid`;
  }

  /** The weekly times, after the transaction, where the teacher is free (best effort, as PD-16). */
  private async schedule(s: Standing, learners: Array<{ id: string; child: IntakeChild }>) {
    const out: Array<{ learnerId: string; set: boolean; reason: string | null }> = [];
    for (const { id, child } of learners) {
      if (child.schedule.length === 0) continue;
      try {
        const learner = await this.prisma.learner.findUniqueOrThrow({ where: { id } });
        const slots = child.schedule.map((x) => ({ weekday: x.weekday, startMinute: minuteOf(x.time), durationMinutes: child.durationMinutes }));
        await this.scheduling.applySchedule(s.actor, learner, slots, null, null);
        out.push({ learnerId: id, set: true, reason: null });
      } catch (e) {
        const reason = e instanceof CommError ? e.message : 'the weekly times could not be set';
        this.log.warn(`learner ${id}: weekly times not set: ${reason}`);
        out.push({ learnerId: id, set: false, reason });
      }
    }
    return out;
  }

  private async lock(tx: Tx, keys: string[]) {
    for (const key of [...new Set(keys)].sort()) {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`pd042:${key}`}, 0))`;
    }
  }

  /**
   * S1: the same intake id again. The same caller sending the same thing (the
   * same payload hash, for the same family) gets what the first wrote; any other
   * use of the id is refused.
   */
  private async replay(tx: Tx, s: Standing, intakeId: string, hash: string, familyId: string | null) {
    const done = await tx.studentEnrolment.findUnique({ where: { id: intakeId } });
    if (!done) return null;
    if (
      done.assignedBy !== s.actor.actorId || done.organizationId !== s.org || done.origin !== 'intake'
      || done.intakePayloadHash !== hash || (familyId !== null && done.familyId !== familyId)
    ) {
      throw new CommError(CommErrorCode.INTAKE_STATE, 'this intake id was already used', 409);
    }
    return {
      replay: true as const,
      result: {
        enrolmentId: done.id, familyId: done.familyId, contactId: done.contactId, learnerIds: done.learnerIds,
        supervision: null, schedules: [], replay: true,
      },
    };
  }

  /**
   * S1: the parent is already in Chat -- their e-mail is an account, or their
   * e-mail or number is a contact key of the academy. One answer for every case
   * the caller may not act on (another supervisor's family, a staff or teacher
   * login): it says nothing more. The family is named only to a caller who OWNS
   * it, so "add the children here" is offered only where they may add them.
   */
  private async refuseExistingParent(tx: Tx, s: Standing, email: string | null, hashes: string[]) {
    let familyId: string | null = null;
    if (email) {
      const account = await tx.account.findUnique({ where: { subject: email }, select: { id: true, kind: true } });
      if (account && account.kind !== 'family') throw unavailable();
      if (account) {
        const contact = await tx.contact.findFirst({ where: { accountId: account.id, organizationId: s.org }, select: { familyId: true } });
        familyId = contact?.familyId ?? null;
        if (!familyId) throw unavailable();
      }
    }
    if (!familyId && hashes.length > 0) {
      const key = await tx.familyContactKey.findFirst({ where: { organizationId: s.org, keyHash: { in: hashes } }, select: { familyId: true } });
      familyId = key?.familyId ?? null;
    }
    if (!familyId) return;
    const [{ owns }] = await tx.$queryRaw<Array<{ owns: boolean }>>`
      SELECT chat.staff_owns_family(${s.actor.actorId}::uuid, ${familyId}::uuid) AS owns`;
    if (!owns) throw unavailable();
    const family = await tx.family.findUnique({ where: { id: familyId }, select: { id: true, primaryContactId: true, displayName: true } });
    throw new CommError(CommErrorCode.PARENT_EXISTS, 'this parent is already in Chat; add the children to their family', 409, {
      familyId, contactId: family?.primaryContactId ?? null, parentName: family?.displayName ?? null,
    });
  }

  /** The intake waits for every existing family's parents to be keyed (review of #202, P1-2). */
  private async ready(): Promise<boolean> {
    const [row] = await this.prisma.$queryRaw<Array<{ ready: boolean }>>`
      SELECT coalesce((SELECT value = 'true'::jsonb FROM chat.config WHERE key = 'intake.contact_keys_ready'), false) AS ready`;
    return row?.ready === true;
  }

  private async requireReady() {
    if (!(await this.ready())) {
      throw new CommError(CommErrorCode.INTAKE_NOT_READY, 'entering families opens once every existing family\'s parents are keyed (family-contact-keys-backfill)', 409);
    }
  }

  /** A family the caller owns; with its primary parent unless `parent: 'optional'` (a child's own reads). */
  private async requireOwnFamily(s: Standing, familyId: string, parent: 'required' | 'optional' = 'required') {
    if (!isUuid(familyId)) throw notFound();
    const [row] = await this.prisma.$queryRaw<Array<{ id: string; contact_id: string | null; account_id: string | null; owns: boolean }>>`
      SELECT f.id::text AS id, f.primary_contact_id::text AS contact_id, c.account_id::text AS account_id,
             chat.staff_owns_family(${s.actor.actorId}::uuid, f.id) AS owns
        FROM chat.family f LEFT JOIN chat.contact c ON c.id = f.primary_contact_id
       WHERE f.id = ${familyId.toLowerCase()}::uuid AND f.organization_id = ${s.org}::uuid`;
    if (!row || !row.owns || (parent === 'required' && !row.contact_id)) throw notFound();
    // contactId is set whenever the parent is required; the 'optional' callers do not read it.
    return { id: row.id, contactId: row.contact_id as string, accountId: row.account_id };
  }

  private async requireOwnLearner(s: Standing, learnerId: string) {
    if (!isUuid(learnerId)) throw notFound();
    const learner = await this.prisma.learner.findFirst({ where: { id: learnerId.toLowerCase(), organizationId: s.org }, select: { id: true, familyId: true } });
    if (!learner) throw notFound();
    // A child's package needs no parent record (families from before PD-16 may have none).
    await this.requireOwnFamily(s, learner.familyId, 'optional');
    return learner;
  }

  /** One transaction, with the database's refusals answered in words. */
  private async write<T>(s: Standing, fn: (tx: Tx) => Promise<T>): Promise<T> {
    // The refusal is answered here, inside LessonService.write, which would
    // otherwise turn every check_violation into a lesson's LESSON_STATE.
    return this.lessons.write(async () => {
      try {
        return await this.prisma.$transaction(async (tx) => {
          await this.conversations.assertActorLive(tx, s.actor);
          return fn(tx);
        });
      } catch (e) {
        throw dbRefusal(e);
      }
    });
  }
}

/**
 * A refusal raised by the database (a guard of 20261028110000 / 20261028210000)
 * becomes an answer with its words. Anything else is rethrown untouched.
 */
export function dbRefusal(e: unknown): unknown {
  if (e instanceof CommError) return e;
  if (!(e instanceof Prisma.PrismaClientKnownRequestError) && !(e instanceof Prisma.PrismaClientUnknownRequestError)) return e;
  const meta = (e as { meta?: { code?: string; message?: string } }).meta;
  const raw = String(meta?.message ?? e.message);
  const sqlstate = meta?.code ?? (/\b(42501|23514|23505)\b/.exec(raw)?.[1] ?? '');
  const words = (/ERROR:\s*([^\n`]+)/.exec(raw)?.[1] ?? raw).trim();
  if (/already in Chat/.test(raw)) return unavailable();
  if (sqlstate === '42501' || /insufficient_privilege/.test(raw)) return new CommError(CommErrorCode.INTAKE_DENIED, words);
  if (sqlstate === '23514' || /check_violation|violates check constraint/.test(raw)) return new CommError(CommErrorCode.INTAKE_INVALID, words, 400);
  if (sqlstate === '23505') return new CommError(CommErrorCode.INTAKE_STATE, 'this was entered at the same moment by someone else; reload', 409);
  return e;
}

/** The one answer for a parent the caller may not act on (S1): nothing more is said. */
function unavailable() {
  return new CommError(CommErrorCode.PARENT_EXISTS, 'this e-mail or number cannot be used here; ask your manager', 409);
}

/** What an intake asked for, as a hash: a replay must ask for the same thing. */
export function payloadHash(payload: unknown): string {
  return createHash('sha256').update(JSON.stringify(payload)).digest('hex');
}

function notFound() {
  return new CommError(CommErrorCode.INTAKE_NOT_FOUND, 'family not found', 404);
}

/** A manager enters a family for one of their supervisors (D5); they never own it themself. */
function isManager(s: Standing): boolean {
  return s.standing === 'operations_manager' || s.standing === 'sales_manager' || s.standing === 'super_admin';
}

/** A required id in the body, as a lower-case uuid. */
function uuidField(body: unknown, name: string): string {
  const raw = (typeof body === 'object' && body !== null ? (body as Record<string, unknown>)[name] : undefined);
  if (typeof raw !== 'string' || !isUuid(raw)) throw new CommError(CommErrorCode.INTAKE_INVALID, `${name}: required`, 400);
  return raw.toLowerCase();
}

function todayUtc(): Date {
  return new Date(`${new Date().toISOString().slice(0, 10)}T00:00:00Z`);
}
