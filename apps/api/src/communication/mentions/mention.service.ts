import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import type { ConversationMember, MessageMention, Prisma } from '@prisma/client';
import { PrismaService } from '../../platform/prisma.service';
import { AppConfigService } from '../../platform/app-config.service';
import { CommError, CommErrorCode } from '../../platform/errors';
import { AUDIT_SERVICE, IDENTITY_SERVICE } from '../../platform/tokens';
import type { AuditService } from '../../platform/audit.service';
import type { IdentityService } from '../../platform/identity.service';
import { actorRefKey } from '../../platform/identity.service';
import type { Actor } from '../../platform/types';
import { StaffAccessBasis } from '../../platform/staff-scope';
import { ConversationService } from '../conversations/conversation.service';
import { OutboxService } from '../outbox/outbox.service';
import { CommEvent } from '../contracts/events';
import { ActorKind, ConversationType, Visibility } from '../contracts/vocab';
import {
  MentionRole,
  MentionState,
  applyMentionCaps,
  mentionSpanSurvivesEdit,
  parseMentionRequests,
  type PlannedMention,
} from './mention-policy';


/** For the @ picker. Names only: what a member list already shows. */
export interface MentionCandidatesDto {
  people: Array<{ actorId: string; actorKind: string; displayName: string; staffRole: string | null; isMember: boolean }>;
  /** Parents only: "@supervisor" and "@admin", in a conversation that takes them. */
  roles: MentionRole[];
}

/** The viewer's own mention in a conversation, for the chat list (PD-36 §9). */
export interface ViewerMentionDto {
  mentionId: string;
  kind: 'member' | 'summons';
  state: string;
  mentionedById: string;
  at: string;
  /** Opened since: the "Mentioned" badge is gone, the summons may still be open. */
  seen: boolean;
  expiresAt: string | null;
}

/** A non-member asked in, for the top of Group Info ("Mentioned -- waiting"). */
export interface SummonedDto {
  mentionId: string;
  actorId: string;
  displayName: string;
  staffRole: string;
  /** 'pending' = waiting; 'stepped_in' = in a family 1:1 without a seat. */
  state: string;
  mentionedById: string;
  mentionedByName: string | null;
  at: string;
  expiresAt: string | null;
}

/** The message a mention belongs to, as the send transaction created it. */
interface SentMessage {
  id: string;
  conversationId: string | null;
  organizationId: string;
  authorId: string | null;
  createdAt: Date;
}

/**
 * PD-36 @mentions.
 *
 * A MENTION NEVER WIDENS AUTHORIZATION. A member is mentioned as a highlight
 * and a ping. A NON-member may be mentioned -- summoned -- only if they already
 * have a PD-8 basis on the conversation (chat.mention_eligible_staff): such a
 * person can already read the thread and reply; the summons points them at it.
 * Anything else refuses the whole send, so there is no silent grant. The
 * database refuses it again (chat.guard_message_mention).
 *
 * Taking a VISIBLE seat in a group is PD-35's primitive (reason 'mention');
 * this service decides only whether the mention is still open for it
 * (`assertMayJoin`, `markJoined`). In a family 1:1, which never gains a third
 * member, the summoned person "steps in" instead -- here.
 */
