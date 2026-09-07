import { randomBytes, scrypt as scryptCb, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(scryptCb) as (
  password: string,
  salt: Buffer,
  keylen: number,
) => Promise<Buffer>;

/**
 * Password hashing.
 *
 * scrypt from node:crypto rather than bcrypt or argon2, so authentication adds
 * no dependency and no native build step. scrypt is memory-hard and is the
 * algorithm Node ships for exactly this purpose.
 *
 * The parameters are stored WITH the hash (`scrypt$N$r$p$salt$key`) so they can
 * be raised later without invalidating every existing password: verify reads
 * the cost the hash was made with.
 *
 * A plaintext password is never stored, never logged, and never returned by any
 * API; the only thing that leaves this module is the encoded hash.
 */
const N = 16384; // CPU/memory cost
const R = 8;
const P = 1;
const KEYLEN = 64;
const SALT_BYTES = 16;

/** A well-formed hash of a password nobody holds, for equal-time failure paths. */
export const DUMMY_PASSWORD_HASH =
  'scrypt$16384$8$1$AAAAAAAAAAAAAAAAAAAAAA==$' + 'A'.repeat(88);

export async function hashPassword(plain: string): Promise<string> {
  const salt = randomBytes(SALT_BYTES);
  const key = await scrypt(plain, salt, KEYLEN);
  return `scrypt$${N}$${R}$${P}$${salt.toString('base64')}$${key.toString('base64')}`;
}

/**
 * Constant-time comparison. Returns false rather than throwing on a malformed
 * stored hash: a corrupt row must fail the login, not crash the endpoint.
 */
export async function verifyPassword(plain: string, stored: string): Promise<boolean> {
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;

  const salt = Buffer.from(parts[4], 'base64');
  const expected = Buffer.from(parts[5], 'base64');
  if (salt.length === 0 || expected.length === 0) return false;

  let actual: Buffer;
  try {
    actual = await scrypt(plain, salt, expected.length);
  } catch {
    return false;
  }
  if (actual.length !== expected.length) return false;
  return timingSafeEqual(actual, expected);
}

export class WeakPasswordError extends Error {
  constructor(readonly minimumLength: number) {
    super(`password must be at least ${minimumLength} characters`);
    this.name = 'WeakPasswordError';
  }
}

/**
 * The one password policy. Length only, deliberately: composition rules push
 * people towards predictable substitutions, and this system has no public
 * registration -- credentials are provisioned.
 */
export function assertPasswordAcceptable(plain: string, minimumLength: number): void {
  if (typeof plain !== 'string' || plain.length < minimumLength) {
    throw new WeakPasswordError(minimumLength);
  }
}
