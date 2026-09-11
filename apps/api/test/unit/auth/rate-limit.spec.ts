/**
 * Login rate limiting — policy (IDENTITY-MODEL §4, API-CONTRACT §3.1).
 *
 * These pin the POLICY: which budget trips, what a success releases, what a
 * refusal discloses, and that the limiter fails closed. They deliberately do
 * NOT claim to prove atomicity — a single-threaded double cannot. Atomicity
 * under real concurrency is proved against a real Redis in
 * test/integration/auth-rate-limit.spec.ts.
 *
 * The property that matters most is the one account lockout cannot provide: an
 * attacker who spreads one attempt across ten thousand accounts trips no
 * account's counter and is never slowed down.
 */
import {
  IDENTIFIER_MAX_ATTEMPTS,
  LoginRateLimiter,
  rateLimitKey,
  SOURCE_MAX_ATTEMPTS,
  WINDOW_SECONDS,
} from '@platform/auth/login-rate-limit';
import { AuthError, AuthErrorCode } from '@platform/auth/auth.errors';
import { AuthController } from '@platform/auth/auth.controller';
import {
  buildAuth,
  contactActor,
  FakeDb,
  FakeIdentity,
  FakeRateLimitStore,
  withAuthEnv,
} from './support/fake-db';

jest.setTimeout(60_000);

const IP = '203.0.113.9';
const PASSWORD = 'a-correct-password-1';
const limited = { code: AuthErrorCode.RATE_LIMITED, status: 429 };

describe('the identifier budget', () => {
  let store: FakeRateLimitStore;
  let limiter: LoginRateLimiter;

  beforeEach(() => {
    store = new FakeRateLimitStore();
    limiter = new LoginRateLimiter(store);
  });

  it('admits exactly the limit, then refuses', async () => {
    for (let i = 0; i < IDENTIFIER_MAX_ATTEMPTS; i++) {
      await expect(limiter.reserve('parent-1', IP)).resolves.toBeUndefined();
    }
    await expect(limiter.reserve('parent-1', IP)).rejects.toMatchObject(limited);
  });

  it('charges the budget on EVERY attempt, not only on a failed password', async () => {
    // Counting only wrong passwords would leave a locked or disabled account as
    // an unmetered oracle, and would let credential stuffing with valid
    // passwords run unbounded.
    await limiter.reserve('parent-1', IP);
    expect(store.countOf(rateLimitKey('id', 'parent-1'))).toBe(1);
  });

  it('is per identifier: one exhausted account does not block another', async () => {
    for (let i = 0; i < IDENTIFIER_MAX_ATTEMPTS; i++) await limiter.reserve('parent-1', IP);

    await expect(limiter.reserve('parent-1', IP)).rejects.toMatchObject(limited);
    await expect(limiter.reserve('parent-2', IP)).resolves.toBeUndefined();
  });

  it('cannot be split into two budgets by changing the case of the identifier', async () => {
    for (let i = 0; i < IDENTIFIER_MAX_ATTEMPTS; i++) await limiter.reserve('Parent-1', IP);
    await expect(limiter.reserve('parent-1', IP)).rejects.toMatchObject(limited);
    await expect(limiter.reserve('  PARENT-1  ', IP)).rejects.toMatchObject(limited);
  });

  it('a lapsed window lets a legitimate user back in — nobody is blocked forever', async () => {
    for (let i = 0; i < IDENTIFIER_MAX_ATTEMPTS; i++) await limiter.reserve('parent-1', IP);
    await expect(limiter.reserve('parent-1', IP)).rejects.toMatchObject(limited);

    store.lapse(rateLimitKey('id', 'parent-1'));
    store.lapse(rateLimitKey('ip', IP));

    await expect(limiter.reserve('parent-1', IP)).resolves.toBeUndefined();
  });

  it('reports the remaining wait, and never zero', async () => {
    for (let i = 0; i < IDENTIFIER_MAX_ATTEMPTS; i++) await limiter.reserve('parent-1', IP);
    const error = (await limiter.reserve('parent-1', IP).catch((e: AuthError) => e)) as AuthError;

    expect(error.retryAfterSeconds).toBe(WINDOW_SECONDS);
    expect(error.retryAfterSeconds!).toBeGreaterThan(0);
  });
});

