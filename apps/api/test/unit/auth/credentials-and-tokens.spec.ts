/**
 * The cryptographic primitives authentication rests on.
 *
 * These are pure functions, so they are tested here rather than through a
 * request: an attack on a token is an attack on the verifier, and the verifier
 * should be provably wrong-token-proof without a database in the way.
 */
import {
  assertPasswordAcceptable,
  DUMMY_PASSWORD_HASH,
  hashPassword,
  verifyPassword,
  WeakPasswordError,
} from '@platform/auth/password';
import {
  hashIp,
  hashToken,
  newOpaqueToken,
  parseTtlSeconds,
  signAccessToken,
  verifyAccessToken,
} from '@platform/auth/tokens';

const SECRET = 'a-signing-secret-of-at-least-32-chars';
const OTHER = 'a-different-secret-of-at-least-32-chars';
const claims = { sub: 'account-1', sid: 'session-1', act: 'actor-1', knd: 'staff' };

describe('password hashing', () => {
  it('never stores the plaintext, and salts so two identical passwords differ', async () => {
    const a = await hashPassword('correct horse battery staple');
    const b = await hashPassword('correct horse battery staple');
    expect(a).not.toContain('correct horse battery staple');
    expect(a).not.toBe(b);
    expect(a.startsWith('scrypt$')).toBe(true);
  });

  it('verifies the right password and refuses the wrong one', async () => {
    const hash = await hashPassword('correct horse battery staple');
    expect(await verifyPassword('correct horse battery staple', hash)).toBe(true);
    expect(await verifyPassword('Correct horse battery staple', hash)).toBe(false);
    expect(await verifyPassword('', hash)).toBe(false);
  });

  it('carries its parameters, so the cost can be raised without invalidating passwords', async () => {
    const [algorithm, n, r, p] = (await hashPassword('x'.repeat(20))).split('$');
    expect(algorithm).toBe('scrypt');
    expect(Number(n)).toBeGreaterThanOrEqual(16384);
    expect(Number(r)).toBeGreaterThan(0);
    expect(Number(p)).toBeGreaterThan(0);
  });

  it('returns false on a malformed stored hash rather than throwing', async () => {
    for (const bad of ['', 'not-a-hash', 'scrypt$1$2$3', 'bcrypt$16384$8$1$AA==$AA==']) {
      await expect(verifyPassword('anything', bad)).resolves.toBe(false);
    }
  });

  it('the equal-time dummy hash is well formed and matches nothing', async () => {
    // The login path spends a verification against this when the subject does
    // not exist, so response timing does not reveal which subjects do.
    await expect(verifyPassword('anything', DUMMY_PASSWORD_HASH)).resolves.toBe(false);
  });

  it('enforces one length policy and nothing else', () => {
    expect(() => assertPasswordAcceptable('x'.repeat(12), 12)).not.toThrow();
    expect(() => assertPasswordAcceptable('x'.repeat(11), 12)).toThrow(WeakPasswordError);
  });
});

describe('access tokens', () => {
  it('round-trips claims and sets an expiry', () => {
    const verified = verifyAccessToken(signAccessToken(claims, SECRET, 900), SECRET);
    expect(verified).toMatchObject(claims);
    expect(verified!.exp - verified!.iat).toBe(900);
  });

  it('refuses a token signed with another key', () => {
    expect(verifyAccessToken(signAccessToken(claims, OTHER, 900), SECRET)).toBeNull();
  });

  it('refuses a tampered payload', () => {
    const [h, , s] = signAccessToken(claims, SECRET, 900).split('.');
    const forged = Buffer.from(
      JSON.stringify({ ...claims, act: 'somebody-else', iat: 1, exp: 4102444800 }),
    ).toString('base64url');
    expect(verifyAccessToken(`${h}.${forged}.${s}`, SECRET)).toBeNull();
  });

  it('refuses alg:none and any algorithm substitution -- the token never chooses', () => {
    const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
    const body = Buffer.from(
      JSON.stringify({ ...claims, iat: 1, exp: 4102444800 }),
    ).toString('base64url');
    expect(verifyAccessToken(`${header}.${body}.`, SECRET)).toBeNull();
    expect(verifyAccessToken(`${header}.${body}.anything`, SECRET)).toBeNull();

    // A correctly HMAC'd token whose header claims another algorithm is still
    // refused: the header is validated against a constant, never honoured.
    const rs256 = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
    const signed = signAccessToken(claims, SECRET, 900).split('.');
    expect(verifyAccessToken(`${rs256}.${signed[1]}.${signed[2]}`, SECRET)).toBeNull();
  });

  it('refuses an expired token', () => {
    expect(verifyAccessToken(signAccessToken(claims, SECRET, -1), SECRET)).toBeNull();
  });

  it('refuses structurally invalid input rather than throwing', () => {
    for (const bad of ['', 'a', 'a.b', 'a.b.c.d', '...', 'not.a.token']) {
      expect(verifyAccessToken(bad, SECRET)).toBeNull();
    }
  });

  it('refuses a token missing the session id, however well signed', () => {
    const noSid = signAccessToken({ ...claims, sid: '' }, SECRET, 900);
    expect(verifyAccessToken(noSid, SECRET)).toBeNull();
  });
});

describe('opaque tokens and hashing at rest', () => {
  it('mints unpredictable tokens', () => {
    const seen = new Set(Array.from({ length: 200 }, () => newOpaqueToken()));
    expect(seen.size).toBe(200);
    expect(newOpaqueToken().length).toBeGreaterThanOrEqual(40);
  });

  it('hashes deterministically under one key and differently under another', () => {
    const token = newOpaqueToken();
    expect(hashToken(token, SECRET)).toBe(hashToken(token, SECRET));
    expect(hashToken(token, SECRET)).not.toBe(hashToken(token, OTHER));
    expect(hashToken(token, SECRET)).not.toContain(token);
  });

  it('stores an address as a hash, never as an address', () => {
    expect(hashIp('203.0.113.9', SECRET)).not.toContain('203.0.113');
    expect(hashIp(undefined, SECRET)).toBeNull();
  });
});

describe('ttl parsing', () => {
  it('reads seconds, minutes, hours and days', () => {
    expect(parseTtlSeconds('3600', 0)).toBe(3600);
    expect(parseTtlSeconds('15m', 0)).toBe(900);
    expect(parseTtlSeconds('2h', 0)).toBe(7200);
    expect(parseTtlSeconds('30d', 0)).toBe(2592000);
  });

  it('falls back rather than producing a nonsense lifetime', () => {
    for (const bad of [undefined, '', 'soon', '-5', '5w']) {
      expect(parseTtlSeconds(bad, 900)).toBe(900);
    }
  });
});
