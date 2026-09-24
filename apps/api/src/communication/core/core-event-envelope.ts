/**
 * The delivery envelope, validated before anything downstream sees it.
 *
 * Integration contract section 2. Four fields, all required, and an event type
 * that must be one this boundary knows. Anything else is a `400` -- the
 * contract's "stop, retrying cannot help".
 *
 * WHY AN ALLOWLIST AND NOT A PATTERN. A future Core release that starts
 * emitting a type Chat has not implemented must be REFUSED, loudly, not
 * accepted into a ledger nobody drains. Silent acceptance would look like
 * integration and behave like a leak.
 */

/** Every type this boundary accepts. Adding one is a deliberate edit. */
export const ACCEPTED_EVENT_TYPES: ReadonlySet<string> = new Set([
  'parent.upserted',
  'student.upserted',
  'student.deactivated',
  'teacher.upserted',
  'teacher.deactivated',
  'enrollment.upserted',
  'enrollment.ended',
  'class_session.upserted',
  'class_session.cancelled',
  'attendance.upserted',
  'subscription.upserted',
  'payment.upserted',
]);

export interface CoreEnvelope {
  readonly eventId: string;
  readonly eventType: string;
  /** SOURCE time. Orders entities; deliberately NOT replay-checked. */
  readonly occurredAt: Date;
  readonly data: Record<string, unknown>;
}

export type EnvelopeResult =
  | { ok: true; envelope: CoreEnvelope }
  | { ok: false; reason: string };

/**
 * Parse and validate the raw body.
 *
 * Takes the BYTES, not a parsed object: the signature was verified over these
 * exact bytes, and parsing them here rather than trusting whatever a framework
 * body parser produced keeps the verified value and the used value the same
 * thing.
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
  if (typeof eventId !== 'string' || eventId.trim().length === 0) {
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

  return {
    ok: true,
    envelope: {
      eventId,
      eventType,
      occurredAt,
      data: data as Record<string, unknown>,
    },
  };
}
