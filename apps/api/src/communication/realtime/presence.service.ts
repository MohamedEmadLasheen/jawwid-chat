import { Inject, Injectable } from '@nestjs/common';
import Redis from 'ioredis';
import { REDIS_CLIENT } from './redis.provider';
import { AppConfigService } from '../../platform/app-config.service';

/**
 * Lightweight presence. Deliberately not a business record: it lives in Redis
 * and expires on its own, so a crashed process stops counting as online without
 * anyone cleaning up after it.
 *
 * PD-37: ONE sorted set per person, `presence:conns:<actorId>`, of connection
 * id -> expiry (ms). A person is online while any entry has not expired;
 * several devices are the union. Replaces a key per connection that was found
 * with `KEYS presence:<id>:*` -- a scan of the whole keyspace on every check.
 *
 * Each write reports a TRANSITION (offline -> online, online -> offline) so
 * the gateway announces only changes, never every heartbeat.
 *
 * Who may SEE someone's presence is not decided here (PresencePolicy).
 */
@Injectable()
export class PresenceService {
  constructor(
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    private readonly config: AppConfigService,
  ) {}

  private conns(actorId: string) {
    return `presence:conns:${actorId}`;
  }

  private lastSeenKey(actorId: string) {
    return `lastseen:${actorId}`;
  }

  /** Record a live connection. True when the person was offline until now. */
  async online(actorId: string, connectionId: string, now = Date.now()): Promise<boolean> {
    const ttlMs = (await this.config.get('realtime.presence_ttl_seconds')) * 1000;
    const key = this.conns(actorId);
    const res = await this.redis
      .multi()
      .zremrangebyscore(key, '-inf', now)
      .zcard(key)
      .zadd(key, now + ttlMs, connectionId)
      .pexpire(key, ttlMs * 2)
      // Last seen = the last moment known online. Written here too, not only on
      // a clean disconnect, so a crashed process still leaves a true time.
      .set(this.lastSeenKey(actorId), String(now))
      .exec();
    const before = Number(res?.[1]?.[1] ?? 0);
    return before === 0;
  }

  /** A connection is still alive. True if the person had lapsed to offline meanwhile. */
  async heartbeat(actorId: string, connectionId: string, now = Date.now()): Promise<boolean> {
    return this.online(actorId, connectionId, now);
  }

  /**
   * A connection closed. True when it was the person's last live one -- they are
   * offline now, and their last seen is now.
   */
  async offline(actorId: string, connectionId: string, now = Date.now()): Promise<boolean> {
    const key = this.conns(actorId);
    const res = await this.redis
      .multi()
      .zrem(key, connectionId)
      .zremrangebyscore(key, '-inf', now)
      .zcard(key)
      .exec();
    const remaining = Number(res?.[2]?.[1] ?? 0);
    if (remaining === 0) await this.redis.set(this.lastSeenKey(actorId), String(now));
    return remaining === 0;
  }

  async isOnline(actorId: string, now = Date.now()): Promise<boolean> {
    return (await this.redis.zcount(this.conns(actorId), `(${now}`, '+inf')) > 0;
  }

  async lastSeen(actorId: string): Promise<Date | null> {
    const v = await this.redis.get(this.lastSeenKey(actorId));
    return v ? new Date(Number(v)) : null;
  }

  /** Many people at once, in one round trip. */
  async snapshot(
    actorIds: readonly string[],
    now = Date.now(),
  ): Promise<Map<string, { online: boolean; lastSeenAt: Date | null }>> {
    const out = new Map<string, { online: boolean; lastSeenAt: Date | null }>();
    if (actorIds.length === 0) return out;
    const pipe = this.redis.pipeline();
    for (const id of actorIds) {
      pipe.zcount(this.conns(id), `(${now}`, '+inf');
      pipe.get(this.lastSeenKey(id));
    }
    const res = (await pipe.exec()) ?? [];
    actorIds.forEach((id, i) => {
      const live = Number(res[i * 2]?.[1] ?? 0);
      const seen = res[i * 2 + 1]?.[1] as string | null | undefined;
      out.set(id, { online: live > 0, lastSeenAt: seen ? new Date(Number(seen)) : null });
    });
    return out;
  }
}
