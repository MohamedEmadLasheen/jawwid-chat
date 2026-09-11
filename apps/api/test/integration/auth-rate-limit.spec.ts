import { randomUUID } from 'node:crypto';
import Redis from 'ioredis';
import {
  IDENTIFIER_MAX_FAILURES,
  LoginRateLimiter,
  rateLimitKey,
  SOURCE_MAX_FAILURES,
  WINDOW_SECONDS,
} from '@platform/auth/login-rate-limit';
import { AuthError, AuthErrorCode } from '@platform/auth/auth.errors';

/**
 * Login rate limiting against a REAL Redis.
 *
 * The unit suite proves the policy with a double. This proves the policy holds
 * on the server that actually enforces it -- real INCR, real EXPIRE, real TTL,
 * real key expiry -- because a limiter is exactly the kind of control that can
 * pass against a fake and do nothing in production.
 *
 * It also proves the property that motivates using Redis at all: TWO limiter
 * instances, standing in for two API replicas, share one budget. A per-process
 * counter would let each replica hand out the full allowance, silently
 * multiplying the real limit by the replica count
 * (`docs/infrastructure/architecture.md` §10: "API instances -- stateless; add
 * replicas").
 *
 * Requires Redis. Same endpoint the realtime suite uses and the same one CI
 * provides (.github/workflows/ci.yml maps redis:7-alpine to 6410).
 */
const REDIS_URL = process.env.AUTH_TEST_REDIS_URL ?? process.env.REDIS_URL ?? 'redis://localhost:6410';

jest.setTimeout(60_000);

