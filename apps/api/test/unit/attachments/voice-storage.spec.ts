/**
 * Voice attachment storage: the signed-URL round trip and the limits that make
 * it safe to expose an unauthenticated route.
 */
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SignedLocalObjectStorage } from '@communication/attachments/object-storage';
import { LocalFsBlobStore } from '@communication/attachments/blob-store';
import { AttachmentService } from '@communication/attachments/attachment.service';
import { StorageController } from '@communication/api/storage.controller';
import { CommError, CommErrorCode } from '@platform/errors';

const SECRET = 'v'.repeat(40);

/** Minimal express-shaped doubles, matching what the controller consumes. */
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

function partsOf(url: string) {
  const parsed = new URL(url);
  return {
    key: decodeURIComponent(parsed.pathname.split('/storage/')[1]),
    expires: Number(parsed.searchParams.get('expires')),
    size: parsed.searchParams.get('size') ?? '',
    sig: String(parsed.searchParams.get('sig')),
  };
}

describe('voice attachment storage round trip', () => {
  const original = process.env.STORAGE_SIGNING_SECRET;
  const originalRoot = process.env.STORAGE_LOCAL_ROOT;
  let controller: StorageController;
  let storage: SignedLocalObjectStorage;

  beforeEach(() => {
    process.env.STORAGE_SIGNING_SECRET = SECRET;
    process.env.STORAGE_LOCAL_ROOT = mkdtempSync(join(tmpdir(), 'jawwid-voice-test-'));
    storage = new SignedLocalObjectStorage();
    controller = new StorageController(storage, new LocalFsBlobStore());
  });

  afterEach(() => {
    process.env.STORAGE_SIGNING_SECRET = original;
    if (originalRoot === undefined) delete process.env.STORAGE_LOCAL_ROOT;
    else process.env.STORAGE_LOCAL_ROOT = originalRoot;
  });

  const bytes = Buffer.from('fake-opus-voice-note-payload');
  const mime = 'audio/webm';

  async function authorize(byteSize = bytes.length) {
    const auth = await storage.authorizeUpload({
      prefix: 'conversations/c1',
      mimeType: mime,
      byteSize,
    });
    return { auth, ...partsOf(auth.uploadUrl) };
  }

  it('stores an authorized upload and serves it back through a signed read URL', async () => {
    const { key, expires, size, sig } = await authorize();

    const put = fakeRes();
    await controller.upload(
      key,
      String(expires),
      size,
      sig,
      fakeReq({ 'content-type': mime }, bytes),
      put.res,
    );
    expect(put.state.status).toBe(201);

    const readUrl = await storage.signedReadUrl(key, 60);
    const read = partsOf(readUrl);
    const get = fakeRes();
    await controller.download(
      read.key,
      String(read.expires),
      read.sig,
      fakeReq({}),
      get.res,
    );

    expect(get.state.status).toBe(200);
    expect(get.state.body).toEqual(bytes);
    expect(get.state.headers['Content-Type']).toBe(mime);
    // A signed URL outlives nothing: a shared cache must not keep it.
    expect(get.state.headers['Cache-Control']).toBe('private, no-store');
    expect(get.state.headers['X-Content-Type-Options']).toBe('nosniff');
  });

  it('refuses an upload whose declared MIME type is not the one authorized', async () => {
    const { key, expires, size, sig } = await authorize();
    const put = fakeRes();
    // Authorized for audio/webm; uploading HTML would make the storage origin a
    // stored-XSS primitive.
    await controller.upload(
      key,
      String(expires),
      size,
      sig,
      fakeReq({ 'content-type': 'text/html' }, bytes),
      put.res,
    );
    expect(put.state.status).toBe(403);
  });

  it('refuses an upload larger than the size it was authorized for', async () => {
    const { key, expires, size, sig } = await authorize();
    const put = fakeRes();
    await controller.upload(
      key,
      String(expires),
      size,
      sig,
      fakeReq({ 'content-type': mime }, Buffer.concat([bytes, bytes])),
      put.res,
    );
    expect(put.state.status).toBe(413);
  });

  it('refuses a read whose signature was minted for another object', async () => {
    const { key, expires, size, sig } = await authorize();
    const put = fakeRes();
    await controller.upload(
      key,
      String(expires),
      size,
      sig,
      fakeReq({ 'content-type': mime }, bytes),
      put.res,
    );

    const readUrl = await storage.signedReadUrl(key, 60);
    const read = partsOf(readUrl);
    const get = fakeRes();
    // Swapping the object key in the URL is the whole attack this route has to
    // survive, because the route itself carries no session.
    await controller.download(
      'conversations/c1/some-other-object',
      String(read.expires),
      read.sig,
      fakeReq({}),
      get.res,
    );
    expect(get.state.status).toBe(403);
  });

  it('serves a byte range so a player need not fetch the whole note to start', async () => {
    const { key, expires, size, sig } = await authorize();
    const put = fakeRes();
    await controller.upload(
      key,
      String(expires),
      size,
      sig,
      fakeReq({ 'content-type': mime }, bytes),
      put.res,
    );

    const read = partsOf(await storage.signedReadUrl(key, 60));
    const get = fakeRes();
    await controller.download(
      read.key,
      String(read.expires),
      read.sig,
      fakeReq({ range: 'bytes=0-3' }),
      get.res,
    );

    expect(get.state.status).toBe(206);
    expect(get.state.body).toEqual(bytes.subarray(0, 4));
    expect(get.state.headers['Content-Range']).toBe(`bytes 0-3/${bytes.length}`);
  });

  it('a path-traversal object key cannot escape the blob root', async () => {
    const blobs = new LocalFsBlobStore();
    // The key is hashed, never joined onto a path, so this is stored as an
    // ordinary object rather than written to /etc.
    await blobs.put('../../../../etc/passwd', mime, bytes);
    expect(await blobs.get('../../../../etc/passwd')).toEqual({ bytes, mimeType: mime });
    expect(await blobs.get('conversations/c1/other')).toBeNull();
  });
});

