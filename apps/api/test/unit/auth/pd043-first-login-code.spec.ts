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
 * A first sign-in code lives 72 hours, so only a KEYED hash of it is stored
 * (owner rule, PD-40 review G1): HMAC-SHA256 under a key derived from
 * JWT_REFRESH_SECRET for this purpose alone, so the database by itself cannot
 * recover a live code by trying all 10^6. A reset code keeps PD-21's hash.
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
const inherited = process.env.JWT_REFRESH_SECRET;
beforeAll(() => {
  process.env.JWT_REFRESH_SECRET = SECRET;
});
afterAll(() => {
  if (inherited === undefined) delete process.env.JWT_REFRESH_SECRET;
  else process.env.JWT_REFRESH_SECRET = inherited;
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

  it('a first sign-in code is stored as a keyed hash, a reset code as before', async () => {
    const { service, created } = issuing();
    const { code } = await service.issue({ ...input, purpose: 'first_login' });
    const unkeyed = createHash('sha256').update(`${ACCOUNT}:${code}`).digest('hex');
    expect(created[0]!.codeHash).not.toBe(unkeyed);
    expect(created[0]!.codeHash).toBe(resetCodeHash(ACCOUNT, code, 'first_login'));
    const reset = await service.issue(input);
    expect(created[1]!.codeHash).toBe(createHash('sha256').update(`${ACCOUNT}:${reset.code}`).digest('hex'));
  });

  it('the key is the server\'s: another JWT_REFRESH_SECRET gives another hash', () => {
    const mine = resetCodeHash(ACCOUNT, '123456', 'first_login');
    process.env.JWT_REFRESH_SECRET = 'another-refresh-secret-of-at-least-32-chars';
    try {
      expect(resetCodeHash(ACCOUNT, '123456', 'first_login')).not.toBe(mine);
    } finally {
      process.env.JWT_REFRESH_SECRET = SECRET;
    }
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

function completing(purpose: 'reset' | 'first_login') {
  const code = '123456';
  const live = {
    id: CODE_ID,
    accountId: ACCOUNT,
    purpose,
    channel: 'admin',
    issuedBy: ISSUER,
    attempts: 0,
    codeHash: resetCodeHash(ACCOUNT, code, purpose),
  };
  const raw: Array<{ sql: string; values: unknown[] }> = [];
  const order: string[] = [];
  const tx = {
    passwordResetCode: { updateMany: jest.fn(async () => (order.push('spend'), { count: 1 })) },
    accountCredential: { upsert: jest.fn(async () => (order.push('password'), {})) },
    $queryRaw: jest.fn(async (strings: TemplateStringsArray, ...values: unknown[]) => {
      order.push('activate');
      raw.push({ sql: strings.join('$'), values });
      return [{ activated: ACCOUNT }];
    }),
  };
  const prisma = {
    account: { findUnique: jest.fn(async () => ({ id: ACCOUNT })) },
    passwordResetCode: { findFirst: jest.fn(async () => live) },
    $transaction: jest.fn(async (fn: (t: typeof tx) => unknown) => fn(tx)),
  };
  const auth = {
    revokeAccountSessionsInTx: jest.fn(async () => 0),
    enforceAccountRevocation: jest.fn(async () => undefined),
  };
  const audit = { audit: jest.fn(async () => undefined) };
  const service = new PasswordResetService(prisma as never, auth as never, audit as never);
  return { service, code, raw, order };
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

  it('the password minimum is the same 4 for a first sign-in (#171)', async () => {
    const { service, code, raw } = completing('first_login');
    await expect(service.complete('teacher@example.test', code, 'abc')).rejects.toMatchObject({ code: 'AUTH.PASSWORD_TOO_WEAK' });
    expect(raw).toEqual([]);
  });
});
