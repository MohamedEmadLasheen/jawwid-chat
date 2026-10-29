/**
 * PD-42 S1 -- a family's contact key is a keyed hash: deterministic under one
 * secret, different under another, never the value or its bare sha-256, and
 * it fails closed in a deployed environment without the secret.
 */
import { createHash } from 'node:crypto';
import { contactKeyHash, normaliseEmailForKey } from '../../../src/new-students/contact-key';
import { resetCodeHash } from '../../../src/platform/auth/password-reset.service';

const SECRET_A = 'pd042-contact-key-secret-a-32-chars-min!';
const SECRET_B = 'pd042-contact-key-secret-b-32-chars-min!';

describe('PD-42 -- contactKeyHash', () => {
  const saved = { ...process.env };
  afterEach(() => {
    process.env = { ...saved };
  });

  it('is deterministic for one value and one secret, 64 hex characters', () => {
    process.env.RESET_CODE_HASH_SECRET = SECRET_A;
    const a = contactKeyHash('phone', '+201001234567');
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(contactKeyHash('phone', '+201001234567')).toBe(a);
  });

  it('is keyed: never the bare sha-256 of the value, and another secret gives another key', () => {
    process.env.RESET_CODE_HASH_SECRET = SECRET_A;
    const a = contactKeyHash('email', 'parent@example.test');
    expect(a).not.toBe(createHash('sha256').update('parent@example.test').digest('hex'));
    expect(a).not.toBe(createHash('sha256').update('email:parent@example.test').digest('hex'));
    process.env.RESET_CODE_HASH_SECRET = SECRET_B;
    expect(contactKeyHash('email', 'parent@example.test')).not.toBe(a);
  });

  it('separates the kinds, and is never a reset-code hash under the same secret', () => {
    process.env.RESET_CODE_HASH_SECRET = SECRET_A;
    expect(contactKeyHash('email', '1234567')).not.toBe(contactKeyHash('phone', '1234567'));
    expect(contactKeyHash('phone', '123456')).not.toBe(resetCodeHash('phone', '123456'));
  });

  it('an e-mail is keyed trimmed and in lower case', () => {
    process.env.RESET_CODE_HASH_SECRET = SECRET_A;
    expect(contactKeyHash('email', normaliseEmailForKey('  Parent@Example.TEST '))).toBe(contactKeyHash('email', 'parent@example.test'));
  });

  it('fails closed in staging and production without the secret; locally it derives from the refresh secret', () => {
    delete process.env.RESET_CODE_HASH_SECRET;
    process.env.APP_ENV = 'production';
    expect(() => contactKeyHash('phone', '+201001234567')).toThrow(/RESET_CODE_HASH_SECRET/);
    process.env.APP_ENV = 'local';
    process.env.JWT_REFRESH_SECRET = SECRET_B;
    expect(contactKeyHash('phone', '+201001234567')).toMatch(/^[0-9a-f]{64}$/);
  });

  it('refuses an empty value', () => {
    process.env.RESET_CODE_HASH_SECRET = SECRET_A;
    expect(() => contactKeyHash('phone', '  ')).toThrow();
  });
});
