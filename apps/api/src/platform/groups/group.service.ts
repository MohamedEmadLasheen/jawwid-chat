import { Inject, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma.service';
import { AuthorizationService } from '../authorization.service';
import { ALL_FAMILIES, ScopeService } from '../scope.service';
import { Actor } from '../types';
import { CommError, CommErrorCode } from '../errors';
import { Permission } from '../rbac/permissions';
import { AUDIT_SERVICE } from '../tokens';
import type { AuditService } from '../audit.service';
import { ActorKind } from '../../communication/contracts/vocab';

export interface GroupView {
  id: string;
  name: string;
  state: string;
  ownerId: string;
  ownerName: string | null;
  replacedByGroupId: string | null;
  closedAt: string | null;
  archivedAt: string | null;
  createdAt: string;
}

export interface GroupMemberView {
  id: string;
  learnerId: string;
  learnerName: string | null;
  familyId: string | null;
  joinedAt: string;
  leftAt: string | null;
  removedReason: string | null;
  isCurrent: boolean;
}

export interface GroupTeacherView {
  id: string;
  teacherId: string;
  teacherName: string | null;
  startedAt: string;
  endedAt: string | null;
  removedReason: string | null;
  isCurrent: boolean;
}

export interface GroupHistoryEntry {
  at: string;
  type: string;
  payload: Record<string, unknown>;
}

/**
 * GROUPS -- a durable business entity, NOT a conversation.
 *
 * Phase 3 creates no conversation for a group, attaches none, and chat.group
 * carries no conversation_id. A Group says which students are taught together
 * and by whom; a Conversation is Phase 2 messaging. Their lifecycles,
 * membership and authorization all differ, and deriving one identity from the
 * other would mean a group could not outlive, precede or be reorganised
 * independently of a chat thread.
 *
 * THE ROSTER IS NARROWER THAN THE GROUP (§12). A group spans families, so
 * returning its full roster to any holder of `groups.read` would hand a
 * supervisor the students of families they do not supervise -- the group-level
 * shape of red-team A-1/RT-011. Membership reads are therefore filtered by the
 * same ScopeService predicate every other family read uses, and parents reach
 * none of this: there is no route from a contact to a group row, in the service
 * or in RLS.
 */
@Injectable()
export class GroupService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly authz: AuthorizationService,
    private readonly scope: ScopeService,
    @Inject(AUDIT_SERVICE) private readonly audit: AuditService,
  ) {}

  private require(actor: Actor, permission: Permission | string): void {
    const decision = this.authz.can(actor, permission);
    if (!decision.allowed) throw new CommError(decision.code, decision.reason);
  }

  private async requireGroup(actor: Actor, groupId: string, permission: Permission | string) {
    this.require(actor, permission);
    const group = await this.prisma.group.findUnique({
      where: { id: groupId },
      include: { owner: { select: { name: true } } },
    });
    if (!group || (actor.organizationId && group.organizationId !== actor.organizationId)) {
      throw new CommError(CommErrorCode.CONVERSATION_NOT_FOUND, 'group not found', 404);
    }
    return group;
  }

  async list(actor: Actor, includeArchived = false): Promise<GroupView[]> {
    this.require(actor, Permission.GROUPS_READ);

    const where: Prisma.GroupWhereInput = {
      ...(actor.organizationId ? { organizationId: actor.organizationId } : {}),
      ...(includeArchived ? {} : { state: { not: 'archived' } }),
    };

    // A teacher sees the groups they CURRENTLY teach, and no others. A former
    // teacher's ended row is not a live one, so it grants nothing -- the
    // historical relationship is visible in the group's history to those
    // authorized for it, and confers no access of its own.
    if (actor.kind === ActorKind.TEACHER) {
      where.teachers = { some: { teacherId: actor.actorId, endedAt: null } };
    } else if (actor.kind !== ActorKind.STAFF) {
      // Contacts have no route to groups at all.
      return [];
    }

    const rows = await this.prisma.group.findMany({
      where,
      include: { owner: { select: { name: true } } },
      orderBy: [{ state: 'asc' }, { name: 'asc' }],
      take: 200,
    });
    return rows.map(toGroupView);
  }

  async get(actor: Actor, groupId: string): Promise<GroupView> {
    const group = await this.requireGroup(actor, groupId, Permission.GROUPS_READ);
    if (actor.kind === ActorKind.TEACHER) {
      const teaches = await this.prisma.groupTeacher.findFirst({
        where: { groupId, teacherId: actor.actorId, endedAt: null },
      });
      if (!teaches) {
        throw new CommError(CommErrorCode.CONVERSATION_NOT_FOUND, 'group not found', 404);
      }
    }
    return toGroupView(group);
  }

  async create(
    actor: Actor,
    input: { name: string; ownerId?: string },
  ): Promise<GroupView> {
    this.require(actor, Permission.GROUPS_MANAGE);
    const name = requireText(input.name, 'a group needs a name');
    // Defaults to the creator, who by holding groups.manage is already
    // family-facing staff. The database guard is the backstop either way.
    const ownerId = input.ownerId ?? actor.actorId;

    try {
      return await this.prisma.$transaction(async (tx) => {
        const group = await tx.group.create({
          data: { name, ownerId, createdBy: staffIdOf(actor) },
          include: { owner: { select: { name: true } } },
        });
        await this.audit.audit(tx, {
          actorId: actor.actorId,
          action: 'group.created',
          entity: 'group',
          entityId: group.id,
          reason: `group "${name}" created`,
          after: { name, ownerId },
        });
        await this.audit.event(tx, {
          actorKind: actor.kind,
          actorId: actor.actorId,
          type: 'group_created',
          payload: { groupId: group.id, name },
        });
        return toGroupView(group);
      });
    } catch (error) {
      throw asCommError(error, 'the group could not be created');
    }
  }

  async rename(actor: Actor, groupId: string, name: string): Promise<GroupView> {
    const group = await this.requireGroup(actor, groupId, Permission.GROUPS_MANAGE);
    const next = requireText(name, 'a group needs a name');
    if (next === group.name) return toGroupView(group);

    try {
      return await this.prisma.$transaction(async (tx) => {
        const updated = await tx.group.update({
          where: { id: groupId },
          data: { name: next },
          include: { owner: { select: { name: true } } },
        });
        await this.audit.audit(tx, {
          actorId: actor.actorId,
          action: 'group.updated',
          entity: 'group',
          entityId: groupId,
          reason: 'group renamed',
          before: { name: group.name },
          after: { name: next },
        });
        await this.audit.event(tx, {
          actorKind: actor.kind,
          actorId: actor.actorId,
          type: 'group_updated',
          // The STABLE ID travels with the rename, which is the whole point:
          // a group's identity is not its name.
          payload: { groupId, from: group.name, to: next },
        });
        return toGroupView(updated);
      });
    } catch (error) {
      throw asCommError(error, 'the group could not be renamed');
    }
  }

  // ------------------------------------------------------------------
  // Members
  // ------------------------------------------------------------------

  async addMember(actor: Actor, groupId: string, learnerId: string): Promise<GroupMemberView[]> {
    await this.requireGroup(actor, groupId, Permission.GROUPS_MANAGE);

    // Adding a student to a group is an act upon that student's family, so it
    // takes that family's scope -- not merely groups.manage.
    const learner = await this.prisma.learner.findUnique({
      where: { id: learnerId },
      select: { id: true, familyId: true },
    });
    if (!learner || !(await this.scope.canAccessFamily(actor, learner.familyId))) {
      throw new CommError(CommErrorCode.CONVERSATION_NOT_FOUND, 'learner not found', 404);
    }

    const live = await this.prisma.groupMember.findFirst({
      where: { groupId, learnerId, leftAt: null },
    });
    // Idempotent: already a current member is success, not a duplicate row. The
    // partial unique index refuses one anyway; this makes the retry pleasant.
    if (live) return this.members(actor, groupId);

    try {
      await this.prisma.$transaction(async (tx) => {
        await tx.groupMember.create({
          data: { groupId, learnerId, addedBy: staffIdOf(actor) },
        });
        await this.audit.audit(tx, {
          actorId: actor.actorId,
          action: 'group.member_added',
          entity: 'group',
          entityId: groupId,
          reason: 'student added to group',
          after: { learnerId },
        });
        await this.audit.event(tx, {
          familyId: learner.familyId,
          actorKind: actor.kind,
          actorId: actor.actorId,
          type: 'group_member_added',
          payload: { groupId, learnerId },
        });
      });
    } catch (error) {
      throw asCommError(error, 'the student could not be added to the group');
    }
    return this.members(actor, groupId);
  }

  /**
   * Remove a student. The row is STAMPED, never deleted: "Maryam was previously
   * a member" has to remain answerable after she leaves.
   */
  async removeMember(
    actor: Actor,
    groupId: string,
    learnerId: string,
    reason: string,
  ): Promise<GroupMemberView[]> {
    await this.requireGroup(actor, groupId, Permission.GROUPS_MANAGE);
    const why = requireText(reason, 'removing a student from a group must state a reason');

    const live = await this.prisma.groupMember.findFirst({
      where: { groupId, learnerId, leftAt: null },
    });
    if (!live) return this.members(actor, groupId);

    try {
      await this.prisma.$transaction(async (tx) => {
        // clock_timestamp(), not `new Date()`. joined_at was written by the
        // DATABASE, so closing the window with the APP clock would make the
        // check `left_at >= joined_at` depend on the skew between two hosts --
        // and a few milliseconds the wrong way rejects a legitimate removal.
        await tx.$executeRaw`
          update chat.group_member
             set left_at = clock_timestamp(), removed_by = ${staffIdOf(actor)}::uuid,
                 removed_reason = ${why}
           where id = ${live.id}::uuid`;
        await this.audit.audit(tx, {
          actorId: actor.actorId,
          action: 'group.member_removed',
          entity: 'group',
          entityId: groupId,
          reason: why,
          before: { learnerId, current: true },
          after: { learnerId, current: false },
        });
        await this.audit.event(tx, {
          actorKind: actor.kind,
          actorId: actor.actorId,
          type: 'group_member_removed',
          payload: { groupId, learnerId, reason: why },
        });
      });
    } catch (error) {
      throw asCommError(error, 'the student could not be removed from the group');
    }
    return this.members(actor, groupId);
  }

  /**
   * The roster, current and historical, SCOPED.
   *
   * `current` is `left_at is null` and nothing else, so a former member can
   * never present itself as a current one. Rows whose learner belongs to a
   * family outside the actor's scope are not returned at all -- for an
   * organization-wide role that is every row, for anyone else it is their own
   * families' students.
   */
  async members(actor: Actor, groupId: string, includeFormer = true): Promise<GroupMemberView[]> {
    await this.requireGroup(actor, groupId, Permission.GROUPS_READ);

    const rows = await this.prisma.groupMember.findMany({
      where: includeFormer ? { groupId } : { groupId, leftAt: null },
      include: { learner: { select: { name: true, familyId: true } } },
      orderBy: [{ leftAt: 'asc' }, { joinedAt: 'asc' }],
      take: 500,
    });

    const visible = await this.scope.visibleFamilies(actor);
    const permitted = (familyId: string) =>
      visible === ALL_FAMILIES ? true : visible.includes(familyId);

    return rows
      .filter((r) => permitted(r.learner.familyId))
      .map((r) => ({
        id: r.id,
        learnerId: r.learnerId,
        learnerName: r.learner?.name ?? null,
        familyId: r.learner?.familyId ?? null,
        joinedAt: r.joinedAt.toISOString(),
        leftAt: r.leftAt?.toISOString() ?? null,
        removedReason: r.removedReason,
        isCurrent: r.leftAt === null,
      }));
  }

  // ------------------------------------------------------------------
  // Teachers
  // ------------------------------------------------------------------

  async addTeacher(actor: Actor, groupId: string, teacherId: string): Promise<GroupTeacherView[]> {
    await this.requireGroup(actor, groupId, Permission.GROUPS_MANAGE);
    const live = await this.prisma.groupTeacher.findFirst({
      where: { groupId, teacherId, endedAt: null },
    });
    if (live) return this.teachers(actor, groupId);

    try {
      await this.prisma.$transaction(async (tx) => {
        await tx.groupTeacher.create({ data: { groupId, teacherId, addedBy: staffIdOf(actor) } });
        await this.audit.audit(tx, {
          actorId: actor.actorId,
          action: 'group.teacher_added',
          entity: 'group',
          entityId: groupId,
          reason: 'teacher added to group',
          after: { teacherId },
        });
        await this.audit.event(tx, {
          actorKind: actor.kind,
          actorId: actor.actorId,
          type: 'group_teacher_added',
          payload: { groupId, teacherId },
        });
      });
    } catch (error) {
      throw asCommError(error, 'the teacher could not be added to the group');
    }
    return this.teachers(actor, groupId);
  }

  /**
   * Remove a teacher. Stamped, never deleted -- this is the
   * `Ahmed + Islam -> Ahmed + Mahmoud` case, where Islam must remain visible as
   * a previous assignment while holding no current relationship.
   */
  async removeTeacher(
    actor: Actor,
    groupId: string,
    teacherId: string,
    reason: string,
  ): Promise<GroupTeacherView[]> {
    await this.requireGroup(actor, groupId, Permission.GROUPS_MANAGE);
    const why = requireText(reason, 'removing a teacher from a group must state a reason');

    const live = await this.prisma.groupTeacher.findFirst({
      where: { groupId, teacherId, endedAt: null },
    });
    if (!live) return this.teachers(actor, groupId);

    try {
      await this.prisma.$transaction(async (tx) => {
        // Same clock discipline as removeMember(): the database opened this
        // window and the database closes it.
        await tx.$executeRaw`
          update chat.group_teacher
             set ended_at = clock_timestamp(), removed_by = ${staffIdOf(actor)}::uuid,
                 removed_reason = ${why}
           where id = ${live.id}::uuid`;
        await this.audit.audit(tx, {
          actorId: actor.actorId,
          action: 'group.teacher_removed',
          entity: 'group',
          entityId: groupId,
          reason: why,
          before: { teacherId, current: true },
          after: { teacherId, current: false },
        });
        await this.audit.event(tx, {
          actorKind: actor.kind,
          actorId: actor.actorId,
          type: 'group_teacher_removed',
          payload: { groupId, teacherId, reason: why },
        });
      });
    } catch (error) {
      throw asCommError(error, 'the teacher could not be removed from the group');
    }
    return this.teachers(actor, groupId);
  }

  async teachers(actor: Actor, groupId: string, includeFormer = true): Promise<GroupTeacherView[]> {
    await this.requireGroup(actor, groupId, Permission.GROUPS_READ);
    const rows = await this.prisma.groupTeacher.findMany({
      where: includeFormer ? { groupId } : { groupId, endedAt: null },
      include: { teacher: { select: { name: true } } },
      orderBy: [{ endedAt: 'asc' }, { startedAt: 'asc' }],
      take: 200,
    });
    return rows.map((r) => ({
      id: r.id,
      teacherId: r.teacherId,
      teacherName: r.teacher?.name ?? null,
      startedAt: r.startedAt.toISOString(),
      endedAt: r.endedAt?.toISOString() ?? null,
      removedReason: r.removedReason,
      isCurrent: r.endedAt === null,
    }));
  }

  // ------------------------------------------------------------------
  // Lifecycle
  // ------------------------------------------------------------------

  async close(actor: Actor, groupId: string, reason: string): Promise<GroupView> {
    await this.requireGroup(actor, groupId, Permission.GROUPS_MANAGE);
    const why = requireText(reason, 'closing a group must state a reason');
    await this.callLifecycle`select chat.close_group(${groupId}::uuid, ${why}, ${actor.actorId}::uuid)`;
    return this.get(actor, groupId);
  }

  async archive(actor: Actor, groupId: string, reason: string): Promise<GroupView> {
    await this.requireGroup(actor, groupId, Permission.GROUPS_MANAGE);
    const why = requireText(reason, 'archiving a group must state a reason');
    await this.callLifecycle`select chat.archive_group(${groupId}::uuid, ${why}, ${actor.actorId}::uuid)`;
    return this.get(actor, groupId);
  }

  /**
   * Create the successor. The old group keeps its id, its roster and its whole
   * history; only a forward pointer is added. The replacement gets a NEW id --
   * reusing the old one would silently rewrite the past.
   */
  async createReplacement(
    actor: Actor,
    groupId: string,
    name: string,
    reason: string,
  ): Promise<GroupView> {
    await this.requireGroup(actor, groupId, Permission.GROUPS_MANAGE);
    const why = requireText(reason, 'a replacement group must state a reason');
    let created: Array<{ id: string }>;
    try {
      created = await this.prisma.$queryRaw<Array<{ id: string }>>`
        select chat.create_replacement_group(
          ${groupId}::uuid, ${name ?? ''}, ${why}, ${actor.actorId}::uuid) as id
      `;
    } catch (error) {
      throw asCommError(error, 'the replacement group could not be created');
    }
    return this.get(actor, created[0].id);
  }

  private async callLifecycle(sql: TemplateStringsArray, ...values: unknown[]): Promise<void> {
    try {
      await this.prisma.$queryRaw(sql, ...values);
    } catch (error) {
      throw asCommError(error, 'the group lifecycle change was refused');
    }
  }

  /**
   * The group's history, from the EXISTING event log.
   *
   * No second audit system: these are the chat.event_log rows the operations
   * above wrote, read back. History survives archival, which is the point --
   * an archived group is evidence and must stay answerable.
   */
  async history(actor: Actor, groupId: string): Promise<GroupHistoryEntry[]> {
    await this.requireGroup(actor, groupId, Permission.GROUPS_READ);
    const rows = await this.prisma.eventLog.findMany({
      where: {
        type: { startsWith: 'group_' },
        payload: { path: ['groupId'], equals: groupId },
      },
      orderBy: { at: 'desc' },
      take: 200,
    });
    return rows.map((r) => ({
      at: r.at.toISOString(),
      type: r.type,
      payload: (r.payload ?? {}) as Record<string, unknown>,
    }));
  }
}

