import { createHmac } from 'node:crypto';
import { MIN_SECRET_LENGTH } from '../platform/auth/auth.config';

/**
 * PD-42 S1: the key that makes a second family for the same parent impossible
 * (chat.family_contact_key, primary key per academy). A KEYED hash of the
 * normalised value, never the value and never an unkeyed hash: an e-mail or a
 * phone number is guessable, so a bare sha-256 read from the table or a backup
 * would give the contact away (review of #194, P2).
 *
 *   RESET_CODE_HASH_SECRET   the server key PD-43 introduced, under this
 *                            file's own label, so a contact key is never a
 *                            reset-code hash. Required in staging and
 *                            production: without it, no key is made (fails
 *                            closed, and so does the intake that needs one).
 *   otherwise (local, test)  derived from JWT_REFRESH_SECRET with the label.
 *
 * Rotating the secret changes every key: the backfill CLI (PR-4) re-keys the
 * table from the parent files. The caller normalises first -- an e-mail
 * trimmed and in lower case, a number in E.164 -- so equal contacts give equal keys.
 */
export type ContactKeyKind = 'email' | 'phone';

const LABEL = 'jawwid:family-contact-key:v1';
const DEPLOYED_ENVIRONMENTS: ReadonlySet<string> = new Set(['staging', 'production']);

export function contactKeyHash(kind: ContactKeyKind, normalised: string): string {
  const value = normalised.trim();
  if (!value) throw new Error('a contact key needs a value');
  return createHmac('sha256', contactKeySecret()).update(`${kind}:${value}`).digest('hex');
}

/** An e-mail as it is keyed: trimmed, lower case. */
export function normaliseEmailForKey(email: string): string {
  return email.trim().toLowerCase();
}

function contactKeySecret(): Buffer {
  const dedicated = (process.env.RESET_CODE_HASH_SECRET ?? '').trim();
  if (dedicated.length >= MIN_SECRET_LENGTH) return createHmac('sha256', dedicated).update(LABEL).digest();
  if (DEPLOYED_ENVIRONMENTS.has((process.env.APP_ENV ?? '').trim())) {
    throw new Error(`RESET_CODE_HASH_SECRET must be set to at least ${MIN_SECRET_LENGTH} characters in ${process.env.APP_ENV}`);
  }
  const refresh = (process.env.JWT_REFRESH_SECRET ?? '').trim();
  if (refresh.length < MIN_SECRET_LENGTH) throw new Error('RESET_CODE_HASH_SECRET (or, locally, JWT_REFRESH_SECRET) is required to key a contact');
  return createHmac('sha256', refresh).update(LABEL).digest();
}
