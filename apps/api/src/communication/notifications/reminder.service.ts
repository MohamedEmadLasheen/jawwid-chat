import { Injectable, Optional } from '@nestjs/common';
import { PrismaService } from '../../platform/prisma.service';
import { NotificationService } from './notification.service';
import { NotificationPipeline } from './notification-pipeline.service';

export interface ReminderContext {
  /** Stable id of the thing being reminded about: a session, an invoice, a subscription. */
  subjectId: string;
  /** The time the rule offsets are measured from. */
  anchorAt: Date;
  recipients: Array<{ actorId: string; locale?: string; role: string }>;
  familyId?: string | null;
  conversationId?: string | null;
  variables?: Record<string, unknown>;
  /**
   * Skip a rule whose moment has already passed (PD-11: a "tomorrow" reminder
   * for a lesson booked two hours ahead would arrive at once and be wrong).
   * Off by default: a payment reminder anchored in the past is still owed.
   */
  skipPast?: boolean;
  /** PD-34: what the subject is (lesson, instalment...), for the Notification Center. */
  subjectType?: string;
  /** PD-34: ids the Center's button opens (lessonId, learnerId, instalmentId...). */
  refs?: Record<string, string | null | undefined>;
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
    // PD-34: with the pipeline, every reminder is also a Notification Center
    // entry and obeys preferences and the default quiet hours. Optional so a
    // hand-built engine behaves exactly as before.
    @Optional() private readonly pipeline?: NotificationPipeline,
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

    let count = 0;
    for (const rule of rules) {
      const scheduledAt = new Date(ctx.anchorAt.getTime() + rule.offsetSeconds * 1000);
      if (ctx.skipPast && scheduledAt.getTime() < Date.now()) continue;

      for (const recipient of ctx.recipients) {
        // A rule targets one role; "participant" means everyone given.
        if (rule.recipientRole !== 'participant' && rule.recipientRole !== recipient.role) {
          continue;
        }

        if (this.pipeline) {
          await this.pipeline.emit({
            dedupeKey: ReminderService.dedupeKey(rule.key, ctx.subjectId, recipient.actorId),
            ruleKey: rule.key,
            templateKey: rule.templateKey,
            eventType,
            recipientId: recipient.actorId,
            locale: recipient.locale ?? 'ar',
            channel: rule.channel,
            priority: rule.priority,
            familyId: ctx.familyId ?? null,
            conversationId: ctx.conversationId ?? null,
            subject: { type: ctx.subjectType ?? eventType, id: ctx.subjectId },
            refs: ctx.refs,
            variables: ctx.variables ?? {},
            scheduledAt,
            respectQuietHours: rule.respectQuietHours,
            basis: recipient.role,
            reviveCancelled: true,
          });
          count += 1;
          continue;
        }

        await this.notifications.schedule({
          dedupeKey: ReminderService.dedupeKey(rule.key, ctx.subjectId, recipient.actorId),
          ruleKey: rule.key,
          templateKey: rule.templateKey,
          eventType,
          recipientId: recipient.actorId,
          locale: recipient.locale ?? 'ar',
          channel: rule.channel,
          priority: rule.priority,
          familyId: ctx.familyId ?? null,
          conversationId: ctx.conversationId ?? null,
          variables: ctx.variables ?? {},
          scheduledAt,
          respectQuietHours: rule.respectQuietHours,
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
    // Center entries not shown yet go too (those with a delivery already went
    // with it, by trigger; this reaches one whose push was switched off).
    await this.pipeline?.cancelSubject(subjectId, 'subject_gone');
    return result.count;
  }
}
