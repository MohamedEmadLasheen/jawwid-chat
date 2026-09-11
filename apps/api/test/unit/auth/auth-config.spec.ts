/**
 * Fail-closed authentication configuration (IDENTITY-MODEL §4, RT-005).
 *
 * The rule these pin: there is no development fallback, no generated-at-boot
 * key, and no short key. Every one of those makes tokens forgeable by anyone
 * who can guess the default, and RT-005 is the finding that says so.
 */
import {
  AuthConfigurationError,
  deriveKid,
  JWT_AUDIENCE,
  JWT_ISSUER,
  loadAuthConfig,
  MIN_SECRET_LENGTH,
  parseKeyring,
  parseTtlSeconds,
} from '@platform/auth/auth.config';
import { TEST_ACCESS_SECRET, TEST_REFRESH_SECRET } from './support/fake-db';

const LONG_A = 'a'.repeat(40);
const LONG_B = 'b'.repeat(40);

describe('the signing keyring', () => {
  it('refuses to start with no JWT_ACCESS_SECRET at all', () => {
    expect(() => parseKeyring(undefined)).toThrow(AuthConfigurationError);
    expect(() => parseKeyring('')).toThrow(AuthConfigurationError);
    expect(() => parseKeyring('   ')).toThrow(AuthConfigurationError);
  });

  it('refuses a secret shorter than the minimum, and never echoes its value', () => {
    const short = 'x'.repeat(MIN_SECRET_LENGTH - 1);
    expect(() => parseKeyring(short)).toThrow(AuthConfigurationError);
    try {
      parseKeyring(short);
    } catch (e) {
      expect((e as Error).message).not.toContain(short);
    }
  });

  it('derives a kid for a bare secret, so every token can name its key', () => {
    const [key] = parseKeyring(LONG_A);
    expect(key.secret).toBe(LONG_A);
    expect(key.kid).toBe(deriveKid(LONG_A));
    expect(key.kid).toHaveLength(16);
  });

  it('the derived kid discloses nothing: it is not a prefix of the secret', () => {
    expect(LONG_A).not.toContain(deriveKid(LONG_A));
  });

  it('accepts a labelled keyring, and the FIRST entry is the one that signs', () => {
    const keys = parseKeyring(`new:${LONG_A},old:${LONG_B}`);
    expect(keys.map((k) => k.kid)).toEqual(['new', 'old']);
    expect(keys[0].secret).toBe(LONG_A);
    expect(keys[1].secret).toBe(LONG_B);
  });

  it('refuses a keyring that names one kid twice', () => {
    expect(() => parseKeyring(`k1:${LONG_A},k1:${LONG_B}`)).toThrow(/twice/);
  });

  it('refuses a short key inside an otherwise valid keyring', () => {
    expect(() => parseKeyring(`good:${LONG_A},bad:short`)).toThrow(AuthConfigurationError);
  });

  it('keeps a base64-ish secret whole when its prefix is not label-shaped', () => {
    // A kid label is [A-Za-z0-9_-]. A generated secret usually contains '+',
    // '/' or '=' before any colon, so it is not truncated into a shorter key
    // than the operator configured.
    const withColon = `ab+cd/ef=gh:${'y'.repeat(40)}`;
    const [key] = parseKeyring(withColon);
    expect(key.secret).toBe(withColon);
  });

  it('a label-shaped prefix IS a kid -- and a short remainder fails CLOSED, not quietly', () => {
    // The ambiguity is real: `zzzz...:yyyy...` is read as kid + secret. What
    // matters is the failure mode. Misreading makes the key SHORTER, and a
    // short key is refused outright -- so the mistake stops the boot with a
    // named cause instead of silently signing with twenty characters.
    expect(() => parseKeyring(`${'z'.repeat(20)}:${'y'.repeat(20)}`)).toThrow(
      AuthConfigurationError,
    );

    // And when the remainder is long enough, the split is the intended one.
    const [key] = parseKeyring(`prod2026:${'y'.repeat(40)}`);
    expect(key.kid).toBe('prod2026');
    expect(key.secret).toBe('y'.repeat(40));
  });
});

describe('loadAuthConfig', () => {
  const clean = (): NodeJS.ProcessEnv => ({
    JWT_ACCESS_SECRET: TEST_ACCESS_SECRET,
    JWT_REFRESH_SECRET: TEST_REFRESH_SECRET,
  });

  it('refuses a missing or short JWT_REFRESH_SECRET', () => {
    expect(() => loadAuthConfig({ ...clean(), JWT_REFRESH_SECRET: undefined })).toThrow(
      AuthConfigurationError,
    );
    expect(() => loadAuthConfig({ ...clean(), JWT_REFRESH_SECRET: 'short' })).toThrow(
      AuthConfigurationError,
    );
  });

  it('refuses one secret used for both access and refresh', () => {
    expect(() =>
      loadAuthConfig({ JWT_ACCESS_SECRET: LONG_A, JWT_REFRESH_SECRET: LONG_A }),
    ).toThrow(/must differ/);
  });

  it('pins issuer and audience as constants, not configuration', () => {
    const config = loadAuthConfig(clean());
    expect(config.issuer).toBe(JWT_ISSUER);
    expect(config.audience).toBe(JWT_AUDIENCE);
    // A deployment that could change these could make one issuer's token
    // acceptable to another's verifier.
    expect(loadAuthConfig({ ...clean(), JWT_ISSUER: 'evil', JWT_AUDIENCE: 'evil' })).toMatchObject({
      issuer: JWT_ISSUER,
      audience: JWT_AUDIENCE,
    });
  });

  it('defaults the TTLs to the values .env.example declares', () => {
    const config = loadAuthConfig(clean());
    expect(config.accessTtlSeconds).toBe(900);
    expect(config.refreshTtlSeconds).toBe(2_592_000);
  });
});

describe('parseTtlSeconds', () => {
  it('understands the suffixes the manifest uses', () => {
    expect(parseTtlSeconds('15m', 1)).toBe(900);
    expect(parseTtlSeconds('30d', 1)).toBe(2_592_000);
    expect(parseTtlSeconds('2h', 1)).toBe(7200);
    expect(parseTtlSeconds('45s', 1)).toBe(45);
    expect(parseTtlSeconds('3600', 1)).toBe(3600);
  });

  it('falls back rather than producing a zero or negative lifetime', () => {
    // A TTL of 0 would mint tokens that are already expired; a garbage value
    // must not become one by accident.
    expect(parseTtlSeconds('0', 900)).toBe(900);
    expect(parseTtlSeconds('-5', 900)).toBe(900);
    expect(parseTtlSeconds('soon', 900)).toBe(900);
    expect(parseTtlSeconds(undefined, 900)).toBe(900);
  });
});
