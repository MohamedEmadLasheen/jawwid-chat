import { randomUUID } from 'node:crypto';
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
          status: NotificationStatus.SCHEDULED,
          scheduledAt,
        },
      });
      return id;
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
