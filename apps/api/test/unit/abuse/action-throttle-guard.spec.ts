/**
 * The authenticated-action rate limit gate (Phase 8, docs/security/ABUSE-LIMITS.md).
 *
 * Properties pinned here, none of them obvious from reading the guard:
 *
 *  1. It counts against the actor the SIGNED TOKEN established, never against
 *     anything the caller supplied. A counter an attacker can rename is not a
 *     counter.
 *  2. It is silent on routes that do not ask for it: each check is a Redis round
 *     trip, and paying it on history paging is a regression, not a control.
 *  3. Over the limit it refuses with 429 COMMON.RATE_LIMITED and a Retry-After.
 *  4. It FAILS OPEN when the store errors, stalls or is absent -- unlike login.
 *     Sending a message must not break because Redis blipped.
 *  5. It runs AFTER AuthenticatedGuard, or there is no verified actor to count.
 *
 * The double is the same FakeRateLimitStore the login limiter's spec uses; the
 * Redis script's atomicity is proved against a real Redis in
 * test/integration/auth-rate-limit.spec.ts and is shared, not re-implemented.
 */
import { createHash } from 'node:crypto';
import { ExecutionContext, Logger } from '@nestjs/common';
import { APP_GUARD, Reflector } from '@nestjs/core';
import {
  ACTION_LIMIT_STORE_TIMEOUT_MS,
  ActionScope,
  ActionThrottleGuard,
  actionRateLimitKey,
  RateLimited,
  RATE_LIMITED_ACTION,
} from '@platform/auth/action-throttle.guard';
import { AuthErrorCode } from '@platform/auth/auth.errors';
import { AuthenticatedGuard } from '@platform/auth/auth.guard';
import { PermissionGuard } from '@platform/permissions/permission.guard';
import { AuthModule } from '@platform/auth/auth.module';
import { COMMUNICATION_CONFIG_DEFAULTS } from '@platform/app-config.service';
import type { RateLimitStore } from '@platform/auth/login-rate-limit';
import { FakeRateLimitStore } from '../auth/support/fake-db';

class Routes {
  @RateLimited(ActionScope.MESSAGE_SEND)
  send(): void {}

  @RateLimited(ActionScope.CALL_START)
  call(): void {}

  page(): void {}
}

const limited = { code: AuthErrorCode.RATE_LIMITED, status: 429 };

