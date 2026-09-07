import { randomUUID } from 'node:crypto';
import { hostname } from 'node:os';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../platform/prisma.service';
import { AppConfigService } from '../../platform/app-config.service';
import { IDENTITY_SERVICE, REALTIME_PUBLISHER } from '../../platform/tokens';
import type { IdentityService } from '../../platform/identity.service';
import type { RealtimePublisher } from '../realtime/realtime.publisher';
import { CommEvent, CommEventName } from '../contracts/events';
import { NotificationService } from '../notifications/notification.service';
import { ActorKind, Visibility } from '../contracts/vocab';

/** One row, as the claim returns it. */
interface ClaimedEvent {
  id: string;
  type: string;
  payload: Prisma.JsonValue;
  attempts: number;
  /**
   * The fence token for this claim: a value unique to THIS claim of THIS row,
   * written into `claimed_by` and required to be unchanged before the outcome
   * is recorded.
   *
   * Guarding on `status = 'processing'` alone would not be enough -- a reclaim
   * by another worker also leaves the row in `processing`, so this worker,
   * returning late from a slow publish, would stamp the row complete underneath
   * the worker that now owns it and cancel their attempt.
   *
   * The token is a random id rather than `claimed_at`, because `timestamptz` is
   * microsecond-precision in PostgreSQL and millisecond-precision in JavaScript:
   * a timestamp fence would be truncated on the way out and never match on the
   * way back in, and every confirm would silently fall through to the
   * lease-expired branch.
   */
  claimToken: string;
  /** Set when this row had already been claimed by a worker that never finished. */
  reclaimed: boolean;
}

/** What `stuckReport()` answers, for operators and for the health surface. */
export interface OutboxHealth {
  pending: number;
  processing: number;
  failed: number;
  /** Age in seconds of the oldest row that is not yet published. Null when there is none. */
  oldestUnpublishedSeconds: number | null;
}

/**
 * Drains the transactional outbox.
 *
 * ## The claim is a LEASE, not a completion
 *
 * This is the whole design, and the previous version got it exactly backwards.
 * It claimed a row by writing its TERMINAL state --
 *
 *     update ... set status = 'published', published_at = now()   -- "claim"
 *     await this.publish(...)                                     -- the work
 *
 * -- which is a correct mutual exclusion and an incorrect claim. Two workers
 * never both took the row, and that is what the code was written for. But a
 * worker killed between those two statements (SIGKILL, OOM, eviction, a dropped
 * connection) left a row saying `published` that had been published to nobody.
 * Nothing looks for such a row, because its status is terminal and its
 * `published_at` is stamped: the event was not delayed, it was gone.
 *
 * Swapping the two statements does not fix it. It replaces a lost-event window
 * with an unbounded-duplicate window -- publish, crash before the status write,
 * re-read as pending, publish again, forever if the crash is deterministic.
 *
 * A lease has neither failure. Claiming moves the row to `processing` and
 * pushes `available_at` forward:
 *
 *     pending -----claim----> processing   available_at = now + lease
 *     processing --confirm--> published    (terminal; the work HAPPENED)
 *     processing --error----> pending (backoff) | failed (attempts exhausted)
 *     processing --CRASH----> nothing written; the lease expires and the row
 *                             becomes due again, for this worker or any other.
 *
 * A crash at any instant therefore lands on "already published" or "will be
 * reclaimed". There is no state that is both unpublished and unreachable.
 *
 * ## Which guarantee this is
 *
 * AT-LEAST-ONCE, and deliberately not called anything stronger. Crashing after
 * the publish but before the confirm republishes on reclaim, and no arrangement
 * of a database and a separate message bus can remove that window without a
 * distributed transaction across both. So the guarantee is paid for on the
 * consumer side, where it is cheap:
 *
 *   * realtime fan-out is idempotent by nature -- the client keys messages by
 *     id and merges, so a repeated emit changes nothing on screen;
 *   * notifications dedupe on the UNIQUE `dedupe_key`, so a repeated schedule
 *     resolves to the same row rather than a second push.
 *
 * ## Claiming under concurrency
 *
 * `for update skip locked` inside the claim: several workers draining at once
 * take disjoint batches instead of serialising on the same head rows.
 */
@Injectable()
export class OutboxWorker {
  private readonly log = new Logger(OutboxWorker.name);

