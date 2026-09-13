import { randomUUID } from 'node:crypto';
import Redis from 'ioredis';
import {
  IDENTIFIER_MAX_ATTEMPTS,
  LoginRateLimiter,
  rateLimitKey,
  SOURCE_MAX_ATTEMPTS,
  WINDOW_SECONDS,
} from '@platform/auth/login-rate-limit';
import { RedisRateLimitStore } from '@platform/auth/redis-rate-limit.store';
import { AuthError, AuthErrorCode } from '@platform/auth/auth.errors';
import { AuthController } from '@platform/auth/auth.controller';
import { AuthService } from '@platform/auth/auth.service';
import { PrismaService } from '@platform/prisma.service';
import { PrismaIdentityService } from '@platform/identity.service';
import { PrismaAuditService } from '@platform/audit.service';
import type { ClientAddressPolicy } from '@platform/auth/client-address';

/**
 * Login rate limiting against a REAL Redis, under REAL concurrency.
 *
 * The unit suite proves the policy with a single-threaded double, which by
 * construction cannot prove atomicity. This file proves the thing that actually
 * failed in the audit: a concurrent burst cannot exceed the limit.
 *
 * The regression it guards: the first implementation read the counter, ran the
 * ~200ms Argon2id verification, and incremented afterwards. 120 of 120
 * concurrent requests passed a limit of 10, in 626ms. The fix reserves the slot
 * atomically, in one Lua script, before the password is verified.
 *
 * Requires Redis and Postgres. Same Redis endpoint the realtime suite uses and
 * CI provides (ci.yml maps redis:7-alpine to 6410).
 */
const REDIS_URL = process.env.AUTH_TEST_REDIS_URL ?? process.env.REDIS_URL ?? 'redis://localhost:6410';

process.env.JWT_ACCESS_SECRET ??= 'integration-access-secret-32-chars-min!';
process.env.JWT_REFRESH_SECRET ??= 'integration-refresh-secret-32-chars-min!';

jest.setTimeout(120_000);

const PASSWORD = 'an-integration-password-1';

