/**
 * The JWT contract, and the attacks it must refuse.
 *
 * Every negative case here is a real, published JWT break: algorithm
 * confusion, `alg: none`, signature stripping, cross-issuer replay, cross-
 * audience replay, and expiry that is checked nowhere.
 */
import { createHmac } from 'node:crypto';
import { loadAuthConfig, type AuthConfig } from '@platform/auth/auth.config';
import {
  hashRefreshToken,
  newRefreshToken,
  peekKid,
  signAccessToken,
  verifyAccessToken,
  JWT_ALGORITHM,
} from '@platform/auth/jwt';
import { TEST_ACCESS_SECRET, TEST_REFRESH_SECRET } from './support/fake-db';

const CLAIMS = {
  sub: 'parent-0001',
  sid: '33333333-3333-3333-3333-333333333333',
  act: '44444444-4444-4444-4444-444444444444',
  knd: 'contact',
  org: '11111111-1111-1111-1111-111111111111',
};

const config = (): AuthConfig =>
  loadAuthConfig({
    JWT_ACCESS_SECRET: TEST_ACCESS_SECRET,
    JWT_REFRESH_SECRET: TEST_REFRESH_SECRET,
  });

const b64 = (o: unknown): string => Buffer.from(JSON.stringify(o)).toString('base64url');

/** Re-signs a crafted header/payload with a chosen secret. */
function forge(header: unknown, payload: unknown, secret: string): string {
  const data = `${b64(header)}.${b64(payload)}`;
  return `${data}.${createHmac('sha256', secret).update(data).digest('base64url')}`;
}

describe('a valid access token', () => {
  it('round-trips every claim the identity chain depends on', () => {
    const c = config();
    const result = verifyAccessToken(signAccessToken(CLAIMS, c), c);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.claims).toMatchObject(CLAIMS);
    expect(result.claims.iss).toBe(c.issuer);
    expect(result.claims.aud).toBe(c.audience);
    expect(result.claims.exp - result.claims.iat).toBe(c.accessTtlSeconds);
  });

  it('names its signing key in the header, so the key can be rotated', () => {
    const c = config();
    expect(peekKid(signAccessToken(CLAIMS, c))).toBe(c.activeKey.kid);
  });

  it('declares HS256 and nothing else', () => {
    const c = config();
    const header = JSON.parse(
      Buffer.from(signAccessToken(CLAIMS, c).split('.')[0], 'base64url').toString(),
    ) as { alg: string };
    expect(header.alg).toBe(JWT_ALGORITHM);
  });
});

describe('tokens that must be refused', () => {
  it('a tampered payload -- the signature no longer covers it', () => {
    const c = config();
    const [header, , signature] = signAccessToken(CLAIMS, c).split('.');
    const escalated = b64({ ...CLAIMS, knd: 'staff', iss: c.issuer, aud: c.audience, iat: 0, exp: 9e9 });

    const result = verifyAccessToken(`${header}.${escalated}.${signature}`, c);
    expect(result).toEqual({ ok: false, reason: 'bad_signature' });
  });

  it('a token signed with the wrong secret', () => {
    const c = config();
    const forged = forge(
      { alg: 'HS256', typ: 'JWT', kid: c.activeKey.kid },
      { ...CLAIMS, iss: c.issuer, aud: c.audience, iat: 0, exp: 9e9 },
      'a-different-secret-that-is-32-chars-long',
    );
    expect(verifyAccessToken(forged, c)).toEqual({ ok: false, reason: 'bad_signature' });
  });

  it('alg: none -- the token does not get to say it needs no signature', () => {
    const c = config();
    const unsigned = `${b64({ alg: 'none', typ: 'JWT' })}.${b64({ ...CLAIMS, exp: 9e9 })}.`;
    expect(verifyAccessToken(unsigned, c).ok).toBe(false);
    // and with a non-empty third segment, so it is not merely the empty-part check
    const padded = `${b64({ alg: 'none', typ: 'JWT' })}.${b64({ ...CLAIMS, exp: 9e9 })}.x`;
    expect(verifyAccessToken(padded, c)).toEqual({ ok: false, reason: 'bad_algorithm' });
  });

  it('algorithm confusion -- RS256/HS512 in the header is not honoured', () => {
    const c = config();
    for (const alg of ['RS256', 'HS512', 'ES256', 'hs256']) {
      const token = forge(
        { alg, typ: 'JWT', kid: c.activeKey.kid },
        { ...CLAIMS, iss: c.issuer, aud: c.audience, iat: 0, exp: 9e9 },
        c.activeKey.secret,
      );
      expect(verifyAccessToken(token, c)).toEqual({ ok: false, reason: 'bad_algorithm' });
    }
  });

  it('an unknown kid is refused rather than falling back to the active key', () => {
    const c = config();
    const token = forge(
      { alg: 'HS256', typ: 'JWT', kid: 'attacker-chosen' },
      { ...CLAIMS, iss: c.issuer, aud: c.audience, iat: 0, exp: 9e9 },
      c.activeKey.secret,
    );
    expect(verifyAccessToken(token, c)).toEqual({ ok: false, reason: 'unknown_kid' });
  });

  it('a foreign issuer -- a token minted by something else is not ours', () => {
    const c = config();
    const token = forge(
      { alg: 'HS256', typ: 'JWT', kid: c.activeKey.kid },
      { ...CLAIMS, iss: 'some-other-system', aud: c.audience, iat: 0, exp: 9e9 },
      c.activeKey.secret,
    );
    expect(verifyAccessToken(token, c)).toEqual({ ok: false, reason: 'bad_issuer' });
  });

  it('a foreign audience -- a token minted for another service is not ours', () => {
    const c = config();
    const token = forge(
      { alg: 'HS256', typ: 'JWT', kid: c.activeKey.kid },
      { ...CLAIMS, iss: c.issuer, aud: 'jawwid-core', iat: 0, exp: 9e9 },
      c.activeKey.secret,
    );
    expect(verifyAccessToken(token, c)).toEqual({ ok: false, reason: 'bad_audience' });
  });

  it('an expired token, including one that expired exactly now', () => {
    const c = config();
    const issuedAt = 1_000_000;
    const token = signAccessToken(CLAIMS, c, issuedAt);
    const expiresAt = issuedAt + c.accessTtlSeconds;

    expect(verifyAccessToken(token, c, expiresAt - 1).ok).toBe(true);
    expect(verifyAccessToken(token, c, expiresAt)).toEqual({ ok: false, reason: 'expired' });
    expect(verifyAccessToken(token, c, expiresAt + 3600)).toEqual({ ok: false, reason: 'expired' });
  });

  it('a token with no exp at all does not become an eternal token', () => {
    const c = config();
    const token = forge(
      { alg: 'HS256', typ: 'JWT', kid: c.activeKey.kid },
      { sub: CLAIMS.sub, sid: CLAIMS.sid, act: CLAIMS.act, knd: CLAIMS.knd, iss: c.issuer, aud: c.audience },
      c.activeKey.secret,
    );
    expect(verifyAccessToken(token, c)).toEqual({ ok: false, reason: 'expired' });
  });

  it('a token missing the claims identity resolution needs', () => {
    const c = config();
    for (const missing of ['sub', 'sid', 'act', 'knd'] as const) {
      const payload: Record<string, unknown> = {
        ...CLAIMS,
        iss: c.issuer,
        aud: c.audience,
        iat: 0,
        exp: 9e9,
      };
      delete payload[missing];
      const token = forge({ alg: 'HS256', typ: 'JWT', kid: c.activeKey.kid }, payload, c.activeKey.secret);
      expect(verifyAccessToken(token, c)).toEqual({ ok: false, reason: 'incomplete_claims' });
    }
  });

  it('malformed input of every shape, without throwing', () => {
    const c = config();
    for (const bad of ['', '.', '..', 'a.b', 'a.b.c.d', 'not-a-token', 'a..c', '...']) {
      expect(() => verifyAccessToken(bad, c)).not.toThrow();
      expect(verifyAccessToken(bad, c).ok).toBe(false);
    }
  });
});

