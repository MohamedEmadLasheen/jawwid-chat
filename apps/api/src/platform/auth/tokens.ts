import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * Token primitives: a minimal HS256 JWT for access tokens, and opaque random
 * tokens (refresh, password reset, e-mail verification) that are stored hashed.
 *
 * Written against node:crypto rather than pulling in `jsonwebtoken`: the
 * surface used here is small and entirely verifiable -- sign, verify, expiry --
 * and authentication should not add a dependency to a manifest infrastructure
 * does not own.
 *
 * Only HS256 is accepted. The classic JWT vulnerability is honouring the
 * token's own `alg` header, so `alg` is validated against a constant and is
 * never used to select an algorithm; `alg: none` and an RS256-signed token
 * both fail the same way as random bytes.
 */
export interface AccessClaims {
  /** Account id. */
  sub: string;
  /** Session id, so revoking the session ends the token. */
  sid: string;
  /** Resolved actor id -- the staff/teacher/contact this account acts as. */
  act: string;
  /** staff | teacher | contact */
  knd: string;
  /** Organization id. Informational: the server re-derives it from the account. */
  org?: string;
  iat: number;
  exp: number;
}

const b64url = (b: Buffer): string => b.toString('base64url');

function sign(data: string, secret: string): string {
  return b64url(createHmac('sha256', secret).update(data).digest());
}

export function signAccessToken(
  claims: Omit<AccessClaims, 'iat' | 'exp'>,
  secret: string,
  ttlSeconds: number,
): string {
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })));
  const body = b64url(Buffer.from(JSON.stringify({ ...claims, iat: now, exp: now + ttlSeconds })));
  const data = `${header}.${body}`;
  return `${data}.${sign(data, secret)}`;
}

/**
 * Returns the claims, or null for any invalid token. Never throws.
 *
 * What the claims are NOT is authorization. They name a session; the caller
 * still has to find that session live and re-resolve the actor from the
 * database. A token asserting a role or a tenant is asserting a field no code
 * path reads.
 */
export function verifyAccessToken(token: string, secret: string): AccessClaims | null {
  const parts = token.split('.');
  if (parts.length !== 3) return null;

  const [header, body, signature] = parts;
  const expected = sign(`${header}.${body}`, secret);

  // Length check first: timingSafeEqual throws on a length mismatch.
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

  let claims: AccessClaims;
  try {
    const decodedHeader = JSON.parse(Buffer.from(header, 'base64url').toString()) as {
      alg?: string;
    };
    if (decodedHeader.alg !== 'HS256') return null;
    claims = JSON.parse(Buffer.from(body, 'base64url').toString()) as AccessClaims;
  } catch {
    return null;
  }

  if (typeof claims.exp !== 'number' || claims.exp <= Math.floor(Date.now() / 1000)) return null;
  if (!claims.sub || !claims.sid || !claims.act) return null;
  return claims;
}

/** An opaque token. The plaintext exists only in the response that mints it. */
export function newOpaqueToken(): string {
  return randomBytes(32).toString('base64url');
}

/** Keyed hash for tokens at rest, so a database read yields nothing replayable. */
export function hashToken(token: string, secret: string): string {
  return createHmac('sha256', secret).update(token).digest('base64');
}

/** IP addresses are hashed, never stored: enough to notice a session moving,
 *  not enough to become a second contact channel. */
export function hashIp(ip: string | undefined, secret: string): string | null {
  if (!ip) return null;
  return createHmac('sha256', secret).update(ip).digest('base64').slice(0, 32);
}

/** Parses `15m`, `30d`, `3600`. Returns seconds. */
export function parseTtlSeconds(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const m = /^(\d+)([smhd])?$/.exec(value.trim());
  if (!m) return fallback;
  const n = Number(m[1]);
  switch (m[2]) {
    case 'm': return n * 60;
    case 'h': return n * 3600;
    case 'd': return n * 86400;
    default: return n;
  }
}
