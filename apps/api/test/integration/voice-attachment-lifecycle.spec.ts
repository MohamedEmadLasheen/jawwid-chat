/**
 * A voice note, all the way through, against the real database.
 *
 * Authorization and the storage round trip are each already covered --
 * `attachment-authorization.spec.ts` for who may spend storage, and the unit
 * suites `voice-storage.spec.ts` and `red-team/storage-and-integrity-attacks.spec.ts`
 * for signatures, MIME and size binding, ranges, traversal and expiry. What
 * nothing covered is the join between them: that the key an authorization mints
 * is the key the bytes land under, is the key the message persists, is the key
 * the read path signs, and that fetching through that signature returns the
 * bytes that were sent.
 *
 * Every hop is the production implementation. This follows the established
 * approach for the communication domain: the service graph from `harness.ts`,
 * and `StorageController` driven through request/response doubles the way
 * `test/unit/attachments/voice-storage.spec.ts` drives it.
 *
 * The repository does also have a real HTTP integration precedent --
 * `auth-trusted-proxy.spec.ts` boots selected Nest modules into an application
 * listening on 127.0.0.1 and exercises genuine socket behaviour. So the scope
 * note here is narrow and deliberate: this test does NOT reach
 * `StorageController` over a socket. A test that did would need a small
 * application of its own, because `CommunicationModule` -- where the controller
 * lives -- carries Socket.IO, Redis-adapter and BullMQ handles whose teardown
 * does not survive repeated boots in one process, which is the same reason that
 * auth test leaves the module out. Building that harness is its own piece of
 * work and is not in scope here.
 *
 * What this test does guarantee is that nothing is faked behind the controller:
 * the signature is parsed out of the minted URL and verified by the real
 * storage, and the bytes travel through `LocalFsBlobStore` rather than being
 * read from the temp directory directly.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LocalFsBlobStore } from '@communication/attachments/blob-store';
import { StorageController } from '@communication/api/storage.controller';
import { SignedLocalObjectStorage } from '@communication/attachments/object-storage';
import { buildGraph, seed, truncate, Scenario } from './harness';

jest.setTimeout(60_000);

const g = buildGraph();
let s: Scenario;

/** Same express-shaped doubles the storage unit suite consumes. */
function fakeRes() {
  const state = {
    status: 0,
    headers: {} as Record<string, string>,
    body: undefined as string | Buffer | undefined,
  };
  const res = {
    status(code: number) {
      state.status = code;
      return res;
    },
    setHeader(name: string, value: string) {
      state.headers[name] = value;
    },
    send(body?: string | Buffer) {
      state.body = body;
    },
    end() {},
  };
  return { res, state };
}

function fakeReq(headers: Record<string, string>, body?: Buffer) {
  return {
    headers,
    async *[Symbol.asyncIterator]() {
      if (body) yield body;
    },
  };
}

/** A signed URL is the contract; this reads it the way the route does. */
function partsOf(url: string) {
  const parsed = new URL(url);
  return {
    key: decodeURIComponent(parsed.pathname.split('/storage/')[1]),
    expires: Number(parsed.searchParams.get('expires')),
    size: parsed.searchParams.get('size') ?? '',
    sig: String(parsed.searchParams.get('sig')),
  };
}

/**
 * Deliberately not text, and generated rather than committed. Every byte value
 * appears, so a hop that decoded or re-encoded the body could not return it
 * unchanged.
 */
const bytes = Buffer.from(Array.from({ length: 1024 }, (_, i) => (i * 31 + 7) % 256));
const mime = 'audio/mp4';
const durationMs = 7_000;

const originalRoot = process.env.STORAGE_LOCAL_ROOT;
let root: string;
let controller: StorageController;

beforeAll(async () => {
  await g.prisma.$connect();
});

afterAll(async () => {
  await g.prisma.$disconnect();
  if (originalRoot === undefined) delete process.env.STORAGE_LOCAL_ROOT;
  else process.env.STORAGE_LOCAL_ROOT = originalRoot;
});

