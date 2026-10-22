import { Inject, Injectable, Logger } from '@nestjs/common';
import { actorIsLive } from '../../platform/liveness';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../platform/prisma.service';
import { AppConfigService } from '../../platform/app-config.service';
import { PUSH_PROVIDER } from '../../platform/tokens';
import type { PushProvider } from './push.provider';
import { TemplateService } from './template.service';
import { QuietHoursService } from './quiet-hours.service';
import { NotificationStatus } from '../contracts/vocab';
import { buildPushData, isCallNotification, mayDeliverTo } from './call-push-routing';
import { ACADEMY_ZONE, canonicalZone, clockIn, zoneLabel } from '../../platform/time-zone';

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
/** An id from a URL that is not a uuid names no row; it is answered as one that does not exist. */
const isUuid = (v: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);

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
   * The organization a notification is filed under, from server-owned rows.
   *
   * RT-031. It used to be the column default (organization A) for everyone.
   * It is the RECIPIENT's organization, read from their own principal row; and
   * when the notification concerns a conversation, that conversation must be
   * in the same organization. Anything else -- an unknown recipient, or a
   * conversation of another tenant -- is refused (null): a notification is a
   * side effect and must never be the way content crosses a tenant boundary.
   */
  private async organizationFor(recipientId: string, conversationId: string | null | undefined): Promise<string | null> {
    const rows = await this.prisma.$queryRaw<Array<{ organization_id: string }>>`
      SELECT organization_id FROM chat.contact WHERE id = ${recipientId}::uuid
      UNION ALL SELECT organization_id FROM chat.staff WHERE id = ${recipientId}::uuid
      UNION ALL SELECT organization_id FROM chat.teacher WHERE id = ${recipientId}::uuid`;
    const orgs = new Set(rows.map((r) => r.organization_id));
    if (orgs.size !== 1) return null;
    const [org] = orgs;
    if (conversationId) {
      const conv = await this.prisma.conversation.findUnique({
        where: { id: conversationId },
        select: { organizationId: true },
      });
      if (!conv || conv.organizationId !== org) return null;
    }
    return org;
  }

  /**
   * Idempotent. Returns the notification id whether it was created now or
   * already existed -- or null when the recipient cannot be placed in the
   * notification's organization (RT-031), in which case nothing is written.
   */
  async schedule(input: ScheduleInput): Promise<string | null> {
    const organizationId = await this.organizationFor(input.recipientId, input.conversationId);
    if (!organizationId) {
      this.log.error(`notification ${input.ruleKey ?? input.templateKey} refused: recipient not in the conversation's organization`);
      return null;
    }
    const scheduledAt = await this.quietHours.adjust(
      input.recipientId,
      input.scheduledAt,
      input.respectQuietHours ?? true,
    );

    try {
      const created = await this.prisma.notification.create({
        data: {
          organizationId,
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
      await this.inRecipientZone(n.recipientId, n.locale, (n.variables ?? {}) as Record<string, unknown>),
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

    // RT-032: liveness is re-read at SEND time, not trusted from when the
    // notification was scheduled (quiet hours and retries can put a long gap
    // in between). A recipient taken out of service since then gets nothing,
    // and the notification is cancelled rather than retried -- a later
    // re-activation must not replay it. (A push already handed to the provider
    // cannot be recalled: RT-037.)
    if (!(await actorIsLive(this.prisma, n.recipientId))) {
      await this.prisma.notification.updateMany({
        where: { id: notificationId },
        data: { status: NotificationStatus.CANCELLED, failureCode: 'RECIPIENT_INACTIVE' },
      });
      return false;
    }

    const active = await this.prisma.deviceToken.findMany({
      where: { actorId: n.recipientId, isActive: true },
    });

    // WHICH DEVICES MAY RECEIVE THIS. A VoIP token takes call pushes and
    // nothing else: on iOS a PushKit delivery that does not report a call to
    // CallKit terminates the app. The rule lives in one place -- see
    // `call-push-routing.ts` -- so it can be read, tested and changed without
    // touching this loop.
    const isCall = isCallNotification(n.eventType);
    const tokens = active.filter((t) => mayDeliverTo(isCall, t));

    if (tokens.length === 0) {
      // Covers both "no device at all" and "no device of the right kind" -- an
      // iOS user who has not registered a VoIP token yet cannot be sent a call,
      // and that is a missing registration rather than a delivery failure.
      await this.fail(notificationId, 'NO_DEVICE_TOKEN');
      return false;
    }

    const data = buildPushData({
      eventType: n.eventType,
      notificationId: n.id,
      conversationId: n.conversationId,
      dedupeKey: n.dedupeKey,
    });

    let anyOk = false;
    for (const t of tokens) {
      const result = await this.push.send({
        token: t.token,
        title: rendered.title,
        body: rendered.body,
        data,
        isVoip: t.isVoip,
        platform: t.platform,
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

  /**
   * PD-22: `{time}` is the clock time of `startsAt` for THIS recipient, worked out
   * at send time, so a parent who travelled since the reminder was scheduled is
   * told their new local time. Someone whose phone never reported a zone is told
   * the academy's time with its name ("17:00 (Cairo time)"), never a bare clock
   * they could take for their own.
   */
  private async inRecipientZone(
    recipientId: string,
    locale: string,
    variables: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    const at = typeof variables.startsAt === 'string' ? new Date(variables.startsAt) : null;
    if (!at || Number.isNaN(at.getTime())) return variables;
    const lang = locale === 'en' ? 'en' : 'ar';
    const own = await this.prisma.actorTimeZone.findUnique({ where: { actorId: recipientId }, select: { timeZone: true } });
    if (own) return { ...variables, time: clockIn(at, own.timeZone, lang) };
    const row = await this.prisma.config.findUnique({ where: { key: 'schedule.timezone' } });
    const academy = canonicalZone(row?.value) ?? ACADEMY_ZONE;
    return { ...variables, time: `${clockIn(at, academy, lang)} (${zoneLabel(academy, lang)})` };
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
   * Only the RECIPIENT reports their own notification delivered (as for
   * opened). It used to take the id alone, so any authenticated caller could
   * rewrite another person's delivery state (ported from the parallel branch's
   * scoped-read work). A foreign or malformed id changes nothing and says so to
   * nobody: the response is the same either way.
   */
  async markDelivered(notificationId: string, actorId: string): Promise<void> {
    if (!isUuid(notificationId)) return;
    await this.prisma.notification.updateMany({
      where: { id: notificationId, recipientId: actorId, status: NotificationStatus.SENT },
      data: { status: NotificationStatus.DELIVERED, deliveredAt: new Date() },
    });
  }

  async markOpened(notificationId: string, actorId: string): Promise<void> {
    if (!isUuid(notificationId)) return;
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
      //
      // `platform` AND `isVoip` ARE UPDATED TOO. They were not, so a token
      // re-registered with a different kind kept the kind it was first seen
      // with. Harmless while nothing read `is_voip`; now that it decides
      // whether a device may receive a call push, a stale value is the
      // difference between a phone that rings and one that does not.
      update: {
        actorId: input.actorId,
        platform: input.platform,
        isVoip: input.isVoip ?? false,
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
