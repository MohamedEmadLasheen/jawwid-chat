/**
 * The delivery envelope, validated before anything downstream sees it.
 *
 * Integration contract §2 (docs/architecture/core-integration-contract.md):
 * four fields, all required, and an event type this boundary PROCESSES.
 * Anything else is a 400 -- the contract's "stop, retrying cannot help".
 *
 * WHY AN ALLOWLIST OF ONE. A type Chat does not process must be refused,
 * loudly, not accepted into a ledger nobody drains: silent acceptance would look
 * like integration and behave like a leak. Each type is added with its handler.
 * (Ported from claude/admiring-feynman-v3l4xh; that branch's list named class
 * sessions, which PD-11 moved into Chat.)
 */
export const ACCEPTED_EVENT_TYPES: ReadonlySet<string> = new Set([
  // Recorded and acknowledged; since the trial journey it changes no trial (Chat
  // is the source of truth for trial outcomes).
  'subscription.created',
]);

export interface CoreEnvelope {
  readonly eventId: string;
  readonly eventType: string;
  /** SOURCE time. Deliberately NOT replay-checked: the HTTP timestamp is. */
  readonly occurredAt: Date;
  readonly data: Record<string, unknown>;
}

export type EnvelopeResult = { ok: true; envelope: CoreEnvelope } | { ok: false; reason: string };

/**
 * Parse and validate the raw body -- the BYTES the signature was verified over,
 * not whatever a framework body parser produced, so the verified value and the
 * used value are the same value.
 */
export function parseEnvelope(rawBody: Buffer): EnvelopeResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawBody.toString('utf8'));
  } catch {
    return { ok: false, reason: 'malformed_json' };
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return { ok: false, reason: 'envelope_not_an_object' };
  }
  const body = parsed as Record<string, unknown>;

  const eventId = body.event_id;
  if (typeof eventId !== 'string' || eventId.trim().length === 0 || eventId.length > 200) {
    return { ok: false, reason: 'missing_event_id' };
  }
  const eventType = body.event_type;
  if (typeof eventType !== 'string' || eventType.trim().length === 0) {
    return { ok: false, reason: 'missing_event_type' };
  }
  if (!ACCEPTED_EVENT_TYPES.has(eventType)) {
    return { ok: false, reason: 'unknown_event_type' };
  }
  const occurredAtRaw = body.occurred_at;
  if (typeof occurredAtRaw !== 'string' || occurredAtRaw.trim().length === 0) {
    return { ok: false, reason: 'missing_occurred_at' };
  }
  const occurredAt = new Date(occurredAtRaw);
  if (Number.isNaN(occurredAt.getTime())) {
    return { ok: false, reason: 'invalid_occurred_at' };
  }
  const data = body.data;
  if (typeof data !== 'object' || data === null || Array.isArray(data)) {
    return { ok: false, reason: 'missing_data' };
  }
  return { ok: true, envelope: { eventId, eventType, occurredAt, data: data as Record<string, unknown> } };
}
