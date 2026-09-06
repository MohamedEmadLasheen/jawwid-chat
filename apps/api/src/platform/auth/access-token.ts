import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * HS256 access-token verification.
 *
 * PRD v0.1 section 7.1: "short-lived access tokens with rotating refresh tokens".
 * The token subject is `chat.account.subject` -- the opaque identity-provider
 * subject the identity migration (20260905090050) already defines. This module
 * VERIFIES tokens; it does not mint them. Minting belongs to the sign-in flow,
 * which needs a credential model `chat.account` does not yet carry (see
 * docs/product-operations/reconciliation-status.md).
 *
 * Implemented on node:crypto rather than a JWT library on purpose: it adds no
 * dependency to a shared lockfile, and the verification surface is small enough
 * to read in full.
 */
export interface AccessTokenClaims {
  /** chat.account.subject */
  sub: string;
  /** seconds since epoch */
  exp?: number;
  nbf?: number;
  iat?: number;
}

export class TokenError extends Error {}

const b64urlToBuffer = (s: string): Buffer => Buffer.from(s, 'base64url');

/**
 * Verifies signature, then time bounds. Returns the claims or throws.
 *
 * Every failure raises the same class with a terse reason: the caller maps them
 * all to one 401 so the response never tells an attacker which part was wrong.
 */
export function verifyAccessToken(
  token: string,
  secret: string,
  now: Date = new Date(),
): AccessTokenClaims {
  if (!secret || secret.length < 32) {
    throw new TokenError('signing secret is missing or too short');
  }

  const parts = token.split('.');
  if (parts.length !== 3) throw new TokenError('malformed token');
  const [headerB64, payloadB64, signatureB64] = parts;

  let header: { alg?: string; typ?: string };
  try {
    header = JSON.parse(b64urlToBuffer(headerB64).toString('utf8'));
  } catch {
    throw new TokenError('malformed header');
  }

  // Reject "alg": "none" and any algorithm substitution outright. Accepting the
  // header's choice of algorithm is the classic JWT forgery.
  if (header.alg !== 'HS256') throw new TokenError('unsupported algorithm');

  const expected = createHmac('sha256', secret)
    .update(`${headerB64}.${payloadB64}`)
    .digest();
  const provided = b64urlToBuffer(signatureB64);

  // Length check first: timingSafeEqual throws on a length mismatch.
  if (provided.length !== expected.length) throw new TokenError('bad signature');
  if (!timingSafeEqual(provided, expected)) throw new TokenError('bad signature');

  let claims: AccessTokenClaims;
  try {
    claims = JSON.parse(b64urlToBuffer(payloadB64).toString('utf8'));
  } catch {
    throw new TokenError('malformed payload');
  }

  if (typeof claims.sub !== 'string' || claims.sub.length === 0) {
    throw new TokenError('missing subject');
  }

  const nowSeconds = Math.floor(now.getTime() / 1000);
  if (typeof claims.exp === 'number' && nowSeconds >= claims.exp) {
    throw new TokenError('token expired');
  }
  if (typeof claims.nbf === 'number' && nowSeconds < claims.nbf) {
    throw new TokenError('token not yet valid');
  }

  return claims;
}

/** Test/tooling helper. Never used by the request path. */
export function signAccessToken(
  claims: AccessTokenClaims,
  secret: string,
): string {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify(claims)).toString('base64url');
  const signature = createHmac('sha256', secret)
    .update(`${header}.${payload}`)
    .digest('base64url');
  return `${header}.${payload}.${signature}`;
}
