import { Injectable } from '@nestjs/common';
import type { Conversation, ScheduledCall } from '@prisma/client';
import { PrismaService } from '../platform/prisma.service';
import { AppConfigService } from '../platform/app-config.service';
import { CommError, CommErrorCode } from '../platform/errors';
import type { Actor } from '../platform/types';
import { CallService } from '../communication/calls/call.service';
import { ConversationService, isUuid } from '../communication/conversations/conversation.service';
import { CallStatus, CardKind, ScheduledCallKind } from '../communication/contracts/vocab';
import { CardPoster } from '../supervision/card-poster';
import { renderScheduledCallCardBody, type CardLanguage } from './scheduled-call-cards';

/** A scheduled call opens this long before its start... */
export const JOIN_OPENS_BEFORE_MS = 10 * 60_000;
/** ...and stays joinable this long after it. A call link's start is the moment it was made. */
export const JOIN_CLOSES_AFTER_MS = 2 * 60 * 60_000;
/** How far ahead a call may be scheduled. */
const MAX_LEAD_MS = 180 * 24 * 60 * 60_000;
/** A start this far in the past is a clock skew, not a request for a past call. */
const PAST_TOLERANCE_MS = 60_000;

export type ScheduledCallState = 'upcoming' | 'open' | 'cancelled' | 'over';

export interface ScheduledCallDto {
  id: string;
  conversationId: string;
  kind: ScheduledCallKind;
  title: string | null;
  startsAt: string;
  joinableFrom: string;
  joinableUntil: string;
  state: ScheduledCallState;
  createdBy: { actorId: string; displayName: string | null };
  /** Advisory: only the creator may cancel, and only before it is over. */
  canCancel: boolean;
}

export interface JoinResult {
  callId: string;
  conversationId: string;
  /**
   * `started`: the caller started the call (it is ringing the others).
   * `joined`: a call is already live here and the caller holds a seat in it --
   * answer it with POST /calls/:id/accept, then fetch a media token.
   */
  mode: 'started' | 'joined';
}

const invalid = (field: string, why: string) => new CommError(CommErrorCode.VALIDATION, `${field}: ${why}`, 400);
const notFound = () => new CommError(CommErrorCode.SCHEDULED_CALL_NOT_FOUND, 'scheduled call not found', 404);

/**
 * PD-13: scheduled calls and members-only call links.
 *
 * A scheduled call is an ANNOUNCEMENT inside one conversation, never a grant.
 * Every decision it needs is delegated to the rules that already exist:
 *
 *   - scheduling one requires being able to START a call there right now
 *     (CallService.callCapability -- the same decideInitiate POST /calls uses),
 *     so whoever may start a call in a conversation may schedule one there
 *     (since PD-19 that includes a parent in their family's group) and nobody
 *     can schedule a teacher<->parent 1:1 (PD-7);
 *   - seeing one requires reading its conversation (canRead);
 *   - joining one runs CallService.start or CallService.accept, which decide
 *     again from scratch, exactly as a call button would.
 *
 * The call stack itself (W1-W7, frozen) is consumed, never changed.
 */
