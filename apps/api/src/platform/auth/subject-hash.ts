import { createHash } from 'node:crypto';

/**
 * The only form of a login identifier that may be persisted or emitted.
 *
 * API-CONTRACT §3.1 is explicit about the failed-login event: it carries
 * "{username hash, reason code} -- **never** the password, **never** the raw
 * username". `chat.account.subject` is half of the credential pair, so an
 * event_log row naming it turns a log export into a list of valid usernames,
 * and a log reader into an account enumerator.
 *
 * Truncated SHA-256: stable enough to correlate attempts against one identifier
 * across rows, opaque enough that recovering the subject is the preimage
 * problem. Shares its normalisation with the rate limiter so the two controls
 * agree on what "the same identifier" means.
 */
export function subjectHash(subject: string): string {
  return createHash('sha256').update(subject.trim().toLowerCase()).digest('hex').slice(0, 32);
}
