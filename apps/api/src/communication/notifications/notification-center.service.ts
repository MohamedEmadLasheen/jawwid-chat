import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../platform/prisma.service';
import { CommError, CommErrorCode } from '../../platform/errors';
import { NotificationStatus } from '../contracts/vocab';
import { NotificationCategory } from '../contracts/notifications';

export interface NotificationCard {
  id: string;
  type: string | null;
  category: string;
  priority: string;
  title: string;
  body: string;
  createdAt: string;
  readAt: string | null;
  isEssential: boolean;
  deeplink: string | null;
  entityType: string | null;
  entityId: string | null;
  conversationId: string | null;
  /** WHICH CHILD. Present whenever the notification is about one. */
  learnerId: string | null;
  learnerName: string | null;
  senderId: string | null;
  senderName: string | null;
  announcementId: string | null;
  imageUrl: string | null;
}

export interface NotificationPage {
  items: NotificationCard[];
  nextCursor: string | null;
  hasMore: boolean;
}

export interface UnreadCounts {
  total: number;
  byCategory: Record<string, number>;
}

export interface ListQuery {
  category?: string;
  unreadOnly?: boolean;
  cursor?: string;
  limit?: number;
}

const DEFAULT_LIMIT = 30;
const MAX_LIMIT = 100;

/**
 * THE NOTIFICATION CENTRE.
 *
 * Read paths only. Nothing here creates a notification -- creation is the
 * engine's, driven by system events, and a centre that could create would be a
 * way for a client to write into its own history.
 *
 * GROUPING IS NOT APPLIED HERE. A burst from one sender is collapsed at the
 * PUSH -- one buzz, not five -- and the centre keeps every notification,
 * because the centre is the record: a parent looking for what they were told
 * about Tuesday's class needs the notification, not a count of its siblings.
 * Collapsing here would also need a window function partitioned over the whole
 * history to find the newest of each group, which is a full scan per page and
 * is precisely the query this service must not have at a million rows.
 *
 * EVERY QUERY IS SCOPED BY recipient_id, AND recipient_id COMES FROM THE
 * AUTHENTICATED ACTOR, never from a parameter. There is no endpoint, filter or
 * cursor in this service through which one parent can reach another's
 * notifications, and chat.notification's RLS policy enforces the same rule a
 * second time at the database.
 */
