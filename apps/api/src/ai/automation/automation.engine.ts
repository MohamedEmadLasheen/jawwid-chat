import { Injectable, Logger } from '@nestjs/common';
import { Prisma, type AutomationRule } from '@prisma/client';
import { PrismaService } from '../../platform/prisma.service';
import { SYSTEM_ACTOR } from '../../platform/types';
import { CommError } from '../../platform/errors';
import { MessageService } from '../../communication/messages/message.service';
import { NotificationService } from '../../communication/notifications/notification.service';
import { ConversationService } from '../../communication/conversations/conversation.service';
import { AttentionService } from '../risk/attention.service';
import { ConditionEvaluator } from './condition.evaluator';
import {
  ActionType,
  Outcome,
  type Condition,
  type TriggerEvent,
} from './automation.types';

export interface RunResult {
  readonly outcome: Outcome;
  readonly detail: string;
  readonly ruleKey: string;
}

/**
 * The automation engine: trigger -> condition -> action.
 *
 * ## Idempotency is the database's job, not this class's
 *
 * `chat.automation_run` has a unique index on (rule_key, subject_id,
 * occurrence_key), and this engine CLAIMS the occurrence by inserting that row
 * BEFORE it acts. A duplicate insert raises P2002 and the run stops there.
 *
 * The ordering is the point. Claiming first and acting second means a second
 * worker cannot act at all; acting first and recording second would mean two
 * workers both send the reminder and then discover they collided. Phase 7 §25
 * asks that a job running twice does not send twice, and only claim-then-act
 * delivers that under concurrency.
 *
 * The cost is a crash between claim and action, which loses that occurrence
 * rather than repeating it. For reminders that is the right way to fail: a
 * family who does not get a duplicate 6am reminder has lost nothing they will
 * notice, and the next genuinely new occurrence still fires.
 *
 * ## Every action goes through the existing pipeline
 *
 * SEND_MESSAGE calls MessageService.send. CREATE_NOTIFICATION calls
 * NotificationService.schedule, which applies preferences and quiet hours.
 * CREATE_ATTENTION_FLAG calls AttentionService. None of them writes a row
 * directly, so authorization, moderation and delivery rules apply to automated
 * actions exactly as they apply to human ones (§24), and a refusal is recorded
 * as `blocked` with the pipeline's own error code rather than being worked
 * around.
 */
@Injectable()
export class AutomationEngine {
  private readonly log = new Logger(AutomationEngine.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly conditions: ConditionEvaluator,
    private readonly messages: MessageService,
    private readonly notifications: NotificationService,
    private readonly conversations: ConversationService,
    private readonly attention: AttentionService,
  ) {}

  /** Run every enabled rule for this trigger. */
  async fire(event: TriggerEvent): Promise<RunResult[]> {
    const rules = await this.prisma.automationRule.findMany({
      where: { triggerType: event.triggerType, enabled: true },
    });
    const results: RunResult[] = [];
    for (const rule of rules) {
      const result = await this.runOne(rule, event);
      if (result) results.push(result);
    }
    return results;
  }

  private async runOne(rule: AutomationRule, event: TriggerEvent): Promise<RunResult | null> {
    // 1. CLAIM. Provisionally recorded as executed; corrected below. If this
    //    row already exists, another worker (or an earlier sweep) owns this
    //    occurrence and we stop -- silently, because a converged duplicate is
    //    not an incident.
    let runId: string;
    try {
      const run = await this.prisma.automationRun.create({
        data: {
          ruleKey: rule.key,
          triggerType: event.triggerType,
          subjectId: event.subjectId,
          occurrenceKey: event.occurrenceKey,
          outcome: Outcome.EXECUTED,
          detail: '',
          conversationId: event.conversationId ?? null,
          familyId: event.familyId ?? null,
        },
      });
      runId = run.id;
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        return null;
      }
      throw error;
    }

    // 2. CONDITIONS, against authoritative data. No model.
    const conditions = (rule.conditions ?? []) as unknown as Condition[];
    const verdict = await this.conditions.evaluate(conditions, event);
    if (!verdict.passed) {
      await this.finish(runId, Outcome.SKIPPED_CONDITION, verdict.detail);
      return { outcome: Outcome.SKIPPED_CONDITION, detail: verdict.detail, ruleKey: rule.key };
    }

