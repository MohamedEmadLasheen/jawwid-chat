import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../platform/prisma.service';
import { AppConfigService } from '../../platform/app-config.service';
import { TemplateService } from './template.service';
import { QuietHoursService } from './quiet-hours.service';
import { PreferenceService } from './preference.service';
import { DeliveryService, DeliverableNotification } from './delivery.service';
import { NotificationStatus } from '../contracts/vocab';
import {
  DeliveryChannel,
  NotificationType,
  SkipReason,
  definitionOf,
  templateKeyFor,
} from '../contracts/notifications';

export interface ScheduleInput {
  /**
   * Deterministic and stable. Same logical notification -> same key, forever.
   * e.g. class_reminder_t30m:session_123:contact_45
   */
  dedupeKey: string;
  /** Registry type. Everything else about the notification is derived from it. */
  type: NotificationType;
  /** The SYSTEM EVENT that produced it. Not the same thing as `type`. */
  eventType: string;
  recipientId: string;

  ruleKey?: string | null;
  /** Overrides the registry's template. Used by rule-driven reminders. */
  templateKey?: string | null;
  locale?: string;
  /** Overrides the registry's priority. Used by rule-driven reminders. */
  priority?: string | null;

  familyId?: string | null;
  conversationId?: string | null;
  messageId?: string | null;
  callId?: string | null;
  announcementId?: string | null;
  /** The child this is about, from the recipient's point of view. */
  learnerId?: string | null;
  learnerName?: string | null;
  senderId?: string | null;

  variables?: Record<string, unknown>;
  scheduledAt: Date;
  expiresAt?: Date | null;
  /**
   * A rule's own quiet-hours exemption, from
   * chat.notification_rule.respect_quiet_hours. Overrides the registry so that
   * retuning a reminder schedule stays an UPDATE rather than a deploy -- which
   * is the whole reason reminder rules are rows. Absent means the type decides.
   */
  bypassQuietHours?: boolean | null;
  /** A rule asking for in-app only (chat.notification_rule.channel = 'in_app'). */
  inAppOnly?: boolean;
  /** Rendering is skipped and these are stored verbatim. Announcements use it. */
  renderedTitle?: string | null;
  renderedBody?: string | null;
  /**
   * Set when the recipient is demonstrably looking at the thing already. The
   * notification is still created; only the push is skipped, and the skip is
   * recorded.
   */
  recipientIsActive?: boolean;
  /** Conversation-level mute, which is not the same as a category preference. */
  conversationMuted?: boolean;
}

export interface ScheduleResult {
  notificationId: string;
  /** False when the dedupe key already existed. */
  created: boolean;
}

/**
 * THE NOTIFICATION ENGINE.
 *
 * One pipeline, used by every feature. A feature that wants to notify somebody
 * calls schedule() and decides none of: the category, the priority, whether it
 * is essential, which template renders it, whether it groups, where it deep
 * links, or which channels it takes. All of that is the registry's, so the
 * fiftieth notification type behaves like the first.
 *
 * TWO GUARANTEES HOLD THE WHOLE THING UP:
 *
 * DEDUPLICATION. chat.notification.dedupe_key is UNIQUE and schedule() treats a
 * duplicate as success rather than as an error. Worker restarts, replayed
 * outbox events, re-run reminder sweeps, a browser refresh, a mobile reconnect
 * and a duplicate webhook all converge on exactly one notification. The engine
 * is safe to run over the same event any number of times.
 *
 * FROZEN TEXT. Title and body are rendered ONCE, at creation, in the
 * recipient's own locale, and never re-rendered. This is what makes "moved from
 * 5:00 PM to 6:00 PM" still true after the class moves a second time -- the
 * alternative, re-rendering from live data, silently rewrites history in the
 * one place a parent goes to check what they were told.
 */
@Injectable()
export class NotificationService {
  private readonly log = new Logger(NotificationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly templates: TemplateService,
    private readonly quietHours: QuietHoursService,
    private readonly config: AppConfigService,
    private readonly preferences: PreferenceService,
    private readonly deliveries: DeliveryService,
  ) {}

