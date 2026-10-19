import { Inject, Injectable, OnApplicationShutdown, Provider } from '@nestjs/common';
import Redis from 'ioredis';

export const REDIS_CLIENT = Symbol('RedisClient');

/**
 * Single shared Redis connection for ephemeral state (typing, presence).
 * lazyConnect keeps unit tests from opening a socket they never use.
 */
export const redisProvider: Provider = {
  provide: REDIS_CLIENT,
  useFactory: (): Redis =>
    new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379', {
      lazyConnect: true,
      maxRetriesPerRequest: null,
      enableOfflineQueue: true,
    }),
};

/**
 * Closes that connection when the application shuts down. A factory provider
 * has no lifecycle of its own, so without this the open socket outlived
 * `app.close()` and kept the process (or a test run) alive. It runs at
 * application shutdown -- after every module's onModuleDestroy, so the gateway
 * has finished with presence first. A client that never connected (lazy) has
 * nothing to say goodbye to and is just disconnected.
 */
@Injectable()
export class RedisClientShutdown implements OnApplicationShutdown {
  constructor(@Inject(REDIS_CLIENT) private readonly client: Redis) {}

  async onApplicationShutdown(): Promise<void> {
    if (this.client.status === 'wait' || this.client.status === 'end') {
      this.client.disconnect();
      return;
    }
    await this.client.quit().catch(() => this.client.disconnect());
  }
}
