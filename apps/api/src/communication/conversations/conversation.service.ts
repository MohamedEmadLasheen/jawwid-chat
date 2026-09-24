import { Inject, Injectable } from '@nestjs/common';
import { Conversation, ConversationMember, Prisma } from '@prisma/client';
import { PrismaService } from '../../platform/prisma.service';
import { AuthorizationService } from '../../platform/authorization.service';
import type { LiveMember } from '../../platform/authorization.service';
import { CommError, CommErrorCode } from '../../platform/errors';
import { AUDIT_SERVICE, COVERAGE_SERVICE, IDENTITY_SERVICE } from '../../platform/tokens';
import type { IdentityService } from '../../platform/identity.service';
import type { CoverageService } from '../../platform/coverage.service';
import type { AuditService } from '../../platform/audit.service';
import { Actor } from '../../platform/types';
import { OutboxService } from '../outbox/outbox.service';
import { CommEvent } from '../contracts/events';
import {
  ActorKind,
  ConversationType,
  MemberRole,
  MessageType,
  Origin,
  Visibility,
} from '../contracts/vocab';

export interface MemberSpec {
  actorId: string;
  actorKind: string;
  memberRole: string;
  isSilent?: boolean;
}

@Injectable()
export class ConversationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly authz: AuthorizationService,
    private readonly outbox: OutboxService,
    @Inject(IDENTITY_SERVICE) private readonly identity: IdentityService,
    @Inject(COVERAGE_SERVICE) private readonly coverage: CoverageService,
    @Inject(AUDIT_SERVICE) private readonly audit: AuditService,
  ) {}

  async requireActor(actorId: string): Promise<Actor> {
    const actor = await this.identity.resolveActor(actorId);
    if (!actor) throw new CommError(CommErrorCode.UNKNOWN_ACTOR, 'unknown actor', 401);
    return actor;
  }

  /**
   * May this actor act on this learner at all?
   *
   * The gap this closes: `learnerId` travels to a parent's device in every
   * class notification's push payload, and two routes accepted one and answered
   * with the learner's student-group conversation -- id, family id, title,
   * activity -- without asking who was calling. Any authenticated session could
   * read another family's group by naming their child, and the sync route also
   * WROTE to it.
   *
   * The rule mirrors who is in that group: the family's own contacts, the
   * learner's teacher, and staff. Refusals are CONVERSATION_NOT_FOUND rather
   * than a distinct "not yours", so a learner id cannot be probed for
   * existence.
   */
  private async requireLearnerAccess(
    learner: { id: string; familyId: string; teacherId: string | null },
    actorId: string,
  ): Promise<void> {
    const actor = await this.requireActor(actorId);

    const permitted =
      actor.kind === ActorKind.STAFF ||
      (actor.kind === ActorKind.TEACHER && learner.teacherId === actor.actorId) ||
      (actor.kind === ActorKind.CONTACT && actor.familyId === learner.familyId);

    if (!permitted) {
      throw new CommError(
        CommErrorCode.CONVERSATION_NOT_FOUND,
        'conversation not found',
        404,
      );
    }
  }

  async requireConversation(id: string): Promise<Conversation> {
    const conv = await this.prisma.conversation.findUnique({ where: { id } });
    if (!conv) {
      throw new CommError(CommErrorCode.CONVERSATION_NOT_FOUND, 'conversation not found', 404);
    }
    return conv;
  }

  async membershipOf(conversationId: string, actorId: string): Promise<ConversationMember | null> {
    return this.prisma.conversationMember.findFirst({
      where: { conversationId, actorId, leftAt: null },
    });
  }

  /**
   * Live membership with resolved activity, for the C-4 admin-presence check.
   *
   * Only staff-admin members have their identity resolved: they are the only
   * members whose activity decides the rule, and resolving every member of a
   * group on every send would be a per-message cost for no decision. Everyone
   * else is returned with isActive undefined, which the policy reads as
   * "not resolved", never as "inactive".
   */
  async liveMembersOf(conversationId: string): Promise<LiveMember[]> {
    const rows = await this.prisma.conversationMember.findMany({
      where: { conversationId, leftAt: null },
    });
    return Promise.all(
      rows.map(async (m) => {
        if (m.actorKind === ActorKind.STAFF && m.memberRole === MemberRole.ADMIN) {
          const a = await this.identity.resolveActor(m.actorId);
          return {
            actorId: m.actorId,
            actorKind: m.actorKind,
            memberRole: m.memberRole,
            isActive: a?.isActive ?? false,
          };
        }
        return { actorId: m.actorId, actorKind: m.actorKind, memberRole: m.memberRole };
      }),
    );
  }

  /** Canonical, order-independent identity of a 1:1 channel. */
  static directKey(a: string, b: string): string {
    return [a, b].sort().join(':');
  }

  // ------------------------------------------------------------------
  // Direct conversations
  // ------------------------------------------------------------------

  /**
   * Get or create the 1:1 channel between two actors.
   *
   * Authorization happens BEFORE any row is written, so an unauthorized pair
   * never produces a conversation. Duplicate creation is impossible: direct_key
   * is unique, and a lost race re-reads rather than trusting our own check.
   */
  async getOrCreateDirect(requesterId: string, otherId: string): Promise<Conversation> {
    const a = await this.requireActor(requesterId);
    const b = await this.requireActor(otherId);

    const decision = this.authz.canOpenDirect(a, b);
    if (!decision.allowed) throw new CommError(decision.code, decision.reason);

    const key = ConversationService.directKey(a.actorId, b.actorId);
    const existing = await this.prisma.conversation.findUnique({ where: { directKey: key } });
    if (existing) return existing;

    // The family context is whichever side is a family contact.
    const contact = a.kind === ActorKind.CONTACT ? a : b.kind === ActorKind.CONTACT ? b : null;
    const familyId = contact?.familyId ?? null;

    try {
      return await this.prisma.$transaction(async (tx) => {
        const conv = await tx.conversation.create({
          data: {
            type: ConversationType.DIRECT,
            directKey: key,
            familyId,
            title: null,
          },
        });

        await tx.conversationMember.createMany({
          data: [a, b].map((actor) => ({
            conversationId: conv.id,
            actorId: actor.actorId,
            actorKind: actor.kind,
            memberRole: ConversationService.roleFor(actor),
          })),
        });

        await this.audit.event(tx, {
          familyId,
          actorKind: a.kind,
          actorId: a.actorId,
          type: 'conversation_created',
          payload: { conversationId: conv.id, type: ConversationType.DIRECT },
        });

        return conv;
      });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        const conv = await this.prisma.conversation.findUnique({ where: { directKey: key } });
        if (conv) return conv;
      }
      throw e;
    }
  }

  private static roleFor(actor: Actor): string {
    if (actor.kind === ActorKind.CONTACT) return MemberRole.PARENT;
    if (actor.kind === ActorKind.TEACHER) return MemberRole.TEACHER;
    return MemberRole.ADMIN;
  }

  // ------------------------------------------------------------------
  // Student groups
  // ------------------------------------------------------------------

  /**
   * Create the official group for a learner from Jawwid Core relationships.
   *
   * Members are derived from data, never supplied by a client: the family's
   * messaging contacts, the assigned teacher, and the family's primary owner.
   * A partial unique index guarantees one live group per learner.
   */
  async ensureStudentGroup(learnerId: string, actorId?: string): Promise<Conversation> {
    const learner = await this.prisma.learner.findUnique({
      where: { id: learnerId },
      include: { family: { include: { contacts: { where: { isActive: true } } } } },
    });
    if (!learner) {
      throw new CommError(CommErrorCode.CONVERSATION_NOT_FOUND, 'learner not found', 404);
    }
    // A learner id is not a credential. It reaches a parent's device in every
    // class notification's push payload, so an endpoint that accepts one and
    // answers with a conversation has to check who is asking.
    if (actorId) await this.requireLearnerAccess(learner, actorId);

    const existing = await this.prisma.conversation.findFirst({
      where: {
        learnerId,
        type: ConversationType.STUDENT_GROUP,
        archivedAt: null,
      },
    });
    if (existing) return existing;

    const members: MemberSpec[] = [
      ...learner.family.contacts
        .filter((c) => c.canMessage)
        .map((c) => ({
          actorId: c.id,
          actorKind: ActorKind.CONTACT,
          memberRole: MemberRole.PARENT,
        })),
      {
        actorId: learner.family.ownerId,
        actorKind: ActorKind.STAFF,
        memberRole: MemberRole.ADMIN,
      },
    ];
    if (learner.teacherId) {
      members.push({
        actorId: learner.teacherId,
        actorKind: ActorKind.TEACHER,
        memberRole: MemberRole.TEACHER,
      });
    }

    return this.prisma.$transaction(async (tx) => {
      const conv = await tx.conversation.create({
        data: {
          type: ConversationType.STUDENT_GROUP,
          familyId: learner.familyId,
          learnerId: learner.id,
          title: `${learner.name} · Jawwid`,
        },
      });

      await tx.conversationMember.createMany({
        data: members.map((m) => ({
          conversationId: conv.id,
          actorId: m.actorId,
          actorKind: m.actorKind,
          memberRole: m.memberRole,
          isSilent: m.isSilent ?? false,
          addedBy: actorId ?? null,
        })),
      });

      await this.systemMessage(tx, conv.id, 'group.created', {
        learner: learner.name,
      });

      await this.audit.event(tx, {
        familyId: learner.familyId,
        actorKind: ActorKind.SYSTEM,
        actorId: null,
        type: 'student_group_created',
        payload: { conversationId: conv.id, learnerId },
      });

      return conv;
    });
  }

  /**
   * Reconcile a group's membership with current Core relationships.
   *
   * Called when the assigned teacher changes, a contact is added or
   * deactivated, or ownership is transferred. Departures are recorded with
   * left_at rather than deleted, and every change writes a system message so the
   * group can see what happened.
   */
  async syncStudentGroup(learnerId: string, actorId?: string): Promise<Conversation | null> {
    const learner = await this.prisma.learner.findUnique({
      where: { id: learnerId },
      include: { family: { include: { contacts: { where: { isActive: true } } } } },
    });
    if (!learner) return null;
    if (actorId) await this.requireLearnerAccess(learner, actorId);

    const conv = await this.prisma.conversation.findFirst({
      where: { learnerId, type: ConversationType.STUDENT_GROUP, archivedAt: null },
    });
    if (!conv) return null;

    const desired = new Map<string, MemberSpec>();
    for (const c of learner.family.contacts.filter((c) => c.canMessage)) {
      desired.set(c.id, {
        actorId: c.id,
        actorKind: ActorKind.CONTACT,
        memberRole: MemberRole.PARENT,
      });
    }
    desired.set(learner.family.ownerId, {
      actorId: learner.family.ownerId,
      actorKind: ActorKind.STAFF,
      memberRole: MemberRole.ADMIN,
    });
    if (learner.teacherId) {
      desired.set(learner.teacherId, {
        actorId: learner.teacherId,
        actorKind: ActorKind.TEACHER,
        memberRole: MemberRole.TEACHER,
      });
    }

    const current = await this.prisma.conversationMember.findMany({
      where: { conversationId: conv.id, leftAt: null },
    });
    const currentIds = new Set(current.map((m) => m.actorId));

    const toAdd = [...desired.values()].filter((m) => !currentIds.has(m.actorId));
    const toRemove = current.filter((m) => !desired.has(m.actorId));

    if (toAdd.length === 0 && toRemove.length === 0) return conv;

    await this.prisma.$transaction(async (tx) => {
      if (toRemove.length > 0) {
        await tx.conversationMember.updateMany({
          where: { id: { in: toRemove.map((m) => m.id) } },
          data: { leftAt: new Date() },
        });
      }
      if (toAdd.length > 0) {
        await tx.conversationMember.createMany({
          data: toAdd.map((m) => ({
            conversationId: conv.id,
            actorId: m.actorId,
            actorKind: m.actorKind,
            memberRole: m.memberRole,
          })),
        });
      }

      await this.systemMessage(tx, conv.id, 'group.membership_changed', {
        added: toAdd.length,
        removed: toRemove.length,
      });

      await this.outbox.enqueue(tx, CommEvent.MEMBERSHIP_CHANGED, {
        conversationId: conv.id,
        added: toAdd.map((m) => m.actorId),
        removed: toRemove.map((m) => m.actorId),
      });

      await this.audit.event(tx, {
        familyId: learner.familyId,
        actorKind: ActorKind.SYSTEM,
        actorId: null,
        type: 'student_group_membership_synced',
        payload: { conversationId: conv.id, added: toAdd.length, removed: toRemove.length },
      });
    });

    return conv;
  }

  /**
   * A student leaving Jawwid archives the group. It is never hard-deleted:
   * historical messages remain readable under RBAC.
   */
  async archiveStudentGroup(learnerId: string, reason: string, actorId?: string): Promise<void> {
    const conv = await this.prisma.conversation.findFirst({
      where: { learnerId, type: ConversationType.STUDENT_GROUP, archivedAt: null },
    });
    if (!conv) return;

    await this.prisma.$transaction(async (tx) => {
      await tx.conversation.update({
        where: { id: conv.id },
        data: { archivedAt: new Date() },
      });
      await this.systemMessage(tx, conv.id, 'group.archived', { reason });
      await this.audit.audit(tx, {
        actorId: actorId ?? null,
        action: 'student_group.archived',
        entity: 'conversation',
        entityId: conv.id,
        reason,
      });
    });
  }

  /**
   * Membership mutations are staff-only. A teacher or a parent calling this is
   * rejected regardless of what the client sends.
   */
  async setMembership(
    conversationId: string,
    requesterId: string,
    spec: MemberSpec,
    action: 'add' | 'remove',
    reason: string,
  ): Promise<void> {
    const actor = await this.requireActor(requesterId);
    const decision = this.authz.canManageMembership(actor);
    if (!decision.allowed) throw new CommError(decision.code, decision.reason);

    const conv = await this.requireConversation(conversationId);

    await this.prisma.$transaction(async (tx) => {
      if (action === 'add') {
        await tx.conversationMember.create({
          data: {
            conversationId: conv.id,
            actorId: spec.actorId,
            actorKind: spec.actorKind,
            memberRole: spec.memberRole,
            isSilent: spec.isSilent ?? false,
            addedBy: actor.actorId,
          },
        });
      } else {
        await tx.conversationMember.updateMany({
          where: { conversationId: conv.id, actorId: spec.actorId, leftAt: null },
          data: { leftAt: new Date() },
        });
      }

      await this.audit.audit(tx, {
        actorId: actor.actorId,
        action: `conversation.member_${action}`,
        entity: 'conversation',
        entityId: conv.id,
        after: { actorId: spec.actorId, memberRole: spec.memberRole },
        reason,
      });

      await this.outbox.enqueue(tx, CommEvent.MEMBERSHIP_CHANGED, {
        conversationId: conv.id,
        added: action === 'add' ? [spec.actorId] : [],
        removed: action === 'remove' ? [spec.actorId] : [],
      });
    });
  }

  // ------------------------------------------------------------------
  // Handler, listing, preferences
  // ------------------------------------------------------------------

  /**
   * The staff member currently responsible: the sticky handler while live,
   * otherwise AI #1's on_duty(). Null means Unattended, never a silent
   * assignment.
   */
  async activeHandler(conv: Conversation, now = new Date()): Promise<string | null> {
    if (conv.stickyHandlerId && conv.stickyUntil && conv.stickyUntil > now) {
      return conv.stickyHandlerId;
    }
    if (!conv.familyId) return null;
    return this.coverage.onDuty(conv.familyId, now);
  }

  /** RBAC-scoped chat list. A contact or teacher only ever sees their own. */
  async listForActor(actorId: string): Promise<Conversation[]> {
    const actor = await this.requireActor(actorId);

    if (actor.kind === ActorKind.STAFF) {
      const probe = this.authz.canRead(actor, {
        id: '',
        type: ConversationType.DIRECT,
        familyId: null,
        stickyHandlerId: null,
        stickyUntil: null,
        teacherRequiresApproval: false,
        parentRequiresApproval: false,
        archivedAt: null,
      }, null);
      if (!probe.allowed) throw new CommError(probe.code, probe.reason);

      return this.prisma.conversation.findMany({
        orderBy: { lastActivityAt: 'desc' },
        take: 200,
      });
    }

    return this.prisma.conversation.findMany({
      where: { members: { some: { actorId: actor.actorId, leftAt: null } } },
      orderBy: { lastActivityAt: 'desc' },
      take: 200,
    });
  }

  /** Archive / mute / pin are per-user; one user's pin never affects another. */
  async setPreferences(
    conversationId: string,
    actorId: string,
    prefs: { archived?: boolean; pinned?: boolean; mutedUntil?: Date | null },
  ): Promise<void> {
    const actor = await this.requireActor(actorId);
    const conv = await this.requireConversation(conversationId);
    const membership = await this.membershipOf(conv.id, actor.actorId);
    const decision = this.authz.canRead(actor, conv, membership);
    if (!decision.allowed) throw new CommError(decision.code, decision.reason);

    const patch = {
      archivedAt: prefs.archived === undefined ? undefined : prefs.archived ? new Date() : null,
      pinnedAt: prefs.pinned === undefined ? undefined : prefs.pinned ? new Date() : null,
      mutedUntil: prefs.mutedUntil === undefined ? undefined : prefs.mutedUntil,
    };

    await this.prisma.conversationParticipantState.upsert({
      where: { conversationId_actorId: { conversationId, actorId: actor.actorId } },
      create: { conversationId, actorId: actor.actorId, ...patch },
      update: patch,
    });
  }

  /** System messages are generated by the backend and never by a client. */
  private async systemMessage(
    tx: Prisma.TransactionClient,
    conversationId: string,
    kind: string,
    payload: Record<string, unknown>,
  ): Promise<void> {
    const locked = await tx.$queryRaw<Array<{ last_seq: bigint }>>`
      SELECT last_seq FROM chat.conversation WHERE id = ${conversationId}::uuid FOR UPDATE
    `;
    const seq = (locked[0]?.last_seq ?? BigInt(0)) + BigInt(1);

    await tx.message.create({
      data: {
        conversationId,
        authorType: ActorKind.SYSTEM,
        authorId: null,
        type: MessageType.SYSTEM,
        body: JSON.stringify({ kind, ...payload }),
        visibility: Visibility.CUSTOMER,
        origin: Origin.AUTOMATION,
        seq,
        attachmentsJson: [],
      },
    });
    await tx.conversation.update({
      where: { id: conversationId },
      data: { lastSeq: seq, lastActivityAt: new Date() },
    });
  }
}
