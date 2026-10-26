import { Inject, Injectable, Logger } from '@nestjs/common';
import { Prisma, type NotificationItem } from '@prisma/client';
import { PrismaService } from '../../platform/prisma.service';
import { AppConfigService } from '../../platform/app-config.service';
import { IDENTITY_SERVICE, REALTIME_PUBLISHER } from '../../platform/tokens';
import type { IdentityService } from '../../platform/identity.service';
import type { RealtimePublisher } from '../realtime/realtime.publisher';
import { CommEvent } from '../contracts/events';
import { NotificationStatus } from '../contracts/vocab';
import { NotificationService } from './notification.service';
import { QuietHoursService } from './quiet-hours.service';
import { catalogEntry, severityOf, type NotificationCategory } from './notification-catalog';

/** One logical notification for one person. */
export interface EmitInput {
  /**
   * `${rule}:${subject}:${recipient}` -- the SAME key the delivery row has
   * always had (ReminderService.dedupeKey), so a producer moved onto the
   * pipeline converges on a row its old code already scheduled.
   */
  dedupeKey: string;
  ruleKey?: string | null;
  eventType: string;
  /** The push (lock-screen) template. */
  templateKey: string;
  recipientId: string;
  locale?: string;
  channel?: string;
  priority?: string;
  respectQuietHours?: boolean;
  familyId?: string | null;
  conversationId?: string | null;
  subject?: { type: string; id: string } | null;
  /** Ids only: learnerId, lessonId, instalmentId, conversationId... */
  refs?: Record<string, string | null | undefined>;
  /** Rendered into the push AND the Center; the push template decides what it shows. */
  variables?: Record<string, unknown>;
  /** The intended moment. The Center shows it then; quiet hours may push it later. */
  scheduledAt: Date;
  basis?: string | null;
  /**
   * A delivery a lifecycle change cancelled (a teacher transfer clears a
   * lesson's reminders and the sweep schedules them again) is revived rather
   * than left cancelled under its never-reusable key.
   */
  reviveCancelled?: boolean;
}

export interface MessageEmitInput {
  conversationId: string;
  messageId: string;
  seq: bigint | null;
  recipientId: string;
  locale: string;
  muted: boolean;
  now?: Date;
}

const DAY_MS = 86_400_000;

/**
 * PD-34: the notification pipeline.
 *
 *   domain fact -> rule (chat.notification_rule + notification-catalog.ts)
 *     -> chat.notification_item (what the person's Notification Center shows)
 *     -> chat.notification delivery rows (push today) via NotificationService
 *     -> quiet hours, preferences, rate limits, message coalescing
 *
 * NotificationService stays the only path to a push transport, and its
 * dispatcher is untouched: every call push still goes the way W8-W1 closed it.
 * The pipeline decides WHETHER and WHEN a delivery row exists; the dispatcher
 * sends what is due.
 *
 * Everything here is idempotent on the dedupe key and is a side effect: a
 * failure is logged by the caller and never undoes the change that caused it.
 */
@Injectable()
export class NotificationPipeline {
  private readonly log = new Logger(NotificationPipeline.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationService,
    private readonly quietHours: QuietHoursService,
    private readonly config: AppConfigService,
    @Inject(IDENTITY_SERVICE) private readonly identity: IdentityService,
    @Inject(REALTIME_PUBLISHER) private readonly realtime: RealtimePublisher,
  ) {}

  // ------------------------------------------------------------------
  // Emit
  // ------------------------------------------------------------------