describe('login rate limiting against Redis', () => {
  let client: Redis;
  let limiter: LoginRateLimiter;

  /** Unique per run, so a peer session sharing this Redis cannot collide. */
  const run = randomUUID().slice(0, 8);
  const subject = () => `rl-${run}-${randomUUID().slice(0, 8)}`;
  const ip = `198.51.100.7-${run}`;

  const touched = new Set<string>();
  const track = (s: string, address = ip): string => {
    touched.add(rateLimitKey('id', s.trim().toLowerCase()));
    touched.add(rateLimitKey('ip', address));
    return s;
  };

  beforeAll(async () => {
    client = new Redis(REDIS_URL, { maxRetriesPerRequest: 1, lazyConnect: true });
    await client.connect();
    limiter = new LoginRateLimiter(new RedisRateLimitStore(client));
  });

  afterAll(async () => {
    if (touched.size > 0) await client.del(...touched);
    await client.quit();
  });

  // -------------------------------------------------------------------------
  // Atomicity -- the regression this file exists for
  // -------------------------------------------------------------------------

  it('ATOMIC RESERVATION: 200 concurrent reservations admit exactly the limit', async () => {
    const ownIp = `192.0.2.100-${run}`;
    const who = track(subject(), ownIp);

    // Fired together, resolved together. Under the old GET-then-INCR shape every
    // one of these read 0 and passed.
    const outcomes = await Promise.all(
      Array.from({ length: 200 }, () =>
        limiter.reserve(who, ownIp).then(
          () => 'allowed' as const,
          (e: AuthError) => (e.code === AuthErrorCode.RATE_LIMITED ? ('limited' as const) : 'other'),
        ),
      ),
    );

    const allowed = outcomes.filter((o) => o === 'allowed').length;

    expect(allowed).toBe(IDENTIFIER_MAX_ATTEMPTS);
    expect(outcomes.filter((o) => o === 'limited')).toHaveLength(200 - IDENTIFIER_MAX_ATTEMPTS);
    expect(outcomes.filter((o) => o === 'other')).toHaveLength(0);

    // Every attempt was charged: the counter equals the number of requests,
    // which is what "reserve" means. A check-then-count implementation cannot
    // produce both this counter AND an allowed count equal to the limit.
    expect(Number(await client.get(rateLimitKey('id', who)))).toBe(200);
  });

  it('the source budget is equally atomic under a concurrent spray', async () => {
    const sprayIp = `203.0.113.200-${run}`;
    touched.add(rateLimitKey('ip', sprayIp));

    const outcomes = await Promise.all(
      Array.from({ length: 150 }, () => {
        const victim = track(subject(), sprayIp);
        return limiter.reserve(victim, sprayIp).then(
          () => 'allowed' as const,
          () => 'limited' as const,
        );
      }),
    );

    // Every identifier is distinct, so only the SOURCE budget can bound this.
    expect(outcomes.filter((o) => o === 'allowed')).toHaveLength(SOURCE_MAX_ATTEMPTS);
  });

  it('sets a real TTL, and Retry-After reports what remains', async () => {
    const ownIp = `192.0.2.7-${run}`;
    const who = track(subject(), ownIp);
    for (let i = 0; i < IDENTIFIER_MAX_ATTEMPTS; i++) await limiter.reserve(who, ownIp);

    const ttl = await client.ttl(rateLimitKey('id', who));
    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(WINDOW_SECONDS);

    const error = (await limiter.reserve(who, ownIp).catch((e: AuthError) => e)) as AuthError;
    expect(error.retryAfterSeconds).toBeGreaterThan(0);
    expect(error.retryAfterSeconds).toBeLessThanOrEqual(WINDOW_SECONDS);
  });

  it('the window really expires -- a legitimate user is not blocked forever', async () => {
    const ownIp = `192.0.2.5-${run}`;
    const who = track(subject(), ownIp);
    for (let i = 0; i < IDENTIFIER_MAX_ATTEMPTS; i++) await limiter.reserve(who, ownIp);
    await expect(limiter.reserve(who, ownIp)).rejects.toMatchObject({
      code: AuthErrorCode.RATE_LIMITED,
    });

    // Shorten the real TTL rather than waiting 15 minutes: this exercises
    // Redis's own expiry, not a simulated clock.
    await client.expire(rateLimitKey('id', who), 1);
    await new Promise((resolve) => setTimeout(resolve, 1500));

    expect(await client.get(rateLimitKey('id', who))).toBeNull();
    await expect(limiter.reserve(who, ownIp)).resolves.toBeUndefined();
  });

  it('TWO instances share one budget -- the limit does not scale with replicas', async () => {
    const second = new LoginRateLimiter(new RedisRateLimitStore(client));
    const ownIp = `192.0.2.50-${run}`;
    const who = track(subject(), ownIp);

    for (let i = 0; i < IDENTIFIER_MAX_ATTEMPTS; i++) {
      await (i % 2 === 0 ? limiter : second).reserve(who, ownIp);
    }

    await expect(limiter.reserve(who, ownIp)).rejects.toMatchObject({
      code: AuthErrorCode.RATE_LIMITED,
    });
    // The replica that saw only half the attempts refuses too.
    await expect(second.reserve(who, ownIp)).rejects.toMatchObject({
      code: AuthErrorCode.RATE_LIMITED,
    });
  });

  it('PASSWORD SPRAYING: one attempt against each of many accounts is caught', async () => {
    const sprayIp = `203.0.113.77-${run}`;
    touched.add(rateLimitKey('ip', sprayIp));
    const victims: string[] = [];

    for (let i = 0; i < SOURCE_MAX_ATTEMPTS; i++) {
      const victim = track(subject(), sprayIp);
      victims.push(victim);
      await expect(limiter.reserve(victim, sprayIp)).resolves.toBeUndefined();
    }

    for (const victim of victims.slice(0, 5)) {
      expect(Number(await client.get(rateLimitKey('id', victim)))).toBe(1);
    }
    await expect(limiter.reserve(track(subject(), sprayIp), sprayIp)).rejects.toMatchObject({
      code: AuthErrorCode.RATE_LIMITED,
    });
  });

  it('a SUCCESS releases the identifier but never the source', async () => {
    const sprayIp = `203.0.113.99-${run}`;
    touched.add(rateLimitKey('ip', sprayIp));
    const attackerOwn = track(subject(), sprayIp);

    await limiter.reserve(attackerOwn, sprayIp);
    for (let i = 0; i < SOURCE_MAX_ATTEMPTS - 1; i++) {
      await limiter.reserve(track(subject(), sprayIp), sprayIp);
    }
    await limiter.clearIdentifier(attackerOwn);

    expect(await client.get(rateLimitKey('id', attackerOwn))).toBeNull();
    expect(Number(await client.get(rateLimitKey('ip', sprayIp)))).toBeGreaterThanOrEqual(
      SOURCE_MAX_ATTEMPTS,
    );
    await expect(limiter.reserve(track(subject(), sprayIp), sprayIp)).rejects.toMatchObject({
      code: AuthErrorCode.RATE_LIMITED,
    });
  });

  it('stores no raw identifier and no raw source in Redis', async () => {
    const who = track(`secret-username-${run}`);
    await limiter.reserve(who, ip);

    const keys = await client.keys('ratelimit:login:*');
    expect(keys.length).toBeGreaterThan(0);
    for (const key of keys) {
      expect(key).not.toContain(who);
      expect(key).not.toContain(ip);
    }
    expect(keys).toContain(rateLimitKey('id', who));
  });

  it('FAILS CLOSED against a Redis that is really unreachable', async () => {
    // The SAME options auth.module.ts ships, so this proves the behaviour of
    // the client that is actually deployed rather than of a stricter one.
    const dead = new Redis('redis://127.0.0.1:6399', {
      lazyConnect: true,
      maxRetriesPerRequest: 1,
      enableOfflineQueue: true,
      retryStrategy: () => null,
    });
    dead.on('error', () => undefined);

    const offline = new LoginRateLimiter(new RedisRateLimitStore(dead));
    await expect(offline.reserve('anyone', ip)).rejects.toMatchObject({
      code: AuthErrorCode.RATE_LIMITED,
      status: 429,
    });

    dead.disconnect();
  });
});

