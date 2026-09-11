/**
 * Login rate limiting (IDENTITY-MODEL §4, API-CONTRACT §3.1).
 *
 * The property that matters is the one account lockout cannot provide: an
 * attacker who spreads one attempt across ten thousand accounts trips no
 * account's counter and is never slowed down. These pin that the SOURCE
 * dimension catches exactly that, and that the limiter cannot be reset,
 * bypassed, or turned into an enumeration oracle.
 */
import {
  IDENTIFIER_MAX_FAILURES,
  LoginRateLimiter,
  rateLimitKey,
  SOURCE_MAX_FAILURES,
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

describe('the identifier dimension', () => {
  let store: FakeRateLimitStore;
  let limiter: LoginRateLimiter;

  beforeEach(() => {
    store = new FakeRateLimitStore();
    limiter = new LoginRateLimiter(store);
  });

  it('allows attempts up to the limit and refuses the one after', async () => {
    for (let i = 0; i < IDENTIFIER_MAX_FAILURES; i++) {
      await expect(limiter.assertWithinLimit('parent-1', IP)).resolves.toBeUndefined();
      await limiter.recordFailure('parent-1', IP);
    }
    await expect(limiter.assertWithinLimit('parent-1', IP)).rejects.toMatchObject(limited);
  });

  it('is per identifier: one blocked account does not block another', async () => {
    for (let i = 0; i < IDENTIFIER_MAX_FAILURES; i++) await limiter.recordFailure('parent-1', IP);

    await expect(limiter.assertWithinLimit('parent-1', IP)).rejects.toMatchObject(limited);
    // A different subject from the same source is still inside the source budget.
    await expect(limiter.assertWithinLimit('parent-2', IP)).resolves.toBeUndefined();
  });

  it('cannot be split into two budgets by changing the case of the identifier', async () => {
    for (let i = 0; i < IDENTIFIER_MAX_FAILURES; i++) await limiter.recordFailure('Parent-1', IP);
    await expect(limiter.assertWithinLimit('parent-1', IP)).rejects.toMatchObject(limited);
    await expect(limiter.assertWithinLimit('  PARENT-1  ', IP)).rejects.toMatchObject(limited);
  });

  it('a success clears the identifier budget, so a mistyped password is not a lasting penalty', async () => {
    for (let i = 0; i < IDENTIFIER_MAX_FAILURES - 1; i++) await limiter.recordFailure('parent-1', IP);
    await limiter.clearIdentifier('parent-1');

    for (let i = 0; i < IDENTIFIER_MAX_FAILURES; i++) {
      await expect(limiter.assertWithinLimit('parent-1', IP)).resolves.toBeUndefined();
      await limiter.recordFailure('parent-1', IP);
    }
  });
});

describe('the source dimension — password spraying', () => {
  let store: FakeRateLimitStore;
  let limiter: LoginRateLimiter;

  beforeEach(() => {
    store = new FakeRateLimitStore();
    limiter = new LoginRateLimiter(store);
  });

  it('ONE attempt against each of many accounts is still caught', async () => {
    // The attack the account lockout cannot see: no identifier ever reaches its
    // own limit, because each is tried exactly once.
    for (let i = 0; i < SOURCE_MAX_FAILURES; i++) {
      const victim = `victim-${i}`;
      await expect(limiter.assertWithinLimit(victim, IP)).resolves.toBeUndefined();
      await limiter.recordFailure(victim, IP);
    }

    // Every identifier counter is at 1. The source counter is at the limit.
    await expect(limiter.assertWithinLimit('victim-9999', IP)).rejects.toMatchObject(limited);
  });

  it('a SUCCESS does not reset the source budget', async () => {
    // Otherwise an attacker holding one valid account resets their spray
    // counter at will, and the source dimension is decorative.
    for (let i = 0; i < SOURCE_MAX_FAILURES; i++) await limiter.recordFailure(`victim-${i}`, IP);

    await limiter.clearIdentifier('attacker-own-account');

    await expect(limiter.assertWithinLimit('victim-next', IP)).rejects.toMatchObject(limited);
  });

  it('a different source is independent — the limiter is not global', async () => {
    for (let i = 0; i < SOURCE_MAX_FAILURES; i++) await limiter.recordFailure(`victim-${i}`, IP);

    await expect(limiter.assertWithinLimit('someone', IP)).rejects.toMatchObject(limited);
    // A legitimate user elsewhere is unaffected: one attacker must not lock out
    // the whole product.
    await expect(limiter.assertWithinLimit('someone', '198.51.100.7')).resolves.toBeUndefined();
  });

  it('an absent source still enforces the identifier budget', async () => {
    // A request with no resolvable IP must not become an unmetered path.
    for (let i = 0; i < IDENTIFIER_MAX_FAILURES; i++) await limiter.recordFailure('parent-1', undefined);
    await expect(limiter.assertWithinLimit('parent-1', undefined)).rejects.toMatchObject(limited);
  });
});

describe('the window', () => {
  it('is set once by the attempt that opens it, so sustained load cannot push it forward', async () => {
    const store = new FakeRateLimitStore();
    const expire = jest.spyOn(store, 'expire');
    const limiter = new LoginRateLimiter(store);

    for (let i = 0; i < 5; i++) await limiter.recordFailure('parent-1', IP);

    // One EXPIRE per key, on the first increment only. A sliding expiry would
    // mean a counter under constant attack never expires at all.
    const idKey = rateLimitKey('id', 'parent-1');
    expect(expire.mock.calls.filter(([k]) => k === idKey)).toEqual([[idKey, WINDOW_SECONDS]]);
  });

  it('reports the remaining wait, and never zero', async () => {
    const store = new FakeRateLimitStore();
    const limiter = new LoginRateLimiter(store);
    for (let i = 0; i < IDENTIFIER_MAX_FAILURES; i++) await limiter.recordFailure('parent-1', IP);

    const error = (await limiter
      .assertWithinLimit('parent-1', IP)
      .catch((e: AuthError) => e)) as AuthError;

    expect(error.retryAfterSeconds).toBe(WINDOW_SECONDS);
    expect(error.retryAfterSeconds!).toBeGreaterThan(0);
  });

  it('a lapsed window lets a legitimate user back in — nobody is blocked permanently', async () => {
    const store = new FakeRateLimitStore();
    const limiter = new LoginRateLimiter(store);
    for (let i = 0; i < IDENTIFIER_MAX_FAILURES; i++) await limiter.recordFailure('parent-1', IP);
    await expect(limiter.assertWithinLimit('parent-1', IP)).rejects.toMatchObject(limited);

    // Redis drops the key when the TTL lapses; the double models that as expire(0).
    await store.expire(rateLimitKey('id', 'parent-1'), 0);
    await store.expire(rateLimitKey('ip', IP), 0);

    await expect(limiter.assertWithinLimit('parent-1', IP)).resolves.toBeUndefined();
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

    await expect(limiter.assertWithinLimit('parent-1', IP)).rejects.toMatchObject(limited);
  });

  it('FAILS CLOSED when no store is configured at all', async () => {
    await expect(new LoginRateLimiter().assertWithinLimit('parent-1', IP)).rejects.toMatchObject(
      limited,
    );
  });

  it('a store failure while RECORDING does not mask the original refusal', async () => {
    // recordFailure is bookkeeping; assertWithinLimit is the gate. A broken
    // store must not turn "wrong password" into "rate limited", which would
    // tell the caller something untrue about their own credentials.
    const store = new FakeRateLimitStore();
    const limiter = new LoginRateLimiter(store);
    store.broken = true;

    await expect(limiter.recordFailure('parent-1', IP)).resolves.toBeUndefined();
  });
});

describe('the limiter discloses nothing', () => {
  it('keys on a hash — neither the subject nor the IP is stored in the clear', () => {
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
    const store = new FakeRateLimitStore();
    const limiter = new LoginRateLimiter(store);

    for (let i = 0; i < IDENTIFIER_MAX_FAILURES; i++) {
      await limiter.recordFailure('no-such-account-anywhere', IP);
    }
    const error = (await limiter
      .assertWithinLimit('no-such-account-anywhere', IP)
      .catch((e: AuthError) => e)) as AuthError;

    expect(error.code).toBe(AuthErrorCode.RATE_LIMITED);
    expect(error.message).toBe('too many attempts; try again later');
  });
});

describe('the controller applies the limiter around a real login', () => {
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

  it('invalid credentials still return the canonical 401 BEFORE the limit is reached', async () => {
    const error = (await controller
      .login({ username: 'parent-rl', password: 'wrong' })
      .catch((e: AuthError) => e)) as AuthError;

    expect(error.code).toBe(AuthErrorCode.INVALID_CREDENTIALS);
    expect(error.status).toBe(401);
  });

  it('turns into the canonical 429 once the budget is spent', async () => {
    for (let i = 0; i < IDENTIFIER_MAX_FAILURES; i++) {
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
    for (let i = 0; i < IDENTIFIER_MAX_FAILURES; i++) {
      await controller.login({ username: 'parent-rl', password: 'wrong' }).catch(() => undefined);
    }
    const attemptsBefore = db.credentialFor(db.accounts[0].id).failedAttempts;

    await controller.login({ username: 'parent-rl', password: 'wrong' }).catch(() => undefined);

    // The lockout counter did not move: the request was refused before
    // AuthService -- and therefore before Argon2id -- ran at all.
    expect(db.credentialFor(db.accounts[0].id).failedAttempts).toBe(attemptsBefore);
  });

  it('successful login is preserved, and clears the identifier budget', async () => {
    for (let i = 0; i < IDENTIFIER_MAX_FAILURES - 1; i++) {
      await controller.login({ username: 'parent-rl', password: 'wrong' }).catch(() => undefined);
    }

    const dto = await controller.login({ username: 'parent-rl', password: PASSWORD });
    expect(dto.tokenType).toBe('Bearer');

    // And the budget is fresh again.
    await expect(
      controller.login({ username: 'parent-rl', password: 'wrong' }),
    ).rejects.toMatchObject({ code: AuthErrorCode.INVALID_CREDENTIALS });
  });

  it('a LOCKED account still spends the budget, so it is not an unmetered oracle', async () => {
    db.credentialFor(db.accounts[0].id).lockedUntil = new Date(Date.now() + 60_000);

    for (let i = 0; i < IDENTIFIER_MAX_FAILURES; i++) {
      await expect(
        controller.login({ username: 'parent-rl', password: 'anything' }),
      ).rejects.toMatchObject({ code: AuthErrorCode.ACCOUNT_LOCKED });
    }

    await expect(
      controller.login({ username: 'parent-rl', password: 'anything' }),
    ).rejects.toMatchObject({ code: AuthErrorCode.RATE_LIMITED });
  });
});