  /** Creates (or finds) the item and, when the person should be pushed, its delivery. Returns the item id. */
  async emit(input: EmitInput): Promise<string | null> {
    const organizationId = await this.organizationFor(input.recipientId, input.conversationId);
    if (!organizationId) {
      this.log.error(`notification ${input.ruleKey ?? input.eventType} refused: recipient not placeable in an organization`);
      return null;
    }
    const entry = catalogEntry(input.ruleKey, input.eventType);
    const severity = severityOf(input.priority);
    const pushState = await this.pushDecision(input.recipientId, entry.category, severity, input.scheduledAt);

    const item = await this.upsertItem({
      organizationId,
      dedupeKey: input.dedupeKey,
      recipientId: input.recipientId,
      ruleKey: input.ruleKey ?? null,
      ruleVersion: entry.version,
      eventType: input.eventType,
      category: entry.category,
      severity,
      basis: input.basis ?? null,
      subjectType: input.subject?.type ?? null,
      subjectId: input.subject?.id ?? null,
      refs: compact({ ...input.refs, conversationId: input.conversationId ?? input.refs?.conversationId }),
      action: entry.action ? { kind: entry.action, ...compact({ ...input.refs, conversationId: input.conversationId ?? input.refs?.conversationId }) } : null,
      templateKey: entry.inbox,
      locale: input.locale === 'en' ? 'en' : 'ar',
      variables: input.variables ?? {},
      pushState,
      visibleAt: input.scheduledAt,
    }, input.reviveCancelled ?? false);
    if (!item) return null;

    if (pushState === 'scheduled') {
      const pushAt = await this.quietHours.adjustWithDefault(
        input.recipientId,
        input.scheduledAt,
        input.respectQuietHours ?? true,
        await this.quietDefaults(),
      );
      const named = entry.namedPush && (await this.showsNames(input.recipientId));
      const deliveryId = await this.notifications.schedule({
        dedupeKey: input.dedupeKey,
        ruleKey: input.ruleKey ?? null,
        templateKey: named ? (entry.namedPush as string) : input.templateKey,
        eventType: input.eventType,
        recipientId: input.recipientId,
        locale: input.locale,
        channel: input.channel,
        priority: input.priority,
        familyId: input.familyId ?? null,
        conversationId: input.conversationId ?? null,
        variables: input.variables,
        scheduledAt: pushAt,
        // Already applied above, with the academy default for someone who never chose.
        respectQuietHours: false,
      });
      if (deliveryId) await this.link(deliveryId, item.id, input.reviveCancelled ?? false, pushAt);
    }
    return item.id;
  }

  /**
   * A message was published. The Center keeps ONE unread entry per
   * conversation (its count grows); the push is coalesced:
   *
   *   - a push for this chat is still waiting      -> nothing new, it goes as one
   *   - the person is reading this chat right now  -> a short delay, cancelled if they read it
   *   - a push went out for this chat a moment ago -> one trailing push after the window
   *   - otherwise                                   -> now
   *
   * The delivery keeps the key it always had, `new_message:<message>:<actor>`.
   */
  async messagePublished(input: MessageEmitInput): Promise<void> {
    const now = input.now ?? new Date();
    const organizationId = await this.organizationFor(input.recipientId, input.conversationId);
    if (!organizationId) return;
    const groupKey = `conversation:${input.conversationId}`;
    const seq = input.seq === null ? null : input.seq.toString();

    const open = await this.prisma.notificationItem.findFirst({
      where: { recipientId: input.recipientId, groupKey, readAt: null, cancelledAt: null },
      orderBy: { visibleAt: 'desc' },
    });
    if (open) {
      const vars = (open.variables ?? {}) as Record<string, unknown>;
      // A replayed outbox row must not count the same message twice.
      if (seq !== null && typeof vars.lastSeq === 'string' && BigInt(vars.lastSeq) >= BigInt(seq)) return;
      await this.prisma.notificationItem.update({
        where: { id: open.id },
        data: {
          itemCount: { increment: 1 },
          variables: { ...vars, count: open.itemCount + 1, lastSeq: seq } as Prisma.InputJsonValue,
          visibleAt: now,
          announcedAt: null,
        },
      });
    }

    const pushState = input.muted ? 'muted' : await this.pushDecision(input.recipientId, 'conversation', 'normal', now);
    const dedupeKey = `new_message:${input.messageId}:${input.recipientId}`;
    const item = open ?? (await this.upsertItem({
      organizationId,
      dedupeKey,
      recipientId: input.recipientId,
      ruleKey: 'new_message',
      ruleVersion: catalogEntry('new_message', 'message_published').version,
      eventType: 'message_published',
      category: 'conversation',
      severity: 'normal',
      basis: 'member',
      subjectType: 'conversation',
      subjectId: input.conversationId,
      refs: { conversationId: input.conversationId },
      action: { kind: 'open_conversation', conversationId: input.conversationId },
      groupKey,
      templateKey: 'inbox.new_messages',
      locale: input.locale === 'en' ? 'en' : 'ar',
      variables: { count: 1, lastSeq: seq },
      pushState,
      visibleAt: now,
    }, false));
    if (!item || pushState !== 'scheduled') return;

    const rule = await this.prisma.notificationRule.findUnique({ where: { key: 'new_message' } });
    if (rule && !rule.enabled) return;

    const pending = await this.prisma.notification.findFirst({
      where: { recipientId: input.recipientId, conversationId: input.conversationId, eventType: 'message_published', status: NotificationStatus.SCHEDULED },
      select: { id: true },
    });
    if (pending) return;

    let at = now;
    if (await this.isReading(input.conversationId, input.recipientId, input.seq, now)) {
      at = new Date(now.getTime() + Number(await this.config.get('notification.message_reading_grace_seconds')) * 1000);
    } else {
      const windowMs = Number(await this.config.get('notification.message_coalesce_seconds')) * 1000;
      const last = await this.prisma.notification.findFirst({
        where: { recipientId: input.recipientId, conversationId: input.conversationId, eventType: 'message_published', status: { not: NotificationStatus.CANCELLED } },
        orderBy: { createdAt: 'desc' },
        select: { scheduledAt: true, sentAt: true },
      });
      const lastAt = last ? (last.sentAt ?? last.scheduledAt) : null;
      if (lastAt && now.getTime() - lastAt.getTime() < windowMs) at = new Date(lastAt.getTime() + windowMs);
    }
    const pushAt = await this.quietHours.adjustWithDefault(input.recipientId, at, rule?.respectQuietHours ?? true, await this.quietDefaults());
    const deliveryId = await this.notifications.schedule({
      dedupeKey,
      ruleKey: 'new_message',
      templateKey: rule?.templateKey ?? 'new_message',
      eventType: 'message_published',
      recipientId: input.recipientId,
      locale: input.locale,
      channel: rule?.channel,
      priority: rule?.priority,
      conversationId: input.conversationId,
      // Push privacy (owner decision 2026-10-14): no sender, no preview.
      variables: {},
      scheduledAt: pushAt,
      respectQuietHours: false,
    });
    if (deliveryId) await this.link(deliveryId, item.id, false, pushAt);
  }

