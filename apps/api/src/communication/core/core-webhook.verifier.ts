import { createHmac, timingSafeEqual } from 'node:crypto';
import { CoreWebhookConfig, MAX_BODY_BYTES } from './core-webhook.config';

/**
 * Authentication for the Core boundary. Pure, so it can be tested exhaustively
 * without an HTTP server, and so nothing in it can reach a log or a database.
 *
 * THE SIGNED VALUE IS `{timestamp}.{rawBody}`, over the exact bytes received.
 * Re-serialising the JSON changes key order and whitespace and invalidates the
 * signature, which is the point: the signature covers what was sent, not what
 * a parser reconstructed.
 *
 * THE COMPARISON IS EXACT AND CONSTANT-TIME. The expected value includes the
 * `sha256=` prefix and a LOWERCASE hex digest, and neither is normalised away.
 * An uppercase digest is not "the same signature in a different case" as far as
 * this boundary is concerned -- it is a value that does not match, and
 * accepting it would mean accepting a class of input the sender was never told
 * to produce.
 */

/** Why a delivery was refused. Stable, machine-readable, and it reveals nothing. */
export const WebhookRejection = {
  NOT_CONFIGURED: 'not_configured',
  MISSING_HEADERS: 'missing_headers',
  BODY_TOO_LARGE: 'body_too_large',
  UNKNOWN_KEY: 'unknown_key',
  STALE_TIMESTAMP: 'stale_timestamp',
  INVALID_SIGNATURE: 'invalid_signature',
} as const;
export type WebhookRejection = (typeof WebhookRejection)[keyof typeof WebhookRejection];

export interface WebhookHeaders {
  keyId: string | undefined;
  timestamp: string | undefined;
  signature: string | undefined;
}

export type VerifyResult =
  | { ok: true; keyId: string }
  | { ok: false; reason: WebhookRejection };

/**
 * The exact signature a given body and timestamp must carry.
 *
 * Exported because the tests sign with it, and because a test that reimplemented
 * the construction would be testing its own copy rather than this one.
 */
export function expectedSignature(secret: string, timestamp: string, rawBody: Buffer): string {
  // The secret is used as RAW UTF-8 BYTES. Node's createHmac takes a string as
  // utf-8 by default; it is spelled out here so nobody later "helpfully"
  // base64-decodes it.
  const digest = createHmac('sha256', Buffer.from(secret, 'utf8'))
    .update(`${timestamp}.`, 'utf8')
    .update(rawBody)
    .digest('hex'); // Node emits lowercase hex.
  return `sha256=${digest}`;
}

/**
 * Verify one delivery.
 *
 * The order is the contract's, and it is deliberate: cheap structural checks
 * first, the cryptographic comparison last, and nothing about the body's
 * CONTENT examined at any point. This function never sees the parsed envelope
 * and could not act on it if it did.
 */
export function verifyDelivery(
  config: CoreWebhookConfig | null,
  headers: WebhookHeaders,
  rawBody: Buffer,
  now: Date,
): VerifyResult {
  // Fail closed. No secret means no boundary, not an open one.
  if (!config || config.keys.length === 0) {
    return { ok: false, reason: WebhookRejection.NOT_CONFIGURED };
  }

  if (rawBody.byteLength > MAX_BODY_BYTES) {
    return { ok: false, reason: WebhookRejection.BODY_TOO_LARGE };
  }

  const { keyId, timestamp, signature } = headers;
  if (!keyId || !timestamp || !signature) {
    return { ok: false, reason: WebhookRejection.MISSING_HEADERS };
  }

  const key = config.keys.find((candidate) => candidate.keyId === keyId);
  if (!key) {
    // An unknown key id is refused before any HMAC is computed. There is
    // nothing to compare against, and pretending otherwise would only burn
    // cycles to reach the same answer.
    return { ok: false, reason: WebhookRejection.UNKNOWN_KEY };
  }

  // THE REPLAY WINDOW, checked against the HTTP timestamp only. The envelope's
  // occurred_at is a business time and may legitimately be days old -- a
  // backfill is a valid delivery, not an attack -- so it is not checked here
  // and must not be.
  const sentAtSeconds = Number(timestamp);
  if (!Number.isFinite(sentAtSeconds)) {
    return { ok: false, reason: WebhookRejection.STALE_TIMESTAMP };
  }
  const driftSeconds = Math.abs(Math.floor(now.getTime() / 1000) - sentAtSeconds);
  if (driftSeconds > config.toleranceSeconds) {
    return { ok: false, reason: WebhookRejection.STALE_TIMESTAMP };
  }

  // The timestamp is INSIDE the signature, so a captured request cannot be
  // replayed with a fresh one: changing it invalidates the digest.
  const expected = expectedSignature(key.secret, timestamp, rawBody);
  if (!constantTimeEquals(expected, signature)) {
    return { ok: false, reason: WebhookRejection.INVALID_SIGNATURE };
  }

  return { ok: true, keyId: key.keyId };
}

/**
 * Constant-time string comparison.
 *
 * `timingSafeEqual` throws on a length mismatch, which would itself leak the
 * length through the exception path, so the lengths are compared first and a
 * mismatch still walks the same code path. The comparison is byte-exact: no
 * trimming, no case folding, no prefix stripping.
 */
function constantTimeEquals(expected: string, actual: string): boolean {
  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(actual, 'utf8');
  if (a.byteLength !== b.byteLength) return false;
  return timingSafeEqual(a, b);
}
