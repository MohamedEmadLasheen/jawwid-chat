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
import { ConversationService } from '../../communication/conversations/conversation.service';

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
    private readonly conversations: ConversationService,
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
  async list(
    actor: Actor,
    query?: string,
    limit = 50,
    /**
     * Label filter. Several ids INTERSECT -- "VIP + Renewal" means families
     * carrying both, not either.
     */
    labelIds: readonly string[] = [],
    /** Omit inactive families (state paused / churned). */
    activeOnly = false,
  ): Promise<FamilySummary[]> {
    const permitted = this.authz.can(actor, Permission.FAMILIES_READ);
    if (!permitted.allowed) throw new CommError(permitted.code, permitted.reason);

    const scoped = await this.where(actor);
    const term = query?.trim();

    const conditions: Prisma.FamilyWhereInput[] = [scoped];
    if (term) conditions.push({ displayName: { contains: term, mode: 'insensitive' } });
    if (activeOnly) conditions.push({ state: { in: [...ACTIVE_FAMILY_STATES] } });

    // INTERSECTION, done in the DATABASE. One `some` per label ANDs together,
    // and each is an index seek on chat.family_label's primary key -- never a
    // load-every-family-then-filter pass, which is both slow and a scope leak
    // waiting to happen.
    for (const labelId of new Set(labelIds)) {
      conditions.push({ labels: { some: { labelId, label: { deletedAt: null } } } });
    }

    const rows = await this.prisma.family.findMany({
      where: conditions.length === 1 ? scoped : { AND: conditions },
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

    await this.syncGroupsAfterTransfer(familyId);
    return toAssignmentView(row);
  }

  /**
   * Bring every student group of this family back in step with its supervisor
   * (defect P3-1).
   *
   * `API-CONTRACT.md` §3.3 has always specified this -- "every active
   * student_group of the family's learners is re-synced so the new supervisor
   * becomes the group's admin member and the old one leaves" -- and it was
   * never implemented. The consequence was not cosmetic: the outgoing
   * supervisor stayed a LIVE chat.conversation_member of the family's groups.
   * Their scope was gone, so canRead refused them, but the stale row was still
   * a membership, and membership is a second route into conversation
   * visibility. A historical relationship must never leave a live handle
   * behind.
   *
   * syncStudentGroup is Phase 2's existing reconciler and the only membership
   * mechanism used: it computes the desired member set from current facts --
   * family.owner_id (which chat.assign_family_supervisor has just moved through
   * its mirror trigger), the learner's teacher, and the messaging contacts --
   * then stamps left_at on everyone outside it. No second synchronisation
   * mechanism is introduced.
   *
   * No requester is passed. The membership change is a CONSEQUENCE of a
   * transfer that has already been authorized, not a fresh act by the caller --
   * the same contract the Core-ingestion and worker paths use. Passing the
   * actor would re-authorize the caller against a family whose ownership has,
   * by this point, deliberately just moved away from them.
   */
  private async syncGroupsAfterTransfer(familyId: string): Promise<void> {
    const learners = await this.prisma.learner.findMany({
      where: { familyId },
      select: { id: true },
    });
    // Sequential, not Promise.all: each sync opens its own transaction and
    // writes a system message, and a family with many students should not open
    // that many concurrent transactions on the same conversation rows.
    for (const learner of learners) {
      await this.conversations.syncStudentGroup(learner.id);
    }
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

  /**
   * Create a family.
   *
   * Requires `families.assign`, NOT `families.manage`: creating a family names
   * its supervisor, which is the supervisor-assignment act and a manager's to
   * take. The primary assignment row is opened by the
   * `family_opens_primary_assignment` trigger, so it cannot be forgotten here
   * or by any future creation path.
   */
  async createFamily(
    actor: Actor,
    input: { displayName: string; supervisorId: string; language?: string; tier?: string },
  ): Promise<FamilySummary> {
    const permitted = this.authz.can(actor, Permission.FAMILIES_ASSIGN);
    if (!permitted.allowed) throw new CommError(permitted.code, permitted.reason);
    const displayName = requireText(input.displayName, 'a family needs a name');

    try {
      return await this.prisma.$transaction(async (tx) => {
        const family = await tx.family.create({
          data: {
            displayName,
            ownerId: input.supervisorId,
            language: input.language ?? 'ar',
            tier: input.tier ?? 'standard',
          },
          include: { owner: { select: { id: true, name: true } } },
        });
        await this.audit.audit(tx, {
          actorId: actor.actorId,
          action: 'family.created',
          entity: 'family',
          entityId: family.id,
          reason: `family "${displayName}" created`,
          after: { displayName, supervisorId: input.supervisorId },
        });
        return toSummary(family);
      });
    } catch (error) {
      throw asCommError(error, 'the family could not be created');
    }
  }

  async updateFamily(
    actor: Actor,
    familyId: string,
    input: { displayName?: string; language?: string; tier?: string },
  ): Promise<FamilySummary> {
    const permitted = this.authz.can(actor, Permission.FAMILIES_MANAGE);
    if (!permitted.allowed) throw new CommError(permitted.code, permitted.reason);
    const before = await this.get(actor, familyId);

    const data: Record<string, unknown> = {};
    if (input.displayName !== undefined) {
      data.displayName = requireText(input.displayName, 'a family needs a name');
    }
    if (input.language !== undefined) data.language = input.language;
    if (input.tier !== undefined) data.tier = input.tier;
    if (Object.keys(data).length === 0) return before;

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.family.update({
        where: { id: familyId },
        data,
        include: { owner: { select: { id: true, name: true } } },
      });
      await this.audit.audit(tx, {
        actorId: actor.actorId,
        action: 'family.updated',
        entity: 'family',
        entityId: familyId,
        reason: 'family profile edited',
        before: { displayName: before.displayName },
        after: data,
      });
      return toSummary(updated);
    });
  }

  /**
   * Deactivate a family: `paused` (reversible) or `churned` (left).
   *
   * There is deliberately NO setFamilyState(any, any). An unrestricted state
   * mutation API is how `at_risk` and `renewal_due` -- both owned by the frozen
   * renewal machinery -- get manufactured by hand and quietly revive a
   * deprecated subsystem. chat.deactivate_family() validates the target against
   * a two-value allow-list, so those states have no operation that can reach
   * them.
   *
   * DEACTIVATION IS NOT DEAUTHORIZATION. The supervisor keeps the family in
   * scope -- they must, to wind it down or bring it back -- and no conversation
   * is touched. Business lifecycle and access are separate concepts, and
   * conflating them here would silently change Phase 2 messaging behaviour.
   */
  async deactivateFamily(
    actor: Actor,
    familyId: string,
    reason: string,
    state: 'paused' | 'churned' = 'paused',
  ): Promise<FamilySummary> {
    const permitted = this.authz.can(actor, Permission.FAMILIES_MANAGE);
    if (!permitted.allowed) throw new CommError(permitted.code, permitted.reason);
    await this.get(actor, familyId);
    const why = requireText(reason, 'a lifecycle change must state a reason');

    try {
      await this.prisma.$queryRaw`
        select chat.deactivate_family(
          ${familyId}::uuid, ${state}, ${why}, ${actor.actorId}::uuid)
      `;
    } catch (error) {
      throw asCommError(error, 'the family could not be deactivated');
    }
    return this.get(actor, familyId);
  }

  /** Reactivate a paused or churned family. */
  async activateFamily(actor: Actor, familyId: string, reason: string): Promise<FamilySummary> {
    const permitted = this.authz.can(actor, Permission.FAMILIES_MANAGE);
    if (!permitted.allowed) throw new CommError(permitted.code, permitted.reason);
    await this.get(actor, familyId);
    const why = requireText(reason, 'a lifecycle change must state a reason');

    try {
      await this.prisma.$queryRaw`
        select chat.activate_family(${familyId}::uuid, ${why}, ${actor.actorId}::uuid)
      `;
    } catch (error) {
      throw asCommError(error, 'the family could not be activated');
    }
    return this.get(actor, familyId);
  }

  /**
   * The family lifecycle history, from the EXISTING event log.
   *
   * `family_state_changed` already existed in chat.event_log's vocabulary, so
   * Phase 3 reuses it rather than adding a competing one.
   */
  async lifecycleHistory(
    actor: Actor,
    familyId: string,
  ): Promise<Array<{ at: string; from: string | null; to: string | null; reason: string | null }>> {
    await this.get(actor, familyId);
    const rows = await this.prisma.eventLog.findMany({
      where: { familyId, type: 'family_state_changed' },
      orderBy: { at: 'desc' },
      take: 100,
    });
    return rows.map((r) => {
      const p = (r.payload ?? {}) as Record<string, unknown>;
      return {
        at: r.at.toISOString(),
        from: (p.from_state as string) ?? null,
        to: (p.to_state as string) ?? null,
        reason: (p.reason as string) ?? null,
      };
    });
  }
}

