import { Inject, Injectable } from '@nestjs/common';
import Redis from 'ioredis';
import { REDIS_CLIENT } from './redis.provider';
import { AppConfigService } from '../../platform/app-config.service';

/**
 * How long a person who lost their last connection still counts as online. A
 * phone that drops and reconnects within it -- the common case on mobile -- is
 * never announced as offline at all.
 */
export const PRESENCE_OFFLINE_GRACE_MS = 15_000;

/**
 * Lightweight presence. Deliberately not a business record: it lives in Redis
 * and expires on its own, so a crashed process stops counting as online without
 * anyone cleaning up after it.
 *
 * PD-37:
 *   presence:conns:<actorId>  one sorted set per person, connection id -> expiry
 *                             (ms). Online while any entry has not expired;
 *                             several devices are the union. (It replaces a key
 *                             per connection that was found with KEYS.)
 *   presence:index            ONE sorted set, actorId -> the moment they stop
 *                             counting as online: pushed forward by every
 *                             connect and heartbeat, set to now + grace by a
 *                             clean last disconnect. A person is "announced
 *                             online" exactly while they are in it.
 *
 * "Offline" is announced from ONE place for every cause -- a clean disconnect,
 * a stalled connection, a crashed node: whichever node's sweep claims a lapsed
 * index entry (ZREM returns 1 to exactly one of them). So nobody stays "online"
 * because the node holding them died, and nobody is announced twice.
 *
 * Who may SEE someone's presence is not decided here (PresencePolicy).
 */
@Injectable()
export class PresenceService {
  static readonly INDEX = 'presence:index';

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

  /**
   * Record a live connection. True when this is a return from offline worth
   * announcing -- false for another device, a heartbeat, or a reconnect inside
   * the grace (their "offline" was never announced, so neither is this).
   */
  async online(actorId: string, connectionId: string, now = Date.now()): Promise<boolean> {
    const ttlMs = (await this.config.get('realtime.presence_ttl_seconds')) * 1000;
    const key = this.conns(actorId);
    const res = await this.redis
      .multi()
      .zscore(PresenceService.INDEX, actorId)
      .zremrangebyscore(key, '-inf', now)
      .zadd(key, now + ttlMs, connectionId)
      .pexpire(key, ttlMs * 2)
      // Last seen = the last moment known online. Written here too, not only on
      // a clean disconnect, so a crashed process still leaves a true time.
      .set(this.lastSeenKey(actorId), String(now))
      .zadd(PresenceService.INDEX, 'GT', now + ttlMs, actorId)
      .exec();
    const tracked = res?.[0]?.[1];
    return tracked === null || tracked === undefined;
  }

  /** A connection is still alive. Same answer as `online`. */
  async heartbeat(actorId: string, connectionId: string, now = Date.now()): Promise<boolean> {
    return this.online(actorId, connectionId, now);
  }

  /**
   * A connection closed. True when it was the person's last live one: their
   * last seen is now, and they lapse after the grace unless they come back.
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
    if (remaining === 0) {
      await this.redis
        .multi()
        .set(this.lastSeenKey(actorId), String(now))
        // XX: only someone announced online is tracked; a plain set (not GT)
        // brings the lapse forward to the end of the grace.
        .zadd(PresenceService.INDEX, 'XX', now + PRESENCE_OFFLINE_GRACE_MS, actorId)
        .exec();
    }
    return remaining === 0;
  }

  /**
   * The people whose online state has lapsed and who are still offline,
   * CLAIMED: each is returned to exactly one caller across every node, which
   * then announces them offline.
   */
  async claimLapsed(now = Date.now(), limit = 200): Promise<string[]> {
    const due = await this.redis.zrangebyscore(PresenceService.INDEX, '-inf', now, 'LIMIT', 0, limit);
    const claimed: string[] = [];
    for (const actorId of due) {
      if ((await this.redis.zrem(PresenceService.INDEX, actorId)) !== 1) continue; // another node won
      if (await this.isOnline(actorId, now)) {
        // Came back between the read and the claim: still online, keep tracking.
        await this.redis.zadd(PresenceService.INDEX, 'GT', now + PRESENCE_OFFLINE_GRACE_MS, actorId);
        continue;
      }
      claimed.push(actorId);
    }
    return claimed;
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
