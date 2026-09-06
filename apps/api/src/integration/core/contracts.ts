/**
 * The Jawwid Core -> Jawwid Chat integration contract.
 * Owner: AI #1. Authoritative: docs/architecture/core-integration-contract.md.
 *
 * PRD v0.1 §12.4: a dedicated integration service owns all traffic with Jawwid
 * Core, Core stays the source of truth for its own fields, and every synced
 * entity carries an external id and a synced_at.
 *
 * Nothing in this file describes Jawwid Core's internal schema. The payloads are
 * flat and named for what Chat needs, so a change inside Core is a change in
 * Core's transformer, not here.
 */

/** Every event Jawwid Chat accepts. Anything else is rejected as unknown. */
export const CORE_EVENT_TYPES = [
  'parent.upserted',
  'student.upserted',
  'student.deactivated',
  'teacher.upserted',
  'teacher.deactivated',
  'enrollment.upserted',
  'enrollment.ended',
  'class_session.upserted',
  'class_session.cancelled',
  'subscription.upserted',
  'payment.upserted',
] as const;

export type CoreEventType = (typeof CORE_EVENT_TYPES)[number];

export function isCoreEventType(value: unknown): value is CoreEventType {
  return typeof value === 'string' && (CORE_EVENT_TYPES as readonly string[]).includes(value);
}

/**
 * The delivery envelope. `event_id` is the idempotency key and must be stable
 * across retries of the same change — that is what makes at-least-once delivery
 * safe. `occurred_at` is the SOURCE time, and is what orders the event; arrival
 * order is not trusted.
 */
export interface CoreEventEnvelope {
  readonly event_id: string;
  readonly event_type: CoreEventType;
  readonly occurred_at: string;
  readonly data: Record<string, unknown>;
}

export interface CoreEventAccepted {
  readonly status: 'applied' | 'duplicate' | 'not_applicable';
  readonly event_id: string;
  /** The affected Chat row, when one was written. */
  readonly resource_id: string | null;
}

/** Why a delivery was refused. Returned to Core so its retry logic can decide. */
export type CoreRejectionReason =
  | 'missing_signature'
  | 'unknown_key'
  | 'bad_signature'
  | 'stale_timestamp'
  | 'malformed_envelope'
  | 'unknown_event_type';
