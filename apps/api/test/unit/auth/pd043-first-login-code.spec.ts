/**
 * PD-43: the first sign-in code, PD-21's one-time code with a purpose.
 *
 *   issue({ purpose: 'first_login' })  lives 72 hours (a reset still lives 10
 *                                      minutes), five tries, audited as a
 *                                      first sign-in code;
 *   complete()                         with a first sign-in code also turns the
 *                                      account from provisioned to active,
 *                                      through chat.activate_account_with_code
 *                                      in the SAME transaction that spends the
 *                                      code; a reset code never activates.
 *
 * Only a KEYED hash of any code is stored (owner rule "never stored in
 * plaintext"; PD-40 review G1, department head P2-3): HMAC-SHA256 under
 * RESET_CODE_HASH_SECRET, so the database by itself cannot recover a live code
 * by trying all 10^6. Staging and production refuse to hash without it; local
 * development and tests derive a key from JWT_REFRESH_SECRET -- never unkeyed.
 *
 * Kind-agnostic: PD-40's staff accounts reuse it unchanged. The database rules
 * (only a first sign-in code activates, only from provisioned, never the super
 * admin) are pinned in test/integration/pd043-teacher-onboarding.spec.ts.
 */
import { createHash } from 'node:crypto';
import {
  FIRST_LOGIN_CODE_HOURS,
  PasswordResetService,
  RESET_AUDIT,
  RESET_CODE_MINUTES,
  RESET_CODE_TRIES,
  resetCodeHash,
} from '@platform/auth/password-reset.service';

const SECRET = 'pd43-unit-refresh-secret-at-least-32-chars!';
const ENV = ['JWT_REFRESH_SECRET', 'RESET_CODE_HASH_SECRET', 'APP_ENV'] as const;
const inherited = Object.fromEntries(ENV.map((k) => [k, process.env[k]]));
beforeEach(() => {
  process.env.JWT_REFRESH_SECRET = SECRET;
  delete process.env.RESET_CODE_HASH_SECRET;
  process.env.APP_ENV = 'test';
});
afterAll(() => {
  for (const k of ENV) {
    if (inherited[k] === undefined) delete process.env[k];
    else process.env[k] = inherited[k];
  }
});

jest.setTimeout(30_000);

const ACCOUNT = '33333333-3333-4333-8333-333333333333';
const ORG = '11111111-1111-4111-8111-111111111111';
const ISSUER = '44444444-4444-4444-8444-444444444444';
const CODE_ID = '55555555-5555-4555-8555-555555555555';
const OLD_CODE = '77777777-7777-4777-8777-777777777777';

function issuing() {
  const created: Array<Record<string, unknown>> = [];
  const audits: Array<Record<string, unknown>> = [];
  const tx = {
    passwordResetCode: {
      count: jest.fn(async () => 0),
      findMany: jest.fn(async () => [{ id: OLD_CODE }]),
      updateMany: jest.fn(async () => ({ count: 1 })),
      create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
        created.push(data);
        return { id: CODE_ID };
      }),
    },
  };
  const prisma = {
    passwordResetCode: { count: jest.fn(async () => 0) },
    $transaction: jest.fn(async (fn: (t: typeof tx) => unknown) => fn(tx)),
  };
  const audit = { audit: jest.fn(async (_tx: unknown, row: Record<string, unknown>) => void audits.push(row)) };
  const service = new PasswordResetService(prisma as never, {} as never, audit as never);
  return { service, created, audits };
}

const input = {
  accountId: ACCOUNT,
  organizationId: ORG,
  issuedByStaffId: ISSUER,
  issuedByAccountId: '66666666-6666-4666-8666-666666666666',
  reason: 'new teacher',
  signOutEverywhere: false,
};

