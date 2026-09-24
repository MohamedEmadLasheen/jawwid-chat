import http from 'node:http';
import { randomUUID } from 'node:crypto';
import Redis from 'ioredis';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { PlatformModule } from '@platform/platform.module';
import { AuthModule } from '@platform/auth/auth.module';
import { applyInfrastructure } from '../../src/infra/http/bootstrap';
import { PrismaService } from '@platform/prisma.service';
import { AuthService } from '@platform/auth/auth.service';
import { rateLimitKey, SOURCE_MAX_ATTEMPTS } from '@platform/auth/login-rate-limit';

/**
 * The trusted-proxy configuration boundary, over REAL HTTP, behind a REAL
 * reverse proxy, with the REAL application.
 *
 * A helper-function test cannot prove this. The defect being guarded is a
 * WIRING defect: `req.ip` is produced by Express from a setting applied in
 * infra/http/bootstrap.ts, consumed by a controller constructed by Nest's DI,
 * and the bug was that those two never agreed about whether a client is
 * identifiable. So this boots the application the way main.ts does -- including
 * applyInfrastructure(), which is what sets `trust proxy` -- puts a proxy in
 * front of it that appends X-Forwarded-For exactly as a load balancer does, and
 * drives it with fetch().
 *
 * The audit demonstration this replaces: with no configuration, 31 failures
 * from one attacker at 66.66.66.66 caused an innocent user at 10.0.0.5 to be
 * refused login with a CORRECT password, because both collapsed into the
 * proxy's single source budget.
 */
const REDIS_URL = process.env.AUTH_TEST_REDIS_URL ?? process.env.REDIS_URL ?? 'redis://localhost:6410';

process.env.JWT_ACCESS_SECRET ??= 'integration-access-secret-32-chars-min!';
process.env.JWT_REFRESH_SECRET ??= 'integration-refresh-secret-32-chars-min!';
process.env.STORAGE_SIGNING_SECRET ??= 'integration-storage-secret-32-chars-ok!';
process.env.LIVEKIT_API_KEY ??= 'k';
process.env.LIVEKIT_API_SECRET ??= 'integration-livekit-secret-32-chars-ok!';
process.env.REDIS_URL = REDIS_URL;

jest.setTimeout(180_000);

const PASSWORD = 'a-trusted-proxy-password-1';
/**
 * Ephemeral ports, assigned by the kernel.
 *
 * These were fixed (34171/34172). This is the only integration suite that
 * binds a listener, and it binds one per `describe` block, so a fixed port
 * makes each setup race the previous block's socket release — reliably enough
 * on a quiet run, and not reliably at all once the suite order or the machine's
 * timing changes. The symptom is `EADDRINUSE`, which reads like a port
 * conflict with another program and is really the suite colliding with itself.
 *
 * Port 0 asks the kernel for a free port; the assigned one is read back after
 * `listen`. Nothing about what this suite tests depends on the number.
 */
let apiPort = 0;
let proxyPort = 0;

/** A load balancer: forwards, and appends the real client to X-Forwarded-For. */
function startProxy(): Promise<http.Server> {
  const proxy = http.createServer((cReq, cRes) => {
    const chunks: Buffer[] = [];
    cReq.on('data', (c: Buffer) => chunks.push(c));
    cReq.on('end', () => {
      const payload = Buffer.concat(chunks);
      const client = String(cReq.headers['x-test-client'] ?? '1.2.3.4');
      // Exactly what a real edge does: append, preserving anything already there.
      const existing = cReq.headers['x-forwarded-for'];
      const forwarded = existing ? `${String(existing)}, ${client}` : client;

      const pReq = http.request(
        {
          host: '127.0.0.1',
          port: apiPort,
          path: cReq.url,
          method: cReq.method,
          headers: {
            ...cReq.headers,
            host: `127.0.0.1:${apiPort}`,
            'x-forwarded-for': forwarded,
            'content-length': payload.length,
          },
        },
        (pRes) => {
          cRes.writeHead(pRes.statusCode ?? 502, pRes.headers);
          pRes.pipe(cRes);
        },
      );
      pReq.on('error', () => {
        cRes.writeHead(502);
        cRes.end();
      });
      pReq.end(payload);
    });
  });
  return new Promise((resolve) => proxy.listen(0, '127.0.0.1', () => resolve(proxy)));
}

