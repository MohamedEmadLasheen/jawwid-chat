import { Inject, Injectable, Optional } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../platform/prisma.service';
import { AuthorizationService } from '../platform/authorization.service';
import { CommError, CommErrorCode } from '../platform/errors';
import { AUDIT_SERVICE, REALTIME_REVOCATION } from '../platform/tokens';
import type { AuditService } from '../platform/audit.service';
import { NO_REALTIME_REVOCATION, type RealtimeRevocation } from '../platform/realtime-revocation';
import { isConversationStaff, type Actor } from '../platform/types';
import { ConversationService, isUuid } from '../communication/conversations/conversation.service';
import { StaffRole } from '../communication/contracts/vocab';

export const DepartmentKind = { OPERATIONS: 'operations', TEACHERS: 'teachers', SALES: 'sales' } as const;
const DEPARTMENT_KINDS: ReadonlySet<string> = new Set(Object.values(DepartmentKind));
export const DepartmentPosition = { SUPERVISOR: 'supervisor', BACKUP_SUPERVISOR: 'backup_supervisor' } as const;
const POSITIONS: ReadonlySet<string> = new Set(Object.values(DepartmentPosition));

/** The longest a single backup activation may run before someone renews it. */
const MAX_ACTIVATION_DAYS = 90;

export type BackupStatus = 'dormant' | 'active' | 'expired' | 'deactivated' | 'ended';

type SupervisedRow = { learner_id: string; supervisor_id: string };

/**
 * PD-8: the organization structure -- departments, who supervises which child,
 * and backup links -- and the ONLY writer of those tables.
 *
 * Every change is decided by AuthorizationService (who may change it), checked
 * again by the database triggers of 20261015120000 (whether the result is a
 * lawful shape), and audited in the same transaction. A change that can reduce
 * somebody's access (a child moving away, a backup ending) is not reported
 * complete until the realtime completion barrier confirms no node can still
 * deliver on a decision made before it (RT-009).
 */