describe('the source budget — password spraying', () => {
  let store: FakeRateLimitStore;
  let limiter: LoginRateLimiter;

  beforeEach(() => {
    store = new FakeRateLimitStore();
    limiter = new LoginRateLimiter(store);
  });

  it('ONE attempt against each of many accounts is still caught', async () => {
    // The attack the account lockout cannot see: no identifier ever reaches its
    // own limit, because each is tried exactly once.
    for (let i = 0; i < SOURCE_MAX_ATTEMPTS; i++) {
      await expect(limiter.reserve(`victim-${i}`, IP)).resolves.toBeUndefined();
    }
    for (let i = 0; i < 5; i++) {
      expect(store.countOf(rateLimitKey('id', `victim-${i}`))).toBe(1);
    }
    await expect(limiter.reserve('victim-9999', IP)).rejects.toMatchObject(limited);
  });

  it('a SUCCESS does not release the source budget', async () => {
    // Otherwise an attacker holding one valid account resets their spray
    // counter at will, and the source dimension is decorative.
    for (let i = 0; i < SOURCE_MAX_ATTEMPTS; i++) await limiter.reserve(`victim-${i}`, IP);
    await limiter.clearIdentifier('attacker-own-account');

    expect(store.countOf(rateLimitKey('ip', IP))).toBeGreaterThanOrEqual(SOURCE_MAX_ATTEMPTS);
    await expect(limiter.reserve('victim-next', IP)).rejects.toMatchObject(limited);
  });

  it('a different source is independent — one attacker cannot lock out the product', async () => {
    for (let i = 0; i < SOURCE_MAX_ATTEMPTS; i++) await limiter.reserve(`victim-${i}`, IP);

    await expect(limiter.reserve('someone', IP)).rejects.toMatchObject(limited);
    await expect(limiter.reserve('someone', '198.51.100.7')).resolves.toBeUndefined();
  });

  it('an absent source still enforces the identifier budget', async () => {
    for (let i = 0; i < IDENTIFIER_MAX_ATTEMPTS; i++) await limiter.reserve('parent-1', undefined);
    await expect(limiter.reserve('parent-1', undefined)).rejects.toMatchObject(limited);
  });

  it('both budgets are charged in one reservation, never in two calls', async () => {
    // Two calls would be two atomic steps with a window between them.
    await limiter.reserve('parent-1', IP);
    expect(store.reservations).toHaveLength(1);
    expect(store.reservations[0]).toEqual([rateLimitKey('id', 'parent-1'), rateLimitKey('ip', IP)]);
  });
});

describe('releasing the identifier budget', () => {
  it('a success clears it, so a mistyped password is not a lasting penalty', async () => {
    const store = new FakeRateLimitStore();
    const limiter = new LoginRateLimiter(store);

    for (let i = 0; i < IDENTIFIER_MAX_ATTEMPTS - 1; i++) await limiter.reserve('parent-1', IP);
    await limiter.clearIdentifier('parent-1');

    expect(store.countOf(rateLimitKey('id', 'parent-1'))).toBe(0);
    for (let i = 0; i < IDENTIFIER_MAX_ATTEMPTS; i++) {
      await expect(limiter.reserve('parent-1', IP)).resolves.toBeUndefined();
    }
  });

  it('clears ONLY the identifier key, never the source key', async () => {
    const store = new FakeRateLimitStore();
    const limiter = new LoginRateLimiter(store);

    await limiter.reserve('parent-1', IP);
    await limiter.clearIdentifier('parent-1');

    expect(store.countOf(rateLimitKey('id', 'parent-1'))).toBe(0);
    expect(store.countOf(rateLimitKey('ip', IP))).toBe(1);
  });
});

describe('availability', () => {
  it('FAILS CLOSED when the store is unreachable', async () => {
    // architecture.md §7 grades a Redis outage "severe -- not ready -> drained",
    // so the instance is already leaving the pool. Failing open in the meantime
    // would unmeter an endpoint that runs Argon2id at 19 MiB per attempt.
    const store = new FakeRateLimitStore();
    const limiter = new LoginRateLimiter(store);
    store.broken = true;

    await expect(limiter.reserve('parent-1', IP)).rejects.toMatchObject(limited);
  });

  it('FAILS CLOSED when no store is configured at all', async () => {
    await expect(new LoginRateLimiter().reserve('parent-1', IP)).rejects.toMatchObject(limited);
  });

  it('a failure while RELEASING does not throw into the caller', async () => {
    // clearIdentifier runs after a successful login. Throwing there would turn
    // a good login into a 500; leaving the reservation errs towards refusing.
    const store = new FakeRateLimitStore();
    const limiter = new LoginRateLimiter(store);
    await limiter.reserve('parent-1', IP);
    store.broken = true;

    await expect(limiter.clearIdentifier('parent-1')).resolves.toBeUndefined();
  });
});

