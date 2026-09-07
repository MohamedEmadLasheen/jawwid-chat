import { Inject, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { AuthorizationService } from '../authorization.service';
import { ScopeService } from '../scope.service';
import { Actor } from '../types';
import { CommError, CommErrorCode } from '../errors';
import { Permission } from '../rbac/permissions';
import { AUDIT_SERVICE } from '../tokens';
import type { AuditService } from '../audit.service';
import { ConversationService } from '../../communication/conversations/conversation.service';
import { ActorKind } from '../../communication/contracts/vocab';

export interface LearnerView {
  id: string;
  familyId: string;
  name: string;
  level: string | null;
  isActive: boolean;
  currentTeacherId: string | null;
  currentTeacherName: string | null;
  deactivatedAt: string | null;
  createdAt: string;
}

export interface TeacherAssignmentView {
  id: string;
  learnerId: string;
  teacherId: string;
  teacherName: string | null;
  startedAt: string;
  endedAt: string | null;
  endedReason: string | null;
  reason: string;
  /** True when this row was reconstructed at the Phase 3 cutover rather than observed. */
  isBackfilled: boolean;
  /** Derived, never stored: exactly one row in a learner's history is current. */
  isCurrent: boolean;
}

/**
 * STUDENTS -- the Learner, its lifecycle, and who teaches it.
 *
 * `Learner` is the canonical code and database term; "Student" is the UI label
 * (DOMAIN-VOCABULARY.md §2.1). This service does not introduce a second word.
 *
 * THE RULE THIS SERVICE EXISTS TO KEEP: a teacher change never destroys the
 * previous relationship. The current teacher and the teacher history are the
 * same table read two ways -- `ended_at is null` for the first, everything for
 * the second -- so they cannot disagree, and a past assignment can never answer
 * a present-tense question.
 *
 * Every read is built from ScopeService's predicate, exactly as FamilyService
 * does it: a student outside the actor's scope is NOT FOUND rather than
 * found-and-refused, so probing ids reveals nothing.
 */
@Injectable()
export class LearnerService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly authz: AuthorizationService,
    private readonly scope: ScopeService,
    private readonly conversations: ConversationService,
    @Inject(AUDIT_SERVICE) private readonly audit: AuditService,
  ) {}

  /**
   * Load a learner, enforcing permission and scope in the LOOKUP itself.
   *
   * `permission` is the key the calling operation needs. Passing it here rather
   * than checking separately means no operation can read a student it is not
   * entitled to touch, and the not-found response is identical whether the
   * student is absent or merely out of scope.
   */
  private async require(
    actor: Actor,
    learnerId: string,
    permission: Permission | string,
  ): Promise<{ id: string; familyId: string; name: string; isActive: boolean }> {
    const permitted = this.authz.can(actor, permission);
    if (!permitted.allowed) throw new CommError(permitted.code, permitted.reason);

    const learner = await this.prisma.learner.findUnique({
      where: { id: learnerId },
      select: { id: true, familyId: true, name: true, isActive: true },
    });
    // Existence is checked BEFORE scope and reported identically, so the two
    // cases are indistinguishable from outside.
    if (!learner || !(await this.scope.canAccessFamily(actor, learner.familyId))) {
      throw new CommError(CommErrorCode.CONVERSATION_NOT_FOUND, 'learner not found', 404);
    }
    return learner;
  }

  /** The students of one family. */
  async listForFamily(actor: Actor, familyId: string, includeInactive = true): Promise<LearnerView[]> {
    const permitted = this.authz.can(actor, Permission.FAMILIES_READ);
    if (!permitted.allowed) throw new CommError(permitted.code, permitted.reason);
    if (!(await this.scope.canAccessFamily(actor, familyId))) {
      throw new CommError(CommErrorCode.CONVERSATION_NOT_FOUND, 'family not found', 404);
    }

    const rows = await this.prisma.learner.findMany({
      where: includeInactive ? { familyId } : { familyId, isActive: true },
      include: { teacher: { select: { id: true, name: true } } },
      orderBy: [{ isActive: 'desc' }, { name: 'asc' }],
    });
    return rows.map(toLearnerView);
  }

  async get(actor: Actor, learnerId: string): Promise<LearnerView> {
    await this.require(actor, learnerId, Permission.FAMILIES_READ);
    const row = await this.prisma.learner.findUniqueOrThrow({
      where: { id: learnerId },
      include: { teacher: { select: { id: true, name: true } } },
    });
    return toLearnerView(row);
  }

  /**
   * Create a student under a family.
   *
   * A learner ALWAYS belongs to a family -- the column is NOT NULL and there is
   * no code path that creates one without a family, so the orphan state §4 warns
   * about is unrepresentable rather than merely avoided.
   */
  async create(
    actor: Actor,
    familyId: string,
    input: { name: string; level?: string | null },
  ): Promise<LearnerView> {
    const permitted = this.authz.can(actor, Permission.FAMILIES_MANAGE);
    if (!permitted.allowed) throw new CommError(permitted.code, permitted.reason);
    if (!(await this.scope.canAccessFamily(actor, familyId))) {
      throw new CommError(CommErrorCode.CONVERSATION_NOT_FOUND, 'family not found', 404);
    }
    const name = requireText(input.name, 'a student needs a name');

    return this.prisma.$transaction(async (tx) => {
      const created = await tx.learner.create({
        data: { familyId, name, level: input.level ?? null },
        include: { teacher: { select: { id: true, name: true } } },
      });
      await this.audit.audit(tx, {
        actorId: actor.actorId,
        action: 'learner.created',
        entity: 'learner',
        entityId: created.id,
        reason: `student added to family ${familyId}`,
        after: { name, familyId },
      });
      await this.audit.event(tx, {
        familyId,
        actorKind: actor.kind,
        actorId: actor.actorId,
        type: 'learner_created',
        payload: { learnerId: created.id },
      });
      return toLearnerView(created);
    });
  }

  async update(
    actor: Actor,
    learnerId: string,
    input: { name?: string; level?: string | null },
  ): Promise<LearnerView> {
    const learner = await this.require(actor, learnerId, Permission.FAMILIES_MANAGE);
    const data: { name?: string; level?: string | null } = {};
    if (input.name !== undefined) data.name = requireText(input.name, 'a student needs a name');
    if (input.level !== undefined) data.level = input.level;
    if (Object.keys(data).length === 0) return this.get(actor, learnerId);

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.learner.update({
        where: { id: learnerId },
        data,
        include: { teacher: { select: { id: true, name: true } } },
      });
      await this.audit.audit(tx, {
        actorId: actor.actorId,
        action: 'learner.updated',
        entity: 'learner',
        entityId: learnerId,
        reason: 'student profile edited',
        before: { name: learner.name },
        after: data,
      });
      return toLearnerView(updated);
    });
  }

  /**
   * Deactivate a student.
   *
   * NEVER a delete. The family relationship, the whole teacher history, every
   * group membership row and every conversation the student took part in are
   * left exactly as they are -- the row simply stops being current.
   *
   * The student group is ARCHIVED, which is Phase 2's own terminal state for a
   * conversation: no new messages, history still readable, and
   * `conversation_one_group_per_learner` is a PARTIAL index on
   * `archived_at is null`, so archiving deliberately frees the slot. A student
   * who returns therefore gets a fresh group rather than a resurrected one,
   * which is Phase 2's design and not an accident of this call.
   */
  async deactivate(actor: Actor, learnerId: string, reason: string): Promise<LearnerView> {
    const learner = await this.require(actor, learnerId, Permission.FAMILIES_MANAGE);
    const why = requireText(reason, 'deactivating a student must state a reason');
    if (!learner.isActive) return this.get(actor, learnerId);

    await this.prisma.$transaction(async (tx) => {
      await tx.learner.update({
        where: { id: learnerId },
        data: { isActive: false, deactivatedAt: new Date(), deactivatedReason: why },
      });
      await this.audit.audit(tx, {
        actorId: actor.actorId,
        action: 'learner.deactivated',
        entity: 'learner',
        entityId: learnerId,
        reason: why,
        before: { isActive: true },
        after: { isActive: false },
      });
      await this.audit.event(tx, {
        familyId: learner.familyId,
        actorKind: actor.kind,
        actorId: actor.actorId,
        type: 'learner_deactivated',
        payload: { learnerId, reason: why },
      });
    });

    // Outside the transaction, and deliberately: archiving is a messaging
    // consequence of a business decision that has already been committed. A
    // failure here must not roll back the deactivation.
    await this.conversations.archiveStudentGroup(learnerId, why, actor.actorId);
    return this.get(actor, learnerId);
  }

  /** Reactivate. The archived group is NOT resurrected; see deactivate(). */
  async activate(actor: Actor, learnerId: string, reason: string): Promise<LearnerView> {
    const learner = await this.require(actor, learnerId, Permission.FAMILIES_MANAGE);
    const why = requireText(reason, 'reactivating a student must state a reason');
    if (learner.isActive) return this.get(actor, learnerId);

    await this.prisma.$transaction(async (tx) => {
      await tx.learner.update({
        where: { id: learnerId },
        data: { isActive: true, deactivatedAt: null, deactivatedReason: null },
      });
      await this.audit.audit(tx, {
        actorId: actor.actorId,
        action: 'learner.activated',
        entity: 'learner',
        entityId: learnerId,
        reason: why,
        before: { isActive: false },
        after: { isActive: true },
      });
      await this.audit.event(tx, {
        familyId: learner.familyId,
        actorKind: actor.kind,
        actorId: actor.actorId,
        type: 'learner_activated',
        payload: { learnerId, reason: why },
      });
    });
    return this.get(actor, learnerId);
  }

  /**
   * Assign or transfer this student's teacher. ONE operation, because they are
   * one act: "assign" is the case where there was no previous teacher.
   *
   * The mutation itself is chat.assign_learner_teacher(), which ends the
   * previous assignment and opens the new one in a single transaction under a
   * lock on the LEARNER row. Doing it in SQL is what makes it atomic against a
   * concurrent transfer of the same student -- proven by execution, not assumed.
   */
  async assignTeacher(
    actor: Actor,
    learnerId: string,
    teacherId: string,
    reason: string,
  ): Promise<TeacherAssignmentView[]> {
    await this.require(actor, learnerId, Permission.LEARNERS_ASSIGN_TEACHER);
    const why = requireText(reason, 'a teacher assignment must state a reason');
    if (!isUuid(teacherId)) {
      throw new CommError(CommErrorCode.INVALID_PARTICIPANTS, 'a teacher id is required', 400);
    }

    try {
      await this.prisma.$queryRaw`
        select chat.assign_learner_teacher(
          ${learnerId}::uuid, ${teacherId}::uuid, ${why}, ${actor.actorId}::uuid)
      `;
    } catch (error) {
      // The database's own rules -- an inactive teacher, a cross-organization
      // teacher, a blank reason -- surface as a stable code rather than a 500.
      throw asCommError(error, 'the teacher could not be assigned');
    }

    // The group's teacher member follows the assignment. syncStudentGroup is
    // Phase 2's existing reconciler and the ONLY membership mechanism used here;
    // it reads chat.learner.teacher_id, which the mirror trigger has already
    // updated inside the statement above.
    //
    // No requester is passed: the membership change is a CONSEQUENCE of a
    // business act this method has already authorized, not a second act by the
    // caller. That is the same contract the Core-ingestion and worker paths use.
    await this.conversations.syncStudentGroup(learnerId);

    return this.teacherHistory(actor, learnerId);
  }

  /**
   * The teacher history, newest first, with the current assignment marked.
   *
   * History and current state come from ONE query. A separate "current teacher"
   * read could disagree with the history it is displayed beside; this cannot.
   */
  async teacherHistory(actor: Actor, learnerId: string): Promise<TeacherAssignmentView[]> {
    await this.require(actor, learnerId, Permission.FAMILIES_READ);
    const rows = await this.prisma.learnerTeacherAssignment.findMany({
      where: { learnerId },
      include: { teacher: { select: { name: true } } },
      orderBy: { startedAt: 'desc' },
      take: 200,
    });
    return rows.map((r) => ({
      id: r.id,
      learnerId: r.learnerId,
      teacherId: r.teacherId,
      teacherName: r.teacher?.name ?? null,
      startedAt: r.startedAt.toISOString(),
      endedAt: r.endedAt?.toISOString() ?? null,
      endedReason: r.endedReason,
      reason: r.reason,
      isBackfilled: r.isBackfilled,
      // CURRENT is `ended_at is null`, and nothing else. A historical row can
      // never present itself as the current one.
      isCurrent: r.endedAt === null,
    }));
  }
}

