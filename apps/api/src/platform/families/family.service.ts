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

export interface FamilySummary {
  id: string;
  displayName: string;
  state: string;
  tier: string;
  language: string;
  supervisorId: string;
  supervisorName: string | null;
}

export interface AssignmentView {
  id: string;
  familyId: string;
  staffId: string;
  staffName: string | null;
  kind: string;
  startsAt: string;
  endsAt: string | null;
  endedAt: string | null;
  reason: string;
}

/**
 * Families, and who supervises them.
 *
 * Every read here is built from ScopeService's predicate, so scoping is a
 * property of the QUERY rather than a filter applied afterwards. That
 * distinction is the whole of red-team A-1: a list that fetches everything and
 * then removes rows is one forgotten line away from a leak, and it looks
 * correct in review either way.
 */
@Injectable()
export class FamilyService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly authz: AuthorizationService,
    private readonly scope: ScopeService,
    @Inject(AUDIT_SERVICE) private readonly audit: AuditService,
  ) {}

  /** The WHERE clause every family read starts from. Never `{}`. */
  private async where(actor: Actor): Promise<Prisma.FamilyWhereInput> {
    const scope = await this.scope.visibleFamilies(actor);
    if (scope === ALL_FAMILIES) {
      return actor.organizationId ? { organizationId: actor.organizationId } : { id: { in: [] } };
    }
    // An empty scope produces an impossible predicate, not an absent one. `{}`
    // here would match every family, which is the exact shape of the bug this
    // service exists to prevent.
    return { id: { in: [...scope] } };
  }

  /**
   * List, with an optional free-text filter.
   *
   * SEARCH IS NOT A SEPARATE AUTHORIZATION PATH. The query term narrows a set
   * that is already scoped; it can never widen it. A supervisor searching for a
   * family they do not supervise gets an empty result, and gets exactly the same
   * empty result whether that family exists or not -- so search cannot be used
   * to confirm which families are on the system.
   */
  async list(actor: Actor, query?: string, limit = 50): Promise<FamilySummary[]> {
    const permitted = this.authz.can(actor, Permission.FAMILIES_READ);
    if (!permitted.allowed) throw new CommError(permitted.code, permitted.reason);

    const scoped = await this.where(actor);
    const term = query?.trim();

    const rows = await this.prisma.family.findMany({
      where: term
        ? { AND: [scoped, { displayName: { contains: term, mode: 'insensitive' } }] }
        : scoped,
      include: { owner: { select: { id: true, name: true } } },
      orderBy: { displayName: 'asc' },
      take: Math.min(Math.max(limit, 1), 200),
    });

    return rows.map((f) => ({
      id: f.id,
      displayName: f.displayName,
      state: f.state,
      tier: f.tier,
      language: f.language,
      supervisorId: f.ownerId,
      supervisorName: f.owner?.name ?? null,
    }));
  }

  /**
   * One family, by id.
   *
   * THE IDOR DEFENCE. The scope predicate is part of the lookup, so a family
   * outside the actor's scope is not found rather than found-and-refused. The
   * response to a valid id and to a made-up one is identical, so changing an id
   * in a request reveals nothing -- not even whether the record exists.
   */
  async get(actor: Actor, familyId: string): Promise<FamilySummary> {
    const permitted = this.authz.can(actor, Permission.FAMILIES_READ);
    if (!permitted.allowed) throw new CommError(permitted.code, permitted.reason);

    const scoped = await this.where(actor);
    const family = await this.prisma.family.findFirst({
      where: { AND: [scoped, { id: familyId }] },
      include: { owner: { select: { id: true, name: true } } },
    });
    if (!family) {
      throw new CommError(CommErrorCode.CONVERSATION_NOT_FOUND, 'family not found', 404);
    }
    return {
      id: family.id,
      displayName: family.displayName,
      state: family.state,
      tier: family.tier,
      language: family.language,
      supervisorId: family.ownerId,
      supervisorName: family.owner?.name ?? null,
    };
  }

  async assignments(actor: Actor, familyId: string): Promise<AssignmentView[]> {
    await this.get(actor, familyId); // scope + existence, in one place
    const rows = await this.prisma.familyAssignment.findMany({
      where: { familyId },
      include: { staff: { select: { name: true } } },
      orderBy: { startsAt: 'desc' },
      take: 100,
    });
    return rows.map(toAssignmentView);
  }

  /**
   * Reassign the primary supervisor.
   *
   * Delegated to chat.assign_family_supervisor(), which ends the previous
   * assignment and opens the new one in ONE transaction. That atomicity is what
   * makes the access transition exact: there is no instant in which two
   * supervisors hold the family, and none in which nobody does. The previous
   * supervisor's next request is already out of scope, because scope is read
   * live from the table this statement just changed.
   */
  async assignSupervisor(
    actor: Actor,
    familyId: string,
    staffId: string,
    reason: string,
  ): Promise<AssignmentView> {
    const permitted = this.authz.can(actor, Permission.FAMILIES_ASSIGN);
    if (!permitted.allowed) throw new CommError(permitted.code, permitted.reason);
    requireReason(reason);
    await this.get(actor, familyId);

    const rows = await this.prisma.$queryRaw<Array<{ id: string }>>`
      select chat.assign_family_supervisor(
        ${familyId}::uuid, ${staffId}::uuid, ${reason}, ${actor.actorId}::uuid) as id
    `;
    const id = rows[0]?.id;
    const row = await this.prisma.familyAssignment.findUnique({
      where: { id },
      include: { staff: { select: { name: true } } },
    });
    if (!row) throw new CommError(CommErrorCode.CONVERSATION_NOT_FOUND, 'assignment not found', 404);
    return toAssignmentView(row);
  }

  /** Temporary cover: a bounded window, an explicit reason, a manager's act. */
  async startCover(
    actor: Actor,
    familyId: string,
    staffId: string,
    endsAt: Date,
    reason: string,
  ): Promise<AssignmentView> {
    const permitted = this.authz.can(actor, Permission.FAMILIES_ASSIGN);
    if (!permitted.allowed) throw new CommError(permitted.code, permitted.reason);
    requireReason(reason);
    await this.get(actor, familyId);

    const rows = await this.prisma.$queryRaw<Array<{ id: string }>>`
      select chat.start_family_cover(
        ${familyId}::uuid, ${staffId}::uuid, ${endsAt}::timestamptz, ${reason},
        ${actor.actorId}::uuid) as id
    `;
    const row = await this.prisma.familyAssignment.findUnique({
      where: { id: rows[0]?.id },
      include: { staff: { select: { name: true } } },
    });
    if (!row) throw new CommError(CommErrorCode.CONVERSATION_NOT_FOUND, 'assignment not found', 404);
    return toAssignmentView(row);
  }

  async endCover(actor: Actor, assignmentId: string, reason: string): Promise<void> {
    const permitted = this.authz.can(actor, Permission.FAMILIES_ASSIGN);
    if (!permitted.allowed) throw new CommError(permitted.code, permitted.reason);
    requireReason(reason);

    const assignment = await this.prisma.familyAssignment.findUnique({
      where: { id: assignmentId },
      select: { familyId: true },
    });
    if (!assignment) {
      throw new CommError(CommErrorCode.CONVERSATION_NOT_FOUND, 'assignment not found', 404);
    }
    await this.get(actor, assignment.familyId);

    await this.prisma.$queryRaw`
      select chat.end_family_assignment(${assignmentId}::uuid, ${reason}, ${actor.actorId}::uuid)
    `;
  }
}

function toAssignmentView(row: {
  id: string;
  familyId: string;
  staffId: string;
  kind: string;
  startsAt: Date;
  endsAt: Date | null;
  endedAt: Date | null;
  reason: string;
  staff?: { name: string } | null;
}): AssignmentView {
  return {
    id: row.id,
    familyId: row.familyId,
    staffId: row.staffId,
    staffName: row.staff?.name ?? null,
    kind: row.kind,
    startsAt: row.startsAt.toISOString(),
    endsAt: row.endsAt?.toISOString() ?? null,
    endedAt: row.endedAt?.toISOString() ?? null,
    reason: row.reason,
  };
}

function requireReason(reason: string): void {
  if (!reason || reason.trim().length === 0) {
    throw new CommError(
      CommErrorCode.APPROVAL_REASON_REQUIRED,
      'an assignment change must state a reason',
      400,
    );
  }
}
