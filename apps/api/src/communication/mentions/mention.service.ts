import { randomUUID } from 'node:crypto';
import { Inject, Injectable, OnModuleInit, Optional } from '@nestjs/common';
import type { ConversationMember, MessageMention, Prisma } from '@prisma/client';
import { PrismaService } from '../../platform/prisma.service';
import { AppConfigService } from '../../platform/app-config.service';
import { CommError, CommErrorCode } from '../../platform/errors';
import { AUDIT_SERVICE, IDENTITY_SERVICE } from '../../platform/tokens';
import type { AuditService } from '../../platform/audit.service';
import type { IdentityService } from '../../platform/identity.service';
import { actorRefKey } from '../../platform/identity.service';
import type { Actor } from '../../platform/types';
import type { Decision } from '../../platform/authorization.service';
import { SeatPolicyRegistry, SeatReason, type SeatJoinContext, type SeatTarget } from '../seats/seat-policy';
import { ConversationService } from '../conversations/conversation.service';
import { OutboxService } from '../outbox/outbox.service';
import { CommEvent } from '../contracts/events';
import { ActorKind, Visibility } from '../contracts/vocab';
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
  /** Always 'pending': a summons a seat answered is no longer listed. */
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
 * Answering a summons is PD-35's visible seat, reason 'mention': a member row
 * in a group, an EFFECTIVE seat in a family 1:1 (which never gains a third
 * member). This service registers the reason's join policy (`canJoin`: an open
 * summons AND PD-8 standing of the joiner's own) and, in its sweep, marks the
 * summonses a seat answered. Staying seated is the database's question
 * (chat.seat_reason 'mention': standing, as for a manual seat).
 */
@Injectable()
export class MentionService implements OnModuleInit {
  constructor(
    private readonly prisma: PrismaService,
    private readonly conversations: ConversationService,
    private readonly outbox: OutboxService,
    private readonly config: AppConfigService,
    @Inject(AUDIT_SERVICE) private readonly audit: AuditService,
    @Inject(IDENTITY_SERVICE) private readonly identity: IdentityService,
    // PD-35. Optional so the positional constructions the harnesses share do
    // not shift; without it nobody can join on a mention (the placeholder refuses).
    @Optional() private readonly seats?: SeatPolicyRegistry,
  ) {}