function toLearnerView(row: {
  id: string;
  familyId: string;
  name: string;
  level: string | null;
  isActive: boolean;
  deactivatedAt: Date | null;
  createdAt: Date;
  teacher?: { id: string; name: string } | null;
}): LearnerView {
  return {
    id: row.id,
    familyId: row.familyId,
    name: row.name,
    level: row.level,
    isActive: row.isActive,
    currentTeacherId: row.teacher?.id ?? null,
    currentTeacherName: row.teacher?.name ?? null,
    deactivatedAt: row.deactivatedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

function requireText(value: string | undefined, message: string): string {
  const trimmed = (value ?? '').trim();
  if (trimmed.length === 0) {
    throw new CommError(CommErrorCode.APPROVAL_REASON_REQUIRED, message, 400);
  }
  return trimmed;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function isUuid(value: string): boolean {
  return UUID.test(value ?? '');
}

/**
 * A database rule that fired is a client error, not a server fault.
 *
 * check_violation / restrict_violation are how this schema states its business
 * rules, so they map to 400 with the database's own message. Anything else is
 * rethrown untouched -- swallowing an unknown fault as a 400 would hide a real
 * defect behind a plausible-looking rejection.
 */
function asCommError(error: unknown, fallback: string): unknown {
  const code = (error as { code?: string })?.code;
  const meta = (error as { meta?: { message?: string } })?.meta;
  if (code === 'P2010' || code === '23514' || code === '23001') {
    return new CommError(CommErrorCode.INVALID_PARTICIPANTS, meta?.message ?? fallback, 400);
  }
  const message = (error as Error)?.message ?? '';
  if (/check_violation|restrict_violation|only be assigned|requires a reason|cross-organization/i.test(message)) {
    return new CommError(CommErrorCode.INVALID_PARTICIPANTS, message, 400);
  }
  return error;
}
