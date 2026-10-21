import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

/**
 * PD-18: a teacher's payout account details are sealed by the server before
 * they reach the database (AES-256-GCM), so a database dump, a backup or a
 * read replica holds ciphertext, never an account number.
 *
 * Keys come from TEACHER_PAYOUT_KEYS: `keyid:base64key[,keyid:base64key...]`,
 * each key exactly 32 bytes. The FIRST key seals; every listed key opens, so a
 * key is rotated by putting the new one first and keeping the old one until
 * every row has been re-saved. Without the variable the payout account can be
 * neither written nor revealed (503): payroll fails closed, never in clear.
 *
 * The additional authenticated data names the organization, the teacher and
 * the method, so a sealed value copied onto another row does not open.
 */

const IV_BYTES = 12;
const TAG_BYTES = 16;
const KEY_ID = /^[a-z0-9_-]{1,32}$/;

export interface PayoutKeyring {
  activeId: string;
  keys: ReadonlyMap<string, Buffer>;
}

/** Parses TEACHER_PAYOUT_KEYS. Null when unset; throws on a malformed value, so a typo is loud at boot. */
export function parsePayoutKeys(raw: string | undefined): PayoutKeyring | null {
  if (raw === undefined || raw.trim() === '') return null;
  const keys = new Map<string, Buffer>();
  let activeId: string | null = null;
  for (const part of raw.split(',').map((p) => p.trim()).filter(Boolean)) {
    const at = part.indexOf(':');
    const id = at > 0 ? part.slice(0, at) : '';
    const key = Buffer.from(part.slice(at + 1), 'base64');
    if (!KEY_ID.test(id)) throw new Error('TEACHER_PAYOUT_KEYS: each entry is keyid:base64key, the id [a-z0-9_-]{1,32}');
    if (key.length !== 32) throw new Error(`TEACHER_PAYOUT_KEYS: key "${id}" must decode to exactly 32 bytes`);
    if (keys.has(id)) throw new Error(`TEACHER_PAYOUT_KEYS: key id "${id}" appears twice`);
    keys.set(id, key);
    activeId ??= id;
  }
  return activeId ? { activeId, keys } : null;
}

export interface SealContext {
  organizationId: string;
  teacherId: string;
  method: string;
}

const aad = (c: SealContext) => Buffer.from(`teacher-payout:v1:${c.organizationId}:${c.teacherId}:${c.method}`, 'utf8');

export function sealPayout(ring: PayoutKeyring, context: SealContext, details: object): { sealed: Buffer; keyId: string } {
  const key = ring.keys.get(ring.activeId) as Buffer;
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(aad(context));
  const body = Buffer.concat([cipher.update(JSON.stringify(details), 'utf8'), cipher.final()]);
  return { sealed: Buffer.concat([iv, cipher.getAuthTag(), body]), keyId: ring.activeId };
}

/** Throws when the key is unknown or the value was altered or moved to another row. */
export function openPayout(ring: PayoutKeyring, context: SealContext, sealed: Buffer, keyId: string): unknown {
  const key = ring.keys.get(keyId);
  if (!key) throw new Error(`payout key "${keyId}" is not configured`);
  const iv = sealed.subarray(0, IV_BYTES);
  const tag = sealed.subarray(IV_BYTES, IV_BYTES + TAG_BYTES);
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAAD(aad(context));
  decipher.setAuthTag(tag);
  const text = Buffer.concat([decipher.update(sealed.subarray(IV_BYTES + TAG_BYTES)), decipher.final()]).toString('utf8');
  return JSON.parse(text);
}