describe('login rate limiting against Redis', () => {
  let client: Redis;
  let limiter: LoginRateLimiter;

  /** Unique per run, so a peer session sharing this Redis cannot collide. */
  const run = randomUUID().slice(0, 8);
  const subject = () => `rl-${run}-${randomUUID().slice(0, 8)}`;
  const ip = `198.51.100.${Math.floor(Math.random() * 200) + 1}-${run}`;

  const touched: string[] = [];
  const track = (s: string, address = ip): string => {
    touched.push(rateLimitKey('id', s.trim().toLowerCase()), rateLimitKey('ip', address));
    return s;
  };

  beforeAll(async () => {
    client = new Redis(REDIS_URL, { maxRetriesPerRequest: 1, lazyConnect: true });
    await client.connect();
    limiter = new LoginRateLimiter(client);
  });

  afterAll(async () => {
    if (touched.length > 0) await client.del(...new Set(touched));
    await client.quit();
  });

  it('counts real INCRs and refuses at the identifier limit', async () => {
    const who = track(subject());

    for (let i = 0; i < IDENTIFIER_MAX_FAILURES; i++) {
      await expect(limiter.assertWithinLimit(who, ip)).resolves.toBeUndefined();
      await limiter.recordFailure(who, ip);
    }

    const error = (await limiter.assertWithinLimit(who, ip).catch((e: AuthError) => e)) as AuthError;
    expect(error.code).toBe(AuthErrorCode.RATE_LIMITED);
    expect(error.status).toBe(429);

    // The count really is in Redis, not in the process.
    expect(Number(await client.get(rateLimitKey('id', who)))).toBe(IDENTIFIER_MAX_FAILURES);
  });

  it('sets a real TTL, and Retry-After reports what remains', async () => {
    const who = track(subject());
    for (let i = 0; i < IDENTIFIER_MAX_FAILURES; i++) await limiter.recordFailure(who, ip);

    const ttl = await client.ttl(rateLimitKey('id', who));
    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(WINDOW_SECONDS);

    const error = (await limiter.assertWithinLimit(who, ip).catch((e: AuthError) => e)) as AuthError;
    expect(error.retryAfterSeconds).toBeGreaterThan(0);
    expect(error.retryAfterSeconds).toBeLessThanOrEqual(WINDOW_SECONDS);
  });

  it('the window really expires — a legitimate user is not blocked forever', async () => {
    // Its OWN source address. The shared `ip` accumulates failures across the
    // tests above, and this one is about the identifier window lapsing -- a
    // spent source budget would refuse the final assertion for an unrelated
    // reason and make the test lie about what it proves.
    const ownIp = `192.0.2.5-${run}`;
    const who = track(subject(), ownIp);
    for (let i = 0; i < IDENTIFIER_MAX_FAILURES; i++) await limiter.recordFailure(who, ownIp);
    await expect(limiter.assertWithinLimit(who, ownIp)).rejects.toMatchObject({
      code: AuthErrorCode.RATE_LIMITED,
    });

    // Shorten the real TTL rather than waiting 15 minutes: this exercises
    // Redis's own expiry, not a simulated clock.
    await client.expire(rateLimitKey('id', who), 1);
    await new Promise((resolve) => setTimeout(resolve, 1500));

    expect(await client.get(rateLimitKey('id', who))).toBeNull();
    await expect(limiter.assertWithinLimit(who, ownIp)).resolves.toBeUndefined();
  });

  it('TWO instances share one budget — the limit does not scale with replicas', async () => {
    // The whole reason this is not an in-memory Map.
    const second = new LoginRateLimiter(client);
    const who = track(subject());

    for (let i = 0; i < IDENTIFIER_MAX_FAILURES; i++) {
      // Alternate "replicas" while spending the budget.
      await (i % 2 === 0 ? limiter : second).recordFailure(who, ip);
    }

    await expect(limiter.assertWithinLimit(who, ip)).rejects.toMatchObject({
      code: AuthErrorCode.RATE_LIMITED,
    });
    // The replica that saw only half the attempts refuses too.
    await expect(second.assertWithinLimit(who, ip)).rejects.toMatchObject({
      code: AuthErrorCode.RATE_LIMITED,
    });
  });

  it('PASSWORD SPRAYING: one attempt against each of many accounts is caught', async () => {
    const sprayIp = `203.0.113.77-${run}`;
    const victims: string[] = [];

    for (let i = 0; i < SOURCE_MAX_FAILURES; i++) {
      const victim = track(subject(), sprayIp);
      victims.push(victim);
      await expect(limiter.assertWithinLimit(victim, sprayIp)).resolves.toBeUndefined();
      await limiter.recordFailure(victim, sprayIp);
    }

    // Not one identifier is near its own limit...
    for (const victim of victims.slice(0, 5)) {
      expect(Number(await client.get(rateLimitKey('id', victim)))).toBe(1);
    }
    // ...and the source is stopped anyway. This is the attack the account
    // lockout cannot see at all.
    const nextVictim = track(subject(), sprayIp);
    await expect(limiter.assertWithinLimit(nextVictim, sprayIp)).rejects.toMatchObject({
      code: AuthErrorCode.RATE_LIMITED,
    });
  });

  it('changing the identifier does not bypass the source budget', async () => {
    const sprayIp = `203.0.113.88-${run}`;
    for (let i = 0; i < SOURCE_MAX_FAILURES; i++) {
      await limiter.recordFailure(track(subject(), sprayIp), sprayIp);
    }

    // A brand-new identifier, never seen before, from the spent source.
    await expect(limiter.assertWithinLimit(track(subject(), sprayIp), sprayIp)).rejects.toMatchObject(
      { code: AuthErrorCode.RATE_LIMITED },
    );
  });

  it('a SUCCESS clears the identifier but never the source', async () => {
    const sprayIp = `203.0.113.99-${run}`;
    const attackerOwn = track(subject(), sprayIp);

    for (let i = 0; i < SOURCE_MAX_FAILURES; i++) {
      await limiter.recordFailure(track(subject(), sprayIp), sprayIp);
    }
    await limiter.clearIdentifier(attackerOwn);

    // The source counter survives, so a valid account is not a reset button.
    expect(Number(await client.get(rateLimitKey('ip', sprayIp)))).toBeGreaterThanOrEqual(
      SOURCE_MAX_FAILURES,
    );
    await expect(limiter.assertWithinLimit(track(subject(), sprayIp), sprayIp)).rejects.toMatchObject(
      { code: AuthErrorCode.RATE_LIMITED },
    );
  });

  it('stores no raw identifier and no raw IP in Redis', async () => {
    const who = track(`secret-username-${run}`);
    await limiter.recordFailure(who, ip);

    const keys = await client.keys(`ratelimit:login:*`);
    expect(keys.length).toBeGreaterThan(0);
    for (const key of keys) {
      expect(key).not.toContain(who);
      expect(key).not.toContain(ip);
    }
    expect(keys).toContain(rateLimitKey('id', who));
  });

  it('FAILS CLOSED against a Redis that is really unreachable', async () => {
    // Not a thrown-from-a-mock simulation: a client pointed at a closed port.
    // The SAME options auth.module.ts ships, so this proves the behaviour of
    // the client that is actually deployed rather than of a stricter one.
    const dead = new Redis('redis://127.0.0.1:6399', {
      lazyConnect: true,
      maxRetriesPerRequest: 1,
      enableOfflineQueue: true,
      retryStrategy: () => null,
    });
    dead.on('error', () => undefined);

    const offline = new LoginRateLimiter(dead);
    await expect(offline.assertWithinLimit('anyone', ip)).rejects.toMatchObject({
      code: AuthErrorCode.RATE_LIMITED,
      status: 429,
    });

    dead.disconnect();
  });
});
