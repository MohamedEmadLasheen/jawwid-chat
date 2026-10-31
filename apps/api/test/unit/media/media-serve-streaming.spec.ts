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

let server: Server;
let object: CountingObject;
let served: Promise<void>;

function deps(): MediaServeDeps {
  return {
    signer: { verify: () => true } as unknown as MediaServeDeps['signer'],
    prisma: {} as MediaServeDeps['prisma'],
    storage: {
      read: async () => ({ mimeType: 'video/mp4', size: object.total, range: null, body: object }),
    } as unknown as MediaServeDeps['storage'],
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
  server = createServer((req, res) => {
    served = serveAuthorizedMedia(deps(), 'attachments', 'a1', 'original', 'actor', '0', 'sig', req, express(res), async () => ({
      objectKey: 'k',
    }));
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
});
afterEach(async () => {
  server.closeAllConnections();
  await new Promise<void>((r) => server.close(() => r()));
});

function request(): Promise<{ res: IncomingMessage; abort: () => void }> {
  return new Promise((resolve, reject) => {
    const req = get({ host: '127.0.0.1', port: (server.address() as AddressInfo).port, path: '/' }, (res) =>
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
  expect(object.pulled).toBe(pulledWhilePaused);
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