@Injectable()
export class OrgStructureService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly authz: AuthorizationService,
    private readonly conversations: ConversationService,
    @Inject(AUDIT_SERVICE) private readonly audit: AuditService,
    @Optional()
    @Inject(REALTIME_REVOCATION)
    private readonly revocation: RealtimeRevocation = NO_REALTIME_REVOCATION,
  ) {}

  // ------------------------------------------------------------------
  // Reading
  // ------------------------------------------------------------------

  /**
   * Departments with their manager, supervisors and backup links. The super
   * admin sees the whole organization; a manager sees the department they run.
   */
  async structure(actorId: string) {
    const actor = await this.conversations.requireActor(actorId);
    const gate = this.authz.canViewOrgStructure(actor);
    if (!gate.allowed) throw new CommError(gate.code, gate.reason);
    const org = actor.organizationId as string;

    const departments = await this.prisma.department.findMany({
      where: {
        organizationId: org,
        ...(actor.staffRole === StaffRole.SUPER_ADMIN ? {} : { managerId: actor.actorId }),
      },
      include: { members: true },
      orderBy: { kind: 'asc' },
    });
    const staffIds = new Set<string>();
    for (const d of departments) {
      if (d.managerId) staffIds.add(d.managerId);
      for (const m of d.members) staffIds.add(m.staffId);
    }
    const staff = await this.prisma.staff.findMany({
      where: { id: { in: [...staffIds] }, organizationId: org },
      select: { id: true, name: true, role: true, isActive: true, leftAt: true },
    });
    const byId = new Map(staff.map((s) => [s.id, s]));
    const counts = await this.prisma.learnerSupervision.groupBy({
      by: ['supervisorId'],
      where: { organizationId: org, supervisorId: { in: [...staffIds] } },
      _count: { _all: true },
    });
    const learnerCount = new Map(counts.map((c) => [c.supervisorId, c._count._all]));
    const memberIds = departments.flatMap((d) => d.members.map((m) => m.staffId));
    const backups = await this.prisma.supervisorBackup.findMany({
      where: { organizationId: org, endedAt: null, primaryId: { in: memberIds } },
      orderBy: { createdAt: 'asc' },
    });
    const now = new Date();
    const person = (id: string | null) => {
      if (!id) return null;
      const s = byId.get(id);
      return s ? { id: s.id, name: s.name, role: s.role, isActive: s.isActive && s.leftAt === null } : { id, name: '', role: '', isActive: false };
    };

    return {
      departments: departments.map((d) => ({
        id: d.id,
        kind: d.kind,
        displayName: d.displayName,
        manager: person(d.managerId),
        members: d.members
          .map((m) => ({
            ...person(m.staffId),
            position: m.position,
            learnerCount: learnerCount.get(m.staffId) ?? 0,
          }))
          .sort((a, b) => a.position.localeCompare(b.position) || (a.name ?? '').localeCompare(b.name ?? '')),
        backups: backups
          .filter((b) => d.members.some((m) => m.staffId === b.primaryId))
          .map((b) => ({
            id: b.id,
            primary: person(b.primaryId),
            backup: person(b.backupId),
            status: backupStatus(b, now),
            activatedAt: b.activatedAt,
            activeUntil: b.activeUntil,
          })),
      })),
    };
  }

  /**
   * Children with their family, teacher and supervisor, as far as the actor
   * manages them: the super admin, every child; a manager, the children of
   * their department's supervisors -- and, for the Operations Manager, the
   * children nobody supervises yet (the ones waiting to be assigned).
   */
  async learners(actorId: string, filter: { supervisorId?: string; unassigned?: boolean } = {}) {
    const actor = await this.conversations.requireActor(actorId);
    const gate = this.authz.canViewOrgStructure(actor);
    if (!gate.allowed) throw new CommError(gate.code, gate.reason);
    const org = actor.organizationId as string;
    if (filter.supervisorId !== undefined && !isUuid(filter.supervisorId)) {
      throw new CommError(CommErrorCode.VALIDATION, 'supervisorId: must be a uuid', 400);
    }

    let where: Prisma.LearnerWhereInput = { organizationId: org };
    if (actor.staffRole !== StaffRole.SUPER_ADMIN) {
      const dept = await this.prisma.department.findFirst({
        where: { organizationId: org, managerId: actor.actorId },
        include: { members: { select: { staffId: true } } },
      });
      if (!dept) return { learners: [] };
      const supervised = await this.prisma.learnerSupervision.findMany({
        where: { organizationId: org, supervisorId: { in: dept.members.map((m) => m.staffId) } },
        select: { learnerId: true },
      });
      const unassigned =
        dept.kind === DepartmentKind.OPERATIONS
          ? (
              await this.prisma.$queryRaw<Array<{ id: string }>>`
                SELECT l.id::text AS id FROM chat.learner l
                 WHERE l.organization_id = ${org}::uuid
                   AND NOT EXISTS (SELECT 1 FROM chat.learner_supervision ls WHERE ls.learner_id = l.id)`
            ).map((r) => r.id)
          : [];
      where = { organizationId: org, id: { in: [...supervised.map((r) => r.learnerId), ...unassigned] } };
    }

    const rows = await this.prisma.learner.findMany({
      where,
      include: { family: { select: { id: true, displayName: true } }, teacher: { select: { id: true, name: true } } },
      orderBy: [{ familyId: 'asc' }, { name: 'asc' }],
      take: 2000,
    });
    const supervision = await this.prisma.learnerSupervision.findMany({
      where: { learnerId: { in: rows.map((r) => r.id) } },
    });
    const supervisorOf = new Map(supervision.map((r) => [r.learnerId, r.supervisorId]));
    const supervisors = await this.prisma.staff.findMany({
      where: { id: { in: [...new Set(supervision.map((r) => r.supervisorId))] } },
      select: { id: true, name: true },
    });
    const nameOf = new Map(supervisors.map((s) => [s.id, s.name]));

    return {
      learners: rows
        .map((l) => {
          const supervisorId = supervisorOf.get(l.id) ?? null;
          return {
            learnerId: l.id,
            name: l.name,
            family: { id: l.family.id, displayName: l.family.displayName },
            teacher: l.teacher ? { id: l.teacher.id, name: l.teacher.name } : null,
            supervisor: supervisorId ? { id: supervisorId, name: nameOf.get(supervisorId) ?? '' } : null,
          };
        })
        .filter((l) => {
          if (filter.unassigned) return l.supervisor === null;
          if (filter.supervisorId) return l.supervisor?.id === filter.supervisorId;
          return true;
        }),
    };
  }

  /**
   * What a staff member may put in a family group: the families whose children
   * they act for (their own, an ACTIVE backup's primary's, their department's,
   * or -- the super admin -- every one), each with its messaging parents and
   * each child's supervisor and teacher. The same principals chat.staff_principals
   * gives the conversation scope, so the picker never offers a child the
   * creation request would refuse (POST /conversations/family-group re-checks
   * everything anyway).
   */
  async groupCandidates(actorId: string) {
    const actor = await this.conversations.requireActor(actorId);
    if (!isConversationStaff(actor) || !actor.isActive || !actor.organizationId) {
      throw new CommError(CommErrorCode.CANNOT_PROVISION_STUDENT_GROUP, 'only Jawwid staff create family groups');
    }
    const org = actor.organizationId;
    const now = new Date();
    const rows =
      actor.staffRole === StaffRole.SUPER_ADMIN
        ? await this.prisma.$queryRaw<SupervisedRow[]>`
            SELECT ls.learner_id::text AS learner_id, ls.supervisor_id::text AS supervisor_id
              FROM chat.learner_supervision ls WHERE ls.organization_id = ${org}::uuid`
        : await this.prisma.$queryRaw<SupervisedRow[]>`
            SELECT ls.learner_id::text AS learner_id, ls.supervisor_id::text AS supervisor_id
              FROM chat.learner_supervision ls
             WHERE ls.organization_id = ${org}::uuid
               AND ls.supervisor_id IN (SELECT chat.staff_principals(${actor.actorId}::uuid, ${now}::timestamptz))`;
    if (rows.length === 0) return { families: [] };

    const supervisorOf = new Map(rows.map((r) => [r.learner_id, r.supervisor_id]));
    const learners = await this.prisma.learner.findMany({
      where: { id: { in: rows.map((r) => r.learner_id) }, organizationId: org },
      include: { family: { select: { id: true, displayName: true } }, teacher: { select: { id: true, name: true, isActive: true, leftAt: true } } },
      orderBy: [{ familyId: 'asc' }, { name: 'asc' }],
    });
    const familyIds = [...new Set(learners.map((l) => l.familyId))];
    const contacts = await this.prisma.contact.findMany({
      where: { familyId: { in: familyIds }, organizationId: org, isActive: true, canMessage: true },
      select: { id: true, name: true, familyId: true },
      orderBy: { name: 'asc' },
    });
    const supervisors = await this.prisma.staff.findMany({
      where: { id: { in: [...new Set(rows.map((r) => r.supervisor_id))] } },
      select: { id: true, name: true },
    });
    const nameOf = new Map(supervisors.map((x) => [x.id, x.name]));

    const families = new Map<string, {
      familyId: string;
      displayName: string;
      parents: Array<{ id: string; name: string }>;
      children: Array<{
        id: string;
        name: string;
        supervisor: { id: string; name: string };
        teacher: { id: string; name: string } | null;
      }>;
    }>();
    for (const l of learners) {
      const f = families.get(l.familyId) ?? {
        familyId: l.familyId,
        displayName: l.family.displayName,
        parents: contacts.filter((c) => c.familyId === l.familyId).map((c) => ({ id: c.id, name: c.name })),
        children: [],
      };
      const supervisorId = supervisorOf.get(l.id)!;
      f.children.push({
        id: l.id,
        name: l.name,
        supervisor: { id: supervisorId, name: nameOf.get(supervisorId) ?? '' },
        // Only an active teacher can be seated (the creation request refuses others).
        teacher: l.teacher && l.teacher.isActive && l.teacher.leftAt === null ? { id: l.teacher.id, name: l.teacher.name } : null,
      });
      families.set(l.familyId, f);
    }
    return { families: [...families.values()].sort((a, b) => a.displayName.localeCompare(b.displayName)) };
  }

  // ------------------------------------------------------------------
  // Departments (super admin)
  // ------------------------------------------------------------------

  async upsertDepartment(actorId: string, body: { kind?: unknown; displayName?: unknown; managerId?: unknown; reason?: unknown }) {
    const actor = await this.conversations.requireActor(actorId);
    const org = this.requireOrg(actor);
    const gate = this.authz.canManageDepartments(actor, { organizationId: org });
    if (!gate.allowed) throw new CommError(gate.code, gate.reason);
    if (typeof body.kind !== 'string' || !DEPARTMENT_KINDS.has(body.kind)) {
      throw invalid('kind', "must be 'operations', 'teachers' or 'sales'");
    }
    const displayName = requireText('displayName', body.displayName, 120);
    const managerId = optionalUuid('managerId', body.managerId);
    const reason = requireText('reason', body.reason, 500);
    const kind = body.kind;

    return this.write(async (tx) => {
      await this.conversations.assertActorLive(tx, actor);
      const before = await tx.department.findUnique({ where: { organizationId_kind: { organizationId: org, kind } } });
      const dept = await tx.department.upsert({
        where: { organizationId_kind: { organizationId: org, kind } },
        create: { organizationId: org, kind, displayName, managerId },
        update: { displayName, managerId },
      });
      await this.audit.audit(tx, {
        actorId: actor.actorId,
        action: before ? 'department.updated' : 'department.created',
        entity: 'department',
        entityId: dept.id,
        before: before ? { displayName: before.displayName, managerId: before.managerId } : undefined,
        after: { kind, displayName, managerId },
        reason,
      });
      return dept;
    }, true);
  }

  async setDepartmentMember(
    actorId: string,
    departmentId: string,
    body: { staffId?: unknown; position?: unknown; reason?: unknown },
  ) {
    const actor = await this.conversations.requireActor(actorId);
    const org = this.requireOrg(actor);
    const gate = this.authz.canManageDepartments(actor, { organizationId: org });
    if (!gate.allowed) throw new CommError(gate.code, gate.reason);
    if (!isUuid(departmentId)) throw notFound('department');
    const staffId = requireUuid('staffId', body.staffId);
    if (typeof body.position !== 'string' || !POSITIONS.has(body.position)) {
      throw invalid('position', "must be 'supervisor' or 'backup_supervisor'");
    }
    const position = body.position;
    const reason = requireText('reason', body.reason, 500);

    const dept = await this.prisma.department.findUnique({ where: { id: departmentId } });
    if (!dept || dept.organizationId !== org) throw notFound('department');

    return this.write(async (tx) => {
      await this.conversations.assertActorLive(tx, actor);
      const before = await tx.departmentMember.findUnique({ where: { staffId } });
      if (before && (before.departmentId !== departmentId || before.position !== position)) {
        // A supervisor who changes department or position is no longer the
        // arrangement their backup links were made for.
        await this.endLinksOf(tx, actor, staffId, 'department membership changed');
      }
      const row = await tx.departmentMember.upsert({
        where: { staffId },
        create: { staffId, organizationId: org, departmentId, position, assignedBy: actor.actorId },
        update: { departmentId, position, assignedBy: actor.actorId, assignedAt: new Date() },
      });
      await this.audit.audit(tx, {
        actorId: actor.actorId,
        action: 'department.member_set',
        entity: 'staff',
        entityId: staffId,
        before: before ? { departmentId: before.departmentId, position: before.position } : undefined,
        after: { departmentId, position },
        reason,
      });
      return row;
    }, true);
  }

  async removeDepartmentMember(actorId: string, staffId: string, body: { reason?: unknown }) {
    const actor = await this.conversations.requireActor(actorId);
    const org = this.requireOrg(actor);
    const gate = this.authz.canManageDepartments(actor, { organizationId: org });
    if (!gate.allowed) throw new CommError(gate.code, gate.reason);
    if (!isUuid(staffId)) throw notFound('department member');
    const reason = requireText('reason', body.reason, 500);
    const before = await this.prisma.departmentMember.findUnique({ where: { staffId } });
    if (!before || before.organizationId !== org) throw notFound('department member');

    await this.write(async (tx) => {
      await this.conversations.assertActorLive(tx, actor);
      await this.endLinksOf(tx, actor, staffId, 'removed from department');
      await tx.departmentMember.delete({ where: { staffId } });
      await this.audit.audit(tx, {
        actorId: actor.actorId,
        action: 'department.member_removed',
        entity: 'staff',
        entityId: staffId,
        before: { departmentId: before.departmentId, position: before.position },
        reason,
      });
    }, true);
    return { removed: true };
  }

  // ------------------------------------------------------------------
  // Per-learner supervision (Operations Manager / super admin)
  // ------------------------------------------------------------------

  /**
   * Assign (or reassign) a child to a supervisor. Reassignment moves the
   * child's groups with the child (ConversationService.reconcileSupervisionChange)
   * in the same transaction, and every other conversation's scope follows by
   * itself because it is computed from this row at each read.
   */
  async assignSupervisor(actorId: string, learnerId: string, body: { supervisorId?: unknown; reason?: unknown }) {
    const actor = await this.conversations.requireActor(actorId);
    const org = this.requireOrg(actor);
    if (!isUuid(learnerId)) throw notFound('learner');
    const supervisorId = requireUuid('supervisorId', body.supervisorId);
    const reason = requireText('reason', body.reason, 500);

    const learner = await this.prisma.learner.findUnique({ where: { id: learnerId } });
    if (!learner || learner.organizationId !== org) throw notFound('learner');
    const supervisor = await this.prisma.staff.findUnique({ where: { id: supervisorId } });
    if (!supervisor || supervisor.organizationId !== org) throw notFound('supervisor');

    const now = new Date();
    const current = await this.prisma.learnerSupervision.findUnique({ where: { learnerId } });
    const decision = this.authz.canAssignSupervision(actor, {
      organizationId: org,
      actsForNew: await this.authz.actsFor(actor, supervisorId, now),
      currentSupervisorId: current?.supervisorId ?? null,
      actsForCurrent: current ? await this.authz.actsFor(actor, current.supervisorId, now) : null,
    });
    if (!decision.allowed) throw new CommError(decision.code, decision.reason);
    if (current?.supervisorId === supervisorId) {
      return { learnerId, supervisorId, changed: false };
    }

    const evictions = await this.write(async (tx) => {
      await this.conversations.assertActorLive(tx, actor);
      await tx.learnerSupervision.upsert({
        where: { learnerId },
        create: { learnerId, organizationId: org, supervisorId, assignedBy: actor.actorId, reason },
        update: { supervisorId, assignedBy: actor.actorId, assignedAt: new Date(), reason },
      });
      const removed = await this.conversations.reconcileSupervisionChange(
        tx,
        learnerId,
        current?.supervisorId ?? null,
        supervisorId,
        actor.actorId,
      );
      await this.audit.audit(tx, {
        actorId: actor.actorId,
        action: current ? 'learner.supervisor_reassigned' : 'learner.supervisor_assigned',
        entity: 'learner',
        entityId: learnerId,
        before: current ? { supervisorId: current.supervisorId } : undefined,
        after: { supervisorId },
        reason,
      });
      return removed;
    });

    // RT-009: the previous supervisor's sockets leave the rooms they were
    // removed from, and the change is not reported complete until no node can
    // still deliver on a decision made before it.
    for (const e of evictions) {
      if (e.removed.length) this.revocation.leaveConversation(e.removed, e.conversationId);
    }
    if (current) await this.revocation.confirmRevoked();
    return { learnerId, supervisorId, changed: true };
  }

  // ------------------------------------------------------------------
  // Backup supervisors
  // ------------------------------------------------------------------

  /** A dormant link: it grants nothing until activated. */
  async createBackup(actorId: string, body: { primaryId?: unknown; backupId?: unknown; reason?: unknown }) {
    const actor = await this.conversations.requireActor(actorId);
    const org = this.requireOrg(actor);
    const primaryId = requireUuid('primaryId', body.primaryId);
    const backupId = requireUuid('backupId', body.backupId);
    const reason = requireText('reason', body.reason, 500);
    await this.requireBackupAuthority(actor, org, primaryId);

    return this.write(async (tx) => {
      await this.conversations.assertActorLive(tx, actor);
      const link = await tx.supervisorBackup.create({
        data: { organizationId: org, primaryId, backupId, createdBy: actor.actorId },
      });
      await this.audit.audit(tx, {
        actorId: actor.actorId,
        action: 'backup.created',
        entity: 'supervisor_backup',
        entityId: link.id,
        after: { primaryId, backupId },
        reason,
      });
      return this.backupView(link, new Date());
    });
  }

  /** Grant access from now until `until` (or until deactivated), at most MAX_ACTIVATION_DAYS. */
  async activateBackup(actorId: string, id: string, body: { until?: unknown; reason?: unknown }) {
    const { actor, link } = await this.loadBackupForChange(actorId, id);
    const reason = requireText('reason', body.reason, 500);
    const now = new Date();
    let until: Date | null = null;
    if (body.until !== undefined && body.until !== null) {
      if (typeof body.until !== 'string' || Number.isNaN(Date.parse(body.until))) {
        throw invalid('until', 'must be an ISO-8601 timestamp');
      }
      until = new Date(body.until);
      if (until <= now) throw invalid('until', 'must be in the future');
    } else {
      until = new Date(now.getTime() + MAX_ACTIVATION_DAYS * 86_400_000);
    }
    if (until.getTime() - now.getTime() > MAX_ACTIVATION_DAYS * 86_400_000) {
      throw invalid('until', `must be within ${MAX_ACTIVATION_DAYS} days`);
    }

    return this.write(async (tx) => {
      await this.conversations.assertActorLive(tx, actor);
      const updated = await tx.supervisorBackup.update({
        where: { id: link.id },
        data: { activatedAt: now, activeUntil: until, activatedBy: actor.actorId, deactivatedAt: null, deactivatedBy: null },
      });
      await this.audit.audit(tx, {
        actorId: actor.actorId,
        action: 'backup.activated',
        entity: 'supervisor_backup',
        entityId: link.id,
        before: { status: backupStatus(link, now) },
        after: { status: 'active', activeUntil: until },
        reason,
      });
      return this.backupView(updated, now);
    });
  }

  async deactivateBackup(actorId: string, id: string, body: { reason?: unknown }) {
    const { actor, link } = await this.loadBackupForChange(actorId, id);
    const reason = requireText('reason', body.reason, 500);
    const now = new Date();
    const view = await this.write(async (tx) => {
      await this.conversations.assertActorLive(tx, actor);
      const updated = await tx.supervisorBackup.update({
        where: { id: link.id },
        data: { deactivatedAt: now, deactivatedBy: actor.actorId },
      });
      await this.audit.audit(tx, {
        actorId: actor.actorId,
        action: 'backup.deactivated',
        entity: 'supervisor_backup',
        entityId: link.id,
        before: { status: backupStatus(link, now) },
        after: { status: 'deactivated' },
        reason,
      });
      return this.backupView(updated, now);
    });
    // The backup's access just ended: confirm no node still delivers on it.
    await this.revocation.confirmRevoked();
    return view;
  }

  async endBackup(actorId: string, id: string, body: { reason?: unknown }) {
    const { actor, link } = await this.loadBackupForChange(actorId, id);
    const reason = requireText('reason', body.reason, 500);
    const now = new Date();
    const view = await this.write(async (tx) => {
      await this.conversations.assertActorLive(tx, actor);
      const updated = await tx.supervisorBackup.update({
        where: { id: link.id },
        data: { endedAt: now, endedBy: actor.actorId, deactivatedAt: link.deactivatedAt ?? now },
      });
      await this.audit.audit(tx, {
        actorId: actor.actorId,
        action: 'backup.ended',
        entity: 'supervisor_backup',
        entityId: link.id,
        before: { status: backupStatus(link, now) },
        after: { status: 'ended' },
        reason,
      });
      return this.backupView(updated, now);
    });
    await this.revocation.confirmRevoked();
    return view;
  }

  // ------------------------------------------------------------------
  // Internals
  // ------------------------------------------------------------------

  private requireOrg(actor: Actor): string {
    if (!actor.organizationId) throw new CommError(CommErrorCode.ORG_STRUCTURE_DENIED, 'no organization');
    return actor.organizationId;
  }

  private async requireBackupAuthority(actor: Actor, org: string, primaryId: string): Promise<void> {
    const primary = await this.prisma.staff.findUnique({ where: { id: primaryId }, select: { organizationId: true } });
    if (!primary || primary.organizationId !== org) throw notFound('supervisor');
    const decision = this.authz.canConfigureBackup(actor, {
      organizationId: org,
      actsForPrimary: await this.authz.actsFor(actor, primaryId, new Date()),
    });
    if (!decision.allowed) throw new CommError(decision.code, decision.reason);
  }

  private async loadBackupForChange(actorId: string, id: string) {
    const actor = await this.conversations.requireActor(actorId);
    const org = this.requireOrg(actor);
    if (!isUuid(id)) throw notFound('backup link');
    const link = await this.prisma.supervisorBackup.findUnique({ where: { id } });
    if (!link || link.organizationId !== org) throw notFound('backup link');
    await this.requireBackupAuthority(actor, org, link.primaryId);
    if (link.endedAt) {
      throw new CommError(CommErrorCode.ORG_STRUCTURE_INVALID, 'this backup link has ended; create a new one', 409);
    }
    return { actor, link };
  }

  /** End every live backup link a staff member is part of (department change / removal). */
  private async endLinksOf(tx: Prisma.TransactionClient, actor: Actor, staffId: string, reason: string) {
    const live = await tx.supervisorBackup.findMany({
      where: { endedAt: null, OR: [{ primaryId: staffId }, { backupId: staffId }] },
    });
    const now = new Date();
    for (const link of live) {
      await tx.supervisorBackup.update({
        where: { id: link.id },
        data: { endedAt: now, endedBy: actor.actorId, deactivatedAt: link.deactivatedAt ?? now },
      });
      await this.audit.audit(tx, {
        actorId: actor.actorId,
        action: 'backup.ended',
        entity: 'supervisor_backup',
        entityId: link.id,
        before: { status: backupStatus(link, now) },
        after: { status: 'ended' },
        reason,
      });
    }
  }

  private backupView(
    b: { id: string; primaryId: string; backupId: string; activatedAt: Date | null; activeUntil: Date | null; deactivatedAt: Date | null; endedAt: Date | null },
    now: Date,
  ) {
    return {
      id: b.id,
      primaryId: b.primaryId,
      backupId: b.backupId,
      status: backupStatus(b, now),
      activatedAt: b.activatedAt,
      activeUntil: b.activeUntil,
    };
  }

  /**
   * One transaction, with the database's refusals (the PD-8 triggers raise
   * check_violation / insufficient_privilege / foreign_key_violation) reported
   * as an unlawful structure (409) instead of a 500. `confirmAfter` runs the
   * RT-009 barrier for changes that may reduce someone's access.
   */
  private async write<T>(fn: (tx: Prisma.TransactionClient) => Promise<T>, confirmAfter = false): Promise<T> {
    let result: T;
    try {
      result = await this.prisma.$transaction(fn);
    } catch (e) {
      throw mapStructureRefusal(e);
    }
    if (confirmAfter) await this.revocation.confirmRevoked();
    return result;
  }
}