interface Fixture {
  org: string;
  account: string;
  contact: string;
  subject: string;
}

describe('the trusted-proxy boundary over real HTTP', () => {
  let redis: Redis;

  beforeAll(async () => {
    redis = new Redis(REDIS_URL, { maxRetriesPerRequest: 1, lazyConnect: true });
    await redis.connect();
  });

  afterAll(async () => {
    await redis.quit();
  });

  /** Boots the app the way main.ts does, with the given topology setting. */
  async function withApi<T>(
    hops: string | undefined,
    body: (ctx: { post: (p: string, b: unknown, client: string) => Promise<{ s: number }>; fx: Fixture }) => Promise<T>,
  ): Promise<T> {
    const previous = process.env.TRUSTED_PROXY_HOPS;
    if (hops === undefined) delete process.env.TRUSTED_PROXY_HOPS;
    else process.env.TRUSTED_PROXY_HOPS = hops;

    let app: INestApplication | undefined;
    let proxy: http.Server | undefined;
    const prisma = new PrismaService();
    const fx: Fixture = {
      org: randomUUID(),
      account: randomUUID(),
      contact: randomUUID(),
      subject: `tp-${randomUUID().slice(0, 8)}`,
    };
    const staff = randomUUID();
    const family = randomUUID();

    try {
      // PlatformModule + AuthModule only. This is the REAL controller, guard,
      // limiter and Express stack; CommunicationModule is left out because its
      // socket.io/Redis-adapter and BullMQ handles do not close cleanly when an
      // app is booted and torn down seven times in one process -- and none of
      // them participate in the property under test.
      const moduleRef = await Test.createTestingModule({
        imports: [PlatformModule, AuthModule],
      }).compile();
      app = moduleRef.createNestApplication({ logger: false });
      app.setGlobalPrefix('api/v1', { exclude: ['health', 'health/live', 'health/ready'] });
      // THE LINE UNDER TEST: this is what applies `trust proxy`.
      applyInfrastructure(app);
      await app.listen(0, '127.0.0.1');
      apiPort = (app.getHttpServer().address() as { port: number }).port;
      proxy = await startProxy();
      proxyPort = (proxy.address() as { port: number }).port;

      await prisma.$connect();
      await prisma.$executeRawUnsafe(
        `insert into chat.organization (id, slug, display_name)
         values ('${fx.org}'::uuid, 'tp-${fx.org.slice(0, 8)}', 'trusted proxy test')`,
      );
      await prisma.$executeRawUnsafe(
        `insert into chat.account (id, organization_id, subject, kind, status, is_active)
         values ('${fx.account}'::uuid, '${fx.org}'::uuid, '${fx.subject}', 'family', 'active', true)`,
      );
      await prisma.$executeRawUnsafe(
        `insert into chat.staff (id, organization_id, name, role)
         values ('${staff}'::uuid, '${fx.org}'::uuid, 'o', 'manager')`,
      );
      await prisma.$executeRawUnsafe(
        `insert into chat.family (id, organization_id, display_name, owner_id, language)
         values ('${family}'::uuid, '${fx.org}'::uuid, 'f', '${staff}'::uuid, 'ar')`,
      );
      await prisma.$executeRawUnsafe(
        `insert into chat.contact
           (id, organization_id, family_id, name, role_preset, can_message, account_id)
         values ('${fx.contact}'::uuid, '${fx.org}'::uuid, '${family}'::uuid, 'p',
                 'primary_guardian', true, '${fx.account}'::uuid)`,
      );
      await app.get(AuthService).setPassword(fx.account, PASSWORD);

      const post = async (path: string, payload: unknown, client: string) => {
        const r = await fetch(`http://127.0.0.1:${proxyPort}/api/v1${path}`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-test-client': client },
          body: JSON.stringify(payload),
        });
        return { s: r.status };
      };

      return await body({ post, fx });
    } finally {
      if (proxy) {
        // fetch() keeps connections alive, and close() waits for them. Without
        // this the server handle outlives the test and jest never exits.
        proxy.closeAllConnections();
        await new Promise<void>((resolve) => proxy!.close(() => resolve()));
      }
      if (app) await app.close();
      for (const t of ['session', 'device', 'contact', 'family', 'staff']) {
        await prisma.$executeRawUnsafe(`delete from chat.${t} where organization_id = '${fx.org}'::uuid`);
      }
      await prisma.$executeRawUnsafe(`delete from chat.account_credential where account_id = '${fx.account}'::uuid`);
      await prisma.$executeRawUnsafe(`delete from chat.account where organization_id = '${fx.org}'::uuid`);
      await prisma.$executeRawUnsafe(`delete from chat.organization where id = '${fx.org}'::uuid`);
      await prisma.$disconnect();
      if (previous === undefined) delete process.env.TRUSTED_PROXY_HOPS;
      else process.env.TRUSTED_PROXY_HOPS = previous;
    }
  }

  // -------------------------------------------------------------------------
  // OFF by default
  // -------------------------------------------------------------------------

  it('UNCONFIGURED: an attacker cannot lock out an innocent user', async () => {
    await withApi(undefined, async ({ post, fx }) => {
      // Far more than SOURCE_MAX_ATTEMPTS, from one attacker, through the proxy.
      for (let i = 0; i < SOURCE_MAX_ATTEMPTS + 15; i++) {
        await post('/auth/login', { username: `nobody-${randomUUID()}`, password: 'x' }, '66.66.66.66');
      }

      // The innocent user, correct password, a different client address.
      // Before the fix this was 429: both collapsed into the proxy's budget.
      const victim = await post('/auth/login', { username: fx.subject, password: PASSWORD }, '10.0.0.5');
      expect(victim.s).toBe(200);
    });
  });

  it('UNCONFIGURED: no source budget is charged at all', async () => {
    await withApi(undefined, async ({ post }) => {
      const before = await redis.keys('ratelimit:login:ip:*');
      for (let i = 0; i < 5; i++) {
        await post('/auth/login', { username: `nobody-${randomUUID()}`, password: 'x' }, '66.66.66.66');
      }
      const after = await redis.keys('ratelimit:login:ip:*');

      // Not "a different key" -- NO key. The proxy's address never becomes a
      // budget, because no source budget exists while this is unconfigured.
      expect(after.length).toBe(before.length);
    });
  });

  it('UNCONFIGURED: the per-account limiter is still fully enforced', async () => {
    await withApi(undefined, async ({ post, fx }) => {
      const statuses: number[] = [];
      for (let i = 0; i < 14; i++) {
        statuses.push((await post('/auth/login', { username: fx.subject, password: `no-${i}` }, '10.0.0.9')).s);
      }

      // Disabling the SOURCE dimension must not disable the IDENTIFIER one.
      expect(statuses.filter((s) => s === 429).length).toBeGreaterThan(0);
      expect(statuses.filter((s) => s === 401).length).toBeLessThanOrEqual(10);

      await redis.del(rateLimitKey('id', fx.subject));
    });
  });

  it('UNCONFIGURED: a forged X-Forwarded-For is not trusted merely by existing', async () => {
    await withApi(undefined, async ({ post, fx }) => {
      // The proxy appends the caller's forged value, so the header reaching the
      // app literally contains 9.9.9.9. It must still change nothing.
      const before = await redis.keys('ratelimit:login:ip:*');
      for (let i = 0; i < 5; i++) {
        await post('/auth/login', { username: `nobody-${randomUUID()}`, password: 'x' }, '9.9.9.9');
      }
      expect((await redis.keys('ratelimit:login:ip:*')).length).toBe(before.length);

      // And a legitimate login is unaffected by the forgery.
      expect((await post('/auth/login', { username: fx.subject, password: PASSWORD }, '9.9.9.9')).s).toBe(200);
    });
  });

  // -------------------------------------------------------------------------
  // ON when the topology is stated
  // -------------------------------------------------------------------------

  it('CONFIGURED (1 hop): two real clients get two distinct budgets', async () => {
    await withApi('1', async ({ post, fx }) => {
      const attacker = '66.66.66.77';
      const innocent = '10.0.0.6';

      for (let i = 0; i < SOURCE_MAX_ATTEMPTS + 5; i++) {
        await post('/auth/login', { username: `nobody-${randomUUID()}`, password: 'x' }, attacker);
      }

      // The attacker is stopped by the SOURCE budget...
      const blocked = await post('/auth/login', { username: `nobody-${randomUUID()}`, password: 'x' }, attacker);
      expect(blocked.s).toBe(429);

      // ...and the innocent user, on a different address, is not.
      expect((await post('/auth/login', { username: fx.subject, password: PASSWORD }, innocent)).s).toBe(200);

      // Two distinct Redis budgets really exist, keyed by the derived client
      // addresses -- not one shared proxy budget.
      expect(await redis.exists(rateLimitKey('ip', attacker))).toBe(1);
      expect(await redis.exists(rateLimitKey('ip', innocent))).toBe(1);

      await redis.del(rateLimitKey('ip', attacker), rateLimitKey('ip', innocent), rateLimitKey('id', fx.subject));
    });
  });

  it('CONFIGURED (1 hop): a client cannot impersonate another by prepending X-Forwarded-For', async () => {
    await withApi('1', async ({ post }) => {
      const victim = '10.0.0.77';
      const attacker = '66.66.66.88';

      // The attacker sends its own X-Forwarded-For claiming to be the victim.
      // The proxy appends the attacker's real address, so the header is
      // "10.0.0.77, 66.66.66.88" -- and trust proxy = 1 takes the LAST entry.
      for (let i = 0; i < 5; i++) {
        await fetch(`http://127.0.0.1:${proxyPort}/api/v1/auth/login`, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-test-client': attacker,
            'x-forwarded-for': victim, // forged, arrives leftmost
          },
          body: JSON.stringify({ username: `nobody-${randomUUID()}`, password: 'x' }),
        });
      }

      // The attacker's own budget was charged; the victim's was not touched.
      expect(await redis.exists(rateLimitKey('ip', attacker))).toBe(1);
      expect(await redis.exists(rateLimitKey('ip', victim))).toBe(0);

      await redis.del(rateLimitKey('ip', attacker));
    });
  });

  it('CONFIGURED (1 hop): success releases ONLY the identifier budget', async () => {
    await withApi('1', async ({ post, fx }) => {
      const client = '10.0.0.123';

      await post('/auth/login', { username: fx.subject, password: 'wrong' }, client);
      expect(await redis.exists(rateLimitKey('id', fx.subject))).toBe(1);
      const sourceBefore = Number(await redis.get(rateLimitKey('ip', client)));

      expect((await post('/auth/login', { username: fx.subject, password: PASSWORD }, client)).s).toBe(200);

      // identifier released...
      expect(await redis.exists(rateLimitKey('id', fx.subject))).toBe(0);
      // ...source NOT released, and charged for the successful attempt too.
      expect(Number(await redis.get(rateLimitKey('ip', client)))).toBe(sourceBefore + 1);

      await redis.del(rateLimitKey('ip', client));
    });
  });

  it('CONFIGURED (0 hops): the socket peer is the client, and nothing is read from a header', async () => {
    await withApi('0', async ({ post, fx }) => {
      // Everything arrives from 127.0.0.1 (the proxy), and with hops=0 that IS
      // the declared client. A forged header must not override it.
      for (let i = 0; i < 3; i++) {
        await post('/auth/login', { username: `nobody-${randomUUID()}`, password: 'x' }, '9.9.9.9');
      }

      expect(await redis.exists(rateLimitKey('ip', '9.9.9.9'))).toBe(0);
      const loopback = await redis.keys('ratelimit:login:ip:*');
      expect(loopback.length).toBeGreaterThan(0);

      await redis.del(...loopback, rateLimitKey('id', fx.subject));
    });
  });
});
