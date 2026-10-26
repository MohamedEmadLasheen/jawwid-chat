import { Inject, Injectable, Optional } from '@nestjs/common';
import { Conversation, Prisma } from '@prisma/client';
import { PrismaService } from '../platform/prisma.service';
import { AuthorizationService } from '../platform/authorization.service';
import { CommError, CommErrorCode } from '../platform/errors';
import { AUDIT_SERVICE } from '../platform/tokens';
import type { AuditService } from '../platform/audit.service';
import type { Actor } from '../platform/types';
import {
  decidePd012StaffAccess,
  isLiveTeacher,
  type Pd012Access,
  type TeachersDepartmentRole,
} from '../platform/pd012-policy';
import { DEPARTMENT_WIDE_SCOPE, TeacherScopeService } from '../platform/teacher-scope';
import { ConversationService, isUuid } from '../communication/conversations/conversation.service';
import { OutboxService } from '../communication/outbox/outbox.service';
import { CommEvent } from '../communication/contracts/events';
import { ActorKind, ConversationType, MemberRole } from '../communication/contracts/vocab';

type Tx = Prisma.TransactionClient;

/** The tickets "+" offers in a supervision conversation (PD-11 ticket, PD-12 S1). */
export type SupervisionTicket = 'certificate' | 'leave';

/**
 * PD-11 / PD-12: each teacher's one staff-only conversation with the Teachers
 * department.
 *
 * Its members are the teacher and the department's live conversation staff
 * (manager and members), synced every time it is ensured. Access is
 * chat.staff_conversation_access's 'teacher_supervision' branch, so the staff
 * list, the RLS policies and canRead/canSend all agree without any code here;
 * membership only decides who is notified.
 *
 * It is created lazily -- when a teacher files their first ticket, when a
 * teacher or the department opens it, or for every teacher at once from the
 * Admin Portal -- and never twice (an advisory lock plus a partial unique index).
 */