export function backupStatus(
  b: { activatedAt: Date | null; activeUntil: Date | null; deactivatedAt: Date | null; endedAt: Date | null },
  now: Date,
): BackupStatus {
  if (b.endedAt) return 'ended';
  if (!b.activatedAt) return 'dormant';
  if (b.deactivatedAt) return 'deactivated';
  if (b.activeUntil && b.activeUntil <= now) return 'expired';
  return 'active';
}

/** A database refusal of an unlawful structure becomes 409, never a 500. */
export function mapStructureRefusal(e: unknown): unknown {
  if (e instanceof CommError) return e;
  const text = e instanceof Error ? e.message : String(e);
  const code =
    (e as { meta?: { code?: string } })?.meta?.code ??
    (e as { code?: string })?.code ??
    '';
  if (
    ['23514', '42501', '23503', '23505', 'P2002', 'P2003'].includes(code) ||
    /check_violation|insufficient_privilege|foreign_key_violation|violates|23514|42501|23503|23505/.test(text)
  ) {
    const why = /ERROR:\s*([^\n]+)/.exec(text)?.[1] ?? /Message: `([^`]+)`/.exec(text)?.[1] ?? 'the organization structure refused this change';
    return new CommError(CommErrorCode.ORG_STRUCTURE_INVALID, why.replace(/^.*?ERROR:\s*/, ''), 409);
  }
  return e;
}

const invalid = (field: string, why: string) => new CommError(CommErrorCode.VALIDATION, `${field}: ${why}`, 400);
const notFound = (what: string) => new CommError(CommErrorCode.CONVERSATION_NOT_FOUND, `${what} not found`, 404);

function requireUuid(field: string, value: unknown): string {
  if (!isUuid(value)) throw invalid(field, 'must be a uuid');
  return value.toLowerCase();
}

function optionalUuid(field: string, value: unknown): string | null {
  if (value === undefined || value === null) return null;
  return requireUuid(field, value);
}

function requireText(field: string, value: unknown, max: number): string {
  if (typeof value !== 'string' || value.trim().length === 0) throw invalid(field, 'is required');
  if (value.trim().length > max) throw invalid(field, `must be at most ${max} characters`);
  return value.trim();
}
