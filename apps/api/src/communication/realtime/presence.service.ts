import { Inject, Injectable } from '@nestjs/common';
import Redis from 'ioredis';
import { REDIS_CLIENT } from './redis.provider';
import { AppConfigService } from '../../platform/app-config.service';

/**
 * Lightweight presence. Deliberately not a business record: an entry expires on
 * its own, so a process that dies without a clean disconnect does not leave a
 * user online forever.
 *
 * ## One sorted set per user, not one key per connection
 *
 * A user may hold several connections -- phone, tablet, the same phone
 * reconnecting through a tunnel that has not timed out yet -- and presence is
 * the union. The previous shape was one Redis key per connection
 * (`presence:<user>:<connection>`), which made "is this user online" a
 * `KEYS presence:<user>:*`.
 *
 * `KEYS` is a full keyspace scan, single-threaded, on the same server that
 * carries typing and the Socket.IO adapter. On a development keyspace it is
 * instant and correct; on a production one it walks every key in the database
 * to answer a question about one user, and it does it while every other command
 * waits. That is a latency incident with no error in it, and it would first
 * appear as "chat got slow" long after the change that caused it.
 *
 * The shape here is a sorted set per user, `presence:<user>`, whose members are
 * connection ids scored by the instant that connection's presence expires:
 *
 *   online/heartbeat   ZADD  presence:<user> <now+ttl> <connection>   O(log n)
 *   offline            ZREM  presence:<user> <connection>             O(log n)
 *   isOnline           drop expired, then ZCARD > 0                   O(log n)
 *
 * `n` is the number of devices ONE person has, which is a handful. Nothing
 * scans the keyspace, and the whole set carries a TTL as well, so a user who
 * never comes back stops occupying memory rather than holding an empty set.
 *
 * Expired members are dropped on read AND on write, so an abandoned connection
 * cannot keep somebody "online": its score is in the past and the next touch of
 * that user's set removes it.
 */
@Injectable()
export class PresenceService {
  constructor(
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    private readonly config: AppConfigService,
  ) {}

  private key(userId: string) {
    return `presence:${userId}`;
  }

  private lastSeenKey(userId: string) {
    return `lastseen:${userId}`;
  }

  /**
   * Record a live connection, and report whether this made the user newly
   * online.
   *
   * The return value is what lets the gateway emit `presence.changed` on the
   * TRANSITION rather than on every connection: somebody opening the app on a
   * second device is not a presence change, and broadcasting it as one would
   * put a fan-out on every reconnect of every device.
   */
  async online(userId: string, connectionId: string): Promise<boolean> {
    const ttl = await this.config.get('realtime.presence_ttl_seconds');
    const now = Date.now();
    const key = this.key(userId);

    const claimed = await this.redis
      .multi()
      // Drop anything whose heartbeat lapsed BEFORE counting, or a stale entry
      // from a connection that died would make a genuine 0 -> 1 transition look
      // like a user who was already online.
      .zremrangebyscore(key, '-inf', now)
      .zcard(key)
      .zadd(key, now + ttl * 1000, connectionId)
      // The set outlives its longest-lived member by a margin; without this a
      // user who never returns leaves an empty set behind for ever.
      .expire(key, ttl * 2)
      .set(this.lastSeenKey(userId), now.toString(), 'EX', 30 * 24 * 60 * 60)
      .exec();

    // Index 1 is the ZCARD, taken after the expiry sweep and before this
    // connection was added.
    const liveBefore = (claimed?.[1]?.[1] as number) ?? 0;
    return liveBefore === 0;
  }

  /** Refresh this connection's expiry. Never a transition by itself. */
  async heartbeat(userId: string, connectionId: string): Promise<void> {
    await this.online(userId, connectionId);
  }

  /**
   * Drop a connection, and report whether that took the user offline.
   *
   * False when another device is still connected -- which is the case that made
   * a naive implementation announce a parent as offline the moment they closed
   * one of two open sessions.
   */
  async offline(userId: string, connectionId: string): Promise<boolean> {
    const now = Date.now();
    const key = this.key(userId);

    const result = await this.redis
      .multi()
      .zrem(key, connectionId)
      .zremrangebyscore(key, '-inf', now)
      .zcard(key)
      .set(this.lastSeenKey(userId), now.toString(), 'EX', 30 * 24 * 60 * 60)
      .exec();

    const remaining = (result?.[2]?.[1] as number) ?? 0;
    return remaining === 0;
  }

  async isOnline(userId: string): Promise<boolean> {
    return (await this.connectionCount(userId)) > 0;
  }

  /** How many live connections this user holds. Multi-device awareness (§6). */
  async connectionCount(userId: string): Promise<number> {
    const key = this.key(userId);
    const result = await this.redis
      .multi()
      .zremrangebyscore(key, '-inf', Date.now())
      .zcard(key)
      .exec();
    return (result?.[1]?.[1] as number) ?? 0;
  }

  async lastSeen(userId: string): Promise<Date | null> {
    const v = await this.redis.get(this.lastSeenKey(userId));
    return v ? new Date(Number(v)) : null;
  }
}
