import { createServer as createHttpServer, type Server as HttpServer } from 'node:http';
import { createServer as createTcpServer, type Server as TcpServer, type Socket } from 'node:net';
import type { AddressInfo } from 'node:net';
import {
  buildObjectKey,
  S3ObjectStorage,
  STORAGE_COPY_REQUEST_TIMEOUT_MS,
  STORAGE_TIMEOUT_DEFAULTS,
  type S3StorageConfig,
} from '@communication/attachments/s3-object-storage';
import { readS3Config } from '@communication/attachments/storage.provider';

/**
 * A storage endpoint that hangs must cost a request seconds, not minutes --
 * without cutting a body that a slow reader is legitimately pacing.
 *
 * Before: S3Client had no connect or response timeout, so a call to an
 * endpoint that accepted the connection and never answered waited until the
 * operating system gave up (minutes). These run the real SDK against
 * misbehaving servers.
 *
 * I/O note: unlike most of the unit project, this binds LOOPBACK sockets
 * (127.0.0.1, ephemeral ports) -- no external service, no credentials, no
 * container; the same exception as test/unit/infra/cors.spec.ts. Timing is
 * scaled down (hundreds of ms) so the suite stays fast; the defaults
 * themselves are asserted in "configuration".
 */
jest.setTimeout(15_000);

const KEY = buildObjectKey('conversations/0b9a3a5e-3f1e-4a47-9a2a-2b0e7c1d1f11');

function storageAt(port: number, overrides: Partial<S3StorageConfig> = {}): S3ObjectStorage {
  return new S3ObjectStorage({
    endpoint: `http://127.0.0.1:${port}`,
    region: 'auto',
    bucket: 'test-bucket',
    accessKeyId: 'test-access-key',
    secretAccessKey: 'test-secret-key',
    signedUrlTtlSeconds: 300,
    ...overrides,
  });
}

