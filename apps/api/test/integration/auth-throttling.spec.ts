/**
 * Authentication abuse protection.
 *
 * The per-credential lockout Phase 1 already had stops somebody guessing ONE
 * person's password. These are the attacks it does not touch: spraying one
 * password across many subjects (no single credential ever reaches its limit),
 * hammering forgot-password to learn which subjects exist, and guessing a reset
 * token.
 *
 * The property that matters most here is the one that is easy to get wrong: the
 * throttle must not become the enumeration oracle it exists to prevent. An
 * unknown subject has to be counted, refused and timed exactly like a real one.
 */
import { buildGraph, seed, truncate, Scenario } from './harness';
import { AuthError } from '@platform/auth/auth.errors';
import { ThrottleScope } from '@platform/auth/throttle.service';

const g = buildGraph();
let s: Scenario;

const PASSWORD = 'a-sufficiently-long-password';
const subjectOf = (actorId: string) => `subject_${actorId}`;

/** A fresh address per test, so one test's counter is not another's. */
let addressCounter = 0;
const address = () => `198.51.100.${(addressCounter += 1) % 250}`;

async function setLimit(key: string, value: number): Promise<void> {
  await g.prisma.config.upsert({
    where: { key },
    create: { key, value },
    update: { value },
  });
  g.config.invalidate();
}

beforeAll(async () => {
  await truncate(g.prisma);
  s = await seed(g.prisma);
  for (const actorId of [s.ownerId, s.managerId, s.parentId]) {
    await g.accounts.setPassword(s.accounts[actorId], PASSWORD, {
      reason: 'test fixture',
      invalidateSessions: false,
    });
  }
});

beforeEach(async () => {
  await g.prisma.$executeRawUnsafe('delete from chat.auth_throttle');
  await setLimit('auth.throttle.login_per_ip', 30);
  await setLimit('auth.throttle.login_per_subject', 10);
  await setLimit('auth.throttle.reset_request_per_ip', 10);
  await setLimit('auth.throttle.reset_request_per_subject', 5);
  await setLimit('auth.throttle.reset_redeem_per_ip', 10);
});

afterAll(async () => {
  await g.prisma.$disconnect();
});

const codeOf = async (fn: () => Promise<unknown>): Promise<string> => {
  try {
    await fn();
    return 'NO_ERROR';
  } catch (e) {
    return e instanceof AuthError ? e.code : 'OTHER';
  }
};

// -------------------------------------------------------------------------
describe('login: per-source throttling', () => {
  it('blocks an address once it has spent its budget, and says 429', async () => {
    const ip = address();
    await setLimit('auth.throttle.login_per_ip', 3);

    // Three attempts are ALLOWED; the fourth trips the block.
    for (let attempt = 0; attempt < 3; attempt += 1) {
      expect(await codeOf(() => g.auth.login('subject_nobody', 'wrong', undefined, { ip }))).toBe(
        'AUTH.INVALID_CREDENTIALS',
      );
    }
    // From here every attempt is refused before the credential is looked at.
    expect(await codeOf(() => g.auth.login('subject_nobody', 'wrong', undefined, { ip }))).toBe(
      'AUTH.TOO_MANY_ATTEMPTS',
    );

    const blocked = await g.auth
      .login(subjectOf(s.ownerId), PASSWORD, undefined, { ip })
      .catch((e: AuthError) => e);
    expect((blocked as AuthError).getStatus()).toBe(429);
  });

  it('does not punish another address for it', async () => {
    const attacker = address();
    await setLimit('auth.throttle.login_per_ip', 2);
    for (let attempt = 0; attempt < 4; attempt += 1) {
      await g.auth
        .login('subject_nobody', 'wrong', undefined, { ip: attacker })
        .catch(() => undefined);
    }

    await expect(
      g.auth.login(subjectOf(s.ownerId), PASSWORD, { clientKey: 'k1' }, { ip: address() }),
    ).resolves.toBeTruthy();
  });

  it('counts a caller with no resolvable address, rather than exempting it', async () => {
    await setLimit('auth.throttle.login_per_ip', 2);
    for (let attempt = 0; attempt < 2; attempt += 1) {
      await g.auth.login('subject_nobody', 'wrong', undefined, {}).catch(() => undefined);
    }
    expect(await codeOf(() => g.auth.login('subject_nobody', 'wrong', undefined, {}))).toBe(
      'AUTH.TOO_MANY_ATTEMPTS',
    );
  });
});

