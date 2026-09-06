/**
 * D-6 regression — actor spoofing.
 *
 * Before authentication landed, identity was `x-actor-id` on HTTP and
 * `handshake.auth.actorId` on the socket: anyone could claim to be anyone.
 * These tests pin the primitives that replaced it. The HTTP and WebSocket
 * layers are covered end to end by the acceptance run; this is the crypto that
 * everything above it rests on, and it is pure, so it runs in the unit project.
 */
import { createHmac } from 'node:crypto';
import {
  signAccessToken,
  verifyAccessToken,
  parseTtlSeconds,
  newRefreshToken,
  hashRefreshToken,
} from '../../../src/platform/auth/jwt';
import { hashPassword, verifyPassword } from '../../../src/platform/auth/password';

const SECRET = 'unit-test-access-secret-at-least-32-characters';
const OTHER = 'a-different-secret-also-at-least-32-characters';
const claims = { sub: 'account-1', sid: 'session-1', act: 'actor-1', knd: 'contact' };

describe('D-6 · access tokens', () => {
  it('round-trips a valid token', () => {
    const verified = verifyAccessToken(signAccessToken(claims, SECRET, 900), SECRET);
    expect(verified?.act).toBe('actor-1');
    expect(verified?.sid).toBe('session-1');
  });

  it('rejects a token whose claims were edited but signature kept', () => {
    const token = signAccessToken(claims, SECRET, 900);
    const [h, body, sig] = token.split('.');
    const edited = JSON.parse(Buffer.from(body, 'base64url').toString());
    edited.act = 'somebody-else';
    const forged = `${h}.${Buffer.from(JSON.stringify(edited)).toString('base64url')}.${sig}`;
    expect(verifyAccessToken(forged, SECRET)).toBeNull();
  });

  it('rejects a well-formed token signed with another key', () => {
    expect(verifyAccessToken(signAccessToken(claims, OTHER, 900), SECRET)).toBeNull();
  });

  it('rejects alg:none — the token must never choose its own algorithm', () => {
    const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
    const body = Buffer.from(
      JSON.stringify({ ...claims, iat: 0, exp: Math.floor(Date.now() / 1000) + 900 }),
    ).toString('base64url');
    expect(verifyAccessToken(`${header}.${body}.`, SECRET)).toBeNull();
    // Also with a signature that is genuinely correct for alg:none semantics.
    const sig = createHmac('sha256', SECRET).update(`${header}.${body}`).digest('base64url');
    expect(verifyAccessToken(`${header}.${body}.${sig}`, SECRET)).toBeNull();
  });

  it('rejects an expired token', () => {
    expect(verifyAccessToken(signAccessToken(claims, SECRET, -1), SECRET)).toBeNull();
  });

  it('rejects malformed input without throwing', () => {
    for (const bad of ['', 'x', 'a.b', 'a.b.c.d', 'not.a.token', '..']) {
      expect(verifyAccessToken(bad, SECRET)).toBeNull();
    }
  });

  it('rejects a token missing the actor claim', () => {
    const partial = signAccessToken(
      { sub: 'a', sid: 's', act: '', knd: 'contact' },
      SECRET,
      900,
    );
    expect(verifyAccessToken(partial, SECRET)).toBeNull();
  });
});

describe('D-6 · refresh tokens', () => {
  it('are unguessable and stored only as a hash', () => {
    const token = newRefreshToken();
    expect(token.length).toBeGreaterThanOrEqual(43);
    const hash = hashRefreshToken(token, SECRET);
    expect(hash).not.toContain(token);
    expect(hashRefreshToken(token, SECRET)).toBe(hash);
    expect(hashRefreshToken(token, OTHER)).not.toBe(hash);
  });
});

describe('D-6 · passwords', () => {
  it('verifies a correct password and refuses a wrong one', async () => {
    const stored = await hashPassword('correct-horse-battery-staple');
    expect(stored.startsWith('scrypt$')).toBe(true);
    expect(stored).not.toContain('correct-horse');
    await expect(verifyPassword('correct-horse-battery-staple', stored)).resolves.toBe(true);
    await expect(verifyPassword('wrong', stored)).resolves.toBe(false);
  });

  it('salts, so the same password hashes differently every time', async () => {
    const a = await hashPassword('same-password-value');
    const b = await hashPassword('same-password-value');
    expect(a).not.toBe(b);
  });

  it('returns false rather than throwing on a corrupt stored hash', async () => {
    for (const bad of ['', 'garbage', 'scrypt$1$2$3', 'bcrypt$x$y$z$q$r']) {
      await expect(verifyPassword('anything', bad)).resolves.toBe(false);
    }
  });
});

describe('D-6 · ttl parsing', () => {
  it('reads the documented forms and falls back safely', () => {
    expect(parseTtlSeconds('15m', 0)).toBe(900);
    expect(parseTtlSeconds('30d', 0)).toBe(2592000);
    expect(parseTtlSeconds('2h', 0)).toBe(7200);
    expect(parseTtlSeconds('3600', 0)).toBe(3600);
    expect(parseTtlSeconds(undefined, 900)).toBe(900);
    expect(parseTtlSeconds('nonsense', 900)).toBe(900);
  });
});
