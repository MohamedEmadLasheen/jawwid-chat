/**
 * RT-037 media streaming: how the bytes leave, once every check has passed.
 *
 * Before: `for await (chunk of body) res.write(chunk)` ignored write()'s
 * `false`, so a slow reader made the API pull the whole object from storage
 * into the response's memory buffer (up to 100 MB per stream), and a reader
 * that left kept the storage GET running to the end. These serve a large
 * object through a real HTTP server to a real client and count how much of the
 * object the API pulled from storage.
 *
 * The authorization order (signature, liveness, authorize()) is covered by
 * test/integration/rt037-media-revocation.spec.ts; here every check passes.
 */
import { createServer, get, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { Readable } from 'node:stream';
import { serveAuthorizedMedia, type MediaServeDeps, type ResponseLike } from '@communication/api/media-serve';

jest.mock('../../../src/platform/liveness', () => ({ actorIsLive: async () => true }));

jest.setTimeout(15_000);

const CHUNK = Buffer.alloc(64 * 1024, 7);
const MB = 1024 * 1024;

/** An object in "storage" that is produced only as it is pulled, and says how much was. */
class CountingObject extends Readable {
  pulled = 0;
  closed = false;
  constructor(readonly total: number) {
    super();
    this.on('close', () => (this.closed = true));
  }
  override _read() {
    if (this.pulled >= this.total) return void this.push(null);
    this.pulled += CHUNK.length;
    this.push(CHUNK);
  }
}

/** Storage that sends `chunks` chunks and then goes silent (never ends, never errors). */
class StallingObject extends Readable {
  sent = 0;
  closed = false;
  constructor(readonly chunks: number, readonly total = 64 * 1024 * 1024) {
    super();
    this.on('close', () => (this.closed = true));
  }
  override _read() {
    if (this.sent < this.chunks) {
      this.sent++;
      this.push(CHUNK);
    } // else: nothing, ever
  }
}

/** Storage that sends one chunk every `everyMs` until `total`: slow, but never silent for long. */
class SlowObject extends Readable {
  pulled = 0;
  constructor(readonly total: number, readonly everyMs: number) {
    super();
  }
  override _read() {
    setTimeout(() => {
      if (this.pulled >= this.total) return void this.push(null);
      this.pulled += CHUNK.length;
      this.push(CHUNK);
    }, this.everyMs);
  }
}

let server: Server;
let object: CountingObject;
let served: Promise<void>;
/** What storage.read answers; by default the whole `object`. */
let read: (rangeHeader?: string | string[]) => Promise<unknown>;
let cacheControl: string | undefined;
let stallMs: number | undefined;

function deps(): MediaServeDeps {
  return {
    signer: { verify: () => true } as unknown as MediaServeDeps['signer'],
    prisma: {} as MediaServeDeps['prisma'],
    storage: { read: (_key: string, range?: string | string[]) => read(range) } as unknown as MediaServeDeps['storage'],
    stallMs,
  };
}

/** Express's two additions to a ServerResponse, which is all media-serve uses beyond the stream. */
function express(res: ServerResponse): ResponseLike {
  const r = res as ServerResponse & ResponseLike;
  r.status = (code: number) => ((res.statusCode = code), r);
  r.send = (body?: string | Buffer) => void res.end(body);
  return r;
}

beforeEach(async () => {
  read = async () => ({ mimeType: 'video/mp4', size: object.total, range: null, body: object });
  cacheControl = undefined;
  stallMs = undefined;
  server = createServer((req, res) => {
    served = serveAuthorizedMedia(
      deps(), 'attachments', 'a1', 'original', 'actor', '0', 'sig', req, express(res),
      async () => ({ objectKey: 'k' }),
      ...(cacheControl ? [cacheControl] : []),
    );
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
});
afterEach(async () => {
  server.closeAllConnections();
  await new Promise<void>((r) => server.close(() => r()));
});

function request(headers: Record<string, string> = {}): Promise<{ res: IncomingMessage; abort: () => void }> {
  return new Promise((resolve, reject) => {
    const req = get({ host: '127.0.0.1', port: (server.address() as AddressInfo).port, path: '/', headers }, (res) =>
      resolve({ res, abort: () => req.destroy() }),
    );
    req.on('error', () => {});
    req.once('error', reject);
  });
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function until(cond: () => boolean, ms = 3_000) {
  const end = Date.now() + ms;
  while (!cond() && Date.now() < end) await sleep(20);
}

it('a reader that keeps up gets every byte, 200, with the stored headers', async () => {
  object = new CountingObject(8 * MB);
  const { res } = await request();
  let received = 0;
  for await (const chunk of res) received += (chunk as Buffer).length;
  await served;
  expect(res.statusCode).toBe(200);
  expect(res.headers['content-type']).toBe('video/mp4');
  expect(res.headers['content-length']).toBe(String(8 * MB));
  expect(received).toBe(8 * MB);
});

it('a reader that stops reading: the API stops pulling from storage (memory stays bounded)', async () => {
  object = new CountingObject(256 * MB);
  const { res, abort } = await request();
  res.pause(); // reads nothing more
  await sleep(1_000);
  const pulledWhilePaused = object.pulled;
  await sleep(500);
  // Socket buffers on both sides, plus a stream highWaterMark or two -- not the object.
  expect(pulledWhilePaused).toBeLessThan(32 * MB);
  // At most a socket buffer's worth trickles on (the kernel drains a little); nothing like the object.
  expect(object.pulled - pulledWhilePaused).toBeLessThan(MB);
  abort();
  await until(() => object.closed);
});

it('a reader that leaves: the storage read is destroyed, not read to the end for nobody', async () => {
  object = new CountingObject(256 * MB);
  const { res, abort } = await request();
  await new Promise((r) => res.once('data', r));
  abort();
  await until(() => object.closed);
  expect(object.closed).toBe(true);
  expect(object.destroyed).toBe(true);
  expect(object.pulled).toBeLessThan(object.total);
  await expect(served).resolves.toBeUndefined();
});

it('storage failing mid-body ends the response instead of throwing after the status line was sent', async () => {
  object = new CountingObject(256 * MB);
  const { res } = await request();
  const ended = new Promise<string>((r) => {
    res.on('aborted', () => r('aborted'));
    res.on('error', () => r('error'));
    res.on('end', () => r('end'));
  });
  res.resume();
  await new Promise((r) => res.once('data', r));
  object.destroy(new Error('storage connection reset'));
  await expect(served).resolves.toBeUndefined();
  expect(await ended).not.toBe('end'); // incomplete: the client can tell it did not get the object
});

it('a range is served 206 with Content-Range / Content-Length of the range, and the default Cache-Control', async () => {
  object = new CountingObject(64 * 1024);
  let asked: string | string[] | undefined;
  read = async (range) => {
    asked = range;
    return { mimeType: 'video/mp4', size: 10 * MB, range: { start: 1000, end: 1000 + 64 * 1024 - 1 }, body: object };
  };
  const { res } = await request({ range: 'bytes=1000-66535' });
  let received = 0;
  for await (const chunk of res) received += (chunk as Buffer).length;
  await served;
  expect(asked).toBe('bytes=1000-66535'); // the reader's Range reaches storage as sent
  expect(res.statusCode).toBe(206);
  expect(res.headers['content-range']).toBe(`bytes 1000-${1000 + 64 * 1024 - 1}/${10 * MB}`);
  expect(res.headers['content-length']).toBe(String(64 * 1024));
  expect(res.headers['accept-ranges']).toBe('bytes');
  expect(res.headers['cache-control']).toBe('private, no-store');
  expect(res.headers['x-content-type-options']).toBe('nosniff');
  expect(received).toBe(64 * 1024);
});

it("a kind's own Cache-Control is sent as given", async () => {
  object = new CountingObject(64 * 1024);
  cacheControl = 'private, max-age=300';
  const { res } = await request();
  res.resume();
  await new Promise((r) => res.once('end', r));
  expect(res.headers['cache-control']).toBe('private, max-age=300');
});

it('a reader that leaves while storage is still answering: the storage stream is destroyed the moment it arrives', async () => {
  object = new CountingObject(256 * MB);
  let answer!: () => void;
  const storageAnswered = new Promise<void>((r) => (answer = r));
  let reached!: () => void;
  const readStarted = new Promise<void>((r) => (reached = r));
  read = async () => {
    reached();
    await storageAnswered; // HEAD/GET still in flight
    return { mimeType: 'video/mp4', size: object.total, range: null, body: object };
  };
  const port = (server.address() as AddressInfo).port;
  const req = get({ host: '127.0.0.1', port, path: '/' });
  req.on('error', () => {});
  await readStarted;
  req.destroy(); // gone before a single header was sent
  await sleep(100);
  answer();
  await until(() => object.closed);
  expect(object.destroyed).toBe(true);
  expect(object.pulled).toBeLessThan(4 * MB);
  await expect(served).resolves.toBeUndefined();
});

it('a streamed body with a response that is not a Writable is a loud wiring error, and the storage stream is released', async () => {
  object = new CountingObject(8 * MB);
  const fake = { status: () => fake, setHeader: () => {}, send: () => {}, write: () => true, end: () => {} };
  await expect(
    serveAuthorizedMedia(deps(), 'attachments', 'a1', 'original', 'actor', '0', 'sig', { headers: {} }, fake as never, async () => ({ objectKey: 'k' })),
  ).rejects.toThrow('Writable');
  await until(() => object.closed);
  expect(object.destroyed).toBe(true);
});

describe('a storage body that goes silent mid-stream (stall watchdog)', () => {
  it('while the reader is waiting for bytes: the response ends after stallMs, and the storage stream is released', async () => {
    const stalled = new StallingObject(4);
    stallMs = 300;
    read = async () => ({ mimeType: 'video/mp4', size: stalled.total, range: null, body: stalled });
    const { res } = await request();
    const ended = new Promise<string>((r) => {
      res.on('aborted', () => r('aborted'));
      res.on('error', () => r('error'));
      res.on('end', () => r('end'));
    });
    let received = 0;
    res.on('data', (c: Buffer) => (received += c.length)); // a reader that keeps reading
    const started = Date.now();
    expect(await ended).not.toBe('end');
    expect(Date.now() - started).toBeLessThan(2_000);
    expect(received).toBe(4 * CHUNK.length);
    await expect(served).resolves.toBeUndefined();
    await until(() => stalled.closed);
    expect(stalled.destroyed).toBe(true);
  });

  it('control: a READER that pauses for longer than stallMs is not cut (back-pressure is not a stall)', async () => {
    object = new CountingObject(16 * MB);
    stallMs = 300;
    const { res } = await request();
    let received = 0;
    let paused = false;
    res.on('data', (c: Buffer) => {
      received += c.length;
      if (!paused && received > MB) {
        paused = true;
        res.pause();
        setTimeout(() => res.resume(), 1_000); // the viewer paused the video
      }
    });
    await new Promise((r) => res.once('end', r));
    await served;
    expect(received).toBe(16 * MB);
  });

  it('a storage body that is slow but keeps arriving (every stallMs / 2) is not cut', async () => {
    const slow = new SlowObject(8 * CHUNK.length, 150);
    stallMs = 300;
    read = async () => ({ mimeType: 'video/mp4', size: slow.total, range: null, body: slow });
    const { res } = await request();
    let received = 0;
    for await (const chunk of res) received += (chunk as Buffer).length;
    await served;
    expect(received).toBe(8 * CHUNK.length);
  });
});