  // ------------------------------------------------------------------
  // Cancel and read
  // ------------------------------------------------------------------

  /**
   * The reason is gone (a lesson cancelled, an instalment paid): withdraw what
   * has not been sent or shown yet. Already-shown entries stay as history.
   */
  async cancelSubject(subjectId: string, reason: string, db: Pick<PrismaService, 'notificationItem'> = this.prisma): Promise<number> {
    const result = await db.notificationItem.updateMany({
      where: { subjectId, cancelledAt: null, visibleAt: { gt: new Date() } },
      data: { cancelledAt: new Date(), cancelReason: reason },
    });
    return result.count;
  }

  /**
   * The person read a conversation (on any device): its waiting push is
   * withdrawn, its Center entry is read, and their other devices are told.
   */
  async conversationRead(conversationId: string, actorId: string, lastReadSeq: bigint): Promise<void> {
    await this.prisma.notification.updateMany({
      where: { recipientId: actorId, conversationId, eventType: 'message_published', status: NotificationStatus.SCHEDULED },
      data: { status: NotificationStatus.CANCELLED, failureCode: 'READ' },
    });
    const read = await this.prisma.notificationItem.updateMany({
      where: { recipientId: actorId, groupKey: `conversation:${conversationId}`, readAt: null },
      data: { readAt: new Date() },
    });
    await this.tell(() => this.realtime.toUsers([actorId], CommEvent.CONVERSATION_READ, {
      conversationId,
      actorId,
      lastReadSeq: lastReadSeq.toString(),
    }));
    if (read.count > 0) await this.announceTo(actorId);
  }

  // ------------------------------------------------------------------
  // Worker passes
  // ------------------------------------------------------------------

  /** Tells each person whose Center gained a visible entry. Returns the people told. */
  async announceDue(now = new Date(), batch = 500): Promise<number> {
    const due = await this.prisma.notificationItem.findMany({
      where: { announcedAt: null, cancelledAt: null, visibleAt: { lte: now } },
      select: { id: true, recipientId: true },
      orderBy: { visibleAt: 'asc' },
      take: batch,
    });
    if (due.length === 0) return 0;
    await this.prisma.notificationItem.updateMany({
      where: { id: { in: due.map((d) => d.id) }, announcedAt: null },
      data: { announcedAt: now },
    });
    const people = [...new Set(due.map((d) => d.recipientId))];
    for (const p of people) await this.announceTo(p);
    return people.length;
  }

