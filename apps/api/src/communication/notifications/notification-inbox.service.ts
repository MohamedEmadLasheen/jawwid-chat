import { Injectable } from '@nestjs/common';
import { Prisma, type NotificationItem } from '@prisma/client';
import { PrismaService } from '../../platform/prisma.service';
import { AppConfigService } from '../../platform/app-config.service';
import { CommError, CommErrorCode } from '../../platform/errors';
import { ACADEMY_ZONE, canonicalZone, clockIn, dayIn } from '../../platform/time-zone';
import { ActorKind } from '../contracts/vocab';
import type { Actor } from '../../platform/types';
import { TemplateService } from './template.service';
import { inboxCandidates, renderFirstComplete } from './inbox-render';
import { NotificationPipeline } from './notification-pipeline.service';
import { ConversationService } from '../conversations/conversation.service';
import {
  INBOX_TABS,
  NOTIFICATION_CATEGORIES,
  TAB_CATEGORIES,
  type InboxTab,
  type NotificationCategory,
} from './notification-catalog';

const PAGE_DEFAULT = 30;
const PAGE_MAX = 100;
const isUuid = (v: unknown): v is string =>
  typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);

/** Which categories a person of this kind can receive, and so may tune. */
const CATEGORIES_BY_KIND: Readonly<Record<string, readonly NotificationCategory[]>> = {
  [ActorKind.CONTACT]: ['lesson', 'payment', 'conversation', 'call', 'announcement'],
  [ActorKind.TEACHER]: ['lesson', 'conversation', 'call', 'announcement'],
  [ActorKind.STAFF]: ['conversation', 'call', 'task', 'payment', 'announcement', 'system'],
};

export interface InboxEntry {
  id: string;
  category: string;
  severity: string;
  title: string;
  body: string;
  at: string;
  read: boolean;
  acted: boolean;
  requiresAction: boolean;
  dueAt: string | null;
  taskStatus: string | null;
  count: number;
  action: Record<string, string> | null;
  refs: Record<string, string>;
}

/**
 * PD-34: a person's own Notification Center.
 *
 *   GET  /me/notifications?tab=&before=&limit=   entries, newest first
 *   GET  /me/notifications/counts                unread per tab, and the tabs to show
 *   POST /me/notifications/read                  { ids } or { all: true, tab? }
 *   POST /me/notifications/:id/acted             the button was used
 *   GET  /me/notification-settings               quiet hours, names, categories
 *   PUT  /me/notification-settings
 *
 * Every read and write is scoped to the caller: an id that is not theirs
 * matches nothing and reads as not found. Text is rendered at read time in the
 * entry's language, with times in the READER's own zone (PD-22).
 *
 * An entry about a conversation is shown only while the reader can still read
 * that conversation (the same canRead every message route uses). Leaving
 * withdraws a waiting push and its entry by trigger; access can also end with
 * no left_at (a PD-8 scope change, a seat lapsing before its sweep), so the
 * list and the counts re-check, and withdraw what no longer holds
 * (cancel_reason access_lost) -- the conversation id is not kept on show.
 */
