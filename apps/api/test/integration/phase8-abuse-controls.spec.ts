/**
 * Abuse protection for AUTHENTICATED actions. Phase 8.
 *
 * Until this existed, docs/security/AUTH-THROTTLING.md §5 said plainly that
 * "authenticated endpoints are not throttled. They are bounded by authorization,
 * and a session that misbehaves can be revoked." Authorization answers whether
 * an actor may do a thing; it does not answer whether they may do it four
 * thousand times a minute, and revocation is a human noticing.
 *
 * These run against the real migrated database because the counter IS the
 * database: chat.record_auth_attempt does the window, the block and the race
 * safety in one statement, and a mock of it would prove nothing about any of
 * the three.
 */
import { buildGraph, seed, truncate, Scenario } from './harness';
import { AuthError, AuthErrorCode } from '@platform/auth/auth.errors';
import { ActionScope } from '@platform/auth/throttle.service';

const g = buildGraph();
let s: Scenario;

async function setConfig(key: string, value: string): Promise<void> {
  await g.prisma.config.upsert({ where: { key }, create: { key, value }, update: { value } });
  g.config.invalidate();
}

/** Returns the error code, or NO_ERROR when the call was allowed. */
const codeOf = async (fn: () => Promise<unknown>): Promise<string> => {
  try {
    await fn();
    return 'NO_ERROR';
  } catch (e) {
    return e instanceof AuthError ? e.code : `OTHER:${String(e)}`;
  }
};

const hit = (scope: ActionScope, actorId: string) => () => g.throttle.hitAction(scope, actorId);

beforeAll(async () => {
  await truncate(g.prisma);
  s = await seed(g.prisma);
});

beforeEach(async () => {
  await g.prisma.$executeRawUnsafe('delete from chat.auth_throttle');
  await setConfig('abuse.throttle.window_seconds', '60');
  await setConfig('abuse.throttle.block_seconds', '300');
  await setConfig('abuse.throttle.message_send_actor', '60');
  await setConfig('abuse.throttle.broadcast_send_actor', '5');
});

afterAll(async () => {
  await g.prisma.$disconnect();
});

// ---------------------------------------------------------------------------

