import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * Minimal HS256 JWT. Owner: AI #1 seam, implemented by AI #7 (D-6).
 *
 * Written against node:crypto rather than pulling in `jsonwebtoken`, for the
 * same reason as the password hashing: authentication should not add a
 * dependency to a manifest infrastructure does not own. The surface used here
 * is small and entirely verifiable -- sign, verify, expiry.
 *
 * Only HS256 is accepted. The classic JWT vulnerability is honouring the
 * token's own `alg` header, so `alg` is validated against a constant and never
 * used to select an algorithm.
 */
export interface AccessClaims {
  /** Account id. */
  sub: string;
  /** Session id, so revoking the session ends the token. */
  sid: string;
  /** Resolved actor id -- the staff/contact/teacher this account acts as. */
  act: string;
  /** staff | contact | teacher */
  knd: string;
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
  const body = b64url(
    Buffer.from(JSON.stringify({ ...claims, iat: now, exp: now + ttlSeconds })),
  );
  const data = `${header}.${body}`;
  return `${data}.${sign(data, secret)}`;
}

/** Returns the claims, or null for any invalid token. Never throws. */
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
    // Never let the token choose its own algorithm.
    if (decodedHeader.alg !== 'HS256') return null;
    claims = JSON.parse(Buffer.from(body, 'base64url').toString()) as AccessClaims;
  } catch {
    return null;
  }

  if (typeof claims.exp !== 'number' || claims.exp <= Math.floor(Date.now() / 1000)) return null;
  if (!claims.sub || !claims.sid || !claims.act) return null;
  return claims;
}

/** Opaque refresh token. Stored hashed; the plaintext is only ever sent to the client. */
export function newRefreshToken(): string {
  return randomBytes(32).toString('base64url');
}

export function hashRefreshToken(token: string, secret: string): string {
  return createHmac('sha256', secret).update(token).digest('base64');
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