@Injectable()
export class NotificationInboxService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly templates: TemplateService,
    private readonly config: AppConfigService,
    private readonly pipeline: NotificationPipeline,
    private readonly conversations: ConversationService,
  ) {}

  async list(actor: Actor, query: { tab?: unknown; before?: unknown; limit?: unknown }) {
    const tab = parseTab(query.tab);
    const limit = parseLimit(query.limit);
    const before = parseCursor(query.before);
    const now = new Date();
    const where: Prisma.NotificationItemWhereInput = {
      AND: [
        this.visible(actor.actorId, now),
        tabWhere(tab),
        before ? { OR: [{ visibleAt: { lt: before.at } }, { visibleAt: before.at, id: { lt: before.id } }] } : {},
      ],
    };
    const rows = await this.prisma.notificationItem.findMany({
      where,
      orderBy: [{ visibleAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
    });
    const lost = await this.withdrawLostAccess(actor, rows.map((r) => conversationOf(r.refs)).filter((id): id is string => id !== null));
    const page = rows.slice(0, limit);
    const shown = page.filter((r) => !lost.has(conversationOf(r.refs) ?? ''));
    const zone = await this.zoneOf(actor.actorId);
    const cache = new Map<string, { title: string; body: string } | null>();
    const entries: InboxEntry[] = [];
    for (const r of shown) entries.push(await this.present(r, zone, cache));
    const last = page[page.length - 1];
    return {
      tab,
      entries,
      next: rows.length > limit && last ? `${last.visibleAt.toISOString()}_${last.id}` : null,
    };
  }

  async counts(actor: Actor) {
    const now = new Date();
    const referenced = await this.prisma.$queryRaw<Array<{ id: string }>>`
      SELECT DISTINCT refs ->> 'conversationId' AS id FROM chat.notification_item
       WHERE recipient_id = ${actor.actorId}::uuid AND cancelled_at IS NULL AND visible_at <= ${now}
         AND refs ->> 'conversationId' IS NOT NULL`;
    await this.withdrawLostAccess(actor, referenced.map((r) => r.id));
    const unread = await this.prisma.notificationItem.groupBy({
      by: ['category'],
      where: { AND: [this.visible(actor.actorId, now), { readAt: null }] },
      _count: { _all: true },
    });
    const byCategory = new Map(unread.map((u) => [u.category, u._count._all]));
    const action = await this.prisma.notificationItem.count({
      where: { AND: [this.visible(actor.actorId, now), tabWhere('action')] },
    });
    const total = [...byCategory.values()].reduce((a, b) => a + b, 0);
    const perTab: Record<string, number> = { all: total, unread: total, action };
    for (const [tab, cats] of Object.entries(TAB_CATEGORIES)) {
      perTab[tab] = (cats ?? []).reduce((a, c) => a + (byCategory.get(c) ?? 0), 0);
    }
    return { unread: total, perTab, tabs: await this.tabsFor(actor) };
  }

  async markRead(actor: Actor, body: { ids?: unknown; all?: unknown; tab?: unknown }) {
    const now = new Date();
    let changed: number;
    if (body.all === true) {
      const tab = parseTab(body.tab);
      changed = (await this.prisma.notificationItem.updateMany({
        where: { AND: [this.visible(actor.actorId, now), tabWhere(tab), { readAt: null }] },
        data: { readAt: now },
      })).count;
    } else {
      if (!Array.isArray(body.ids) || body.ids.length === 0 || body.ids.length > PAGE_MAX || !body.ids.every(isUuid)) {
        throw invalid('ids: a list of up to 100 notification ids, or all: true');
      }
      changed = (await this.prisma.notificationItem.updateMany({
        where: { id: { in: body.ids as string[] }, recipientId: actor.actorId, readAt: null },
        data: { readAt: now },
      })).count;
    }
    if (changed > 0) await this.pipeline.announceTo(actor.actorId);
    return { read: changed, ...(await this.counts(actor)) };
  }

  async acted(actor: Actor, id: string) {
    if (!isUuid(id)) throw notFound();
    const now = new Date();
    const result = await this.prisma.notificationItem.updateMany({
      where: { id, recipientId: actor.actorId },
      data: { actedAt: now },
    });
    if (result.count === 0) throw notFound();
    await this.prisma.notificationItem.updateMany({ where: { id, readAt: null }, data: { readAt: now } });
    await this.pipeline.announceTo(actor.actorId);
    return { ok: true };
  }

  // ------------------------------------------------------------------
  // Settings
  // ------------------------------------------------------------------

  async settings(actor: Actor) {
    const [own, prefs, mine, defaults, lockedRaw, namesDefault] = await Promise.all([
      this.prisma.quietHours.findUnique({ where: { actorId: actor.actorId } }),
      this.prisma.notificationPreference.findMany({ where: { actorId: actor.actorId, channel: 'push' } }),
      this.prisma.notificationSettings.findUnique({ where: { actorId: actor.actorId } }),
      this.pipeline.quietDefaults(),
      this.config.get('notification.locked_categories'),
      this.config.get('notification.lock_screen_names_default'),
    ]);
    const locked = lockedRaw as readonly string[];
    const off = new Set(prefs.filter((p) => !p.enabled).map((p) => p.category));
    return {
      quietHours: own
        ? { enabled: own.enabled, startMinute: own.startMinute, endMinute: own.endMinute, isDefault: false }
        : { ...defaults, isDefault: true },
      showPreviews: mine?.showPreviews ?? Boolean(namesDefault),
      showPreviewsIsDefault: mine?.showPreviews === null || mine?.showPreviews === undefined,
      categories: this.categoriesFor(actor).map((category) => ({
        category,
        push: locked.includes(category) || !off.has(category),
        locked: locked.includes(category),
      })),
    };
  }

  /**
   * { quietHours?: { enabled, startMinute, endMinute } | null,
   *   showPreviews?: boolean | null,
   *   categories?: [{ category, push }] }
   * null resets to the academy default. A locked category cannot be switched off.
   */
  async setSettings(actor: Actor, body: Record<string, unknown>) {
    const organizationId = actor.organizationId;
    if (!organizationId) throw notFound();
    const allowed = new Set(this.categoriesFor(actor));
    const locked = (await this.config.get('notification.locked_categories')) as readonly string[];

    let quiet: { enabled: boolean; startMinute: number; endMinute: number } | null | undefined;
    if ('quietHours' in body) {
      const q = body.quietHours;
      if (q === null) quiet = null;
      else {
        const r = (q ?? {}) as Record<string, unknown>;
        if (typeof r.enabled !== 'boolean' || !isMinute(r.startMinute) || !isMinute(r.endMinute)) {
          throw invalid('quietHours: { enabled: boolean, startMinute: 0-1439, endMinute: 0-1439 } or null');
        }
        quiet = { enabled: r.enabled, startMinute: r.startMinute as number, endMinute: r.endMinute as number };
      }
    }
    let previews: boolean | null | undefined;
    if ('showPreviews' in body) {
      if (body.showPreviews !== null && typeof body.showPreviews !== 'boolean') throw invalid('showPreviews: true, false or null');
      previews = body.showPreviews as boolean | null;
    }
    let categories: Array<{ category: string; push: boolean }> = [];
    if ('categories' in body) {
      if (!Array.isArray(body.categories)) throw invalid('categories: [{ category, push }]');
      categories = body.categories.map((raw, i) => {
        const r = (raw ?? {}) as Record<string, unknown>;
        if (typeof r.category !== 'string' || !allowed.has(r.category as NotificationCategory)) {
          throw invalid(`categories[${i}].category: one of ${[...allowed].join(', ')}`);
        }
        if (typeof r.push !== 'boolean') throw invalid(`categories[${i}].push: true or false`);
        if (!r.push && locked.includes(r.category)) throw invalid(`categories[${i}]: ${r.category} cannot be switched off`);
        return { category: r.category, push: r.push };
      });
    }

    await this.prisma.$transaction(async (tx) => {
      if (quiet === null) await tx.quietHours.deleteMany({ where: { actorId: actor.actorId } });
      else if (quiet) {
        await tx.quietHours.upsert({
          where: { actorId: actor.actorId },
          create: { actorId: actor.actorId, organizationId, ...quiet },
          update: quiet,
        });
      }
      if (previews !== undefined) {
        await tx.notificationSettings.upsert({
          where: { actorId: actor.actorId },
          create: { actorId: actor.actorId, organizationId, showPreviews: previews },
          update: { showPreviews: previews },
        });
      }
      for (const c of categories) {
        await tx.notificationPreference.upsert({
          where: { actorId_category_channel: { actorId: actor.actorId, category: c.category, channel: 'push' } },
          create: { actorId: actor.actorId, organizationId, category: c.category, channel: 'push', enabled: c.push },
          update: { enabled: c.push },
        });
      }
    });
    // A push already held for later follows the new settings at once (review P2-6).
    await this.pipeline.reevaluateHeld(new Date(), actor.actorId);
    return this.settings(actor);
  }

  // ------------------------------------------------------------------

  /**
   * The conversations among `ids` this reader can no longer read; their open
   * entries are withdrawn. A conversation that no longer exists counts as lost.
   */
  private async withdrawLostAccess(actor: Actor, ids: readonly string[]): Promise<Set<string>> {
    const lost = new Set<string>();
    for (const id of new Set(ids)) {
      if (!isUuid(id)) {
        lost.add(id);
        continue;
      }
      const conv = await this.prisma.conversation.findUnique({ where: { id } });
      const allowed = conv
        ? (await this.conversations.canReadResolved(actor, conv, await this.conversations.membershipOf(id, actor.actorId))).allowed
        : false;
      if (!allowed) lost.add(id);
    }
    if (lost.size > 0) {
      await this.prisma.$executeRaw`
        UPDATE chat.notification_item SET cancelled_at = now(), cancel_reason = 'access_lost', updated_at = now()
         WHERE recipient_id = ${actor.actorId}::uuid AND cancelled_at IS NULL
           AND refs ->> 'conversationId' = ANY(${[...lost]}::text[])`;
    }
    return lost;
  }

  private visible(recipientId: string, now: Date): Prisma.NotificationItemWhereInput {
    return {
      recipientId,
      cancelledAt: null,
      visibleAt: { lte: now },
      OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
    };
  }

  private categoriesFor(actor: Actor): readonly NotificationCategory[] {
    return CATEGORIES_BY_KIND[actor.kind] ?? NOTIFICATION_CATEGORIES;
  }

  /** Payments is shown to a parent, or to staff who have ever been sent a payment entry. */
  private async tabsFor(actor: Actor): Promise<InboxTab[]> {
    const showPayments = actor.kind === ActorKind.CONTACT
      || (actor.kind === ActorKind.STAFF
        && (await this.prisma.notificationItem.count({ where: { recipientId: actor.actorId, category: 'payment' }, take: 1 })) > 0);
    const showLessons = actor.kind !== ActorKind.STAFF;
    return INBOX_TABS.filter((t) => (t !== 'payments' || showPayments) && (t !== 'lessons' || showLessons));
  }

  private async zoneOf(actorId: string): Promise<{ zone: string; own: boolean }> {
    const own = await this.prisma.actorTimeZone.findUnique({ where: { actorId }, select: { timeZone: true } });
    if (own) return { zone: own.timeZone, own: true };
    const row = await this.prisma.config.findUnique({ where: { key: 'schedule.timezone' } });
    return { zone: canonicalZone(row?.value) ?? ACADEMY_ZONE, own: false };
  }

  private async present(
    r: NotificationItem,
    zone: { zone: string; own: boolean },
    cache: Map<string, { title: string; body: string } | null>,
  ): Promise<InboxEntry> {
    const vars: Record<string, unknown> = { ...((r.variables ?? {}) as Record<string, unknown>), count: r.itemCount };
    const at = typeof vars.startsAt === 'string' ? new Date(vars.startsAt) : null;
    if (at && !Number.isNaN(at.getTime())) {
      const lang = r.locale === 'en' ? 'en' : 'ar';
      vars.time = clockIn(at, zone.zone, lang);
      vars.day = dayIn(at, zone.zone, lang);
    }
    // Never an unfilled {placeholder}: the in-app text, else the lock-screen
    // text of the same notification, else the generic line (inbox-render.ts).
    const raws = [];
    for (const key of inboxCandidates(r.templateKey)) raws.push(await this.raw(key, r.locale, cache));
    const text = renderFirstComplete(raws, vars) ?? { title: '', body: '' };
    return {
      id: r.id,
      category: r.category,
      severity: r.severity,
      title: text.title,
      body: text.body,
      at: r.visibleAt.toISOString(),
      read: r.readAt !== null,
      acted: r.actedAt !== null,
      requiresAction: r.requiresAction,
      dueAt: r.dueAt?.toISOString() ?? null,
      taskStatus: r.taskStatus,
      count: r.itemCount,
      action: (r.action ?? null) as Record<string, string> | null,
      refs: (r.refs ?? {}) as Record<string, string>,
    };
  }

  /** The template row itself, cached per request; interpolation happens per entry. */
  private async raw(
    key: string,
    locale: string,
    cache: Map<string, { title: string; body: string } | null>,
  ): Promise<{ title: string; body: string } | null> {
    const ck = `${key}|${locale}`;
    if (!cache.has(ck)) cache.set(ck, await this.templates.render(key, locale, {}));
    return cache.get(ck) ?? null;
  }

}

function tabWhere(tab: InboxTab): Prisma.NotificationItemWhereInput {
  if (tab === 'unread') return { readAt: null };
  if (tab === 'action') return { requiresAction: true, actedAt: null, OR: [{ taskStatus: null }, { taskStatus: { in: ['open', 'escalated'] } }] };
  const cats = TAB_CATEGORIES[tab];
  return cats ? { category: { in: [...cats] } } : {};
}

function parseTab(v: unknown): InboxTab {
  if (v === undefined || v === null || v === '') return 'all';
  if (typeof v !== 'string' || !(INBOX_TABS as readonly string[]).includes(v)) throw invalid(`tab: one of ${INBOX_TABS.join(', ')}`);
  return v as InboxTab;
}

function parseLimit(v: unknown): number {
  if (v === undefined || v === null || v === '') return PAGE_DEFAULT;
  const n = Number(v);
  if (!Number.isInteger(n) || n < 1 || n > PAGE_MAX) throw invalid(`limit: 1-${PAGE_MAX}`);
  return n;
}

function parseCursor(v: unknown): { at: Date; id: string } | null {
  if (v === undefined || v === null || v === '') return null;
  if (typeof v !== 'string') throw invalid('before: a cursor from a previous page');
  const [iso, id] = v.split('_');
  const at = new Date(iso ?? '');
  if (Number.isNaN(at.getTime()) || !isUuid(id)) throw invalid('before: a cursor from a previous page');
  return { at, id };
}

function isMinute(v: unknown): boolean {
  return typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= 1439;
}

function invalid(reason: string) {
  return new CommError(CommErrorCode.VALIDATION, reason, 400);
}

function notFound() {
  return new CommError(CommErrorCode.NOTIFICATION_NOT_FOUND, 'notification not found', 404);
}

function conversationOf(refs: Prisma.JsonValue): string | null {
  const id = refs && typeof refs === 'object' && !Array.isArray(refs) ? (refs as Record<string, unknown>).conversationId : null;
  return typeof id === 'string' && id.length > 0 ? id : null;
}