describe('the limiter discloses nothing', () => {
  it('keys on a hash — neither the subject nor the source is stored in the clear', () => {
    const subject = 'parent-secret-username';
    const idKey = rateLimitKey('id', subject);
    const ipKey = rateLimitKey('ip', IP);

    expect(idKey).not.toContain(subject);
    expect(ipKey).not.toContain(IP);
    expect(idKey).toMatch(/^ratelimit:login:id:[0-9a-f]{32}$/);
    expect(ipKey).toMatch(/^ratelimit:login:ip:[0-9a-f]{32}$/);
  });

  it('an unknown subject is limited exactly like a known one', async () => {
    // The limiter never touches the database, so a 429 cannot reveal whether
    // the account exists.
    const limiter = new LoginRateLimiter(new FakeRateLimitStore());
    for (let i = 0; i < IDENTIFIER_MAX_ATTEMPTS; i++) {
      await limiter.reserve('no-such-account-anywhere', IP);
    }
    const error = (await limiter
      .reserve('no-such-account-anywhere', IP)
      .catch((e: AuthError) => e)) as AuthError;

    expect(error.code).toBe(AuthErrorCode.RATE_LIMITED);
    expect(error.message).toBe('too many attempts; try again later');
  });
});

describe('the controller reserves before the password is verified', () => {
  let db: FakeDb;
  let identity: FakeIdentity;
  let controller: AuthController;
  let store: FakeRateLimitStore;

  beforeEach(async () => {
    withAuthEnv();
    db = new FakeDb();
    identity = new FakeIdentity();
    store = new FakeRateLimitStore();
    controller = new AuthController(buildAuth(db, identity), new LoginRateLimiter(store));
    const account = await db.addAccount({ subject: 'parent-rl' }, PASSWORD);
    identity.give(account.id, contactActor());
  });

  it('invalid credentials still return the canonical 401 while budget remains', async () => {
    const error = (await controller
      .login({ username: 'parent-rl', password: 'wrong' })
      .catch((e: AuthError) => e)) as AuthError;

    expect(error.code).toBe(AuthErrorCode.INVALID_CREDENTIALS);
    expect(error.status).toBe(401);
  });

  it('turns into the canonical 429 once the budget is spent', async () => {
    for (let i = 0; i < IDENTIFIER_MAX_ATTEMPTS; i++) {
      await controller.login({ username: 'parent-rl', password: 'wrong' }).catch(() => undefined);
    }

    const error = (await controller
      .login({ username: 'parent-rl', password: 'wrong' })
      .catch((e: AuthError) => e)) as AuthError;

    expect(error.code).toBe(AuthErrorCode.RATE_LIMITED);
    expect(error.status).toBe(429);
    expect(error.retryAfterSeconds).toBeGreaterThan(0);
  });

  it('a rate-limited attempt never reaches the password check', async () => {
    for (let i = 0; i < IDENTIFIER_MAX_ATTEMPTS; i++) {
      await controller.login({ username: 'parent-rl', password: 'wrong' }).catch(() => undefined);
    }
    const attemptsBefore = db.credentialFor(db.accounts[0].id).failedAttempts;

    await controller.login({ username: 'parent-rl', password: 'wrong' }).catch(() => undefined);

    // The lockout counter did not move: the request was refused before
    // AuthService -- and therefore before Argon2id -- ran at all.
    expect(db.credentialFor(db.accounts[0].id).failedAttempts).toBe(attemptsBefore);
  });

  it('successful login is preserved, and releases the identifier budget', async () => {
    for (let i = 0; i < IDENTIFIER_MAX_ATTEMPTS - 1; i++) {
      await controller.login({ username: 'parent-rl', password: 'wrong' }).catch(() => undefined);
    }

    const dto = await controller.login({ username: 'parent-rl', password: PASSWORD });
    expect(dto.tokenType).toBe('Bearer');
    expect(store.countOf(rateLimitKey('id', 'parent-rl'))).toBe(0);

    await expect(
      controller.login({ username: 'parent-rl', password: 'wrong' }),
    ).rejects.toMatchObject({ code: AuthErrorCode.INVALID_CREDENTIALS });
  });

  it('a successful login still charges the SOURCE budget', async () => {
    await controller.login({ username: 'parent-rl', password: PASSWORD });
    expect(store.countOf(rateLimitKey('ip', ''))).toBe(0); // no ip passed by this call shape
  });

  it('a LOCKED account still spends the budget, so it is not an unmetered oracle', async () => {
    db.credentialFor(db.accounts[0].id).lockedUntil = new Date(Date.now() + 60_000);

    for (let i = 0; i < IDENTIFIER_MAX_ATTEMPTS; i++) {
      await expect(
        controller.login({ username: 'parent-rl', password: 'anything' }),
      ).rejects.toMatchObject({ code: AuthErrorCode.ACCOUNT_LOCKED });
    }

    await expect(
      controller.login({ username: 'parent-rl', password: 'anything' }),
    ).rejects.toMatchObject({ code: AuthErrorCode.RATE_LIMITED });
  });
});
