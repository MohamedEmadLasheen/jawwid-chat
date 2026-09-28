import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../platform/prisma.service';
import { CommError, CommErrorCode } from '../../platform/errors';
import type { Actor } from '../../platform/types';
import {
  ActorKind,
  ConversationType,
  StoryAudienceKind,
  UNSCOPED_STORY_AUDIENCE_KINDS,
} from '../contracts/vocab';

/** One clause of an authored audience. */
export interface AudienceClause {
  kind: string;
  refId?: string | null;
}

export interface ResolvedRecipient {
  actorId: string;
  actorKind: string;
  /** Which clause first matched. Reporting only, never an authorization input. */
  matchedKind: string;
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
            { actorId: contact.id, actorKind: ActorKind.CONTACT, matchedKind: clause.kind },
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
  ): Promise<Array<{ actorId: string; actorKind: string }>> {
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
            select: { id: true },
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

    const liveContacts = new Set(contacts.map((c) => c.id));
    const liveTeachers = new Set(teachers.map((t) => t.id));
    return members.filter((m) =>
      m.actorKind === ActorKind.CONTACT ? liveContacts.has(m.actorId) : liveTeachers.has(m.actorId),
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