// -------------------------------------------------------------------------
describe('login: per-target throttling defeats address rotation', () => {
  it('blocks attempts against ONE subject however many addresses they come from', async () => {
    await setLimit('auth.throttle.login_per_subject', 3);
    const target = subjectOf(s.managerId);

    // Every attempt from a different address: the per-source counter never
    // trips. This is password spraying's mirror image, and it is the attack the
    // per-account lockout catches only after it has already succeeded once.
    for (let attempt = 0; attempt < 3; attempt += 1) {
      await g.auth.login(target, 'wrong', undefined, { ip: address() }).catch(() => undefined);
    }
    expect(
      await codeOf(() => g.auth.login(target, 'wrong', undefined, { ip: address() })),
    ).toBe('AUTH.TOO_MANY_ATTEMPTS');

    // ... and the correct password does not get through either, from anywhere.
    expect(
      await codeOf(() => g.auth.login(target, PASSWORD, { clientKey: 'x' }, { ip: address() })),
    ).toBe('AUTH.TOO_MANY_ATTEMPTS');
  });

  it('leaves a different subject alone', async () => {
    await setLimit('auth.throttle.login_per_subject', 2);
    const target = subjectOf(s.managerId);
    for (let attempt = 0; attempt < 4; attempt += 1) {
      await g.auth.login(target, 'wrong', undefined, { ip: address() }).catch(() => undefined);
    }

    await expect(
      g.auth.login(subjectOf(s.parentId), PASSWORD, { clientKey: 'k2' }, { ip: address() }),
    ).resolves.toBeTruthy();
  });

  it('a successful login clears the counters it accumulated', async () => {
    await setLimit('auth.throttle.login_per_subject', 3);
    const ip = address();
    await g.auth.login(subjectOf(s.parentId), 'wrong', undefined, { ip }).catch(() => undefined);
    await g.auth.login(subjectOf(s.parentId), 'wrong', undefined, { ip }).catch(() => undefined);
    await g.auth.login(subjectOf(s.parentId), PASSWORD, { clientKey: 'k3' }, { ip });

    const rows = await g.prisma.$queryRawUnsafe<Array<{ n: bigint }>>(
      `select count(*) as n from chat.auth_throttle where bucket = '${g.throttle.bucket(
        ThrottleScope.LOGIN_SUBJECT,
        subjectOf(s.parentId),
      )}'`,
    );
    expect(Number(rows[0].n)).toBe(0);
  });
});

// -------------------------------------------------------------------------
describe('the throttle is not an enumeration oracle', () => {
  it('counts an UNKNOWN subject exactly as it counts a real one', async () => {
    await setLimit('auth.throttle.login_per_subject', 2);

    await g.auth.login('subject_definitely_not_real', 'x', undefined, { ip: address() }).catch(() => undefined);
    await g.auth.login('subject_definitely_not_real', 'x', undefined, { ip: address() }).catch(() => undefined);
    const unknown = await codeOf(() =>
      g.auth.login('subject_definitely_not_real', 'x', undefined, { ip: address() }),
    );

    await g.auth.login(subjectOf(s.managerId), 'x', undefined, { ip: address() }).catch(() => undefined);
    await g.auth.login(subjectOf(s.managerId), 'x', undefined, { ip: address() }).catch(() => undefined);
    const known = await codeOf(() =>
      g.auth.login(subjectOf(s.managerId), 'x', undefined, { ip: address() }),
    );

    // Identical treatment: the response cannot be used to sort real subjects
    // from invented ones.
    expect(unknown).toBe(known);
    expect(unknown).toBe('AUTH.TOO_MANY_ATTEMPTS');
  });

  it('stores no subject and no address in clear', async () => {
    const ip = '203.0.113.77';
    await g.auth.login(subjectOf(s.ownerId), 'wrong', undefined, { ip }).catch(() => undefined);
    const rows = await g.prisma.$queryRawUnsafe<Array<{ bucket: string }>>(
      'select bucket from chat.auth_throttle',
    );
    const buckets = rows.map((r) => r.bucket).join(' ');
    expect(buckets).not.toContain(ip);
    expect(buckets).not.toContain(subjectOf(s.ownerId));
    expect(buckets).not.toContain(s.ownerId);
  });
});

