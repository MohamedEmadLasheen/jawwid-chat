import { Provider } from '@nestjs/common';
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