  /**
   * Adopts delivery rows written by producers not yet on the pipeline (calls,
   * stories, payment received / rejected, PD-30) into Center entries once they
   * are sent -- so the Center is complete without editing their code. A row
   * still waiting is left alone: it may yet be cancelled.
   */
  async adoptLegacy(now = new Date(), batch = 200): Promise<number> {
    const rows = await this.prisma.notification.findMany({
      where: {
        itemId: null,
        eventType: { notIn: ['message_published', 'call_started', 'group_call_started'] },
        scheduledAt: { lte: now, gt: new Date(now.getTime() - 2 * DAY_MS) },
        OR: [
          { status: { in: [NotificationStatus.SENT, NotificationStatus.DELIVERED, NotificationStatus.OPENED, NotificationStatus.FAILED] } },
          { status: NotificationStatus.SCHEDULED, failureCode: { not: null } },
        ],
      },
      orderBy: { scheduledAt: 'asc' },
      take: batch,
    });
    let adopted = 0;
    for (const n of rows) {
      const entry = catalogEntry(n.ruleKey, n.eventType);
      const subjectId = subjectOf(n.dedupeKey);
      const refs = compact({ conversationId: n.conversationId, familyId: n.familyId });
      const item = await this.upsertItem({
        organizationId: n.organizationId,
        dedupeKey: n.dedupeKey,
        recipientId: n.recipientId,
        ruleKey: n.ruleKey,
        ruleVersion: entry.version,
        eventType: n.eventType,
        category: entry.category,
        severity: severityOf(n.priority),
        basis: null,
        subjectType: null,
        subjectId,
        refs,
        action: entry.action ? { kind: entry.action, ...refs } : null,
        templateKey: entry.inbox,
        locale: n.locale === 'en' ? 'en' : 'ar',
        variables: (n.variables ?? {}) as Record<string, unknown>,
        pushState: 'scheduled',
        visibleAt: n.sentAt ?? n.scheduledAt,
      }, false);
      if (!item) continue;
      await this.prisma.notification.updateMany({ where: { id: n.id, itemId: null }, data: { itemId: item.id } });
      adopted += 1;
    }
    return adopted;
  }

  /** Retention: delivery rows after notification.delivery_retention_days, entries after item_retention_days. */
  async purge(now = new Date()): Promise<{ deliveries: number; items: number }> {
    const deliveryDays = Number(await this.config.get('notification.delivery_retention_days'));
    const itemDays = Number(await this.config.get('notification.item_retention_days'));
    const deliveries = await this.prisma.notification.deleteMany({
      where: { createdAt: { lt: new Date(now.getTime() - deliveryDays * DAY_MS) }, status: { not: NotificationStatus.SCHEDULED } },
    });
    const items = await this.prisma.notificationItem.deleteMany({
      where: { createdAt: { lt: new Date(now.getTime() - itemDays * DAY_MS) } },
    });
    return { deliveries: deliveries.count, items: items.count };
  }

  /** The person's unread count, to their own actor room. */
  async announceTo(recipientId: string): Promise<void> {
    const unread = await this.prisma.notificationItem.count({
      where: { recipientId, readAt: null, cancelledAt: null, visibleAt: { lte: new Date() } },
    });
    await this.tell(() => this.realtime.toUsers([recipientId], CommEvent.INBOX_CHANGED, { recipientId, unread }));
  }

  /**
   * A realtime hint is best-effort: the client refetches on resume and on its
   * next screen, so a node that heard nothing costs freshness, never data.
   */
  private async tell(send: () => Promise<void>): Promise<void> {
    try {
      await send();
    } catch (e) {
      this.log.debug(`inbox hint not delivered: ${(e as Error).name}`);
    }
  }

  // ------------------------------------------------------------------
  // Decisions
  // ------------------------------------------------------------------

  /** scheduled | opted_out | rate_limited. Critical and locked categories are always pushed. */
  private async pushDecision(
    recipientId: string,
    category: NotificationCategory,
    severity: string,
    at: Date,
  ): Promise<'scheduled' | 'opted_out' | 'rate_limited'> {
    if (severity === 'critical') return 'scheduled';
    const locked = (await this.config.get('notification.locked_categories')) as readonly string[];
    if (!locked.includes(category)) {
      const pref = await this.prisma.notificationPreference.findUnique({
        where: { actorId_category_channel: { actorId: recipientId, category, channel: 'push' } },
      });
      if (pref && !pref.enabled) return 'opted_out';
    }
    const limited = (await this.config.get('notification.rate_limited_categories')) as readonly string[];
    if (limited.includes(category)) {
      const cap = Number(await this.config.get('notification.push_per_hour'));
      const recent = await this.prisma.notification.count({
        where: {
          recipientId,
          channel: 'push',
          priority: { not: 'critical' },
          status: { not: NotificationStatus.CANCELLED },
          scheduledAt: { gt: new Date(at.getTime() - 3_600_000), lte: new Date(at.getTime() + 3_600_000) },
        },
      });
      if (recent >= cap) return 'rate_limited';
    }
    return 'scheduled';
  }