  /**
   * Create a notification. Idempotent: returns the existing id when the dedupe
   * key has been seen before, and reports `created: false` so a caller that
   * cares (the grouping path) can tell.
   */
  async schedule(input: ScheduleInput): Promise<ScheduleResult> {
    const def = definitionOf(input.type);
    const locale = input.locale ?? 'ar';

    // Quiet hours are a property of the TYPE, or of the RULE that scheduled it.
    // They are never a free-form flag a feature passes: a caller that could opt
    // out at will would eventually opt out of everything.
    const bypassQuietHours = input.bypassQuietHours ?? def.bypassQuietHours;
    const scheduledAt = await this.quietHours.adjust(
      input.recipientId,
      input.scheduledAt,
      !bypassQuietHours,
    );

    const hasChild = Boolean(input.learnerName);
    const templateKey = input.templateKey ?? templateKeyFor(def, hasChild);

    const variables: Record<string, unknown> = {
      ...(input.variables ?? {}),
      ...(input.learnerName ? { student_name: input.learnerName } : {}),
    };

    // Rendered here, frozen on the row. A render failure must not produce a
    // notification with no text -- a blank row in the centre is worse than a
    // recorded failure, because the parent sees an unread badge for nothing.
    let title = input.renderedTitle ?? null;
    let body = input.renderedBody ?? null;
    if (title === null || body === null) {
      const rendered = await this.templates.render(templateKey, locale, variables);
      if (!rendered) {
        this.log.error(`template ${templateKey}/${locale} is missing; nothing was created`);
        throw new Error(`notification template not found: ${templateKey}/${locale}`);
      }
      title = rendered.title;
      body = rendered.body;
    }

    const entityId = this.entityIdFor(input, def.entityType);
    const linkContext = {
      conversationId: input.conversationId,
      messageId: input.messageId,
      callId: input.callId,
      learnerId: input.learnerId,
      announcementId: input.announcementId,
    };

    const groupKey = def.groupable
      ? (def.groupKey?.({ ...linkContext, senderId: input.senderId }) ?? null)
      : null;

    try {
      const created = await this.prisma.notification.create({
        data: {
          dedupeKey: input.dedupeKey,
          type: def.type,
          eventType: input.eventType,
          category: def.category,
          priority: input.priority ?? def.priority,
          isEssential: def.essential,
          ruleKey: input.ruleKey ?? null,
          templateKey,
          recipientId: input.recipientId,
          locale,
          // Retained for the rule/report surface that still reads it. Per-channel
          // truth lives in chat.notification_delivery.
          channel: DeliveryChannel.PUSH,
          title,
          body,
          entityType: def.entityType,
          entityId,
          deeplink: def.deepLink(linkContext),
          familyId: input.familyId ?? null,
          conversationId: input.conversationId ?? null,
          learnerId: input.learnerId ?? null,
          senderId: input.senderId ?? null,
          announcementId: input.announcementId ?? null,
          groupKey,
          variables: variables as Prisma.InputJsonValue,
          status: NotificationStatus.SCHEDULED,
          scheduledAt,
          expiresAt: input.expiresAt ?? null,
        },
      });

      // Record the push suppression NOW, against the notification that caused
      // it, rather than discovering at dispatch time that we do not remember
      // why we did not push.
      await this.recordSuppression(created.id, input, def.essential);

      return { notificationId: created.id, created: true };
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        // Already accounted for. This is the dedupe guarantee doing its job.
        const existing = await this.prisma.notification.findUnique({
          where: { dedupeKey: input.dedupeKey },
          select: { id: true },
        });
        if (existing) return { notificationId: existing.id, created: false };
      }
      throw e;
    }
  }

  /**
   * Claim and deliver everything due. Safe to run concurrently.
   *
   * The claim is a conditional UPDATE: if another worker got there first,
   * updateMany reports 0 rows and this worker moves on without double-sending.
   */
  async dispatchDue(now = new Date(), batchSize = 100): Promise<number> {
    const due = await this.prisma.notification.findMany({
      where: { status: NotificationStatus.SCHEDULED, scheduledAt: { lte: now } },
      orderBy: { scheduledAt: 'asc' },
      take: batchSize,
    });

    let delivered = 0;
    for (const n of due) {
      const claimed = await this.prisma.notification.updateMany({
        where: { id: n.id, status: NotificationStatus.SCHEDULED },
        data: { status: NotificationStatus.SENT, sentAt: now, attempts: { increment: 1 } },
      });
      if (claimed.count === 0) continue;

      try {
        if (await this.deliver(n as unknown as DeliverableNotification)) delivered += 1;
      } catch {
        await this.fail(n.id, 'DISPATCH_ERROR');
        this.log.warn(`notification ${n.id} failed to dispatch`);
      }
    }
    return delivered;
  }

  /**
   * Deliver one notification across its channels.
   *
   * In-app ALWAYS runs: the notification centre is the source of truth and it
   * is never opted out of. Push runs unless something already recorded a
   * decision not to.
   */
  async deliver(n: DeliverableNotification): Promise<boolean> {
    await this.deliveries.deliverInApp(n);

    const alreadySkipped = await this.prisma.notificationDelivery.findFirst({
      where: { notificationId: n.id, channel: DeliveryChannel.PUSH, status: 'skipped' },
      select: { id: true },
    });
    if (alreadySkipped) return true;

    const pushed = await this.deliveries.deliverPush(n);

    // A push that could not go out is NOT a failed notification. The parent has
    // it, in the app, with an unread badge, the moment they open it. Marking
    // the notification failed here would turn "their phone is off" into "we
    // lost it", and would retry a notification that has already been delivered
    // by the channel that matters.
    return pushed || true;
  }

  private async recordSuppression(
    notificationId: string,
    input: ScheduleInput,
    essential: boolean,
  ): Promise<void> {
    const def = definitionOf(input.type);
    const stub: DeliverableNotification = {
      id: notificationId,
      recipientId: input.recipientId,
      type: def.type,
      eventType: input.eventType,
      category: def.category,
      priority: input.priority ?? def.priority,
      title: null,
      body: null,
      deeplink: null,
      entityType: def.entityType,
      entityId: null,
      conversationId: input.conversationId ?? null,
      learnerId: input.learnerId ?? null,
      announcementId: input.announcementId ?? null,
      groupKey: null,
      createdAt: new Date(),
    };

    // A rule that asked for in-app only is honoured before anything else: it is
    // an explicit operational decision, not a heuristic.
    if (input.inAppOnly) {
      await this.deliveries.skip(stub, DeliveryChannel.PUSH, SkipReason.RULE_IN_APP_ONLY);
      return;
    }

    // An essential notification pushes regardless of every suppression below.
    // A cancelled class reaches a parent who is muted, asleep and mid-chat.
    if (essential) return;

    if (input.recipientIsActive) {
      // They are looking at the conversation. A push would buzz a phone that is
      // already open on the message. The in-app notification and the unread
      // badge still happen.
      await this.deliveries.skip(stub, DeliveryChannel.PUSH, SkipReason.RECIPIENT_ACTIVE);
      return;
    }

    if (input.conversationMuted) {
      await this.deliveries.skip(stub, DeliveryChannel.PUSH, SkipReason.CONVERSATION_MUTED);
      return;
    }

    if (!(await this.preferences.allowsPush(input.recipientId, def))) {
      await this.deliveries.skip(stub, DeliveryChannel.PUSH, SkipReason.PREFERENCE_OFF);
    }
  }

  private entityIdFor(input: ScheduleInput, entityType: string): string | null {
    switch (entityType) {
      case 'message':
        return input.messageId ?? input.conversationId ?? null;
      case 'call':
        return input.callId ?? null;
      case 'learner':
        return input.learnerId ?? null;
      case 'announcement':
        return input.announcementId ?? null;
      case 'conversation':
        return input.conversationId ?? null;
      default:
        return null;
    }
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
        },
      });
      return;
    }

    // Retry with exponential backoff. The dedupe key is unchanged, so a retry
    // can never become a second notification.
    const backoffMs = Math.min(2 ** n.attempts * 30_000, 30 * 60_000);
    await this.prisma.notification.update({
      where: { id: notificationId },
      data: {
        status: NotificationStatus.SCHEDULED,
        scheduledAt: new Date(Date.now() + backoffMs),
        failureCode: code,
      },
    });
  }

  /** Called by a client or a provider webhook. Never inferred. */
  async markDelivered(notificationId: string, actorId: string): Promise<void> {
    await this.prisma.notification.updateMany({
      where: { id: notificationId, recipientId: actorId, status: NotificationStatus.SENT },
      data: { status: NotificationStatus.DELIVERED, deliveredAt: new Date() },
    });
    await this.deliveries.markDelivered(notificationId, actorId);
  }

  /**
   * The user acted on a push. This is not the same as having read it in the
   * app, and it does not set read_at -- opening a push and then backgrounding
   * the app without looking is a real thing people do.
   */
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

  /** Registers a device. Multi-device is the norm, not the exception. */
  async registerDevice(input: {
    actorId: string;
    token: string;
    platform: string;
    isVoip?: boolean;
    locale?: string;
  }): Promise<void> {
    await this.prisma.deviceToken.upsert({
      where: { token: input.token },
      create: {
        actorId: input.actorId,
        token: input.token,
        platform: input.platform,
        isVoip: input.isVoip ?? false,
        locale: input.locale ?? 'ar',
      },
      // A token can move between accounts when a device is handed over, and it
      // must follow the new owner or their pushes go to the previous one.
      update: {
        actorId: input.actorId,
        isActive: true,
        lastSeenAt: new Date(),
        locale: input.locale ?? 'ar',
      },
    });
  }

  /**
   * Sign-out on one device. Scoped to the caller: a token belonging to somebody
   * else is left alone, so knowing a token string is not enough to silence
   * another person's phone.
   */
  async unregisterDevice(token: string, actorId: string): Promise<void> {
    await this.prisma.deviceToken.updateMany({
      where: { token, actorId },
      data: { isActive: false },
    });
  }
}
