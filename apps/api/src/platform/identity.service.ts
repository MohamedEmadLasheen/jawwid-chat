import { Injectable } from '@nestjs/common';
import { PrismaService } from './prisma.service';
import { Actor, SYSTEM_ACTOR } from './types';
import { ActorKind, Locale, StaffRole } from '../communication/contracts/vocab';

/**
 * PLATFORM SEAM - AI #1 OWNS THIS.
 *
 * Two resolutions, and the difference matters:
 *
 *   resolveActor(actorId)        by domain id. Used for ids the system already
 *                                trusts (an outbox row, a membership row).
 *   resolveForAccount(account)   by AUTHENTICATED ACCOUNT. This is the only
 *                                path a request's identity may take (PR-B):
 *                                verified JWT sub -> chat.account.subject ->
 *                                account -> principal -> Actor.
 *
 * A caller can never name the actor it wants to be. `resolveForAccount` starts
 * from a row the login proved, and the principal is found from the account --
 * not the other way round.
 */
export interface IdentityService {
  resolveActor(actorId: string): Promise<Actor | null>;
  resolveActors(refs: readonly ActorRef[]): Promise<ResolvedActors>;
  resolveForAccount(account: ResolvableAccount): Promise<Actor | null>;
}

/** The account fields identity resolution needs. Deliberately not the whole row. */
export interface ResolvableAccount {
  readonly id: string;
  readonly kind: string;
  readonly organizationId: string;
}

/**
 * A polymorphic reference to an actor.
 *
 * BOTH FIELDS ARE THE IDENTITY. `chat.staff`, `chat.contact` and `chat.teacher`
 * are three tables with independently generated uuids, so an id alone does not
 * name anybody: `STAFF:x` and `TEACHER:x` are different actors, and a map keyed
 * on the id alone would silently return one when asked for the other. Every
 * caller already has the kind — `conversation_member.actor_kind`,
 * `message.author_type`, `call_participant.actor_kind` — so nothing has to
 * discover it.
 */
export interface ActorRef {
  readonly actorId: string;
  readonly actorKind: string;
}

/**
 * Resolved actors, keyed by [actorRefKey].
 *
 * A key that is ABSENT means the actor does not resolve — it does not mean an
 * actor with no name. Callers must treat absence as unresolved and must not
 * substitute anything for it.
 */
export type ResolvedActors = ReadonlyMap<string, Actor>;

/**
 * The one spelling of an actor reference as a map key.
 *
 * Exported so no caller invents a second one. Two callers that agreed on the
 * shape of the map but disagreed on how to build its keys would produce
 * misses that look like unresolved actors.
 */
export function actorRefKey(ref: ActorRef): string {
  return `${ref.actorKind}:${ref.actorId}`;
}

@Injectable()
export class PrismaIdentityService implements IdentityService {
  constructor(private readonly prisma: PrismaService) {}

  async resolveActor(actorId: string): Promise<Actor | null> {
    if (actorId === SYSTEM_ACTOR.actorId) return SYSTEM_ACTOR;

    const staff = await this.prisma.staff.findUnique({ where: { id: actorId } });
    if (staff) return toStaffActor(staff);

    const contact = await this.prisma.contact.findUnique({
      where: { id: actorId },
      include: { family: true },
    });
    if (contact) return toContactActor(contact);

    // PR-A landed chat.teacher, so a teacher is a row with a name and an
    // is_active flag. The old synthesis -- "a teacher is any uuid that appears
    // in learner.teacher_id", displayName hard-coded 'Teacher', isActive always
    // true -- is deleted (IDENTITY-MODEL §2.1). An id with no teacher row is
    // now nobody, which is what it always should have been.
    const teacher = await this.prisma.teacher.findUnique({ where: { id: actorId } });
    if (teacher) return toTeacherActor(teacher);

    return null;
  }

