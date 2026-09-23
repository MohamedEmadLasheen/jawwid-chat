import { Inject, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../platform/prisma.service';
import { CommError, CommErrorCode } from '../../platform/errors';
import { AUDIT_SERVICE } from '../../platform/tokens';
import type { AuditService } from '../../platform/audit.service';
import { Actor } from '../../platform/types';
import { NotificationService } from '../notifications/notification.service';
import { RecipientResolver } from '../notifications/recipient-resolver.service';
import { StaffRole } from '../contracts/vocab';
import { announcementNotificationType, definitionOf } from '../contracts/notifications';

export interface CreateAnnouncementInput {
  titleAr: string;
  bodyAr: string;
  titleEn?: string | null;
  bodyEn?: string | null;
  priority?: 'normal' | 'important' | 'urgent';
  targetType: string;
  targetIds?: string[];
  imageUrl?: string | null;
  actionLabelAr?: string | null;
  actionLabelEn?: string | null;
  actionUrl?: string | null;
  publishAt?: Date;
  expiresAt?: Date | null;
}

/** Who may publish at all, and who may publish at urgent priority. */
const MAY_PUBLISH: ReadonlySet<string> = new Set([
  StaffRole.ADMIN,
  StaffRole.MANAGER,
  StaffRole.COVERAGE,
]);
const MAY_PUBLISH_URGENT: ReadonlySet<string> = new Set([StaffRole.ADMIN, StaffRole.MANAGER]);

/**
 * Academy announcements.
 *
 * An announcement is an ENTITY, not a special kind of push. Publishing one
 * produces ordinary notifications through the ordinary engine, which is what
 * gives it deduplication, preferences, quiet hours, per-device delivery
 * tracking, read state, deep linking and history for free -- and what stops
 * "announcements" becoming a second notification system beside the first.
 *
 * URGENT IS RATIONED. It bypasses quiet hours and mutes; if every notice is
 * urgent then nothing is, and a parent who has been woken at 2am by a timetable
 * reminder stops trusting the one that matters. Only an admin or a manager may
 * declare it, enforced here AND by a trigger on chat.announcement, so neither a
 * bug in this service nor a client talking to the database directly can make an
 * announcement shout.
 */
@Injectable()
export class AnnouncementService {
  private readonly log = new Logger(AnnouncementService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationService,
    private readonly recipients: RecipientResolver,
    @Inject(AUDIT_SERVICE) private readonly audit: AuditService,
  ) {}

  async create(author: Actor, input: CreateAnnouncementInput) {
    this.requirePublisher(author, input.priority ?? 'normal');

    const targetIds = input.targetIds ?? [];
    const needsIds = !['all_parents', 'all_teachers', 'all_staff'].includes(input.targetType);
    if (needsIds && targetIds.length === 0) {
      throw new CommError(
        CommErrorCode.INVALID_PARTICIPANTS,
        `target_type ${input.targetType} requires target_ids`,
        400,
      );
    }

    return this.prisma.announcement.create({
      data: {
        titleAr: input.titleAr,
        bodyAr: input.bodyAr,
        titleEn: input.titleEn ?? null,
        bodyEn: input.bodyEn ?? null,
        priority: input.priority ?? 'normal',
        targetType: input.targetType,
        targetIds,
        imageUrl: input.imageUrl ?? null,
        actionLabelAr: input.actionLabelAr ?? null,
        actionLabelEn: input.actionLabelEn ?? null,
        actionUrl: input.actionUrl ?? null,
        publishAt: input.publishAt ?? new Date(),
        expiresAt: input.expiresAt ?? null,
        createdBy: author.actorId,
        status: 'draft',
      },
    });
  }

  /**
   * Publish. Fan-out happens on the sweep, not here, so a 40,000-parent
   * announcement does not run inside an admin's HTTP request.
   */
  async publish(author: Actor, announcementId: string) {
    const announcement = await this.prisma.announcement.findUnique({
      where: { id: announcementId },
    });
    if (!announcement) {
      throw new CommError(CommErrorCode.MESSAGE_NOT_FOUND, 'announcement not found', 404);
    }
    this.requirePublisher(author, announcement.priority);

    if (announcement.status === 'published') return announcement;
    if (announcement.status === 'cancelled') {
      throw new CommError(
        CommErrorCode.APPROVAL_ALREADY_DECIDED,
        'a cancelled announcement cannot be published',
        409,
      );
    }

    // Publishing and its audit row commit together. An announcement that
    // reaches every parent in the academy and leaves no record of who sent it
    // is not something this system should be able to do.
    return this.prisma.$transaction(async (tx) => {
      const published = await tx.announcement.update({
        where: { id: announcementId },
        data: { status: 'published', publishedAt: new Date() },
      });

      await this.audit.audit(tx, {
        actorId: author.actorId,
        action: 'announcement_published',
        entity: 'announcement',
        entityId: announcementId,
        after: {
          priority: published.priority,
          targetType: published.targetType,
          // The COUNT, never the ids. An audit row is not a mailing list.
          targetCount: published.targetIds.length,
        },
        reason: 'academy announcement published',
      });

      return published;
    });
  }

  /**
   * Cancelling stops future fan-out. It does NOT retract notifications already
   * sent: a parent who was told something was told it, and silently deleting
   * that from their history would make the centre unreliable as a record.
   * Setting `expiresAt` is how an announcement leaves the centre.
   */
  async cancel(author: Actor, announcementId: string) {
    this.requirePublisher(author, 'normal');
    return this.prisma.announcement.update({
      where: { id: announcementId },
      data: { status: 'cancelled' },
    });
  }

  /**
   * Fan out every announcement that is due.
   *
   * IDEMPOTENT BY CONSTRUCTION. The dedupe key is
   * `announcement:{id}:{recipient}`, so re-running the sweep, a worker restart
   * mid-fan-out, or a second worker running concurrently all converge on
   * exactly one notification per recipient. `fanned_out_at` is an observability
   * marker, not a lock -- correctness does not depend on it being set.
   */
  async fanOutDue(now = new Date(), batchSize = 20): Promise<number> {
    const due = await this.prisma.announcement.findMany({
      where: { status: 'published', publishAt: { lte: now }, fannedOutAt: null },
      orderBy: { publishAt: 'asc' },
      take: batchSize,
    });

    let total = 0;
    for (const announcement of due) {
      total += await this.fanOut(announcement.id, now);
    }
    return total;
  }

  async fanOut(announcementId: string, now = new Date()): Promise<number> {
    const announcement = await this.prisma.announcement.findUnique({
      where: { id: announcementId },
    });
    if (!announcement || announcement.status !== 'published') return 0;

    const type = announcementNotificationType(announcement.priority);
    const definition = definitionOf(type);
    const audience = await this.recipients.forAudience(
      announcement.targetType,
      announcement.targetIds,
    );

    let created = 0;
    for (const recipient of audience) {
      // The announcement's own words, in the recipient's language, with the
      // English falling back to Arabic exactly as notification templates do.
      const useEnglish = recipient.locale === 'en' && announcement.titleEn && announcement.bodyEn;
      const title = useEnglish ? announcement.titleEn! : announcement.titleAr;
      const body = useEnglish ? announcement.bodyEn! : announcement.bodyAr;

      const result = await this.notifications.schedule({
        dedupeKey: `announcement:${announcement.id}:${recipient.actorId}`,
        type,
        eventType: 'announcement_published',
        recipientId: recipient.actorId,
        locale: recipient.locale,
        templateKey: definition.templateKey,
        announcementId: announcement.id,
        variables: { announcement_title: title, announcement_body: body },
        scheduledAt: now,
        expiresAt: announcement.expiresAt,
      });
      if (result.created) created += 1;
    }

    await this.prisma.announcement.update({
      where: { id: announcement.id },
      data: { fannedOutAt: new Date(), recipientCount: audience.length },
    });

    this.log.log(
      `announcement ${announcement.id} fanned out to ${audience.length} recipient(s), ${created} new`,
    );
    return created;
  }

  /**
   * The admin list.
   *
   * Staff-facing, so it DOES carry targeting and authorship -- an admin needs to
   * see who an announcement went to and who sent it. That is exactly why it is a
   * separate method from readForActor(), which is the parent's view and carries
   * neither: one read path that decided what to include from the caller's role
   * would be one `if` away from showing a parent the audience list.
   *
   * Keyset-paginated on (publish_at, id), the same shape as the notification
   * centre and for the same reason: an academy accumulates announcements
   * forever, and OFFSET makes page 50 scan everything before it.
   */
  async list(
    actor: Actor,
    query: { status?: string; cursor?: string; limit?: number } = {},
  ) {
    if (actor.kind !== 'staff' || !MAY_PUBLISH.has(actor.staffRole ?? '')) {
      throw new CommError(
        CommErrorCode.ROLE_CANNOT_MESSAGE_FAMILY,
        'this role may not read academy announcements',
      );
    }

    const limit = Math.min(Math.max(query.limit ?? 25, 1), 100);
    const cursor = decodeCursor(query.cursor);

    const rows = await this.prisma.announcement.findMany({
      where: {
        ...(query.status ? { status: query.status } : {}),
        ...(cursor
          ? {
              OR: [
                { publishAt: { lt: cursor.publishAt } },
                { publishAt: cursor.publishAt, id: { lt: cursor.id } },
              ],
            }
          : {}),
      },
      orderBy: [{ publishAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
    });

    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    const authors = await this.authorNames(page.map((a) => a.createdBy));

    const last = page.at(-1);
    return {
      items: page.map((a) => ({
        id: a.id,
        titleAr: a.titleAr,
        bodyAr: a.bodyAr,
        titleEn: a.titleEn,
        bodyEn: a.bodyEn,
        priority: a.priority,
        targetType: a.targetType,
        // The COUNT, not the ids. An admin needs to know how wide an
        // announcement went; naming the families serves nothing and puts a
        // roster on a screen that does not need one.
        targetCount: a.targetIds.length,
        status: a.status,
        publishAt: a.publishAt.toISOString(),
        expiresAt: a.expiresAt?.toISOString() ?? null,
        publishedAt: a.publishedAt?.toISOString() ?? null,
        fannedOutAt: a.fannedOutAt?.toISOString() ?? null,
        recipientCount: a.recipientCount,
        createdBy: a.createdBy,
        createdByName: authors.get(a.createdBy) ?? null,
        createdAt: a.createdAt.toISOString(),
      })),
      nextCursor: hasMore && last ? encodeCursor(last.publishAt, last.id) : null,
      hasMore,
    };
  }

  private async authorNames(ids: string[]): Promise<Map<string, string>> {
    const unique = [...new Set(ids)];
    if (unique.length === 0) return new Map();
    const staff = await this.prisma.staff.findMany({
      where: { id: { in: unique } },
      select: { id: true, name: true },
    });
    return new Map(staff.map((s) => [s.id, s.name]));
  }

  /**
   * The deep-link read.
   *
   * Authorization is a notification the fan-out created for this actor, never
   * the announcement's own targeting: reading target_ids would tell a parent
   * which other families were addressed. Mirrors the RLS policy on
   * chat.announcement.
   */
  async readForActor(actorId: string, announcementId: string) {
    const notification = await this.prisma.notification.findFirst({
      where: { announcementId, recipientId: actorId },
      select: { id: true, locale: true },
    });
    if (!notification) {
      throw new CommError(CommErrorCode.MESSAGE_NOT_FOUND, 'announcement not found', 404);
    }

    const announcement = await this.prisma.announcement.findUnique({
      where: { id: announcementId },
    });
    if (!announcement || announcement.status !== 'published') {
      throw new CommError(CommErrorCode.MESSAGE_NOT_FOUND, 'announcement not found', 404);
    }
    if (announcement.expiresAt && announcement.expiresAt <= new Date()) {
      throw new CommError(
        CommErrorCode.MESSAGE_NOT_FOUND,
        'this announcement has expired',
        410,
      );
    }

    const useEnglish =
      notification.locale === 'en' && announcement.titleEn && announcement.bodyEn;

    // Explicit field mapping. target_type, target_ids and created_by never
    // reach a parent.
    return {
      id: announcement.id,
      title: useEnglish ? announcement.titleEn : announcement.titleAr,
      body: useEnglish ? announcement.bodyEn : announcement.bodyAr,
      priority: announcement.priority,
      imageUrl: announcement.imageUrl,
      actionLabel: useEnglish ? announcement.actionLabelEn : announcement.actionLabelAr,
      actionUrl: announcement.actionUrl,
      publishedAt: announcement.publishedAt?.toISOString() ?? null,
      expiresAt: announcement.expiresAt?.toISOString() ?? null,
    };
  }

  private requirePublisher(author: Actor, priority: string): void {
    if (author.kind !== 'staff' || !MAY_PUBLISH.has(author.staffRole ?? '')) {
      throw new CommError(
        CommErrorCode.ROLE_CANNOT_MESSAGE_FAMILY,
        'this role may not publish academy announcements',
      );
    }
    if (priority === 'urgent' && !MAY_PUBLISH_URGENT.has(author.staffRole ?? '')) {
      throw new CommError(
        CommErrorCode.ROLE_CANNOT_MESSAGE_FAMILY,
        'only an admin or a manager may publish an urgent announcement',
      );
    }
  }
}

/** Keyset cursor, opaque to the client. Same shape as the notification centre. */
function encodeCursor(publishAt: Date, id: string): string {
  return Buffer.from(`${publishAt.toISOString()}|${id}`).toString('base64url');
}

function decodeCursor(cursor?: string): { publishAt: Date; id: string } | null {
  if (!cursor) return null;
  try {
    const [at, id] = Buffer.from(cursor, 'base64url').toString('utf8').split('|');
    const publishAt = new Date(at);
    if (Number.isNaN(publishAt.getTime()) || !id) return null;
    return { publishAt, id };
  } catch {
    // A stale bookmark shows the newest page rather than an error.
    return null;
  }
}