@Injectable()
export class NotificationCenterService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * One page of history, newest first.
   *
   * Keyset pagination on (created_at, id), not OFFSET. OFFSET makes page 500
   * scan 15,000 rows and shifts every row when a new notification arrives
   * mid-scroll; a keyset cursor is O(page) at any depth and stable while the
   * list grows underneath the reader, which it constantly does.
   */
  async list(actorId: string, query: ListQuery = {}): Promise<NotificationPage> {
    const limit = Math.min(Math.max(query.limit ?? DEFAULT_LIMIT, 1), MAX_LIMIT);
    const cursor = decodeCursor(query.cursor);

    const where: Prisma.NotificationWhereInput = {
      recipientId: actorId,
      status: { not: NotificationStatus.CANCELLED },
      // An expired announcement leaves the centre on its own. Filtered rather
      // than deleted so the row survives for support and for the audit trail.
      OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
      ...(query.category ? { category: query.category } : {}),
      ...(query.unreadOnly ? { readAt: null } : {}),
      ...(cursor
        ? {
            AND: [
              {
                OR: [
                  { createdAt: { lt: cursor.createdAt } },
                  { createdAt: cursor.createdAt, id: { lt: cursor.id } },
                ],
              },
            ],
          }
        : {}),
    };

    // limit + 1 so hasMore is known without a second COUNT over the history.
    const rows = await this.prisma.notification.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      include: {
        learner: { select: { id: true, name: true } },
        announcement: { select: { id: true, imageUrl: true } },
      },
    });

    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;

    const senderNames = await this.senderNames(page.map((r) => r.senderId));

    const items = page.map((r) => ({
      id: r.id,
      type: r.type,
      category: r.category,
      priority: r.priority,
      title: r.title ?? '',
      body: r.body ?? '',
      createdAt: r.createdAt.toISOString(),
      readAt: r.readAt?.toISOString() ?? null,
      isEssential: r.isEssential,
      deeplink: r.deeplink,
      entityType: r.entityType,
      entityId: r.entityId,
      conversationId: r.conversationId,
      learnerId: r.learner?.id ?? r.learnerId,
      learnerName: r.learner?.name ?? null,
      senderId: r.senderId,
      senderName: r.senderId ? (senderNames.get(r.senderId) ?? null) : null,
      announcementId: r.announcementId,
      imageUrl: r.announcement?.imageUrl ?? null,
    }));

    const last = page.at(-1);
    return {
      items,
      nextCursor: hasMore && last ? encodeCursor(last.createdAt, last.id) : null,
      hasMore,
    };
  }

  /**
   * Unread counts, total and per category.
   *
   * A GROUP BY over an index that contains ONLY unread rows
   * (notification_unread_idx is partial on `read_at is null`). The index does
   * not grow with history: a family with 200,000 read notifications and four
   * unread ones has four index entries, so this stays the same cost forever.
   * That is the difference between a badge that works at a million rows and one
   * that quietly becomes the slowest query in the product.
   */
  async unreadCounts(actorId: string): Promise<UnreadCounts> {
    const grouped = await this.prisma.notification.groupBy({
      by: ['category'],
      where: {
        recipientId: actorId,
        readAt: null,
        status: { not: NotificationStatus.CANCELLED },
        OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
      },
      _count: { _all: true },
    });

    const byCategory: Record<string, number> = {};
    for (const key of Object.values(NotificationCategory)) byCategory[key] = 0;

    let total = 0;
    for (const row of grouped) {
      byCategory[row.category] = row._count._all;
      total += row._count._all;
    }
    return { total, byCategory };
  }

  /**
   * Mark one notification read.
   *
   * Idempotent, and deliberately so: `readAt: null` in the WHERE means a second
   * call changes nothing and the first read time is preserved. A client that
   * retries -- which is exactly what a client on a flaky connection does -- can
   * never move a timestamp that has already been set.
   *
   * Scoped to the caller's own rows. A notification id belonging to somebody
   * else matches nothing and returns `false` rather than an error, because
   * distinguishing "not yours" from "does not exist" tells an attacker which
   * ids are real.
   */
  async markRead(actorId: string, notificationId: string): Promise<boolean> {
    const result = await this.prisma.notification.updateMany({
      where: { id: notificationId, recipientId: actorId, readAt: null },
      data: { readAt: new Date() },
    });
    return result.count > 0;
  }

  /**
   * Mark everything read, optionally within one category.
   *
   * Bounded by `readAt: null`, so running it twice touches nothing the second
   * time and the cost is proportional to what is actually unread rather than to
   * the size of the history.
   */
  async markAllRead(actorId: string, category?: string): Promise<number> {
    const result = await this.prisma.notification.updateMany({
      where: {
        recipientId: actorId,
        readAt: null,
        ...(category ? { category } : {}),
      },
      data: { readAt: new Date() },
    });
    return result.count;
  }

  /**
   * Mark every notification that points at a conversation read.
   *
   * Opening a thread is the same act as reading its notifications; making the
   * parent dismiss them again in a second place is the kind of friction that
   * teaches people to ignore the badge.
   */
  async markConversationRead(actorId: string, conversationId: string): Promise<number> {
    const result = await this.prisma.notification.updateMany({
      where: { recipientId: actorId, conversationId, readAt: null },
      data: { readAt: new Date() },
    });
    return result.count;
  }

  /**
   * One notification, for the deep-link landing.
   *
   * Authorization is the WHERE clause. A notification that is not this actor's
   * is not found, so a guessed id yields nothing.
   */
  async byId(actorId: string, notificationId: string): Promise<NotificationCard> {
    const direct = await this.prisma.notification.findFirst({
      where: { id: notificationId, recipientId: actorId },
      include: {
        learner: { select: { id: true, name: true } },
        announcement: { select: { id: true, imageUrl: true } },
      },
    });
    if (!direct) {
      throw new CommError(
        CommErrorCode.MESSAGE_NOT_FOUND,
        'notification not found',
        404,
      );
    }

    const senderNames = await this.senderNames([direct.senderId]);

    return {
      id: direct.id,
      type: direct.type,
      category: direct.category,
      priority: direct.priority,
      title: direct.title ?? '',
      body: direct.body ?? '',
      createdAt: direct.createdAt.toISOString(),
      readAt: direct.readAt?.toISOString() ?? null,
      isEssential: direct.isEssential,
      deeplink: direct.deeplink,
      entityType: direct.entityType,
      entityId: direct.entityId,
      conversationId: direct.conversationId,
      learnerId: direct.learner?.id ?? direct.learnerId,
      learnerName: direct.learner?.name ?? null,
      senderId: direct.senderId,
      senderName: direct.senderId ? (senderNames.get(direct.senderId) ?? null) : null,
      announcementId: direct.announcementId,
      imageUrl: direct.announcement?.imageUrl ?? null,
    };
  }

  // -- internals ------------------------------------------------------------

  /**
   * Sender display names.
   *
   * Three small IN queries rather than N identity lookups across the page. A
   * name and nothing else: Actor has no phone or email field and neither does
   * this.
   */
  private async senderNames(ids: Array<string | null>): Promise<Map<string, string>> {
    const unique = [...new Set(ids.filter((id): id is string => !!id))];
    if (unique.length === 0) return new Map();

    const [staff, contacts, teachers] = await Promise.all([
      this.prisma.staff.findMany({ where: { id: { in: unique } }, select: { id: true, name: true } }),
      this.prisma.contact.findMany({ where: { id: { in: unique } }, select: { id: true, name: true } }),
      this.prisma.teacher.findMany({ where: { id: { in: unique } }, select: { id: true, name: true } }),
    ]);

    return new Map([...staff, ...contacts, ...teachers].map((r) => [r.id, r.name]));
  }
}

/**
 * Keyset cursor. Opaque to the client on purpose: it is a position, not an
 * offset it may arithmetic on, and base64 stops a client building one by hand
 * and paging into somebody else's ordering.
 */
function encodeCursor(createdAt: Date, id: string): string {
  return Buffer.from(`${createdAt.toISOString()}|${id}`).toString('base64url');
}

function decodeCursor(cursor?: string): { createdAt: Date; id: string } | null {
  if (!cursor) return null;
  try {
    const [at, id] = Buffer.from(cursor, 'base64url').toString('utf8').split('|');
    const createdAt = new Date(at);
    if (Number.isNaN(createdAt.getTime()) || !id) return null;
    return { createdAt, id };
  } catch {
    // A malformed cursor reads as "start from the beginning" rather than as an
    // error: a stale bookmark should show the newest page, not a red screen.
    return null;
  }
}