  /**
   * Resolve many actors in a bounded number of queries.
   *
   * ## Why this exists
   *
   * `resolveActor` probes three tables in turn because it is given an id and no
   * kind. Called once per row it is the worst shape in the codebase: a
   * 100-message page would cost up to 300 sequential queries, and a message
   * author is not bounded by conversation membership (family-facing staff may
   * post in any conversation), so deduplicating by author does not bound it
   * either.
   *
   * Every caller that has a LIST already has the kind alongside each id. Given
   * the kind, one query per kind answers the whole list:
   *
   *     queries = number of DISTINCT KINDS PRESENT   (at most 3)
   *     queries ≠ number of rows
   *     queries ≠ number of distinct actors
   *
   * A kind with no references issues no query at all, so a conversation of only
   * contacts costs one.
   *
   * ## What it does not do
   *
   * It does not filter by activity and it does not filter by organization. It
   * answers "who is this", and `Actor.isActive` carries the liveness the same way
   * `resolveActor` does — so a caller that needs a live actor reads that field
   * rather than getting a silent miss it would have to interpret. Tenancy is the
   * caller's boundary here exactly as it is for `resolveActor`; both are reached
   * with ids the system already trusts.
   *
   * SYSTEM is answered without a query. An id that resolves to nothing is simply
   * absent from the map: no placeholder, no fabricated name.
   */
  async resolveActors(refs: readonly ActorRef[]): Promise<ResolvedActors> {
    const resolved = new Map<string, Actor>();
    if (refs.length === 0) return resolved;

    // Deduplicate on the COMPOSITE key, so one author appearing eighty times is
    // one lookup, and `STAFF:x` and `TEACHER:x` stay two.
    const wanted = new Map<string, ActorRef>();
    for (const ref of refs) {
      if (!ref.actorId) continue;
      wanted.set(actorRefKey(ref), ref);
    }

    const idsOfKind = (kind: string): string[] =>
      [...wanted.values()].filter((r) => r.actorKind === kind).map((r) => r.actorId);

    // No query for the system actor: it is a constant, not a row.
    for (const ref of wanted.values()) {
      if (ref.actorKind === ActorKind.SYSTEM) {
        resolved.set(actorRefKey(ref), SYSTEM_ACTOR);
      }
    }

    const staffIds = idsOfKind(ActorKind.STAFF);
    const contactIds = idsOfKind(ActorKind.CONTACT);
    const teacherIds = idsOfKind(ActorKind.TEACHER);

    const [staff, contacts, teachers] = await Promise.all([
      staffIds.length > 0
        ? this.prisma.staff.findMany({ where: { id: { in: staffIds } } })
        : Promise.resolve([]),
      contactIds.length > 0
        ? this.prisma.contact.findMany({
            where: { id: { in: contactIds } },
            include: { family: true },
          })
        : Promise.resolve([]),
      teacherIds.length > 0
        ? this.prisma.teacher.findMany({ where: { id: { in: teacherIds } } })
        : Promise.resolve([]),
    ]);

    for (const row of staff) {
      resolved.set(actorRefKey({ actorId: row.id, actorKind: ActorKind.STAFF }), toStaffActor(row));
    }
    for (const row of contacts) {
      resolved.set(
        actorRefKey({ actorId: row.id, actorKind: ActorKind.CONTACT }),
        toContactActor(row),
      );
    }
    for (const row of teachers) {
      resolved.set(
        actorRefKey({ actorId: row.id, actorKind: ActorKind.TEACHER }),
        toTeacherActor(row),
      );
    }

    return resolved;
  }

  /**
   * The production identity chain. `account.kind` decides which principal table
   * is consulted, so an account cannot resolve to a principal of another kind
   * even if a stale row links it.
   */
  async resolveForAccount(account: ResolvableAccount): Promise<Actor | null> {
    switch (account.kind) {
      case 'staff': {
        const staff = await this.prisma.staff.findFirst({ where: { accountId: account.id } });
        return staff ? toStaffActor(staff) : null;
      }
      case 'family': {
        const contact = await this.prisma.contact.findFirst({
          where: { accountId: account.id },
          include: { family: true },
        });
        return contact ? toContactActor(contact) : null;
      }
      case 'teacher': {
        const teacher = await this.prisma.teacher.findUnique({
          where: { accountId: account.id },
        });
        return teacher ? toTeacherActor(teacher) : null;
      }
      default:
        return null;
    }
  }
}

function toStaffActor(staff: {
  id: string;
  name: string;
  role: string;
  isActive: boolean;
  leftAt: Date | null;
  organizationId: string;
}): Actor {
  return {
    actorId: staff.id,
    kind: ActorKind.STAFF,
    displayName: staff.name,
    locale: 'ar',
    isActive: staff.isActive && staff.leftAt === null,
    staffRole: staff.role as StaffRole,
    organizationId: staff.organizationId,
  };
}

function toContactActor(contact: {
  id: string;
  name: string;
  isActive: boolean;
  familyId: string;
  canMessage: boolean;
  organizationId: string;
  family: { language: string };
}): Actor {
  return {
    actorId: contact.id,
    kind: ActorKind.CONTACT,
    displayName: contact.name,
    locale: contact.family.language as Locale,
    isActive: contact.isActive,
    familyId: contact.familyId,
    canMessage: contact.canMessage,
    organizationId: contact.organizationId,
  };
}

function toTeacherActor(teacher: {
  id: string;
  name: string;
  isActive: boolean;
  leftAt: Date | null;
  organizationId: string;
}): Actor {
  return {
    actorId: teacher.id,
    kind: ActorKind.TEACHER,
    displayName: teacher.name,
    locale: 'ar',
    // left_at is the offboarding record (IDENTITY-MODEL §5); a teacher who has
    // left is inactive even if nobody flipped is_active in the same statement.
    isActive: teacher.isActive && teacher.leftAt === null,
    organizationId: teacher.organizationId,
  };
}