@Injectable()
export class MentionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly conversations: ConversationService,
    private readonly outbox: OutboxService,
    private readonly config: AppConfigService,
    @Inject(AUDIT_SERVICE) private readonly audit: AuditService,
    @Inject(IDENTITY_SERVICE) private readonly identity: IdentityService,
  ) {}

  // -------------------------------------------------------------------
  // Sending
  // -------------------------------------------------------------------

  /**
   * Before the send transaction: the client's mentions, validated and resolved
   * to people. Throws on any mention this sender may not make here.
   *
   *   member            anyone may mention a live member (an internal note:
   *                     staff members only -- nobody else can read it)
   *   non-member        staff and teachers: a staff member with a PD-8 basis on
   *                     this conversation, in a type that takes summonses.
   *                     Parents: never by name
   *   @supervisor/@admin parents only; resolved by chat.mention_role_targets
   *                     (the children's supervisor or PD-33 cover; plus the
   *                     department manager for @admin; never the super admin).
   *                     A role that resolves to nobody stays plain text.
   */
  async plan(input: {
    actor: Actor;
    conversation: { id: string; type: string };
    body: string | null | undefined;
    visibility: string;
    raw: unknown;
    members: ReadonlyArray<Pick<ConversationMember, 'actorId' | 'actorKind'>>;
    now: Date;
  }): Promise<PlannedMention[]> {
    const requests = parseMentionRequests(input.raw, input.body);
    if (requests.length === 0) return [];
    const { actor, conversation, now } = input;
    const refuse = (reason: string) => new CommError(CommErrorCode.MENTION_NOT_ALLOWED, reason, 403);
    const memberKind = new Map(input.members.map((m) => [m.actorId, m.actorKind]));
    const internal = input.visibility === Visibility.INTERNAL;
    const isParent = actor.kind === ActorKind.CONTACT;

    let eligible: Map<string, string> | null = null;
    const eligibleStaff = async () => (eligible ??= await this.eligibleStaff(conversation.id, now));

    const planned: PlannedMention[] = [];
    for (const r of requests) {
      if (r.actorId !== undefined) {
        if (r.actorId === actor.actorId) continue; // mentioning yourself pings nobody
        const kind = memberKind.get(r.actorId);
        if (kind) {
          if (internal && kind !== ActorKind.STAFF) throw refuse('an internal note can mention staff only');
          planned.push({ start: r.start, length: r.length, targetActorId: r.actorId, targetKind: kind, viaRole: null, isSummons: false, targetIsSuperAdmin: false });
          continue;
        }
        if (isParent) throw refuse('a parent mentions members, or @supervisor / @admin');
        if (!(await eligibleStaff()).has(r.actorId)) {
          throw refuse('only someone in charge of this conversation can be asked to step in');
        }
        planned.push({ start: r.start, length: r.length, targetActorId: r.actorId, targetKind: ActorKind.STAFF, viaRole: null, isSummons: true, targetIsSuperAdmin: false });
        continue;
      }
      if (!isParent) throw refuse('@supervisor and @admin are for parents; mention the person');
      for (const target of await this.roleTargets(conversation.id, r.role, now)) {
        if (target === actor.actorId) continue;
        const kind = memberKind.get(target);
        planned.push({
          start: r.start,
          length: r.length,
          targetActorId: target,
          targetKind: kind ?? ActorKind.STAFF,
          viaRole: r.role,
          isSummons: !kind,
          targetIsSuperAdmin: false,
        });
      }
    }

    // The super-admin cap needs to know who is one; one query for every staff target.
    const staffTargets = [...new Set(planned.filter((p) => p.targetKind === ActorKind.STAFF).map((p) => p.targetActorId))];
    if (staffTargets.length > 0) {
      const supers = await this.prisma.staff.findMany({
        where: { id: { in: staffTargets }, role: 'super_admin' },
        select: { id: true },
      });
      const superIds = new Set(supers.map((s) => s.id));
      for (const p of planned) p.targetIsSuperAdmin = superIds.has(p.targetActorId);
    }
    // One row per (person, span): a person named twice in one span cannot happen,
    // but a role and a name may reach the same person in two spans -- both chips stay.
    const seen = new Set<string>();
    return planned.filter((p) => {
      const key = `${p.targetActorId}:${p.start}`;
      return !seen.has(key) && !!seen.add(key);
    });
  }

  /**
   * Inside the send transaction, under the conversation row lock the send
   * already holds: the rate limits are counted and the rows written in one
   * serialized step, so they hold exactly on every replica.
   */
  async record(
    tx: Prisma.TransactionClient,
    planned: readonly PlannedMention[],
    message: SentMessage,
    conversation: { id: string; type: string },
    actor: Actor,
    now: Date,
  ): Promise<{ rows: MessageMention[]; limited: boolean }> {
    if (planned.length === 0 || !message.authorId) return { rows: [], limited: false };
    const [usage] = await tx.$queryRaw<Array<{ sender_hour: number; super_admin_day: number; sender_role_day: number }>>`
      SELECT
        count(DISTINCT (mm.message_id, mm.span_start)) FILTER (
          WHERE mm.mentioned_by = ${actor.actorId}::uuid
            AND mm.created_at > ${now}::timestamptz - interval '1 hour')::int AS sender_hour,
        count(DISTINCT (mm.message_id, mm.span_start)) FILTER (
          WHERE s.role = 'super_admin')::int AS super_admin_day,
        count(DISTINCT (mm.message_id, mm.span_start)) FILTER (
          WHERE mm.mentioned_by = ${actor.actorId}::uuid AND mm.via_role IS NOT NULL)::int AS sender_role_day
        FROM chat.message_mention mm
        LEFT JOIN chat.staff s ON s.id = mm.target_actor_id
       WHERE mm.conversation_id = ${conversation.id}::uuid
         AND mm.created_at > ${now}::timestamptz - interval '1 day'`;
    const { kept, limited } = applyMentionCaps(
      planned,
      {
        senderHour: usage?.sender_hour ?? 0,
        superAdminDay: usage?.super_admin_day ?? 0,
        senderRoleDay: usage?.sender_role_day ?? 0,
      },
      {
        perSenderHour: await this.config.get('mention.per_sender_hour'),
        superAdminDay: await this.config.get('mention.super_admin_day'),
        parentRoleDay: await this.config.get('mention.parent_role_day'),
      },
    );
    if (kept.length === 0) return { rows: [], limited };

    const expiresAt = new Date(now.getTime() + (await this.config.get('mention.expiry_days')) * 86_400_000);
    const data = kept.map((p) => ({
      id: randomUUID(),
      organizationId: message.organizationId,
      conversationId: conversation.id,
      messageId: message.id,
      mentionedBy: actor.actorId,
      mentionedByKind: actor.kind,
      targetActorId: p.targetActorId,
      targetKind: p.targetKind,
      viaRole: p.viaRole,
      isSummons: p.isSummons,
      spanStart: p.start,
      spanLength: p.length,
      state: p.isSummons ? MentionState.PENDING : MentionState.NOTIFIED,
      createdAt: now,
      expiresAt: p.isSummons ? expiresAt : null,
    }));
    await tx.messageMention.createMany({ data });
    for (const row of data) {
      await this.outbox.enqueue(tx, CommEvent.MENTION_CREATED, {
        mentionId: row.id,
        conversationId: conversation.id,
        messageId: message.id,
        conversationType: conversation.type,
        targetActorId: row.targetActorId,
        targetKind: row.targetKind,
        mentionedBy: actor.actorId,
        kind: row.isSummons ? 'summons' : 'member',
        viaRole: row.viaRole,
        createdAt: now.toISOString(),
      });
    }
    if (data.some((r) => r.isSummons)) {
      await this.audit.audit(tx, {
        actorId: actor.actorId,
        action: 'mention.summoned',
        entity: 'conversation',
        entityId: conversation.id,
        after: {
          messageId: message.id,
          summoned: data.filter((r) => r.isSummons).map((r) => ({ actorId: r.targetActorId, viaRole: r.viaRole })),
        },
        reason: 'mentioned in a message',
      });
    }
    const rows = await tx.messageMention.findMany({ where: { id: { in: data.map((r) => r.id) } } });
    return { rows, limited };
  }

  /**
   * A message from someone who stepped into this 1:1 keeps their step-in alive
   * (the idle sweep counts from their last message). Cheap: a partial index.
   */
  async touchStepIn(tx: Prisma.TransactionClient, conversationId: string, actorId: string, now: Date): Promise<void> {
    await tx.messageMention.updateMany({
      where: { conversationId, targetActorId: actorId, state: MentionState.STEPPED_IN },
      data: { lastActiveAt: now },
    });
  }

  /** An edit that changes an "@..." takes that mention back; an edit never adds one. */
  async onEdited(tx: Prisma.TransactionClient, messageId: string, oldBody: string | null, newBody: string | null, now: Date) {
    const rows = await tx.messageMention.findMany({
      where: { messageId, state: { in: [MentionState.NOTIFIED, MentionState.PENDING] } },
    });
    const gone = rows.filter((r) => !mentionSpanSurvivesEdit(oldBody, newBody, { start: r.spanStart, length: r.spanLength }));
    await this.remove(tx, gone, now);
  }

  /** A message deleted for everyone mentions nobody any more. */
  async onDeletedForAll(tx: Prisma.TransactionClient, messageId: string, now: Date) {
    const rows = await tx.messageMention.findMany({
      where: { messageId, state: { in: [MentionState.NOTIFIED, MentionState.PENDING] } },
    });
    await this.remove(tx, rows, now);
  }

  private async remove(tx: Prisma.TransactionClient, rows: readonly MessageMention[], now: Date) {
    for (const r of rows) {
      const moved = await tx.messageMention.updateMany({
        where: { id: r.id, state: r.state },
        data: { state: MentionState.REMOVED, resolvedAt: now },
      });
      if (moved.count === 1 && r.isSummons) await this.announceState(tx, r, MentionState.REMOVED);
    }
  }

  // -------------------------------------------------------------------
  // Reading
  // -------------------------------------------------------------------

  /**
   * The @ picker. The caller must be able to send here; the people offered are
   * exactly the ones `plan` would accept from this caller -- never more.
   */
  async candidates(actorId: string, conversationId: string, rawQuery: unknown): Promise<MentionCandidatesDto> {
    const { conversation, members } = await this.conversations.readWithMembers(conversationId, actorId);
    const actor = await this.conversations.requireActor(actorId);
    const q = typeof rawQuery === 'string' ? rawQuery.trim().toLocaleLowerCase().slice(0, 60) : '';
    const matches = (name: string) => !q || name.toLocaleLowerCase().includes(q);
    const now = new Date();

    const memberIds = new Set(members.map((m) => m.actorId));
    const memberStaffIds = members.filter((m) => m.actorKind === ActorKind.STAFF).map((m) => m.actorId);
    const people: MentionCandidatesDto['people'] = [];
    const roleOf = new Map<string, string>();

    const eligible =
      actor.kind === ActorKind.CONTACT ? new Map<string, string>() : await this.eligibleStaff(conversation.id, now);
    const staffIds = [...new Set([...memberStaffIds, ...eligible.keys()])];
    if (staffIds.length > 0) {
      const rows = await this.prisma.staff.findMany({ where: { id: { in: staffIds } }, select: { id: true, name: true, role: true } });
      for (const r of rows) roleOf.set(r.id, r.role);
      for (const r of rows) {
        if (memberIds.has(r.id) || r.id === actorId || !matches(r.name)) continue;
        people.push({ actorId: r.id, actorKind: ActorKind.STAFF, displayName: r.name, staffRole: r.role, isMember: false });
      }
    }
    for (const m of members) {
      if (m.actorId === actorId || !m.displayName || !matches(m.displayName)) continue;
      people.push({
        actorId: m.actorId,
        actorKind: m.actorKind,
        displayName: m.displayName,
        staffRole: roleOf.get(m.actorId) ?? null,
        isMember: true,
      });
    }
    people.sort((a, b) => Number(b.isMember) - Number(a.isMember) || a.displayName.localeCompare(b.displayName));

    const takesRoles = actor.kind === ActorKind.CONTACT && (await this.takesSummons(conversation.id));
    const roles = takesRoles
      ? (Object.values(MentionRole) as MentionRole[]).filter((r) => !q || r.startsWith(q))
      : [];
    return { people: people.slice(0, 30), roles };
  }

  /** The viewer's own open or unseen mention per conversation: one query for the list. */
  async viewerMentions(conversationIds: readonly string[], actorId: string, now = new Date()): Promise<Map<string, ViewerMentionDto>> {
    if (conversationIds.length === 0) return new Map();
    const rows = await this.prisma.messageMention.findMany({
      where: {
        conversationId: { in: [...conversationIds] },
        targetActorId: actorId,
        OR: [
          { state: MentionState.PENDING, expiresAt: { gt: now } },
          { state: MentionState.STEPPED_IN },
          { state: MentionState.NOTIFIED, seenAt: null },
        ],
      },
      orderBy: { createdAt: 'desc' },
    });
    const out = new Map<string, ViewerMentionDto>();
    // A summons outranks a member mention; then the newest.
    for (const r of [...rows].sort((a, b) => Number(b.isSummons) - Number(a.isSummons))) {
      if (out.has(r.conversationId)) continue;
      out.set(r.conversationId, {
        mentionId: r.id,
        kind: r.isSummons ? 'summons' : 'member',
        state: r.state,
        mentionedById: r.mentionedBy,
        at: r.createdAt.toISOString(),
        seen: r.seenAt !== null,
        expiresAt: r.expiresAt?.toISOString() ?? null,
      });
    }
    return out;
  }

  /**
   * Who has been asked in and is not (yet) a member -- the top of Group Info.
   * THE CALLER AUTHORIZES THE READ. One row per person: their newest summons.
   */
  async summonedIn(conversationId: string, liveMemberIds: ReadonlySet<string>, now = new Date()): Promise<SummonedDto[]> {
    const rows = await this.prisma.messageMention.findMany({
      where: {
        conversationId,
        isSummons: true,
        OR: [{ state: MentionState.PENDING, expiresAt: { gt: now } }, { state: MentionState.STEPPED_IN }],
      },
      orderBy: { createdAt: 'desc' },
    });
    const latest = new Map<string, MessageMention>();
    for (const r of rows) if (!latest.has(r.targetActorId) && !liveMemberIds.has(r.targetActorId)) latest.set(r.targetActorId, r);
    if (latest.size === 0) return [];
    const staff = await this.prisma.staff.findMany({
      where: { id: { in: [...latest.keys()] } },
      select: { id: true, name: true, role: true },
    });
    const staffById = new Map(staff.map((s) => [s.id, s]));
    const authors = await this.identity.resolveActors(
      [...latest.values()].map((r) => ({ actorId: r.mentionedBy, actorKind: r.mentionedByKind })),
    );
    return [...latest.values()]
      .filter((r) => staffById.has(r.targetActorId))
      .map((r) => ({
        mentionId: r.id,
        actorId: r.targetActorId,
        displayName: staffById.get(r.targetActorId)!.name,
        staffRole: staffById.get(r.targetActorId)!.role,
        state: r.state,
        mentionedById: r.mentionedBy,
        mentionedByName: authors.get(actorRefKey({ actorId: r.mentionedBy, actorKind: r.mentionedByKind }))?.displayName ?? null,
        at: r.createdAt.toISOString(),
        expiresAt: r.expiresAt?.toISOString() ?? null,
      }));
  }

  /** The caller's open summonses, newest first (Admin Web's list badge source). */
  async openFor(actorId: string, now = new Date()) {
    const rows = await this.prisma.messageMention.findMany({
      where: {
        targetActorId: actorId,
        isSummons: true,
        OR: [{ state: MentionState.PENDING, expiresAt: { gt: now } }, { state: MentionState.STEPPED_IN }],
      },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    return {
      mentions: rows.map((r) => ({
        mentionId: r.id,
        conversationId: r.conversationId,
        messageId: r.messageId,
        state: r.state,
        mentionedById: r.mentionedBy,
        viaRole: r.viaRole,
        at: r.createdAt.toISOString(),
        seen: r.seenAt !== null,
        expiresAt: r.expiresAt?.toISOString() ?? null,
      })),
    };
  }

  // -------------------------------------------------------------------
  // Answering
  // -------------------------------------------------------------------

  /** The viewer opened the conversation: their "Mentioned" badges there go. */
  async markSeen(actorId: string, conversationId: string): Promise<void> {
    await this.prisma.messageMention.updateMany({
      where: { conversationId, targetActorId: actorId, seenAt: null },
      data: { seenAt: new Date() },
    });
  }

  /**
   * "Not for me": every open summons of this person in the conversation closes.
   * A step-in being dismissed is a visible LEAVE ("Laila stepped out").
   */
  async dismiss(actorId: string, mentionId: string): Promise<{ state: string }> {
    const actor = await this.conversations.requireActor(actorId);
    const mention = await this.mine(actor, mentionId);
    const now = new Date();
    if (mention.state === MentionState.STEPPED_IN) {
      await this.endStepIns(mention.conversationId, actor.actorId, 'left', now, actor.actorId);
      return { state: MentionState.LEFT };
    }
    if (mention.state !== MentionState.PENDING) throw closed();
    await this.prisma.$transaction(async (tx) => {
      const open = await tx.messageMention.findMany({
        where: { conversationId: mention.conversationId, targetActorId: actor.actorId, state: MentionState.PENDING },
      });
      for (const r of open) {
        const moved = await tx.messageMention.updateMany({
          where: { id: r.id, state: MentionState.PENDING },
          data: { state: MentionState.DISMISSED, resolvedAt: now, resolvedBy: actor.actorId },
        });
        if (moved.count === 1) await this.announceState(tx, r, MentionState.DISMISSED);
      }
    });
    return { state: MentionState.DISMISSED };
  }

  /**
   * A family 1:1 never gains a third member (its identity is its two members,
   * and BR-1 caps it at two), so a summoned manager or super admin "steps in":
   * a visible line, the summons answered, and this conversation's pushes until
   * they step out or go quiet (mention.step_in_idle_days). They read and reply
   * on the PD-8 basis they already had -- nothing here grants it.
   */
  async stepIn(actorId: string, mentionId: string): Promise<{ state: string }> {
    const actor = await this.conversations.requireActor(actorId);
    const mention = await this.mine(actor, mentionId);
    const conv = await this.conversations.requireConversation(mention.conversationId);
    if (conv.type !== ConversationType.DIRECT) {
      throw new CommError(CommErrorCode.VALIDATION, 'in a group, Join takes a seat; step-in is for a 1:1', 400);
    }
    const now = new Date();
    await this.assertStillOpen(actor, mention, conv, now);

    await this.prisma.$transaction(async (tx) => {
      const open = await tx.messageMention.findMany({
        where: { conversationId: conv.id, targetActorId: actor.actorId, state: MentionState.PENDING },
      });
      let moved = 0;
      for (const r of open) {
        const res = await tx.messageMention.updateMany({
          where: { id: r.id, state: MentionState.PENDING },
          data: { state: MentionState.STEPPED_IN, resolvedAt: now, resolvedBy: actor.actorId, lastActiveAt: now },
        });
        if (res.count === 1) {
          moved += 1;
          await this.announceState(tx, r, MentionState.STEPPED_IN);
        }
      }
      // A concurrent answer got there first: the summons is no longer open.
      if (moved === 0) throw closed();
      await this.conversations.postAnnouncement(tx, conv.id, 'mention.stepped_in', {
        name: actor.displayName,
        role: actor.staffRole ?? null,
      });
      await this.audit.audit(tx, {
        actorId: actor.actorId,
        action: 'mention.stepped_in',
        entity: 'conversation',
        entityId: conv.id,
        after: { mentionId: mention.id },
        reason: 'answered a mention',
      });
    });
    return { state: MentionState.STEPPED_IN };
  }

  /**
   * PD-35 SeatPolicy 'mention', the JOIN half: may this actor take a seat in
   * this conversation on this mention? A pending summons of them, unexpired,
   * AND a live PD-8 basis of their own -- never 'seated', which a seat gives.
   */
  async assertMayJoin(actor: Actor, conversationId: string, refMessageId: string | null, now = new Date()): Promise<void> {
    const conv = await this.conversations.requireConversation(conversationId);
    if (conv.type === ConversationType.DIRECT) {
      throw new CommError(CommErrorCode.VALIDATION, 'a 1:1 takes no seat; step in instead', 400);
    }
    const mention = await this.prisma.messageMention.findFirst({
      where: {
        conversationId,
        targetActorId: actor.actorId,
        state: MentionState.PENDING,
        ...(refMessageId ? { messageId: refMessageId } : {}),
      },
      orderBy: { createdAt: 'desc' },
    });
    if (!mention) throw new CommError(CommErrorCode.MENTION_NOT_FOUND, 'no open mention of you here', 404);
    await this.assertStillOpen(actor, mention, conv, now);
  }

  /**
   * PD-35 SeatPolicy 'mention', the STAY half: a joined seat lasts while its
   * holder keeps a PD-8 basis of their own. The expiry gates joining, not the seat.
   */
  async mayStaySeated(actor: Actor, conversationId: string, now = new Date()): Promise<boolean> {
    const conv = await this.conversations.requireConversation(conversationId);
    const basis = await this.conversations.staffAccess(actor, conv, now);
    return basis !== null && basis !== ('seated' as StaffAccessBasis);
  }

  /** PD-35 SeatPolicy 'mention': in the join's transaction, the summonses it answers. */
  async markJoined(tx: Prisma.TransactionClient, conversationId: string, actorId: string, now = new Date()): Promise<void> {
    const open = await tx.messageMention.findMany({
      where: { conversationId, targetActorId: actorId, state: MentionState.PENDING },
    });
    for (const r of open) {
      const moved = await tx.messageMention.updateMany({
        where: { id: r.id, state: MentionState.PENDING },
        data: { state: MentionState.JOINED, resolvedAt: now, resolvedBy: actorId },
      });
      if (moved.count === 1) await this.announceState(tx, r, MentionState.JOINED);
    }
  }

  // -------------------------------------------------------------------
  // The sweep (worker; safe on every replica: each row moves by a conditional update)
  // -------------------------------------------------------------------

  async sweep(now = new Date(), batch = 200): Promise<{ expired: number; voided: number; stepOuts: number }> {
    // 1. Unanswered past the window.
    const expiredRows = await this.prisma.$queryRaw<Array<{ id: string }>>`
      SELECT id::text AS id FROM chat.message_mention
       WHERE state = 'pending' AND expires_at <= ${now}::timestamptz
       ORDER BY expires_at LIMIT ${batch}`;
    let expired = 0;
    for (const { id } of expiredRows) {
      expired += await this.closeOne(id, MentionState.PENDING, MentionState.EXPIRED, now);
    }

    // 2. Asked in, then lost their standing before answering: Group Info stops
    //    showing someone who can no longer come.
    const lost = await this.prisma.$queryRaw<Array<{ id: string }>>`
      SELECT id::text AS id FROM chat.message_mention
       WHERE state = 'pending' AND expires_at > ${now}::timestamptz
         AND chat.staff_conversation_access(target_actor_id, conversation_id, ${now}::timestamptz) IS NULL
       LIMIT ${batch}`;
    let voided = 0;
    for (const { id } of lost) voided += await this.closeOne(id, MentionState.PENDING, MentionState.VOID, now);

    // 3. Step-ins that went quiet, or whose holder lost their standing.
    const idleDays = await this.config.get('mention.step_in_idle_days');
    const ending = await this.prisma.$queryRaw<Array<{ conversation_id: string; target_actor_id: string; lost: boolean }>>`
      SELECT DISTINCT conversation_id::text AS conversation_id, target_actor_id::text AS target_actor_id,
             chat.staff_conversation_access(target_actor_id, conversation_id, ${now}::timestamptz) IS NULL AS lost
        FROM chat.message_mention
       WHERE state = 'stepped_in'
         AND (chat.staff_conversation_access(target_actor_id, conversation_id, ${now}::timestamptz) IS NULL
              OR (${idleDays}::int > 0
                  AND coalesce(last_active_at, resolved_at) <= ${now}::timestamptz - make_interval(days => ${idleDays}::int)))
       LIMIT ${batch}`;
    let stepOuts = 0;
    for (const e of ending) {
      stepOuts += await this.endStepIns(e.conversation_id, e.target_actor_id, e.lost ? 'ineligible' : 'idle', now, null);
    }
    return { expired, voided, stepOuts };
  }

  // -------------------------------------------------------------------

  private async closeOne(id: string, from: MentionState, to: MentionState, now: Date): Promise<number> {
    return this.prisma.$transaction(async (tx) => {
      const moved = await tx.messageMention.updateMany({ where: { id, state: from }, data: { state: to, resolvedAt: now } });
      if (moved.count === 0) return 0;
      const row = await tx.messageMention.findUniqueOrThrow({ where: { id } });
      await this.announceState(tx, row, to);
      return 1;
    });
  }

  /** Every step-in of this person in this 1:1 ends, with one visible line. */
  private async endStepIns(
    conversationId: string,
    actorId: string,
    reason: 'left' | 'idle' | 'ineligible',
    now: Date,
    by: string | null,
  ): Promise<number> {
    return this.prisma.$transaction(async (tx) => {
      const open = await tx.messageMention.findMany({
        where: { conversationId, targetActorId: actorId, state: MentionState.STEPPED_IN },
      });
      let ended = 0;
      for (const r of open) {
        const moved = await tx.messageMention.updateMany({
          where: { id: r.id, state: MentionState.STEPPED_IN },
          data: { state: MentionState.LEFT, resolvedAt: now, ...(by ? { resolvedBy: by } : {}) },
        });
        if (moved.count === 1) {
          ended += 1;
          await this.announceState(tx, r, MentionState.LEFT);
        }
      }
      if (ended === 0) return 0;
      const staff = await tx.staff.findUnique({ where: { id: actorId }, select: { name: true, role: true } });
      await this.conversations.postAnnouncement(tx, conversationId, 'mention.stepped_out', {
        name: staff?.name ?? null,
        role: staff?.role ?? null,
        reason,
      });
      await this.audit.audit(tx, {
        actorId: by ?? actorId,
        action: 'mention.stepped_out',
        entity: 'conversation',
        entityId: conversationId,
        after: { actorId, reason },
        reason: by ? 'stepped out' : `step-in ended: ${reason}`,
      });
      return 1;
    });
  }

  private async announceState(tx: Prisma.TransactionClient, row: Pick<MessageMention, 'id' | 'conversationId' | 'targetActorId'>, state: string) {
    await this.outbox.enqueue(tx, CommEvent.MENTION_UPDATED, {
      mentionId: row.id,
      conversationId: row.conversationId,
      targetActorId: row.targetActorId,
      state,
    });
  }

  /** The caller's own mention; anybody else's answers as unknown. */
  private async mine(actor: Actor, mentionId: string): Promise<MessageMention> {
    const mention = /^[0-9a-f-]{36}$/i.test(mentionId)
      ? await this.prisma.messageMention.findUnique({ where: { id: mentionId } })
      : null;
    if (!mention || mention.targetActorId !== actor.actorId || !mention.isSummons) {
      throw new CommError(CommErrorCode.MENTION_NOT_FOUND, 'no such mention of yours', 404);
    }
    return mention;
  }

  /** Still answerable: pending, unexpired, and the person still has a PD-8 basis of their own. */
  private async assertStillOpen(
    actor: Actor,
    mention: MessageMention,
    conv: { id: string; organizationId: string },
    now: Date,
  ): Promise<void> {
    if (mention.state !== MentionState.PENDING || !mention.expiresAt || mention.expiresAt <= now) throw closed();
    const basis = await this.conversations.staffAccess(actor, conv, now);
    if (basis === null || basis === ('seated' as StaffAccessBasis)) {
      await this.closeOne(mention.id, MentionState.PENDING, MentionState.VOID, now);
      throw closed('you are no longer in charge of this conversation');
    }
  }

  private async takesSummons(conversationId: string): Promise<boolean> {
    const rows = await this.prisma.$queryRaw<Array<{ ok: boolean }>>`
      SELECT chat.conversation_takes_summons(${conversationId}::uuid) AS ok`;
    return rows[0]?.ok === true;
  }

  /** chat.mention_eligible_staff: staff id -> PD-8 basis. 'seated' never counts (PD-35). */
  private async eligibleStaff(conversationId: string, now: Date): Promise<Map<string, string>> {
    const rows = await this.prisma.$queryRaw<Array<{ staff_id: string; basis: string }>>`
      SELECT staff_id::text AS staff_id, basis
        FROM chat.mention_eligible_staff(${conversationId}::uuid, ${now}::timestamptz)`;
    return new Map(rows.filter((r) => r.basis !== 'seated').map((r) => [r.staff_id, r.basis]));
  }

  private async roleTargets(conversationId: string, role: MentionRole, now: Date): Promise<string[]> {
    const rows = await this.prisma.$queryRaw<Array<{ id: string }>>`
      SELECT t::text AS id FROM chat.mention_role_targets(${conversationId}::uuid, ${role}, ${now}::timestamptz) AS t`;
    return rows.map((r) => r.id);
  }
}

function closed(reason = 'this mention was already answered or has expired'): CommError {
  return new CommError(CommErrorCode.MENTION_CLOSED, reason, 409);
}
