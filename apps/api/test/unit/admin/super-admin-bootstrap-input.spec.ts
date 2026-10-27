/**
 * The bootstrap's input rules, without a database.
 *
 * The property that matters most is negative: a refusal NEVER quotes the
 * password, not even in part. The integration suite proves the database half.
 */
import {
  BootstrapRefusal,
  BootstrapRefusalCode,
  MIN_PASSWORD_LENGTH,
  validateBootstrapInput,
} from '../../../src/cli/super-admin-bootstrap';
import { describeTarget } from '../../../src/cli/bootstrap-super-admin';

const ok = { email: 'owner@qa.jawwid.test', password: 'a-long-enough-secret-1', displayName: 'Owner' };

function refusal(fn: () => unknown): BootstrapRefusal {
  try {
    fn();
  } catch (error) {
    if (error instanceof BootstrapRefusal) return error;
    throw error;
  }
  throw new Error('expected a refusal');
}

describe('validateBootstrapInput', () => {
  it('normalizes the subject to trimmed lower case', () => {
    expect(validateBootstrapInput({ ...ok, email: '  Owner@QA.jawwid.test ' }).subject).toBe(
      'owner@qa.jawwid.test',
    );
  });

  it('refuses an address that is not one', () => {
    expect(refusal(() => validateBootstrapInput({ ...ok, email: 'not-an-email' })).code).toBe(
      BootstrapRefusalCode.INVALID_EMAIL,
    );
  });

  // Owner decision 2026-10-27: 4 for ALL accounts, the super admin included (it was 12).
  it('the minimum is 4, the same as every other account', () => {
    expect(MIN_PASSWORD_LENGTH).toBe(4);
  });

  it('accepts a 4-character password and refuses a 3-character one', () => {
    expect(() => validateBootstrapInput({ ...ok, password: '1234' })).not.toThrow();
    expect(refusal(() => validateBootstrapInput({ ...ok, password: '123' })).code).toBe(
      BootstrapRefusalCode.WEAK_PASSWORD,
    );
  });

  it(`refuses a password shorter than ${MIN_PASSWORD_LENGTH}, blank, or equal to the address`, () => {
    for (const password of ['ab1', ' '.repeat(20), 'OWNER@qa.jawwid.test']) {
      expect(refusal(() => validateBootstrapInput({ ...ok, password })).code).toBe(
        BootstrapRefusalCode.WEAK_PASSWORD,
      );
    }
  });

  it('never quotes the password in a refusal', () => {
    const password = 'x9!'; // 3 chars: a digit the rule text (4-256) does not contain
    const error = refusal(() => validateBootstrapInput({ ...ok, password }));
    expect(error.message).not.toContain(password);
    expect(error.message).not.toContain(String(password.length));
  });

  it('refuses an empty display name', () => {
    expect(refusal(() => validateBootstrapInput({ ...ok, displayName: '  ' })).code).toBe(
      BootstrapRefusalCode.INVALID_NAME,
    );
  });
});

describe('describeTarget', () => {
  it('names host, port and database -- never the user or password', () => {
    // A placeholder password, short enough that the secret scanner does not
    // read the fixture as a committed credential.
    const described = describeTarget('postgres://owner:pw-x1@db.internal:6543/jawwid_chat?schema=chat');
    expect(described).toBe('db.internal:6543/jawwid_chat');
    expect(described).not.toContain('pw-x1');
    expect(described).not.toContain('owner');
  });

  it('defaults the port', () => {
    expect(describeTarget('postgresql://u:p@localhost/x')).toBe('localhost:5432/x');
  });
});