beforeEach(async () => {
  // A root of this test's own, so nothing here depends on -- or leaves anything
  // in -- the shared default under the OS temp directory. Set before the blob
  // store is constructed, which is when it reads the variable.
  root = mkdtempSync(join(tmpdir(), 'jawwid-voice-lifecycle-'));
  process.env.STORAGE_LOCAL_ROOT = root;
  controller = new StorageController(new SignedLocalObjectStorage(), new LocalFsBlobStore());

  await truncate(g.prisma);
  s = await seed(g.prisma);
  g.coverage.onDutyId = s.ownerId;
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

/** Authorize, then PUT the bytes through the URL that authorization minted. */
async function authorizeAndUpload(conversationId: string) {
  const auth = await g.attachments.authorizeUpload({
    conversationId,
    actorId: s.parentId,
    kind: 'voice',
    mimeType: mime,
    byteSize: bytes.length,
  });
  const put = partsOf(auth.uploadUrl);

  const res = fakeRes();
  await controller.upload(
    put.key,
    String(put.expires),
    put.size,
    put.sig,
    fakeReq({ 'content-type': mime }, bytes),
    res.res,
  );
  return { auth, put, upload: res.state };
}

describe('a voice note from authorization to playback', () => {
  it('keeps the same object and the same bytes across every hop', async () => {
    const conv = await g.conversations.getOrCreateDirect(s.parentId, s.ownerId);

    // 1 — authorize. Real authz over real rows; the key is minted here.
    const { auth, put, upload } = await authorizeAndUpload(conv.id);

    expect(auth.method).toBe('PUT');
    expect(auth.objectKey.startsWith(`conversations/${conv.id}/`)).toBe(true);
    // Storage signs the content type and verifies it on the write.
    expect(auth.headers['content-type']).toBe(mime);
    expect(put.sig).toMatch(/^[0-9a-f]{64}$/);
    expect(put.size).toBe(String(bytes.length));
    expect(new Date(auth.expiresAt).getTime()).toBeGreaterThan(Date.now());

    // 2 — the bytes are stored, through the signature rather than around it.
    expect(upload.status).toBe(201);

    // 3 — the message persists the object the upload just created.
    const sent = await g.messages.send({
      conversationId: conv.id,
      senderId: s.parentId,
      type: 'voice',
      clientMessageId: 'c-voice-lifecycle-1',
      attachments: [
        { kind: 'voice', objectKey: auth.objectKey, mimeType: mime, byteSize: bytes.length, durationMs },
      ],
    });

    expect(sent.attachments).toHaveLength(1);
    expect(sent.attachments[0].kind).toBe('voice');
    expect(sent.attachments[0].mimeType).toBe(mime);
    expect(sent.attachments[0].byteSize).toBe(bytes.length);
    expect(sent.attachments[0].durationMs).toBe(durationMs);

    // 4 — the read path the client actually calls.
    const page = await g.messages.list({ conversationId: conv.id, actorId: s.parentId });
    const listed = page.messages.find((m) => m.id === sent.id);
    expect(listed).toBeDefined();

    const attachment = listed!.attachments[0];
    // Metadata is carried, not recomputed: a hop that re-sniffed the MIME or
    // re-measured the bytes would show up here.
    expect(attachment.mimeType).toBe(mime);
    expect(attachment.byteSize).toBe(bytes.length);
    expect(attachment.durationMs).toBe(durationMs);

    // 5 — the signed read URL. The DTO deliberately never carries the object
    // key, so the key's stability is asserted through the URL that addresses it.
    expect(attachment.url).toBeTruthy();
    const get = partsOf(attachment.url!);
    expect(get.key).toBe(auth.objectKey);
    expect(get.sig).toMatch(/^[0-9a-f]{64}$/);
    expect(get.sig).not.toBe(put.sig); // a read signature is not a write one
    expect(get.expires).toBeGreaterThan(Math.floor(Date.now() / 1000));

    // 6 — fetch through that URL, and get back exactly what was uploaded.
    const read = fakeRes();
    await controller.download(get.key, String(get.expires), get.sig, fakeReq({}), read.res);

    expect(read.state.status).toBe(200);
    expect(read.state.headers['Content-Type']).toBe(mime);
    // Served as the MIME that was authorized and never sniffed from content:
    // an attachment origin that can be talked into text/html is stored XSS.
    expect(read.state.headers['X-Content-Type-Options']).toBe('nosniff');
    expect(Buffer.isBuffer(read.state.body)).toBe(true);
    expect(Buffer.compare(read.state.body as Buffer, bytes)).toBe(0);
  });

  it('a read signature cannot be spent on another message\'s object', async () => {
    // Two notes in the same conversation, so only the object key differs. The
    // signature is per object; swapping keys under a valid signature is the
    // cheapest way to prove the read URL is not merely a capability to /storage.
    const conv = await g.conversations.getOrCreateDirect(s.parentId, s.ownerId);
    const first = await authorizeAndUpload(conv.id);
    const second = await authorizeAndUpload(conv.id);

    expect(first.auth.objectKey).not.toBe(second.auth.objectKey);

    const sent = await g.messages.send({
      conversationId: conv.id,
      senderId: s.parentId,
      type: 'voice',
      clientMessageId: 'c-voice-lifecycle-2',
      attachments: [
        { kind: 'voice', objectKey: first.auth.objectKey, mimeType: mime, byteSize: bytes.length, durationMs },
      ],
    });

    const page = await g.messages.list({ conversationId: conv.id, actorId: s.parentId });
    const url = partsOf(page.messages.find((m) => m.id === sent.id)!.attachments[0].url!);

    const stolen = fakeRes();
    await controller.download(
      second.auth.objectKey, // a real, stored object -- but not the signed one
      String(url.expires),
      url.sig,
      fakeReq({}),
      stolen.res,
    );

    expect(stolen.state.status).toBe(403);
    expect(stolen.state.body).not.toEqual(bytes);
  });
});
