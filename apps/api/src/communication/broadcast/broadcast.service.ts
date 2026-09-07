import { Inject, Injectable } from '@nestjs/common';
import { PrismaService } from '../../platform/prisma.service';
import { AuthorizationService } from '../../platform/authorization.service';
import { AppConfigService } from '../../platform/app-config.service';
import { CommError, CommErrorCode } from '../../platform/errors';
import { Permission } from '../../platform/rbac/permissions';
import { AUDIT_SERVICE } from '../../platform/tokens';
import type { AuditService } from '../../platform/audit.service';
import { Actor } from '../../platform/types';
import { ConversationService } from '../conversations/conversation.service';
import { OutboxService } from '../outbox/outbox.service';
import { CommEvent } from '../contracts/events';
import {
  BroadcastRecipientStatus,
  BroadcastState,
  ConversationType,
} from '../contracts/vocab';
import { AudienceResolverService, type AudienceClause } from '../audience/audience-resolver.service';

export interface CreateBroadcastInput {
  title?: string | null;
  body: string;
  audiences: AudienceClause[];
  /**
   * Client-supplied. A manager whose phone retries a timed-out POST must not
   * send the same announcement to four hundred families twice.
   */
  idempotencyKey?: string | null;
}

export interface BroadcastView {
  id: string;
  title: string | null;
  body: string;
  state: string;
  recipientCount: number;
  sentCount: number;
  deliveredCount: number;
  failedCount: number;
  pendingCount: number;
  createdBy: string;
  createdAt: string;
  queuedAt: string | null;
  completedAt: string | null;
  audiences?: Array<{ kind: string; refId: string | null }>;
  notes?: string[];
}

/**
 * BROADCAST -- creation, audience resolution and status.
 *
 * Delivery is NOT here; it is BroadcastWorker. That split is the design.
 *
 * ## What this service must never become
 *
 *     for (const family of families) await sendMessage(family)
 *
 * inside the creating request. Every part of that is wrong at the size this
 * feature exists for: the manager's HTTP request is held open for the whole
 * fan-out; one unreachable recipient fails the lot; a retry re-sends to
 * everyone who already got it; a deploy mid-loop loses the remainder with no
 * record of where it stopped; and afterwards nothing can answer "did Rania
 * get it?".
 *
 * So `create` does exactly three things -- authorize, resolve the audience, and
 * write one ledger row per recipient -- and returns. The request is bounded by
 * the size of the audience, not by the time it takes to deliver to it, and
 * every recipient row is independently retryable from that moment on.
 *
 * ## Authorization, and what Phase 5 deliberately did NOT change
 *
 * `broadcasts.send` is held by manager and super_admin, exactly as it was
 * before Phase 5. Implementing the feature was not taken as licence to widen
 * who may use it. What Phase 5 adds is a SECOND check that is independent of
 * the permission: the resolver refuses every audience clause outside the
 * author's live scope. So even if an operator grants `broadcasts.send` to one
 * admin by per-account override, that admin reaches their own families and not
 * the academy.
 */