    // 3. ACTION, through the pipeline that owns it.
    try {
      const detail = await this.act(rule, event);
      await this.finish(runId, Outcome.EXECUTED, detail);
      return { outcome: Outcome.EXECUTED, detail, ruleKey: rule.key };
    } catch (error) {
      // A CommError is the pipeline REFUSING -- BR-1, scope, a silent member,
      // an inactive actor. That is `blocked`, and it is a normal, recordable
      // outcome rather than a bug: the automation asked for something the rules
      // do not allow, and the rules won.
      const blocked = error instanceof CommError;
      const detail = blocked
        ? `${(error as CommError).code}: ${(error as Error).message}`
        : error instanceof Error
          ? error.message
          : 'unknown error';
      await this.finish(runId, blocked ? Outcome.BLOCKED : Outcome.FAILED, detail);
      if (!blocked) this.log.error(`automation ${rule.key} failed: ${detail}`);
      return { outcome: blocked ? Outcome.BLOCKED : Outcome.FAILED, detail, ruleKey: rule.key };
    }
  }

  private async act(rule: AutomationRule, event: TriggerEvent): Promise<string> {
    const config = (rule.actionConfig ?? {}) as Record<string, unknown>;

    switch (rule.actionType) {
      /**
       * PD-4: system-generated events are system messages. The author is
       * SYSTEM_ACTOR, so MessageService.send stamps origin=automation and
       * refuses to let this impersonate a member of staff.
       */
      case ActionType.SEND_MESSAGE: {
        if (!event.conversationId) return 'no conversation on this event';
        const message = await this.messages.send({
          conversationId: event.conversationId,
          senderId: SYSTEM_ACTOR.actorId,
          body: String(config.body ?? ''),
        });
        return `sent system message ${message.id}`;
      }

      /**
       * ReminderService's dedupe key already guarantees one notification per
       * (rule, subject, recipient), so this is idempotent twice over -- here by
       * the run claim, and again at the notification layer.
       */
      case ActionType.CREATE_NOTIFICATION: {
        const recipients = await this.recipientsFor(String(config.recipient ?? ''), event);
        if (recipients.length === 0) return 'no eligible recipient';
        let scheduled = 0;
        for (const recipientId of recipients) {
          await this.notifications.schedule({
            dedupeKey: `${rule.key}:${event.subjectId}:${event.occurrenceKey}:${recipientId}`,
            ruleKey: null,
            templateKey: String(config.template_key ?? rule.key),
            eventType: event.triggerType,
            recipientId,
            locale: 'ar',
            channel: 'push',
            priority: String(config.priority ?? 'normal'),
            familyId: event.familyId ?? null,
            conversationId: event.conversationId ?? null,
            variables: event.variables ?? {},
            scheduledAt: new Date(),
            respectQuietHours: config.priority !== 'high',
          });
          scheduled += 1;
        }
        return `scheduled ${scheduled} notification(s)`;
      }

      case ActionType.CREATE_ATTENTION_FLAG: {
        if (!event.conversationId) return 'no conversation on this event';
        const flags = await this.attention.assess(event.conversationId);
        return flags.length ? `raised ${flags.length} flag(s)` : 'no flag warranted';
      }

      case ActionType.SCHEDULE_FOLLOW_UP: {
        if (!event.conversationId) return 'no conversation on this event';
        const hours = Number(config.hours ?? 24);
        await this.prisma.conversation.update({
          where: { id: event.conversationId },
          data: { followUpAt: new Date(Date.now() + hours * 3_600_000) },
        });
        return `follow-up scheduled in ${hours}h`;
      }

      default:
        // An action type the migration allows and this switch does not handle
        // is a bug, and it fails loudly rather than silently doing nothing.
        throw new Error(`unimplemented action type ${rule.actionType}`);
    }
  }

  /**
   * Who a notification reaches.
   *
   * `family_contacts` is narrowed to contacts with can_message, so an
   * automation cannot reach somebody the family's own communication settings
   * exclude.
   */
  private async recipientsFor(kind: string, event: TriggerEvent): Promise<string[]> {
    if (kind === 'family_contacts') {
      if (!event.familyId) return [];
      const contacts = await this.prisma.contact.findMany({
        where: { familyId: event.familyId, canMessage: true, isActive: true },
        select: { id: true },
      });
      return contacts.map((c) => c.id);
    }

    if (kind === 'assigned_staff') {
      if (!event.conversationId) return [];
      const conv = await this.prisma.conversation.findUnique({
        where: { id: event.conversationId },
        select: { familyId: true },
      });
      if (!conv?.familyId) return [];
      // The live assignment, not a cached owner: a family reassigned yesterday
      // must reach its new supervisor today.
      const assignments = await this.prisma.familyAssignment.findMany({
        where: {
          familyId: conv.familyId,
          endedAt: null,
          OR: [{ endsAt: null }, { endsAt: { gt: new Date() } }],
        },
        select: { staffId: true },
        distinct: ['staffId'],
      });
      return assignments.map((a) => a.staffId);
    }

    return [];
  }

  private async finish(runId: string, outcome: Outcome, detail: string): Promise<void> {
    await this.prisma.automationRun.update({
      where: { id: runId },
      data: { outcome, detail: detail.slice(0, 1000) },
    });
  }
}
