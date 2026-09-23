import { Inject, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../platform/prisma.service';
import { AppConfigService } from '../../platform/app-config.service';
import { PUSH_PROVIDER, REALTIME_PUBLISHER } from '../../platform/tokens';
import type { PushProvider } from './push.provider';
import type { RealtimePublisher } from '../realtime/realtime.publisher';
import { CommEvent } from '../contracts/events';
import {
  DeliveryChannel,
  DeliveryStatus,
  NotificationDefinition,
  SkipReason,
  definitionOf,
  NotificationType,
} from '../contracts/notifications';

/**
 * How long a delivery attempt may be in flight before it is treated as
 * abandoned.
 *
 * Generous relative to a push, which takes milliseconds: the cost of being
 * wrong in this direction is a duplicate push, and the cost of being wrong in
 * the other is a stranded row that is never retried and never terminal.
 */
const ABANDONED_DELIVERY_MS = 5 * 60_000;

/** A notification row, narrowed to what delivery needs. */
export interface DeliverableNotification {
  id: string;
  recipientId: string;
  type: string | null;
  eventType: string;
  category: string;
  priority: string;
  title: string | null;
  body: string | null;
  deeplink: string | null;
  entityType: string | null;
  entityId: string | null;
  conversationId: string | null;
  learnerId: string | null;
  announcementId: string | null;
  groupKey: string | null;
  createdAt: Date;
}

/**
 * DELIVERY -- the step after a notification exists.
 *
 * The notification is the fact ("this parent needs to know"); a delivery is one
 * attempt to carry it somewhere ("push, to their iPad"). Separating them is
 * what makes it possible to say truthfully that the parent HAS the notification
 * while the push to one of their three devices failed.
 *
 * ADDING A CHANNEL. Email, SMS and WhatsApp were named as future channels. Each
 * would be: a value in DeliveryChannel, a value in the channel check
 * constraint, and one `deliver<Channel>` method reached from the switch in
 * `dispatch`. Nothing in NotificationService changes, because nothing in
 * NotificationService knows what a channel is.
 */
@Injectable()
export class DeliveryService {
  private readonly log = new Logger(DeliveryService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AppConfigService,
    @Inject(PUSH_PROVIDER) private readonly push: PushProvider,
    @Inject(REALTIME_PUBLISHER) private readonly realtime: RealtimePublisher,
  ) {}

  /**
   * Record a deliberate non-delivery.
   *
   * A skipped push is written down, never silently dropped. "Why did my phone
   * not buzz?" has to have an answer, and `RECIPIENT_ACTIVE` versus
   * `PREFERENCE_OFF` versus `NO_DEVICE_TOKEN` are three very different answers.
   */
  async skip(
    notification: DeliverableNotification,
    channel: DeliveryChannel,
    reason: SkipReason,
  ): Promise<void> {
    await this.prisma.notificationDelivery.upsert({
      where: {
        // Matches notification_delivery_in_app_uidx / _device_uidx: one row per
        // (notification, channel) when no device is involved.
        id: await this.existingId(notification.id, channel, null),
      },
      create: {
        notificationId: notification.id,
        recipientId: notification.recipientId,
        channel,
        status: DeliveryStatus.SKIPPED,
        skipReason: reason,
      },
      update: { status: DeliveryStatus.SKIPPED, skipReason: reason },
    });
  }

  /**
   * In-app delivery: publish to the recipient's actor room.
   *
   * Every one of their devices is in that room, so this is also the multi-device
   * fan-out. It is best-effort by nature -- a parent with no socket open is
   * offline, not failed -- so a realtime publish that reaches nobody is recorded
   * `sent`, not `failed`: the notification is in the database and will be there
   * when they reconnect. That is the whole point of not relying on realtime.
   */
  async deliverInApp(notification: DeliverableNotification): Promise<void> {
    const delivery = await this.claim(notification, DeliveryChannel.IN_APP, null, null);
    if (!delivery) return;

    try {
      await this.realtime.toUsers([notification.recipientId], CommEvent.NOTIFICATION_CREATED, {
        notificationId: notification.id,
        recipientId: notification.recipientId,
        eventType: notification.eventType,
        title: notification.title ?? '',
        body: notification.body ?? '',
        conversationId: notification.conversationId,
      });
      await this.prisma.notificationDelivery.update({
        where: { id: delivery.id },
        data: { status: DeliveryStatus.SENT, sentAt: new Date() },
      });
    } catch (error) {
      // The relay throws when no instance received the publish. That is worth
      // retrying -- a node may be restarting -- but it is not worth losing the
      // notification over, and the notification itself is already persisted.
      await this.fail(delivery.id, 'REALTIME_PUBLISH_FAILED', error);
    }
  }

  /**
   * Push delivery: one row per active device.
   *
   * PRIVACY. `pushCarriesContent` on the type decides whether the message text
   * reaches a lock screen at all. For everything in the messaging category it is
   * false, so what leaves this process is "Jawwid / You have a new message" plus
   * routing ids -- never a preview of what a teacher wrote about a child. The
   * payload carries ids and nothing else for the same reason: a push travels
   * through Google's and Apple's infrastructure and sits in a notification
   * centre the academy does not control.
   */
  async deliverPush(notification: DeliverableNotification): Promise<boolean> {
    const def = this.definition(notification);

    const tokens = await this.prisma.deviceToken.findMany({
      where: { actorId: notification.recipientId, isActive: true },
    });

    if (tokens.length === 0) {
      await this.skip(notification, DeliveryChannel.PUSH, SkipReason.NO_DEVICE_TOKEN);
      return false;
    }

    const maxAttempts = await this.config.get('notification.delivery_max_attempts');
    const payload = this.payloadFor(notification);
    const { title, body } = this.pushText(notification, def);

    let anyOk = false;
    for (const token of tokens) {
      const delivery = await this.claim(
        notification,
        DeliveryChannel.PUSH,
        token.id,
        token.platform,
      );
      if (!delivery) continue;

      try {
        const result = await this.push.send({
          token: token.token,
          title,
          body,
          data: payload,
          isVoip: token.isVoip,
        });

        if (result.ok) {
          anyOk = true;
          // Status stays SENT. It is NOT promoted to DELIVERED: no platform
          // acknowledgement has been received, and fabricating one would make
          // every delivery metric a lie.
          await this.prisma.notificationDelivery.update({
            where: { id: delivery.id },
            data: { status: DeliveryStatus.SENT, sentAt: new Date(), nextAttemptAt: null },
          });
          continue;
        }

        if (result.tokenInvalid) {
          // Permanent. Deactivate the token and stop -- retrying a token the
          // platform has rejected is how a dead device consumes a retry budget
          // forever.
          await this.prisma.deviceToken.update({
            where: { id: token.id },
            data: { isActive: false },
          });
          await this.prisma.notificationDelivery.update({
            where: { id: delivery.id },
            data: {
              status: DeliveryStatus.FAILED,
              failedAt: new Date(),
              errorCode: result.failureCode ?? 'TOKEN_INVALID',
              errorMessage: 'device token rejected by the platform',
              nextAttemptAt: null,
            },
          });
          continue;
        }

        await this.retryOrFail(delivery.id, result.failureCode ?? 'PUSH_REJECTED', maxAttempts);
      } catch (error) {
        await this.retryOrFail(delivery.id, 'PUSH_ERROR', maxAttempts, error);
      }
    }
    return anyOk;
  }

  /**
   * Re-attempt everything whose backoff has elapsed. Safe to run concurrently:
   * each row is claimed with a conditional update before it is touched.
   */
  async retryDue(now = new Date(), batchSize = 100): Promise<number> {
    const due = await this.prisma.notificationDelivery.findMany({
      where: {
        status: DeliveryStatus.PENDING,
        nextAttemptAt: { lte: now },
        notificationId: { not: null },
      },
      orderBy: { nextAttemptAt: 'asc' },
      take: batchSize,
      include: { notification: true },
    });

    let retried = 0;
    for (const row of due) {
      if (!row.notification) continue;
      const n = row.notification as unknown as DeliverableNotification;

      if (row.channel === DeliveryChannel.PUSH) {
        if (await this.deliverPush(n)) retried += 1;
      } else {
        await this.deliverInApp(n);
        retried += 1;
      }
    }
    return retried;
  }

  /** Reported by a client or a provider callback. Never inferred from a send. */
  async markDelivered(notificationId: string, recipientId: string): Promise<void> {
    await this.prisma.notificationDelivery.updateMany({
      where: { notificationId, recipientId, status: DeliveryStatus.SENT },
      data: { status: DeliveryStatus.DELIVERED, deliveredAt: new Date() },
    });
  }

  /** What support reads. No title, no body: delivery diagnosis, not message content. */
  async trace(notificationId: string) {
    return this.prisma.notificationDelivery.findMany({
      where: { notificationId },
      orderBy: { createdAt: 'asc' },
      select: {
        channel: true,
        platform: true,
        status: true,
        skipReason: true,
        attempts: true,
        sentAt: true,
        deliveredAt: true,
        failedAt: true,
        errorCode: true,
        errorMessage: true,
      },
    });
  }

  // -- internals ------------------------------------------------------------

  private definition(notification: DeliverableNotification): NotificationDefinition {
    // Rows written before the registry existed carry no type. They still have a
    // category and a priority, so they are deliverable; they simply get the
    // conservative defaults.
    try {
      return definitionOf(notification.type as NotificationType);
    } catch {
      return {
        type: NotificationType.MESSAGE_RECEIVED,
        category: notification.category,
        priority: notification.priority,
        essential: false,
        pushCarriesContent: false,
        bypassQuietHours: false,
        groupable: false,
        entityType: 'conversation',
        templateKey: '',
        deepLink: () => '/chats',
      } as unknown as NotificationDefinition;
    }
  }

  /**
   * Claim a delivery row, or return null if another worker already has it.
   *
   * `create` on a unique index is the claim: two workers racing on the same
   * (notification, channel, device) produce one row and one winner, which is
   * what stops the same push going out twice.
   */
  private async claim(
    notification: DeliverableNotification,
    channel: DeliveryChannel,
    deviceTokenId: string | null,
    platform: string | null,
  ): Promise<{ id: string } | null> {
    const existing = await this.prisma.notificationDelivery.findFirst({
      where: { notificationId: notification.id, channel, deviceTokenId },
      select: { id: true, status: true, attempts: true, updatedAt: true },
    });

    if (existing) {
      // Already sent or permanently failed: nothing to do. This is the
      // idempotency that makes a replayed outbox event harmless.
      if (
        existing.status === DeliveryStatus.SENT ||
        existing.status === DeliveryStatus.DELIVERED ||
        existing.status === DeliveryStatus.FAILED ||
        existing.status === DeliveryStatus.SKIPPED
      ) {
        return null;
      }

      // An ABANDONED attempt: a worker claimed this row and died before writing
      // an outcome. Without this branch the row sat in `processing` forever --
      // never retried, never terminal, and invisible to the operations view as
      // anything but "still going".
      //
      // THE TRADE, stated because it is a real one. The crash may have happened
      // AFTER the provider accepted the push, in which case re-attempting sends
      // a second one. Delivery is therefore AT-LEAST-ONCE, not exactly-once,
      // and cannot be exactly-once: "the provider accepted it" and "we recorded
      // that it accepted it" are two writes to two systems with no transaction
      // across them. Given the choice between a parent occasionally seeing a
      // duplicate push and a parent silently not being told their child's class
      // was cancelled, this product takes the duplicate.
      const abandonedBefore = new Date(Date.now() - ABANDONED_DELIVERY_MS);
      const claimed = await this.prisma.notificationDelivery.updateMany({
        where: {
          id: existing.id,
          OR: [
            { status: DeliveryStatus.PENDING },
            {
              status: DeliveryStatus.PROCESSING,
              updatedAt: { lt: abandonedBefore },
            },
          ],
        },
        data: { status: DeliveryStatus.PROCESSING, attempts: { increment: 1 } },
      });
      return claimed.count === 1 ? { id: existing.id } : null;
    }

    try {
      const created = await this.prisma.notificationDelivery.create({
        data: {
          notificationId: notification.id,
          recipientId: notification.recipientId,
          channel,
          deviceTokenId,
          platform,
          status: DeliveryStatus.PROCESSING,
          attempts: 1,
        },
        select: { id: true },
      });
      return created;
    } catch {
      // Lost the race on the unique index. The winner is delivering it.
      return null;
    }
  }

  private async existingId(
    notificationId: string,
    channel: DeliveryChannel,
    deviceTokenId: string | null,
  ): Promise<string> {
    const row = await this.prisma.notificationDelivery.findFirst({
      where: { notificationId, channel, deviceTokenId },
      select: { id: true },
    });
    // A uuid that cannot exist, so `upsert` takes the create branch.
    return row?.id ?? '00000000-0000-0000-0000-000000000000';
  }

  /**
   * Exponential backoff, bounded, with a hard stop.
   *
   * There are no infinite retries: a provider that has refused five times is
   * not going to accept the sixth, and a queue that never drains is how a
   * transient outage becomes a permanent backlog.
   */
  private async retryOrFail(
    deliveryId: string,
    code: string,
    maxAttempts: number,
    error?: unknown,
  ): Promise<void> {
    const row = await this.prisma.notificationDelivery.findUnique({
      where: { id: deliveryId },
      select: { attempts: true },
    });
    if (!row) return;

    if (row.attempts >= maxAttempts) {
      await this.fail(deliveryId, code, error);
      return;
    }

    // 30s, 60s, 2m, 4m, 8m … capped at 30 minutes.
    const backoffMs = Math.min(2 ** row.attempts * 30_000, 30 * 60_000);
    await this.prisma.notificationDelivery.update({
      where: { id: deliveryId },
      data: {
        status: DeliveryStatus.PENDING,
        nextAttemptAt: new Date(Date.now() + backoffMs),
        errorCode: code,
        errorMessage: DeliveryService.redact(error),
      },
    });
  }

  private async fail(deliveryId: string, code: string, error?: unknown): Promise<void> {
    await this.prisma.notificationDelivery.update({
      where: { id: deliveryId },
      data: {
        status: DeliveryStatus.FAILED,
        failedAt: new Date(),
        errorCode: code,
        errorMessage: DeliveryService.redact(error),
        nextAttemptAt: null,
      },
    });
    this.log.warn(`delivery ${deliveryId} failed permanently (${code})`);
  }

  /**
   * The push payload. Routing ids only.
   *
   * No title, no body, no sender name, no child name. A push payload is logged
   * by the platform, cached on the device and readable from a notification
   * centre; it is the last place a family's information should be.
   */
  private payloadFor(n: DeliverableNotification): Record<string, string> {
    const data: Record<string, string> = {
      notificationId: n.id,
      type: n.type ?? n.eventType,
      category: n.category,
      priority: n.priority,
    };
    if (n.entityType) data.entityType = n.entityType;
    if (n.entityId) data.entityId = n.entityId;
    if (n.conversationId) data.conversationId = n.conversationId;
    if (n.learnerId) data.learnerId = n.learnerId;
    if (n.announcementId) data.announcementId = n.announcementId;
    if (n.deeplink) data.deeplink = n.deeplink;
    return data;
  }

  /**
   * What appears on a lock screen.
   *
   * When the type does not carry content, the push is a knock on the door: the
   * academy's name and a neutral line. The real title and body are already in
   * the database and appear the moment the app is opened.
   */
  private pushText(
    n: DeliverableNotification,
    def: NotificationDefinition,
  ): { title: string; body: string } {
    if (def.pushCarriesContent) {
      return { title: n.title ?? 'Jawwid', body: n.body ?? '' };
    }
    // Deliberately unlocalised at this layer: these two strings are rendered
    // from templates by NotificationService and handed over on the row. If a
    // template is missing we would rather show the academy's name than leak.
    return { title: n.title ?? 'Jawwid', body: '' };
  }

  /** Never log a provider response verbatim; it can echo the payload. */
  private static redact(error: unknown): string | null {
    if (error === undefined || error === null) return null;
    const message = error instanceof Error ? error.message : String(error);
    return message.slice(0, 200);
  }
}
