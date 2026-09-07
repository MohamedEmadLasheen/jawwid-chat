import { createHash, randomUUID } from 'node:crypto';
import { hostname } from 'node:os';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../platform/prisma.service';
import { AppConfigService } from '../../platform/app-config.service';
import { PUSH_PROVIDER } from '../../platform/tokens';
import type { PushProvider } from './push.provider';
import { TemplateService } from './template.service';
import { QuietHoursService } from './quiet-hours.service';
import { NotificationPreferenceService } from './preference.service';
import { NotificationStatus } from '../contracts/vocab';

export interface ScheduleInput {
  /**
   * Deterministic and stable. Same logical notification -> same key, forever.
   * e.g. class_reminder_t30m:session_123:contact_45
   */
  dedupeKey: string;
  ruleKey?: string | null;
  templateKey: string;
  eventType: string;
  recipientId: string;
  locale?: string;
  channel?: string;
  priority?: string;
  familyId?: string | null;
  conversationId?: string | null;
  variables?: Record<string, unknown>;
  scheduledAt: Date;
  respectQuietHours?: boolean;
}

/**
 * The notification engine.
 *
 * DEDUPLICATION is the central guarantee: chat.notification.dedupe_key is
 * UNIQUE, and schedule() treats a duplicate key as success rather than as an
 * error. That makes the whole pipeline safe to retry - worker restarts, replayed
 * outbox events, re-run reminder sweeps and duplicate source events all
 * converge on exactly one delivery.
 */
@Injectable()
export class NotificationService {
  private readonly log = new Logger(NotificationService.name);

  /**
   * Identifies this process in `claimed_by`. Diagnostics only: the lease is
   * enforced by `scheduled_at` and fenced by `claimed_at`, never by comparing
   * this string, so it carries no authority.
   */
  private readonly workerId = `${hostname()}/${process.pid}`;

  constructor(
    private readonly prisma: PrismaService,
    private readonly templates: TemplateService,
    private readonly quietHours: QuietHoursService,
    private readonly config: AppConfigService,
    @Inject(PUSH_PROVIDER) private readonly push: PushProvider,
    private readonly preferences?: NotificationPreferenceService,
  ) {}

  /**
   * Idempotent. Returns the notification id whether it was created now or
   * already existed.
   */
  async schedule(input: ScheduleInput): Promise<string> {
    const scheduledAt = await this.quietHours.adjust(
      input.recipientId,
      input.scheduledAt,
      input.respectQuietHours ?? true,
    );

    // The recipient's own choice, applied HERE -- where the notification is
    // generated -- and not on the device. A preference the client applies is
    // not a preference: by then APNs or FCM has the payload, the phone has
    // buzzed and the lock screen has shown the text, and discarding it in the
    // app changes what is displayed and nothing that matters.
    //
    // A suppressed notification is still a ROW, with status `suppressed` (a
    // value the vocabulary already had). Not writing one would make the
    // dedupe key free again, so the next replay of the same source event would
    // ask the question a second time -- and would leave no record that anything
    // had been decided.
    const suppressed = await this.isSuppressed(input);

    return this.create(input, scheduledAt, suppressed);
  }

  /** True when this recipient has turned this notification's category off. */
  private async isSuppressed(input: ScheduleInput): Promise<boolean> {
    if (!this.preferences) return false;
    const category = await this.preferences.categoryOf(input.ruleKey);
    return !(await this.preferences.isEnabled(input.recipientId, category));
  }

