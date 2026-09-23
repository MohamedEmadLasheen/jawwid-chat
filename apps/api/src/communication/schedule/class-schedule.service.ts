import { Inject, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../platform/prisma.service';
import { CommError, CommErrorCode } from '../../platform/errors';
import { AUDIT_SERVICE } from '../../platform/tokens';
import type { AuditService } from '../../platform/audit.service';
import { Actor } from '../../platform/types';
import { NotificationService } from '../notifications/notification.service';
import { RecipientResolver, ResolvedRecipient } from '../notifications/recipient-resolver.service';
import { NotificationStatus, StaffRole } from '../contracts/vocab';
import { NotificationType } from '../contracts/notifications';

/** Who may move a family's class. */
const MAY_RESCHEDULE: ReadonlySet<string> = new Set([
  StaffRole.ADMIN,
  StaffRole.MANAGER,
  StaffRole.COVERAGE,
  StaffRole.ACADEMIC,
]);

export interface RescheduleInput {
  learnerId: string;
  /** null cancels the class. */
  nextClassAt: Date | null;
  reason: string;
}

/**
 * CLASS SCHEDULE -- the write path, and therefore the event.
 *
 * `chat.learner.next_class_at` already existed as data, ingested from Jawwid
 * Core and read by the attention engine. Nothing in this product ever wrote it,
 * so "the class moved" was not an event and could not be notified on. This
 * service is that write path: it is the smallest thing that turns an existing
 * column into a real domain event with a before and an after.
 *
 * THE OLD VALUE IS THE POINT. A parent needs "moved FROM 5:00 PM TO 6:00 PM",
 * not "your class is at 6:00 PM" -- the second sentence is useless to someone
 * who has already left the house. The old time is captured here, rendered into
 * the notification's title and body at creation, and frozen there, so a second
 * reschedule two hours later cannot rewrite what the first one said.
 *
 * TIMEZONE. Times are rendered in the FAMILY'S timezone, taken from their quiet
 * hours row, not the server's. A Gulf family reading "moved to 6:00 PM" must be
 * reading their own 6:00 PM; a backend hosted in Europe rendering its own
 * afternoon is how a child misses a class while the system reports success.
 */
@Injectable()
export class ClassScheduleService {
  private readonly log = new Logger(ClassScheduleService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationService,
    private readonly recipients: RecipientResolver,
    @Inject(AUDIT_SERVICE) private readonly audit: AuditService,
  ) {}

  async reschedule(actor: Actor, input: RescheduleInput): Promise<{ notified: number }> {
    if (actor.kind !== 'staff' || !MAY_RESCHEDULE.has(actor.staffRole ?? '')) {
      throw new CommError(
        CommErrorCode.ROLE_CANNOT_MESSAGE_FAMILY,
        'this role may not change a class schedule',
      );
    }
    if (!input.reason?.trim()) {
      throw new CommError(
        CommErrorCode.APPROVAL_REASON_REQUIRED,
        'a schedule change requires a reason',
        400,
      );
    }

    const learner = await this.prisma.learner.findUnique({ where: { id: input.learnerId } });
    if (!learner) {
      throw new CommError(CommErrorCode.MESSAGE_NOT_FOUND, 'learner not found', 404);
    }

    const previous = learner.nextClassAt;
    const next = input.nextClassAt;

    // Nothing changed. Returning early rather than notifying is not an
    // optimisation -- a "your class moved" push for a class that did not move
    // is the exact thing that teaches parents to ignore these.
    if (previous?.getTime() === next?.getTime()) return { notified: 0 };

    await this.prisma.$transaction(async (tx) => {
      await tx.learner.update({
        where: { id: learner.id },
        data: { nextClassAt: next },
      });
      await this.audit.audit(tx, {
        actorId: actor.actorId,
        action: next ? 'class_rescheduled' : 'class_cancelled',
        entity: 'learner',
        entityId: learner.id,
        before: { nextClassAt: previous?.toISOString() ?? null },
        after: { nextClassAt: next?.toISOString() ?? null },
        reason: input.reason,
      });
    });

    // Reminders for the OLD time are now wrong. Cancel them before scheduling
    // the new ones, or a parent gets reminded about a class that has moved.
    await this.cancelPendingReminders(learner.id);

    const parents = await this.recipients.forLearner(learner.id);
    const notified = await this.notifyScheduleChange(learner.id, parents, previous, next);

    if (next) await this.scheduleReminders(learner.id, parents, next);

    return { notified };
  }

  /**
   * Schedule the reminder rules for a learner's next class.
   *
   * Reminders are SERVER-SIDE and data-driven: rows in chat.notification_rule
   * define T-24h, T-30m and T-10m, and this writes one notification per rule
   * per parent with a scheduled_at in the future. Nothing depends on the app
   * being open, the browser running, the phone being online, the parent being
   * signed in, or the device having stayed awake -- a client-side timer would
   * fail every one of those cases, and they are all normal.
   */
  async scheduleReminders(
    learnerId: string,
    parents: ResolvedRecipient[],
    classAt: Date,
  ): Promise<number> {
    const rules = await this.prisma.notificationRule.findMany({
      where: { eventType: 'class_scheduled', enabled: true },
    });

    const learner = await this.prisma.learner.findUnique({
      where: { id: learnerId },
      select: { name: true, familyId: true },
    });
    if (!learner) return 0;

    const now = new Date();
    let scheduled = 0;

    for (const rule of rules) {
      const fireAt = new Date(classAt.getTime() + rule.offsetSeconds * 1000);
      // A reminder whose moment has passed is not sent late; it is not sent.
      // "Your class starts in 30 minutes" delivered an hour afterwards is
      // actively misleading.
      if (fireAt <= now) continue;

      for (const parent of parents) {
        if (rule.recipientRole !== 'participant' && rule.recipientRole !== 'parent') continue;

        const zone = await this.timezoneFor(parent.actorId);
        const result = await this.notifications.schedule({
          // Deterministic, and it includes the class time: moving the class
          // produces a DIFFERENT key, so the new reminder is genuinely new
          // rather than deduplicated against the cancelled one.
          dedupeKey: `${rule.key}:${learnerId}:${classAt.toISOString()}:${parent.actorId}`,
          type: NotificationType.CLASS_REMINDER,
          eventType: 'class_scheduled',
          ruleKey: rule.key,
          templateKey: rule.templateKey,
          priority: rule.priority,
          recipientId: parent.actorId,
          locale: parent.locale,
          familyId: learner.familyId,
          learnerId,
          learnerName: learner.name,
          variables: {
            student_name: learner.name,
            parent_name: parent.displayName,
            class_time: formatTime(classAt, zone, parent.locale),
            class_date: formatDate(classAt, zone, parent.locale),
          },
          scheduledAt: fireAt,
        });
        if (result.created) scheduled += 1;
      }
    }
    return scheduled;
  }

  /**
   * Cancel reminders that have not gone out yet.
   *
   * Only `scheduled` rows are touched. An already-sent notification is left
   * exactly as it was: history is not rewritten, and a parent who was reminded
   * about the 5:00 class was reminded about the 5:00 class.
   */
  async cancelPendingReminders(learnerId: string): Promise<number> {
    const result = await this.prisma.notification.updateMany({
      where: {
        learnerId,
        status: NotificationStatus.SCHEDULED,
        eventType: 'class_scheduled',
      },
      data: { status: NotificationStatus.CANCELLED },
    });
    return result.count;
  }

  private async notifyScheduleChange(
    learnerId: string,
    parents: ResolvedRecipient[],
    previous: Date | null,
    next: Date | null,
  ): Promise<number> {
    const learner = await this.prisma.learner.findUnique({
      where: { id: learnerId },
      select: { name: true, familyId: true },
    });
    if (!learner) return 0;

    const now = new Date();
    let notified = 0;

    for (const parent of parents) {
      const zone = await this.timezoneFor(parent.actorId);

      // Three genuinely different sentences, not one with blanks: "we moved
      // your class", "we cancelled your class" and "you have a class now" are
      // not the same news.
      const { type, variables } = (() => {
        if (next && previous) {
          return {
            type: NotificationType.CLASS_SCHEDULE_CHANGED,
            variables: {
              old_time: formatTime(previous, zone, parent.locale),
              old_date: formatDate(previous, zone, parent.locale),
              new_time: formatTime(next, zone, parent.locale),
              new_date: formatDate(next, zone, parent.locale),
            },
          };
        }
        if (next) {
          return {
            type: NotificationType.CLASS_SCHEDULED,
            variables: {
              new_time: formatTime(next, zone, parent.locale),
              new_date: formatDate(next, zone, parent.locale),
            },
          };
        }
        return {
          type: NotificationType.CLASS_CANCELLED,
          variables: {
            old_time: previous ? formatTime(previous, zone, parent.locale) : '',
            old_date: previous ? formatDate(previous, zone, parent.locale) : '',
          },
        };
      })();

      const result = await this.notifications.schedule({
        // Keyed on the transition, so replaying the same change is one
        // notification and a genuinely new change is a new one.
        dedupeKey:
          `class_change:${learnerId}:${previous?.toISOString() ?? 'none'}` +
          `>${next?.toISOString() ?? 'none'}:${parent.actorId}`,
        type,
        eventType: next ? 'schedule_changed' : 'class_cancelled',
        recipientId: parent.actorId,
        locale: parent.locale,
        familyId: learner.familyId,
        learnerId,
        learnerName: learner.name,
        variables: { ...variables, student_name: learner.name, parent_name: parent.displayName },
        scheduledAt: now,
      });
      if (result.created) notified += 1;
    }

    this.log.log(`learner ${learnerId} schedule change notified ${notified} parent(s)`);
    return notified;
  }

  /**
   * The recipient's own timezone.
   *
   * chat.quiet_hours already carries a per-actor timezone and is the only
   * per-person timezone this schema has, so it is the one used rather than
   * inventing a second column that could disagree with it. The default is Gulf
   * time, not the server's: the academy's families are there and the servers
   * are not.
   */
  private async timezoneFor(actorId: string): Promise<string> {
    const row = await this.prisma.quietHours.findUnique({
      where: { actorId },
      select: { timezone: true },
    });
    return row?.timezone ?? 'Asia/Riyadh';
  }
}

/** 6:00 PM / ٦:٠٠ م, in the recipient's zone. Never the server's. */
export function formatTime(at: Date, timeZone: string, locale: string): string {
  return new Intl.DateTimeFormat(locale === 'en' ? 'en-GB' : 'ar-SA', {
    timeZone,
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  }).format(at);
}

/** Tuesday 23 September, in the recipient's zone. */
export function formatDate(at: Date, timeZone: string, locale: string): string {
  return new Intl.DateTimeFormat(locale === 'en' ? 'en-GB' : 'ar-SA', {
    timeZone,
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  }).format(at);
}
