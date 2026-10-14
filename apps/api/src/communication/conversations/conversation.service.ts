import { Inject, Injectable, Optional } from '@nestjs/common';
import { Conversation, ConversationMember, Prisma } from '@prisma/client';
import { PrismaService } from '../../platform/prisma.service';
import { AuthorizationService } from '../../platform/authorization.service';
import type { LiveMember } from '../../platform/authorization.service';
import { CommError, CommErrorCode } from '../../platform/errors';
import {
  AUDIT_SERVICE,
  COVERAGE_SERVICE,
  IDENTITY_SERVICE,
  REALTIME_REVOCATION,
  RELATIONSHIP_SERVICE,
} from '../../platform/tokens';
import type { RelationshipService } from '../../platform/relationship.service';
import { NO_REALTIME_REVOCATION, type RealtimeRevocation } from '../../platform/realtime-revocation';
import type { IdentityService } from '../../platform/identity.service';
import { actorRefKey } from '../../platform/identity.service';
import type { ResolvedActors } from '../../platform/identity.service';
import type { CoverageService } from '../../platform/coverage.service';
import type { AuditService } from '../../platform/audit.service';
import { Actor, SYSTEM_ACTOR } from '../../platform/types';
import { OutboxService } from '../outbox/outbox.service';
import type { ConversationWithLearner, ResolvedMember } from '../contracts/dto';
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
    @Inject(RELATIONSHIP_SERVICE) private readonly relationships: RelationshipService,
    // RT-009: a removed member's live sockets leave the room when the removal
    // commits, instead of receiving the conversation until they disconnect.
    @Optional()
    @Inject(REALTIME_REVOCATION)
    private readonly revocation: RealtimeRevocation = NO_REALTIME_REVOCATION,
  ) {}

  /**
   * PD-6. The resolved teacher<->parent relationship behind a participant set.
   *
   * Every service that authorizes an operation on a conversation already holds
   * its participants, so the fact is resolved from those rather than re-read,
   * and this one method is the only place that decides which participant is
   * the teacher and which is the parent. Three call sites doing that
   * separately is three chances to get the direction backwards, and a backwards
   * lookup denies a legitimate pair silently.
   *
   * Exactly one live teacher and exactly one live contact is the only shape
   * that can be a teacher/parent pairing. Anything else -- a group, a
   * staff-only channel, a malformed set -- is false, which the policy ignores
   * for every conversation type but `direct`.
   */
  async pairingAuthorizedAmong(
    participants: ReadonlyArray<{ actorId: string; actorKind: string }>,
  ): Promise<boolean> {
    const teachers = participants.filter((p) => p.actorKind === ActorKind.TEACHER);
    const contacts = participants.filter((p) => p.actorKind === ActorKind.CONTACT);
    if (teachers.length !== 1 || contacts.length !== 1) return false;

    return this.relationships.teacherParentAuthorized(teachers[0].actorId, contacts[0].actorId);
  }

  async requireActor(actorId: string): Promise<Actor> {
    const actor = await this.identity.resolveActor(actorId);
    if (!actor) throw new CommError(CommErrorCode.UNKNOWN_ACTOR, 'unknown actor', 401);
    return actor;
  }

  /**
   * The learner is included here rather than in a second lookup.
   *
   * This is a primary-key fetch and the learner is a nullable FK, so the extra
   * work is one indexed LEFT JOIN on a single row -- cheaper than the round
   * trip a separate query would cost, and it means every caller sees the same
   * shape. Nothing about the authorization this returns into changes: the
   * callers that matter (`canRead`, `canSend`) still decide, and a caller that
   * does not want the learner simply does not read it.
   */
  async requireConversation(id: string): Promise<ConversationWithLearner> {
    const conv = await this.prisma.conversation.findUnique({
      where: { id },
      include: { learner: true },
    });
    if (!conv) {
      throw new CommError(CommErrorCode.CONVERSATION_NOT_FOUND, 'conversation not found', 404);
    }
    return conv;
  }

  /**
   * RT-009 -- linearizes a realtime delivery with every revocation that could
   * affect it.
   *
   * A delivery reads membership and identity, then emits; a revocation commits
   * an UPDATE to one of exactly these rows. Taking `FOR SHARE` on them FIRST
   * means a revocation that commits before the locks are granted is visible to
   * every read `decideAndEmit` makes, and one that arrives after must wait until
   * this transaction commits -- which is after the emits. So no revocation can
   * RETURN and then be followed by an emit decided before it. Writers wait for
   * at most one delivery; readers are never blocked. Rows are locked in id
   * order so concurrent deliveries do not deadlock with each other; a deadlock
   * with a writer is detected by Postgres and aborts the delivery (fail closed).
   *
   * The emits themselves are NOT transactional, so `decideAndEmit` receives
   * `stillHeld`: a round trip on THIS transaction that must be awaited
   * immediately before emitting, with no other await in between. If the
   * transaction has ended -- Prisma's timeout below rolls it back on its own
   * timer, releasing the locks, while the callback is still running; or the
   * connection was lost -- it throws, and nothing is emitted. Without it, a
   * decision that outlived its locks could still be emitted after a revocation
   * that slipped in had returned.
   */
  async withDeliveryLocks<T>(
    scope: {
      conversationId?: string;
      actorIds: readonly string[];
      sessionIds: readonly string[];
      accountIds: readonly string[];
      contactIds: readonly string[];
      staffIds: readonly string[];
      teacherIds: readonly string[];
    },
    decideAndEmit: (stillHeld: () => Promise<void>) => Promise<T>,
  ): Promise<T> {
    const ids = (xs: readonly string[]) => [...new Set(xs)];
    return this.prisma.$transaction(
      async (tx) => {
        // A delivery never waits indefinitely behind a writer: it fails closed
        // (nothing emitted) and the node's delivery queue moves on.
        await tx.$executeRaw`SET LOCAL lock_timeout = '5s'`;
        if (scope.conversationId && scope.actorIds.length) {
          await tx.$queryRaw`SELECT 1 FROM chat.conversation_member
            WHERE conversation_id = ${scope.conversationId}::uuid AND actor_id = ANY(${ids(scope.actorIds)}::uuid[])
            ORDER BY id FOR SHARE`;
        }
        if (scope.sessionIds.length) {
          await tx.$queryRaw`SELECT 1 FROM chat.session WHERE id = ANY(${ids(scope.sessionIds)}::uuid[]) ORDER BY id FOR SHARE`;
        }
        if (scope.accountIds.length) {
          await tx.$queryRaw`SELECT 1 FROM chat.account WHERE id = ANY(${ids(scope.accountIds)}::uuid[]) ORDER BY id FOR SHARE`;
        }
        if (scope.contactIds.length) {
          await tx.$queryRaw`SELECT 1 FROM chat.contact WHERE id = ANY(${ids(scope.contactIds)}::uuid[]) ORDER BY id FOR SHARE`;
        }
        if (scope.staffIds.length) {
          await tx.$queryRaw`SELECT 1 FROM chat.staff WHERE id = ANY(${ids(scope.staffIds)}::uuid[]) ORDER BY id FOR SHARE`;
        }
        if (scope.teacherIds.length) {
          await tx.$queryRaw`SELECT 1 FROM chat.teacher WHERE id = ANY(${ids(scope.teacherIds)}::uuid[]) ORDER BY id FOR SHARE`;
        }
        return decideAndEmit(async () => {
          await tx.$queryRaw`SELECT 1`;
        });
      },
      { maxWait: 5_000, timeout: this.deliveryTransactionTimeoutMs },
    );
  }

  /** RT-009: Prisma's bound on one delivery transaction. Lowered only by a test. */
  deliveryTransactionTimeoutMs = 15_000;

  /** RT-009: live memberships of several actors in one query, keyed by actorId. */
  async liveMembershipsOf(
    conversationId: string,
    actorIds: readonly string[],
  ): Promise<Map<string, ConversationMember>> {
    if (actorIds.length === 0) return new Map();
    const rows = await this.prisma.conversationMember.findMany({
      where: { conversationId, actorId: { in: [...actorIds] }, leftAt: null },
    });
    return new Map(rows.map((m) => [m.actorId, m]));
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
  /**
   * A conversation plus its membership, for a caller who may read it.
   *
   * PD-6 made the participant set load-bearing for the client: since a `direct`
   * conversation may now be Parent<->Admin, Teacher<->Admin or Parent<->Teacher,
   * the type alone no longer says which, and the client classifies from
   * `actorKind`. API-CONTRACT section 3.4 already required `GET
   * /conversations/:id` to carry `members[]`; this is what supplies it.
   *
   * The read is authorized HERE and explicitly. `GET /conversations/:id`
   * previously leaned on setPreferences() to throw for a non-member -- true,
   * but incidental, and it is not a property to rely on while widening what the
   * endpoint returns. A membership list must be reachable only by a member.
   */
  async readWithMembers(
    conversationId: string,
    actorId: string,
  ): Promise<{ conversation: ConversationWithLearner; members: ResolvedMember[] }> {
    const actor = await this.requireActor(actorId);
    const conversation = await this.requireConversation(conversationId);
    const membership = await this.membershipOf(conversation.id, actor.actorId);

    const decision = this.authz.canRead(actor, conversation, membership);
    if (!decision.allowed) throw new CommError(decision.code, decision.reason);

    // Delegates rather than querying again: one member-resolution path, so the
    // display names O3 added cannot be present on one route and absent on
    // another. The authorization above is this method's own contribution and is
    // what `membersOf` deliberately does not do.
    return { conversation, members: await this.membersOf(conversation.id, actor) };
  }

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

  /**
   * Live membership with display names, for a client that has to render people
   * (mobile gap O3).
   *
   * SEPARATE FROM liveMembersOf ON PURPOSE. That one feeds an authorization
   * decision and resolves only staff admins, because that is the only activity
   * the C-4 rule reads and resolving everybody on every send would be a
   * per-message cost for no decision. This one is for display, resolves every
   * member, and is called once per conversation-detail read. Merging them would
   * either put a display name inside an authorization struct or make every send
   * pay for names nobody reads.
   *
   * THE CALLER AUTHORIZES FIRST. This method answers "who is in this
   * conversation"; it does not decide who may ask. Every current caller runs
   * canRead before reaching it.
   *
   * BOUNDED BY KIND. One `resolveActors` call, so at most one identity query per
   * actor kind present rather than one per member. It used to be the latter, and
   * the O3 author-identity audit found it: a conversation's membership is small,
   * so it was never a production problem, but two callers resolving identity two
   * different ways is how the second one ends up on a page of a hundred rows.
   * `conversation_member.actor_kind` supplies the kind, so nothing has to guess.
   *
   * An actor that no longer resolves yields '' rather than an id or a
   * placeholder: a membership row outlives the actor it names (BR-5), and the
   * client already treats an empty name as unresolved.
   */
  /**
   * The live members, with identity resolved in one batch.
   *
   * `viewer` is optional and, when given, is the actor the `canOpenDirect`
   * advisory is computed FOR. Omitting it yields `false` everywhere rather than
   * `true`: a member list built without knowing who is asking cannot answer "may
   * you message them", and guessing in the permissive direction is how an
   * advisory becomes a lie. See ConversationMemberDto.canOpenDirect.
   */
  async membersOf(conversationId: string, viewer?: Actor): Promise<ResolvedMember[]> {
    const rows = await this.prisma.conversationMember.findMany({
      where: { conversationId, leftAt: null },
      orderBy: { joinedAt: 'asc' },
    });

    const actors = await this.identity.resolveActors(
      rows.map((m) => ({ actorId: m.actorId, actorKind: m.actorKind })),
    );

    const openable = await this.openableFor(viewer, rows, actors);

    return rows.map((m) => ({
      actorId: m.actorId,
      actorKind: m.actorKind,
      memberRole: m.memberRole,
      isSilent: m.isSilent,
      displayName:
        actors.get(actorRefKey({ actorId: m.actorId, actorKind: m.actorKind }))?.displayName ?? '',
      canOpenDirect: openable.has(actorRefKey({ actorId: m.actorId, actorKind: m.actorKind })),
    }));
  }

  /**
   * Which of these members the viewer may open a 1:1 with.
   *
   * The decision is `AuthorizationService.canOpenDirect` -- the same method the
   * `POST /conversations/direct` request runs -- so the advisory cannot drift
   * from the enforcement. What it adds is the PD-6 relationship argument, which
   * only the server can resolve.
   *
   * COST. The relationship predicate is consulted only for the pair that needs
   * it: exactly one of the viewer and the member is a teacher and the other a
   * family contact. Every other pairing (staff, system, same-kind, self) is
   * decided from the actors alone with no query at all. A member list is a single
   * conversation's roster, so this is bounded by the contacts in one group, not
   * by anything that grows with the tenant.
   *
   * It deliberately reuses the existing single-pair `pairingAuthorized` rather
   * than adding a batched variant: the predicate is written twice on purpose,
   * once here and once in the database (`chat.teacher_parent_authorized`), and a
   * third implementation written for speed is a third place for the answers to
   * diverge.
   */
  private async openableFor(
    viewer: Actor | undefined,
    rows: ReadonlyArray<{ actorId: string; actorKind: string }>,
    actors: ResolvedActors,
  ): Promise<Set<string>> {
    const openable = new Set<string>();
    if (!viewer) return openable;

    for (const row of rows) {
      const key = actorRefKey({ actorId: row.actorId, actorKind: row.actorKind });
      const other = actors.get(key);
      // An unresolved member is not a correspondent. Same actor is refused by
      // canOpenDirect itself, but skipping it here saves a pointless query.
      if (!other || other.actorId === viewer.actorId) continue;

      const needsRelationship =
        (viewer.kind === ActorKind.TEACHER && other.kind === ActorKind.CONTACT) ||
        (viewer.kind === ActorKind.CONTACT && other.kind === ActorKind.TEACHER);

      const pairingAuthorized = needsRelationship
        ? await this.relationships.pairingAuthorized(viewer, other)
        : false;

      if (this.authz.canOpenDirect(viewer, other, pairingAuthorized).allowed) {
        openable.add(key);
      }
    }

    return openable;
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

    // PD-6. The relationship is resolved from server-owned data BEFORE the
    // policy runs. `otherId` selected a row; it asserted nothing about it.
    const pairingAuthorized = await this.relationships.pairingAuthorized(a, b);

    const decision = this.authz.canOpenDirect(a, b, pairingAuthorized);
    if (!decision.allowed) {
      // Another organization's actor is answered exactly as `requireActor`
      // answers an unknown one: same code, same status, same message.
      const status = decision.code === CommErrorCode.UNKNOWN_ACTOR ? 401 : 403;
      throw new CommError(decision.code, decision.reason, status);
    }
    // canOpenDirect has established that both sides share this organization;
    // each value was read from the principal's own row by IdentityService.
    const organizationId = a.organizationId as string;

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
            // RT-030: the participants' shared organization, never the column
            // default. With a family side, conversation_same_organization
            // independently checks it against the family.
            organizationId,
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
   * The provisioning gate, asked before the learner is looked up.
   *
   * An omitted `actorId` means SYSTEM -- the seam Core ingestion and the
   * fixtures write through -- not "skip the check". HTTP cannot omit it: both
   * routes pass the actor resolved from a verified bearer token.
   */
  private async provisioningActor(actorId?: string): Promise<Actor> {
    if (actorId === undefined) return SYSTEM_ACTOR;
    const actor = await this.requireActor(actorId);
    const gate = this.authz.canProvisionStudentGroup(actor);
    if (!gate.allowed) throw new CommError(gate.code, gate.reason);
    return actor;
  }

  /**
   * Create the official group for a learner from Jawwid Core relationships.
   *
   * Members are derived from data, never supplied by a client: the family's
   * messaging contacts, the assigned teacher, and the family's primary owner.
   * A partial unique index guarantees one live group per learner.
   */
  async ensureStudentGroup(learnerId: string, actorId?: string): Promise<Conversation> {
    const actor = await this.provisioningActor(actorId);
    const learner = await this.prisma.learner.findUnique({
      where: { id: learnerId },
      include: { family: { include: { contacts: { where: { isActive: true } } } } },
    });
    if (!learner) {
      throw new CommError(CommErrorCode.CONVERSATION_NOT_FOUND, 'learner not found', 404);
    }
    const scoped = this.authz.canProvisionStudentGroupFor(actor, provisioningTarget(learner));
    if (!scoped.allowed) throw provisioningRefusal(scoped);

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
          // RT-030. The learner's own row is the authority for the group's
          // tenant -- never the column default, which is the seeded
          // organization, and never the request. The database keeps the
          // learner in its family's organization (learner_same_organization)
          // and checks this conversation against the family
          // (conversation_same_organization), so a wrong value cannot land.
          organizationId: learner.organizationId,
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
    const actor = await this.provisioningActor(actorId);
    const learner = await this.prisma.learner.findUnique({
      where: { id: learnerId },
      include: { family: { include: { contacts: { where: { isActive: true } } } } },
    });
    if (!learner) return null;
    const scoped = this.authz.canProvisionStudentGroupFor(actor, provisioningTarget(learner));
    if (!scoped.allowed) {
      // Another tenant's learner is answered exactly as an unknown one is.
      if (scoped.code === CommErrorCode.CONVERSATION_NOT_FOUND) return null;
      throw provisioningRefusal(scoped);
    }

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

    if (toAdd.length === 0 && toRemove.length === 0) {
      // RT-009: nothing changed NOW, but this may be the retry of a sync whose
      // removal committed and was not confirmed. Never report it complete
      // without the barrier.
      await this.revocation.confirmRevoked();
      return conv;
    }

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

    // RT-009: members the reconcile removed leave the room once it has committed,
    // and the sync is not reported complete until no node can still deliver to
    // them on an earlier decision (the completion barrier; throws if unconfirmed).
    this.revocation.leaveConversation(toRemove.map((m) => m.actorId), conv.id);
    await this.revocation.confirmRevoked();
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
   *
   * Order: who is asking (gate) -> is the request well-formed -> which
   * conversation and is it in the actor's scope -> is the member eligible,
   * judged from their own row. Every refusal happens before the transaction, so
   * a refused request writes nothing. The client's `actorKind` / `memberRole`
   * only say which row to read and which role is asked for; on removal they are
   * ignored in favour of the live membership row.
   */
  async setMembership(
    conversationId: string,
    requesterId: string,
    spec: MemberSpec,
    action: 'add' | 'remove',
    reason: string,
  ): Promise<void> {
    const actor = await this.requireActor(requesterId);
    const gate = this.authz.canManageMembership(actor);
    if (!gate.allowed) throw new CommError(gate.code, gate.reason);

    const request = validateMembershipRequest(conversationId, spec, action, reason);

    const conv = await this.prisma.conversation.findUnique({
      where: { id: conversationId },
      include: {
        family: { select: { ownerId: true } },
        learner: { select: { teacherId: true } },
      },
    });
    if (!conv) {
      throw new CommError(CommErrorCode.CONVERSATION_NOT_FOUND, 'conversation not found', 404);
    }
    const own = await this.membershipOf(conv.id, actor.actorId);
    const scoped = this.authz.canManageMembershipIn(actor, {
      type: conv.type,
      organizationId: conv.organizationId,
      familyId: conv.familyId,
      familyOwnerId: conv.family?.ownerId ?? null,
      actorMemberRole: own?.memberRole ?? null,
    });
    if (!scoped.allowed) {
      const status = scoped.code === CommErrorCode.CONVERSATION_NOT_FOUND ? 404 : 403;
      throw new CommError(scoped.code, scoped.reason, status);
    }

    const live = await this.prisma.conversationMember.findFirst({
      where: { conversationId: conv.id, actorId: request.actorId, leftAt: null },
    });

    if (request.action === 'remove') {
      // Not a member: nothing to remove, and nothing to record -- but still
      // the barrier below, since this may be the retry of a removal that
      // committed and was not confirmed.
      if (live) {
        await this.prisma.$transaction(async (tx) => {
          const ended = await tx.conversationMember.updateMany({
            where: { id: live.id, leftAt: null },
            data: { leftAt: new Date() },
          });
          // A concurrent removal got there first: same outcome, one record.
          if (ended.count === 0) return;
          await this.recordMembershipChange(tx, actor, conv.id, 'remove', live, request.reason);
        });
        // RT-009: after the commit, so a socket is never evicted for a removal
        // that rolled back. Pushed even when a concurrent removal won the row:
        // eviction is idempotent. Cleanup only.
        this.revocation.leaveConversation([live.actorId], conv.id);
      }
      // RT-009 completion barrier: "removed" is returned only once no node can
      // still deliver to the member on a decision made before the commit.
      // Throws RevocationUnconfirmedError (503) otherwise -- the removal stays
      // committed, and a retry is safe.
      await this.revocation.confirmRevoked();
      return;
    }

    if (live) {
      // Already a member exactly as asked: an idempotent repeat, not a change.
      if (
        live.actorKind === request.actorKind &&
        live.memberRole === request.memberRole &&
        live.isSilent === request.isSilent
      ) {
        return;
      }
      throw new CommError(
        CommErrorCode.VALIDATION,
        'actorId is already a member of this conversation in a different role',
        400,
      );
    }

    const candidate = await this.memberCandidate(request.actorKind, request.actorId);
    const eligible = this.authz.canAddMember(
      {
        type: conv.type,
        organizationId: conv.organizationId,
        familyId: conv.familyId,
        learnerTeacherId: conv.learner?.teacherId ?? null,
      },
      request.memberRole,
      candidate,
    );
    if (!eligible.allowed) throw new CommError(eligible.code, eligible.reason);

    try {
      await this.prisma.$transaction(async (tx) => {
        const created = await tx.conversationMember.create({
          data: {
            conversationId: conv.id,
            actorId: request.actorId,
            actorKind: request.actorKind,
            memberRole: request.memberRole,
            isSilent: request.isSilent,
            addedBy: actor.actorId,
          },
        });
        await this.recordMembershipChange(tx, actor, conv.id, 'add', created, request.reason);
      });
    } catch (e) {
      // A concurrent add of the same member won the unique live-member index;
      // the member is present, which is what was asked for.
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') return;
      throw e;
    }
  }

  /** The audit row and realtime event for one membership change, in its transaction. */
  private async recordMembershipChange(
    tx: Prisma.TransactionClient,
    actor: Actor,
    conversationId: string,
    action: 'add' | 'remove',
    member: { actorId: string; memberRole: string },
    reason: string,
  ): Promise<void> {
    await this.audit.audit(tx, {
      actorId: actor.actorId,
      action: `conversation.member_${action}`,
      entity: 'conversation',
      entityId: conversationId,
      after: { actorId: member.actorId, memberRole: member.memberRole },
      reason,
    });
    await this.outbox.enqueue(tx, CommEvent.MEMBERSHIP_CHANGED, {
      conversationId,
      added: action === 'add' ? [member.actorId] : [],
      removed: action === 'remove' ? [member.actorId] : [],
    });
  }

  /**
   * The would-be member, read from their own row. `null` when there is no such
   * row of that kind -- which `canAddMember` answers exactly as it answers a
   * row in another organization.
   */
  private async memberCandidate(kind: string, id: string) {
    switch (kind) {
      case ActorKind.CONTACT: {
        const c = await this.prisma.contact.findUnique({ where: { id } });
        return c && {
          kind: 'contact' as const,
          organizationId: c.organizationId,
          isActive: c.isActive,
          familyId: c.familyId,
          canMessage: c.canMessage,
        };
      }
      case ActorKind.TEACHER: {
        const t = await this.prisma.teacher.findUnique({ where: { id } });
        return t && {
          kind: 'teacher' as const,
          actorId: t.id,
          organizationId: t.organizationId,
          isActive: t.isActive,
          leftAt: t.leftAt,
        };
      }
      case ActorKind.STAFF: {
        const st = await this.prisma.staff.findUnique({ where: { id } });
        return st && {
          kind: 'staff' as const,
          organizationId: st.organizationId,
          isActive: st.isActive,
          leftAt: st.leftAt,
          staffRole: st.role,
        };
      }
      default:
        return null;
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

  /** RBAC-scoped chat list. A contact or teacher only ever sees their own. */
  async listForActor(actorId: string): Promise<ConversationWithLearner[]> {
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
        include: { learner: true },
        orderBy: { lastActivityAt: 'desc' },
        take: 200,
      });
    }

    // The authorization boundary for a contact or a teacher: live membership,
    // and nothing else. The learner rides along on that join, so a learner can
    // only ever reach a caller who is already a member of the conversation it
    // belongs to -- there is no second, wider query to get it wrong in.
    return this.prisma.conversation.findMany({
      where: { members: { some: { actorId: actor.actorId, leftAt: null } } },
      include: { learner: true },
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
    // The conversation's own row, locked, is the authority for the message's
    // tenant (RT-030): the column default is the seeded organization, which is
    // wrong for every other tenant and is refused by message_same_organization.
    const locked = await tx.$queryRaw<Array<{ last_seq: bigint; organization_id: string }>>`
      SELECT last_seq, organization_id::text AS organization_id
        FROM chat.conversation WHERE id = ${conversationId}::uuid FOR UPDATE
    `;
    if (locked.length === 0) {
      throw new CommError(CommErrorCode.CONVERSATION_NOT_FOUND, 'conversation not found', 404);
    }
    const seq = locked[0].last_seq + BigInt(1);

    await tx.message.create({
      data: {
        organizationId: locked[0].organization_id,
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

/** The facts `canProvisionStudentGroupFor` decides on, read from a loaded learner. */
function provisioningTarget(learner: {
  organizationId: string;
  family: { organizationId: string; ownerId: string };
}) {
  return {
    learnerOrganizationId: learner.organizationId,
    familyOrganizationId: learner.family.organizationId,
    familyOwnerId: learner.family.ownerId,
  };
}

/** A tenant mismatch reads as an unknown learner (404); anything else is 403. */
function provisioningRefusal(decision: { code: CommErrorCode; reason: string }): CommError {
  const status = decision.code === CommErrorCode.CONVERSATION_NOT_FOUND ? 404 : 403;
  return new CommError(decision.code, decision.reason, status);
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MEMBER_KINDS: ReadonlySet<string> = new Set([ActorKind.CONTACT, ActorKind.TEACHER, ActorKind.STAFF]);

/**
 * Shape checks for `POST /conversations/:id/members`, before anything is read.
 * Each failure is `COMMON.VALIDATION` 400 naming the field (API-CONTRACT
 * section 1); before this, a missing reason or a malformed id reached the
 * database and came back as a 500.
 */
function validateMembershipRequest(
  conversationId: unknown,
  spec: Partial<MemberSpec> | undefined,
  action: unknown,
  reason: unknown,
): { action: 'add' | 'remove'; actorId: string; actorKind: string; memberRole: string; isSilent: boolean; reason: string } {
  const invalid = (field: string, why: string) =>
    new CommError(CommErrorCode.VALIDATION, `${field}: ${why}`, 400);
  if (typeof conversationId !== 'string' || !UUID.test(conversationId)) {
    throw invalid('conversationId', 'must be a uuid');
  }
  if (action !== 'add' && action !== 'remove') throw invalid('action', "must be 'add' or 'remove'");
  if (typeof reason !== 'string' || reason.trim().length === 0) throw invalid('reason', 'is required');
  if (typeof spec?.actorId !== 'string' || !UUID.test(spec.actorId)) throw invalid('actorId', 'must be a uuid');
  if (spec.isSilent !== undefined && typeof spec.isSilent !== 'boolean') {
    throw invalid('isSilent', 'must be a boolean');
  }
  if (action === 'add') {
    if (typeof spec.actorKind !== 'string' || !MEMBER_KINDS.has(spec.actorKind)) {
      throw invalid('actorKind', "must be 'contact', 'teacher' or 'staff'");
    }
    if (typeof spec.memberRole !== 'string' || spec.memberRole.length === 0) {
      throw invalid('memberRole', 'is required');
    }
  }
  return {
    action,
    actorId: spec.actorId,
    actorKind: spec.actorKind ?? '',
    memberRole: spec.memberRole ?? '',
    isSilent: spec.isSilent ?? false,
    reason: reason.trim(),
  };
}
