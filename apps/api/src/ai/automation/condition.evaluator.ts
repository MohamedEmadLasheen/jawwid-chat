import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../platform/prisma.service';
import { ConversationState } from '../../communication/contracts/vocab';
import { familyStateIsActive } from '../../platform/families/family.service';
import type { Condition, TriggerEvent } from './automation.types';

export interface ConditionResult {
  readonly passed: boolean;
  /** Which condition failed, in words, for the audit row. */
  readonly detail: string;
}

/**
 * Evaluates a rule's conditions against authoritative application data.
 *
 * Phase 7 §23: conditions are facts, and facts come from the database. No model
 * is consulted here and none could be -- this class holds no AI dependency.
 *
 * ## An unknown field FAILS
 *
 * A condition naming a field this evaluator does not implement is treated as
 * not met, not as absent. The alternative -- ignoring what you do not
 * understand -- means a typo in `family_active` silently removes the only guard
 * on a rule that messages families, and the rule keeps working, more broadly
 * than anybody intended. Failing closed makes the typo visible on the first
 * run instead.
 */
@Injectable()
export class ConditionEvaluator {
  constructor(private readonly prisma: PrismaService) {}

  async evaluate(
    conditions: readonly Condition[],
    event: TriggerEvent,
  ): Promise<ConditionResult> {
    for (const condition of conditions) {
      const actual = await this.resolve(condition.field, event);

      if (actual === UNKNOWN_FIELD) {
        return { passed: false, detail: `unknown condition field "${condition.field}"` };
      }

      const matches =
        condition.op === 'ne' ? actual !== condition.value : actual === condition.value;

      if (!matches) {
        return {
          passed: false,
          detail: `${condition.field} was ${JSON.stringify(actual)}, expected ${condition.op} ${JSON.stringify(condition.value)}`,
        };
      }
    }
    return { passed: true, detail: 'all conditions met' };
  }

  private async resolve(field: string, event: TriggerEvent): Promise<unknown> {
    switch (field) {
      case 'family_active': {
        if (!event.familyId) return false;
        const family = await this.prisma.family.findUnique({
          where: { id: event.familyId },
          select: { state: true },
        });
        // familyStateIsActive, not a comparison written here. It is the
        // TypeScript mirror of chat.family_state_is_active(), and re-deriving
        // "active" would give this engine a second definition -- one that would
        // quietly disagree the day a lifecycle state is added.
        return family !== null && familyStateIsActive(family.state);
      }

      case 'conversation_open': {
        if (!event.conversationId) return false;
        const conv = await this.prisma.conversation.findUnique({
          where: { id: event.conversationId },
          select: { state: true },
        });
        return conv !== null && conv.state !== ConversationState.RESOLVED;
      }

      case 'notifications_enabled': {
        // An ABSENT preference row means enabled -- the Phase 4 default, and the
        // only one that cannot silently lose a notification. Reproduced here
        // rather than re-decided: NotificationService applies the same rule
        // again at dispatch, so this is an early exit, never the enforcement.
        if (!event.familyId) return false;
        const contacts = await this.prisma.contact.findMany({
          where: { familyId: event.familyId, canMessage: true },
          select: { id: true },
        });
        if (contacts.length === 0) return false;
        const optedOut = await this.prisma.notificationPreference.count({
          where: { actorId: { in: contacts.map((c) => c.id) }, enabled: false },
        });
        return optedOut < contacts.length;
      }

      /**
       * Deliberately unresolvable in this system.
       *
       * Subscription state lives in Jawwid Core (product boundary §1.2), and
       * chat.subscription is frozen machinery no new code may depend on. A rule
       * naming this field therefore fails closed and says why, which is the
       * correct behaviour for an integration that is not connected yet -- and
       * far better than a mirror table quietly answering "active" from data
       * nobody is updating.
       */
      case 'subscription_active':
        return UNKNOWN_FIELD;

      default:
        return UNKNOWN_FIELD;
    }
  }
}

/** Distinct from undefined, which is a legitimate value for a missing record. */
const UNKNOWN_FIELD = Symbol('unknown-condition-field');
