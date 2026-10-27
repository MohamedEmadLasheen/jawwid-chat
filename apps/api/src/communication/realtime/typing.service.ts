import { Inject, Injectable } from '@nestjs/common';
import Redis from 'ioredis';
import { REDIS_CLIENT } from './redis.provider';
import { AppConfigService } from '../../platform/app-config.service';

/**
 * Typing indicators are transient. They live in Redis with a TTL and are never
 * written to Postgres - a typing event is not a business record.
 *
 * Server-side debounce: repeated "typing" pings inside the TTL only refresh the
 * key, so a chatty client cannot amplify fan-out.
 *
 * PD-37: and a broadcast FLOOR. Stop-then-start toggling would otherwise
 * announce on every keystroke; a "started" goes out at most once per
 * BROADCAST_FLOOR_SECONDS per person per conversation.
 */
const BROADCAST_FLOOR_SECONDS = 3;

@Injectable()
export class TypingService {
  constructor(
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    private readonly config: AppConfigService,
  ) {}

  private key(threadId: string, userId: string) {
    return `typing:${threadId}:${userId}`;
  }

  private floorKey(threadId: string, userId: string) {
    return `typing:floor:${threadId}:${userId}`;
  }

  /**
   * Returns true when this is a new typing state worth broadcasting. Costs two
   * Redis round trips and never a database read, so the gateway can call it
   * before it authorizes anything.
   */
  async start(threadId: string, userId: string): Promise<boolean> {
    const ttl = await this.config.get('realtime.typing_ttl_seconds');
    const key = this.key(threadId, userId);
    const created = await this.redis.set(key, '1', 'EX', ttl, 'NX');
    if (created === null) {
      await this.redis.expire(key, ttl); // still typing: keep it alive, say nothing
      return false;
    }
    const floor = await this.redis.set(this.floorKey(threadId, userId), '1', 'EX', BROADCAST_FLOOR_SECONDS, 'NX');
    if (floor === null) {
      // Announced moments ago. Forget this start, so the next ping after the
      // floor announces instead of being taken for "still typing".
      await this.redis.del(key);
      return false;
    }
    return true;
  }

  async stop(threadId: string, userId: string): Promise<boolean> {
    const removed = await this.redis.del(this.key(threadId, userId));
    return removed > 0;
  }
}