/**
 * THE ACTIVE FAMILY STATES -- the TypeScript mirror of
 * chat.family_state_is_active(). There is deliberately no chat.family.is_active
 * column: ACTIVE/INACTIVE is derived from the six-value lifecycle the schema
 * already had, so the two can never disagree.
 *
 * `at_risk` and `renewal_due` are ACTIVE -- a family at risk is still a
 * customer -- but they belong to the FROZEN renewal machinery, so no Phase 3
 * operation can target them.
 */
export const ACTIVE_FAMILY_STATES = ['onboarding', 'active', 'at_risk', 'renewal_due'] as const;
export const INACTIVE_FAMILY_STATES = ['paused', 'churned'] as const;

export function familyStateIsActive(state: string): boolean {
  return (ACTIVE_FAMILY_STATES as readonly string[]).includes(state);
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

function toSummary(f: {
  id: string;
  displayName: string;
  state: string;
  tier: string;
  language: string;
  ownerId: string;
  owner?: { id: string; name: string } | null;
}): FamilySummary {
  return {
    id: f.id,
    displayName: f.displayName,
    state: f.state,
    tier: f.tier,
    language: f.language,
    supervisorId: f.ownerId,
    supervisorName: f.owner?.name ?? null,
  };
}

function requireText(value: string | undefined, message: string): string {
  const trimmed = (value ?? '').trim();
  if (trimmed.length === 0) {
    throw new CommError(CommErrorCode.APPROVAL_REASON_REQUIRED, message, 400);
  }
  return trimmed;
}

/** A database business rule that fired is a 400, not a 500. */
function asCommError(error: unknown, fallback: string): unknown {
  const message = (error as Error)?.message ?? '';
  if (/check_violation|restrict_violation|requires a reason|deactivated to|active admin|no such family/i.test(message)) {
    return new CommError(CommErrorCode.INVALID_PARTICIPANTS, message, 400);
  }
  if ((error as { code?: string })?.code === 'P2003') {
    return new CommError(CommErrorCode.INVALID_PARTICIPANTS, fallback, 400);
  }
  return error;
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
