import { Algorithm, hash, verify } from '@node-rs/argon2';

/**
 * Password hashing -- Argon2id (PR-B).
 *
 * `docs/architecture/IDENTITY-MODEL.md` §2 and PRD §7.1 both name Argon2id.
 * The archived D-6 baseline used scrypt to avoid a dependency; that trade is
 * not taken here, because the canonical document names an algorithm and
 * "we did not want a dependency" is not a reason to ship a different one.
 *
 * `@node-rs/argon2` ships prebuilt binaries for every platform this project
 * targets, including linux-x64-gnu and linux-arm64-gnu -- the Docker runtime is
 * node:24.18.0-bookworm-slim (glibc), so `npm ci` resolves a prebuilt artifact
 * and there is no node-gyp step in the production image. The package declares
 * no install script.
 *
 * PARAMETERS: m=19456 KiB, t=2, p=1 are the OWASP Password Storage Cheat Sheet
 * minimum for Argon2id. They are encoded INTO the hash string, so raising them
 * later does not invalidate existing passwords: verify reads the cost the hash
 * was made with.
 *
 * A hash produced here is never returned from a service, never put in a DTO and
 * never logged; `chat.account_credential` has no RLS policy at all, so it is
 * unreadable by the `authenticated` role by construction (RLS-STRATEGY §4).
 */
const ARGON2_OPTIONS = {
  algorithm: Algorithm.Argon2id,
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
  outputLen: 32,
} as const;

/** The PHC prefix every hash this module produces must carry. */
export const ARGON2ID_PREFIX = '$argon2id$';

export async function hashPassword(plain: string): Promise<string> {
  return hash(plain, ARGON2_OPTIONS);
}

/**
 * Constant-time verification.
 *
 * Returns false rather than throwing on a malformed or foreign stored hash: a
 * corrupt row must fail that one login, not 500 the endpoint for everybody.
 */
export async function verifyPassword(plain: string, stored: string): Promise<boolean> {
  if (!stored.startsWith(ARGON2ID_PREFIX)) return false;
  try {
    return await verify(stored, plain, ARGON2_OPTIONS);
  } catch {
    return false;
  }
}

/**
 * A real Argon2id verification against a throwaway hash, used when the subject
 * does not exist.
 *
 * Without it, an unknown username returns in microseconds while a known one
 * costs a full Argon2id verification -- and that difference enumerates accounts
 * regardless of how uniform the response body is.
 *
 * The hash below is a fixed, valid Argon2id encoding of a random value nobody
 * holds. It is not a credential and cannot authenticate anything.
 */
const DECOY_HASH =
  '$argon2id$v=19$m=19456,t=2,p=1$/q+6pwcqDDjkX6/IRBJdHw$' +
  '8a8nh7433BwjTMxfeJ1Zuxx1+TS5K+rZXXruyxA7hyM';

export async function spendComparableTime(plain: string): Promise<void> {
  await verifyPassword(plain, DECOY_HASH);
}
