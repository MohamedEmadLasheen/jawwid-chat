import { randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import Redis from 'ioredis';
import { CanActivate, Controller, ExecutionContext, INestApplication, Post } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import {
  ActionScope,
  ActionThrottleGuard,
  actionRateLimitKey,
  RateLimited,
} from '@platform/auth/action-throttle.guard';
import { AuthErrorFilter } from '@platform/auth/auth.errors';
import { RATE_LIMIT_STORE } from '@platform/auth/login-rate-limit';
import { RedisRateLimitStore } from '@platform/auth/redis-rate-limit.store';
import { AppConfigService, COMMUNICATION_CONFIG_DEFAULTS } from '@platform/app-config.service';

/**
 * Authenticated-action limits (Phase 8) over HTTP, against a REAL Redis.
 *
 * The unit suite pins the policy with a double. This proves the wiring a double
 * cannot: the guard's keys through the real reserve script, the refusal reaching
 * the wire as 429 COMMON.RATE_LIMITED with a Retry-After header through the
 * global AuthErrorFilter, and fail-open against a Redis that is not there.
 *
 * The authentication guard is a stand-in that resolves `request.actor` from a
 * test header; the real one is AuthenticatedGuard and its order is pinned in
 * test/unit/abuse/action-throttle-guard.spec.ts. Database-free: the config is a
 * stub serving the compiled defaults.
 *
 * Requires Redis. Set AUTH_TEST_REDIS_URL/REDIS_URL to your own instance.
 */
const REDIS_URL = process.env.AUTH_TEST_REDIS_URL ?? process.env.REDIS_URL ?? 'redis://localhost:6410';

jest.setTimeout(60_000);

@Controller('rationed')
class RationedController {
  @Post('send')
  @RateLimited(ActionScope.MESSAGE_SEND)
  send() {
    return { ok: true };
  }

  @Post('free')
  free() {
    return { ok: true };
  }
}

/** Stand-in for AuthenticatedGuard: the actor is whatever the test names. */
class TestActorGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    request.actor = { actorId: request.headers['x-test-actor'] };
    return true;
  }
}

const config = {
  get: async (key: keyof typeof COMMUNICATION_CONFIG_DEFAULTS) => COMMUNICATION_CONFIG_DEFAULTS[key],
};

async function boot(client: Redis): Promise<{ app: INestApplication; base: string }> {
  const module = await Test.createTestingModule({
    controllers: [RationedController],
    providers: [
      { provide: AppConfigService, useValue: config },
      { provide: RATE_LIMIT_STORE, useValue: new RedisRateLimitStore(client) },
      { provide: APP_GUARD, useClass: TestActorGuard },
      { provide: APP_GUARD, useClass: ActionThrottleGuard },
      { provide: APP_FILTER, useClass: AuthErrorFilter },
    ],
  }).compile();
  const app = module.createNestApplication({ logger: false });
  await app.listen(0, '127.0.0.1');
  const { port } = app.getHttpServer().address() as AddressInfo;
  return { app, base: `http://127.0.0.1:${port}` };
}

const post = (base: string, path: string, actor: string) =>
  fetch(`${base}${path}`, { method: 'POST', headers: { 'x-test-actor': actor } });

describe('authenticated-action limits against Redis', () => {
  const limit = COMMUNICATION_CONFIG_DEFAULTS['abuse.throttle.message_send_actor'];
  const run = randomUUID().slice(0, 8);
  const touched: string[] = [];
  const actor = () => {
    const id = `abuse-${run}-${randomUUID().slice(0, 8)}`;
    touched.push(actionRateLimitKey(ActionScope.MESSAGE_SEND, id));
    return id;
  };

  let client: Redis;
  let app: INestApplication;
  let base: string;

  beforeAll(async () => {
    client = new Redis(REDIS_URL, { maxRetriesPerRequest: 1, lazyConnect: true });
    await client.connect();
    ({ app, base } = await boot(client));
  });

  afterAll(async () => {
    if (touched.length > 0) await client.del(...touched);
    // The store owns its client's lifetime: closing the app quits it.
    await app?.close();
  });

  it('admits exactly the limit, then answers 429 COMMON.RATE_LIMITED with Retry-After', async () => {
    const who = actor();
    for (let i = 0; i < limit; i++) {
      expect((await post(base, '/rationed/send', who)).status).toBe(201);
    }
    const refused = await post(base, '/rationed/send', who);
    expect(refused.status).toBe(429);
    expect(await refused.json()).toEqual({
      error: { code: 'COMMON.RATE_LIMITED', message: 'too many attempts; try again later' },
    });
    const retryAfter = Number(refused.headers.get('retry-after'));
    expect(retryAfter).toBeGreaterThan(0);
    expect(retryAfter).toBeLessThanOrEqual(COMMUNICATION_CONFIG_DEFAULTS['abuse.throttle.window_seconds']);
  });

  it('the counter in Redis is keyed by the hashed actor and expires with the window', async () => {
    const who = actor();
    await post(base, '/rationed/send', who);
    const key = actionRateLimitKey(ActionScope.MESSAGE_SEND, who);
    expect(await client.get(key)).toBe('1');
    const ttl = await client.ttl(key);
    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(COMMUNICATION_CONFIG_DEFAULTS['abuse.throttle.window_seconds']);
    expect(await client.keys(`*${who}*`)).toEqual([]);
  });

  it('concurrency: a burst cannot exceed the limit (the reserve is atomic)', async () => {
    const who = actor();
    const statuses = await Promise.all(
      Array.from({ length: limit * 2 }, () => post(base, '/rationed/send', who).then((r) => r.status)),
    );
    expect(statuses.filter((s) => s === 201)).toHaveLength(limit);
    expect(statuses.filter((s) => s === 429)).toHaveLength(limit);
  });

  it('an undecorated route is never counted, and another actor keeps its budget', async () => {
    const who = actor();
    for (let i = 0; i < limit; i++) await post(base, '/rationed/send', who);
    expect((await post(base, '/rationed/send', who)).status).toBe(429);
    expect((await post(base, '/rationed/free', who)).status).toBe(201);
    expect((await post(base, '/rationed/send', actor())).status).toBe(201);
  });

  it('FAILS OPEN: with Redis unreachable the action is still served', async () => {
    // A port nothing listens on: the same client options production uses.
    const dead = new Redis('redis://127.0.0.1:1', { lazyConnect: true, maxRetriesPerRequest: 1, enableOfflineQueue: true });
    dead.on('error', () => undefined);
    const down = await boot(dead);
    try {
      // A store that cannot count cannot refuse; a few requests prove each is
      // served (each costs at most the store timeout).
      const who = actor();
      for (let i = 0; i < 3; i++) {
        expect((await post(down.base, '/rationed/send', who)).status).toBe(201);
      }
    } finally {
      await down.app.close();
    }
  });
});
