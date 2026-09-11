import { Logger, Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import Redis from 'ioredis';
import { AuthService } from './auth.service';
import { AuthenticatedGuard } from './auth.guard';
import { AuthController, MeController } from './auth.controller';
import { AuthErrorFilter } from './auth.errors';
import { LoginRateLimiter, RATE_LIMIT_STORE, type RateLimitStore } from './login-rate-limit';

/**
 * Runtime authentication (PR-B).
 *
 * The guard is registered as APP_GUARD, which is the whole security posture in
 * one line: every route in every module is protected unless it declares
 * `@Public()`. Registering it per-controller would leave the next controller
 * somebody adds unauthenticated, and "remember to add the guard" is not a
 * control.
 *
 * PlatformModule is @Global, so PrismaService, IDENTITY_SERVICE and
 * AUDIT_SERVICE are available here without an import cycle.
 */

/**
 * The login limiter's Redis connection.
 *
 * Its own client rather than the one in `communication/realtime/redis.provider`
 * because platform must not import communication -- the dependency runs the
 * other way.
 *
 * OPTIONS, AND WHY EACH ONE:
 *
 *   lazyConnect            a unit test that never logs in never opens a socket.
 *   enableOfflineQueue     TRUE, and this matters. With lazyConnect the FIRST
 *                          command is what establishes the connection; with the
 *                          offline queue disabled that command is rejected
 *                          before the connection is ready, so the limiter fails
 *                          closed and the very first login after every boot is
 *                          refused. A live HTTP test caught exactly that. The
 *                          queue lets the first command wait for the handshake
 *                          it triggered.
 *   maxRetriesPerRequest   1, so a genuinely dead server still fails FAST
 *                          rather than buffering forever -- which is what keeps
 *                          the fail-closed behaviour honest instead of turning
 *                          it into a hang.
 *
 * An error listener is mandatory: an unhandled ioredis 'error' event terminates
 * the process, and a Redis blip must not take the API down.
 */
export const loginRateLimitStoreProvider = {
  provide: RATE_LIMIT_STORE,
  useFactory: (): RateLimitStore | undefined => {
    const url = process.env.REDIS_URL;
    if (!url) {
      // REDIS_URL is `req` in local, staging and production
      // (infra/env/manifest.tsv). Absent means a misconfigured deployment, and
      // the limiter treats a missing store as "refuse", never as "allow".
      new Logger('LoginRateLimiter').error(
        'REDIS_URL is not set; login rate limiting has no store and will refuse logins',
      );
      return undefined;
    }
    const client = new Redis(url, {
      lazyConnect: true,
      maxRetriesPerRequest: 1,
      enableOfflineQueue: true,
    });
    client.on('error', (e: Error) =>
      // Never the message: an ioredis error can embed the connection string.
      new Logger('LoginRateLimiter').debug(`redis: ${e.name}`),
    );
    return client;
  },
};

@Module({
  controllers: [AuthController, MeController],
  providers: [
    AuthService,
    LoginRateLimiter,
    loginRateLimitStoreProvider,
    { provide: APP_GUARD, useClass: AuthenticatedGuard },
    { provide: APP_FILTER, useClass: AuthErrorFilter },
  ],
  exports: [AuthService, LoginRateLimiter],
})
export class AuthModule {}
