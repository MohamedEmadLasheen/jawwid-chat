import { Inject, Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../platform/prisma.service';
import { AppConfigService } from '../../platform/app-config.service';
import { PUSH_PROVIDER } from '../../platform/tokens';
import type { PushProvider } from './push.provider';
import { TemplateService } from './template.service';
import { QuietHoursService } from './quiet-hours.service';
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

  constructor(
    private readonly prisma: PrismaService,
    private readonly templates: TemplateService,
    private readonly quietHours: QuietHoursService,
    private readonly config: AppConfigService,
    @Inject(PUSH_PROVIDER) private readonly push: PushProvider,
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

    try {
      const created = await this.prisma.notification.create({
        data: {
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
          status: NotificationStatus.SCHEDULED,
          scheduledAt,
        },
      });
      return created.id;
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        // Already accounted for. This is the dedupe guarantee doing its job.
        const existing = await this.prisma.notification.findUnique({
          where: { dedupeKey: input.dedupeKey },
          select: { id: true },
        });
        if (existing) return existing.id;
      }
      throw e;
    }
  }

  /** Claims and delivers everything due. Safe to run concurrently. */
  async dispatchDue(now = new Date(), batchSize = 100): Promise<number> {
    const due = await this.prisma.notification.findMany({
      where: { status: NotificationStatus.SCHEDULED, scheduledAt: { lte: now } },
      orderBy: { scheduledAt: 'asc' },
      take: batchSize,
    });

    let delivered = 0;
    for (const n of due) {
      // Claim it first. If another worker got there, updateMany reports 0 and
      // this worker moves on without double-sending.
      const claimed = await this.prisma.notification.updateMany({
        where: { id: n.id, status: NotificationStatus.SCHEDULED },
        data: { status: NotificationStatus.SENT, sentAt: now, attempts: { increment: 1 } },
      });
      if (claimed.count === 0) continue;

      try {
        const ok = await this.deliver(n.id);
        if (ok) delivered += 1;
      } catch (err) {
        await this.fail(n.id, 'DISPATCH_ERROR');
        this.log.warn(`notification ${n.id} failed to dispatch`);
      }
    }
    return delivered;
  }

  private async deliver(notificationId: string): Promise<boolean> {
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
      // outbox worker; there is nothing to push.
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
      });
      if (result.ok) anyOk = true;
      if (result.tokenInvalid) {
        await this.prisma.deviceToken.update({
          where: { id: t.id },
          data: { isActive: false },
        });
      }
    }

    if (!anyOk) {
      await this.fail(notificationId, 'PUSH_REJECTED');
      return false;
    }

    // Status stays SENT. It is NOT promoted to DELIVERED: no platform
    // acknowledgement has been received, and fabricating one would make the
    // delivery metrics lie. DELIVERED/OPENED are set only by markDelivered /
    // markOpened, driven by a real client or provider callback.
    return true;
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
    // can never become a second delivery.
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
  async markDelivered(notificationId: string): Promise<void> {
    await this.prisma.notification.updateMany({
      where: { id: notificationId, status: NotificationStatus.SENT },
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
      // A token can move between accounts when a device is handed over.
      update: {
        actorId: input.actorId,
        isActive: true,
        lastSeenAt: new Date(),
        locale: input.locale ?? 'ar',
      },
    });
  }

  /**
   * Retire one of the CALLER'S OWN device tokens.
   *
   * `actorId` is the authenticated actor, and the update is scoped to it. This
   * used to take the token alone, so any authenticated caller who knew or
   * guessed a token could deactivate it -- silencing that person's push,
   * including the incoming-call push, from an account with no relationship to
   * them at all. The mobile contract already said "never unregister another
   * device's token"; the server did not enforce it.
   *
   * A token that is not the caller's matches nothing and the call is a no-op.
   * Deliberately NOT a 404 or a 403: either would answer "does this token
   * exist?" for an attacker enumerating tokens, and the honest response to
   * "delete a thing that is not yours" is that nothing happened. The endpoint
   * is idempotent for the owner too -- deleting twice is success both times.
   */
  async unregisterDevice(token: string, actorId: string): Promise<void> {
    await this.prisma.deviceToken.updateMany({
      where: { token, actorId },
      data: { isActive: false },
    });
  }

  /**
   * Schedule a notification FROM ITS SEEDED RULE.
   *
   * chat.notification_rule already carries everything that governs delivery --
   * the template, the channel, the priority, whether quiet hours apply, an
   * offset, and an `enabled` switch. Hard-coding any of that at a call site
   * would make the row decorative and would mean an administrator disabling a
   * rule changed nothing.
   *
   * So the rule is read and obeyed. `incoming_call` is `critical` and
   * quiet-hours exempt because the row says so, not because this function
   * knows what a call is.
   *
   * A missing or disabled rule is a skip, not an error: notifications are a
   * side effect of the lifecycle and must never fail the operation that caused
   * them.
   */
  async scheduleByRule(
    ruleKey: string,
    input: {
      recipientId: string;
      dedupeKey: string;
      locale?: string;
      familyId?: string | null;
      conversationId?: string | null;
      variables?: Record<string, unknown>;
      now?: Date;
    },
  ): Promise<string | null> {
    const rule = await this.prisma.notificationRule.findUnique({ where: { key: ruleKey } });
    if (!rule || !rule.enabled) {
      this.log.debug(`notification rule ${ruleKey} is missing or disabled; nothing scheduled`);
      return null;
    }

    const base = input.now ?? new Date();
    return this.schedule({
      dedupeKey: input.dedupeKey,
      ruleKey: rule.key,
      templateKey: rule.templateKey,
      eventType: rule.eventType,
      recipientId: input.recipientId,
      locale: input.locale,
      channel: rule.channel,
      priority: rule.priority,
      familyId: input.familyId ?? null,
      conversationId: input.conversationId ?? null,
      variables: input.variables,
      scheduledAt: new Date(base.getTime() + rule.offsetSeconds * 1000),
      respectQuietHours: rule.respectQuietHours,
    });
  }
}