  /**
   * Identifies this process in `claimed_by`. Diagnostics only -- the lease is
   * enforced by `available_at` and never by comparing this string, so a
   * duplicated or forged value cannot let a worker steal a live lease.
   */
  private readonly workerId = `${hostname()}/${process.pid}/${randomUUID().slice(0, 8)}`;

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationService,
    @Inject(REALTIME_PUBLISHER) private readonly realtime: RealtimePublisher,
    @Inject(IDENTITY_SERVICE) private readonly identity: IdentityService,
    private readonly config?: AppConfigService,
  ) {}

  async drain(batchSize = 100): Promise<number> {
    const [leaseSeconds, maxAttempts] = await Promise.all([
      this.setting('outbox.lease_seconds', 60),
      this.setting('outbox.max_attempts', 5),
    ]);

    const batch = await this.claim(batchSize, leaseSeconds);

    let published = 0;
    for (const event of batch) {
      if (event.reclaimed) {
        // The single most useful line in this file when something is wrong: it
        // names an event whose previous attempt neither succeeded nor reported
        // a failure, which is the signature of a worker that died holding it.
        this.log.warn(
          `outbox ${event.id} (${event.type}) reclaimed after an expired lease; ` +
            `attempt ${event.attempts}`,
        );
      }

      try {
        await this.publish(event.type as CommEventName, event.payload as Record<string, unknown>);
      } catch (err) {
        await this.release(event, err, maxAttempts);
        continue;
      }

      // ONLY here. The row becomes `published` after publication returned
      // successfully, and the guard on `status = 'processing'` means a lease
      // that expired mid-publish -- so that another worker already owns the row
      // -- does not let this one stamp it complete underneath them.
      const confirmed = await this.prisma.outboxEvent.updateMany({
        where: { id: event.id, status: 'processing', claimedBy: event.claimToken },
        data: {
          status: 'published',
          publishedAt: new Date(),
          claimedAt: null,
          claimedBy: null,
          lastError: null,
        },
      });
      if (confirmed.count === 0) {
        this.log.warn(
          `outbox ${event.id} published but its lease had already expired; ` +
            `another worker owns the row and may publish it again`,
        );
      }
      published += 1;
    }
    return published;
  }

  /**
   * Take a lease on up to `batchSize` due rows.
   *
   * Raw SQL rather than findMany-then-updateMany for three reasons, each of
   * which was a real defect in the previous version:
   *
   *  1. `returning` gives the POST-increment `attempts`. The old code read the
   *     row first and computed its backoff from the stale value, so every row
   *     backed off as though it were one attempt younger than it was.
   *  2. One statement instead of one-plus-N, on the hot path of every event.
   *  3. `for update skip locked` -- concurrent workers take disjoint batches.
   *
   * A row is due when it is `pending` and its backoff has elapsed, OR it is
   * `processing` and its LEASE has elapsed. The second disjunct is the recovery
   * path; without it the `processing` state would be a trap rather than a lease.
   */
  private async claim(batchSize: number, leaseSeconds: number): Promise<ClaimedEvent[]> {
    // Unique per claim, and prefixed with the worker so a stuck row still names
    // the process that wedged it.
    const claimToken = `${this.workerId}#${randomUUID()}`;
    const rows = await this.prisma.$queryRaw<
      Array<{
        id: string;
        type: string;
        payload: Prisma.JsonValue;
        attempts: number;
        claimed_by: string;
      }>
    >(Prisma.sql`
      update chat.outbox_event as o
         set status       = 'processing',
             attempts     = o.attempts + 1,
             claimed_at   = now(),
             claimed_by   = ${claimToken},
             available_at = now() + make_interval(secs => ${leaseSeconds}::double precision)
       where o.id in (
         select d.id
           from chat.outbox_event as d
          where d.status in ('pending', 'processing')
            and d.available_at <= now()
          order by d.created_at asc
            for update skip locked
          limit ${batchSize}
       )
      returning o.id, o.type, o.payload, o.attempts, o.claimed_by
    `);

    // A first claim comes back with attempts = 1. Anything higher means this row
    // has been attempted before -- either it reported a failure and backed off,
    // or a worker took it and never came back. Both are worth a line in the log;
    // the second is the one that used to be invisible.
    return rows.map((r) => ({
      id: r.id,
      type: r.type,
      payload: r.payload,
      attempts: r.attempts,
      claimToken,
      reclaimed: r.attempts > 1,
    }));
  }

  /**
   * Publication failed: return the row to the queue, or park it.
   *
   * Guarded on `status = 'processing'` for the same reason the confirm is: if
   * this worker's lease expired while it was publishing, the row belongs to
   * somebody else and this worker must not rewrite their claim.
   */
  private async release(event: ClaimedEvent, err: unknown, maxAttempts: number): Promise<void> {
    const exhausted = event.attempts >= maxAttempts;
    const backoffMs = Math.min(2 ** event.attempts * 5_000, 300_000);

    await this.prisma.outboxEvent.updateMany({
      where: { id: event.id, status: 'processing', claimedBy: event.claimToken },
      data: {
        status: exhausted ? 'failed' : 'pending',
        // Never a payload or a signed URL: the message it wraps is somebody's
        // private conversation, and this string is read by whoever reads logs.
        lastError: err instanceof Error ? err.message.slice(0, 500) : 'unknown',
        availableAt: new Date(Date.now() + backoffMs),
        publishedAt: null,
        claimedAt: null,
        claimedBy: null,
      },
    });

    if (exhausted) {
      this.log.error(
        `outbox ${event.id} (${event.type}) parked as failed after ${event.attempts} attempts`,
      );
    } else {
      this.log.warn(
        `outbox ${event.id} (${event.type}) failed to publish; ` +
          `attempt ${event.attempts}, retry in ${Math.round(backoffMs / 1000)}s`,
      );
    }
  }

  /**
   * What an operator needs to answer "why is this message stuck?" (§35).
   *
   * Counts and an age, never payloads. A drain that is keeping up shows a
   * near-zero `oldestUnpublishedSeconds`; a wedged one shows it climbing, and
   * `processing` sitting above zero across two samples means leases are being
   * taken and never confirmed.
   */
  async stuckReport(): Promise<OutboxHealth> {
    const [counts] = await this.prisma.$queryRaw<
      Array<{ pending: bigint; processing: bigint; failed: bigint; oldest: number | null }>
    >(Prisma.sql`
      select
        count(*) filter (where status = 'pending')    as pending,
        count(*) filter (where status = 'processing') as processing,
        count(*) filter (where status = 'failed')     as failed,
        extract(epoch from (now() - min(created_at)
          filter (where status <> 'published')))::double precision as oldest
      from chat.outbox_event
    `);

    return {
      pending: Number(counts?.pending ?? 0),
      processing: Number(counts?.processing ?? 0),
      failed: Number(counts?.failed ?? 0),
      oldestUnpublishedSeconds: counts?.oldest == null ? null : Math.round(counts.oldest),
    };
  }

  private async setting(key: string, fallback: number): Promise<number> {
    if (!this.config) return fallback;
    const value = await this.config.get(key as never);
    return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
  }

  private async publish(type: CommEventName, payload: Record<string, unknown>): Promise<void> {
    const conversationId = payload.conversationId as string | undefined;

    switch (type) {
      case CommEvent.MESSAGE_CREATED: {
        if (!conversationId) return;
        // Internal notes are broadcast only to staff rooms, never to the
        // conversation room where a parent is listening.
        if (payload.visibility === Visibility.INTERNAL) {
          const staff = await this.staffMemberIds(conversationId);
          await this.realtime.toUsers(staff, type, payload as never);
        } else {
          await this.realtime.toThread(conversationId, type, payload as never);
        }
        await this.notifyNewMessage(conversationId, payload);
        return;
      }

      // Every other event ABOUT ONE MESSAGE inherits that message's audience.
      //
      // message.created already did; these did not, and fell through to a
      // broadcast on the conversation room. For an internal note that is a
      // leak: a contact listening on the room would learn the id of a message
      // they may not read, that somebody read it and when, that it was edited,
      // and who reacted to it. Reading the visibility from the message is one
      // query per event, on a path that already does several.
      case CommEvent.MESSAGE_UPDATED:
      case CommEvent.MESSAGE_DELETED:
      case CommEvent.MESSAGE_RECEIPT_UPDATED:
      case CommEvent.REACTION_ADDED:
      case CommEvent.REACTION_REMOVED: {
        if (!conversationId) return;
        const visibility = await this.messageVisibility(payload.messageId as string);
        if (visibility === Visibility.INTERNAL) {
          const staff = await this.staffMemberIds(conversationId);
          await this.realtime.toUsers(staff, type, payload as never);
        } else {
          await this.realtime.toThread(conversationId, type, payload as never);
        }
        return;
      }

      case CommEvent.APPROVAL_REQUESTED: {
        if (!conversationId) return;
        // Never broadcast to the group: only staff who may decide see it.
        const staff = await this.staffMemberIds(conversationId);
        await this.realtime.toUsers(staff, type, payload as never);
        return;
      }

      case CommEvent.APPROVAL_DECIDED: {
        if (!conversationId) return;
        await this.realtime.toThread(conversationId, type, payload as never);
        return;
      }

      case CommEvent.CALL_INCOMING: {
        if (!conversationId) return;
        await this.realtime.toThread(conversationId, type, payload as never);
        await this.notifyIncomingCall(conversationId, payload);
        return;
      }

      default: {
        if (conversationId) {
          await this.realtime.toThread(conversationId, type, payload as never);
        }
      }
    }
  }

  /** The audience rule for a message-scoped event, read from the message. */
  private async messageVisibility(messageId: string | undefined): Promise<string> {
    if (!messageId) return Visibility.INTERNAL;
    const row = await this.prisma.message.findUnique({
      where: { id: messageId },
      select: { visibility: true },
    });
    // A message that has vanished is treated as internal: the safe direction
    // for an unknown audience is the narrower one.
    return row?.visibility ?? Visibility.INTERNAL;
  }

  private async staffMemberIds(conversationId: string): Promise<string[]> {
    const members = await this.prisma.conversationMember.findMany({
      where: { conversationId, leftAt: null, actorKind: ActorKind.STAFF },
      select: { actorId: true },
    });
    return members.map((m) => m.actorId);
  }

  /** Fan out a push for a published customer-visible message. */
  private async notifyNewMessage(
    conversationId: string,
    payload: Record<string, unknown>,
  ): Promise<void> {
    if (payload.visibility === Visibility.INTERNAL) return;

    const authorId = payload.authorId as string | null;
    const members = await this.prisma.conversationMember.findMany({
      where: { conversationId, leftAt: null },
    });
    const author = authorId ? await this.identity.resolveActor(authorId) : null;

    const state = await this.prisma.conversationParticipantState.findMany({
      where: { conversationId },
    });
    const mutedUntil = new Map(state.map((s) => [s.actorId, s.mutedUntil]));
    const now = new Date();

    for (const m of members) {
      if (m.actorId === authorId) continue;
      const muted = mutedUntil.get(m.actorId);
      if (muted && muted > now) continue;

      const recipient = await this.identity.resolveActor(m.actorId);
      if (!recipient || !recipient.isActive) continue;

      await this.notifications.schedule({
        // One notification per message per recipient, forever.
        dedupeKey: `new_message:${payload.messageId as string}:${m.actorId}`,
        ruleKey: 'new_message',
        templateKey: 'new_message',
        eventType: 'message_published',
        recipientId: m.actorId,
        locale: recipient.locale,
        conversationId,
        variables: {
          sender_name: author?.displayName ?? 'Jawwid',
          preview: '',
        },
        scheduledAt: now,
      });
    }
  }

  /**
   * Ring the other participants.
   *
   * A call is the one notification that must NOT be suppressed by a
   * conversation mute or by quiet hours. Muting a conversation says "stop
   * buzzing me about messages in it"; it has never said "and let calls from my
   * child's teacher fail silently", and conflating the two is how somebody
   * misses the call that mattered. `respectQuietHours: false` states that
   * explicitly rather than relying on the default.
   */
  private async notifyIncomingCall(
    conversationId: string,
    payload: Record<string, unknown>,
  ): Promise<void> {
    const callId = payload.callId as string | undefined;
    const initiatorId = (payload.initiatorId ?? payload.actorId) as string | undefined;
    if (!callId) return;

    const members = await this.prisma.conversationMember.findMany({
      where: { conversationId, leftAt: null },
      select: { actorId: true },
    });
    const initiator = initiatorId ? await this.identity.resolveActor(initiatorId) : null;
    const now = new Date();

    for (const m of members) {
      if (m.actorId === initiatorId) continue;
      const recipient = await this.identity.resolveActor(m.actorId);
      if (!recipient || !recipient.isActive) continue;

      await this.notifications.schedule({
        dedupeKey: `incoming_call:${callId}:${m.actorId}`,
        ruleKey: 'incoming_call',
        templateKey: 'incoming_call',
        eventType: 'call_incoming',
        recipientId: m.actorId,
        locale: recipient.locale,
        conversationId,
        priority: 'critical',
        respectQuietHours: false,
        variables: {
          caller_name: initiator?.displayName ?? 'Jawwid',
          call_id: callId,
        },
        scheduledAt: now,
      });
    }
  }
}