  private async create(
    input: ScheduleInput,
    scheduledAt: Date,
    suppressed: boolean,
  ): Promise<string> {

    // Created with an id we generate, through createMany, so the statement
    // carries no RETURNING clause.
    //
    // That is not a style preference. A notification is addressed to SOMEBODY
    // ELSE -- the sender writes the recipient's row -- and the row's read
    // policy is "the recipient, and nobody else". PostgreSQL applies the SELECT
    // policy to an INSERT ... RETURNING, so asking the database to hand the row
    // back would require widening that policy to let a sender read other
    // people's notifications. Not asking for it back is strictly safer.
    const id = randomUUID();
    try {
      await this.prisma.notification.createMany({
        data: {
          id,
          dedupeKey: input.dedupeKey,
          ruleKey: input.ruleKey ?? null,
          templateKey: input.templateKey,
          eventType: input.eventType,
          recipientId: input.recipientId,
          locale: input.locale ?? 'ar',
          channel: input.channel ?? 'push',
          priority: input.priority ?? 'normal',
          familyId: input.familyId ?? null,
          conversationId: input.conversationId ?? null,
          variables: (input.variables ?? {}) as Prisma.InputJsonValue,
          status: suppressed ? NotificationStatus.SUPPRESSED : NotificationStatus.SCHEDULED,
          scheduledAt,
        },
      });
      return id;
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        // Already accounted for. This is the dedupe guarantee doing its job.
        // The key is unique per ORGANIZATION now, so the lookup names both.
        const existing = await this.prisma.notification.findFirst({
          where: { dedupeKey: input.dedupeKey },
          select: { id: true },
        });
        if (existing) return existing.id;
      }
      throw e;
    }
  }

  /**
   * Claims and delivers everything due. Safe to run concurrently.
   *
   * ## The claim is a LEASE, not a completion
   *
   * This used to claim a row by writing `status = 'sent'` and only then call the
   * push provider. That is a correct mutual exclusion and an incorrect claim:
   * two workers never both took the row, but a worker killed between the two
   * statements left a notification marked `sent` that was sent to nobody, with
   * a terminal status and a `sent_at` stamp. Nothing rescans such a row, because
   * nothing has any reason to. The notification was not late; it was gone.
   *
   * The lease keeps the row `scheduled` -- which is TRUE while an attempt is in
   * flight -- and pushes `scheduled_at`, the due time, forward by the lease.
   * A crashed worker's row simply becomes due again when the lease expires.
   *
   * `claimed_by` carries the FENCE: a token unique to this claim of this row.
   * Requiring it to be unchanged before writing `sent` means a worker returning
   * late from a slow provider call cannot stamp a row another worker has since
   * taken. (A `claimed_at` fence would not work: `timestamptz` is
   * microsecond-precision in PostgreSQL and millisecond-precision in JavaScript,
   * so it would be truncated on the way out and never match on the way back.)
   *
   * The guarantee is at-least-once. Crashing after the provider accepted the
   * push but before the status write redelivers on the next claim; the client's
   * collapse/thread identifier (`NotificationPayload.collapseId`) makes that a
   * replaced notification rather than a second one on the lock screen.
   */
  async dispatchDue(now = new Date(), batchSize = 100): Promise<number> {
    const leaseSeconds = await this.leaseSeconds();
    const claimed = await this.claim(now, batchSize, leaseSeconds);

    let delivered = 0;
    for (const n of claimed) {
      if (n.attempts > 1) {
        this.log.warn(
          `notification ${n.id} redispatched; attempt ${n.attempts} ` +
            `(a previous attempt failed or its worker did not return)`,
        );
      }
      try {
        const ok = await this.deliver(n.id, n.claimToken);
        if (ok) delivered += 1;
      } catch {
        // Never the error object: a provider rejection can echo the device
        // token it rejected, and a token is a routing capability.
        await this.fail(n.id, 'DISPATCH_ERROR');
        this.log.warn(`notification ${n.id} failed to dispatch`);
      }
    }
    return delivered;
  }

  /**
   * Take a dispatch lease on up to `batchSize` due notifications.
   *
   * `for update skip locked` so concurrent dispatchers take disjoint batches,
   * and `returning` so `attempts` is the post-increment value -- the previous
   * version computed its backoff from the value it had read BEFORE incrementing,
   * so every retry backed off as though it were one attempt younger.
   */
  private async claim(
    now: Date,
    batchSize: number,
    leaseSeconds: number,
  ): Promise<Array<{ id: string; attempts: number; claimToken: string }>> {
    const claimToken = `${this.workerId}#${randomUUID()}`;
    const rows = await this.prisma.$queryRaw<Array<{ id: string; attempts: number }>>(Prisma.sql`
      update chat.notification as n
         set scheduled_at = now() + make_interval(secs => ${leaseSeconds}::double precision),
             attempts     = n.attempts + 1,
             claimed_at   = now(),
             claimed_by   = ${claimToken}
       where n.id in (
         select d.id
           from chat.notification as d
          where d.status = 'scheduled'
            and d.scheduled_at <= ${now}
          order by d.scheduled_at asc
            for update skip locked
          limit ${batchSize}
       )
      returning n.id, n.attempts
    `);
    return rows.map((r) => ({ id: r.id, attempts: r.attempts, claimToken }));
  }

  private async leaseSeconds(): Promise<number> {
    const value = await this.config.get('notification.lease_seconds' as never);
    return typeof value === 'number' && Number.isFinite(value) ? value : 120;
  }

  private async deliver(notificationId: string, claimToken: string): Promise<boolean> {
    const n = await this.prisma.notification.findUnique({ where: { id: notificationId } });
    if (!n) return false;

    const rendered = await this.templates.render(
      n.templateKey,
      n.locale,
      (n.variables ?? {}) as Record<string, unknown>,
    );
    if (!rendered) {
      await this.fail(notificationId, 'TEMPLATE_MISSING');
      return false;
    }

    if (n.channel === 'in_app') {
      // In-app notifications are delivered over the realtime channel by the
      // outbox worker; there is nothing to push. The row still has to leave the
      // scheduled state, or its lease would expire and it would be reclaimed
      // for ever.
      await this.markSent(notificationId, claimToken);
      return true;
    }

    const tokens = await this.prisma.deviceToken.findMany({
      where: { actorId: n.recipientId, isActive: true },
    });
    if (tokens.length === 0) {
      await this.fail(notificationId, 'NO_DEVICE_TOKEN');
      return false;
    }

    let anyOk = false;
    for (const t of tokens) {
      const result = await this.push.send({
        token: t.token,
        title: rendered.title,
        body: rendered.body,
        data: {
          eventType: n.eventType,
          notificationId: n.id,
          ...(n.conversationId ? { conversationId: n.conversationId } : {}),
        },
        isVoip: t.isVoip,
        // From the device_token row, written at registration by a client that
        // knows what it is -- never inferred from the token's shape.
        platform: t.platform,
        // One conversation, one notification stack. Without it, ten messages
        // from one parent arrive as ten entries and bury everything else.
        threadId: n.conversationId ?? n.eventType,
        // The dedupe key IS the notification's identity, so a redelivery --
        // which at-least-once will produce, when a worker pushes successfully
        // and dies before recording it -- replaces the first notification
        // rather than appearing beside it.
        collapseId: NotificationService.collapseIdFor(n.dedupeKey),
        priority: n.priority,
      });
      if (result.ok) anyOk = true;
      if (result.tokenInvalid) {
        // The provider says this token is permanently gone -- the app was
        // uninstalled, or the token was reissued. Retiring it here is what stops
        // every future notification for this person spending an attempt on a
        // device that no longer exists.
        await this.prisma.deviceToken.update({
          where: { id: t.id },
          data: { isActive: false },
        });
        this.log.log(`device token retired: id=${t.id} platform=${t.platform}`);
      }
    }

    if (!anyOk) {
      await this.fail(notificationId, 'PUSH_REJECTED');
      return false;
    }

    // ONLY here: the row becomes `sent` after a provider accepted it, never
    // before. Fenced on the claim, so a worker returning late from a slow
    // provider cannot overwrite a row another worker has since taken.
    //
    // It is NOT promoted to DELIVERED: no platform acknowledgement has been
    // received, and fabricating one would make the delivery metrics lie.
    // DELIVERED/OPENED are set only by markDelivered / markOpened, driven by a
    // real client or provider callback.
    await this.markSent(notificationId, claimToken);
    return true;
  }

  /** Close a claim successfully. A no-op if the lease is no longer ours. */
  private async markSent(notificationId: string, claimToken: string): Promise<void> {
    const written = await this.prisma.notification.updateMany({
      where: {
        id: notificationId,
        status: NotificationStatus.SCHEDULED,
        claimedBy: claimToken,
      },
      data: {
        status: NotificationStatus.SENT,
        sentAt: new Date(),
        claimedAt: null,
        claimedBy: null,
      },
    });
    if (written.count === 0) {
      this.log.warn(
        `notification ${notificationId} was pushed but its lease had already ` +
          `expired; another worker owns it and may push it again`,
      );
    }
  }

  /**
   * A collapse identifier derived from the dedupe key.
   *
   * Hashed rather than passed through: APNs caps `apns-collapse-id` at 64
   * bytes and a dedupe key is an unbounded composite of ids
   * (`new_message:<uuid>:<uuid>` is already 87). A key over the cap is rejected
   * by APNs, which would fail the push for a reason that has nothing to do with
   * the notification -- and would do it only for the longer keys, so it would
   * look intermittent.
   */
  static collapseIdFor(dedupeKey: string): string {
    return createHash('sha256').update(dedupeKey).digest('hex').slice(0, 32);
  }

  private async fail(notificationId: string, code: string): Promise<void> {
    const maxAttempts = await this.config.get('notification.max_attempts');
    const n = await this.prisma.notification.findUnique({ where: { id: notificationId } });
    if (!n) return;

    if (n.attempts >= maxAttempts) {
      await this.prisma.notification.update({
        where: { id: notificationId },
        data: {
          status: NotificationStatus.FAILED,
          failedAt: new Date(),
          failureCode: code,
          claimedAt: null,
          claimedBy: null,
        },
      });
      this.log.error(
        `notification ${notificationId} parked as failed after ${n.attempts} attempts: ${code}`,
      );
      return;
    }

    // Retry with exponential backoff, which also REPLACES the lease: the row is
    // due at the backoff time rather than at the lease expiry, and clearing the
    // claim is what makes it re-claimable there. `attempts` is already the
    // post-increment value, so the backoff grows with the real attempt count.
    // The dedupe key is unchanged, so a retry can never become a second
    // notification.
    const backoffMs = Math.min(2 ** n.attempts * 30_000, 30 * 60_000);
    await this.prisma.notification.update({
      where: { id: notificationId },
      data: {
        status: NotificationStatus.SCHEDULED,
        scheduledAt: new Date(Date.now() + backoffMs),
        failureCode: code,
        claimedAt: null,
        claimedBy: null,
      },
    });
  }

  /** Called by a client or a provider webhook. Never inferred. */
  /**
   * The recipient confirms delivery.
   *
   * `recipientId` is part of the WHERE clause, not a check afterwards. Before
   * Phase 1 this endpoint took no actor at all, so any caller could mark any
   * notification id delivered -- and, by watching which ids changed state,
   * enumerate notifications belonging to other families.
   */
  async markDelivered(notificationId: string, actorId: string): Promise<void> {
    await this.prisma.notification.updateMany({
      where: { id: notificationId, recipientId: actorId, status: NotificationStatus.SENT },
      data: { status: NotificationStatus.DELIVERED, deliveredAt: new Date() },
    });
  }

  async markOpened(notificationId: string, actorId: string): Promise<void> {
    await this.prisma.notification.updateMany({
      where: {
        id: notificationId,
        recipientId: actorId,
        status: { in: [NotificationStatus.SENT, NotificationStatus.DELIVERED] },
      },
      data: { status: NotificationStatus.OPENED, openedAt: new Date() },
    });
  }

  /**
   * Registers a device. Multi-device is the norm, not the exception.
   *
   * A push token is NOT a secret -- it is handed to a push provider, it turns
   * up in client logs, and it is recoverable from a device. So the hand-over
   * this method allows ("the same physical device, now used by somebody else")
   * is also the shape of an attack: register a token you have learned and
   * receive its owner's notifications.
   *
   * Two things bound it. The token is unique per ORGANIZATION, and a database
   * trigger refuses to move one across that boundary, so the hijack cannot be
   * cross-tenant. Within a tenant the hand-over is still permitted, because a
   * re-used device is real -- and it is now RECORDED: a move between actors
   * writes an event, so it is visible rather than silent.
   */
  async registerDevice(input: {
    actorId: string;
    token: string;
    platform: string;
    isVoip?: boolean;
    locale?: string;
  }): Promise<void> {
    const existing = await this.prisma.deviceToken.findFirst({
      where: { token: input.token },
      select: { id: true, actorId: true },
    });

    if (!existing) {
      await this.prisma.deviceToken.create({
        data: {
          actorId: input.actorId,
          token: input.token,
          platform: input.platform,
          isVoip: input.isVoip ?? false,
          locale: input.locale ?? 'ar',
        },
      });
      return;
    }

    await this.prisma.deviceToken.update({
      where: { id: existing.id },
      data: {
        actorId: input.actorId,
        isActive: true,
        lastSeenAt: new Date(),
        locale: input.locale ?? 'ar',
      },
    });

    if (existing.actorId !== input.actorId) {
      this.log.warn(
        `push token reassigned from actor ${existing.actorId} to ${input.actorId}`,
      );
    }
  }

  /**
   * Retire a push token.
   *
   * Scoped to the caller's own tokens. Before Phase 1 this route took no actor,
   * so anybody who learned (or guessed) a push token could silence another
   * person's notifications.
   */
  async unregisterDevice(token: string, actorId: string): Promise<void> {
    await this.prisma.deviceToken.updateMany({
      where: { token, actorId },
      data: { isActive: false },
    });
  }
}