describe('issue(): the purpose decides how long a code lives', () => {
  it('a first sign-in code lives 72 hours and says so in the audit', async () => {
    const { service, created, audits } = issuing();
    const before = Date.now();
    const { expiresAt } = await service.issue({ ...input, purpose: 'first_login' });
    expect(FIRST_LOGIN_CODE_HOURS).toBe(72);
    expect(created[0]).toMatchObject({ purpose: 'first_login', accountId: ACCOUNT, issuedBy: ISSUER });
    expect(expiresAt.getTime() - before).toBeGreaterThanOrEqual(72 * 3_600_000 - 1_000);
    expect(expiresAt.getTime() - before).toBeLessThanOrEqual(72 * 3_600_000 + 1_000);
    expect(audits[0]).toMatchObject({ action: RESET_AUDIT.FIRST_LOGIN_ISSUED, entity: 'account', entityId: ACCOUNT });
    // A reissue names the code it kills (PD-40 review, item c).
    expect(audits[0]!.after).toMatchObject({ purpose: 'first_login', supersedes: [OLD_CODE] });
  });

  it('every code, first sign-in or reset, is stored as a keyed hash', async () => {
    const { service, created } = issuing();
    const unkeyed = (code: string) => createHash('sha256').update(`${ACCOUNT}:${code}`).digest('hex');
    const first = await service.issue({ ...input, purpose: 'first_login' });
    expect(created[0]!.codeHash).not.toBe(unkeyed(first.code));
    expect(created[0]!.codeHash).toBe(resetCodeHash(ACCOUNT, first.code));
    const reset = await service.issue(input);
    expect(created[1]!.codeHash).not.toBe(unkeyed(reset.code));
    expect(created[1]!.codeHash).toBe(resetCodeHash(ACCOUNT, reset.code));
  });

  it('the key is RESET_CODE_HASH_SECRET when set; locally a key derived from JWT_REFRESH_SECRET', () => {
    const derived = resetCodeHash(ACCOUNT, '123456');
    process.env.JWT_REFRESH_SECRET = 'another-refresh-secret-of-at-least-32-chars';
    expect(resetCodeHash(ACCOUNT, '123456')).not.toBe(derived);
    process.env.RESET_CODE_HASH_SECRET = 'a-dedicated-reset-code-hash-secret-32+chars';
    const dedicated = resetCodeHash(ACCOUNT, '123456');
    process.env.JWT_REFRESH_SECRET = SECRET;
    // The dedicated secret alone decides it.
    expect(resetCodeHash(ACCOUNT, '123456')).toBe(dedicated);
  });

  it.each(['staging', 'production'])('%s fails closed without RESET_CODE_HASH_SECRET, or with a short one', (env) => {
    process.env.APP_ENV = env;
    expect(() => resetCodeHash(ACCOUNT, '123456')).toThrow(/RESET_CODE_HASH_SECRET/);
    process.env.RESET_CODE_HASH_SECRET = 'too-short';
    expect(() => resetCodeHash(ACCOUNT, '123456')).toThrow(/RESET_CODE_HASH_SECRET/);
    process.env.RESET_CODE_HASH_SECRET = 'a-dedicated-reset-code-hash-secret-32+chars';
    expect(resetCodeHash(ACCOUNT, '123456')).toMatch(/^[0-9a-f]{64}$/);
  });

  it('a reset is unchanged: 10 minutes, the reset audit, purpose reset', async () => {
    const { service, created, audits } = issuing();
    const before = Date.now();
    const { expiresAt } = await service.issue(input);
    expect(created[0]).toMatchObject({ purpose: 'reset' });
    expect(expiresAt.getTime() - before).toBeLessThanOrEqual(RESET_CODE_MINUTES * 60_000 + 1_000);
    expect(audits[0]).toMatchObject({ action: RESET_AUDIT.ISSUED });
  });

  it('both keep five tries', () => {
    expect(RESET_CODE_TRIES).toBe(5);
  });
});

function completing(purpose: 'reset' | 'first_login', activation: 'ok' | 'refused' = 'ok') {
  const code = '123456';
  const live = {
    id: CODE_ID,
    accountId: ACCOUNT,
    purpose,
    channel: 'admin',
    issuedBy: ISSUER,
    attempts: 0,
    codeHash: resetCodeHash(ACCOUNT, code),
  };
  const raw: Array<{ sql: string; values: unknown[] }> = [];
  const retired: Array<{ where: Record<string, unknown>; data: Record<string, unknown> }> = [];
  const order: string[] = [];
  const tx = {
    passwordResetCode: { updateMany: jest.fn(async () => (order.push('spend'), { count: 1 })) },
    accountCredential: { upsert: jest.fn(async () => (order.push('password'), {})) },
    $queryRaw: jest.fn(async (strings: TemplateStringsArray, ...values: unknown[]) => {
      order.push('activate');
      raw.push({ sql: strings.join('$'), values });
      if (activation === 'refused') throw new Error('only a provisioned account is activated by a first sign-in code');
      return [{ activated: ACCOUNT }];
    }),
  };
  const prisma = {
    account: { findUnique: jest.fn(async () => ({ id: ACCOUNT })) },
    passwordResetCode: {
      findFirst: jest.fn(async () => live),
      updateMany: jest.fn(async (args: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
        retired.push(args);
        return { count: 1 };
      }),
    },
    $transaction: jest.fn(async (fn: (t: typeof tx) => unknown) => fn(tx)),
  };
  const auth = {
    revokeAccountSessionsInTx: jest.fn(async () => 0),
    enforceAccountRevocation: jest.fn(async () => undefined),
  };
  const audit = { audit: jest.fn(async () => undefined) };
  const service = new PasswordResetService(prisma as never, auth as never, audit as never);
  return { service, code, raw, order, retired };
}

describe('complete(): a first sign-in code activates the account in the same transaction', () => {
  it('first_login: spends the code, sets the password, then activates through the SQL writer', async () => {
    const { service, code, raw, order } = completing('first_login');
    await expect(service.complete('teacher@example.test', code, '1234')).resolves.toEqual({ ok: true });
    expect(raw).toHaveLength(1);
    expect(raw[0]!.sql).toContain('chat.activate_account_with_code(');
    expect(raw[0]!.values).toEqual([CODE_ID]);
    expect(order).toEqual(['spend', 'password', 'activate']);
  });

  it('a reset code never activates', async () => {
    const { service, code, raw } = completing('reset');
    await expect(service.complete('teacher@example.test', code, '1234')).resolves.toEqual({ ok: true });
    expect(raw).toEqual([]);
  });

  it('a refused activation is RESET_CODE_INVALID (no oracle, no 500) and the code is spent afterwards', async () => {
    const { service, code, retired } = completing('first_login', 'refused');
    await expect(service.complete('teacher@example.test', code, '1234')).rejects.toMatchObject({ code: 'AUTH.RESET_CODE_INVALID' });
    expect(retired).toEqual([{ where: { id: CODE_ID, usedAt: null, supersededAt: null }, data: { supersededAt: expect.any(Date) } }]);
  });

  it('the password minimum is the same 4 for a first sign-in (#171)', async () => {
    const { service, code, raw } = completing('first_login');
    await expect(service.complete('teacher@example.test', code, 'abc')).rejects.toMatchObject({ code: 'AUTH.PASSWORD_TOO_WEAK' });
    expect(raw).toEqual([]);
  });
});
