/**
 * The automation vocabulary. Mirrors the CHECK constraints in
 * 20260907180500; the migration is authoritative.
 */

export const TriggerType = {
  /** Computed from data this system owns. Live. */
  FOLLOW_UP_DUE: 'FOLLOW_UP_DUE',
  MESSAGE_UNANSWERED: 'MESSAGE_UNANSWERED',
  RISK_FLAG_CREATED: 'RISK_FLAG_CREATED',
  /** Fed from chat.core_event. Dormant until Jawwid Core delivers them. */
  CLASS_UPCOMING: 'CLASS_UPCOMING',
  PAYMENT_DUE: 'PAYMENT_DUE',
  RENEWAL_APPROACHING: 'RENEWAL_APPROACHING',
} as const;
export type TriggerType = (typeof TriggerType)[keyof typeof TriggerType];

/**
 * Triggers whose facts live in Jawwid Core.
 *
 * Named as a set rather than left implicit, so the reason a rule is dormant is
 * a property of the code and not a comment somebody has to find.
 */
export const CORE_FED_TRIGGERS: ReadonlySet<string> = new Set([
  TriggerType.CLASS_UPCOMING,
  TriggerType.PAYMENT_DUE,
  TriggerType.RENEWAL_APPROACHING,
]);

export const ActionType = {
  SEND_MESSAGE: 'SEND_MESSAGE',
  CREATE_NOTIFICATION: 'CREATE_NOTIFICATION',
  CREATE_ATTENTION_FLAG: 'CREATE_ATTENTION_FLAG',
  SCHEDULE_FOLLOW_UP: 'SCHEDULE_FOLLOW_UP',
  // CREATE_TASK is deliberately absent. PD-4 froze chat.task and ruled that
  // system-generated events are SYSTEM MESSAGES, which is SEND_MESSAGE.
} as const;
export type ActionType = (typeof ActionType)[keyof typeof ActionType];

export const Outcome = {
  EXECUTED: 'executed',
  /** A condition was not met. The common, healthy outcome. */
  SKIPPED_CONDITION: 'skipped_condition',
  /** Authorization, moderation or a business rule refused it. */
  BLOCKED: 'blocked',
  FAILED: 'failed',
} as const;
export type Outcome = (typeof Outcome)[keyof typeof Outcome];

export interface Condition {
  readonly field: string;
  readonly op: 'eq' | 'ne';
  readonly value: unknown;
}

/**
 * One firing, before conditions are evaluated.
 *
 * `occurrenceKey` is what makes "already done" meaningful. A subject alone is
 * not enough: the same conversation legitimately becomes follow-up-due on many
 * different days, so the key names WHICH firing this is -- a due date, a class
 * start, a flag id. A re-run of yesterday's sweep converges; tomorrow's
 * genuinely new firing still runs.
 */
export interface TriggerEvent {
  readonly triggerType: TriggerType;
  readonly subjectId: string;
  readonly occurrenceKey: string;
  readonly conversationId?: string | null;
  readonly familyId?: string | null;
  /** Substituted into notification templates. Never contains a secret. */
  readonly variables?: Record<string, unknown>;
}
