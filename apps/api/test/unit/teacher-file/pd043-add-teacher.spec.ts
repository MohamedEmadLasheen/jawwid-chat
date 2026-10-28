/**
 * PD-43 PR-2, DB-free:
 *   - the first sign-in e-mail: Arabic first, then English, the code alone on
 *     its line, its lifetime in hours, and the sign-in name to type;
 *   - PasswordResetService.issueInTx writes the code inside the CALLER's
 *     transaction (gate P2-7: the teacher, their chat and the code commit
 *     together) and opens none of its own;
 *   - a CommError may carry a detail (the teacher a duplicate names), which the
 *     filter sends as `error.detail` -- what the Admin Web client already reads.
 */
import { CommError, CommErrorCode } from '@platform/errors';
import { CommErrorFilter } from '@communication/api/http-exception.filter';
import { PasswordResetService, FIRST_LOGIN_CODE_HOURS } from '@platform/auth/password-reset.service';
import { firstLoginMail } from '../../../src/account-recovery/recovery-delivery';

describe('the first sign-in e-mail', () => {
  it('Arabic first, then English; the code alone on its line; 72 hours; the sign-in name', () => {
    const mail = firstLoginMail('482913', FIRST_LOGIN_CODE_HOURS, 'new.teacher@example.test');
    const lines = mail.text.split('\n');
    expect(lines).toContain('482913');
    expect(mail.subject).toContain('482913');
    expect(mail.text).toContain('72');
    expect(mail.text).toContain('new.teacher@example.test');
    expect(mail.text.search(/[؀-ۿ]/)).toBeLessThan(mail.text.search(/Jawwid/));
    expect(mail.text).toMatch(/Never share this code/);
  });
});

describe('PasswordResetService.issueInTx', () => {
  const ENV = ['JWT_REFRESH_SECRET', 'APP_ENV'] as const;
  const inherited = Object.fromEntries(ENV.map((k) => [k, process.env[k]]));
  beforeAll(() => {
    process.env.JWT_REFRESH_SECRET = 'pd43-unit-refresh-secret-at-least-32-chars!';
    process.env.APP_ENV = 'test';
  });
  afterAll(() => {
    for (const k of ENV) {
      if (inherited[k] === undefined) delete process.env[k];
      else process.env[k] = inherited[k];
    }
  });

  it('writes in the caller\'s transaction and opens none of its own', async () => {
    const created: Array<Record<string, unknown>> = [];
    const tx = {
      passwordResetCode: {
        count: jest.fn(async () => 0),
        findMany: jest.fn(async () => []),
        updateMany: jest.fn(async () => ({ count: 0 })),
        create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => (created.push(data), { id: 'code-1' })),
      },
    };
    const prisma = { $transaction: jest.fn() };
    const audit = { audit: jest.fn(async () => undefined) };
    const service = new PasswordResetService(prisma as never, {} as never, audit as never);
    const out = await service.issueInTx(tx as never, {
      accountId: 'acc', organizationId: 'org', issuedByStaffId: 'staff', issuedByAccountId: 'staff-acc', reason: 'new teacher', signOutEverywhere: false, purpose: 'first_login',
    });
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(created[0]).toMatchObject({ purpose: 'first_login', accountId: 'acc' });
    expect(out).toMatchObject({ id: 'code-1', code: expect.stringMatching(/^[0-9]{6}$/) });
    expect(audit.audit).toHaveBeenCalledWith(tx, expect.objectContaining({ action: 'account.first_login_code_issued' }));
  });
});

describe('CommError detail', () => {
  it('travels as error.detail, beside the code and the message', () => {
    const json = jest.fn();
    const response = { status: jest.fn(() => ({ json })) };
    const host = { switchToHttp: () => ({ getResponse: () => response }) };
    new CommErrorFilter().catch(
      new CommError(CommErrorCode.TEACHER_ALREADY_ADDED, 'already a teacher here', 409, { teacher: { id: 't', name: 'N' } }),
      host as never,
    );
    expect(response.status).toHaveBeenCalledWith(409);
    expect(json).toHaveBeenCalledWith({ error: { code: 'COMM.TEACHER_ALREADY_ADDED', message: 'already a teacher here', detail: { teacher: { id: 't', name: 'N' } } } });
    // Without a detail the body is exactly as before.
    new CommErrorFilter().catch(new CommError(CommErrorCode.VALIDATION, 'x', 400), host as never);
    expect(json).toHaveBeenLastCalledWith({ error: { code: 'COMMON.VALIDATION', message: 'x' } });
  });
});