  /** Read the chat's last message within the last minute: they are looking at it. */
  private async isReading(conversationId: string, actorId: string, seq: bigint | null, now: Date): Promise<boolean> {
    if (seq === null) return false;
    const state = await this.prisma.conversationParticipantState.findUnique({
      where: { conversationId_actorId: { conversationId, actorId } },
      select: { lastReadSeq: true, updatedAt: true },
    });
    if (!state) return false;
    return now.getTime() - state.updatedAt.getTime() < 60_000 && state.lastReadSeq >= seq - BigInt(1);
  }

  private async showsNames(recipientId: string): Promise<boolean> {
    const own = await this.prisma.notificationSettings.findUnique({ where: { actorId: recipientId }, select: { showPreviews: true } });
    if (own?.showPreviews !== null && own?.showPreviews !== undefined) return own.showPreviews;
    return Boolean(await this.config.get('notification.lock_screen_names_default'));
  }

  async quietDefaults(): Promise<{ enabled: boolean; startMinute: number; endMinute: number }> {
    return {
      enabled: Boolean(await this.config.get('notification.quiet_hours.default_enabled')),
      startMinute: Number(await this.config.get('notification.quiet_hours.default_start_minute')),
      endMinute: Number(await this.config.get('notification.quiet_hours.default_end_minute')),
    };
  }

  // ------------------------------------------------------------------
  // Rows
  // ------------------------------------------------------------------

  /**
   * RT-031 for the Center: the recipient's own organization, and the
   * conversation's must be the same. Anything else writes nothing.
   */
  private async organizationFor(recipientId: string, conversationId: string | null | undefined): Promise<string | null> {
    const actor = await this.identity.resolveActor(recipientId);
    if (!actor || !actor.organizationId) return null;
    if (conversationId) {
      const conv = await this.prisma.conversation.findUnique({ where: { id: conversationId }, select: { organizationId: true } });
      if (!conv || conv.organizationId !== actor.organizationId) return null;
    }
    return actor.organizationId;
  }

  private async upsertItem(
    data: {
      organizationId: string;
      dedupeKey: string;
      recipientId: string;
      ruleKey: string | null;
      ruleVersion: number;
      eventType: string;
      category: NotificationCategory;
      severity: string;
      basis: string | null;
      subjectType: string | null;
      subjectId: string | null;
      refs: Record<string, string>;
      action: Record<string, string> | null;
      groupKey?: string | null;
      templateKey: string;
      locale: 'ar' | 'en';
      variables: Record<string, unknown>;
      pushState: string;
      visibleAt: Date;
    },
    revive: boolean,
  ): Promise<NotificationItem | null> {
    try {
      return await this.prisma.notificationItem.create({
        data: {
          ...data,
          groupKey: data.groupKey ?? null,
          refs: data.refs as Prisma.InputJsonValue,
          action: data.action === null ? Prisma.DbNull : (data.action as Prisma.InputJsonValue),
          variables: data.variables as Prisma.InputJsonValue,
        },
      });
    } catch (e) {
      if (!(e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002')) throw e;
      const existing = await this.prisma.notificationItem.findUnique({ where: { dedupeKey: data.dedupeKey } });
      // Only a lifecycle withdrawal is undone, never one for the recipient's own reason.
      if (existing && revive && existing.cancelledAt && existing.readAt === null
        && (existing.cancelReason === 'delivery_cancelled' || existing.cancelReason === 'subject_gone')) {
        return this.prisma.notificationItem.update({
          where: { id: existing.id },
          data: { cancelledAt: null, cancelReason: null, visibleAt: data.visibleAt, announcedAt: null, pushState: data.pushState },
        });
      }
      return existing;
    }
  }

  private async link(deliveryId: string, itemId: string, revive: boolean, pushAt: Date): Promise<void> {
    await this.prisma.notification.updateMany({ where: { id: deliveryId, itemId: null }, data: { itemId } });
    if (revive) {
      // Only a cancellation by the lifecycle (no failure code) is undone; one
      // for a reason of the recipient's (RECIPIENT_INACTIVE) or a read is not.
      await this.prisma.notification.updateMany({
        where: { id: deliveryId, status: NotificationStatus.CANCELLED, failureCode: null },
        data: { status: NotificationStatus.SCHEDULED, scheduledAt: pushAt, attempts: 0 },
      });
    }
  }
}

/** `rule:subject:recipient` -> subject (which may itself contain colons). */
export function subjectOf(dedupeKey: string): string | null {
  const first = dedupeKey.indexOf(':');
  const last = dedupeKey.lastIndexOf(':');
  return first >= 0 && last > first ? dedupeKey.slice(first + 1, last) : null;
}

function compact(o: Record<string, string | null | undefined>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(o)) if (typeof v === 'string' && v.length > 0) out[k] = v;
  return out;
}
