import { createHmac, timingSafeEqual } from 'node:crypto';
import type { CoreRejectionReason } from './contracts';

/**
 * HMAC verification for Core -> Chat deliveries.
 *
 * Signed value is `${timestamp}.${rawBody}`; the timestamp is inside the
 * signature so a captured request cannot be replayed with a fresh one. The body
 * is the RAW bytes, not the parsed object: re-serialising JSON changes key order
 * and whitespace and would make every signature fail.
 *
 * WHAT IS SPECIFIED HERE IS CHAT'S REQUIREMENT, WHICH IS CHAT'S TO SET. Whether
 * Jawwid Core can produce it is PRD §15.2 open question 1 and is unresolved —
 * see the contract document. If Core cannot sign, the fallback is mTLS, and that
 * is a product/infrastructure decision, not a code change here.
 */
export interface SignatureHeaders {
  readonly keyId: string | undefined;
  readonly timestamp: string | undefined;
  readonly signature: string | undefined;
}

export interface SignatureCheck {
  readonly ok: boolean;
  readonly reason?: CoreRejectionReason;
}

/** Parses `keyid:secret,keyid2:secret2` — two entries is how a rotation lands. */
export function parseSecrets(raw: string | undefined): ReadonlyMap<string, string> {
  const out = new Map<string, string>();
  for (const entry of (raw ?? '').split(',')) {
    const trimmed = entry.trim();
    if (trimmed.length === 0) continue;
    const separator = trimmed.indexOf(':');
    if (separator <= 0) continue;
    const keyId = trimmed.slice(0, separator).trim();
    const secret = trimmed.slice(separator + 1).trim();
    if (keyId.length > 0 && secret.length > 0) out.set(keyId, secret);
  }
  return out;
}

export function sign(secret: string, timestamp: string, rawBody: string): string {
  return createHmac('sha256', secret).update(`${timestamp}.${rawBody}`).digest('hex');
}

export function verifySignature(
  headers: SignatureHeaders,
  rawBody: string,
  secrets: ReadonlyMap<string, string>,
  nowSeconds: number,
  toleranceSeconds: number,
): SignatureCheck {
  const { keyId, timestamp, signature } = headers;
  if (!keyId || !timestamp || !signature) return { ok: false, reason: 'missing_signature' };

  const secret = secrets.get(keyId);
  // An unknown key id and a bad signature are reported distinctly to Core (it
  // needs to know whether to rotate or to re-sign) but neither reveals anything
  // about the secret itself.
  if (!secret) return { ok: false, reason: 'unknown_key' };

  const sent = Number(timestamp);
  if (!Number.isFinite(sent)) return { ok: false, reason: 'stale_timestamp' };
  if (Math.abs(nowSeconds - sent) > toleranceSeconds) return { ok: false, reason: 'stale_timestamp' };

  const expected = Buffer.from(sign(secret, timestamp, rawBody), 'utf8');
  const provided = Buffer.from(signature.replace(/^sha256=/, ''), 'utf8');
  // Length must match before timingSafeEqual, and comparing lengths first leaks
  // only the length, which the attacker already knows.
  if (expected.length !== provided.length) return { ok: false, reason: 'bad_signature' };
  if (!timingSafeEqual(expected, provided)) return { ok: false, reason: 'bad_signature' };

  return { ok: true };
}
