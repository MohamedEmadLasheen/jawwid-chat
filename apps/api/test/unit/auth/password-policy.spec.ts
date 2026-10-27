/**
 * Owner decision, 2026-10-27: a password may be as short as 4 characters, for
 * EVERY account (parents, teachers, staff, the super admin). It was 8 (12 for
 * the super admin). The maximum (128) is unchanged.
 *
 * The length check runs before anything is looked up, so a stub database is
 * enough to prove each enforcement point accepts 4 and refuses 3: a 4-character
 * password gets PAST the check and fails on the (unknown) code instead.
 */
import { AuthError, AuthErrorCode } from '@platform/auth/auth.errors';
import { PasswordResetService } from '@platform/auth/password-reset.service';
import { ParentSignupService } from '@platform/auth/parent-signup.service';
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH, isPasswordLengthAcceptable } from '@platform/auth/password-policy';
import { MIN_PASSWORD_LENGTH } from '../../../src/cli/super-admin-bootstrap';

jest.setTimeout(30_000);

async function codeOf(p: Promise<unknown>): Promise<string | undefined> {
  try {
    await p;
    return undefined;
  } catch (e) {
    return e instanceof AuthError ? e.code : `non-auth:${String(e)}`;
  }
}

describe('the shared rule', () => {
  it('is 4..128', () => {
    expect(PASSWORD_MIN_LENGTH).toBe(4);
    expect(PASSWORD_MAX_LENGTH).toBe(128);
  });

  it('accepts 4 and refuses 3, and still refuses 129', () => {
    expect(isPasswordLengthAcceptable('abc')).toBe(false);
    expect(isPasswordLengthAcceptable('')).toBe(false);
    expect(isPasswordLengthAcceptable('1234')).toBe(true);
    expect(isPasswordLengthAcceptable('a'.repeat(128))).toBe(true);
    expect(isPasswordLengthAcceptable('a'.repeat(129))).toBe(false);
  });

  it('has no common-password list: a PIN such as 1234 is a valid password', () => {
    for (const pin of ['1234', '0000', 'pass', 'qwer']) expect(isPasswordLengthAcceptable(pin)).toBe(true);
  });

  it('is the same number the super-admin bootstrap uses', () => {
    expect(MIN_PASSWORD_LENGTH).toBe(PASSWORD_MIN_LENGTH);
  });
});

describe('POST /auth/password-reset (PasswordResetService.complete) -- every account, staff included', () => {
  // No account exists: a password that passes the length check ends at RESET_CODE_INVALID.
  const prisma = { account: { findUnique: jest.fn(async () => null) } };
  const service = new PasswordResetService(prisma as never, {} as never, {} as never);

  it('refuses 3 characters', async () => {
    expect(await codeOf(service.complete('someone@example.test', '123456', 'abc'))).toBe(AuthErrorCode.PASSWORD_TOO_WEAK);
  });

  it('accepts 4 characters (it is then judged on the code, not the password)', async () => {
    expect(await codeOf(service.complete('someone@example.test', '123456', '1234'))).toBe(AuthErrorCode.RESET_CODE_INVALID);
  });

  it('still refuses more than 128', async () => {
    expect(await codeOf(service.complete('someone@example.test', '123456', 'a'.repeat(129)))).toBe(AuthErrorCode.PASSWORD_TOO_WEAK);
  });
});

describe('POST /auth/signup/verify (ParentSignupService.verify)', () => {
  // An unusable e-mail is refused as an invalid code AFTER the password is checked and hashed.
  const service = new ParentSignupService({} as never, {} as never);

  it('refuses 3 characters', async () => {
    expect(await codeOf(service.verify('', '123456', 'abc'))).toBe(AuthErrorCode.PASSWORD_TOO_WEAK);
  });

  it('accepts 4 characters (it is then judged on the code, not the password)', async () => {
    expect(await codeOf(service.verify('', '123456', '1234'))).toBe(AuthErrorCode.SIGNUP_CODE_INVALID);
  });
});
