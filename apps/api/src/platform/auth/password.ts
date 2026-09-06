import { randomBytes, scrypt as scryptCb, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(scryptCb) as (
  password: string,
  salt: Buffer,
  keylen: number,
) => Promise<Buffer>;

/**
 * Password hashing. Owner: AI #1 seam, implemented by AI #7 (D-6).
 *
 * scrypt from node:crypto rather than bcrypt or argon2, so authentication adds
 * no dependency and no native build step. scrypt is memory-hard and is the
 * algorithm Node ships for exactly this purpose.
 *
 * The parameters are stored WITH the hash (`scrypt$N$r$p$salt$key`) so they can
 * be raised later without invalidating every existing password: verify reads
 * the cost the hash was made with, and a rehash-on-login can upgrade it.
 */
const N = 16384; // CPU/memory cost
const R = 8;
const P = 1;
const KEYLEN = 64;
const SALT_BYTES = 16;

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
