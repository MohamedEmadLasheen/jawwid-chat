import { INestApplicationContext, Logger } from '@nestjs/common';
import { IoAdapter } from '@nestjs/platform-socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import Redis from 'ioredis';
import type { ServerOptions } from 'socket.io';
import { parseOrigins } from '../http/bootstrap';

/**
 * Socket.IO adapter carrying the two deployment concerns the gateway itself
 * should not have to know about. Owner: AI #7 (infrastructure).
 *
 * 1. CORS. The gateway declares `cors: { origin: false }`, which is the correct
 *    default -- it refuses every browser origin until someone decides which are
 *    allowed. That decision is environment configuration, not application code,
 *    so it is applied here from CORS_ALLOWED_ORIGINS. Same allowlist as HTTP.
 *
 * 2. Redis fan-out. With more than one API instance, a client connected to
 *    instance A must receive events published by instance B. Without this,
 *    scaling past one replica silently delivers events to a subset of clients,
 *    which looks like intermittent message loss rather than a scaling bug.
 */
export class InfraIoAdapter extends IoAdapter {
  private readonly log = new Logger(InfraIoAdapter.name);
  private redisAdapter?: ReturnType<typeof createAdapter>;
  private clients: Redis[] = [];

  constructor(app: INestApplicationContext) {
    super(app);
  }

  /**
   * Must be awaited before the app listens, or the first connections are
   * established without cross-instance fan-out.
   */
  async connectToRedis(url: string | undefined): Promise<void> {
    if (!url) {
      this.log.warn(
        'REDIS_URL is not set: realtime runs single-instance only. ' +
          'Running more than one API replica in this state drops events.',
      );
      return;
    }
    const pub = new Redis(url, { maxRetriesPerRequest: null });
    const sub = pub.duplicate();
    // ioredis throws on an unhandled 'error' event, which would take the whole
    // API down because Redis blinked. Realtime degrades; it must not crash.
    pub.on('error', (e) => this.log.error(`redis pub: ${e.name}`));
    sub.on('error', (e) => this.log.error(`redis sub: ${e.name}`));
    this.clients = [pub, sub];
    this.redisAdapter = createAdapter(pub, sub);
    this.log.log('realtime fan-out via Redis is active');
  }

  createIOServer(port: number, options?: ServerOptions): unknown {
    const allowed = parseOrigins(process.env.CORS_ALLOWED_ORIGINS);
    const server = super.createIOServer(port, {
      ...options,
      cors: {
        // Same rule as HTTP: an unlisted origin is refused rather than
        // reflected. No wildcard -- these sockets carry authenticated sessions.
        origin: allowed.length > 0 ? allowed : false,
        credentials: true,
      },
    } as ServerOptions);

    if (this.redisAdapter) {
      (server as { adapter: (a: unknown) => void }).adapter(this.redisAdapter);
    }
    return server;
  }

  async closeRedis(): Promise<void> {
    await Promise.all(this.clients.map((c) => c.quit().catch(() => undefined)));
  }
}