  /** Replaces PD-35's refusing placeholder for reason 'mention'. */
  onModuleInit(): void {
    this.seats?.register({
      reason: SeatReason.MENTION,
      canJoin: (actor, conv, ctx) => this.canJoin(actor, conv, ctx),
    });
  }

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
          { state: MentionState.NOTIFIED, seenAt: null },
        ],
      },
      orderBy: { createdAt: 'desc' },
    });
    // A summons a seat already answered is not asking any more (the sweep marks it).
    const seated = await this.openSeatsOf(actorId, rows.filter((r) => r.isSummons).map((r) => r.conversationId));
    const out = new Map<string, ViewerMentionDto>();
    // A summons outranks a member mention; then the newest.
    for (const r of [...rows].sort((a, b) => Number(b.isSummons) - Number(a.isSummons))) {
      if (out.has(r.conversationId) || (r.isSummons && seated.has(r.conversationId))) continue;
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
        state: MentionState.PENDING,
        expiresAt: { gt: now },
      },
      orderBy: { createdAt: 'desc' },
    });
    // A seat answers a summons: in a group it is a member row already; in a
    // family 1:1 it is an effective seat, which is no member.
    const seatHolders = await this.prisma.$queryRaw<Array<{ staff_id: string }>>`
      SELECT staff_id::text AS staff_id FROM chat.conversation_seat
       WHERE conversation_id = ${conversationId}::uuid AND left_at IS NULL`;
    const answered = new Set([...liveMemberIds, ...seatHolders.map((x) => x.staff_id)]);
    const latest = new Map<string, MessageMention>();
    for (const r of rows) if (!latest.has(r.targetActorId) && !answered.has(r.targetActorId)) latest.set(r.targetActorId, r);
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
        state: MentionState.PENDING,
        expiresAt: { gt: now },
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
   * Leaving a seat taken on one is PD-35's leave (visible, RT-009).
   */
  async dismiss(actorId: string, mentionId: string): Promise<{ state: string }> {
    const actor = await this.conversations.requireActor(actorId);
    const mention = await this.mine(actor, mentionId);
    const now = new Date();
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
   * PD-35 SeatPolicy 'mention': may this actor take a seat here on a mention?
   *
   *   an open summons of them in this conversation -- `ctx.sourceId` names it
   *   when the client knows it -- unexpired; AND
   *   PD-8 standing of their own (`ctx.standing`, which no seat supplies: the
   *   seat service reads chat.staff_conversation_standing).
   *
   * A summons whose person lost their standing is voided on the way out, so
   * Group Info stops showing someone who can no longer come.
   */
  async canJoin(actor: Actor, conv: SeatTarget, ctx: SeatJoinContext): Promise<Decision> {
    const refuse = (reason: string): Decision => ({ allowed: false, code: CommErrorCode.SEAT_NOT_ELIGIBLE, reason });
    const mention = await this.prisma.messageMention.findFirst({
      where: {
        conversationId: conv.id,
        targetActorId: actor.actorId,
        isSummons: true,
        state: MentionState.PENDING,
        expiresAt: { gt: ctx.now },
        ...(ctx.sourceId ? { id: ctx.sourceId } : {}),
      },
      orderBy: { createdAt: 'desc' },
    });
    if (!mention) return refuse('no open mention of you here');
    if (ctx.standing === null) {
      await this.closeOne(mention.id, MentionState.PENDING, MentionState.VOID, ctx.now);
      return refuse('you are no longer in charge of this conversation');
    }
    return { allowed: true, onBehalfMode: null, moderation: 'published' };
  }

  // -------------------------------------------------------------------
  // The sweep (worker; safe on every replica: each row moves by a conditional update)
  // -------------------------------------------------------------------

  async sweep(now = new Date(), batch = 200): Promise<{ expired: number; voided: number; joined: number }> {
    // 1. Answered by a seat (PD-35's join, reason 'mention' or any other): the
    //    summonses of that person in that conversation are no longer asking.
    const seated = await this.prisma.$queryRaw<Array<{ id: string }>>`
      SELECT mm.id::text AS id FROM chat.message_mention mm
       WHERE mm.state = 'pending'
         AND EXISTS (SELECT 1 FROM chat.conversation_seat s
                      WHERE s.conversation_id = mm.conversation_id AND s.staff_id = mm.target_actor_id
                        AND s.left_at IS NULL)
       LIMIT ${batch}`;
    let joined = 0;
    for (const { id } of seated) joined += await this.closeOne(id, MentionState.PENDING, MentionState.JOINED, now);

    // 2. Unanswered past the window.
    const expiredRows = await this.prisma.$queryRaw<Array<{ id: string }>>`
      SELECT id::text AS id FROM chat.message_mention
       WHERE state = 'pending' AND expires_at <= ${now}::timestamptz
       ORDER BY expires_at LIMIT ${batch}`;
    let expired = 0;
    for (const { id } of expiredRows) {
      expired += await this.closeOne(id, MentionState.PENDING, MentionState.EXPIRED, now);
    }

    // 3. Asked in, then lost their standing before answering: Group Info stops
    //    showing someone who can no longer come.
    const lost = await this.prisma.$queryRaw<Array<{ id: string }>>`
      SELECT id::text AS id FROM chat.message_mention
       WHERE state = 'pending' AND expires_at > ${now}::timestamptz
         AND chat.staff_conversation_standing(target_actor_id, conversation_id, ${now}::timestamptz) IS NULL
       LIMIT ${batch}`;
    let voided = 0;
    for (const { id } of lost) voided += await this.closeOne(id, MentionState.PENDING, MentionState.VOID, now);
    return { expired, voided, joined };
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

  /** Of these conversations, the ones where this staff member holds an open seat. */
  private async openSeatsOf(staffId: string, conversationIds: readonly string[]): Promise<Set<string>> {
    if (conversationIds.length === 0) return new Set();
    const rows = await this.prisma.$queryRaw<Array<{ conversation_id: string }>>`
      SELECT conversation_id::text AS conversation_id FROM chat.conversation_seat
       WHERE staff_id = ${staffId}::uuid AND left_at IS NULL
         AND conversation_id = ANY(${[...conversationIds]}::uuid[])`;
    return new Set(rows.map((r) => r.conversation_id));
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