@Injectable()
export class BroadcastService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly authz: AuthorizationService,
    private readonly audience: AudienceResolverService,
    private readonly conversations: ConversationService,
    private readonly outbox: OutboxService,
    private readonly config: AppConfigService,
    @Inject(AUDIT_SERVICE) private readonly audit: AuditService,
  ) {}

  /**
   * Resolve an audience WITHOUT creating anything.
   *
   * The compose screen's preview. It exists so that "this reaches 412 people
   * across 180 families" is answerable before the send rather than after, and
   * it runs the identical resolver, so the preview cannot disagree with the
   * delivery.
   */
  async preview(
    actorId: string,
    audiences: AudienceClause[],
  ): Promise<{ recipientCount: number; familyCount: number; notes: string[] }> {
    const actor = await this.conversations.requireActor(actorId);
    this.requireSender(actor);
    const resolved = await this.audience.resolve(actor, audiences);
    return {
      recipientCount: resolved.recipients.length,
      familyCount: resolved.familyIds.length,
      notes: resolved.notes,
    };
  }

  /** Create a broadcast and materialise its recipient ledger. */
  async create(actorId: string, input: CreateBroadcastInput): Promise<BroadcastView> {
    const actor = await this.conversations.requireActor(actorId);
    this.requireSender(actor);

    const body = (input.body ?? '').trim();
    if (body.length === 0) {
      throw new CommError(CommErrorCode.BROADCAST_EMPTY_BODY, 'a broadcast needs a body', 400);
    }
    const maxLength = Number(await this.config.get('communication.message_max_length'));
    if (body.length > maxLength) {
      throw new CommError(
        CommErrorCode.MESSAGE_TOO_LONG,
        `a broadcast may be at most ${maxLength} characters`,
        400,
      );
    }

    // IDEMPOTENCY, checked before the work. The unique index is the real
    // guarantee -- two concurrent retries both pass this lookup -- and this is
    // the fast path that keeps the common retry from resolving a large audience
    // for nothing.
    if (input.idempotencyKey) {
      const existing = await this.prisma.broadcast.findFirst({
        where: { idempotencyKey: input.idempotencyKey, ...this.org(actor) },
        select: { id: true },
      });
      if (existing) return this.status(existing.id, actorId);
    }

    const resolved = await this.audience.resolve(actor, input.audiences);
    if (resolved.recipients.length === 0) {
      throw new CommError(
        CommErrorCode.AUDIENCE_EMPTY,
        'this audience resolves to nobody you may address',
        400,
      );
    }
    const maxRecipients = Number(await this.config.get('broadcast.max_recipients'));
    if (resolved.recipients.length > maxRecipients) {
      throw new CommError(
        CommErrorCode.AUDIENCE_TOO_LARGE,
        `this audience resolves to ${resolved.recipients.length} recipients, ` +
          `above the ${maxRecipients} limit`,
        400,
      );
    }

    // Where each message will land, resolved NOW rather than during delivery.
    // A recipient with nowhere to deliver is a resolution failure that should
    // be visible before the fan-out starts, not a null dereference inside it.
    const conversationByActor = await this.resolveConversations(
      resolved.recipients.map((r) => ({ actorId: r.actorId, familyId: r.familyId })),
    );

    const broadcastId = await this.prisma.$transaction(async (tx) => {
      const created = await tx.broadcast.create({
        data: {
          title: input.title?.trim() || null,
          body,
          createdBy: actor.actorId,
          state: BroadcastState.DRAFT,
          idempotencyKey: input.idempotencyKey ?? null,
          recipientCount: resolved.recipients.length,
        },
      });

      await tx.broadcastAudience.createMany({
        data: input.audiences.map((a) => ({
          broadcastId: created.id,
          kind: a.kind,
          refId: a.refId ?? null,
        })),
        skipDuplicates: true,
      });

      // ONE createMany, not one insert per recipient. The unique index on
      // (broadcast_id, actor_id) is what makes a person matched by three
      // audience clauses a single row -- deduplication as a constraint rather
      // than as a code path that can be forgotten.
      await tx.broadcastRecipient.createMany({
        data: resolved.recipients.map((r) => ({
          broadcastId: created.id,
          actorId: r.actorId,
          matchedKind: r.matchedKind,
          conversationId: conversationByActor.get(r.actorId) ?? null,
          status: BroadcastRecipientStatus.PENDING,
        })),
        skipDuplicates: true,
      });

      await this.audit.audit(tx, {
        actorId: actor.actorId,
        action: 'broadcast.created',
        entity: 'broadcast',
        entityId: created.id,
        after: {
          recipientCount: resolved.recipients.length,
          familyCount: resolved.familyIds.length,
          audiences: input.audiences,
        },
        reason: 'broadcast composed',
      });

      return created.id;
    });

    const view = await this.status(broadcastId, actorId);
    return { ...view, notes: resolved.notes };
  }

  /**
   * Hand the broadcast to the workers.
   *
   * Nothing is delivered here. The recipients become claimable and the request
   * returns; that is the whole point of the state.
   */
  async queue(broadcastId: string, actorId: string): Promise<BroadcastView> {
    const actor = await this.conversations.requireActor(actorId);
    this.requireSender(actor);
    const broadcast = await this.requireBroadcast(broadcastId, actor);

    if (broadcast.state === BroadcastState.QUEUED || broadcast.state === BroadcastState.PROCESSING) {
      // Idempotent: queueing a queued broadcast is not an error, it is a retry.
      return this.status(broadcastId, actorId);
    }
    if (broadcast.state !== BroadcastState.DRAFT) {
      throw new CommError(
        CommErrorCode.BROADCAST_INVALID_STATE,
        `a broadcast in state ${broadcast.state} cannot be queued`,
        409,
      );
    }

    const now = new Date();
    await this.prisma.$transaction(async (tx) => {
      // Conditional, so two concurrent queue requests do not both start it.
      const moved = await tx.broadcast.updateMany({
        where: { id: broadcastId, state: BroadcastState.DRAFT },
        data: { state: BroadcastState.QUEUED, queuedAt: now },
      });
      if (moved.count === 0) return;

      await tx.broadcastRecipient.updateMany({
        where: { broadcastId, status: BroadcastRecipientStatus.PENDING },
        data: { status: BroadcastRecipientStatus.QUEUED, availableAt: now },
      });

      await this.outbox.enqueue(tx, CommEvent.BROADCAST_QUEUED, {
        broadcastId,
        state: BroadcastState.QUEUED,
        recipientCount: broadcast.recipientCount,
        sentCount: 0,
        deliveredCount: 0,
        failedCount: 0,
      });

      await this.audit.audit(tx, {
        actorId: actor.actorId,
        action: 'broadcast.queued',
        entity: 'broadcast',
        entityId: broadcastId,
        after: { recipientCount: broadcast.recipientCount },
        reason: 'broadcast queued for delivery',
      });
    });

    return this.status(broadcastId, actorId);
  }

  /**
   * Stop a broadcast that has not finished.
   *
   * Recipients already delivered are LEFT ALONE. There is no un-sending a
   * message, and rewriting their rows to say otherwise would make the delivery
   * report a lie about what people received.
   */
  async cancel(broadcastId: string, actorId: string, reason: string): Promise<BroadcastView> {
    const actor = await this.conversations.requireActor(actorId);
    this.requireSender(actor);
    const broadcast = await this.requireBroadcast(broadcastId, actor);

    if (
      broadcast.state === BroadcastState.COMPLETED ||
      broadcast.state === BroadcastState.PARTIAL_FAILURE ||
      broadcast.state === BroadcastState.CANCELLED
    ) {
      throw new CommError(
        CommErrorCode.BROADCAST_INVALID_STATE,
        `a broadcast in state ${broadcast.state} cannot be cancelled`,
        409,
      );
    }
    if (!reason || reason.trim().length === 0) {
      throw new CommError(
        CommErrorCode.APPROVAL_REASON_REQUIRED,
        'cancelling a broadcast requires a reason',
        400,
      );
    }

    const now = new Date();
    await this.prisma.$transaction(async (tx) => {
      await tx.broadcast.updateMany({
        where: { id: broadcastId, state: { in: [BroadcastState.DRAFT, BroadcastState.QUEUED, BroadcastState.PROCESSING] } },
        data: { state: BroadcastState.CANCELLED, cancelledAt: now, cancelReason: reason.trim() },
      });
      // Only the undelivered. A `sent` row stays `sent`.
      await tx.broadcastRecipient.updateMany({
        where: {
          broadcastId,
          status: { in: [BroadcastRecipientStatus.PENDING, BroadcastRecipientStatus.QUEUED] },
        },
        data: { status: BroadcastRecipientStatus.FAILED, failureCode: 'CANCELLED', failedAt: now },
      });
      await this.audit.audit(tx, {
        actorId: actor.actorId,
        action: 'broadcast.cancelled',
        entity: 'broadcast',
        entityId: broadcastId,
        after: { state: BroadcastState.CANCELLED },
        reason: reason.trim(),
      });
    });

    return this.status(broadcastId, actorId);
  }

  /**
   * Live status, counted from the ledger.
   *
   * Counted rather than read off the denormalised columns, so the number an
   * operator sees is the truth even if a worker died between delivering and
   * updating the summary. One grouped query, not one per status.
   */
  async status(broadcastId: string, actorId: string): Promise<BroadcastView> {
    const actor = await this.conversations.requireActor(actorId);
    this.requireSender(actor);
    const broadcast = await this.requireBroadcast(broadcastId, actor);

    const grouped = await this.prisma.broadcastRecipient.groupBy({
      by: ['status'],
      where: { broadcastId },
      _count: { _all: true },
    });
    const count = (status: string) =>
      grouped.find((g) => g.status === status)?._count._all ?? 0;

    const audiences = await this.prisma.broadcastAudience.findMany({
      where: { broadcastId },
      select: { kind: true, refId: true },
    });

    return {
      id: broadcast.id,
      title: broadcast.title,
      body: broadcast.body,
      state: broadcast.state,
      recipientCount: grouped.reduce((sum, g) => sum + g._count._all, 0),
      // A delivered recipient was also sent to. Reporting `sent` as only the
      // rows still sitting in `sent` would make the number fall as delivery
      // confirmations arrived, which reads as messages being un-sent.
      sentCount: count(BroadcastRecipientStatus.SENT) + count(BroadcastRecipientStatus.DELIVERED),
      deliveredCount: count(BroadcastRecipientStatus.DELIVERED),
      failedCount: count(BroadcastRecipientStatus.FAILED),
      pendingCount:
        count(BroadcastRecipientStatus.PENDING) + count(BroadcastRecipientStatus.QUEUED),
      createdBy: broadcast.createdBy,
      createdAt: broadcast.createdAt.toISOString(),
      queuedAt: broadcast.queuedAt?.toISOString() ?? null,
      completedAt: broadcast.completedAt?.toISOString() ?? null,
      audiences,
    };
  }

  async list(actorId: string): Promise<BroadcastView[]> {
    const actor = await this.conversations.requireActor(actorId);
    this.requireSender(actor);
    const rows = await this.prisma.broadcast.findMany({
      where: { ...this.org(actor) },
      orderBy: { createdAt: 'desc' },
      take: 50,
      select: { id: true },
    });
    const out: BroadcastView[] = [];
    for (const r of rows) out.push(await this.status(r.id, actorId));
    return out;
  }

  /**
   * Which conversation each recipient's message lands in.
   *
   * TWO QUERIES for the whole audience, not one per recipient. The naive shape
   * -- look up a conversation inside the delivery loop -- is an N+1 on the
   * hottest path in the feature, and it runs once per person in an audience
   * that may be the entire customer base.
   *
   * A recipient with no existing conversation gets a null here rather than a
   * newly created one: creating conversations is the messaging domain's job
   * with its own BR-1 triggers and membership rules, and a broadcast has no
   * business minting hundreds of threads as a side effect. Those recipients are
   * recorded and reported as unreachable, which is a fact an operator can act
   * on.
   */
  private async resolveConversations(
    recipients: Array<{ actorId: string; familyId: string | null }>,
  ): Promise<Map<string, string>> {
    const out = new Map<string, string>();

    const familyIds = [
      ...new Set(recipients.map((r) => r.familyId).filter((id): id is string => id !== null)),
    ];
    if (familyIds.length > 0) {
      const conversations = await this.prisma.conversation.findMany({
        where: {
          familyId: { in: familyIds },
          type: ConversationType.DIRECT,
          archivedAt: null,
        },
        select: { id: true, familyId: true, lastActivityAt: true },
        orderBy: { lastActivityAt: 'desc' },
      });
      // The family's most recently active direct thread -- the one a parent is
      // actually looking at.
      const byFamily = new Map<string, string>();
      for (const c of conversations) {
        if (c.familyId && !byFamily.has(c.familyId)) byFamily.set(c.familyId, c.id);
      }
      for (const r of recipients) {
        if (r.familyId && byFamily.has(r.familyId)) {
          out.set(r.actorId, byFamily.get(r.familyId)!);
        }
      }
    }

    const unresolved = recipients.filter((r) => !out.has(r.actorId)).map((r) => r.actorId);
    if (unresolved.length > 0) {
      // Teachers, and anybody whose family has no direct thread: fall back to
      // any conversation they are a live member of.
      const memberships = await this.prisma.conversationMember.findMany({
        where: { actorId: { in: unresolved }, leftAt: null },
        select: { actorId: true, conversationId: true },
      });
      for (const m of memberships) {
        if (!out.has(m.actorId)) out.set(m.actorId, m.conversationId);
      }
    }

    return out;
  }

  private async requireBroadcast(broadcastId: string, actor: Actor) {
    const broadcast = await this.prisma.broadcast.findFirst({
      where: { id: broadcastId, ...this.org(actor) },
    });
    if (!broadcast) {
      throw new CommError(CommErrorCode.BROADCAST_NOT_FOUND, 'broadcast not found', 404);
    }
    return broadcast;
  }

  private requireSender(actor: Actor): void {
    const decision = this.authz.can(actor, Permission.BROADCASTS_SEND);
    if (!decision.allowed) throw new CommError(decision.code, decision.reason);
  }

  private org(actor: Actor) {
    return actor.organizationId ? { organizationId: actor.organizationId } : {};
  }
}
