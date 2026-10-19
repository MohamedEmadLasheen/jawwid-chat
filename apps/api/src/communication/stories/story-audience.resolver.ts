import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../platform/prisma.service';
import { CommError, CommErrorCode } from '../../platform/errors';
import type { Actor } from '../../platform/types';
import {
  ActorKind,
  ConversationType,
  StoryAudienceKind,
  SUBSCRIPTION_PLAN_MONTHS,
  UNSCOPED_STORY_AUDIENCE_KINDS,
} from '../contracts/vocab';

/** One clause of an authored audience. */
export interface AudienceClause {
  kind: string;
  refId?: string | null;
  /** kind = segment only. Parsed by `parseSegmentFilter`, never trusted as typed. */
  filter?: unknown;
}

/**
 * A `segment` clause: who, and -- for families -- which of them.
 *
 * Every dimension is a set of accepted values, ANDed with the others; an empty
 * or absent set accepts everyone. The family dimensions are only meaningful
 * when `who` is `families`: a teacher has no plan, no children and no country
 * in this schema, so a filter that named one for "everyone" would silently
 * drop every teacher -- refused instead.
 */
export interface StorySegmentFilter {
  who: 'everyone' | 'families' | 'teachers';
  /** Subscription PLAN length in months: 1, 3, 6, 12. */
  planMonths: number[];
  /** Number of children: 1, 2, 3, or 4 meaning "four or more". */
  children: number[];
  /** ISO 3166-1 alpha-2. */
  countries: string[];
}

export const CHILDREN_FOUR_OR_MORE = 4;

/** Validate a client-supplied segment filter. Throws STORY_AUDIENCE_INVALID. */
export function parseSegmentFilter(raw: unknown): StorySegmentFilter {
  const bad = (why: string) =>
    new CommError(CommErrorCode.STORY_AUDIENCE_INVALID, `segment: ${why}`, 400);
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw bad('a filter object is required');
  const o = raw as Record<string, unknown>;
  const known = new Set(['who', 'planMonths', 'children', 'countries']);
  for (const k of Object.keys(o)) if (!known.has(k)) throw bad(`unknown field "${k}"`);

  if (o.who !== 'everyone' && o.who !== 'families' && o.who !== 'teachers') {
    throw bad('"who" must be everyone, families or teachers');
  }
  const list = (key: string, ok: (v: unknown) => boolean, max: number): unknown[] => {
    const v = o[key];
    if (v === undefined || v === null) return [];
    if (!Array.isArray(v) || v.length > max || !v.every(ok)) throw bad(`"${key}" is not a valid list`);
    return [...new Set(v)];
  };
  const plans: readonly number[] = SUBSCRIPTION_PLAN_MONTHS;
  const filter: StorySegmentFilter = {
    who: o.who,
    planMonths: list('planMonths', (v) => typeof v === 'number' && plans.includes(v), 4) as number[],
    children: list(
      'children',
      (v) => typeof v === 'number' && Number.isInteger(v) && v >= 1 && v <= CHILDREN_FOUR_OR_MORE,
      4,
    ) as number[],
    countries: list('countries', (v) => typeof v === 'string' && /^[A-Z]{2}$/.test(v), 250) as string[],
  };
  const narrowed = filter.planMonths.length + filter.children.length + filter.countries.length > 0;
  if (narrowed && filter.who !== 'families') {
    throw bad('plan, children and country narrow families only; choose "families" to use them');
  }
  return filter;
}

/** True when a family with these facts is inside the filter. */
export function familyMatchesSegment(
  f: StorySegmentFilter,
  family: { countryCode: string | null; subscriptionPlanMonths: number | null; childCount: number },
): boolean {
  if (f.countries.length && (!family.countryCode || !f.countries.includes(family.countryCode))) return false;
  if (
    f.planMonths.length &&
    (family.subscriptionPlanMonths === null || !f.planMonths.includes(family.subscriptionPlanMonths))
  ) {
    return false;
  }
  if (f.children.length) {
    const bucket = Math.min(family.childCount, CHILDREN_FOUR_OR_MORE);
    if (family.childCount === 0 || !f.children.includes(bucket)) return false;
  }
  return true;
}

export interface ResolvedRecipient {
  actorId: string;
  actorKind: string;
  /** Which clause first matched. Reporting only, never an authorization input. */
  matchedKind: string;
  /** A contact's family. Used to honour the message-the-publisher reach rule. */
  familyId?: string | null;
}

export interface ResolvedAudience {
  recipients: ResolvedRecipient[];
  /** Distinct families reached, for the publisher's confirmation screen. */
  familyCount: number;
}