@Injectable()
export class ScheduledCallService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly conversations: ConversationService,
    private readonly calls: CallService,
    private readonly cards: CardPoster,
    private readonly config: AppConfigService,
  ) {}

  async create(actorId: string, body: Record<string, unknown>): Promise<ScheduledCallDto> {
    const conversationId = body.conversationId;
    if (!isUuid(conversationId)) throw invalid('conversationId', 'must be a uuid');
    const kind = body.kind ?? ScheduledCallKind.SCHEDULED;
    if (kind !== ScheduledCallKind.SCHEDULED && kind !== ScheduledCallKind.LINK) {
      throw invalid('kind', "must be 'scheduled' or 'link'");
    }
    const title = parseTitle(body.title);
    const now = new Date();
    let startsAt = now;
    if (kind === ScheduledCallKind.SCHEDULED) {
      if (typeof body.startsAt !== 'string') throw invalid('startsAt', 'is required');
      startsAt = new Date(body.startsAt);
      if (Number.isNaN(startsAt.getTime())) throw invalid('startsAt', 'must be an ISO-8601 instant');
      if (startsAt.getTime() < now.getTime() - PAST_TOLERANCE_MS) throw invalid('startsAt', 'is in the past');
      if (startsAt.getTime() > now.getTime() + MAX_LEAD_MS) throw invalid('startsAt', 'is more than 180 days ahead');
    }

    const actor = await this.requireLiveActor(actorId);
    // Reads first (an unreadable conversation refuses as the read path does),
    // then the start decision. ADVISORY at this instant; Join decides again.
    const capability = await this.calls.callCapability(conversationId, actorId);
    if (!capability.canCall) {
      throw new CommError(
        (capability.code as CommErrorCode | null) ?? CommErrorCode.SCHEDULED_CALL_DENIED,
        'this caller may not start a call in this conversation',
        403,
      );
    }
    const conv = await this.conversations.requireConversation(conversationId);
    const lang: CardLanguage = actor.locale === 'en' ? 'en' : 'ar';
    const when = await this.when(startsAt, lang);

    const row = await this.prisma.$transaction(async (tx) => {
      await this.conversations.assertActorLive(tx, actor);
      const created = await tx.scheduledCall.create({
        data: {
          organizationId: conv.organizationId,
          conversationId: conv.id,
          kind,
          title,
          startsAt,
          createdBy: actor.actorId,
          createdByKind: actor.kind,
        },
      });
      const cardKind = kind === ScheduledCallKind.LINK ? CardKind.CALL_LINK : CardKind.CALL_SCHEDULED;
      const payload = cardPayload(created, actor, when);
      const messageId = await this.cards.post(tx, conv, actor, {
        kind: cardKind,
        payload,
        body: renderScheduledCallCardBody(cardKind, payload, lang),
      });
      return tx.scheduledCall.update({ where: { id: created.id }, data: { messageId } });
    });
    return this.toDto(row, actor, new Map([[actor.actorId, actor.displayName]]), new Date());
  }

  /** The caller's open and coming scheduled calls, soonest first. */
  async upcoming(actorId: string): Promise<{ items: ScheduledCallDto[] }> {
    const actor = await this.requireLiveActor(actorId);
    const readable = await this.conversations.listForActor(actorId);
    if (readable.length === 0) return { items: [] };
    const now = new Date();
    const rows = await this.prisma.scheduledCall.findMany({
      where: {
        conversationId: { in: readable.map((c) => c.id) },
        cancelledAt: null,
        startsAt: { gt: new Date(now.getTime() - JOIN_CLOSES_AFTER_MS) },
      },
      orderBy: [{ startsAt: 'asc' }, { id: 'asc' }],
      take: 50,
    });
    const names = await this.creatorNames(rows);
    return { items: rows.map((r) => this.toDto(r, actor, names, now)) };
  }

  async get(actorId: string, id: string): Promise<ScheduledCallDto> {
    const actor = await this.requireLiveActor(actorId);
    const row = await this.readable(actor, id);
    return this.toDto(row, actor, await this.creatorNames([row]), new Date());
  }

  /** Only the creator, and only before it is over. Posts a cancellation card. */
  async cancel(actorId: string, id: string): Promise<ScheduledCallDto> {
    const actor = await this.requireLiveActor(actorId);
    const row = await this.readable(actor, id);
    if (row.createdBy !== actor.actorId) {
      throw new CommError(CommErrorCode.SCHEDULED_CALL_DENIED, 'only the person who scheduled this call cancels it', 403);
    }
    const now = new Date();
    const state = stateOf(row, now);
    if (state === 'cancelled') return this.toDto(row, actor, await this.creatorNames([row]), now);
    if (state === 'over') {
      throw new CommError(CommErrorCode.SCHEDULED_CALL_NOT_JOINABLE, 'this call is already over', 409);
    }
    const conv = await this.conversations.requireConversation(row.conversationId);
    const lang: CardLanguage = actor.locale === 'en' ? 'en' : 'ar';
    const when = await this.when(row.startsAt, lang);
    const updated = await this.prisma.$transaction(async (tx) => {
      await this.conversations.assertActorLive(tx, actor);
      const locked = await tx.$queryRaw<Array<{ cancelled_at: Date | null }>>`
        SELECT cancelled_at FROM chat.scheduled_call WHERE id = ${row.id}::uuid FOR UPDATE`;
      if (locked[0]?.cancelled_at) return tx.scheduledCall.findUniqueOrThrow({ where: { id: row.id } });
      const next = await tx.scheduledCall.update({
        where: { id: row.id },
        data: { cancelledAt: now, cancelledBy: actor.actorId },
      });
      const payload = cardPayload(next, actor, when);
      await this.cards.post(tx, conv, actor, {
        kind: CardKind.CALL_SCHEDULE_CANCELLED,
        payload,
        body: renderScheduledCallCardBody(CardKind.CALL_SCHEDULE_CANCELLED, payload, lang),
      });
      return next;
    });
    return this.toDto(updated, actor, await this.creatorNames([updated]), new Date());
  }

  /**
   * Join: start the call, or take the caller's seat in the one already live.
   *
   * SERIALIZED PER SCHEDULED CALL. Two members tapping Join at the same moment
   * must produce ONE call, not two ringing each other: the row is locked, the
   * live-call check runs under that lock, and the second Join waits for the
   * first to record the call it started. (CallService.start itself does not
   * look for a live call in the conversation; that is a W1 property this does
   * not change.)
   */
  async join(actorId: string, id: string): Promise<JoinResult> {
    const actor = await this.requireLiveActor(actorId);
    const row = await this.readable(actor, id);
    const state = stateOf(row, new Date());
    if (state !== 'open') {
      throw new CommError(
        CommErrorCode.SCHEDULED_CALL_NOT_JOINABLE,
        state === 'cancelled' ? 'this call was cancelled' : state === 'over' ? 'this call is over' : 'this call is not open yet',
        409,
      );
    }
    const joinableFrom = new Date(row.startsAt.getTime() - JOIN_OPENS_BEFORE_MS);

    return this.prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT id FROM chat.scheduled_call WHERE id = ${row.id}::uuid FOR UPDATE`;
        const live = await tx.call.findFirst({
          where: {
            conversationId: row.conversationId,
            status: { in: [CallStatus.RINGING, CallStatus.ACTIVE] },
            // A call left ACTIVE from before this window is not this one
            // (stale ACTIVE calls have no deadline -- a W1 carry-forward).
            startedAt: { gte: joinableFrom },
          },
          include: { participants: { where: { actorId: actor.actorId } } },
          orderBy: [{ startedAt: 'desc' }, { id: 'desc' }],
        });
        if (live) {
          if (live.initiatorId === actor.actorId) {
            return { callId: live.id, conversationId: row.conversationId, mode: 'started' as const };
          }
          const seat = live.participants[0];
          if (!seat || seat.leftAt !== null) {
            throw new CommError(CommErrorCode.CALL_NOT_A_PARTICIPANT, 'this caller has no seat in the live call', 409);
          }
          return { callId: live.id, conversationId: row.conversationId, mode: 'joined' as const };
        }
        // Nothing live: start one. CallService.start decides authorization from
        // scratch (PD-7 refuses a teacher<->parent pair).
        const started = await this.calls.start(row.conversationId, actor.actorId);
        await tx.scheduledCall.update({ where: { id: row.id }, data: { callId: started.callId } });
        return { callId: started.callId, conversationId: row.conversationId, mode: 'started' as const };
      },
      { timeout: 20_000, maxWait: 10_000 },
    );
  }

  // -------------------------------------------------------------------------

  private async requireLiveActor(actorId: string): Promise<Actor> {
    const actor = await this.conversations.requireActor(actorId);
    if (!actor.isActive) throw new CommError(CommErrorCode.ACTOR_INACTIVE, 'actor is inactive', 403);
    return actor;
  }

  /** The row, if its conversation is readable by this actor; 404 otherwise, indistinguishably. */
  private async readable(actor: Actor, id: string): Promise<ScheduledCall> {
    if (!isUuid(id)) throw notFound();
    const row = await this.prisma.scheduledCall.findUnique({ where: { id } });
    if (!row) throw notFound();
    let conv: Conversation;
    try {
      conv = await this.conversations.requireConversation(row.conversationId);
    } catch {
      throw notFound();
    }
    const membership = await this.conversations.membershipOf(conv.id, actor.actorId);
    const read = await this.conversations.canReadResolved(actor, conv, membership);
    if (!read.allowed) throw notFound();
    return row;
  }

  private async creatorNames(rows: ScheduledCall[]): Promise<Map<string, string | null>> {
    const names = new Map<string, string | null>();
    for (const id of new Set(rows.map((r) => r.createdBy))) {
      const a = await this.conversations.requireActor(id).catch(() => null);
      names.set(id, a?.displayName ?? null);
    }
    return names;
  }

  private toDto(row: ScheduledCall, viewer: Actor, names: Map<string, string | null>, now: Date): ScheduledCallDto {
    const state = stateOf(row, now);
    return {
      id: row.id,
      conversationId: row.conversationId,
      kind: row.kind as ScheduledCallKind,
      title: row.title,
      startsAt: row.startsAt.toISOString(),
      joinableFrom: new Date(row.startsAt.getTime() - JOIN_OPENS_BEFORE_MS).toISOString(),
      joinableUntil: new Date(row.startsAt.getTime() + JOIN_CLOSES_AFTER_MS).toISOString(),
      state,
      createdBy: { actorId: row.createdBy, displayName: names.get(row.createdBy) ?? null },
      canCancel: row.createdBy === viewer.actorId && (state === 'upcoming' || state === 'open'),
    };
  }

  /** The instant in the academy's zone, as the conversation reads it. */
  private async when(at: Date, lang: CardLanguage): Promise<string> {
    const zone = String(await this.config.get('stats.zone'));
    return new Intl.DateTimeFormat(lang === 'ar' ? 'ar-EG' : 'en-GB', {
      timeZone: zone, weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit',
    }).format(at);
  }
}

export function stateOf(row: Pick<ScheduledCall, 'startsAt' | 'cancelledAt'>, now: Date): ScheduledCallState {
  if (row.cancelledAt) return 'cancelled';
  const t = now.getTime();
  const start = row.startsAt.getTime();
  if (t > start + JOIN_CLOSES_AFTER_MS) return 'over';
  if (t >= start - JOIN_OPENS_BEFORE_MS) return 'open';
  return 'upcoming';
}

function parseTitle(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') throw invalid('title', 'must be a string');
  const t = value.trim();
  if (t.length === 0) return null;
  if (t.length > 120) throw invalid('title', 'must be at most 120 characters');
  return t;
}

/** What a card carries. Ids and instants only -- no phone, no room, no token. */
function cardPayload(row: ScheduledCall, by: Actor, when: string): Record<string, unknown> {
  return {
    scheduledCallId: row.id,
    kind: row.kind,
    title: row.title,
    startsAt: row.startsAt.toISOString(),
    joinableFrom: new Date(row.startsAt.getTime() - JOIN_OPENS_BEFORE_MS).toISOString(),
    joinableUntil: new Date(row.startsAt.getTime() + JOIN_CLOSES_AFTER_MS).toISOString(),
    when,
    byName: by.displayName,
  };
}
