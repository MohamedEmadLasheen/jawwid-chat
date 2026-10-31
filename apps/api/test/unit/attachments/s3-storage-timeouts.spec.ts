import { createServer as createHttpServer, type Server as HttpServer } from 'node:http';
import { createServer as createTcpServer, type Server as TcpServer, type Socket } from 'node:net';
import type { AddressInfo } from 'node:net';
import {
  buildObjectKey,
  S3ObjectStorage,
  STORAGE_TIMEOUT_DEFAULTS,
  type S3StorageConfig,
} from '@communication/attachments/s3-object-storage';
import { readS3Config } from '@communication/attachments/storage.provider';

/**
 * A storage endpoint that hangs must cost a request seconds, not minutes.
 *
 * Before: S3Client had no connect or response timeout, so a call to an
 * endpoint that accepted the connection and never answered waited until the
 * operating system gave up (minutes), three attempts over. These run the real
 * SDK against loopback servers that misbehave on purpose: one that never
 * answers, one that stalls mid-body, and one that answers normally.
 */
jest.setTimeout(10_000);

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
const close = (s: TcpServer | HttpServer) => new Promise<void>((r) => s.close(() => r()));

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
      const error = await storage.exists(KEY).then(() => null, (e: Error) => e);
      expect(error?.message).toMatch(/timeout|timed out/i);
      expect(error?.message).toMatch(/200 ms/);
    } finally {
      storage.destroy();
    }
  });
});

describe('a storage endpoint that stalls in the middle of the body', () => {
  let server: HttpServer;
  const held: Array<() => void> = [];

  beforeAll(async () => {
    server = await listen(createHttpServer((req, res) => {
      res.writeHead(200, { 'content-type': 'video/mp4', 'content-length': '1000' });
      if (req.method === 'HEAD') return res.end();
      res.write(Buffer.alloc(10)); // 10 of 1000 bytes, then nothing
      held.push(() => res.destroy());
    }));
  });
  afterAll(async () => {
    held.forEach((f) => f());
    await close(server);
  });

  it('the streamed read errors after requestTimeoutMs of silence instead of hanging', async () => {
    const storage = storageAt(port(server), { requestTimeoutMs: 400, maxAttempts: 1 });
    try {
      const got = await storage.read(KEY);
      if (!got || got === 'unsatisfiable') throw new Error('expected a body');
      const started = Date.now();
      let received = 0;
      const drain = (async () => {
        for await (const chunk of got.body as AsyncIterable<Uint8Array>) received += chunk.length;
      })();
      await expect(drain).rejects.toBeDefined();
      expect(received).toBe(10);
      expect(Date.now() - started).toBeLessThan(3_000);
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

  it('defaults: 3 s connect, 15 s response / idle, 2 attempts', () => {
    expect(STORAGE_TIMEOUT_DEFAULTS).toEqual({ connectTimeoutMs: 3_000, requestTimeoutMs: 15_000, maxAttempts: 2 });
    expect(readS3Config(base)).toMatchObject(STORAGE_TIMEOUT_DEFAULTS);
  });

  it('each is overridable by its variable', () => {
    expect(readS3Config({
      ...base,
      STORAGE_CONNECT_TIMEOUT_MS: '1500',
      STORAGE_REQUEST_TIMEOUT_MS: '45000',
      STORAGE_MAX_ATTEMPTS: '3',
    })).toMatchObject({ connectTimeoutMs: 1500, requestTimeoutMs: 45_000, maxAttempts: 3 });
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
