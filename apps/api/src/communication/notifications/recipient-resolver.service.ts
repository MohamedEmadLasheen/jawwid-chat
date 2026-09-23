import { Inject, Injectable } from '@nestjs/common';
import { PrismaService } from '../../platform/prisma.service';
import { IDENTITY_SERVICE } from '../../platform/tokens';
import type { IdentityService } from '../../platform/identity.service';
import { ActorKind, Locale, MemberRole } from '../contracts/vocab';

/**
 * A resolved recipient, with everything the engine needs to address them
 * correctly and nothing it does not. There is no phone number and no email
 * here, because there is no such column anywhere in this schema.
 */
export interface ResolvedRecipient {
  actorId: string;
  kind: string;
  displayName: string;
  locale: Locale;
  /** Their role in the conversation this notification came from, when there is one. */
  memberRole?: string;
  familyId?: string | null;
  /** The child this notification is about, from THIS recipient's point of view. */
  learnerId?: string | null;
  learnerName?: string | null;
}

/**
 * RECIPIENT RESOLUTION.
 *
 * Who should be told, and which child is it about from their point of view.
 *
 * This is the step the product cares most about and the one most easily got
 * wrong. A parent with three children must never read "Class schedule changed"
 * -- they must read "Ahmed's class time changed" -- and the only way to
 * guarantee that is to resolve the child alongside the recipient, here, once,
 * rather than hoping each caller remembers to pass it.
 *
 * SECURITY: every resolution starts from a membership row or a family link that
 * already exists in the database. Nothing here takes a recipient list from a
 * caller, so a notification cannot be addressed to a family by asking for it.
 */
@Injectable()
export class RecipientResolver {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(IDENTITY_SERVICE) private readonly identity: IdentityService,
  ) {}

  /**
   * Everyone in a conversation except the author.
   *
   * Silent members are included: `is_silent` means "cannot speak here", not
   * "must not be told what was said" -- an observer admin still needs to know.
   * Members who have left are not.
   */
  async forConversation(
    conversationId: string,
    excludeActorId: string | null,
  ): Promise<ResolvedRecipient[]> {
    const conversation = await this.prisma.conversation.findUnique({
      where: { id: conversationId },
      select: { learnerId: true, familyId: true, learner: { select: { id: true, name: true } } },
    });

    const members = await this.prisma.conversationMember.findMany({
      where: { conversationId, leftAt: null },
    });

    const recipients: ResolvedRecipient[] = [];
    for (const member of members) {
      if (excludeActorId && member.actorId === excludeActorId) continue;

      const actor = await this.identity.resolveActor(member.actorId);
      // A deleted or deactivated account is not a delivery failure; it is not a
      // recipient. Recording a failure for it would fill the failure metrics
      // with people who have left.
      if (!actor || !actor.isActive) continue;

      recipients.push({
        actorId: actor.actorId,
        kind: actor.kind,
        displayName: actor.displayName,
        locale: actor.locale,
        memberRole: member.memberRole,
        familyId: actor.familyId ?? conversation?.familyId ?? null,
        // The child is only meaningful to the family side. A teacher does not
        // want "Ahmed's teacher sent you a message" about their own message,
        // and an admin covering forty families does not want a possessive at
        // all.
        learnerId: member.memberRole === MemberRole.PARENT ? (conversation?.learner?.id ?? null) : null,
        learnerName:
          member.memberRole === MemberRole.PARENT ? (conversation?.learner?.name ?? null) : null,
      });
    }
    return recipients;
  }

  /**
   * The contacts of a learner's family who may be messaged.
   *
   * `can_message` is the capability flag that says a contact is a communication
   * participant rather than merely a recorded relative; a grandparent listed
   * for pickup is not someone to push a schedule change to.
   */
  async forLearner(learnerId: string): Promise<ResolvedRecipient[]> {
    const learner = await this.prisma.learner.findUnique({
      where: { id: learnerId },
      include: { family: { select: { id: true, language: true } } },
    });
    if (!learner) return [];

    const contacts = await this.prisma.contact.findMany({
      where: { familyId: learner.familyId, isActive: true, canMessage: true },
    });

    return contacts.map((c) => ({
      actorId: c.id,
      kind: ActorKind.CONTACT,
      displayName: c.name,
      locale: (learner.family.language as Locale) ?? 'ar',
      memberRole: MemberRole.PARENT,
      familyId: c.familyId,
      learnerId: learner.id,
      learnerName: learner.name,
    }));
  }

  /** Every messageable contact of a family, with no particular child in view. */
  async forFamily(familyId: string): Promise<ResolvedRecipient[]> {
    const family = await this.prisma.family.findUnique({
      where: { id: familyId },
      select: { language: true },
    });
    const contacts = await this.prisma.contact.findMany({
      where: { familyId, isActive: true, canMessage: true },
    });

    return contacts.map((c) => ({
      actorId: c.id,
      kind: ActorKind.CONTACT,
      displayName: c.name,
      locale: (family?.language as Locale) ?? 'ar',
      memberRole: MemberRole.PARENT,
      familyId: c.familyId,
      learnerId: null,
      learnerName: null,
    }));
  }

  /**
   * Announcement audiences.
   *
   * `all_parents` is every messageable contact in the tenant. The set is
   * deliberately derived here rather than accepted from the admin who wrote the
   * announcement: "everyone" must mean the same thing every time it is used,
   * and it must not be possible to widen it by naming ids.
   */
  async forAudience(
    targetType: string,
    targetIds: readonly string[],
  ): Promise<ResolvedRecipient[]> {
    switch (targetType) {
      case 'all_parents':
        return this.contactsWhere({ isActive: true, canMessage: true });

      case 'contacts':
        return this.contactsWhere({
          id: { in: [...targetIds] },
          isActive: true,
          canMessage: true,
        });

      case 'families':
        return this.contactsWhere({
          familyId: { in: [...targetIds] },
          isActive: true,
          canMessage: true,
        });

      case 'learners': {
        // Deduplicated across children: a parent of two targeted learners is
        // one recipient of one announcement, not two.
        const seen = new Map<string, ResolvedRecipient>();
        for (const learnerId of targetIds) {
          for (const r of await this.forLearner(learnerId)) {
            if (!seen.has(r.actorId)) seen.set(r.actorId, { ...r, learnerId: null, learnerName: null });
          }
        }
        return [...seen.values()];
      }

      case 'all_teachers': {
        const teachers = await this.prisma.teacher.findMany({
          where: { isActive: true, leftAt: null },
        });
        return teachers.map((t) => ({
          actorId: t.id,
          kind: ActorKind.TEACHER,
          displayName: t.name,
          locale: 'ar' as Locale,
        }));
      }

      case 'all_staff': {
        const staff = await this.prisma.staff.findMany({
          where: { isActive: true, leftAt: null },
        });
        return staff.map((s) => ({
          actorId: s.id,
          kind: ActorKind.STAFF,
          displayName: s.name,
          locale: 'ar' as Locale,
        }));
      }

      default:
        return [];
    }
  }

  private async contactsWhere(where: Record<string, unknown>): Promise<ResolvedRecipient[]> {
    const contacts = await this.prisma.contact.findMany({
      where,
      include: { family: { select: { language: true } } },
    });
    return contacts.map((c) => ({
      actorId: c.id,
      kind: ActorKind.CONTACT,
      displayName: c.name,
      locale: (c.family.language as Locale) ?? 'ar',
      memberRole: MemberRole.PARENT,
      familyId: c.familyId,
      learnerId: null,
      learnerName: null,
    }));
  }
}