const port = (s: TcpServer | HttpServer) => (s.address() as AddressInfo).port;
const listen = <T extends TcpServer | HttpServer>(s: T) => new Promise<T>((r) => s.listen(0, '127.0.0.1', () => r(s)));
const close = (s: TcpServer | HttpServer) => {
  if ('closeAllConnections' in s) s.closeAllConnections();
  return new Promise<void>((r) => s.close(() => r()));
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const errorOf = (p: Promise<unknown>) => p.then(() => null, (e: Error) => e);

describe('a storage endpoint that accepts the connection and never answers', () => {
  let server: TcpServer;
  let sockets: Socket[];
  let connections: number;

  beforeEach(async () => {
    sockets = [];
    connections = 0;
    server = await listen(createTcpServer((socket) => {
      connections++;
      sockets.push(socket); // read nothing, write nothing
    }));
  });
  afterEach(async () => {
    sockets.forEach((s) => s.destroy());
    await close(server);
  });

  it('fails with a TimeoutError after requestTimeoutMs per attempt, maxAttempts times', async () => {
    const storage = storageAt(port(server), { requestTimeoutMs: 300, maxAttempts: 2 });
    const started = Date.now();
    try {
      await expect(storage.exists(KEY)).rejects.toMatchObject({ name: 'TimeoutError' });
      const elapsed = Date.now() - started;
      expect(elapsed).toBeGreaterThanOrEqual(2 * 300 - 50);
      expect(elapsed).toBeLessThan(3_000);
      expect(connections).toBe(2);
    } finally {
      storage.destroy();
    }
  });

  it('the error says what timed out', async () => {
    const storage = storageAt(port(server), { requestTimeoutMs: 200, maxAttempts: 1 });
    try {
      const error = await errorOf(storage.exists(KEY));
      expect(error?.message).toMatch(/timeout|timed out/i);
      expect(error?.message).toMatch(/200 ms/);
    } finally {
      storage.destroy();
    }
  });
});

describe('read(): the HEAD and the GET share one budget', () => {
  let server: HttpServer;
  const held: Array<() => void> = [];
  let mode: 'head-slow-get-hangs' | 'slow-body' = 'head-slow-get-hangs';

  beforeAll(async () => {
    server = await listen(createHttpServer((req, res) => {
      if (mode === 'head-slow-get-hangs') {
        if (req.method === 'HEAD') {
          // Just inside the per-attempt limit, so only a shared budget catches the pair.
          setTimeout(() => {
            res.writeHead(200, { 'content-type': 'video/mp4', 'content-length': '1000' });
            res.end();
          }, 250);
          return;
        }
        held.push(() => res.destroy()); // the GET never answers
        return;
      }
      // slow-body: headers at once, then the body trickles in over ~1.5 s.
      res.writeHead(200, { 'content-type': 'video/mp4', 'content-length': '1000' });
      if (req.method === 'HEAD') return res.end();
      let sent = 0;
      const tick = setInterval(() => {
        res.write(Buffer.alloc(100));
        if ((sent += 100) >= 1000) {
          clearInterval(tick);
          res.end();
        }
      }, 150);
      held.push(() => clearInterval(tick));
    }));
  });
  afterAll(async () => {
    held.forEach((f) => f());
    await close(server);
  });

  it('a hung GET after a slow HEAD fails within requestTimeoutMs x maxAttempts for the pair', async () => {
    mode = 'head-slow-get-hangs';
    const storage = storageAt(port(server), { requestTimeoutMs: 300, maxAttempts: 2 }); // budget 600 ms
    const started = Date.now();
    try {
      const error = await errorOf(storage.read(KEY));
      expect(error?.name).toBe('TimeoutError');
      expect(error?.message).toContain('no answer to a read within 600 ms');
      expect(Date.now() - started).toBeLessThan(900); // the per-call limits alone allow 250 + 2 x 300 + backoff
    } finally {
      storage.destroy();
    }
  });

  it('the budget ends with the headers: a body slower than the budget still arrives whole', async () => {
    mode = 'slow-body';
    const storage = storageAt(port(server), { requestTimeoutMs: 300, maxAttempts: 2 }); // budget 600 ms, body ~1.5 s
    try {
      const got = await storage.read(KEY);
      if (!got || got === 'unsatisfiable') throw new Error('expected a body');
      let received = 0;
      for await (const chunk of got.body as AsyncIterable<Uint8Array>) received += chunk.length;
      expect(received).toBe(1000);
    } finally {
      storage.destroy();
    }
  });
});

describe('a slow READER pacing a large streamed body', () => {
  let server: HttpServer;
  const TOTAL = 64 * 1024 * 1024;

  beforeAll(async () => {
    server = await listen(createHttpServer((req, res) => {
      res.writeHead(200, { 'content-type': 'video/mp4', 'content-length': String(TOTAL) });
      if (req.method === 'HEAD') return res.end();
      const chunk = Buffer.alloc(64 * 1024);
      let sent = 0;
      const pump = () => {
        while (sent < TOTAL) {
          sent += chunk.length;
          if (!res.write(chunk)) return void res.once('drain', pump);
        }
        res.end();
      };
      pump();
    }));
  });
  afterAll(() => close(server));

  it('is not cut when it pauses longer than requestTimeoutMs (no socket idle timeout)', async () => {
    const storage = storageAt(port(server), { requestTimeoutMs: 300, maxAttempts: 1 });
    try {
      const got = await storage.read(KEY);
      if (!got || got === 'unsatisfiable') throw new Error('expected a body');
      let received = 0;
      let paused = false;
      for await (const chunk of got.body as AsyncIterable<Uint8Array>) {
        received += chunk.length;
        if (!paused && received > 1024 * 1024) {
          paused = true;
          await sleep(1_000); // the viewer paused the video: buffers fill, the socket goes idle
        }
      }
      expect(received).toBe(TOTAL);
    } finally {
      storage.destroy();
    }
  });
});

describe('CopyObject gets its own, longer response limit', () => {
  let server: HttpServer;
  beforeAll(async () => {
    server = await listen(createHttpServer((req, res) => {
      // Storage copies before it answers: headers after 500 ms.
      setTimeout(() => {
        if (req.method === 'PUT') {
          res.writeHead(200, { 'content-type': 'application/xml' });
          res.end('<?xml version="1.0" encoding="UTF-8"?><CopyObjectResult><ETag>"e"</ETag></CopyObjectResult>');
          return;
        }
        res.writeHead(200, { 'content-type': 'image/png', 'content-length': '3' });
        res.end();
      }, 500);
    }));
  });
  afterAll(() => close(server));

  it(`a copy slower than requestTimeoutMs succeeds (copy limit ${STORAGE_COPY_REQUEST_TIMEOUT_MS} ms); a HEAD as slow does not`, async () => {
    const storage = storageAt(port(server), { requestTimeoutMs: 200, maxAttempts: 1 });
    try {
      await expect(storage.copy(KEY, buildObjectKey('conversations/0b9a3a5e-3f1e-4a47-9a2a-2b0e7c1d1f11'))).resolves.toBe(true);
      await expect(storage.exists(KEY)).rejects.toMatchObject({ name: 'TimeoutError' }); // control
    } finally {
      storage.destroy();
    }
  });
});

describe('throttling keeps the SDK retries', () => {
  let server: HttpServer;
  let requests = 0;
  beforeAll(async () => {
    server = await listen(createHttpServer((_req, res) => {
      if (++requests <= 2) {
        res.writeHead(503, { 'content-type': 'application/xml' });
        return res.end('<?xml version="1.0" encoding="UTF-8"?><Error><Code>SlowDown</Code><Message>Please reduce your request rate.</Message></Error>');
      }
      res.writeHead(200, { 'content-type': 'image/png', 'content-length': '3' });
      res.end();
    }));
  });
  afterAll(() => close(server));

  it('a 503 SlowDown twice, then success: the default 3 attempts carry it', async () => {
    const storage = storageAt(port(server)); // defaults
    try {
      await expect(storage.exists(KEY)).resolves.toBe(true);
      expect(requests).toBe(3);
    } finally {
      storage.destroy();
    }
  });
});

describe('a storage endpoint that answers', () => {
  let server: HttpServer;
  beforeAll(async () => {
    server = await listen(createHttpServer((_req, res) => {
      res.writeHead(200, { 'content-type': 'image/png', 'content-length': '3' });
      res.end();
    }));
  });
  afterAll(() => close(server));

  it('is unaffected: the call succeeds on the first attempt', async () => {
    const storage = storageAt(port(server), { requestTimeoutMs: 300, maxAttempts: 1 });
    try {
      await expect(storage.exists(KEY)).resolves.toBe(true);
    } finally {
      storage.destroy();
    }
  });
});

describe('configuration', () => {
  const base: NodeJS.ProcessEnv = {
    STORAGE_ENDPOINT: 'http://storage.invalid:9000',
    STORAGE_REGION: 'auto',
    STORAGE_BUCKET: 'test-bucket',
    STORAGE_ACCESS_KEY: 'test-access-key',
    STORAGE_SECRET_KEY: 'test-secret-key',
  };

  it('defaults: 3 s connect, 5 s to response headers, 3 attempts (~15 s per call and per read)', () => {
    expect(STORAGE_TIMEOUT_DEFAULTS).toEqual({ connectTimeoutMs: 3_000, requestTimeoutMs: 5_000, maxAttempts: 3 });
    expect(STORAGE_TIMEOUT_DEFAULTS.requestTimeoutMs * STORAGE_TIMEOUT_DEFAULTS.maxAttempts).toBeLessThan(30_000);
    expect(readS3Config(base)).toMatchObject(STORAGE_TIMEOUT_DEFAULTS);
  });

  it('each is overridable by its variable', () => {
    expect(readS3Config({
      ...base,
      STORAGE_CONNECT_TIMEOUT_MS: '1500',
      STORAGE_REQUEST_TIMEOUT_MS: '45000',
      STORAGE_MAX_ATTEMPTS: '2',
    })).toMatchObject({ connectTimeoutMs: 1500, requestTimeoutMs: 45_000, maxAttempts: 2 });
  });

  it.each([
    ['STORAGE_CONNECT_TIMEOUT_MS', '0'],
    ['STORAGE_CONNECT_TIMEOUT_MS', 'soon'],
    ['STORAGE_REQUEST_TIMEOUT_MS', '-1'],
    ['STORAGE_REQUEST_TIMEOUT_MS', '1.5'],
    ['STORAGE_MAX_ATTEMPTS', '0'],
    ['STORAGE_MAX_ATTEMPTS', '10'],
  ])('refuses %s=%s at startup', (name, value) => {
    expect(() => readS3Config({ ...base, [name]: value })).toThrow(name);
  });

  it('the client is built with them (a storage built without them uses the defaults)', async () => {
    const storage = storageAt(1);
    try {
      const config = (storage as unknown as { client: { config: { maxAttempts: () => Promise<number> } } }).client.config;
      expect(await config.maxAttempts()).toBe(STORAGE_TIMEOUT_DEFAULTS.maxAttempts);
    } finally {
      storage.destroy();
    }
  });
});