@Injectable()
export class SupervisionConversationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly authz: AuthorizationService,
    private readonly conversations: ConversationService,
    private readonly outbox: OutboxService,
    @Inject(AUDIT_SERVICE) private readonly audit: AuditService,
    // PD-35: which teachers a Teachers-department member works on. A positional
    // harness construction without it is department-wide (the switch's default).
    @Optional() readonly teacherScope: TeacherScopeService = DEPARTMENT_WIDE_SCOPE,
  ) {}

  // ------------------------------------------------------------------
  // Who
  // ------------------------------------------------------------------

  async teachersDepartmentRole(actor: Actor): Promise<TeachersDepartmentRole> {
    if (actor.kind !== ActorKind.STAFF) return null;
    const rows = await this.prisma.$queryRaw<Array<{ role: string | null }>>`
      SELECT chat.teachers_department_role(${actor.actorId}::uuid) AS role`;
    const role = rows[0]?.role ?? null;
    return role === 'manager' || role === 'member' ? role : null;
  }

  async staffAccess(actor: Actor): Promise<Pd012Access> {
    return decidePd012StaffAccess(actor, await this.teachersDepartmentRole(actor));
  }

  /**
   * PD-35: a teacher outside the caller's scope is answered exactly as an
   * unknown one (`notFound`). Every per-teacher PD-12 / PD-26 act asks this
   * after the department gate.
   */
  async requireTeacherInScope(actor: Actor, teacherId: string | null | undefined, notFound: CommErrorCode): Promise<void> {
    if (!(await this.teacherScope.covers(actor, teacherId))) throw new CommError(notFound, 'not found');
  }

  // ------------------------------------------------------------------
  // Opening it
  // ------------------------------------------------------------------

  /** The calling teacher's own supervision conversation, created if needed. */
  async ensureOwn(actorId: string) {
    const actor = await this.conversations.requireActor(actorId);
    if (!isLiveTeacher(actor)) {
      throw new CommError(CommErrorCode.SUPERVISION_DENIED, 'only a teacher has a supervision conversation of their own');
    }
    const conv = await this.prisma.$transaction((tx) => this.ensureInTx(tx, actor.actorId, actor.organizationId as string, null));
    return { conversationId: conv.id };
  }

  /** One teacher's supervision conversation, opened by the Teachers department. */
  async ensureForTeacher(actorId: string, teacherId: string) {
    const actor = await this.requireSupervisor(actorId);
    if (!isUuid(teacherId)) throw new CommError(CommErrorCode.SUPERVISION_NOT_FOUND, 'no such teacher');
    await this.requireTeacherInScope(actor, teacherId, CommErrorCode.SUPERVISION_NOT_FOUND);
    const conv = await this.prisma.$transaction((tx) =>
      this.ensureInTx(tx, teacherId, actor.organizationId as string, actor.actorId),
    );
    return { conversationId: conv.id };
  }

  /** Every active teacher's, at once. Idempotent: a second run only re-syncs members. */
  async ensureAll(actorId: string) {
    const actor = await this.requireSupervisor(actorId);
    const scope = await this.teacherScope.scopeOf(actor);
    const teachers = await this.prisma.teacher.findMany({
      where: {
        organizationId: actor.organizationId, isActive: true, leftAt: null,
        ...(scope.all ? {} : { id: { in: [...scope.teacherIds] } }),
      },
      select: { id: true },
    });
    let ensured = 0;
    for (const t of teachers) {
      await this.prisma.$transaction((tx) => this.ensureInTx(tx, t.id, actor.organizationId as string, actor.actorId));
      ensured += 1;
    }
    return { ensured };
  }

  /**
   * Find or create the teacher's live supervision conversation and bring its
   * staff membership in line with the Teachers department. Runs inside the
   * caller's transaction, so a ticket and the conversation it lands in commit
   * together.
   *
   * A teacher in another organization, an unknown one and an inactive one all
   * read as not found: this is called with ids from requests.
   */
  async ensureInTx(tx: Tx, teacherId: string, organizationId: string, byStaffId: string | null): Promise<Conversation> {
    const teacher = await tx.teacher.findFirst({
      where: { id: teacherId, organizationId, isActive: true, leftAt: null },
      select: { id: true, name: true },
    });
    if (!teacher) throw new CommError(CommErrorCode.SUPERVISION_NOT_FOUND, 'no such teacher');

    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'teacher_supervision:' + teacherId}))`;

    const staff = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT s.id::text AS id
        FROM chat.staff s
       WHERE s.organization_id = ${organizationId}::uuid
         AND s.is_active AND s.left_at IS NULL
         AND s.role IN ('admin', 'coverage', 'manager')
         AND chat.teachers_department_role(s.id) IS NOT NULL
         -- PD-35: with the switch on, the teacher's own supervisor and the Teachers Manager.
         AND (NOT chat.teacher_scope_strict() OR chat.staff_teacher_scope(s.id, ${teacherId}::uuid) IN ('self', 'manager'))
       ORDER BY s.id`;
    const wanted = new Set(staff.map((s) => s.id));

    let conv = await tx.conversation.findFirst({
      where: { type: ConversationType.TEACHER_SUPERVISION, supervisedTeacherId: teacherId, archivedAt: null },
    });
    const added: string[] = [];
    const removed: string[] = [];

    if (!conv) {
      conv = await tx.conversation.create({
        data: {
          organizationId,
          type: ConversationType.TEACHER_SUPERVISION,
          supervisedTeacherId: teacherId,
          familyId: null,
          learnerId: null,
          // The staff side's name for it. The teacher's own app shows its own
          // label for this type and never this title.
          title: teacher.name,
          teacherRequiresApproval: false,
          parentRequiresApproval: false,
        },
      });
      await tx.conversationMember.create({
        data: { conversationId: conv.id, actorId: teacherId, actorKind: ActorKind.TEACHER, memberRole: MemberRole.TEACHER, addedBy: byStaffId },
      });
      added.push(teacherId);
      await this.audit.audit(tx, {
        actorId: byStaffId,
        action: 'teacher_supervision.created',
        entity: 'conversation',
        entityId: conv.id,
        after: { teacherId },
        reason: 'teacher supervision conversation opened',
      });
    }

    if (conv.title !== teacher.name) {
      // chat.teacher.name is the only teacher name (Teacher Profile V2); follow a rename.
      conv = await tx.conversation.update({ where: { id: conv.id }, data: { title: teacher.name } });
    }

    const live = await tx.conversationMember.findMany({ where: { conversationId: conv.id, leftAt: null } });
    if (!live.some((m) => m.actorId === teacherId)) {
      await tx.conversationMember.create({
        data: { conversationId: conv.id, actorId: teacherId, actorKind: ActorKind.TEACHER, memberRole: MemberRole.TEACHER, addedBy: byStaffId },
      });
      added.push(teacherId);
    }
    const liveStaff = new Set(live.filter((m) => m.actorKind === ActorKind.STAFF).map((m) => m.actorId));
    for (const id of wanted) {
      if (liveStaff.has(id)) continue;
      await tx.conversationMember.create({
        data: { conversationId: conv.id, actorId: id, actorKind: ActorKind.STAFF, memberRole: MemberRole.ADMIN, addedBy: byStaffId },
      });
      added.push(id);
    }
    // PD-35: a visible seat taken by choice is the seat service's to end, never a sync's.
    const seated = new Set(
      (await tx.$queryRaw<Array<{ staff_id: string }>>`
        SELECT staff_id::text AS staff_id FROM chat.conversation_seat
         WHERE conversation_id = ${conv.id}::uuid AND left_at IS NULL AND member_id IS NOT NULL`).map((r) => r.staff_id),
    );
    const leaving = [...liveStaff].filter((id) => !wanted.has(id) && !seated.has(id));
    if (leaving.length > 0) {
      await tx.conversationMember.updateMany({
        where: { conversationId: conv.id, actorId: { in: leaving }, leftAt: null },
        data: { leftAt: new Date() },
      });
      removed.push(...leaving);
    }
    if (added.length > 0 || removed.length > 0) {
      await this.outbox.enqueue(tx, CommEvent.MEMBERSHIP_CHANGED, { conversationId: conv.id, added, removed });
    }
    return conv;
  }

  // ------------------------------------------------------------------
  // The "+" menu
  // ------------------------------------------------------------------

  /**
   * What the caller may file under "+" in this conversation. Advisory, like the
   * lesson tickets: each is re-decided on submit. Only the teacher the
   * conversation is about files tickets in it.
   */
  async ticketsFor(actorId: string, conversationId: string) {
    const actor = await this.conversations.requireActor(actorId);
    const conv = await this.conversations.requireConversation(conversationId);
    const tenant = this.authz.canActInOrganization(actor, conv.organizationId);
    if (!tenant.allowed) throw new CommError(tenant.code, tenant.reason, 404);
    if (
      conv.type !== ConversationType.TEACHER_SUPERVISION ||
      conv.archivedAt ||
      !isLiveTeacher(actor) ||
      conv.supervisedTeacherId !== actor.actorId
    ) {
      return { tickets: [] as Array<{ ticket: SupervisionTicket }>, learners: [] };
    }
    const learners = await this.prisma.learner.findMany({
      where: { teacherId: actor.actorId, organizationId: actor.organizationId },
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    });
    const tickets: Array<{ ticket: SupervisionTicket }> = [{ ticket: 'leave' }];
    if (learners.length > 0) tickets.unshift({ ticket: 'certificate' });
    return { tickets, learners };
  }

  // ------------------------------------------------------------------

  private async requireSupervisor(actorId: string): Promise<Actor> {
    const actor = await this.conversations.requireActor(actorId);
    if (!(await this.staffAccess(actor)).canSupervise) {
      throw new CommError(CommErrorCode.SUPERVISION_DENIED, 'only the Teachers department opens supervision conversations');
    }
    return actor;
  }
}