describe('authenticated action throttling', () => {
  it('allows exactly the configured number of actions and refuses the next', async () => {
    await setConfig('abuse.throttle.message_send_actor', '3');

    for (let i = 0; i < 3; i += 1) {
      expect(await codeOf(hit(ActionScope.MESSAGE_SEND, s.ownerId))).toBe('NO_ERROR');
    }
    expect(await codeOf(hit(ActionScope.MESSAGE_SEND, s.ownerId))).toBe(
      AuthErrorCode.TOO_MANY_ATTEMPTS,
    );
  });

  it('refuses with 429, not 401 -- this is not an authentication failure', async () => {
    await setConfig('abuse.throttle.message_send_actor', '1');
    await g.throttle.hitAction(ActionScope.MESSAGE_SEND, s.ownerId);

    await expect(g.throttle.hitAction(ActionScope.MESSAGE_SEND, s.ownerId)).rejects.toMatchObject({
      status: 429,
      code: AuthErrorCode.TOO_MANY_ATTEMPTS,
    });
  });

  it('bounds one actor without touching another', async () => {
    // The whole point of the actor axis. A staff member flooding a thread must
    // not take the rest of the school offline with them.
    await setConfig('abuse.throttle.message_send_actor', '2');

    await g.throttle.hitAction(ActionScope.MESSAGE_SEND, s.ownerId);
    await g.throttle.hitAction(ActionScope.MESSAGE_SEND, s.ownerId);
    expect(await codeOf(hit(ActionScope.MESSAGE_SEND, s.ownerId))).toBe(
      AuthErrorCode.TOO_MANY_ATTEMPTS,
    );

    expect(await codeOf(hit(ActionScope.MESSAGE_SEND, s.managerId))).toBe('NO_ERROR');
    expect(await codeOf(hit(ActionScope.MESSAGE_SEND, s.parentId))).toBe('NO_ERROR');
  });

  it('keeps each scope on its own counter', async () => {
    // Spending a broadcast must not consume a message allowance, or a busy
    // morning of messaging would silently disable broadcasting.
    await setConfig('abuse.throttle.broadcast_send_actor', '1');
    await setConfig('abuse.throttle.message_send_actor', '10');

    await g.throttle.hitAction(ActionScope.BROADCAST_SEND, s.ownerId);
    expect(await codeOf(hit(ActionScope.BROADCAST_SEND, s.ownerId))).toBe(
      AuthErrorCode.TOO_MANY_ATTEMPTS,
    );
    expect(await codeOf(hit(ActionScope.MESSAGE_SEND, s.ownerId))).toBe('NO_ERROR');
  });

  it('does NOT clear on success, which is the difference from the login counter', async () => {
    // A login counter measures FAILURES, so signing in correctly should erase
    // it. This one measures the action itself: sixty successful sends in a
    // minute is exactly what it is looking for. Clearing on success would count
    // nothing at all -- the bug this test exists to prevent.
    await setConfig('abuse.throttle.message_send_actor', '2');

    await g.throttle.hitAction(ActionScope.MESSAGE_SEND, s.ownerId);
    await g.throttle.hitAction(ActionScope.MESSAGE_SEND, s.ownerId);
    expect(await codeOf(hit(ActionScope.MESSAGE_SEND, s.ownerId))).toBe(
      AuthErrorCode.TOO_MANY_ATTEMPTS,
    );

    const rows = await g.prisma.$queryRawUnsafe<Array<{ attempts: number }>>(
      `select attempts from chat.auth_throttle where scope = 'message_send_actor'`,
    );
    expect(rows[0]?.attempts).toBeGreaterThanOrEqual(3);
  });

  it('keeps the block once tripped, even when the window has rolled over', async () => {
    // A block outlives its window on purpose: waiting out the window while
    // blocked must not reset the counter, or the limit is only ever a pause.
    await setConfig('abuse.throttle.message_send_actor', '1');
    await setConfig('abuse.throttle.window_seconds', '1');
    await setConfig('abuse.throttle.block_seconds', '300');

    await g.throttle.hitAction(ActionScope.MESSAGE_SEND, s.ownerId);
    expect(await codeOf(hit(ActionScope.MESSAGE_SEND, s.ownerId))).toBe(
      AuthErrorCode.TOO_MANY_ATTEMPTS,
    );

    // Move the row's clock back rather than sleeping: the assertion is about
    // the block outlasting the window, not about how long the suite takes.
    await g.prisma.$executeRawUnsafe(
      `update chat.auth_throttle
          set window_started_at = now() - interval '1 hour',
              last_attempt_at   = now() - interval '1 hour'
        where scope = 'message_send_actor'`,
    );

    expect(await codeOf(hit(ActionScope.MESSAGE_SEND, s.ownerId))).toBe(
      AuthErrorCode.TOO_MANY_ATTEMPTS,
    );
  });

  it('stores no recoverable actor id', async () => {
    // A throttle table is not a place to accumulate a list of who did what.
    // Same property the auth counters have, asserted again because the actor
    // axis is new and an actor id is more identifying than an address.
    await g.throttle.hitAction(ActionScope.MESSAGE_SEND, s.ownerId);

    const rows = await g.prisma.$queryRawUnsafe<Array<{ bucket: string }>>(
      `select bucket from chat.auth_throttle where scope = 'message_send_actor'`,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].bucket).toContain('message_send_actor:');
    expect(rows[0].bucket).not.toContain(s.ownerId);
  });

  it('takes its limit from chat.config, so tightening it is not a deploy', async () => {
    await setConfig('abuse.throttle.message_send_actor', '1');
    await g.throttle.hitAction(ActionScope.MESSAGE_SEND, s.managerId);
    expect(await codeOf(hit(ActionScope.MESSAGE_SEND, s.managerId))).toBe(
      AuthErrorCode.TOO_MANY_ATTEMPTS,
    );

    await g.prisma.$executeRawUnsafe('delete from chat.auth_throttle');
    await setConfig('abuse.throttle.message_send_actor', '5');
    for (let i = 0; i < 5; i += 1) {
      expect(await codeOf(hit(ActionScope.MESSAGE_SEND, s.managerId))).toBe('NO_ERROR');
    }
  });

  it('counts concurrent actions without letting two share one slot', async () => {
    // The counter is a single INSERT ... ON CONFLICT ... RETURNING precisely so
    // that ten parallel requests cannot all read a count of nine. Asserting the
    // outcome rather than the statement: with a limit of 5 and 10 concurrent
    // attempts, exactly 5 are allowed.
    await setConfig('abuse.throttle.message_send_actor', '5');

    const results = await Promise.all(
      Array.from({ length: 10 }, () => codeOf(hit(ActionScope.MESSAGE_SEND, s.parentId))),
    );
    expect(results.filter((r) => r === 'NO_ERROR')).toHaveLength(5);
    expect(results.filter((r) => r === AuthErrorCode.TOO_MANY_ATTEMPTS)).toHaveLength(5);
  });

  it('accepts every scope the migration declared', async () => {
    // A scope the application uses but the CHECK constraint rejects fails at
    // runtime, on the request it was meant to protect, in production.
    await setConfig('abuse.throttle.window_seconds', '60');
    for (const scope of Object.values(ActionScope)) {
      expect(await codeOf(() => g.throttle.hitAction(scope, s.ownerId))).toBe('NO_ERROR');
    }
  });
});