// -------------------------------------------------------------------------
describe('password recovery', () => {
  it('throttles forgot-password per address', async () => {
    await setLimit('auth.throttle.reset_request_per_ip', 2);
    const ip = address();
    await g.auth.beginPasswordReset(subjectOf(s.ownerId), { ip });
    await g.auth.beginPasswordReset(subjectOf(s.managerId), { ip });
    expect(await codeOf(() => g.auth.beginPasswordReset(subjectOf(s.parentId), { ip }))).toBe(
      'AUTH.TOO_MANY_ATTEMPTS',
    );
    // and the limit is on the ADDRESS, so a fourth subject fares no better
    expect(await codeOf(() => g.auth.beginPasswordReset('subject_anything', { ip }))).toBe(
      'AUTH.TOO_MANY_ATTEMPTS',
    );
  });

  it('throttles forgot-password per subject, for a subject that does not exist too', async () => {
    await setLimit('auth.throttle.reset_request_per_subject', 2);
    for (let attempt = 0; attempt < 2; attempt += 1) {
      await g.auth.beginPasswordReset('subject_ghost', { ip: address() });
    }
    expect(await codeOf(() => g.auth.beginPasswordReset('subject_ghost', { ip: address() }))).toBe(
      'AUTH.TOO_MANY_ATTEMPTS',
    );
  });

  it('throttles reset-token redemption, so a token cannot be guessed at leisure', async () => {
    await setLimit('auth.throttle.reset_redeem_per_ip', 3);
    const ip = address();
    for (let attempt = 0; attempt < 3; attempt += 1) {
      expect(
        await codeOf(() => g.auth.completePasswordReset('guess', 'a-long-enough-password', { ip })),
      ).toBe('AUTH.INVALID_RESET_TOKEN');
    }
    expect(
      await codeOf(() => g.auth.completePasswordReset('guess', 'a-long-enough-password', { ip })),
    ).toBe('AUTH.TOO_MANY_ATTEMPTS');

    // Even a VALID token is refused while the address is blocked -- the limit
    // is on the address, not on the correctness of the guess.
    const issued = await g.auth.beginPasswordReset(subjectOf(s.ownerId), { ip: address() });
    expect(
      await codeOf(() => g.auth.completePasswordReset(issued!.token, 'a-long-enough-password', { ip })),
    ).toBe('AUTH.TOO_MANY_ATTEMPTS');
  });
});

// -------------------------------------------------------------------------
describe('the limits are configuration, not constants', () => {
  it('reads every limit from chat.config', async () => {
    await setLimit('auth.throttle.login_per_ip', 1);
    const ip = address();
    // One attempt allowed, the second refused.
    expect(await codeOf(() => g.auth.login('subject_nobody', 'x', undefined, { ip }))).toBe(
      'AUTH.INVALID_CREDENTIALS',
    );
    expect(await codeOf(() => g.auth.login('subject_nobody', 'x', undefined, { ip }))).toBe(
      'AUTH.TOO_MANY_ATTEMPTS',
    );

    await setLimit('auth.throttle.login_per_ip', 50);
    await g.prisma.$executeRawUnsafe('delete from chat.auth_throttle');
    expect(await codeOf(() => g.auth.login('subject_nobody', 'x', undefined, { ip }))).toBe(
      'AUTH.INVALID_CREDENTIALS',
    );
  });
});
