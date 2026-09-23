import { Inject, Injectable } from '@nestjs/common';
import Redis from 'ioredis';
import { REDIS_CLIENT } from './redis.provider';
import { AppConfigService } from '../../platform/app-config.service';

/**
 * Lightweight presence. Deliberately not a business record: it is a TTL key per
 * connection, so a crashed process expires on its own.
 *
 * A user may hold several connections (multi-device); presence is the union.
 */
@Injectable()
export class PresenceService {
  constructor(
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    private readonly config: AppConfigService,
  ) {}

  private key(userId: string, connectionId: string) {
    return `presence:${userId}:${connectionId}`;
  }

  async online(userId: string, connectionId: string): Promise<void> {
    const ttl = await this.config.get('realtime.presence_ttl_seconds');
    await this.redis.set(this.key(userId, connectionId), Date.now().toString(), 'EX', ttl);
    await this.redis.set(`lastseen:${userId}`, Date.now().toString());
  }

  async heartbeat(userId: string, connectionId: string): Promise<void> {
    await this.online(userId, connectionId);
  }

  async offline(userId: string, connectionId: string): Promise<void> {
    await this.redis.del(this.key(userId, connectionId));
    await this.redis.set(`lastseen:${userId}`, Date.now().toString());
  }

  async isOnline(userId: string): Promise<boolean> {
    const keys = await this.redis.keys(`presence:${userId}:*`);
    return keys.length > 0;
  }

  // -- Which conversation someone is looking at --------------------------------
  //
  // The notification engine needs this to answer one question: should a message
  // arriving in a thread the parent is currently reading also buzz their phone?
  // It should not -- the message is already on screen -- and a push that fires
  // anyway is the single most common way a chat product feels noisy.
  //
  // Held in Redis with the same TTL as presence, for the same reason: a crashed
  // process must not leave someone permanently "viewing" a thread and silently
  // suppress their pushes forever. It expires on its own.

  private viewKey(userId: string, connectionId: string) {
    return `viewing:${userId}:${connectionId}`;
  }

  async enterConversation(
    userId: string,
    conversationId: string,
    connectionId: string,
  ): Promise<void> {
    const ttl = await this.config.get('realtime.presence_ttl_seconds');
    await this.redis.set(this.viewKey(userId, connectionId), conversationId, 'EX', ttl);
  }

  async leaveConversation(userId: string, connectionId: string): Promise<void> {
    await this.redis.del(this.viewKey(userId, connectionId));
  }

  /**
   * Is this person looking at this thread on ANY of their devices?
   *
   * Any, not all: someone reading on their laptop does not need their phone to
   * buzz about the message in front of them. The in-app notification and the
   * unread badge still happen on every device; only the push is suppressed, and
   * the suppression is recorded as a delivery with skip_reason RECIPIENT_ACTIVE
   * rather than silently dropped.
   */
  async isViewing(userId: string, conversationId: string): Promise<boolean> {
    const keys = await this.redis.keys(`viewing:${userId}:*`);
    if (keys.length === 0) return false;
    const values = await this.redis.mget(keys);
    return values.some((v) => v === conversationId);
  }

  async lastSeen(userId: string): Promise<Date | null> {
    const v = await this.redis.get(`lastseen:${userId}`);
    return v ? new Date(Number(v)) : null;
  }
}
