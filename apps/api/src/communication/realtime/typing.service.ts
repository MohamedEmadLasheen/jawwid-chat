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
 */
@Injectable()
export class TypingService {
  constructor(
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    private readonly config: AppConfigService,
  ) {}

  private key(threadId: string, userId: string) {
    return `typing:${threadId}:${userId}`;
  }

  /** Returns true when this is a new typing state worth broadcasting. */
  async start(threadId: string, userId: string): Promise<boolean> {
    const ttl = await this.config.get('realtime.typing_ttl_seconds');
    const key = this.key(threadId, userId);
    const existed = await this.redis.exists(key);
    await this.redis.set(key, '1', 'EX', ttl);
    return existed === 0;
  }

  async stop(threadId: string, userId: string): Promise<boolean> {
    const removed = await this.redis.del(this.key(threadId, userId));
    return removed > 0;
  }

  async whoIsTyping(threadId: string): Promise<string[]> {
    const keys = await this.redis.keys(`typing:${threadId}:*`);
    return keys.map((k) => k.split(':')[2]);
  }
}