// ---------------------------------------------------------------------------
// The real authentication path, under real concurrency
// ---------------------------------------------------------------------------

describe('the login endpoint under a concurrent burst', () => {
  const prisma = new PrismaService();
  let client: Redis;
  let controller: AuthController;

  const run = randomUUID().slice(0, 8);
  const org = randomUUID();
  const ids = {
    account: randomUUID(),
    staff: randomUUID(),
    family: randomUUID(),
    contact: randomUUID(),
  };
  const subject = `burst-${run}`;
  const ip = `198.51.100.250-${run}`;

  beforeAll(async () => {
    await prisma.$connect();
    client = new Redis(REDIS_URL, { maxRetriesPerRequest: 1, lazyConnect: true });
    await client.connect();

    const auth = new AuthService(prisma, new PrismaIdentityService(prisma), new PrismaAuditService());

    // EXPLICITLY ENABLED. The source dimension is OFF unless a deployment
    // states its topology (TRUSTED_PROXY_HOPS), so a controller built with the
    // default policy would charge no source budget at all and the source
    // assertions below would be vacuous. Stating it here is the same decision a
    // deployment makes -- see client-address.ts. The OFF default is covered
    // over real HTTP in auth-trusted-proxy.spec.ts.
    const sourceEnabled: ClientAddressPolicy = { sourceDimensionEnabled: true, trustProxy: false };
    controller = new AuthController(
      auth,
      new LoginRateLimiter(new RedisRateLimitStore(client)),
      sourceEnabled,
    );

    await prisma.$executeRawUnsafe(
      `insert into chat.organization (id, slug, display_name)
       values ('${org}'::uuid, 'burst-${run}', 'burst test org')`,
    );
    await prisma.$executeRawUnsafe(
      `insert into chat.account (id, organization_id, subject, kind, status, is_active)
       values ('${ids.account}'::uuid, '${org}'::uuid, '${subject}', 'family', 'active', true)`,
    );
    await prisma.$executeRawUnsafe(
      `insert into chat.staff (id, organization_id, name, role)
       values ('${ids.staff}'::uuid, '${org}'::uuid, 'owner_o', 'manager')`,
    );
    await prisma.$executeRawUnsafe(
      `insert into chat.family (id, organization_id, display_name, owner_id, language)
       values ('${ids.family}'::uuid, '${org}'::uuid, 'family_f', '${ids.staff}'::uuid, 'ar')`,
    );
    await prisma.$executeRawUnsafe(
      `insert into chat.contact
         (id, organization_id, family_id, name, role_preset, can_message, account_id)
       values ('${ids.contact}'::uuid, '${org}'::uuid, '${ids.family}'::uuid, 'parent_p',
               'primary_guardian', true, '${ids.account}'::uuid)`,
    );
    await auth.setPassword(ids.account, PASSWORD);
  });

  afterAll(async () => {
    await client.del(rateLimitKey('id', subject), rateLimitKey('ip', ip));
    await client.quit();
    await prisma.$executeRawUnsafe(`delete from chat.session where organization_id = '${org}'::uuid`);
    await prisma.$executeRawUnsafe(`delete from chat.device where organization_id = '${org}'::uuid`);
    await prisma.$executeRawUnsafe(`delete from chat.contact where organization_id = '${org}'::uuid`);
    await prisma.$executeRawUnsafe(`delete from chat.family where organization_id = '${org}'::uuid`);
    await prisma.$executeRawUnsafe(`delete from chat.staff where organization_id = '${org}'::uuid`);
    await prisma.$executeRawUnsafe(
      `delete from chat.account_credential where account_id = '${ids.account}'::uuid`,
    );
    await prisma.$executeRawUnsafe(`delete from chat.account where organization_id = '${org}'::uuid`);
    await prisma.$executeRawUnsafe(`delete from chat.organization where id = '${org}'::uuid`);
    await prisma.$disconnect();
  });

  it('120 CONCURRENT logins: no more than the limit reach password verification', async () => {
    const BURST = 120;

    const before = await prisma.accountCredential.findUnique({ where: { accountId: ids.account } });
    expect(before!.failedAttempts).toBe(0);

    const outcomes = await Promise.all(
      Array.from({ length: BURST }, (_, i) =>
        controller.login({ username: subject, password: `guess-${i}` }, undefined, ip).then(
          () => 'ok' as const,
          (e: AuthError) => e.code,
        ),
      ),
    );

    const verified = outcomes.filter((o) => o === AuthErrorCode.INVALID_CREDENTIALS).length;
    const throttled = outcomes.filter((o) => o === AuthErrorCode.RATE_LIMITED).length;

    // THE PROOF. An INVALID_CREDENTIALS response is only reachable AFTER
    // Argon2id has run; a RATE_LIMITED response is only reachable BEFORE it.
    // Under the old implementation this was 120 and 0.
    expect(verified).toBeLessThanOrEqual(IDENTIFIER_MAX_ATTEMPTS);
    expect(throttled).toBe(BURST - verified);

    // Independent corroboration from the database, written by a different
    // subsystem than the limiter: the account lockout counter advanced, and it
    // never exceeded the limiter's allowance.
    //
    // It is asserted as a RANGE, not as an equality, and that is a finding
    // rather than a convenience. chat.account_credential.failed_attempts is
    // updated with a read-modify-write in JavaScript
    // (auth.service.ts recordLoginFailure: `previousAttempts + 1`), so N
    // concurrent failures all read the same value and all write the same
    // value -- a lost update. After 10 concurrent verifications the counter
    // typically reads 1, not 10.
    //
    // That race is PRE-EXISTING (identical shape in dd33a57's recordFailure),
    // lives in the account-lockout subsystem rather than the rate limiter, and
    // is deliberately NOT fixed here because it is outside the two blockers
    // this commit addresses. It is reported instead. Its practical impact is
    // now bounded by the limiter above, which caps a window at 10 attempts
    // whatever the lockout counter believes.
    const after = await prisma.accountCredential.findUnique({ where: { accountId: ids.account } });
    expect(after!.failedAttempts).toBeGreaterThan(0);
    expect(after!.failedAttempts).toBeLessThanOrEqual(verified);

    // Redis state is consistent with the reservation model: every request was
    // charged, including the ones refused.
    expect(Number(await client.get(rateLimitKey('id', subject)))).toBe(BURST);
  });

  it('after the burst, a CORRECT password is still refused -- the budget is spent', async () => {
    await expect(
      controller.login({ username: subject, password: PASSWORD }, undefined, ip),
    ).rejects.toMatchObject({ code: AuthErrorCode.RATE_LIMITED });
  });

  it('a successful login releases ONLY the identifier budget, not the source', async () => {
    await client.del(rateLimitKey('id', subject));
    await prisma.accountCredential.update({
      where: { accountId: ids.account },
      data: { failedAttempts: 0, lockedUntil: null },
    });
    const sourceBefore = Number(await client.get(rateLimitKey('ip', ip)));
    expect(sourceBefore).toBeGreaterThan(0);

    const dto = await controller.login({ username: subject, password: PASSWORD }, undefined, ip);
    expect(dto.tokenType).toBe('Bearer');

    // identifier released...
    expect(await client.get(rateLimitKey('id', subject))).toBeNull();
    // ...source NOT released, and charged for this attempt too.
    expect(Number(await client.get(rateLimitKey('ip', ip)))).toBe(sourceBefore + 1);
  });
});
