import { Inject, Injectable, Optional } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../platform/prisma.service';
import { AuthorizationService } from '../../platform/authorization.service';
import type { Decision } from '../../platform/authorization.service';
import { CommError, CommErrorCode } from '../../platform/errors';
import { AUDIT_SERVICE, REALTIME_REVOCATION } from '../../platform/tokens';
import type { AuditService } from '../../platform/audit.service';
import { NO_REALTIME_REVOCATION, type RealtimeRevocation } from '../../platform/realtime-revocation';
import type { StaffAccessBasis } from '../../platform/staff-scope';
import { isConversationStaff, type Actor } from '../../platform/types';
import { ConversationService, isUuid } from '../conversations/conversation.service';
import { OutboxService } from '../outbox/outbox.service';
import { CommEvent } from '../contracts/events';
import { ActorKind, ConversationType, MemberRole, StaffRole } from '../contracts/vocab';
import { SeatPolicyRegistry, SeatReason, type SeatPolicy, type SeatTarget } from './seat-policy';

type Tx = Prisma.TransactionClient;

const NOTE_MAX = 200;
const SWEEP_BATCH = 100;

export interface SeatView {
  seatId: string;
  conversationId: string;
  reason: string;
  sourceId: string | null;
  joinedAt: string;
  /** A family 1:1's seat: no member row, notifications only (BR-1 keeps a 1:1 at two members). */
  effective: boolean;
}

interface SeatRow {
  id: string;
  conversation_id: string;
  staff_id: string;
  reason: string;
  source_id: string | null;
  member_id: string | null;
  joined_at: Date;
}

/** The visible line's role word when a policy names none. */
function defaultRoleLabel(actor: Actor): string | null {
  if (actor.staffRole === StaffRole.SUPER_ADMIN) return 'super_admin';
  if (actor.staffRole === StaffRole.MANAGER) return 'manager';
  return 'supervisor';
}

const refuse = (d: Extract<Decision, { allowed: false }>, status?: number) => new CommError(d.code, d.reason, status);

/**
 * PD-35: THE visible seat -- the one way anyone joins a conversation by choice
 * and leaves it again. Every feature that seats people (PD-35's teacher
 * supervisors, PD-36's @mentions, a manual join) calls this service; none
 * writes chat.conversation_seat or a seat's member row itself.
 *
 *   join    the reason's SeatPolicy decides (and, for staying, its SQL twin in
 *           chat.seat_reason). In a group the seat is a live, non-silent member
 *           row; in a family 1:1 it is EFFECTIVE (no member row: the pair is the
 *           conversation's identity). One visible, silent system line, an audit
 *           row, and MEMBERSHIP_CHANGED -- never a silent presence.
 *   leave   the same, in reverse, then RT-009: a holder who no longer has any
 *           access leaves the live room, and leave() does not report success
 *           until no node can still deliver to them.
 *   sweep   the worker ends seats that no longer hold ('ineligible') or whose
 *           holder wrote nothing for the reason's idle_days ('idle'), the same way.
 *
 * Access itself is never this service's decision: chat.staff_conversation_access
 * answers 'seated' for a seat whose reason grants it, re-checking eligibility on
 * every call, and any PD-8 basis outranks it.
 */
