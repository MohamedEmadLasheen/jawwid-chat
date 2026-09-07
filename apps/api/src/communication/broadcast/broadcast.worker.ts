import { randomUUID } from 'node:crypto';
import { hostname } from 'node:os';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../platform/prisma.service';
import { AppConfigService } from '../../platform/app-config.service';
import { IDENTITY_SERVICE } from '../../platform/tokens';
import type { IdentityService } from '../../platform/identity.service';
import { NotificationService } from '../notifications/notification.service';
import { OutboxService } from '../outbox/outbox.service';
import { CommEvent } from '../contracts/events';
import {
  ActorKind,
  BroadcastRecipientStatus,
  BroadcastState,
  MessageType,
  Origin,
  Visibility,
} from '../contracts/vocab';

interface ClaimedRecipient {
  id: string;
  broadcastId: string;
  actorId: string;
  conversationId: string | null;
  attempts: number;
  claimToken: string;
}

/**
 * BROADCAST FAN-OUT.
 *
 * Drains chat.broadcast_recipient: one row per person, delivered independently.
 *
 * ## The lease, and why it is the same shape as the outbox
 *
 * Phase 4 established this discipline for chat.outbox_event after a defect that
 * was invisible for months: claiming a row by writing its TERMINAL state is a
 * correct mutual exclusion and an incorrect claim, because a worker killed
 * between the claim and the work leaves a row that says the work is done and
 * that nothing will ever rescan. Reordering the two statements does not fix it;
 * it swaps a lost-work window for an unbounded-duplicate one.
 *
 * The same reasoning applies here exactly, so the same lease is used:
 *
 *     queued ------claim-----> queued, available_at = now + lease
 *     (in flight) --success--> sent
 *     (in flight) --error----> pending (backoff) | failed (attempts exhausted)
 *     (in flight) --CRASH----> nothing written; the lease lapses and the row
 *                              becomes claimable again
 *
 * The status stays `queued` while an attempt is in flight, because that is
 * TRUE, and `available_at` -- the due time -- carries the visibility timeout.
 * `claimed_by` is the FENCE: a token unique to this claim of this row, required
 * to be unchanged before an outcome is written, so a worker returning late from
 * a slow provider cannot stamp a row another worker has since taken.
 *
 * ## Idempotency
 *
 * At-least-once, and paid for on the delivery side rather than pretended away.
 * `message_id` on the recipient row is the anchor: a redelivered lease finds
 * the message already written and completes instead of writing a second one,
 * and the notification's `dedupe_key` is
 * `broadcast:<broadcastId>:<actorId>` -- deterministic, so a repeat resolves to
 * the same notification rather than a second push.
 *
 * ## Failure isolation
 *
 * One recipient failing must never fail the broadcast. Each delivery is its own
 * transaction and its own try/catch; a permanent failure parks THAT ROW as
 * `failed` and the fan-out carries on. A broadcast where some succeeded and
 * some did not ends as `partial_failure`, which is a real terminal answer
 * rather than a rounding of the truth in either direction.
 *
 * ## Bounded concurrency
 *
 * Deliveries run `broadcast.fanout_concurrency` at a time. Unbounded
 * `Promise.all` over a batch is how a fan-out exhausts the connection pool that
 * live chat is sharing, so the fan-out becomes the reason the interactive
 * product gets slow. The bound is a config row, not a constant.
 */
@Injectable()
export class BroadcastWorker {
  private readonly log = new Logger(BroadcastWorker.name);

