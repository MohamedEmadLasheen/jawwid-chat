import { Inject, Injectable } from '@nestjs/common';
import Redis from 'ioredis';
import { REDIS_CLIENT } from './redis.provider';
import { AppConfigService } from '../../platform/app-config.service';

/**
 * Typing indicators are transient. They live in Redis with an expiry and are
 * never written to Postgres -- a typing event is not a business record, and
 * persisting one would put a row on every keystroke of every conversation.
 *
 * ## One sorted set per conversation, not one key per typist
 *
 * `typing:<conversation>` holds actor ids scored by the instant each stops
 * counting as typing:
 *
 *   start        ZADD  typing:<c> <now+ttl> <actor>       O(log n)
 *   stop         ZREM  typing:<c> <actor>                 O(log n)
 *   whoIsTyping  drop expired, then ZRANGE                O(log n + m)
 *
 * The previous shape was one key per (conversation, actor) pair and
 * `whoIsTyping` was `KEYS typing:<conversation>:*` -- a full keyspace scan, on
 * the single-threaded server that also carries presence and the Socket.IO
 * adapter, run every time somebody opens a conversation. It is instant on a
 * development keyspace and a latency incident on a production one, and it fails
 * by getting slow rather than by raising anything.
 *
 * The set also carries a TTL, so a conversation nobody returns to releases its
 * key instead of holding an empty set for ever.
 *
 * TIMEOUT SAFETY. The score is the authority, not the presence of a member: an
 * actor whose client vanished mid-word has an expired score and is filtered out
 * of the very next read. There is no state in which somebody is permanently
 * "typing…", with or without a clean stop frame.
 */
@Injectable()
export class TypingService {
  constructor(
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    private readonly config: AppConfigService,
  ) {}

  private key(conversationId: string) {
    return `typing:${conversationId}`;
  }

  /**
   * Returns true when this is a NEW typing state worth broadcasting.
   *
   * Server-side debounce: a client sends a frame per keystroke, and a repeat
   * inside the window only refreshes the expiry. Without this, one person
   * typing a sentence would fan out forty identical events to everybody in the
   * conversation.
   */
  async start(conversationId: string, userId: string): Promise<boolean> {
    const ttl = await this.config.get('realtime.typing_ttl_seconds');
    const now = Date.now();
    const key = this.key(conversationId);

    // The previous score decides whether this is new. An EXPIRED score is not a
    // live typing state, so it must read as new -- otherwise somebody who
    // stopped typing, waited past the TTL and started again would silently emit
    // nothing, and the indicator would never reappear for them.
    const previous = await this.redis.zscore(key, userId);
    const wasTyping = previous !== null && Number(previous) > now;

    await this.redis
      .multi()
      .zadd(key, now + ttl * 1000, userId)
      .expire(key, ttl * 2)
      .exec();

    return !wasTyping;
  }

  /** Returns true when there was something to stop, so a repeat is silent. */
  async stop(conversationId: string, userId: string): Promise<boolean> {
    const removed = await this.redis.zrem(this.key(conversationId), userId);
    return removed > 0;
  }

  /** Everybody currently typing in this conversation. Expired entries excluded. */
  async whoIsTyping(conversationId: string): Promise<string[]> {
    const key = this.key(conversationId);
    const result = await this.redis
      .multi()
      .zremrangebyscore(key, '-inf', Date.now())
      .zrange(key, 0, -1)
      .exec();
    return (result?.[1]?.[1] as string[]) ?? [];
  }
}