/**
 * Turns an authored audience into people.
 *
 * ## The two rules this file exists to hold
 *
 * 1. A CLIENT NEVER NAMES A RECIPIENT. Every route takes clauses ("all
 *    families", "this class group") and never actor ids. There is no field
 *    anywhere on the story API that a caller could use to add somebody to an
 *    audience directly, so "can a publisher push a story at an arbitrary
 *    person?" is not a check that can be forgotten -- it is unrepresentable.
 *
 * 2. EVERY CLAUSE IS VALIDATED UNDER THE AUTHOR'S OWN SCOPE. Holding the
 *    publisher role is necessary and not sufficient. A clause naming a family,
 *    teacher, contact or conversation outside the author's organization is
 *    refused, so a forged or copied id reaches nobody.
 *
 * ## Why refusal is loud
 *
 * An out-of-scope clause raises STORY_AUDIENCE_INVALID rather than silently
 * resolving to zero people. Silence would mean an operator who fat-fingers a
 * group id publishes to a smaller audience than they believe they did, and only
 * finds out from the delivery count -- which is the kind of near-miss that reads
 * as "stories are unreliable". It leaks nothing: cross-tenant ids are refused
 * identically to nonexistent ones, because both fail the same organization
 * filter.
 *
 * ## Who can be a recipient
 *
 * Family contacts who are ACTIVE and hold `can_message`, and teachers who are
 * ACTIVE and have not left. `can_message` is reused deliberately rather than
 * invented: it is already what this authorization model means by "a family
 * contact who may communicate" (chat.teacher_parent_authorized,
 * 20260923120000), and a story is communication addressed at them. Staff are
 * never recipients -- a publisher reads the organization's stories through the
 * publisher surface, not through a feed addressed to them.
 */
@Injectable()
export class StoryAudienceResolver {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Validate clauses and resolve them to people.
   *
   * Called twice per story and that is deliberate: once at CREATE so the author
   * is told immediately that a clause is unusable, and again at PUBLISH so the
   * snapshot reflects who exists at the moment it goes out rather than who
   * existed while it was being drafted.
   */
  async resolve(author: Actor, clauses: AudienceClause[]): Promise<ResolvedAudience> {
    if (clauses.length === 0) {
      throw new CommError(
        CommErrorCode.STORY_AUDIENCE_EMPTY,
        'a story needs at least one audience clause',
        400,
      );
    }

    for (const clause of clauses) {
      this.assertWellFormed(clause);
    }

    // Deduplicated here as well as by the primary key. The key makes a duplicate
    // row impossible; this makes the RESOLVED COUNT the publisher is shown the
    // number of people rather than the number of matches.
    const byActor = new Map<string, ResolvedRecipient>();
    const familyIds = new Set<string>();

    for (const clause of clauses) {
      const matched = await this.resolveClause(author, clause);
      for (const r of matched.recipients) {
        if (!byActor.has(r.actorId)) byActor.set(r.actorId, r);
      }
      for (const f of matched.familyIds) familyIds.add(f);
    }

    return { recipients: [...byActor.values()], familyCount: familyIds.size };
  }

  private assertWellFormed(clause: AudienceClause): void {
    const kinds: readonly string[] = Object.values(StoryAudienceKind);
    if (!kinds.includes(clause.kind)) {
      throw new CommError(
        CommErrorCode.STORY_AUDIENCE_INVALID,
        `unknown audience kind "${clause.kind}"`,
        400,
      );
    }
    if (clause.kind === StoryAudienceKind.SEGMENT) {
      parseSegmentFilter(clause.filter);
    } else if (clause.filter !== undefined && clause.filter !== null) {
      throw new CommError(
        CommErrorCode.STORY_AUDIENCE_INVALID,
        `audience kind "${clause.kind}" takes no filter`,
        400,
      );
    }
    const unscoped = UNSCOPED_STORY_AUDIENCE_KINDS.has(clause.kind);
    if (unscoped && clause.refId) {
      throw new CommError(
        CommErrorCode.STORY_AUDIENCE_INVALID,
        `audience kind "${clause.kind}" names no particular record and takes no refId`,
        400,
      );
    }
    if (!unscoped && !clause.refId) {
      throw new CommError(
        CommErrorCode.STORY_AUDIENCE_INVALID,
        `audience kind "${clause.kind}" requires a refId`,
        400,
      );
    }
  }