  /** Diagnostics only; the lease is enforced by `available_at` and the fence. */
  private readonly workerId = `${hostname()}/${process.pid}/${randomUUID().slice(0, 8)}`;

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationService,
    private readonly outbox: OutboxService,
    private readonly config: AppConfigService,
    @Inject(IDENTITY_SERVICE) private readonly identity: IdentityService,
  ) {}

  /** One pass. Returns how many recipients were delivered to. */
  async drain(): Promise<number> {
    const [batchSize, concurrency, leaseSeconds, maxAttempts] = await Promise.all([
      this.setting('broadcast.fanout_batch_size', 100),
      this.setting('broadcast.fanout_concurrency', 8),
      this.setting('broadcast.lease_seconds', 60),
      this.setting('broadcast.max_attempts', 5),
    ]);

    const batch = await this.claim(batchSize, leaseSeconds);
    if (batch.length === 0) return 0;

    // A broadcast with work in flight is PROCESSING. Conditional, so the first
    // worker to pick up a row moves it and the rest write nothing.
    const broadcastIds = [...new Set(batch.map((r) => r.broadcastId))];
    await this.prisma.broadcast.updateMany({
      where: { id: { in: broadcastIds }, state: BroadcastState.QUEUED },
      data: { state: BroadcastState.PROCESSING, startedAt: new Date() },
    });

    let delivered = 0;
    // A sliding window rather than chunked Promise.all: chunking makes every
    // batch as slow as its slowest member, and a single slow recipient would
    // idle the other seven workers.
    let cursor = 0;
    const runners = Array.from({ length: Math.min(concurrency, batch.length) }, async () => {
      for (;;) {
        const index = cursor++;
        if (index >= batch.length) return;
        const ok = await this.deliverSafely(batch[index], maxAttempts);
        if (ok) delivered += 1;
      }
    });
    await Promise.all(runners);

    for (const id of broadcastIds) await this.settle(id);
    return delivered;
  }

  /**
   * Take a lease on up to `batchSize` due recipients.
   *
   * Raw SQL for the same three reasons the outbox drain uses it: `returning`
   * gives the POST-increment `attempts` (so backoff is computed from the real
   * attempt count rather than a stale read), it is one statement instead of
   * one-plus-N, and `for update skip locked` lets concurrent workers take
   * disjoint batches instead of serialising on the same head rows.
   */
  private async claim(batchSize: number, leaseSeconds: number): Promise<ClaimedRecipient[]> {
    const claimToken = `${this.workerId}#${randomUUID()}`;
    const rows = await this.prisma.$queryRaw<
      Array<{
        id: string;
        broadcast_id: string;
        actor_id: string;
        conversation_id: string | null;
        attempts: number;
      }>
    >(Prisma.sql`
      update chat.broadcast_recipient as r
         set attempts     = r.attempts + 1,
             claimed_at   = now(),
             claimed_by   = ${claimToken},
             available_at = now() + make_interval(secs => ${leaseSeconds}::double precision)
       where r.id in (
         select d.id
           from chat.broadcast_recipient as d
           join chat.broadcast as b on b.id = d.broadcast_id
          where d.status in ('queued', 'pending')
            and d.available_at <= now()
            -- A cancelled broadcast stops being claimed immediately, without
            -- having to rewrite every one of its remaining recipient rows in
            -- the cancelling request.
            and b.state in ('queued', 'processing')
          order by d.created_at asc
            for update skip locked
          limit ${batchSize}
       )
      returning r.id, r.broadcast_id, r.actor_id, r.conversation_id, r.attempts
    `);

    return rows.map((r) => ({
      id: r.id,
      broadcastId: r.broadcast_id,
      actorId: r.actor_id,
      conversationId: r.conversation_id,
      attempts: r.attempts,
      claimToken,
    }));
  }

  /** One recipient's delivery, isolated. Never throws. */
  private async deliverSafely(
    recipient: ClaimedRecipient,
    maxAttempts: number,
  ): Promise<boolean> {
    try {
      return await this.deliver(recipient);
    } catch (err) {
      await this.release(recipient, err, maxAttempts);
      return false;
    }
  }

  private async deliver(recipient: ClaimedRecipient): Promise<boolean> {
    // A recipient with nowhere to deliver is a PERMANENT failure, not a
    // transient one: retrying cannot conjure a conversation. Parking it
    // immediately keeps the attempt budget for failures that retrying can fix.
    if (!recipient.conversationId) {
      await this.park(recipient, 'NO_CONVERSATION');
      return false;
    }

    const actor = await this.identity.resolveActor(recipient.actorId);
    if (!actor || !actor.isActive) {
      await this.park(recipient, 'RECIPIENT_INACTIVE');
      return false;
    }

    const broadcast = await this.prisma.broadcast.findUnique({
      where: { id: recipient.broadcastId },
      select: { id: true, body: true, title: true, state: true },
    });
    if (!broadcast) {
      await this.park(recipient, 'BROADCAST_MISSING');
      return false;
    }
    if (broadcast.state === BroadcastState.CANCELLED) {
      await this.park(recipient, 'CANCELLED');
      return false;
    }

    const now = new Date();

    const messageId = await this.prisma.$transaction(async (tx) => {
      // IDEMPOTENCY ANCHOR. A redelivered lease -- the crash-after-write,
      // before-confirm case the lease deliberately accepts -- finds the message
      // already here and does not write a second one into somebody's thread.
      const existing = await tx.broadcastRecipient.findUnique({
        where: { id: recipient.id },
        select: { messageId: true },
      });
      if (existing?.messageId) return existing.messageId;

      // `seq` is handed out under a row lock on the conversation, exactly as
      // the messaging path does it. Without the lock, two concurrent
      // deliveries into the same thread would collide on the sequence.
      const locked = await tx.$queryRaw<Array<{ last_seq: bigint }>>`
        SELECT last_seq FROM chat.conversation WHERE id = ${recipient.conversationId}::uuid FOR UPDATE
      `;
      const seq = (locked[0]?.last_seq ?? BigInt(0)) + BigInt(1);

      const message = await tx.message.create({
        data: {
          conversationId: recipient.conversationId!,
          authorType: ActorKind.SYSTEM,
          authorId: null,
          type: MessageType.TEXT,
          body: broadcast.body,
          visibility: Visibility.CUSTOMER,
          // ORIGIN.BROADCAST, which the schema has carried since the first
          // migration. A broadcast message is distinguishable from a person
          // typing, in the database and in every client, for ever.
          origin: Origin.BROADCAST,
          seq,
          attachmentsJson: [],
        },
      });

      await tx.conversation.update({
        where: { id: recipient.conversationId! },
        data: { lastSeq: seq, lastActivityAt: now },
      });

      await this.outbox.enqueue(tx, CommEvent.MESSAGE_CREATED, {
        conversationId: recipient.conversationId!,
        messageId: message.id,
        seq: seq.toString(),
        authorKind: ActorKind.SYSTEM,
        authorId: null,
        type: MessageType.TEXT,
        visibility: Visibility.CUSTOMER,
        moderation: 'published',
        createdAt: now.toISOString(),
      });

      return message.id;
    });

    // Deterministic, so a redelivery resolves to the same notification rather
    // than a second push on somebody's lock screen.
    const notificationId = await this.notifications.schedule({
      dedupeKey: `broadcast:${recipient.broadcastId}:${recipient.actorId}`,
      ruleKey: null,
      templateKey: 'broadcast_message',
      eventType: 'broadcast_delivered',
      recipientId: recipient.actorId,
      locale: actor.locale,
      conversationId: recipient.conversationId,
      variables: {
        organization_name: 'Jawwid',
        preview: broadcast.title ?? broadcast.body.slice(0, 120),
      },
      scheduledAt: now,
    });

    // ONLY here, and FENCED on the claim. SENT means a message row exists and a
    // notification is scheduled -- work this system actually did. It is NOT
    // promoted to DELIVERED: no client or provider has acknowledged anything,
    // and inventing that acknowledgement would make the delivery report a
    // report on our own optimism.
    const confirmed = await this.prisma.broadcastRecipient.updateMany({
      where: { id: recipient.id, claimedBy: recipient.claimToken },
      data: {
        status: BroadcastRecipientStatus.SENT,
        messageId,
        notificationId,
        sentAt: now,
        claimedAt: null,
        claimedBy: null,
        lastError: null,
      },
    });
    if (confirmed.count === 0) {
      this.log.warn(
        `broadcast recipient ${recipient.id} was delivered but its lease had ` +
          `already expired; another worker owns the row`,
      );
    }
    return true;
  }

  /**
   * The recipient's own client or the push provider confirms receipt.
   *
   * The ONLY path to DELIVERED. `recipientId` is in the WHERE clause rather
   * than checked afterwards, so a caller cannot mark somebody else's row
   * delivered and, by watching which ids change, enumerate a broadcast's
   * audience.
   */
  async markDelivered(broadcastId: string, actorId: string): Promise<void> {
    await this.prisma.broadcastRecipient.updateMany({
      where: { broadcastId, actorId, status: BroadcastRecipientStatus.SENT },
      data: { status: BroadcastRecipientStatus.DELIVERED, deliveredAt: new Date() },
    });
    await this.settle(broadcastId);
  }

  /**
   * Return a failed recipient to the queue, or park it.
   *
   * Fenced on the claim for the same reason the confirm is: if this worker's
   * lease expired mid-delivery the row belongs to somebody else, and this
   * worker must not rewrite their claim.
   */
  private async release(
    recipient: ClaimedRecipient,
    err: unknown,
    maxAttempts: number,
  ): Promise<void> {
    const exhausted = recipient.attempts >= maxAttempts;
    const backoffMs = Math.min(2 ** recipient.attempts * 5_000, 300_000);

    await this.prisma.broadcastRecipient.updateMany({
      where: { id: recipient.id, claimedBy: recipient.claimToken },
      data: {
        status: exhausted ? BroadcastRecipientStatus.FAILED : BroadcastRecipientStatus.PENDING,
        // Never a payload: the message it wraps is an announcement to a named
        // family, and this string is read by whoever reads logs.
        lastError: err instanceof Error ? err.message.slice(0, 500) : 'unknown',
        failureCode: exhausted ? 'ATTEMPTS_EXHAUSTED' : null,
        failedAt: exhausted ? new Date() : null,
        availableAt: new Date(Date.now() + backoffMs),
        claimedAt: null,
        claimedBy: null,
      },
    });

    if (exhausted) {
      this.log.error(
        `broadcast recipient ${recipient.id} parked as failed after ${recipient.attempts} attempts`,
      );
    }
  }

  /** A failure retrying cannot fix. Parked immediately, budget untouched. */
  private async park(recipient: ClaimedRecipient, code: string): Promise<void> {
    await this.prisma.broadcastRecipient.updateMany({
      where: { id: recipient.id, claimedBy: recipient.claimToken },
      data: {
        status: BroadcastRecipientStatus.FAILED,
        failureCode: code,
        failedAt: new Date(),
        claimedAt: null,
        claimedBy: null,
      },
    });
  }

  /**
   * Move a broadcast to its terminal state once no work remains.
   *
   * PARTIAL_FAILURE is a first-class outcome, not a rounding. A broadcast where
   * 398 of 400 families were reached is neither `completed` (two people did not
   * get it) nor `failed` (398 did), and forcing it into either one would make
   * the operator's screen lie in one direction or the other.
   */
  private async settle(broadcastId: string): Promise<void> {
    const grouped = await this.prisma.broadcastRecipient.groupBy({
      by: ['status'],
      where: { broadcastId },
      _count: { _all: true },
    });
    const count = (s: string) => grouped.find((g) => g.status === s)?._count._all ?? 0;

    const outstanding =
      count(BroadcastRecipientStatus.PENDING) + count(BroadcastRecipientStatus.QUEUED);
    const sent = count(BroadcastRecipientStatus.SENT) + count(BroadcastRecipientStatus.DELIVERED);
    const failed = count(BroadcastRecipientStatus.FAILED);
    const delivered = count(BroadcastRecipientStatus.DELIVERED);

    const summary = {
      sentCount: sent,
      deliveredCount: delivered,
      failedCount: failed,
      recipientCount: sent + failed + outstanding,
    };

    if (outstanding > 0) {
      // Still working. The summary is refreshed so a status poll shows progress
      // without counting the ledger.
      await this.prisma.broadcast.updateMany({
        where: { id: broadcastId, state: BroadcastState.PROCESSING },
        data: summary,
      });
      return;
    }

    const state =
      failed === 0
        ? BroadcastState.COMPLETED
        : sent === 0
          ? BroadcastState.FAILED
          : BroadcastState.PARTIAL_FAILURE;

    const moved = await this.prisma.broadcast.updateMany({
      where: {
        id: broadcastId,
        state: { in: [BroadcastState.QUEUED, BroadcastState.PROCESSING] },
      },
      data: { ...summary, state, completedAt: new Date() },
    });

    if (moved.count > 0) {
      await this.prisma.$transaction(async (tx) => {
        await this.outbox.enqueue(tx, CommEvent.BROADCAST_COMPLETED, {
          broadcastId,
          state,
          ...summary,
        });
      });
      this.log.log(
        `broadcast ${broadcastId} ${state}: ${sent} sent, ${delivered} delivered, ${failed} failed`,
      );
    }
  }

  private async setting(key: string, fallback: number): Promise<number> {
    const value = await this.config.get(key as never);
    return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
  }
}
