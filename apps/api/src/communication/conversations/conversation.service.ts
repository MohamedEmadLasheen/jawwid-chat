import { Inject, Injectable } from '@nestjs/common';
import { Conversation, ConversationMember, Prisma } from '@prisma/client';
import { PrismaService } from '../../platform/prisma.service';
import { AuthorizationService } from '../../platform/authorization.service';
import type { LiveMember, ScopeState } from '../../platform/authorization.service';
import { ScopeService } from '../../platform/scope.service';
import { CommError, CommErrorCode } from '../../platform/errors';
import { AUDIT_SERVICE, COVERAGE_SERVICE, IDENTITY_SERVICE } from '../../platform/tokens';
import type { IdentityService } from '../../platform/identity.service';
import type { CoverageService } from '../../platform/coverage.service';
import type { AuditService } from '../../platform/audit.service';
import { Actor } from '../../platform/types';
import { OutboxService } from '../outbox/outbox.service';
import { CommEvent } from '../contracts/events';
import type { ConversationRowExtras } from '../contracts/dto';
import {
  ActorKind,
  ConversationType,
  MemberRole,
  MessageType,
  Moderation,
  Origin,
  ReceiptState,
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
    private readonly scope: ScopeService,
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

  async requireConversation(id: string): Promise<Conversation> {
    const conv = await this.prisma.conversation.findUnique({ where: { id } });
    if (!conv) {
      throw new CommError(CommErrorCode.CONVERSATION_NOT_FOUND, 'conversation not found', 404);
    }
    return conv;
  }

  /**
   * Resolve the scope facts AuthorizationService needs for this conversation.
   *
   * Every decision path calls this, so "is this family mine right now" is
   * computed in one place (ScopeService), read live from chat.family_assignment,
   * and cannot be answered differently by two endpoints. A reassignment is
   * therefore effective on the next request with nothing to invalidate.
   */
  async scopeFor(
    actor: Actor,
    conv: Pick<Conversation, 'familyId' | 'organizationId'>,
    now = new Date(),
  ): Promise<ScopeState> {
    return {
      familyInScope: await this.scope.canAccessFamily(actor, conv.familyId, now),
      sameOrganization:
        !actor.organizationId || !conv.organizationId
          ? true
          : actor.organizationId === conv.organizationId,
    };
  }

  /**
   * Load a conversation the actor is allowed to read, or refuse.
   *
   * IDOR defence for every by-id route: a conversation the actor may not read
   * is reported as NOT FOUND, not FORBIDDEN, so probing ids yields no signal
   * about which ones exist.
   */
  async requireForActor(conversationId: string, actorId: string): Promise<Conversation> {
    const actor = await this.requireActor(actorId);
    const conv = await this.requireConversation(conversationId);
    const membership = await this.membershipOf(conv.id, actor.actorId);
    const decision = this.authz.canRead(actor, conv, membership, await this.scopeFor(actor, conv));
    if (!decision.allowed) {
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

    // The family context is whichever side is a family contact; that is the
    // family whose scope the staff side must be inside.
    const contactSide = a.kind === ActorKind.CONTACT ? a : b.kind === ActorKind.CONTACT ? b : null;
    const staffSide = a.kind === ActorKind.STAFF ? a : b.kind === ActorKind.STAFF ? b : null;
    const scope: ScopeState = {
      familyInScope:
        contactSide && staffSide
          ? await this.scope.canAccessFamily(staffSide, contactSide.familyId ?? null)
          : true,
    };

    const decision = this.authz.canOpenDirect(a, b, scope);
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
  async syncStudentGroup(learnerId: string, requesterId?: string): Promise<Conversation | null> {
    const learner = await this.prisma.learner.findUnique({
      where: { id: learnerId },
      include: { family: { include: { contacts: { where: { isActive: true } } } } },
    });
    if (!learner) return null;

    const conv = await this.prisma.conversation.findFirst({
      where: { learnerId, type: ConversationType.STUDENT_GROUP, archivedAt: null },
    });
    if (!conv) return null;

    // A caller reconciling a group is changing its membership, and is held to
    // the same permission and scope as any other membership change. Omitted
    // only for the system paths (Core ingestion, the worker) that pass no
    // requester and are already trusted to act for nobody.
    if (requesterId !== undefined) {
      const requester = await this.requireActor(requesterId);
      const decision = this.authz.canManageMembership(
        requester,
        await this.scopeFor(requester, conv),
      );
      if (!decision.allowed) throw new CommError(decision.code, decision.reason);
    }

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
    const conv = await this.requireConversation(conversationId);

    const decision = this.authz.canManageMembership(actor, await this.scopeFor(actor, conv));
    if (!decision.allowed) throw new CommError(decision.code, decision.reason);

    if (action === 'add') await this.assertAddable(conv, spec);

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

  /**
   * The actor being ADDED is a client-supplied id, and adding somebody to a
   * conversation grants them everything in it.
   *
   * The permission check above asks whether the CALLER may change membership.
   * It says nothing about WHO they may add -- and without this, a supervisor
   * acting entirely within their own scope could add a contact from another
   * family, or a bare uuid, and thereby hand a conversation to somebody the
   * scope rules would never have let in. The database backstops the
   * constitutional part (BR-1 participant sets, family scope) but not this.
   *
   * Three things are required of the id, and each closes a different hole:
   *   1. it resolves to a real, ACTIVE principal -- not a guess, not somebody
   *      offboarded;
   *   2. its kind is the kind the caller claimed, so `actorKind` cannot be used
   *      to smuggle a contact in as a teacher and past the BR-1 checks;
   *   3. a family contact belongs to THIS conversation's family, and everyone
   *      belongs to this organization.
   */
  private async assertAddable(
    conv: Pick<Conversation, 'id' | 'familyId' | 'organizationId'>,
    spec: MemberSpec,
  ): Promise<void> {
    const member = await this.identity.resolveActor(spec.actorId);
    if (!member || !member.isActive) {
      throw new CommError(
        CommErrorCode.INVALID_PARTICIPANTS,
        'the actor being added does not exist or is not active',
      );
    }
    if (member.kind !== spec.actorKind) {
      throw new CommError(
        CommErrorCode.INVALID_PARTICIPANTS,
        `actorKind '${spec.actorKind}' does not match this actor`,
      );
    }
    if (
      member.organizationId &&
      conv.organizationId &&
      member.organizationId !== conv.organizationId
    ) {
      throw new CommError(
        CommErrorCode.CROSS_TENANT,
        'this actor belongs to another organization',
      );
    }
    if (
      member.kind === ActorKind.CONTACT &&
      conv.familyId !== null &&
      member.familyId !== conv.familyId
    ) {
      throw new CommError(
        CommErrorCode.INVALID_PARTICIPANTS,
        'a family contact may only be added to their own family\'s conversation',
      );
    }
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

  /**
   * The chat list, scoped BY CONSTRUCTION.
   *
   * What this used to do for staff: `findMany({ take: 200 })` -- the 200 most
   * recently active conversations IN THE SYSTEM, for any family-facing role
   * (red-team A-1 / RT-011). The role check passed, so nothing looked wrong.
   *
   * It now builds its WHERE from ScopeService, which is the same predicate
   * canRead consults. A list endpoint that filters after the fact is one
   * forgotten `where` away from leaking; a list endpoint whose query cannot
   * name an out-of-scope row is not.
   */
  async listForActor(actorId: string): Promise<Conversation[]> {
    const actor = await this.requireActor(actorId);
    const where = await this.scope.conversationWhere(actor);

    return this.prisma.conversation.findMany({
      where,
      orderBy: { lastActivityAt: 'desc' },
      take: 200,
    });
  }

  /**
   * The scope predicate on its own, for callers that build a bigger query on
   * top of it -- search, most importantly.
   *
   * Exposed here rather than having those callers reach for ScopeService
   * directly, so "which conversations may this actor touch" keeps arriving from
   * one method and a future change to it reaches every consumer.
   */
  async scopedConversationWhere(actor: Actor, now = new Date()): Promise<Prisma.ConversationWhereInput> {
    return this.scope.conversationWhere(actor, now);
  }

  /**
   * The chat list, with everything a row needs, in a bounded number of queries.
   *
   * Four queries for the whole page regardless of its length: the conversations,
   * their members, this actor's per-conversation preferences and unread counts,
   * and the newest readable message of each. The alternative the mobile client
   * had to live with was one request PER ROW for the unread count alone -- its
   * own repository records that as a known cost. On the networks this product
   * targets, that is the difference between a chat list and a spinner.
   */
  async listRowsForActor(actorId: string): Promise<
    Array<{
      conversation: Conversation;
      members: Array<ConversationMember & { displayName?: string }>;
      extras: ConversationRowExtras;
    }>
  > {
    const actor = await this.requireActor(actorId);
    const conversations = await this.listForActor(actorId);
    if (conversations.length === 0) return [];

    const ids = conversations.map((c) => c.id);
    const canSeeInternal = this.authz.canReadInternal(actor);

    const [members, states, unread, latest] = await Promise.all([
      this.prisma.conversationMember.findMany({
        where: { conversationId: { in: ids }, leftAt: null },
      }),
      this.prisma.conversationParticipantState.findMany({
        where: { conversationId: { in: ids }, actorId: actor.actorId },
      }),
      // Unread is "messages addressed to me that I have not read", which is
      // exactly the receipt rows below READ. Grouped in one pass.
      this.prisma.messageReceipt.groupBy({
        by: ['messageId'],
        where: {
          actorId: actor.actorId,
          state: { in: [ReceiptState.SENT, ReceiptState.DELIVERED] },
          message: { conversationId: { in: ids }, deletedForAll: false },
        },
        _count: { messageId: true },
      }),
      // The newest message of each conversation THIS ACTOR MAY READ. A preview
      // is content: an internal note must never appear as the preview on a
      // parent's chat list, and neither must a message they hid or one held for
      // approval.
      this.prisma.message.findMany({
        where: {
          conversationId: { in: ids },
          deletedForAll: false,
          moderation: Moderation.PUBLISHED,
          hiddenFor: { none: { actorId: actor.actorId } },
          ...(canSeeInternal ? {} : { visibility: Visibility.CUSTOMER }),
        },
        orderBy: [{ conversationId: 'asc' }, { seq: 'desc' }],
        distinct: ['conversationId'],
        select: {
          conversationId: true,
          body: true,
          type: true,
          authorId: true,
          createdAt: true,
        },
      }),
    ]);

    // groupBy returns one row per message, so the per-conversation count needs
    // the message -> conversation mapping. One more query, still not per row.
    const unreadByConversation = new Map<string, number>();
    if (unread.length > 0) {
      const owners = await this.prisma.message.findMany({
        where: { id: { in: unread.map((u) => u.messageId) } },
        select: { id: true, conversationId: true },
      });
      for (const o of owners) {
        if (!o.conversationId) continue;
        unreadByConversation.set(o.conversationId, (unreadByConversation.get(o.conversationId) ?? 0) + 1);
      }
    }

    const membersByConversation = new Map<string, ConversationMember[]>();
    for (const m of members) {
      const list = membersByConversation.get(m.conversationId) ?? [];
      list.push(m);
      membersByConversation.set(m.conversationId, list);
    }

    // One identity resolution per DISTINCT actor across the whole page, not per
    // membership row: the same admin sits in many of a family's conversations.
    const distinctActorIds = [...new Set(members.map((m) => m.actorId))];
    const names = new Map<string, string>();
    await Promise.all(
      distinctActorIds.map(async (id) => {
        const resolved = await this.identity.resolveActor(id);
        if (resolved) names.set(id, resolved.displayName);
      }),
    );

    const stateByConversation = new Map(states.map((s) => [s.conversationId, s]));
    const latestByConversation = new Map(latest.map((m) => [m.conversationId!, m]));
    const now = new Date();

    return conversations.map((conversation) => {
      const state = stateByConversation.get(conversation.id);
      const newest = latestByConversation.get(conversation.id);
      return {
        conversation,
        members: (membersByConversation.get(conversation.id) ?? []).map((m) => ({
          ...m,
          displayName: names.get(m.actorId),
        })),
        extras: {
          unreadCount: unreadByConversation.get(conversation.id) ?? 0,
          // A system message's body is a JSON envelope the client renders
          // itself; sending it as a preview string would put JSON in the list.
          lastMessagePreview:
            newest && newest.type !== MessageType.SYSTEM ? (newest.body ?? '') : '',
          lastMessageAt: newest?.createdAt.toISOString() ?? null,
          lastMessageAuthorId: newest?.authorId ?? null,
          isPinned: state?.pinnedAt != null,
          isMuted: state?.mutedUntil != null && state.mutedUntil > now,
          isArchivedForMe: state?.archivedAt != null,
        },
      };
    });
  }

  /**
   * ONE conversation, with the same row data the list carries.
   *
   * The by-id route used to return the conversation alone, so a client opening
   * a thread from a notification or a deep link had no unread count -- and
   * without one it cannot place the "unread messages" divider, which is the
   * whole point of having opened there. Built from listRowsForActor's pieces
   * rather than duplicating them.
   */
  async rowForActor(conversationId: string, actorId: string): Promise<{
    conversation: Conversation;
    members: Array<ConversationMember & { displayName?: string }>;
    extras: ConversationRowExtras;
  }> {
    const actor = await this.requireActor(actorId);
    // Authorized first, and reported as NOT FOUND when it is not: the extras
    // below would otherwise be computed for a conversation this actor may not
    // read, and a timing difference is a signal.
    const conversation = await this.requireForActor(conversationId, actorId);

    const [members, state, unreadCount, newest] = await Promise.all([
      this.prisma.conversationMember.findMany({
        where: { conversationId, leftAt: null },
      }),
      this.prisma.conversationParticipantState.findFirst({
        where: { conversationId, actorId: actor.actorId },
      }),
      this.prisma.messageReceipt.count({
        where: {
          actorId: actor.actorId,
          state: { in: [ReceiptState.SENT, ReceiptState.DELIVERED] },
          message: { conversationId, deletedForAll: false },
        },
      }),
      this.prisma.message.findFirst({
        where: {
          conversationId,
          deletedForAll: false,
          moderation: Moderation.PUBLISHED,
          hiddenFor: { none: { actorId: actor.actorId } },
          ...(this.authz.canReadInternal(actor) ? {} : { visibility: Visibility.CUSTOMER }),
        },
        orderBy: { seq: 'desc' },
        select: { body: true, type: true, authorId: true, createdAt: true },
      }),
    ]);

    const names = new Map<string, string>();
    await Promise.all(
      [...new Set(members.map((m) => m.actorId))].map(async (id) => {
        const resolved = await this.identity.resolveActor(id);
        if (resolved) names.set(id, resolved.displayName);
      }),
    );

    const now = new Date();
    return {
      conversation,
      members: members.map((m) => ({ ...m, displayName: names.get(m.actorId) })),
      extras: {
        unreadCount,
        lastMessagePreview:
          newest && newest.type !== MessageType.SYSTEM ? (newest.body ?? '') : '',
        lastMessageAt: newest?.createdAt.toISOString() ?? null,
        lastMessageAuthorId: newest?.authorId ?? null,
        isPinned: state?.pinnedAt != null,
        isMuted: state?.mutedUntil != null && state.mutedUntil > now,
        isArchivedForMe: state?.archivedAt != null,
      },
    };
  }

  /**
   * Conversation search, scoped by construction.
   *
   * Matches on the conversation's own title and on the display names of its
   * members, so "Ahmed" finds the thread with Ahmed's family even though no
   * message contains the word. Names are resolved from identity, never from a
   * denormalised copy that could go stale after a rename.
   */
  async searchForActor(actorId: string, query: string, limit = 20): Promise<Conversation[]> {
    const actor = await this.requireActor(actorId);
    const term = query.trim();
    if (term.length < 2) return [];

    const scopeWhere = await this.scope.conversationWhere(actor);

    // Title match, straight from the scoped set.
    const byTitle = await this.prisma.conversation.findMany({
      where: { AND: [scopeWhere, { title: { contains: term, mode: 'insensitive' } }] },
      orderBy: { lastActivityAt: 'desc' },
      take: limit,
    });

    // Member-name match. The candidate actor ids come from identity tables
    // filtered by name; the conversations then come from the SCOPED set, so a
    // name that matches somebody outside this actor's scope yields nothing.
    const [staff, contacts, teachers] = await Promise.all([
      this.prisma.staff.findMany({
        where: { name: { contains: term, mode: 'insensitive' } },
        select: { id: true },
        take: 50,
      }),
      this.prisma.contact.findMany({
        where: { name: { contains: term, mode: 'insensitive' } },
        select: { id: true },
        take: 50,
      }),
      this.prisma.teacher.findMany({
        where: { name: { contains: term, mode: 'insensitive' } },
        select: { id: true },
        take: 50,
      }),
    ]);
    const matchedActorIds = [...staff, ...contacts, ...teachers].map((r) => r.id);

    const byMember = matchedActorIds.length
      ? await this.prisma.conversation.findMany({
          where: {
            AND: [
              scopeWhere,
              { members: { some: { actorId: { in: matchedActorIds }, leftAt: null } } },
            ],
          },
          orderBy: { lastActivityAt: 'desc' },
          take: limit,
        })
      : [];

    const merged = new Map<string, Conversation>();
    for (const c of [...byTitle, ...byMember]) merged.set(c.id, c);
    return [...merged.values()]
      .sort((a, b) => b.lastActivityAt.getTime() - a.lastActivityAt.getTime())
      .slice(0, limit);
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
    const decision = this.authz.canRead(actor, conv, membership, await this.scopeFor(actor, conv));
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
