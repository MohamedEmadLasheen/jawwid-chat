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

  async lastSeen(userId: string): Promise<Date | null> {
    const v = await this.redis.get(`lastseen:${userId}`);
    return v ? new Date(Number(v)) : null;
  }
}