function context(handler: keyof Routes, actorId?: string, type = 'http'): ExecutionContext {
  const request = {
    headers: { 'x-actor-id': 'someone-else' },
    body: { actorId: 'someone-else' },
    actor: actorId ? { actorId } : undefined,
  };
  return {
    getType: () => type,
    getHandler: () => Routes.prototype[handler],
    getClass: () => Routes,
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
}

/** chat.config as AppConfigService serves it: a row, else the compiled default. */
function config(rows: Record<string, unknown> = {}, failing = false) {
  return {
    get: jest.fn(async (key: string) => {
      if (failing) throw new Error('db down');
      return key in rows ? rows[key] : COMMUNICATION_CONFIG_DEFAULTS[key as keyof typeof COMMUNICATION_CONFIG_DEFAULTS];
    }),
  };
}

function guardWith(store: RateLimitStore | undefined, rows: Record<string, unknown> = {}, failing = false) {
  return new ActionThrottleGuard(new Reflector(), config(rows, failing) as never, store);
}

let logged: jest.SpyInstance;
beforeEach(() => {
  logged = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
});
afterEach(() => logged.mockRestore());

describe('ActionThrottleGuard — what it counts', () => {
  it('counts an undecorated route not at all', async () => {
    const store = new FakeRateLimitStore();
    await expect(guardWith(store).canActivate(context('page', 'actor-1'))).resolves.toBe(true);
    expect(store.reservations).toEqual([]);
  });

  it('counts a decorated route against the token-derived actor, hashed, under its own prefix', async () => {
    const store = new FakeRateLimitStore();
    await guardWith(store).canActivate(context('send', 'actor-1'));

    const digest = createHash('sha256').update('actor-1').digest('hex').slice(0, 32);
    expect(store.reservations).toEqual([[`ratelimit:action:message_send_actor:${digest}`]]);
    // Never the raw id, and never the header or body the caller supplied.
    expect(store.reservations[0][0]).not.toContain('actor-1');
    expect(store.reservations[0][0]).not.toContain('someone-else');
    // Distinct from the login limiter's keyspace.
    expect(store.reservations[0][0].startsWith('ratelimit:login')).toBe(false);
  });

  it('counts the ATTEMPT: every call charges the budget, success or not', async () => {
    const store = new FakeRateLimitStore();
    const guard = guardWith(store);
    await guard.canActivate(context('send', 'actor-1'));
    await guard.canActivate(context('send', 'actor-1'));
    expect(store.countOf(actionRateLimitKey(ActionScope.MESSAGE_SEND, 'actor-1'))).toBe(2);
  });

  it('ignores non-HTTP contexts: frames are bounded in the gateway', async () => {
    const store = new FakeRateLimitStore();
    await expect(guardWith(store).canActivate(context('send', 'actor-1', 'ws'))).resolves.toBe(true);
    expect(store.reservations).toEqual([]);
  });

  it('reads the scope from route metadata, never from the request', () => {
    expect(new Reflector().get(RATE_LIMITED_ACTION, Routes.prototype.send)).toBe('message_send_actor');
    expect(new Reflector().get(RATE_LIMITED_ACTION, Routes.prototype.page)).toBeUndefined();
  });
});

describe('ActionThrottleGuard — over the limit', () => {
  it('admits exactly the configured limit, then refuses with 429 and Retry-After', async () => {
    const store = new FakeRateLimitStore();
    const guard = guardWith(store, { 'abuse.throttle.message_send_actor': 3, 'abuse.throttle.window_seconds': 45 });

    for (let i = 0; i < 3; i++) {
      await expect(guard.canActivate(context('send', 'actor-1'))).resolves.toBe(true);
    }
    const refusal = guard.canActivate(context('send', 'actor-1'));
    await expect(refusal).rejects.toMatchObject({ ...limited, retryAfterSeconds: 45 });
  });

  it('uses the compiled default when chat.config has no row', async () => {
    const store = new FakeRateLimitStore();
    const guard = guardWith(store);
    const limit = COMMUNICATION_CONFIG_DEFAULTS['abuse.throttle.call_start_actor'];
    for (let i = 0; i < limit; i++) await guard.canActivate(context('call', 'actor-1'));
    await expect(guard.canActivate(context('call', 'actor-1'))).rejects.toMatchObject(limited);
  });

  it('one actor exhausting a budget does not touch another actor or another scope', async () => {
    const store = new FakeRateLimitStore();
    const guard = guardWith(store, { 'abuse.throttle.message_send_actor': 1 });
    await guard.canActivate(context('send', 'actor-1'));
    await expect(guard.canActivate(context('send', 'actor-1'))).rejects.toMatchObject(limited);

    await expect(guard.canActivate(context('send', 'actor-2'))).resolves.toBe(true);
    await expect(guard.canActivate(context('call', 'actor-1'))).resolves.toBe(true);
  });

  it('a limit of 0 refuses everything rather than switching the limit off', async () => {
    const guard = guardWith(new FakeRateLimitStore(), { 'abuse.throttle.message_send_actor': 0 });
    await expect(guard.canActivate(context('send', 'actor-1'))).rejects.toMatchObject(limited);
  });

  it('a malformed config row falls back to the default instead of refusing everyone', async () => {
    // jsonb null reads as 0 through Number(); that must not become "limit 0".
    for (const bad of [null, 'sixty', -1, 1.5, {}]) {
      const store = new FakeRateLimitStore();
      const guard = guardWith(store, { 'abuse.throttle.message_send_actor': bad, 'abuse.throttle.window_seconds': 0 });
      await expect(guard.canActivate(context('send', 'actor-1'))).resolves.toBe(true);
    }
  });

  it('an unreadable config falls back to the defaults, still enforcing a limit', async () => {
    const store = new FakeRateLimitStore();
    const guard = guardWith(store, {}, true);
    const limit = COMMUNICATION_CONFIG_DEFAULTS['abuse.throttle.message_send_actor'];
    for (let i = 0; i < limit; i++) await guard.canActivate(context('send', 'actor-1'));
    await expect(guard.canActivate(context('send', 'actor-1'))).rejects.toMatchObject(limited);
  });
});

describe('ActionThrottleGuard — fails OPEN, unlike login', () => {
  it('allows the action and logs an error when the store throws', async () => {
    const store = new FakeRateLimitStore();
    store.broken = true;
    await expect(guardWith(store).canActivate(context('send', 'actor-1'))).resolves.toBe(true);
    expect(logged).toHaveBeenCalledTimes(1);
    // The error NAME only -- an ioredis message can carry the connection string.
    expect(String(logged.mock.calls[0][0])).toContain('Error');
    expect(String(logged.mock.calls[0][0])).not.toContain('ECONNREFUSED');
  });

  it('allows the action when the store accepts the command and never answers', async () => {
    const hung: RateLimitStore = {
      reserve: () => new Promise(() => undefined),
      drop: async () => undefined,
    };
    const started = Date.now();
    await expect(guardWith(hung).canActivate(context('send', 'actor-1'))).resolves.toBe(true);
    expect(Date.now() - started).toBeGreaterThanOrEqual(ACTION_LIMIT_STORE_TIMEOUT_MS - 50);
    expect(logged).toHaveBeenCalledTimes(1);
  });

  it('allows the action, logging once, when no store is configured at all', async () => {
    const guard = guardWith(undefined);
    await expect(guard.canActivate(context('send', 'actor-1'))).resolves.toBe(true);
    await expect(guard.canActivate(context('send', 'actor-1'))).resolves.toBe(true);
    expect(logged).toHaveBeenCalledTimes(1);
  });
});

describe('ActionThrottleGuard — registration', () => {
  it('is a global guard registered AFTER AuthenticatedGuard', () => {
    // Nest runs APP_GUARDs in registration order. Before AuthenticatedGuard
    // there is no verified actor, and the guard would count nothing. PD-40's
    // PermissionGuard sits between them, so a refused request spends no budget.
    const providers = Reflect.getMetadata('providers', AuthModule) as Array<{ provide?: unknown; useClass?: unknown }>;
    const guards = providers.filter((p) => p?.provide === APP_GUARD).map((p) => p.useClass);
    expect(guards).toEqual([AuthenticatedGuard, PermissionGuard, ActionThrottleGuard]);
  });
});
