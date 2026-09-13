import { createHash } from 'node:crypto';

/**
 * Authentication configuration, resolved once and fail-closed (PR-B).
 *
 * `docs/architecture/IDENTITY-MODEL.md` §4: "Secrets: JWT_ACCESS_SECRET,
 * JWT_REFRESH_SECRET >= 32 chars, fail-closed at startup". Nothing here has a
 * development fallback. A missing or short secret is not a warning and not a
 * generated-at-boot key -- either of those means tokens are forgeable by
 * anyone who can guess the default, which is the RT-005 lesson.
 *
 * NO NEW ENVIRONMENT VARIABLE IS INTRODUCED. The four names below are already
 * declared in infra/env/manifest.tsv and .env.example; issuer and audience are
 * constants because a deployment that can change who issued a token can also
 * make one issuer's token acceptable to another's verifier.
 */

/** `iss`. Constant: this API is the only issuer, and it accepts only itself. */
export const JWT_ISSUER = 'jawwid-chat';

/** `aud`. Constant: an access token minted for this API is valid nowhere else. */
export const JWT_AUDIENCE = 'jawwid-chat-api';

/** Refuses anything an attacker could brute-force offline after a hash leak. */
export const MIN_SECRET_LENGTH = 32;

const DEFAULT_ACCESS_TTL_SECONDS = 900; // 15m, matching JWT_ACCESS_TTL in .env.example
const DEFAULT_REFRESH_TTL_SECONDS = 2_592_000; // 30d

/** One signing key. `kid` names it in the token header so it can be rotated. */
export interface SigningKey {
  readonly kid: string;
  readonly secret: string;
}

export interface AuthConfig {
  /** The key new tokens are signed with: the FIRST entry of JWT_ACCESS_SECRET. */
  readonly activeKey: SigningKey;
  /** Every key a token may be verified against, active first. */
  readonly keys: readonly SigningKey[];
  /** HMAC key for refresh-token hashing. Never leaves the process. */
  readonly refreshSecret: string;
  readonly accessTtlSeconds: number;
  readonly refreshTtlSeconds: number;
  readonly issuer: string;
  readonly audience: string;
}

export class AuthConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AuthConfigurationError';
  }
}

/**
 * A stable, non-secret name for a key.
 *
 * Derived from the secret so that a single bare secret still produces a `kid`
 * and rotation works without anyone having to invent an id. It is a truncated
 * SHA-256, which reveals nothing usable: recovering the secret from it is the
 * preimage problem.
 */
export function deriveKid(secret: string): string {
  return createHash('sha256').update(secret).digest('hex').slice(0, 16);
}

/**
 * Parses JWT_ACCESS_SECRET into a keyring.
 *
 * Two accepted shapes, so rotation costs no new configuration:
 *
 *   JWT_ACCESS_SECRET=<secret>                     one key, kid derived
 *   JWT_ACCESS_SECRET=<kid>:<secret>,<kid>:<secret>  first signs, all verify
 *
 * Rotation is therefore: prepend the new key, deploy, wait one access-token
 * TTL, drop the old one. Tokens signed by the retired key keep verifying until
 * they expire, and nothing is signed with it after the first step.
 */
export function parseKeyring(raw: string | undefined): SigningKey[] {
  const entries = (raw ?? '')
    .split(',')
    .map((e) => e.trim())
    .filter((e) => e.length > 0);

  if (entries.length === 0) {
    throw new AuthConfigurationError(
      'JWT_ACCESS_SECRET is not set. The API refuses to start without a signing key: ' +
        'an unsigned or default-signed access token is a forged identity.',
    );
  }

  const keys: SigningKey[] = [];
  const seen = new Set<string>();

  for (const entry of entries) {
    // A kid is an opaque label; a secret may legitimately contain ':' , so split once.
    const separator = entry.indexOf(':');
    const looksLabelled = separator > 0 && /^[A-Za-z0-9_-]+$/.test(entry.slice(0, separator));

    const kid = looksLabelled ? entry.slice(0, separator) : deriveKid(entry);
    const secret = looksLabelled ? entry.slice(separator + 1) : entry;

    if (secret.length < MIN_SECRET_LENGTH) {
      // The value is never echoed -- only its length, and only as a bound.
      throw new AuthConfigurationError(
        `JWT_ACCESS_SECRET key '${kid}' is shorter than ${MIN_SECRET_LENGTH} characters. ` +
          'A short HMAC key is brute-forceable offline, which makes every token forgeable.',
      );
    }
    if (seen.has(kid)) {
      throw new AuthConfigurationError(
        `JWT_ACCESS_SECRET declares kid '${kid}' twice; a kid must name exactly one key.`,
      );
    }
    seen.add(kid);
    keys.push({ kid, secret });
  }

  return keys;
}

/** Parses `15m`, `30d`, `3600`. Returns seconds, or the fallback. */
export function parseTtlSeconds(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const match = /^(\d+)([smhd])?$/.exec(value.trim());
  if (!match) return fallback;
  const n = Number(match[1]);
  if (n <= 0) return fallback;
  switch (match[2]) {
    case 'm':
      return n * 60;
    case 'h':
      return n * 3600;
    case 'd':
      return n * 86400;
    default:
      return n;
  }
}

/**
 * Resolves and validates the whole authentication configuration.
 *
 * Called at startup (main.ts) so a misconfigured deployment fails at boot with
 * a named cause, rather than at the first login with a 500.
 */
export function loadAuthConfig(env: NodeJS.ProcessEnv = process.env): AuthConfig {
  const keys = parseKeyring(env.JWT_ACCESS_SECRET);

  const refreshSecret = (env.JWT_REFRESH_SECRET ?? '').trim();
  if (refreshSecret.length < MIN_SECRET_LENGTH) {
    throw new AuthConfigurationError(
      `JWT_REFRESH_SECRET must be set to at least ${MIN_SECRET_LENGTH} characters. ` +
        'It keys the hash that refresh tokens are stored under; a weak key means a ' +
        'database read yields replayable sessions.',
    );
  }
  if (refreshSecret === keys[0].secret) {
    throw new AuthConfigurationError(
      'JWT_REFRESH_SECRET must differ from JWT_ACCESS_SECRET. Sharing one key means a ' +
        'leak of either compromises both the access and the refresh path.',
    );
  }

  return {
    activeKey: keys[0],
    keys,
    refreshSecret,
    accessTtlSeconds: parseTtlSeconds(env.JWT_ACCESS_TTL, DEFAULT_ACCESS_TTL_SECONDS),
    refreshTtlSeconds: parseTtlSeconds(env.JWT_REFRESH_TTL, DEFAULT_REFRESH_TTL_SECONDS),
    issuer: JWT_ISSUER,
    audience: JWT_AUDIENCE,
  };
}