describe('voice metadata is validated, never trusted', () => {
  const service = new AttachmentService(null as never, null as never, null as never, null as never);

  it('accepts a plausible voice note duration', () => {
    expect(() => service.validate('voice', 'audio/webm', 20480, 4200)).not.toThrow();
  });

  it('rejects a negative duration', () => {
    expect(() => service.validate('voice', 'audio/webm', 20480, -1)).toThrow(CommError);
  });

  it('rejects a duration beyond the voice-note ceiling', () => {
    try {
      service.validate('voice', 'audio/webm', 20480, 60 * 60 * 1000);
      throw new Error('expected a rejection');
    } catch (e) {
      expect((e as CommError).code).toBe(CommErrorCode.ATTACHMENT_TYPE_NOT_ALLOWED);
    }
  });

  it('rejects a non-integer duration', () => {
    expect(() => service.validate('voice', 'audio/webm', 20480, Number.NaN)).toThrow(CommError);
  });

  it('accepts the browser MediaRecorder default container', () => {
    expect(() => service.validate('voice', 'audio/webm', 20480)).not.toThrow();
    expect(() => service.validate('voice', 'audio/mp4', 20480)).not.toThrow();
  });
});

/**
 * A voice note that cannot be played is not a delivered voice note.
 *
 * `MessageService.list()` signs attachment URLs, but the send response, the
 * idempotent-replay response and the approval queue originally did not -- so a
 * sender's own note came back with `url: null` and stayed unplayable until the
 * thread was re-fetched, and an approver could not hear the message they were
 * being asked to approve. These are static proofs over the real sources,
 * because the behaviour needs a database to exercise end to end.
 */
describe('every path that returns a message signs its attachment URLs', () => {
  const messageSource = readFileSync(
    join(__dirname, '../../../src/communication/messages/message.service.ts'),
    'utf8',
  );
  const approvalSource = readFileSync(
    join(__dirname, '../../../src/communication/approvals/approval.service.ts'),
    'utf8',
  );

  it('the send response carries signed URLs', () => {
    // The vulnerable form is a bare `toMessageDto(created)` with no second argument.
    expect(messageSource).not.toMatch(/return toMessageDto\(created\);/);
    expect(messageSource).toMatch(
      /toMessageDto\(\s*created,\s*await this\.attachments\.signUrlsForMessages\(\[created\.id\]\)/,
    );
  });

  it('the idempotent-replay response carries signed URLs', () => {
    expect(messageSource).not.toMatch(/toMessageDto\(found\)/);
    expect(messageSource).toMatch(
      /toMessageDto\(\s*found,\s*await this\.attachments\.signUrlsForMessages\(\[found\.id\]\)/,
    );
  });

  it('the approval queue carries signed URLs', () => {
    expect(approvalSource).not.toMatch(/toMessageDto\(r\.message\)/);
    expect(approvalSource).toMatch(/signUrlsForMessages\(rows\.map\(\(r\) => r\.messageId\)\)/);
    expect(approvalSource).toMatch(/toMessageDto\(r\.message, signed\)/);
  });
});
