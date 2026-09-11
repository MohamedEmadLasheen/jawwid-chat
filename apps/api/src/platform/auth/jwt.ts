import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type { AuthConfig, SigningKey } from './auth.config';

/**
 * HS256 access tokens (PR-B).
 *
 * Written against node:crypto rather than `jsonwebtoken`, as the archived D-6
 * baseline was: the surface is sign / verify / expiry and is entirely
 * reviewable here, and a JWT library's headline CVEs have historically been in
 * the parts of the spec this does not implement.
 *
 * Three things make this safe, and every one of them is a test:
 *
 *   1. Only HS256. The classic JWT break is honouring the token's own `alg`
 *      header -- `alg: none`, or RS256 verified with the public key as an HMAC
 *      secret. `alg` is compared to a constant and NEVER used to select an
 *      algorithm.
 *   2. `kid` selects a key only from the configured keyring. A token naming an
 *      unknown kid is refused rather than falling back to the active key.
 *   3. `iss`, `aud` and `exp` are all checked. A token minted for something
 *      else, by something else, or last week, is not a token.
 *
 * Claims beyond identity are ignored on purpose: the token says who it claims
 * to be, and the database decides whether that is still true.
 */
export const JWT_ALGORITHM = 'HS256';

export interface AccessClaims {
  /** `chat.account.subject` -- the canonical login identifier. */
  sub: string;
  /** `chat.session.id`. Revoking the row ends the token on the next request. */
  sid: string;
  /** The resolved actor id (staff / contact / teacher) this account acts as. */
  act: string;
  /** contact | staff | teacher */
  knd: string;
  /** The actor's organization. Read for defence in depth, never as the tenant. */
  org: string;
  iss: string;
  aud: string;
  iat: number;
  exp: number;
}

export type AccessClaimsInput = Pick<AccessClaims, 'sub' | 'sid' | 'act' | 'knd' | 'org'>;

/** Why a token was refused. Never returned to a client -- the body is uniform. */
export type JwtFailure =
  | 'malformed'
  | 'bad_algorithm'
  | 'unknown_kid'
  | 'bad_signature'
  | 'bad_issuer'
  | 'bad_audience'
  | 'expired'
  | 'incomplete_claims';

export type VerifyResult =
  | { readonly ok: true; readonly claims: AccessClaims }
  | { readonly ok: false; readonly reason: JwtFailure };

const b64url = (value: Buffer | string): string =>
  (typeof value === 'string' ? Buffer.from(value) : value).toString('base64url');

function hmac(data: string, secret: string): string {
  return createHmac('sha256', secret).update(data).digest('base64url');
}

/** Constant-time comparison that tolerates a length mismatch without throwing. */
function equals(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

export function signAccessToken(
  claims: AccessClaimsInput,
  config: AuthConfig,
  nowSeconds: number = Math.floor(Date.now() / 1000),
): string {
  const header = b64url(
    JSON.stringify({ alg: JWT_ALGORITHM, typ: 'JWT', kid: config.activeKey.kid }),
  );
  const payload = b64url(
    JSON.stringify({
      ...claims,
      iss: config.issuer,
      aud: config.audience,
      iat: nowSeconds,
      exp: nowSeconds + config.accessTtlSeconds,
    } satisfies AccessClaims),
  );
  const data = `${header}.${payload}`;
  return `${data}.${hmac(data, config.activeKey.secret)}`;
}

/**
 * Verifies a token against the configured keyring. Never throws.
 *
 * Returns a reason so the server can log WHY a token failed without telling the
 * client, which would otherwise be an oracle for probing the verifier.
 */
export function verifyAccessToken(
  token: string,
  config: AuthConfig,
  nowSeconds: number = Math.floor(Date.now() / 1000),
): VerifyResult {
  const parts = token.split('.');
  if (parts.length !== 3 || parts.some((p) => p.length === 0)) {
    return { ok: false, reason: 'malformed' };
  }
  const [header, payload, signature] = parts;

  let decodedHeader: { alg?: unknown; kid?: unknown };
  try {
    decodedHeader = JSON.parse(Buffer.from(header, 'base64url').toString('utf8')) as {
      alg?: unknown;
      kid?: unknown;
    };
  } catch {
    return { ok: false, reason: 'malformed' };
  }

  // Never let the token choose its own algorithm.
  if (decodedHeader.alg !== JWT_ALGORITHM) return { ok: false, reason: 'bad_algorithm' };

  const key = selectKey(decodedHeader.kid, config.keys);
  if (!key) return { ok: false, reason: 'unknown_kid' };

  if (!equals(signature, hmac(`${header}.${payload}`, key.secret))) {
    return { ok: false, reason: 'bad_signature' };
  }

  let claims: AccessClaims;
  try {
    claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as AccessClaims;
  } catch {
    return { ok: false, reason: 'malformed' };
  }

  // Order matters only for the reason code; each of these alone refuses.
  if (claims.iss !== config.issuer) return { ok: false, reason: 'bad_issuer' };
  if (claims.aud !== config.audience) return { ok: false, reason: 'bad_audience' };
  if (typeof claims.exp !== 'number' || claims.exp <= nowSeconds) {
    return { ok: false, reason: 'expired' };
  }
  if (!claims.sub || !claims.sid || !claims.act || !claims.knd) {
    return { ok: false, reason: 'incomplete_claims' };
  }

  return { ok: true, claims };
}

/**
 * A token with no `kid` is accepted only when exactly one key is configured --
 * the pre-rotation shape. Once a second key exists the token must say which one
 * it means, because guessing would let a retired key's token be verified by the
 * active one.
 */
function selectKey(kid: unknown, keys: readonly SigningKey[]): SigningKey | null {
  if (kid === undefined || kid === null) return keys.length === 1 ? keys[0] : null;
  if (typeof kid !== 'string') return null;
  return keys.find((k) => k.kid === kid) ?? null;
}

/** Reads `kid` without verifying anything. For diagnostics only. */
export function peekKid(token: string): string | null {
  try {
    const header = JSON.parse(
      Buffer.from(token.split('.')[0] ?? '', 'base64url').toString('utf8'),
    ) as { kid?: unknown };
    return typeof header.kid === 'string' ? header.kid : null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Refresh tokens
// ---------------------------------------------------------------------------

/**
 * An opaque refresh token: 256 bits of CSPRNG output, no structure.
 *
 * Deliberately NOT a JWT. A refresh token's authority comes from a row that can
 * be revoked, so putting claims in it would create a second, unrevocable source
 * of truth.
 */
export function newRefreshToken(): string {
  return randomBytes(32).toString('base64url');
}

/**
 * What is stored. Keyed HMAC rather than a bare digest, so a leaked database
 * cannot be attacked by hashing candidate tokens offline without also stealing
 * JWT_REFRESH_SECRET from the process environment.
 */
export function hashRefreshToken(token: string, refreshSecret: string): string {
  return createHmac('sha256', refreshSecret).update(token).digest('base64');
}

/** Hashed, never the raw address (IDENTITY-MODEL §6). */
export function hashIp(ip: string | undefined, refreshSecret: string): string | null {
  if (!ip) return null;
  return createHmac('sha256', refreshSecret).update(ip).digest('base64').slice(0, 44);
}
