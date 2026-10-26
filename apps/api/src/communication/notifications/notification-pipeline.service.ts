import { Inject, Injectable, Logger } from '@nestjs/common';
import { Prisma, type NotificationItem } from '@prisma/client';
import { PrismaService } from '../../platform/prisma.service';
import { AppConfigService } from '../../platform/app-config.service';
import { IDENTITY_SERVICE, REALTIME_PUBLISHER } from '../../platform/tokens';
import type { IdentityService } from '../../platform/identity.service';
import type { RealtimePublisher } from '../realtime/realtime.publisher';
import { CommEvent } from '../contracts/events';
import { ActorKind, NotificationStatus } from '../contracts/vocab';
import { NotificationService } from './notification.service';
import { QuietHoursService } from './quiet-hours.service';
import { catalogEntry, severityOf, type NotificationCategory } from './notification-catalog';
import { ACADEMY_ZONE } from '../../platform/time-zone';
import { messageAudience } from '../outbox/message-audience';

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

  /** One recipient; see messagePublishedMany. */
  async messagePublished(input: MessageEmitInput): Promise<void> {
    await this.messagePublishedMany({
      conversationId: input.conversationId,
      messageId: input.messageId,
      seq: input.seq,
      recipients: [{ actorId: input.recipientId, muted: input.muted }],
      now: input.now,
    });
  }

  /**
   * A message was published, to everyone in its audience at once.
   *
   * The Center keeps ONE unread entry per person per conversation; its count
   * grows. The push is coalesced:
   *
   *   - a push for this chat is still waiting      -> nothing new, it goes as one
   *   - the person is reading this chat right now  -> a short delay, cancelled if they read it
   *   - a push went out for this chat a moment ago -> one trailing push after the window
   *   - otherwise                                   -> now
   *
   * Everything that is the same for every recipient (the conversation, the
   * rule, config) and everything that can be read for all of them in one query
   * (who they are, preferences, recent push counts, read state, quiet hours) is
   * read ONCE. What remains per person is two writes: an atomic upsert of the
   * entry, and the push decided under a per-(person, chat) advisory lock, so two
   * workers draining at once can neither double-count nor double-push.
   *
   * The delivery keeps the key it always had, `new_message:<message>:<actor>`,
   * and records the newest seq it stands for (variables.lastSeq) so a read of
   * seq N withdraws only what N covers.
   */
  async messagePublishedMany(input: {
    conversationId: string;
    messageId: string;
    seq: bigint | null;
    recipients: Array<{ actorId: string; muted: boolean }>;
    now?: Date;
  }): Promise<void> {
    const now = input.now ?? new Date();
    if (input.recipients.length === 0) return;
    const seq = input.seq === null ? null : input.seq.toString();

    const conv = await this.prisma.conversation.findUnique({ where: { id: input.conversationId }, select: { organizationId: true } });
    if (!conv) return;
    const ids = [...new Set(input.recipients.map((r) => r.actorId))];
    const actors = await this.liveActors(ids);
    const rule = await this.prisma.notificationRule.findUnique({ where: { key: 'new_message' } });
    const ruleOn = !rule || rule.enabled;
    const decisions = await this.pushDecisions(ids, 'conversation', 'normal', now);
    const states = new Map(
      (await this.prisma.conversationParticipantState.findMany({
        where: { conversationId: input.conversationId, actorId: { in: ids } },
        select: { actorId: true, lastReadSeq: true, updatedAt: true },
      })).map((x) => [x.actorId, x]),
    );
    const graceMs = Number(await this.config.get('notification.message_reading_grace_seconds')) * 1000;
    const windowMs = Number(await this.config.get('notification.message_coalesce_seconds')) * 1000;
    const quiet = await this.quietWindows(ids, await this.quietDefaults());
    const groupKey = `conversation:${input.conversationId}`;

    for (const r of input.recipients) {
      const actor = actors.get(r.actorId);
      // RT-031: never across a tenant boundary; a deactivated actor gets nothing.
      if (!actor || actor.organizationId !== conv.organizationId) continue;
      const pushState = r.muted ? 'muted' : (decisions.get(r.actorId) ?? 'scheduled');
      const dedupeKey = `new_message:${input.messageId}:${r.actorId}`;
      const itemId = await this.upsertMessageItem({
        organizationId: conv.organizationId,
        dedupeKey,
        recipientId: r.actorId,
        conversationId: input.conversationId,
        groupKey,
        messageId: input.messageId,
        locale: actor.locale === 'en' ? 'en' : 'ar',
        seq,
        pushState,
        now,
      });
      // null: this message was already counted (a replayed outbox row).
      if (!itemId || pushState !== 'scheduled' || !ruleOn) continue;

      const state = states.get(r.actorId);
      const reading = input.seq !== null && state !== undefined
        && now.getTime() - state.updatedAt.getTime() < 60_000 && state.lastReadSeq >= input.seq - BigInt(1);
      await this.prisma.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${r.actorId}::text || ':' || ${input.conversationId}::text))`;
        const pending = await tx.notification.findFirst({
          where: { recipientId: r.actorId, conversationId: input.conversationId, eventType: 'message_published', status: NotificationStatus.SCHEDULED },
          select: { id: true, variables: true },
        });
        if (pending) {
          // It goes as one push; it now stands for this message too.
          await tx.notification.update({
            where: { id: pending.id },
            data: { variables: { ...((pending.variables ?? {}) as Record<string, unknown>), lastSeq: maxSeq((pending.variables as Record<string, unknown> | null)?.lastSeq, seq) } as Prisma.InputJsonValue },
          });
          return;
        }
        let at = now;
        if (reading) at = new Date(now.getTime() + graceMs);
        else {
          const last = await tx.notification.findFirst({
            where: { recipientId: r.actorId, conversationId: input.conversationId, eventType: 'message_published', status: { not: NotificationStatus.CANCELLED } },
            orderBy: { createdAt: 'desc' },
            select: { scheduledAt: true, sentAt: true },
          });
          const lastAt = last ? (last.sentAt ?? last.scheduledAt) : null;
          if (lastAt && now.getTime() - lastAt.getTime() < windowMs) at = new Date(lastAt.getTime() + windowMs);
        }
        const pushAt = (rule?.respectQuietHours ?? true) ? deferForQuiet(at, quiet.get(r.actorId)) : at;
        await tx.notification.createMany({
          data: [{
            organizationId: conv.organizationId,
            dedupeKey,
            ruleKey: 'new_message',
            templateKey: rule?.templateKey ?? 'new_message',
            eventType: 'message_published',
            recipientId: r.actorId,
            locale: actor.locale === 'en' ? 'en' : 'ar',
            channel: rule?.channel ?? 'push',
            priority: rule?.priority ?? 'normal',
            conversationId: input.conversationId,
            // Push privacy (owner decision 2026-10-14): no sender, no preview --
            // only which message it stands for, for the read check.
            variables: { lastSeq: seq } as Prisma.InputJsonValue,
            status: NotificationStatus.SCHEDULED,
            scheduledAt: pushAt,
            itemId,
          }],
          skipDuplicates: true,
        });
      });
    }
  }

  /**
   * The person's open entry for this chat, and whether THIS message is new to
   * it. Safe under concurrent workers and in any commit order:
   *
   *   1. the open entry is created or found in one statement (unique open
   *      group_key); lastSeq only ever moves up (max), for the read rule;
   *   2. the message is recorded against the entry (primary key item+message);
   *      only a first recording counts it, so a replay -- however late, and
   *      whatever its seq -- adds nothing, and no message is mistaken for one.
   *
   * Returns the entry id, or null when this message was already counted.
   */
  private async upsertMessageItem(x: {
    organizationId: string;
    dedupeKey: string;
    recipientId: string;
    conversationId: string;
    groupKey: string;
    messageId: string;
    locale: 'ar' | 'en';
    seq: string | null;
    pushState: string;
    now: Date;
  }): Promise<string | null> {
    const refs = JSON.stringify({ conversationId: x.conversationId });
    const action = JSON.stringify({ kind: 'open_conversation', conversationId: x.conversationId });
    const variables = JSON.stringify({ count: 1, lastSeq: x.seq });
    try {
      return await this.prisma.$transaction(async (tx) => {
        const [entry] = await tx.$queryRaw<Array<{ id: string; created: boolean }>>`
          INSERT INTO chat.notification_item
            (organization_id, dedupe_key, recipient_id, rule_key, rule_version, event_type, category, severity, basis,
             subject_type, subject_id, refs, action, group_key, template_key, locale, variables, push_state, visible_at)
          VALUES
            (${x.organizationId}::uuid, ${x.dedupeKey}, ${x.recipientId}::uuid, 'new_message',
             ${catalogEntry('new_message', 'message_published').version}, 'message_published', 'conversation', 'normal', 'member',
             'conversation', ${x.conversationId}, ${refs}::jsonb, ${action}::jsonb, ${x.groupKey}, 'inbox.new_messages',
             ${x.locale}, ${variables}::jsonb, ${x.pushState}, ${x.now})
          ON CONFLICT (recipient_id, group_key) WHERE group_key IS NOT NULL AND read_at IS NULL AND cancelled_at IS NULL
          DO UPDATE SET
            variables = chat.notification_item.variables || jsonb_build_object('lastSeq',
              CASE WHEN (EXCLUDED.variables ->> 'lastSeq') IS NULL THEN chat.notification_item.variables -> 'lastSeq'
                   WHEN (chat.notification_item.variables ->> 'lastSeq') IS NULL
                     OR (EXCLUDED.variables ->> 'lastSeq')::numeric > (chat.notification_item.variables ->> 'lastSeq')::numeric
                   THEN EXCLUDED.variables -> 'lastSeq'
                   ELSE chat.notification_item.variables -> 'lastSeq' END),
            updated_at = now()
          RETURNING id::text AS id, (xmax = 0) AS created`;
        if (!entry) return null;
        const recorded = await tx.$executeRaw`
          INSERT INTO chat.notification_item_message (item_id, message_id)
          VALUES (${entry.id}::uuid, ${x.messageId}::uuid)
          ON CONFLICT DO NOTHING`;
        if (recorded === 0) return null; // this message was already counted
        if (!entry.created) {
          await tx.$executeRaw`
            UPDATE chat.notification_item
               SET item_count = item_count + 1,
                   variables = variables || jsonb_build_object('count', item_count + 1),
                   visible_at = ${x.now}, announced_at = NULL, updated_at = now()
             WHERE id = ${entry.id}::uuid`;
        }
        return entry.id;
      });
    } catch (e) {
      // The same message replayed after its entry was read: dedupe_key already
      // taken. Already counted; nothing to do.
      if (/23505|unique/i.test(String((e as Error).message))) return null;
      throw e;
    }
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
    // Only what the read covers: a push or an entry that also stands for a
    // later message (variables.lastSeq > the read) stays. A row with no seq
    // (written before PD-34 kept one) is covered by any read.
    const seq = lastReadSeq.toString();
    await this.prisma.$executeRaw`
      UPDATE chat.notification SET status = 'cancelled', failure_code = 'READ'
       WHERE recipient_id = ${actorId}::uuid AND conversation_id = ${conversationId}::uuid
         AND event_type = 'message_published' AND status = 'scheduled'
         AND coalesce((variables ->> 'lastSeq')::numeric, 0) <= ${seq}::numeric`;
    const read = await this.prisma.$executeRaw`
      UPDATE chat.notification_item SET read_at = now(), updated_at = now()
       WHERE recipient_id = ${actorId}::uuid AND group_key = ${`conversation:${conversationId}`} AND read_at IS NULL
         AND coalesce((variables ->> 'lastSeq')::numeric, 0) <= ${seq}::numeric`;
    await this.tell(() => this.realtime.toUsers([actorId], CommEvent.CONVERSATION_READ, {
      conversationId,
      actorId,
      lastReadSeq: lastReadSeq.toString(),
    }));
    if (read > 0) await this.announceTo(actorId);
  }

  // ------------------------------------------------------------------
  // Worker passes
  // ------------------------------------------------------------------

  /**
   * PD-34 review P1: a chat push is re-authorized just before it can be sent.
   *
   * Coalescing, the reading grace and quiet hours defer message pushes -- by
   * seconds, or by a night. In that time a member may be removed or a seat may
   * stop holding (PD-35 P2-3). Leaving a conversation or closing a seat cancels
   * the waiting push by trigger; this covers everything else (a seat whose
   * access lapsed before the sweep ends it, a cover that ended). Run by the
   * worker immediately before NotificationService.dispatchDue, over every chat
   * push that will be due within `horizonMs`, against the SAME audience rule
   * the fan-out used (message-audience.ts). The dispatcher itself is unchanged.
   */
  async guardDueMessages(now = new Date(), horizonMs = 5_000, batch = 1_000): Promise<number> {
    const due = await this.prisma.notification.findMany({
      where: {
        status: NotificationStatus.SCHEDULED,
        eventType: 'message_published',
        scheduledAt: { lte: new Date(now.getTime() + horizonMs) },
        conversationId: { not: null },
      },
      select: { id: true, recipientId: true, conversationId: true },
      take: batch,
    });
    const byConversation = new Map<string, typeof due>();
    for (const d of due) byConversation.set(d.conversationId as string, [...(byConversation.get(d.conversationId as string) ?? []), d]);
    const drop: string[] = [];
    for (const [conversationId, rows] of byConversation) {
      const audience = new Set(await messageAudience(this.prisma, conversationId, null));
      for (const r of rows) if (!audience.has(r.recipientId)) drop.push(r.id);
    }
    if (drop.length === 0) return 0;
    const result = await this.prisma.notification.updateMany({
      where: { id: { in: drop }, status: NotificationStatus.SCHEDULED },
      data: { status: NotificationStatus.CANCELLED, failureCode: 'AUDIENCE' },
    });
    return result.count;
  }

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

  /** The live actors among `ids`, in three queries whatever their number. */
  private async liveActors(ids: readonly string[]): Promise<Map<string, { organizationId: string; locale: string }>> {
    const resolved = await this.identity.resolveActors(
      ids.flatMap((actorId) => [ActorKind.STAFF, ActorKind.CONTACT, ActorKind.TEACHER].map((actorKind) => ({ actorId, actorKind }))),
    );
    const out = new Map<string, { organizationId: string; locale: string }>();
    for (const a of resolved.values()) {
      if (a.isActive && a.organizationId) out.set(a.actorId, { organizationId: a.organizationId, locale: a.locale });
    }
    return out;
  }

  /** pushDecision for many people at once: one preference read, one grouped count. */
  private async pushDecisions(
    ids: readonly string[],
    category: NotificationCategory,
    severity: string,
    at: Date,
  ): Promise<Map<string, 'scheduled' | 'opted_out' | 'rate_limited'>> {
    const out = new Map<string, 'scheduled' | 'opted_out' | 'rate_limited'>(ids.map((id) => [id, 'scheduled']));
    if (severity === 'critical' || ids.length === 0) return out;
    const locked = (await this.config.get('notification.locked_categories')) as readonly string[];
    if (!locked.includes(category)) {
      const off = await this.prisma.notificationPreference.findMany({
        where: { actorId: { in: [...ids] }, category, channel: 'push', enabled: false },
        select: { actorId: true },
      });
      for (const p of off) out.set(p.actorId, 'opted_out');
    }
    const limited = (await this.config.get('notification.rate_limited_categories')) as readonly string[];
    const cap = Number(await this.config.get('notification.push_per_hour'));
    // 0 (the default until the owner decides): no cap.
    if (cap > 0 && limited.includes(category)) {
      const counts = await this.prisma.notification.groupBy({
        by: ['recipientId'],
        where: {
          recipientId: { in: [...ids] },
          channel: 'push',
          priority: { not: 'critical' },
          status: { not: NotificationStatus.CANCELLED },
          scheduledAt: { gt: new Date(at.getTime() - 3_600_000), lte: new Date(at.getTime() + 3_600_000) },
        },
        _count: { _all: true },
      });
      for (const c of counts) if (c._count._all >= cap && out.get(c.recipientId) === 'scheduled') out.set(c.recipientId, 'rate_limited');
    }
    return out;
  }

  /** Each person's quiet window and zone, in two queries. */
  private async quietWindows(
    ids: readonly string[],
    fallback: { enabled: boolean; startMinute: number; endMinute: number },
  ): Promise<Map<string, { enabled: boolean; startMinute: number; endMinute: number; zone: string }>> {
    const [own, zones] = await Promise.all([
      this.prisma.quietHours.findMany({ where: { actorId: { in: [...ids] } } }),
      this.prisma.actorTimeZone.findMany({ where: { actorId: { in: [...ids] } }, select: { actorId: true, timeZone: true } }),
    ]);
    const ownBy = new Map(own.map((q) => [q.actorId, q]));
    const zoneBy = new Map(zones.map((z) => [z.actorId, z.timeZone]));
    return new Map(ids.map((id) => {
      const q = ownBy.get(id);
      const w = q ?? fallback;
      return [id, { enabled: w.enabled, startMinute: w.startMinute, endMinute: w.endMinute, zone: zoneBy.get(id) ?? q?.timezone ?? ACADEMY_ZONE }];
    }));
  }

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
    const cap = Number(await this.config.get('notification.push_per_hour'));
    // 0 (the default until the owner decides): no cap.
    if (cap > 0 && limited.includes(category)) {
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

/** The end of a quiet window, or `at` itself when it is not quiet then (never dropped). */
function deferForQuiet(
  at: Date,
  w: { enabled: boolean; startMinute: number; endMinute: number; zone: string } | undefined,
): Date {
  if (!w || !w.enabled) return at;
  const local = QuietHoursService.minutesInZone(at, w.zone);
  if (!QuietHoursService.isQuiet(local, w.startMinute, w.endMinute)) return at;
  let delta = w.endMinute - local;
  if (delta <= 0) delta += 24 * 60;
  return new Date(at.getTime() + delta * 60_000);
}

/** The larger of two seqs held as strings (null when neither is known). */
function maxSeq(a: unknown, b: string | null): string | null {
  const x = typeof a === 'string' ? a : null;
  if (x === null) return b;
  if (b === null) return x;
  return BigInt(b) > BigInt(x) ? b : x;
}
