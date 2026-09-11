import type Redis from 'ioredis';
import type { RateLimitStore, ReserveResult } from './login-rate-limit';

/**
 * The Redis-backed reservation store.
 *
 * ONE LUA SCRIPT, because Redis runs a script atomically: no other client's
 * command can interleave between the INCR and the comparison against the
 * limit. That is the entire fix for the concurrency bypass -- a pipeline or a
 * MULTI would not be enough, because MULTI queues commands but the application
 * still has to read a reply and then decide, which reopens the window.
 *
 * The script also sets the TTL, so a window can never be opened by one command
 * and left un-expiring because a second command failed in between.
 */
const RESERVE_SCRIPT = `
-- KEYS  = the budgets to charge, in order
-- ARGV  = [window, limit_1, limit_2, ...] aligned with KEYS
local window = tonumber(ARGV[1])

for i = 1, #KEYS do
  local count = redis.call('INCR', KEYS[i])

  -- Fixed window: the expiry belongs to whichever attempt opened it, so the
  -- window runs from the first attempt rather than sliding forward with every
  -- new one (which under sustained load would never expire at all).
  if count == 1 then
    redis.call('EXPIRE', KEYS[i], window)
  elseif redis.call('TTL', KEYS[i]) < 0 then
    -- Defence in depth: a key that somehow lost its TTL would otherwise block
    -- that budget forever.
    redis.call('EXPIRE', KEYS[i], window)
  end

  if count > tonumber(ARGV[i + 1]) then
    local ttl = redis.call('TTL', KEYS[i])
    if ttl < 0 then ttl = window end
    return { i, ttl }
  end
end

return { 0, 0 }
`;

export class RedisRateLimitStore implements RateLimitStore {
  constructor(private readonly client: Redis) {}

  async reserve(
    keys: readonly string[],
    limits: readonly number[],
    windowSeconds: number,
  ): Promise<ReserveResult> {
    // eval, not evalsha-with-fallback: the script is a few hundred bytes and
    // the login path is not hot enough for the round-trip saving to justify the
    // NOSCRIPT retry logic that caching it would require.
    const raw = (await this.client.eval(
      RESERVE_SCRIPT,
      keys.length,
      ...keys,
      String(windowSeconds),
      ...limits.map(String),
    )) as [number, number];

    return { exceeded: Number(raw[0]), retryAfterSeconds: Number(raw[1]) };
  }

  async drop(key: string): Promise<void> {
    await this.client.del(key);
  }
}