function toGroupView(row: {
  id: string;
  name: string;
  state: string;
  ownerId: string;
  replacedByGroupId: string | null;
  closedAt: Date | null;
  archivedAt: Date | null;
  createdAt: Date;
  owner?: { name: string } | null;
}): GroupView {
  return {
    id: row.id,
    name: row.name,
    state: row.state,
    ownerId: row.ownerId,
    ownerName: row.owner?.name ?? null,
    replacedByGroupId: row.replacedByGroupId,
    closedAt: row.closedAt?.toISOString() ?? null,
    archivedAt: row.archivedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

/** audit_log.actor_id is a staff column; a non-staff actor records as null. */
function staffIdOf(actor: Actor): string | null {
  return actor.kind === ActorKind.STAFF ? actor.actorId : null;
}

function requireText(value: string | undefined, message: string): string {
  const trimmed = (value ?? '').trim();
  if (trimmed.length === 0) {
    throw new CommError(CommErrorCode.APPROVAL_REASON_REQUIRED, message, 400);
  }
  return trimmed;
}

function asCommError(error: unknown, fallback: string): CommError | unknown {
  const message = (error as Error)?.message ?? '';
  if (/archived|cannot be reopened|must be closed|already been replaced|active, family-facing|only an active teacher|requires a reason/i.test(message)) {
    return new CommError(CommErrorCode.INVALID_PARTICIPANTS, message, 400);
  }
  if ((error as { code?: string })?.code === 'P2002') {
    return new CommError(CommErrorCode.GROUP_ALREADY_EXISTS, fallback, 409);
  }
  return error;
}