  private async resolveClause(
    author: Actor,
    clause: AudienceClause,
  ): Promise<{ recipients: ResolvedRecipient[]; familyIds: string[] }> {
    // Every query below is filtered by the author's own organization. It is the
    // outermost scope and is applied even for the clauses that look global:
    // `all_families` means every family in THIS academy.
    const org = author.organizationId;

    switch (clause.kind) {
      case StoryAudienceKind.ALL_FAMILIES:
        return this.contactsWhere({ ...(org ? { organizationId: org } : {}) }, clause.kind);

      case StoryAudienceKind.ALL_TEACHERS:
        return this.teachersWhere({ ...(org ? { organizationId: org } : {}) }, clause.kind);

      case StoryAudienceKind.ASSIGNED_FAMILIES: {
        // The families this staff member supervises. chat.family.owner_id is the
        // supervisor relationship (SUPERVISOR-OWNERSHIP.md) -- NOT
        // chat.learner.teacher_id, which links teachers to families and says
        // nothing about a staff author.
        const families = await this.prisma.family.findMany({
          where: { ownerId: author.actorId, ...(org ? { organizationId: org } : {}) },
          select: { id: true },
        });
        if (families.length === 0) return { recipients: [], familyIds: [] };
        return this.contactsWhere(
          { familyId: { in: families.map((f) => f.id) }, ...(org ? { organizationId: org } : {}) },
          clause.kind,
        );
      }

      case StoryAudienceKind.SEGMENT: {
        const filter = parseSegmentFilter(clause.filter);
        const orgWhere = org ? { organizationId: org } : {};
        if (filter.who === 'teachers') return this.teachersWhere(orgWhere, clause.kind);
        const families = await this.contactsWhere(
          { ...orgWhere, ...(await this.segmentFamilyWhere(filter, org)) },
          clause.kind,
        );
        if (filter.who === 'families') return families;
        const teachers = await this.teachersWhere(orgWhere, clause.kind);
        return {
          recipients: [...families.recipients, ...teachers.recipients],
          familyIds: families.familyIds,
        };
      }

      case StoryAudienceKind.FAMILY: {
        const family = await this.prisma.family.findFirst({
          where: { id: clause.refId!, ...(org ? { organizationId: org } : {}) },
          select: { id: true },
        });
        if (!family) throw this.outOfScope('family', clause.refId!);
        return this.contactsWhere(
          { familyId: family.id, ...(org ? { organizationId: org } : {}) },
          clause.kind,
        );
      }

      case StoryAudienceKind.TEACHER: {
        const teacher = await this.prisma.teacher.findFirst({
          where: {
            id: clause.refId!,
            isActive: true,
            leftAt: null,
            ...(org ? { organizationId: org } : {}),
          },
          select: { id: true },
        });
        if (!teacher) throw this.outOfScope('teacher', clause.refId!);
        return {
          recipients: [
            { actorId: teacher.id, actorKind: ActorKind.TEACHER, matchedKind: clause.kind },
          ],
          familyIds: [],
        };
      }

      case StoryAudienceKind.CONTACT: {
        const contact = await this.prisma.contact.findFirst({
          where: {
            id: clause.refId!,
            isActive: true,
            canMessage: true,
            ...(org ? { organizationId: org } : {}),
          },
          select: { id: true, familyId: true },
        });
        if (!contact) throw this.outOfScope('contact', clause.refId!);
        return {
          recipients: [
            {
              actorId: contact.id,
              actorKind: ActorKind.CONTACT,
              matchedKind: clause.kind,
              familyId: contact.familyId,
            },
          ],
          familyIds: [contact.familyId],
        };
      }

      case StoryAudienceKind.CONVERSATION: {
        // A "group" on this schema IS a conversation. Only the group types are
        // addressable: publishing to a `direct` conversation would be a story
        // aimed at one pair, which is a message, and to an `official` thread
        // would duplicate broadcast.
        const conversation = await this.prisma.conversation.findFirst({
          where: {
            id: clause.refId!,
            type: { in: [ConversationType.STUDENT_GROUP, ConversationType.CLASS_GROUP] },
            archivedAt: null,
            ...(org ? { organizationId: org } : {}),
          },
          select: { id: true, familyId: true },
        });
        if (!conversation) throw this.outOfScope('conversation', clause.refId!);

        const members = await this.prisma.conversationMember.findMany({
          where: {
            conversationId: conversation.id,
            leftAt: null,
            // Staff sit in groups to moderate them; a story is not addressed to
            // the moderators.
            actorKind: { in: [ActorKind.CONTACT, ActorKind.TEACHER] },
          },
          select: { actorId: true, actorKind: true },
        });

        // Membership alone is not enough: a member who has since been
        // deactivated must not be handed a new publication. Re-checked against
        // the live rows rather than trusted from the membership table.
        const live = await this.filterLiveActors(members, org);
        return {
          recipients: live.map((m) => ({ ...m, matchedKind: clause.kind })),
          familyIds: conversation.familyId ? [conversation.familyId] : [],
        };
      }

      default:
        throw new CommError(
          CommErrorCode.STORY_AUDIENCE_INVALID,
          `unknown audience kind "${clause.kind}"`,
          400,
        );
    }
  }