describe('key rotation', () => {
  const rotated = (): AuthConfig =>
    loadAuthConfig({
      JWT_ACCESS_SECRET: `new:${'n'.repeat(40)},old:${'o'.repeat(40)}`,
      JWT_REFRESH_SECRET: TEST_REFRESH_SECRET,
    });

  it('signs with the new key and still verifies tokens signed by the old one', () => {
    const before = loadAuthConfig({
      JWT_ACCESS_SECRET: `old:${'o'.repeat(40)}`,
      JWT_REFRESH_SECRET: TEST_REFRESH_SECRET,
    });
    const oldToken = signAccessToken(CLAIMS, before);

    const after = rotated();
    expect(peekKid(signAccessToken(CLAIMS, after))).toBe('new');
    expect(verifyAccessToken(oldToken, after).ok).toBe(true);
  });

  it('stops accepting the retired key once it is dropped from the keyring', () => {
    const oldToken = signAccessToken(
      CLAIMS,
      loadAuthConfig({
        JWT_ACCESS_SECRET: `old:${'o'.repeat(40)}`,
        JWT_REFRESH_SECRET: TEST_REFRESH_SECRET,
      }),
    );
    const onlyNew = loadAuthConfig({
      JWT_ACCESS_SECRET: `new:${'n'.repeat(40)}`,
      JWT_REFRESH_SECRET: TEST_REFRESH_SECRET,
    });
    expect(verifyAccessToken(oldToken, onlyNew)).toEqual({ ok: false, reason: 'unknown_kid' });
  });

  it('a kid-less token is refused once more than one key exists', () => {
    // Guessing which key a token meant would let a retired key's token be
    // verified by the active one.
    const single = loadAuthConfig({
      JWT_ACCESS_SECRET: 'n'.repeat(40),
      JWT_REFRESH_SECRET: TEST_REFRESH_SECRET,
    });
    const kidless = forge(
      { alg: 'HS256', typ: 'JWT' },
      { ...CLAIMS, iss: single.issuer, aud: single.audience, iat: 0, exp: 9e9 },
      'n'.repeat(40),
    );
    expect(verifyAccessToken(kidless, single).ok).toBe(true);
    expect(verifyAccessToken(kidless, rotated())).toEqual({ ok: false, reason: 'unknown_kid' });
  });
});

describe('refresh tokens', () => {
  it('are opaque and unguessable, not JWTs', () => {
    const token = newRefreshToken();
    expect(token.split('.')).toHaveLength(1);
    expect(Buffer.from(token, 'base64url')).toHaveLength(32);
    expect(new Set(Array.from({ length: 200 }, () => newRefreshToken())).size).toBe(200);
  });

  it('are stored under a keyed hash, so the stored value cannot be replayed', () => {
    const token = newRefreshToken();
    const stored = hashRefreshToken(token, TEST_REFRESH_SECRET);

    expect(stored).not.toContain(token);
    expect(hashRefreshToken(token, TEST_REFRESH_SECRET)).toBe(stored);
    // Keyed, not a bare digest: without the process secret a leaked table
    // cannot be attacked by hashing candidate tokens offline.
    expect(hashRefreshToken(token, 'another-secret-32-characters-long!!')).not.toBe(stored);
  });
});
