import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../platform/prisma.service';
import { NotificationService } from './notification.service';
import { ruleEventNotificationType } from '../contracts/notifications';

export interface ReminderContext {
  /** Stable id of the thing being reminded about: a session, an invoice, a subscription. */
  subjectId: string;
  /** The time the rule offsets are measured from. */
  anchorAt: Date;
  recipients: Array<{ actorId: string; locale?: string; role: string }>;
  familyId?: string | null;
  conversationId?: string | null;
  /** The child this reminder is about. Carried so the copy can name them. */
  learnerId?: string | null;
  learnerName?: string | null;
  variables?: Record<string, unknown>;
}

/**
 * The reminder engine.
 *
 * A reminder schedule is data: rows in chat.notification_rule. Adding "remind
 * again 10 days after the due date" is an INSERT, not a code change, and no
 * business logic here knows what T-24h or D-7 mean.
 *
 * Every scheduled instance gets a deterministic dedupe key built from
 * (rule, subject, recipient), so re-running a sweep - or replaying an event -
 * converges on exactly one notification per rule per subject per recipient.
 */
@Injectable()
export class ReminderService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationService,
  ) {}

  static dedupeKey(ruleKey: string, subjectId: string, recipientId: string): string {
    return `${ruleKey}:${subjectId}:${recipientId}`;
  }

  /**
   * Schedules every enabled rule for an event type.
   * Returns the number of notification rows that now exist for this subject.
   */
  async scheduleForEvent(eventType: string, ctx: ReminderContext): Promise<number> {
    const rules = await this.prisma.notificationRule.findMany({
      where: { eventType, enabled: true },
    });

    // A rule says WHEN; the registry says WHAT. A rule naming an event this
    // product has no notification type for is skipped rather than guessed at:
    // an operator who enables a rule for an event nobody produces should get
    // nothing, not a notification with invented semantics.
    const type = ruleEventNotificationType(eventType);
    if (!type) return 0;

    let count = 0;
    for (const rule of rules) {
      const scheduledAt = new Date(ctx.anchorAt.getTime() + rule.offsetSeconds * 1000);

      for (const recipient of ctx.recipients) {
        // A rule targets one role; "participant" means everyone given.
        if (rule.recipientRole !== 'participant' && rule.recipientRole !== recipient.role) {
          continue;
        }

        await this.notifications.schedule({
          dedupeKey: ReminderService.dedupeKey(rule.key, ctx.subjectId, recipient.actorId),
          type,
          ruleKey: rule.key,
          templateKey: rule.templateKey,
          eventType,
          recipientId: recipient.actorId,
          locale: recipient.locale ?? 'ar',
          priority: rule.priority,
          familyId: ctx.familyId ?? null,
          conversationId: ctx.conversationId ?? null,
          learnerId: ctx.learnerId ?? null,
          learnerName: ctx.learnerName ?? null,
          variables: ctx.variables ?? {},
          scheduledAt,
          // The rule's own exemptions, which are data by design.
          bypassQuietHours: !rule.respectQuietHours,
          inAppOnly: rule.channel === 'in_app',
        });
        count += 1;
      }
    }
    return count;
  }

  /**
   * Cancels still-scheduled reminders for a subject - a class that was
   * cancelled, an invoice that was paid. Already-sent notifications are left
   * alone; history is not rewritten.
   */
  async cancelForSubject(subjectId: string): Promise<number> {
    const result = await this.prisma.notification.updateMany({
      where: {
        status: 'scheduled',
        dedupeKey: { contains: `:${subjectId}:` },
      },
      data: { status: 'cancelled' },
    });
    return result.count;
  }
}