@Injectable()
export class ConversationSeatService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly authz: AuthorizationService,
    private readonly conversations: ConversationService,
    private readonly outbox: OutboxService,
    readonly policies: SeatPolicyRegistry,
    @Inject(AUDIT_SERVICE) private readonly audit: AuditService,
    @Optional()
    @Inject(REALTIME_REVOCATION)
    private readonly revocation: RealtimeRevocation = NO_REALTIME_REVOCATION,
  ) {
    if (!policies.get(SeatReason.MANUAL)) policies.register(this.manualPolicy());
    if (!policies.get(SeatReason.MENTION)) policies.register(MENTION_PLACEHOLDER);
  }

  /** Take a seat. Idempotent: an open seat for the caller here is returned as it is. */
  async join(
    actor: Actor,
    conversationId: string,
    input: { reason?: unknown; sourceId?: unknown; note?: unknown },
  ): Promise<SeatView> {
    const staff = this.requireStaff(actor);
    const conv = await this.loadConversation(staff, conversationId);
    if (typeof input.reason !== 'string') throw new CommError(CommErrorCode.SEAT_REASON_UNKNOWN, 'reason: is required', 400);
    const reason = input.reason;
    const sourceId = input.sourceId === undefined || input.sourceId === null ? null : input.sourceId;
    if (sourceId !== null && !isUuid(sourceId)) throw new CommError(CommErrorCode.SEAT_INVALID, 'sourceId: must be a uuid', 400);
    const note = parseNote(input.note);

    const [row] = await this.prisma.$queryRaw<Array<{ allowed_in_direct: boolean }>>`
      SELECT allowed_in_direct FROM chat.seat_reason WHERE reason = ${reason}`;
    const policy = this.policies.get(reason);
    if (!row || !policy) throw new CommError(CommErrorCode.SEAT_REASON_UNKNOWN, `no seat is taken for '${reason}'`, 400);

    const direct = conv.type === ConversationType.DIRECT;
    if (direct && (!row.allowed_in_direct || conv.familyId === null)) {
      throw new CommError(CommErrorCode.SEAT_NOT_ALLOWED_HERE, 'this seat cannot be taken in a 1:1 conversation', 409);
    }

    const now = new Date();
    const standing = await this.standing(staff.actorId, conv.id, now);
    const decision = await policy.canJoin(staff, conv, { sourceId, standing, now });
    if (!decision.allowed) throw refuse(decision, decision.code === CommErrorCode.CONVERSATION_NOT_FOUND ? 404 : undefined);

    const seat = await this.prisma.$transaction(async (tx) => {
      await this.lock(tx, conv.id, staff.actorId);
      const open = await this.openSeat(tx, conv.id, staff.actorId);
      if (open) return open;
      const member = await tx.conversationMember.findFirst({
        where: { conversationId: conv.id, actorId: staff.actorId, leftAt: null },
        select: { id: true },
      });
      if (member) {
        throw new CommError(CommErrorCode.SEAT_ALREADY_MEMBER, 'already a member of this conversation', 409);
      }

      let memberId: string | null = null;
      if (!direct) {
        memberId = (
          await tx.conversationMember.create({
            data: {
              conversationId: conv.id,
              actorId: staff.actorId,
              actorKind: ActorKind.STAFF,
              memberRole: MemberRole.ADMIN,
              isSilent: false,
              addedBy: staff.actorId,
            },
            select: { id: true },
          })
        ).id;
      }
      const [created] = await tx.$queryRaw<SeatRow[]>`
        INSERT INTO chat.conversation_seat (organization_id, conversation_id, staff_id, reason, source_id, member_id, note)
        VALUES (${conv.organizationId}::uuid, ${conv.id}::uuid, ${staff.actorId}::uuid, ${reason},
                ${sourceId}::uuid, ${memberId}::uuid, ${note})
        RETURNING id::text, conversation_id::text, staff_id::text, reason, source_id::text, member_id::text, joined_at`;

      await this.conversations.postAnnouncement(tx, conv.id, direct ? 'seat.stepped_in' : 'seat.joined', {
        name: staff.displayName,
        role: policy.roleLabel?.(staff) ?? defaultRoleLabel(staff),
        reason,
      });
      if (!direct) {
        await this.outbox.enqueue(tx, CommEvent.MEMBERSHIP_CHANGED, { conversationId: conv.id, added: [staff.actorId], removed: [] });
      }
      await this.audit.audit(tx, {
        actorId: staff.actorId,
        action: 'seat.joined',
        entity: 'conversation',
        entityId: conv.id,
        after: { seatId: created.id, reason, sourceId, effective: direct },
        reason: note ?? `joined (${reason})`,
      });
      return created;
    });
    return toView(seat);
  }

  /** Leave one's own seat. Ends access only if the seat was the holder's only basis (RT-009). */
  async leave(actor: Actor, conversationId: string): Promise<{ conversationId: string; left: true }> {
    const staff = this.requireStaff(actor);
    const conv = await this.loadConversation(staff, conversationId, { archivedToo: true });
    const ended = await this.prisma.$transaction(async (tx) => {
      await this.lock(tx, conv.id, staff.actorId);
      const open = await this.openSeat(tx, conv.id, staff.actorId);
      if (!open) throw new CommError(CommErrorCode.SEAT_NOT_FOUND, 'no open seat here');
      const ended = await tx.$executeRaw`
        UPDATE chat.conversation_seat SET left_at = now(), left_kind = 'left'
         WHERE id = ${open.id}::uuid AND left_at IS NULL`;
      // Absorbed (or swept) meanwhile: the member row is no longer the seat's to end.
      if (ended === 0) throw new CommError(CommErrorCode.SEAT_NOT_FOUND, 'no open seat here');
      await this.endSeatInTx(tx, open, 'left', staff.actorId, staff.displayName);
      return open;
    });
    await this.evictIfNoAccess([{ conversationId: ended.conversation_id, staffId: ended.staff_id }]);
    return { conversationId: conv.id, left: true };
  }

  /** The caller's open seats, newest first. */
  async mine(actor: Actor): Promise<{ seats: Array<SeatView & { title: string | null; type: string }> }> {
    const staff = this.requireStaff(actor);
    const rows = await this.prisma.$queryRaw<Array<SeatRow & { title: string | null; type: string }>>`
      SELECT s.id::text, s.conversation_id::text, s.staff_id::text, s.reason, s.source_id::text, s.member_id::text,
             s.joined_at, c.title, c.type
        FROM chat.conversation_seat s
        JOIN chat.conversation c ON c.id = s.conversation_id
       WHERE s.staff_id = ${staff.actorId}::uuid AND s.left_at IS NULL
       ORDER BY s.joined_at DESC`;
    return { seats: rows.map((r) => ({ ...toView(r), title: r.title, type: r.type })) };
  }

  /**
   * The worker's pass: seats that no longer hold, or went idle, end -- each with
   * its line, its audit row and, for a holder left with no access, RT-009.
   * Claimed with one conditional UPDATE (chat.claim_seat_sweep), so every
   * replica may run it at once. Returns how many ended.
   */
  async sweep(now: Date = new Date()): Promise<number> {
    const ended = await this.prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<Array<SeatRow & { left_kind: string }>>`
        SELECT seat_id::text AS id, conversation_id::text, staff_id::text, member_id::text, reason, left_kind
          FROM chat.claim_seat_sweep(${now}::timestamptz, ${SWEEP_BATCH}::int)`;
      for (const r of rows) {
        const holder = await tx.staff.findUnique({ where: { id: r.staff_id }, select: { name: true } });
        await this.endSeatInTx(tx, r, r.left_kind, null, holder?.name ?? null);
      }
      return rows;
    });
    if (ended.length > 0) {
      await this.evictIfNoAccess(ended.map((r) => ({ conversationId: r.conversation_id, staffId: r.staff_id })));
    }
    return ended.length;
  }

  // ---------------------------------------------------------------------------

  /**
   * Everything after the seat row itself has ended: its member row, the visible
   * line, the membership event and the audit row -- in the caller's transaction.
   */
  private async endSeatInTx(
    tx: Tx,
    seat: Pick<SeatRow, 'id' | 'conversation_id' | 'staff_id' | 'member_id' | 'reason'>,
    kind: string,
    byStaffId: string | null,
    name: string | null,
  ): Promise<void> {
    if (seat.member_id) {
      await tx.conversationMember.updateMany({ where: { id: seat.member_id, leftAt: null }, data: { leftAt: new Date() } });
    }
    // `ended`, not `kind`: the line's own kind is 'seat.left'.
    await this.conversations.postAnnouncement(tx, seat.conversation_id, 'seat.left', { name, ended: kind, reason: seat.reason });
    if (seat.member_id) {
      await this.outbox.enqueue(tx, CommEvent.MEMBERSHIP_CHANGED, {
        conversationId: seat.conversation_id,
        added: [],
        removed: [seat.staff_id],
      });
    }
    await this.audit.audit(tx, {
      actorId: byStaffId,
      action: 'seat.left',
      entity: 'conversation',
      entityId: seat.conversation_id,
      after: { seatId: seat.id, reason: seat.reason, kind, staffId: seat.staff_id },
      reason: kind === 'left' ? 'left the conversation' : `seat ended: ${kind}`,
    });
  }

  /**
   * RT-009, only for holders left with NO access: a holder who still has a
   * PD-8 basis keeps reading the conversation, so their live room stays.
   */
  private async evictIfNoAccess(pairs: ReadonlyArray<{ conversationId: string; staffId: string }>): Promise<void> {
    let evicted = false;
    for (const p of pairs) {
      const [row] = await this.prisma.$queryRaw<Array<{ basis: string | null }>>`
        SELECT chat.staff_conversation_access(${p.staffId}::uuid, ${p.conversationId}::uuid, now()) AS basis`;
      if (row?.basis) continue;
      this.revocation.leaveConversation([p.staffId], p.conversationId);
      evicted = true;
    }
    if (evicted) await this.revocation.confirmRevoked();
  }

  private async standing(staffId: string, conversationId: string, at: Date): Promise<StaffAccessBasis | null> {
    const [row] = await this.prisma.$queryRaw<Array<{ basis: string | null }>>`
      SELECT chat.staff_conversation_standing(${staffId}::uuid, ${conversationId}::uuid, ${at}::timestamptz) AS basis`;
    return (row?.basis ?? null) as StaffAccessBasis | null;
  }

  private async openSeat(tx: Tx, conversationId: string, staffId: string): Promise<SeatRow | null> {
    const [row] = await tx.$queryRaw<SeatRow[]>`
      SELECT id::text, conversation_id::text, staff_id::text, reason, source_id::text, member_id::text, joined_at
        FROM chat.conversation_seat
       WHERE conversation_id = ${conversationId}::uuid AND staff_id = ${staffId}::uuid AND left_at IS NULL`;
    return row ?? null;
  }

  /** One seat decision per (conversation, person) at a time. */
  private async lock(tx: Tx, conversationId: string, staffId: string): Promise<void> {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'seat:' + conversationId + ':' + staffId}))`;
  }

  private requireStaff(actor: Actor): Actor {
    if (actor.kind !== ActorKind.STAFF || !actor.isActive || !actor.organizationId || !isConversationStaff(actor)) {
      throw new CommError(CommErrorCode.SEAT_NOT_ELIGIBLE, 'only conversation staff take a seat');
    }
    return actor;
  }

  /** The conversation in the caller's organization, or 404 -- never another tenant's. */
  private async loadConversation(actor: Actor, conversationId: string, opts: { archivedToo?: boolean } = {}): Promise<SeatTarget> {
    if (!isUuid(conversationId)) throw new CommError(CommErrorCode.CONVERSATION_NOT_FOUND, 'conversation not found');
    const conv = await this.prisma.conversation.findFirst({
      where: { id: conversationId, organizationId: actor.organizationId },
      select: { id: true, organizationId: true, type: true, familyId: true, learnerId: true, archivedAt: true },
    });
    if (!conv) throw new CommError(CommErrorCode.CONVERSATION_NOT_FOUND, 'conversation not found');
    if (conv.archivedAt && !opts.archivedToo) {
      throw new CommError(CommErrorCode.CONVERSATION_ARCHIVED, 'conversation is archived', 409);
    }
    return { id: conv.id, organizationId: conv.organizationId, type: conv.type, familyId: conv.familyId, learnerId: conv.learnerId };
  }

  /**
   * 'manual': a staff member who may already add themselves here (canAddMember
   * on their own PD-8 standing) makes their presence visible. Without standing
   * the conversation is not theirs to know about: not found.
   */
  private manualPolicy(): SeatPolicy {
    return {
      reason: SeatReason.MANUAL,
      canJoin: (actor, conv, ctx) => {
        if (ctx.standing === null) {
          return { allowed: false, code: CommErrorCode.CONVERSATION_NOT_FOUND, reason: 'conversation not found' };
        }
        return this.authz.canAddMember(
          { type: conv.type, organizationId: conv.organizationId, familyId: conv.familyId, learnerTeacherId: null },
          MemberRole.ADMIN,
          {
            kind: 'staff',
            organizationId: actor.organizationId as string,
            isActive: actor.isActive,
            leftAt: null,
            staffRole: actor.staffRole as string,
            access: ctx.standing,
          },
        );
      },
    };
  }
}

/** PD-36 replaces this with the real mention policy; until then a mention seats nobody. */
const MENTION_PLACEHOLDER: SeatPolicy = {
  reason: SeatReason.MENTION,
  placeholder: true,
  canJoin: () => ({ allowed: false, code: CommErrorCode.SEAT_NOT_ELIGIBLE, reason: 'joining by mention is not available yet' }),
};

function parseNote(v: unknown): string | null {
  if (v === undefined || v === null) return null;
  if (typeof v !== 'string') throw new CommError(CommErrorCode.SEAT_INVALID, 'note: must be text', 400);
  const t = v.trim();
  if (t.length === 0) return null;
  if (t.length > NOTE_MAX) throw new CommError(CommErrorCode.SEAT_INVALID, `note: at most ${NOTE_MAX} characters`, 400);
  return t;
}

function toView(r: SeatRow): SeatView {
  return {
    seatId: r.id,
    conversationId: r.conversation_id,
    reason: r.reason,
    sourceId: r.source_id,
    joinedAt: r.joined_at.toISOString(),
    effective: r.member_id === null,
  };
}
