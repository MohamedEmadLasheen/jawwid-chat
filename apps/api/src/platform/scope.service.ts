import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from './prisma.service';
import { Actor } from './types';
import { ActorKind, ORGANIZATION_WIDE_STAFF_ROLES } from '../communication/contracts/vocab';

/**
 * SCOPE -- which records, as opposed to which actions.
 *
 * Canonical design: docs/architecture/SUPERVISOR-OWNERSHIP.md,
 * docs/architecture/AUTHORIZATION-MODEL.md 6.
 *
 * The defect this closes (red-team A-1 / RT-011): a role was the whole of
 * staff visibility. `canRead` returned allow() for any family-facing staff and
 * `listForActor` returned the 200 most recent conversations IN THE SYSTEM, so
 * every supervisor could read every family. Ownership existed -- it was used to
 * attribute a message as owner/coverage -- but nothing consulted it for access.
 *
 * The predicate, in one place:
 *
 *   parent          -> the family of their contact row
 *   teacher         -> the families of the learners they teach
 *   admin           -> families assigned to them (primary or live temporary)
 *   coverage_admin  -> families with a live temporary assignment to them
 *   manager,        -> every family in their organization
 *   super_admin
 *
 * It is read LIVE from chat.family_assignment on every call. There is no cache,
 * so a reassignment takes effect on the very next request: the previous
 * supervisor's next list call simply does not contain the family, and their
 * next read of it is refused. Nothing has to be invalidated and no session has
 * to be waited out.
 */

/** `ALL_FAMILIES` means "every family in the actor's organization", which is a
 *  predicate, not an enumeration -- materialising it would be wrong the moment
 *  a family is created mid-request. */
export const ALL_FAMILIES = Symbol('all-families-in-organization');
export type FamilyScope = readonly string[] | typeof ALL_FAMILIES;

@Injectable()
export class ScopeService {
  constructor(private readonly prisma: PrismaService) {}

  /** The families this actor may reach right now. */
  async visibleFamilies(actor: Actor, now: Date = new Date()): Promise<FamilyScope> {
    if (!actor.isActive) return [];

    if (actor.kind === ActorKind.SYSTEM) return ALL_FAMILIES;

    if (actor.kind === ActorKind.CONTACT) {
      return actor.familyId ? [actor.familyId] : [];
    }

    if (actor.kind === ActorKind.TEACHER) {
      const rows = await this.prisma.learner.findMany({
        where: { teacherId: actor.actorId },
        select: { familyId: true },
        distinct: ['familyId'],
      });
      return rows.map((r) => r.familyId);
    }

    // Staff.
    if (actor.department) return [];
    if (ORGANIZATION_WIDE_STAFF_ROLES.has(actor.staffRole ?? '')) return ALL_FAMILIES;

    // `starts_at` is deliberately NOT compared against this process's clock.
    // It is written by the database (default now()), and comparing a database
    // timestamp to an API-host timestamp makes scope depend on clock skew: a
    // few milliseconds of drift is enough for a just-created assignment to look
    // as though it has not started, which would silently deny a supervisor
    // their own family for the first seconds of its existence. No path creates
    // a future-dated start, so "the row exists" already means "it has started".
    //
    // `ends_at` IS compared, because it genuinely points into the future -- and
    // there the same drift is bounded by a cover window measured in days.
    const assignments = await this.prisma.familyAssignment.findMany({
      where: {
        staffId: actor.actorId,
        endedAt: null,
        OR: [{ endsAt: null }, { endsAt: { gt: now } }],
      },
      select: { familyId: true },
      distinct: ['familyId'],
    });
    return assignments.map((a) => a.familyId);
  }

  /** Is this specific family inside the actor's current scope? */
  async canAccessFamily(actor: Actor, familyId: string | null, now?: Date): Promise<boolean> {
    if (!familyId) return false;
    const scope = await this.visibleFamilies(actor, now);
    if (scope === ALL_FAMILIES) {
      // Organization-wide still means ONE organization.
      const family = await this.prisma.family.findUnique({
        where: { id: familyId },
        select: { organizationId: true },
      });
      return !!family && (!actor.organizationId || family.organizationId === actor.organizationId);
    }
    return scope.includes(familyId);
  }

  /**
   * The WHERE clause every conversation list must be built on, so scoping is a
   * property of the query rather than a filter someone remembered to apply.
   *
   * A conversation is visible when its family is in scope, OR when the actor is
   * a live member of it -- the second disjunct exists because a Teacher <-> Admin
   * direct conversation carries no family_id and would otherwise be invisible to
   * both of its participants.
   */
  async conversationWhere(
    actor: Actor,
    now: Date = new Date(),
  ): Promise<Prisma.ConversationWhereInput> {
    // MEMBERSHIP NARROWS, IT DOES NOT WIDEN (defect P3-2).
    //
    // This disjunct exists for ONE case: a Teacher <-> Admin direct conversation
    // carries no family_id, so neither participant could otherwise see it. It
    // was previously unconditional, which made it a second, weaker route to
    // family conversations -- a member row survives a supervisor reassignment,
    // so a FORMER supervisor kept seeing the family's conversations in their
    // list (title, last message preview, resolved member names) even though
    // canRead correctly refused to open them. Historical relationship was
    // granting current visibility, which is exactly what Phase 3 forbids.
    //
    // For staff the disjunct is therefore restricted to conversations with no
    // family: anything family-scoped must come from live scope and nothing else.
    // Contacts and teachers are unaffected -- their access IS membership, and
    // they hold no assignment-derived scope to escape.
    const membership: Prisma.ConversationWhereInput =
      actor.kind === ActorKind.STAFF
        ? {
            AND: [
              { familyId: null },
              { members: { some: { actorId: actor.actorId, leftAt: null } } },
            ],
          }
        : { members: { some: { actorId: actor.actorId, leftAt: null } } };

    if (!actor.isActive) {
      // An impossible predicate rather than an empty one: `{}` would match
      // everything, and a mistake here must fail closed.
      return { id: { in: [] } };
    }

    const scope = await this.visibleFamilies(actor, now);
    if (scope === ALL_FAMILIES) {
      return actor.organizationId
        ? { OR: [{ organizationId: actor.organizationId }, membership] }
        : { OR: [{ familyId: { not: null } }, membership] };
    }
    if (scope.length === 0) return membership;
    return { OR: [{ familyId: { in: [...scope] } }, membership] };
  }
}