  /**
   * The family half of a segment, as a contact WHERE.
   *
   * Country and plan are columns, so they filter in SQL. Number of children is
   * derived -- a count of chat.learner, never a stored number that could go
   * stale -- so the families are counted here and the matching ids handed back.
   * With no family dimension at all this is "every family", the same as
   * all_families.
   */
  private async segmentFamilyWhere(
    filter: StorySegmentFilter,
    org: string | undefined,
  ): Promise<Record<string, unknown>> {
    if (filter.who !== 'families' || (!filter.countries.length && !filter.planMonths.length && !filter.children.length)) {
      return {};
    }
    const families = await this.prisma.family.findMany({
      where: {
        ...(org ? { organizationId: org } : {}),
        ...(filter.countries.length ? { countryCode: { in: filter.countries } } : {}),
        ...(filter.planMonths.length ? { subscriptionPlanMonths: { in: filter.planMonths } } : {}),
      },
      select: { id: true, countryCode: true, subscriptionPlanMonths: true, _count: { select: { learners: true } } },
    });
    const ids = families
      .filter((f) =>
        familyMatchesSegment(filter, {
          countryCode: f.countryCode,
          subscriptionPlanMonths: f.subscriptionPlanMonths,
          childCount: f._count.learners,
        }),
      )
      .map((f) => f.id);
    return { familyId: { in: ids } };
  }

  private async contactsWhere(
    where: Record<string, unknown>,
    matchedKind: string,
  ): Promise<{ recipients: ResolvedRecipient[]; familyIds: string[] }> {
    const contacts = await this.prisma.contact.findMany({
      where: { ...where, isActive: true, canMessage: true },
      select: { id: true, familyId: true },
    });
    return {
      recipients: contacts.map((c) => ({
        actorId: c.id,
        actorKind: ActorKind.CONTACT,
        matchedKind,
        familyId: c.familyId,
      })),
      familyIds: contacts.map((c) => c.familyId),
    };
  }

  private async teachersWhere(
    where: Record<string, unknown>,
    matchedKind: string,
  ): Promise<{ recipients: ResolvedRecipient[]; familyIds: string[] }> {
    const teachers = await this.prisma.teacher.findMany({
      where: { ...where, isActive: true, leftAt: null },
      select: { id: true },
    });
    return {
      recipients: teachers.map((t) => ({
        actorId: t.id,
        actorKind: ActorKind.TEACHER,
        matchedKind,
      })),
      familyIds: [],
    };
  }

  /** Keep only the members who are still active on their own table. */
  private async filterLiveActors(
    members: Array<{ actorId: string; actorKind: string }>,
    org: string | undefined,
  ): Promise<Array<{ actorId: string; actorKind: string; familyId?: string | null }>> {
    const contactIds = members.filter((m) => m.actorKind === ActorKind.CONTACT).map((m) => m.actorId);
    const teacherIds = members.filter((m) => m.actorKind === ActorKind.TEACHER).map((m) => m.actorId);

    const [contacts, teachers] = await Promise.all([
      contactIds.length
        ? this.prisma.contact.findMany({
            where: {
              id: { in: contactIds },
              isActive: true,
              canMessage: true,
              ...(org ? { organizationId: org } : {}),
            },
            select: { id: true, familyId: true },
          })
        : Promise.resolve([]),
      teacherIds.length
        ? this.prisma.teacher.findMany({
            where: {
              id: { in: teacherIds },
              isActive: true,
              leftAt: null,
              ...(org ? { organizationId: org } : {}),
            },
            select: { id: true },
          })
        : Promise.resolve([]),
    ]);

    const liveContacts = new Map(contacts.map((c) => [c.id, c.familyId]));
    const liveTeachers = new Set(teachers.map((t) => t.id));
    return members
      .filter((m) =>
        m.actorKind === ActorKind.CONTACT ? liveContacts.has(m.actorId) : liveTeachers.has(m.actorId),
      )
      .map((m) =>
        m.actorKind === ActorKind.CONTACT ? { ...m, familyId: liveContacts.get(m.actorId) ?? null } : m,
      );
  }

  /**
   * One message shape for "does not exist", "belongs to another academy" and
   * "is no longer active". Distinguishing them would let a publisher probe for
   * the existence of another tenant's records.
   */
  private outOfScope(kind: string, refId: string): CommError {
    return new CommError(
      CommErrorCode.STORY_AUDIENCE_INVALID,
      `${kind} ${refId} is not an audience you may address`,
      400,
    );
  }
}
