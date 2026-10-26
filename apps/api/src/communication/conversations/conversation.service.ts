import { signActorAvatar } from '../profile/avatar-urls';
import { Inject, Injectable, Optional } from '@nestjs/common';
import { Conversation, ConversationMember, Message, Prisma } from '@prisma/client';
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
import type { StaffAccessBasis } from '../../platform/staff-scope';
import { Actor, SYSTEM_ACTOR, isConversationStaff } from '../../platform/types';
import { OutboxService } from '../outbox/outbox.service';
import type { ConversationWithLearner, MemberAwayDto, ResolvedMember } from '../contracts/dto';
import { CommEvent } from '../contracts/events';
import {
  ActorKind,
  ConversationType,
  MemberRole,
  MessageType,
  Origin,
  Visibility,
} from '../contracts/vocab';

/**
 * Ids arrive from URLs and bodies. One that is not a uuid cannot name any row,
 * so it is answered exactly as an unknown one -- not handed to Postgres, which
 * rejects it with an error that surfaced as a 500.
 */
export const isUuid = (value: unknown): value is string =>
  typeof value === 'string' &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);

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
    // Unused since PD-7 (BR-1 no longer consults a relationship). Kept in the
    // constructor so the positional construction shared by the test harnesses
    // and the parallel worktrees does not shift.
    @Inject(RELATIONSHIP_SERVICE) private readonly relationships: RelationshipService,
    // RT-009: a removed member's live sockets leave the room when the removal
    // commits, instead of receiving the conversation until they disconnect.
    @Optional()
    @Inject(REALTIME_REVOCATION)
    private readonly revocation: RealtimeRevocation = NO_REALTIME_REVOCATION,
  ) {}

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
    if (!isUuid(id)) {
      throw new CommError(CommErrorCode.CONVERSATION_NOT_FOUND, 'conversation not found', 404);
    }
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

  /**
   * RT-032 -- linearizes a state-changing operation with a deactivation.
   *
   * The actor was resolved when the request authenticated; a deactivation can
   * commit between that read and this operation's commit. Called INSIDE the
   * operation's transaction, this takes FOR SHARE on the actor's login account
   * and principal row -- in the order deliveries lock them (account, then
   * principal), so neither deadlocks the other -- and re-reads liveness from
   * the locked rows. A deactivation that committed first is what the locked
   * read returns (refused); one that arrives later waits for this transaction,
   * so the operation is ordered strictly BEFORE it. Either way nothing an
   * inactive actor did commits after their deactivation.
   */
  async assertActorLive(tx: Prisma.TransactionClient, actor: Actor): Promise<void> {
    type Row = { live: boolean; account_id: string | null };
    // One fixed statement per principal table (tagged, parameterized -- no
    // identifier is ever interpolated). `bound` reads the login without a lock;
    // `locked` takes the principal row FOR SHARE after the account row.
    let bound: (id: string) => Promise<Row[]>;
    let locked: (id: string) => Promise<Row[]>;
    switch (actor.kind) {
      case ActorKind.CONTACT:
        bound = (id) => tx.$queryRaw<Row[]>`
          SELECT is_active AS live, account_id::text AS account_id FROM chat.contact WHERE id = ${id}::uuid`;
        locked = (id) => tx.$queryRaw<Row[]>`
          SELECT is_active AS live, account_id::text AS account_id FROM chat.contact WHERE id = ${id}::uuid FOR SHARE`;
        break;
      case ActorKind.STAFF:
        bound = (id) => tx.$queryRaw<Row[]>`
          SELECT (is_active AND left_at IS NULL) AS live, account_id::text AS account_id FROM chat.staff WHERE id = ${id}::uuid`;
        locked = (id) => tx.$queryRaw<Row[]>`
          SELECT (is_active AND left_at IS NULL) AS live, account_id::text AS account_id FROM chat.staff WHERE id = ${id}::uuid FOR SHARE`;
        break;
      case ActorKind.TEACHER:
        bound = (id) => tx.$queryRaw<Row[]>`
          SELECT (is_active AND left_at IS NULL) AS live, account_id::text AS account_id FROM chat.teacher WHERE id = ${id}::uuid`;
        locked = (id) => tx.$queryRaw<Row[]>`
          SELECT (is_active AND left_at IS NULL) AS live, account_id::text AS account_id FROM chat.teacher WHERE id = ${id}::uuid FOR SHARE`;
        break;
      default:
        return; // the system actor has no row to deactivate
    }
    const accountId = (await bound(actor.actorId))[0]?.account_id ?? null;
    let accountLive = true;
    if (accountId) {
      const a = await tx.$queryRaw<{ live: boolean }[]>`
        SELECT (is_active AND status = 'active') AS live FROM chat.account WHERE id = ${accountId}::uuid FOR SHARE`;
      accountLive = a[0]?.live === true;
    }
    const p = await locked(actor.actorId);
    // A login re-bound in between is not the identity that authenticated.
    if (p[0]?.live !== true || !accountLive || (p[0].account_id ?? null) !== accountId) {
      throw new CommError(CommErrorCode.ACTOR_INACTIVE, 'this account is no longer active');
    }
    if (this.afterLiveLock) await this.afterLiveLock(actor.actorId);
  }

  /**
   * TEST SEAM ONLY -- undefined in production, and then not even awaited. Runs
   * while assertActorLive's locks are held, so a test can race a deactivation
   * against an operation that has already passed its live check.
   */
  afterLiveLock?: (actorId: string) => Promise<void>;

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

  /**
   * The staff-scope fact `AuthorizationService.canRead` decides on: PD-8's
   * chat.staff_conversation_access(), the one rule. Free for anybody who is
   * not staff (no query).
   */
  async staffInScope(
    actor: Actor,
    conv: Pick<Conversation, 'id' | 'organizationId'>,
    now = new Date(),
  ): Promise<boolean> {
    return (await this.staffAccess(actor, conv, now)) !== null;
  }

  /** The staff actor's scope BASIS on the conversation (PD-8), or null. */
  async staffAccess(
    actor: Actor,
    conv: Pick<Conversation, 'id' | 'organizationId'>,
    now = new Date(),
  ): Promise<StaffAccessBasis | null> {
    if (actor.kind !== ActorKind.STAFF) return null;
    return this.authz.staffAccess(actor, conv, now);
  }

  /**
   * PD-7: is this a DIRECT conversation pairing a teacher with a family contact?
   * Such a conversation can exist only from the PD-6 window; it is readable
   * history and accepts nothing new -- not a message (canSend), not a call
   * (canCall), and not the side channels that are not messages: a new reaction,
   * a typing indicator.
   */
  async isDirectTeacherParent(conversationId: string): Promise<boolean> {
    const rows = await this.prisma.$queryRaw<Array<{ hit: boolean }>>`
      SELECT (c.type = 'direct'
              AND bool_or(m.actor_kind = 'teacher')
              AND bool_or(m.actor_kind = 'contact')) AS hit
        FROM chat.conversation c
        JOIN chat.conversation_member m ON m.conversation_id = c.id AND m.left_at IS NULL
       WHERE c.id = ${conversationId}::uuid
       GROUP BY c.type`;
    return rows[0]?.hit === true;
  }

  /** canRead with the staff-scope fact resolved: the one read check every path uses. */
  async canReadResolved(
    actor: Actor,
    conv: Conversation,
    membership: Pick<ConversationMember, 'actorId' | 'actorKind' | 'memberRole' | 'isSilent' | 'leftAt'> | null,
  ) {
    return this.authz.canRead(actor, conv, membership, await this.staffInScope(actor, conv));
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
  /**
   * PD-26: which of these teachers are away today (the academy's), until when.
   * `staffView` keeps why; anyone else reads leave or away (a suspension or a
   * recorded day off is not theirs to know). Computed on every read.
   */
  async teachersAway(teacherIds: string[], staffView: boolean): Promise<Map<string, MemberAwayDto>> {
    if (teacherIds.length === 0) return new Map();
    const rows = await this.prisma.$queryRaw<Array<{ id: string; kind: 'leave' | 'suspended' | 'day_off'; until: Date }>>`
      SELECT t.id::text AS id, a.kind, a.until
        FROM unnest(${teacherIds}::uuid[]) AS t(id)
        CROSS JOIN LATERAL chat.teacher_away(t.id, chat.academy_today()) a`;
    return new Map(
      rows.map((r) => [
        r.id,
        { kind: staffView || r.kind === 'leave' ? r.kind : 'away', until: r.until.toISOString().slice(0, 10) },
      ]),
    );
  }

  async readWithMembers(
    conversationId: string,
    actorId: string,
  ): Promise<{ conversation: ConversationWithLearner; members: ResolvedMember[] }> {
    const actor = await this.requireActor(actorId);
    const conversation = await this.requireConversation(conversationId);
    const membership = await this.membershipOf(conversation.id, actor.actorId);

    const decision = await this.canReadResolved(actor, conversation, membership);
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
    return (await this.membersOfMany([conversationId], viewer)).get(conversationId) ?? [];
  }

  /**
   * `membersOf` for a whole list at once: ONE membership query and ONE identity
   * batch (at most one query per actor kind), whatever the number of
   * conversations -- so the chat list can name the other side of every direct
   * conversation without a request per row (gap O3, list half).
   *
   * Same rule as `membersOf`: THE CALLER AUTHORIZES FIRST. The list route hands
   * it exactly the ids `listForActor` returned.
   */
  async membersOfMany(
    conversationIds: readonly string[],
    viewer?: Actor,
  ): Promise<Map<string, ResolvedMember[]>> {
    const out = new Map<string, ResolvedMember[]>(conversationIds.map((id) => [id, []]));
    if (conversationIds.length === 0) return out;

    const rows = await this.prisma.conversationMember.findMany({
      where: { conversationId: { in: [...conversationIds] }, leftAt: null },
      orderBy: { joinedAt: 'asc' },
    });

    const actors = await this.identity.resolveActors(
      rows.map((m) => ({ actorId: m.actorId, actorKind: m.actorKind })),
    );

    const openable = await this.openableFor(viewer, rows, actors);

    for (const m of rows) {
      const key = actorRefKey({ actorId: m.actorId, actorKind: m.actorKind });
      out.get(m.conversationId)?.push({
        actorId: m.actorId,
        actorKind: m.actorKind,
        memberRole: m.memberRole,
        isSilent: m.isSilent,
        displayName: actors.get(key)?.displayName ?? '',
        canOpenDirect: openable.has(key),
        // Signed for this viewer in this conversation; without a viewer, none.
        avatarUrl: viewer ? signActorAvatar(actors.get(key), m.conversationId, viewer.actorId) : null,
      });
    }
    return out;
  }

  /**
   * Which of these members the viewer may open a 1:1 with.
   *
   * The decision is `AuthorizationService.canOpenDirect` -- the same method the
   * `POST /conversations/direct` request runs -- so the advisory cannot drift
   * from the enforcement. It is decided from the two actors alone (BR-1 under
   * PD-7 needs no relationship lookup), so it costs no query per member.
   */
  private async openableFor(
    viewer: Actor | undefined,
    rows: ReadonlyArray<{ actorId: string; actorKind: string }>,
    actors: ResolvedActors,
  ): Promise<Set<string>> {
    const openable = new Set<string>();
    if (!viewer) return openable;

    const others: Actor[] = [];
    for (const row of rows) {
      const other = actors.get(actorRefKey({ actorId: row.actorId, actorKind: row.actorKind }));
      // An unresolved member is not a correspondent. Same actor is refused by
      // canOpenDirect itself.
      if (other && other.actorId !== viewer.actorId) others.push(other);
    }

    // PD-8: a Parent <-> staff pair needs the staff side to reach the family.
    // One batched query for every such pair on the page.
    const pairs = others
      .map((other) => ConversationService.staffFamilyPair(viewer, other))
      .filter((p): p is { staffId: string; familyId: string } => p !== null);
    const reach = await this.authz.reachesFamilyMany(pairs, new Date());

    for (const other of others) {
      const pair = ConversationService.staffFamilyPair(viewer, other);
      const reaches = pair !== null && reach.has(`${pair.staffId}:${pair.familyId}`);
      if (this.authz.canOpenDirect(viewer, other, reaches).allowed) {
        openable.add(actorRefKey({ actorId: other.actorId, actorKind: other.kind }));
      }
    }

    return openable;
  }

  /** The (staff, family) pair whose reach a Parent <-> staff channel depends on. */
  private static staffFamilyPair(a: Actor, b: Actor): { staffId: string; familyId: string } | null {
    const staff = a.kind === ActorKind.STAFF ? a : b.kind === ActorKind.STAFF ? b : null;
    const contact = a.kind === ActorKind.CONTACT ? a : b.kind === ActorKind.CONTACT ? b : null;
    if (!staff || !contact?.familyId) return null;
    return { staffId: staff.actorId, familyId: contact.familyId };
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
    // `otherId` is the one id here that comes straight from a request body.
    if (!isUuid(otherId)) throw new CommError(CommErrorCode.UNKNOWN_ACTOR, 'unknown actor', 401);
    const a = await this.requireActor(requesterId);
    const b = await this.requireActor(otherId);

    // BR-1 (PD-7): a teacher<->parent pair is refused here from the two
    // actors' kinds alone. `otherId` selected a row; it asserted nothing.
    // PD-8: a Parent <-> staff pair also needs the staff side to be in charge
    // of the parent's family, resolved here from server-owned rows.
    const pair = ConversationService.staffFamilyPair(a, b);
    const staffSide = pair ? (a.actorId === pair.staffId ? a : b) : null;
    const reaches = pair && staffSide ? await this.authz.reachesFamily(staffSide, pair.familyId, new Date()) : false;
    const decision = this.authz.canOpenDirect(a, b, reaches);
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

        // Realtime: both members' devices learn the channel exists (each gets
        // `conversation.added` in its own actor room) without a manual refresh.
        await this.outbox.enqueue(tx, CommEvent.MEMBERSHIP_CHANGED, {
          conversationId: conv.id,
          added: [a.actorId, b.actorId],
          removed: [],
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
    const supervisorId = await this.supervisorOf(learner.id);
    const scoped = this.authz.canProvisionStudentGroupFor(
      actor,
      provisioningTarget(learner, supervisorId, await this.actsForOrNull(actor, supervisorId)),
    );
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
        // PD-8: the CHILD's supervisor, not the family owner -- children of one
        // family may have different supervisors.
        actorId: supervisorId as string,
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

      // Realtime: every member's devices learn the group exists.
      await this.outbox.enqueue(tx, CommEvent.MEMBERSHIP_CHANGED, {
        conversationId: conv.id,
        added: members.map((m) => m.actorId),
        removed: [],
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
    const supervisorId = await this.supervisorOf(learner.id);
    const scoped = this.authz.canProvisionStudentGroupFor(
      actor,
      provisioningTarget(learner, supervisorId, await this.actsForOrNull(actor, supervisorId)),
    );
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
    desired.set(supervisorId as string, {
      actorId: supervisorId as string,
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
    // PD-35: a seat is taken by choice and a reconcile never ends one. A seat
    // holder now wanted here in their own right keeps the row; the seat ends
    // as absorbed, so leaving it can never take that membership away.
    const seated = new Set(await this.seatHolderIds(this.prisma, conv.id));
    const toAbsorb = [...seated].filter((id) => desired.has(id));

    const toAdd = [...desired.values()].filter((m) => !currentIds.has(m.actorId));
    const toRemove = current.filter((m) => !desired.has(m.actorId) && !seated.has(m.actorId));

    if (toAdd.length === 0 && toRemove.length === 0) {
      if (toAbsorb.length > 0) {
        await this.prisma.$transaction(async (tx) => {
          for (const id of toAbsorb) await this.absorbSeat(tx, conv.id, id);
        });
      }
      // RT-009: nothing changed NOW, but this may be the retry of a sync whose
      // removal committed and was not confirmed. Never report it complete
      // without the barrier.
      await this.revocation.confirmRevoked();
      return conv;
    }

    await this.prisma.$transaction(async (tx) => {
      for (const id of toAbsorb) await this.absorbSeat(tx, conv.id, id);
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

  // ------------------------------------------------------------------
  // PD-8: per-learner supervision and supervisor-created family groups
  // ------------------------------------------------------------------

  /** The child's supervisor (chat.learner_supervision), or null when unassigned. */
  async supervisorOf(learnerId: string): Promise<string | null> {
    const row = await this.prisma.learnerSupervision.findUnique({
      where: { learnerId },
      select: { supervisorId: true },
    });
    return row?.supervisorId ?? null;
  }

  /** How a staff actor acts for `principalId`; null for anybody else or no principal. */
  private async actsForOrNull(actor: Actor, principalId: string | null) {
    if (principalId === null || actor.kind !== ActorKind.STAFF) return null;
    return this.authz.actsFor(actor, principalId, new Date());
  }

  /** Teachers of a family group's learners: the only teachers it may admit. */
  private async anchorTeacherIds(conversationId: string): Promise<string[]> {
    const rows = await this.prisma.$queryRaw<Array<{ teacher_id: string }>>`
      SELECT DISTINCT l.teacher_id::text AS teacher_id
        FROM chat.conversation_learner cl
        JOIN chat.learner l ON l.id = cl.learner_id
       WHERE cl.conversation_id = ${conversationId}::uuid AND l.teacher_id IS NOT NULL`;
    return rows.map((r) => r.teacher_id);
  }

  /**
   * PD-8: a supervisor creates a group about one or more children of ONE family
   * who are all theirs, and chooses which of the family's parents and which of
   * those children's teachers join it.
   *
   * Every participant is checked against server-owned rows before anything is
   * written, and again by the database (chat.guard_family_group_member,
   * chat.assert_family_group_coherent), so no request can associate a parent,
   * teacher or child with a group that is not theirs:
   *   - learners: same family, same organization, ONE supervisor;
   *   - actor: that supervisor, their active backup, their manager, or the
   *     super admin;
   *   - parents: active, can_message contacts of THAT family;
   *   - teachers: each teaches at least one of the group's children.
   * The supervisor is always a member (BR-1 requires a live admin).
   */
  async createFamilyGroup(
    actorId: string,
    input: { learnerIds?: unknown; contactIds?: unknown; teacherIds?: unknown; title?: unknown },
  ): Promise<Conversation> {
    const actor = await this.requireActor(actorId);
    const gate = this.authz.canProvisionStudentGroup(actor);
    if (!gate.allowed) throw new CommError(gate.code, gate.reason);

    const request = validateFamilyGroupRequest(input);
    const learners = await this.prisma.learner.findMany({
      where: { id: { in: request.learnerIds } },
      include: { family: { select: { id: true, organizationId: true } } },
    });
    // Unknown and foreign learners are answered alike: never confirm an id.
    if (
      learners.length !== request.learnerIds.length ||
      learners.some((l) => l.organizationId !== actor.organizationId)
    ) {
      throw new CommError(CommErrorCode.CONVERSATION_NOT_FOUND, 'learner not found', 404);
    }
    const familyIds = new Set(learners.map((l) => l.familyId));
    if (familyIds.size !== 1) {
      throw new CommError(
        CommErrorCode.ORG_STRUCTURE_INVALID,
        "a family group is about one family's children only",
        409,
      );
    }
    const familyId = learners[0].familyId;

    const supervision = await this.prisma.learnerSupervision.findMany({
      where: { learnerId: { in: request.learnerIds } },
    });
    if (supervision.length !== learners.length) {
      throw new CommError(
        CommErrorCode.LEARNER_UNSUPERVISED,
        'every child in the group needs a supervisor first',
        409,
      );
    }
    const supervisors = new Set(supervision.map((r) => r.supervisorId));
    if (supervisors.size !== 1) {
      throw new CommError(
        CommErrorCode.ORG_STRUCTURE_INVALID,
        'a family group is about children of one supervisor; children with different supervisors get separate groups',
        409,
      );
    }
    const supervisorId = supervision[0].supervisorId;
    const scoped = this.authz.canProvisionStudentGroupFor(
      actor,
      provisioningTarget(learners[0], supervisorId, await this.actsForOrNull(actor, supervisorId)),
    );
    if (!scoped.allowed) throw provisioningRefusal(scoped);

    const contacts = await this.prisma.contact.findMany({ where: { id: { in: request.contactIds } } });
    if (
      contacts.length !== request.contactIds.length ||
      contacts.some((c) => c.familyId !== familyId || !c.isActive || !c.canMessage)
    ) {
      throw new CommError(
        CommErrorCode.INVALID_PARTICIPANTS,
        "a family group admits only this family's messaging parents",
      );
    }
    const teachersOfChildren = new Set(learners.map((l) => l.teacherId).filter((t): t is string => !!t));
    const teachers = await this.prisma.teacher.findMany({ where: { id: { in: request.teacherIds } } });
    if (
      teachers.length !== request.teacherIds.length ||
      teachers.some((t) => !teachersOfChildren.has(t.id) || !t.isActive || t.leftAt !== null)
    ) {
      throw new CommError(
        CommErrorCode.INVALID_PARTICIPANTS,
        "a family group admits only active teachers of the group's children",
      );
    }

    const members: MemberSpec[] = [
      { actorId: supervisorId, actorKind: ActorKind.STAFF, memberRole: MemberRole.ADMIN },
      ...contacts.map((c) => ({ actorId: c.id, actorKind: ActorKind.CONTACT, memberRole: MemberRole.PARENT })),
      ...teachers.map((t) => ({ actorId: t.id, actorKind: ActorKind.TEACHER, memberRole: MemberRole.TEACHER })),
    ];
    // In the order the supervisor chose the children, so the name is stable.
    const ordered = [...learners].sort((a, b) => request.learnerIds.indexOf(a.id) - request.learnerIds.indexOf(b.id));
    const title = request.title ?? familyGroupTitle(teachers.map((t) => t.name), ordered.map((l) => l.name));

    return this.prisma.$transaction(async (tx) => {
      await this.assertActorLive(tx, actor);
      const conv = await tx.conversation.create({
        data: {
          organizationId: learners[0].organizationId,
          type: ConversationType.FAMILY_GROUP,
          familyId,
          learnerId: null,
          title,
        },
      });
      // Anchors first: the member guard admits a teacher only of an anchored child.
      await tx.conversationLearner.createMany({
        data: learners.map((l) => ({
          conversationId: conv.id,
          learnerId: l.id,
          organizationId: conv.organizationId,
          addedBy: actor.kind === ActorKind.STAFF ? actor.actorId : null,
        })),
      });
      await tx.conversationMember.createMany({
        data: members.map((m) => ({
          conversationId: conv.id,
          actorId: m.actorId,
          actorKind: m.actorKind,
          memberRole: m.memberRole,
          addedBy: actor.kind === ActorKind.STAFF ? actor.actorId : null,
        })),
      });
      await this.systemMessage(tx, conv.id, 'group.created', { learner: learners.map((l) => l.name).join(', ') });
      await this.audit.audit(tx, {
        actorId: actor.kind === ActorKind.STAFF ? actor.actorId : null,
        action: 'family_group.created',
        entity: 'conversation',
        entityId: conv.id,
        after: {
          learnerIds: learners.map((l) => l.id),
          supervisorId,
          contactIds: contacts.map((c) => c.id),
          teacherIds: teachers.map((t) => t.id),
        },
        reason: 'family group created',
      });
      await this.outbox.enqueue(tx, CommEvent.MEMBERSHIP_CHANGED, {
        conversationId: conv.id,
        added: members.map((m) => m.actorId),
        removed: [],
      });
      return conv;
    });
  }

  /**
   * PD-8: children moved to `newSupervisorId`. Called by OrgStructureService
   * INSIDE the transaction that writes the new chat.learner_supervision rows,
   * so the deferred coherence trigger judges the result, not the steps.
   *
   *   - each child's Student Group: the old supervisor's admin seat goes to the
   *     new one (the group IS the child's, so it follows the child);
   *   - a family group about moving children only: transferred the same way --
   *     the same conversation, its members, messages and attachments untouched;
   *   - a family group about a moving child AND children who stay: the moving
   *     children are detached and the group stays with the old supervisor's
   *     remaining children (its teachers who teach none of them leave --
   *     chat.prune_family_group_teachers). PD-24's transfer moves every child
   *     of a group together, so it never reaches this branch.
   *
   * Access to everything else follows by itself: staff scope is computed from
   * chat.learner_supervision at every read. Returns the members removed per
   * conversation, for the caller to evict from realtime rooms after commit.
   */
  async reconcileSupervisionChange(
    tx: Prisma.TransactionClient,
    learners: string | readonly string[],
    oldSupervisors: string | null | readonly string[],
    newSupervisorId: string,
    actorId: string | null,
  ): Promise<Array<{ conversationId: string; removed: string[] }>> {
    const learnerIds = typeof learners === 'string' ? [learners] : [...learners];
    const oldIds = (oldSupervisors === null ? [] : typeof oldSupervisors === 'string' ? [oldSupervisors] : [...oldSupervisors])
      .filter((id) => id !== newSupervisorId);
    const evictions: Array<{ conversationId: string; removed: string[] }> = [];
    const newcomer = await tx.staff.findUnique({ where: { id: newSupervisorId }, select: { name: true } });
    const done = new Set<string>();
    const swapAdmin = async (conversationId: string) => {
      if (done.has(conversationId)) return;
      done.add(conversationId);
      const removed: string[] = [];
      for (const oldId of oldIds) {
        const ended = await tx.conversationMember.updateMany({
          where: { conversationId, actorId: oldId, actorKind: ActorKind.STAFF, leftAt: null },
          data: { leftAt: new Date() },
        });
        if (ended.count > 0) removed.push(oldId);
      }
      const present = await tx.conversationMember.findFirst({
        where: { conversationId, actorId: newSupervisorId, leftAt: null },
      });
      // PD-35: the new supervisor may already sit here by choice; the row is
      // theirs now as supervisor, and the seat ends as absorbed.
      if (present) await this.absorbSeat(tx, conversationId, newSupervisorId);
      if (!present) {
        await tx.conversationMember.create({
          data: {
            conversationId,
            actorId: newSupervisorId,
            actorKind: ActorKind.STAFF,
            memberRole: MemberRole.ADMIN,
            addedBy: actorId,
          },
        });
      }
      await this.systemMessage(tx, conversationId, 'group.supervisor_changed', { supervisor: newcomer?.name ?? null });
      await this.outbox.enqueue(tx, CommEvent.MEMBERSHIP_CHANGED, {
        conversationId,
        added: present ? [] : [newSupervisorId],
        removed,
      });
      evictions.push({ conversationId, removed });
    };

    const studentGroups = await tx.conversation.findMany({
      where: { learnerId: { in: learnerIds }, type: ConversationType.STUDENT_GROUP, archivedAt: null },
      select: { id: true },
    });
    for (const g of studentGroups) await swapAdmin(g.id);

    const anchored = await tx.conversationLearner.findMany({
      where: { learnerId: { in: learnerIds } },
      select: { conversationId: true },
      distinct: ['conversationId'],
    });
    for (const { conversationId } of anchored) {
      const group = await tx.conversation.findUnique({ where: { id: conversationId }, select: { archivedAt: true } });
      if (!group || group.archivedAt) continue;
      const others = await tx.conversationLearner.count({
        where: { conversationId, learnerId: { notIn: learnerIds } },
      });
      if (others === 0) {
        await swapAdmin(conversationId);
        continue;
      }
      const teachersBefore = await tx.conversationMember.findMany({
        where: { conversationId, actorKind: ActorKind.TEACHER, leftAt: null },
        select: { actorId: true },
      });
      await tx.conversationLearner.deleteMany({ where: { conversationId, learnerId: { in: learnerIds } } });
      const teachersAfter = new Set(
        (
          await tx.conversationMember.findMany({
            where: { conversationId, actorKind: ActorKind.TEACHER, leftAt: null },
            select: { actorId: true },
          })
        ).map((m) => m.actorId),
      );
      const removed = teachersBefore.map((m) => m.actorId).filter((id) => !teachersAfter.has(id));
      await this.systemMessage(tx, conversationId, 'group.learner_detached', {});
      await this.outbox.enqueue(tx, CommEvent.MEMBERSHIP_CHANGED, { conversationId, added: [], removed });
      evictions.push({ conversationId, removed });
    }
    return evictions;
  }

  /**
   * PD-24: a parent's 1:1 with the supervisor who no longer has their family
   * passes to the new supervisor -- the same conversation, its whole history,
   * the old supervisor's seat ended and the new one's added, the pair key
   * rewritten. Called inside the transfer's transaction, after the supervision
   * rows are written.
   *
   * Left alone when the old supervisor still has another child of the family
   * (the 1:1 is still theirs) or when the parent already has a 1:1 with the new
   * supervisor (two threads cannot share one pair key; the old one stays as
   * history the old supervisor no longer reads -- chat.staff_conversation_access
   * asks that a 1:1's staff member still reaches the family). In both cases the
   * parent is given a 1:1 with the new supervisor if they have none.
   */
  async transferFamilyDirects(
    tx: Prisma.TransactionClient,
    familyId: string,
    oldSupervisorIds: readonly string[],
    newSupervisorId: string,
    actorId: string,
  ): Promise<{ evictions: Array<{ conversationId: string; removed: string[] }>; transferred: number; opened: number }> {
    const evictions: Array<{ conversationId: string; removed: string[] }> = [];
    let transferred = 0;
    let opened = 0;
    const newcomer = await tx.staff.findUnique({ where: { id: newSupervisorId }, select: { name: true, organizationId: true } });
    const contacts = await tx.contact.findMany({ where: { familyId, isActive: true }, select: { id: true } });
    for (const contact of contacts) {
      let hadOld = false;
      for (const oldId of oldSupervisorIds) {
        if (oldId === newSupervisorId) continue;
        const direct = await tx.conversation.findUnique({
          where: { directKey: ConversationService.directKey(contact.id, oldId) },
          select: { id: true, archivedAt: true },
        });
        if (!direct || direct.archivedAt) continue;
        hadOld = true;
        const stillTheirs = (
          await tx.$queryRaw<Array<{ ok: boolean }>>`
            SELECT chat.supervises_a_child_of(${oldId}::uuid, ${familyId}::uuid) AS ok`
        )[0]?.ok === true;
        if (stillTheirs) continue;
        const clash = await tx.conversation.findUnique({
          where: { directKey: ConversationService.directKey(contact.id, newSupervisorId) },
          select: { id: true },
        });
        if (clash) continue;

        const ended = await tx.conversationMember.updateMany({
          where: { conversationId: direct.id, actorId: oldId, actorKind: ActorKind.STAFF, leftAt: null },
          data: { leftAt: new Date() },
        });
        await tx.conversationMember.create({
          data: {
            conversationId: direct.id,
            actorId: newSupervisorId,
            actorKind: ActorKind.STAFF,
            memberRole: MemberRole.ADMIN,
            addedBy: actorId,
          },
        });
        await tx.conversation.update({
          where: { id: direct.id },
          data: { directKey: ConversationService.directKey(contact.id, newSupervisorId) },
        });
        await this.systemMessage(tx, direct.id, 'direct.supervisor_changed', { supervisor: newcomer?.name ?? null });
        const removed = ended.count > 0 ? [oldId] : [];
        await this.outbox.enqueue(tx, CommEvent.MEMBERSHIP_CHANGED, {
          conversationId: direct.id,
          added: [newSupervisorId],
          removed,
        });
        evictions.push({ conversationId: direct.id, removed });
        transferred += 1;
      }
      if (!hadOld || !newcomer) continue;
      const key = ConversationService.directKey(contact.id, newSupervisorId);
      if (await tx.conversation.findUnique({ where: { directKey: key }, select: { id: true } })) continue;
      const conv = await tx.conversation.create({
        data: { organizationId: newcomer.organizationId, type: ConversationType.DIRECT, directKey: key, familyId, title: null },
      });
      await tx.conversationMember.createMany({
        data: [
          { conversationId: conv.id, actorId: contact.id, actorKind: ActorKind.CONTACT, memberRole: MemberRole.PARENT },
          { conversationId: conv.id, actorId: newSupervisorId, actorKind: ActorKind.STAFF, memberRole: MemberRole.ADMIN, addedBy: actorId },
        ],
      });
      await this.outbox.enqueue(tx, CommEvent.MEMBERSHIP_CHANGED, {
        conversationId: conv.id,
        added: [contact.id, newSupervisorId],
        removed: [],
      });
      opened += 1;
    }
    return { evictions, transferred, opened };
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
      include: { learner: { select: { teacherId: true } } },
    });
    if (!conv) {
      throw new CommError(CommErrorCode.CONVERSATION_NOT_FOUND, 'conversation not found', 404);
    }
    const now = new Date();
    const own = await this.membershipOf(conv.id, actor.actorId);
    const scoped = this.authz.canManageMembershipIn(actor, {
      type: conv.type,
      organizationId: conv.organizationId,
      actorBasis: await this.authz.staffAccess(actor, conv, now),
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

    const candidate = await this.memberCandidate(request.actorKind, request.actorId, conv, now);
    const eligible = this.authz.canAddMember(
      {
        type: conv.type,
        organizationId: conv.organizationId,
        familyId: conv.familyId,
        learnerTeacherId: conv.learner?.teacherId ?? null,
        anchorTeacherIds: conv.type === ConversationType.FAMILY_GROUP ? await this.anchorTeacherIds(conv.id) : [],
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
  private async memberCandidate(
    kind: string,
    id: string,
    conv: Pick<Conversation, 'id' | 'organizationId'>,
    now: Date,
  ) {
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
        if (!st) return null;
        // PD-8: the candidate's OWN scope on this conversation, by the same rule
        // every read uses -- a staff member joins only what they are in charge of.
        const access = await this.authz.staffAccess(
          {
            actorId: st.id,
            kind: ActorKind.STAFF,
            displayName: st.name,
            locale: 'ar',
            isActive: st.isActive && st.leftAt === null,
            staffRole: st.role as Actor['staffRole'],
            organizationId: st.organizationId,
          },
          conv,
          now,
        );
        return {
          kind: 'staff' as const,
          organizationId: st.organizationId,
          isActive: st.isActive,
          leftAt: st.leftAt,
          staffRole: st.role,
          access,
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
   * PD-8: the supervisor responsible for a group -- the default approver of its
   * held messages. Null for a conversation that is not a group about
   * supervised learners. (Was the sticky handler / on_duty(); neither decides
   * anything since PD-8.)
   */
  async responsibleSupervisor(conv: Pick<Conversation, 'id'>): Promise<string | null> {
    return this.authz.responsibleSupervisor(conv.id);
  }

  /**
   * RBAC-scoped chat list. A contact or teacher only ever sees their own.
   *
   * Staff see exactly what `AuthorizationService.canRead` would let them open
   * (PD-8): the ids come from chat.staff_visible_conversation_ids, which filters
   * every candidate through chat.staff_conversation_access -- the same function
   * the per-conversation check asks -- so the list and the check cannot
   * disagree. The organization filter is restated here as a second, independent
   * bound.
   */
  async listForActor(actorId: string): Promise<ConversationWithLearner[]> {
    const actor = await this.requireActor(actorId);

    if (actor.kind === ActorKind.STAFF) {
      if (!actor.isActive) {
        throw new CommError(CommErrorCode.ACTOR_INACTIVE, 'actor is inactive');
      }
      if (!isConversationStaff(actor)) {
        throw new CommError(
          CommErrorCode.ROLE_CANNOT_MESSAGE_FAMILY,
          `role ${actor.staffRole} may not access conversations`,
        );
      }
      if (!actor.organizationId) return [];

      const ids = await this.authz.visibleConversationIds(actor, new Date());
      if (ids.length === 0) return [];
      return this.prisma.conversation.findMany({
        where: { id: { in: ids }, organizationId: actor.organizationId },
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

  /**
   * The viewer's own pin / archive / mute for these conversations, read back
   * (setPreferences writes them). THE CALLER AUTHORIZES THE IDS. One query.
   */
  /**
   * The child each of these groups is about, when it is about exactly ONE: the
   * group's picture is then that child's photo (WhatsApp-style). Student groups
   * name their learner on the row; family groups link theirs through
   * chat.conversation_learner, read here in one query. THE CALLER AUTHORIZES
   * THE IDS. Returns the learner's id and stored key -- never sent as such.
   */
  async soleChildOf(
    conversations: ReadonlyArray<{ id: string; learner?: { id: string; avatarObjectKey?: string | null } | null }>,
  ): Promise<Map<string, { id: string; avatarObjectKey: string | null }>> {
    const out = new Map<string, { id: string; avatarObjectKey: string | null }>();
    const unlinked: string[] = [];
    for (const c of conversations) {
      if (c.learner) out.set(c.id, { id: c.learner.id, avatarObjectKey: c.learner.avatarObjectKey ?? null });
      else unlinked.push(c.id);
    }
    if (unlinked.length === 0) return out;
    const links = await this.prisma.conversationLearner.findMany({
      where: { conversationId: { in: unlinked } },
      select: { conversationId: true, learnerId: true },
    });
    const byConv = new Map<string, string[]>();
    for (const l of links) byConv.set(l.conversationId, [...(byConv.get(l.conversationId) ?? []), l.learnerId]);
    const sole = [...byConv].filter(([, ids]) => ids.length === 1);
    if (sole.length === 0) return out;
    const learners = await this.prisma.learner.findMany({
      where: { id: { in: sole.map(([, ids]) => ids[0]!) } },
      select: { id: true, avatarObjectKey: true },
    });
    const keyOf = new Map(learners.map((l) => [l.id, l.avatarObjectKey]));
    for (const [convId, [learnerId]] of sole) {
      if (keyOf.has(learnerId!)) out.set(convId, { id: learnerId!, avatarObjectKey: keyOf.get(learnerId!) ?? null });
    }
    return out;
  }

  async viewerStates(conversationIds: readonly string[], actorId: string) {
    const rows = await this.prisma.conversationParticipantState.findMany({
      where: { conversationId: { in: [...conversationIds] }, actorId },
      select: {
        conversationId: true,
        pinnedAt: true,
        archivedAt: true,
        mutedUntil: true,
        favoritedAt: true,
        theme: true,
        wallpaperObjectKey: true,
      },
    });
    return new Map(rows.map((r) => [r.conversationId, r]));
  }

  /** Archive / mute / pin / favorite are per-user; one user's pin never affects another. */
  async setPreferences(
    conversationId: string,
    actorId: string,
    prefs: { archived?: boolean; pinned?: boolean; mutedUntil?: Date | null; favorite?: boolean },
  ): Promise<void> {
    const actor = await this.requireActor(actorId);
    const conv = await this.requireConversation(conversationId);
    const membership = await this.membershipOf(conv.id, actor.actorId);
    const decision = await this.canReadResolved(actor, conv, membership);
    if (!decision.allowed) throw new CommError(decision.code, decision.reason);

    const patch = {
      archivedAt: prefs.archived === undefined ? undefined : prefs.archived ? new Date() : null,
      pinnedAt: prefs.pinned === undefined ? undefined : prefs.pinned ? new Date() : null,
      mutedUntil: prefs.mutedUntil === undefined ? undefined : prefs.mutedUntil,
      favoritedAt: prefs.favorite === undefined ? undefined : prefs.favorite ? new Date() : null,
    };

    await this.prisma.conversationParticipantState.upsert({
      where: { conversationId_actorId: { conversationId, actorId: actor.actorId } },
      create: { conversationId, actorId: actor.actorId, ...patch },
      update: patch,
    });

    // PD-34 / PD-37: a mute holds from the moment it is set. A message push
    // already waiting for this person in this chat (coalesced, or deferred by
    // quiet hours) is withdrawn now, so muting never lets one more through;
    // the Center entry stays (the trigger leaves it for MUTED). Calls are not
    // message pushes and are untouched.
    if (patch.mutedUntil && patch.mutedUntil > new Date()) {
      await this.prisma.notification.updateMany({
        where: { recipientId: actor.actorId, conversationId, eventType: 'message_published', status: 'scheduled' },
        data: { status: 'cancelled', failureCode: 'MUTED' },
      });
    }
  }

  /**
   * A visible line ("Ola joined to support"), posted inside the caller's
   * transaction and announced to open screens with no push
   * (MessageCreatedPayload.silent). PD-33 and PD-35.
   */
  async postAnnouncement(
    tx: Prisma.TransactionClient,
    conversationId: string,
    kind: string,
    payload: Record<string, unknown>,
  ): Promise<void> {
    const message = await this.systemMessage(tx, conversationId, kind, payload);
    await this.outbox.enqueue(tx, CommEvent.MESSAGE_CREATED, {
      conversationId,
      messageId: message.id,
      seq: message.seq?.toString() ?? '0',
      authorKind: message.authorType,
      authorId: null,
      type: message.type,
      visibility: message.visibility,
      moderation: message.moderation,
      createdAt: message.createdAt.toISOString(),
      silent: true,
    });
  }

  /**
   * PD-35: the staff holding an open seat in this conversation. A reconcile
   * keeps them: a seat is taken by choice and ends only through the seat
   * service (leave, or the sweep when it no longer holds).
   */
  private async seatHolderIds(db: Prisma.TransactionClient | PrismaService, conversationId: string): Promise<string[]> {
    const rows = await db.$queryRaw<Array<{ staff_id: string }>>`
      SELECT staff_id::text AS staff_id FROM chat.conversation_seat
       WHERE conversation_id = ${conversationId}::uuid AND left_at IS NULL AND member_id IS NOT NULL`;
    return rows.map((r) => r.staff_id);
  }

  /**
   * PD-35: a seat holder who becomes a member in their own right (the group's
   * new supervisor) keeps the member row; the seat itself ends as 'absorbed', so
   * leaving it later can never take away a membership that is not the seat's.
   */
  private async absorbSeat(tx: Prisma.TransactionClient, conversationId: string, staffId: string): Promise<void> {
    await tx.$executeRaw`
      UPDATE chat.conversation_seat SET left_at = now(), left_kind = 'absorbed'
       WHERE conversation_id = ${conversationId}::uuid AND staff_id = ${staffId}::uuid
         AND left_at IS NULL AND member_id IS NOT NULL`;
  }

  /** System messages are generated by the backend and never by a client. */
  private async systemMessage(
    tx: Prisma.TransactionClient,
    conversationId: string,
    kind: string,
    payload: Record<string, unknown>,
  ): Promise<Message> {
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

    const message = await tx.message.create({
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
    return message;
  }
}

/** The facts `canProvisionStudentGroupFor` decides on, read from a loaded learner. */
function provisioningTarget(
  learner: { organizationId: string; family: { organizationId: string } },
  supervisorId: string | null,
  actorActsFor: 'self' | 'backup' | 'manager' | null,
) {
  return {
    learnerOrganizationId: learner.organizationId,
    familyOrganizationId: learner.family.organizationId,
    supervisorId,
    actorActsFor,
  };
}

/** A tenant mismatch reads as an unknown learner (404); no supervisor is 409; anything else is 403. */
function provisioningRefusal(decision: { code: CommErrorCode; reason: string }): CommError {
  const status =
    decision.code === CommErrorCode.CONVERSATION_NOT_FOUND
      ? 404
      : decision.code === CommErrorCode.LEARNER_UNSUPERVISED
        ? 409
        : 403;
  return new CommError(decision.code, decision.reason, status);
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Shape checks for `POST /conversations/family-group`, before anything is read. */
function validateFamilyGroupRequest(input: {
  learnerIds?: unknown;
  contactIds?: unknown;
  teacherIds?: unknown;
  title?: unknown;
}): { learnerIds: string[]; contactIds: string[]; teacherIds: string[]; title: string | null } {
  const invalid = (field: string, why: string) =>
    new CommError(CommErrorCode.VALIDATION, `${field}: ${why}`, 400);
  const ids = (field: string, value: unknown, min: number, max: number): string[] => {
    if (value === undefined && min === 0) return [];
    if (!Array.isArray(value)) throw invalid(field, 'must be an array of uuids');
    if (value.length < min || value.length > max) throw invalid(field, `must hold ${min}..${max} ids`);
    if (!value.every((v) => typeof v === 'string' && UUID.test(v))) throw invalid(field, 'must be an array of uuids');
    const unique = [...new Set(value.map((v: string) => v.toLowerCase()))];
    if (unique.length !== value.length) throw invalid(field, 'must not repeat an id');
    return unique;
  };
  let title: string | null = null;
  if (input.title !== undefined && input.title !== null) {
    if (typeof input.title !== 'string' || input.title.trim().length === 0 || input.title.trim().length > 120) {
      throw invalid('title', 'must be 1..120 characters');
    }
    title = input.title.trim();
  }
  return {
    learnerIds: ids('learnerIds', input.learnerIds, 1, 10),
    contactIds: ids('contactIds', input.contactIds, 0, 20),
    teacherIds: ids('teacherIds', input.teacherIds, 0, 20),
    title,
  };
}
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

/**
 * PD-15: a family group is found by its teacher and its children --
 * "Teacher — Child · Child". With no teacher, or several, the children's names
 * alone (the PD-8 default) say who it is about.
 */
export function familyGroupTitle(teacherNames: string[], learnerNames: string[]): string {
  const children = learnerNames.join(' · ');
  return teacherNames.length === 1 ? `${teacherNames[0]} — ${children}`.slice(0, 120) : `${children} · Jawwid`.slice(0, 120);
}
