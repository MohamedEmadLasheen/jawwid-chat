/**
 * Phase 4C — attachments: who may upload, and what may be attached.
 *
 * THE TWO DEFECTS THIS FILE PINS. An upload is presigned: the API authorizes
 * it, hands back a URL, and then never sees the bytes or the object again.
 * Everything the send path knew about an attachment therefore arrived from the
 * client, and the only check was that the CLAIMED type and size were on the
 * allowlist.
 *
 *   1. The object key was not bound to the conversation, so a member of
 *      conversation A could attach an object key belonging to conversation B.
 *      Signed read URLs are scoped to the MESSAGE's conversation (RT-006), so
 *      the attacker's own thread would then hand them a signed URL for B's
 *      file. A read primitive into a conversation they are not in.
 *
 *   2. Nothing asked the storage what had actually been uploaded, so
 *      "image/png, 40 KB" and a 400 MB binary were the same request.
 *
 * Requires the migrated database (DATABASE_URL).
 */
import { randomUUID } from 'node:crypto';
import { buildGraph, seed, truncate, Scenario } from './harness';
import { AttachmentService } from '@communication/attachments/attachment.service';
import type {
  ObjectMetadata,
  ObjectStorage,
  UploadAuthorization,
} from '@communication/attachments/object-storage';

const g = buildGraph();
let s: Scenario;
let conversationId: string;
let otherConversationId: string;

/**
 * Storage that behaves like the real thing: it mints server-side keys, and it
 * knows what it holds.
 *
 * `verifiesObjects` is TRUE, because that is what every deployed environment
 * uses. The local reference signer sets it false and the service says so out
 * loud; a test running against that would be asserting the development
 * fallback rather than the control.
 */
class FakeStorage implements ObjectStorage {
  readonly verifiesObjects = true;
  readonly objects = new Map<string, ObjectMetadata>();

  async authorizeUpload(params: {
    prefix: string;
    mimeType: string;
    byteSize: number;
  }): Promise<UploadAuthorization> {
    const objectKey = `${params.prefix}/${randomUUID()}`;
    return {
      objectKey,
      uploadUrl: `https://storage.example/${objectKey}`,
      method: 'PUT',
      headers: { 'content-type': params.mimeType },
      expiresAt: new Date(Date.now() + 300_000).toISOString(),
    };
  }

  async signedReadUrl(objectKey: string, ttlSeconds: number): Promise<string> {
    return `https://storage.example/${objectKey}?sig=x&ttl=${ttlSeconds}`;
  }

  async head(objectKey: string): Promise<ObjectMetadata | null> {
    return this.objects.get(objectKey) ?? null;
  }

  async delete(objectKey: string): Promise<void> {
    this.objects.delete(objectKey);
  }

  /** What a client actually PUT to the signed URL. */
  put(objectKey: string, meta: ObjectMetadata): void {
    this.objects.set(objectKey, meta);
  }
}

let storage: FakeStorage;
let attachments: AttachmentService;

const PNG = { kind: 'image', mimeType: 'image/png', byteSize: 4096 };

/** Authorize an upload and perform it, as a well-behaved client would. */
async function uploadTo(convId: string, actorId: string): Promise<string> {
  const auth = await attachments.authorizeUpload({
    conversationId: convId,
    actorId,
    ...PNG,
  });
  storage.put(auth.objectKey, { byteSize: PNG.byteSize, mimeType: PNG.mimeType });
  return auth.objectKey;
}

function attachmentOf(objectKey: string, overrides: Record<string, unknown> = {}) {
  return { ...PNG, objectKey, ...overrides };
}

beforeEach(async () => {
  g.coverage.onDutyId = null;
  await truncate(g.prisma);
  s = await seed(g.prisma);

  conversationId = (await g.conversations.getOrCreateDirect(s.ownerId, s.parentId)).id;
  otherConversationId = (await g.conversations.getOrCreateDirect(s.otherAdminId, s.teacherId)).id;

  // The attachment service over storage that behaves like the deployed one.
  // The harness's own graph uses the local reference signer, which holds no
  // objects and says so through `verifiesObjects` — a suite built on that would
  // be asserting the development fallback rather than the control.
  storage = new FakeStorage();
  attachments = new AttachmentService(g.prisma, g.authz, g.conversations, storage);
});

afterAll(async () => {
  await g.prisma.$disconnect();
});

describe('authorizing an upload', () => {
  it('grants a key to somebody who may write to the thread', async () => {
    const auth = await attachments.authorizeUpload({
      conversationId,
      actorId: s.parentId,
      ...PNG,
    });

    expect(auth.objectKey.startsWith(`conversations/${conversationId}/`)).toBe(true);
    // Server-generated. A client-supplied name would let one caller overwrite
    // another's object and would put user text in a storage path.
    expect(auth.objectKey).not.toContain('..');
  });

  it('refuses somebody who may not read the conversation', async () => {
    await expect(
      attachments.authorizeUpload({
        conversationId,
        actorId: s.otherParentId,
        ...PNG,
      }),
    ).rejects.toMatchObject({ code: expect.stringContaining('COMM.') });
  });

  it('refuses a type that is not on the allowlist, and a file over the limit', async () => {
    await expect(
      attachments.authorizeUpload({
        conversationId,
        actorId: s.parentId,
        kind: 'image',
        mimeType: 'application/x-msdownload',
        byteSize: 1024,
      }),
    ).rejects.toMatchObject({ code: 'COMM.ATTACHMENT_TYPE_NOT_ALLOWED' });

    await expect(
      attachments.authorizeUpload({
        conversationId,
        actorId: s.parentId,
        kind: 'image',
        mimeType: 'image/png',
        byteSize: 500 * 1024 * 1024,
      }),
    ).rejects.toMatchObject({ code: 'COMM.ATTACHMENT_TOO_LARGE' });
  });
});

describe('the object key is bound to the conversation', () => {
  it('accepts a key minted for THIS conversation', async () => {
    const objectKey = await uploadTo(conversationId, s.parentId);
    await expect(
      attachments.validateForConversation(conversationId, [attachmentOf(objectKey)]),
    ).resolves.toBeUndefined();
  });

  it("REFUSES a key belonging to a conversation the sender is not in", async () => {
    // The attack. The key is real and was legitimately minted -- for somebody
    // else's conversation. Attaching it here would make this thread's own
    // signed-URL scoping hand the sender a URL for that file.
    const theirs = await uploadTo(otherConversationId, s.otherAdminId);

    await expect(
      attachments.validateForConversation(conversationId, [attachmentOf(theirs)]),
    ).rejects.toMatchObject({ code: 'COMM.ATTACHMENT_TYPE_NOT_ALLOWED' });
  });

  it('refuses a traversal dressed up as this conversation', async () => {
    const traversal = `conversations/${conversationId}/../${otherConversationId}/secret`;
    storage.put(traversal, { byteSize: PNG.byteSize, mimeType: PNG.mimeType });

    // Some storage backends normalise `..` and some do not, and a control whose
    // correctness depends on which one is deployed is not a control.
    await expect(
      attachments.validateForConversation(conversationId, [attachmentOf(traversal)]),
    ).rejects.toMatchObject({ code: 'COMM.ATTACHMENT_TYPE_NOT_ALLOWED' });
  });

  it('refuses a nested key the authorizer would never have minted', async () => {
    const nested = `conversations/${conversationId}/nested/key`;
    storage.put(nested, { byteSize: PNG.byteSize, mimeType: PNG.mimeType });

    await expect(
      attachments.validateForConversation(conversationId, [attachmentOf(nested)]),
    ).rejects.toMatchObject({ code: 'COMM.ATTACHMENT_TYPE_NOT_ALLOWED' });
  });

  it('checks the THUMBNAIL key too, which is a second key on the same row', async () => {
    const mine = await uploadTo(conversationId, s.parentId);
    const theirs = await uploadTo(otherConversationId, s.otherAdminId);

    await expect(
      attachments.validateForConversation(conversationId, [
        attachmentOf(mine, { thumbnailObjectKey: theirs }),
      ]),
    ).rejects.toMatchObject({ code: 'COMM.ATTACHMENT_TYPE_NOT_ALLOWED' });
  });
});

describe('what was actually uploaded', () => {
  it('refuses an object key nothing was ever uploaded to', async () => {
    const auth = await attachments.authorizeUpload({
      conversationId,
      actorId: s.parentId,
      ...PNG,
    });
    // Authorized, never PUT.
    await expect(
      attachments.validateForConversation(conversationId, [attachmentOf(auth.objectKey)]),
    ).rejects.toMatchObject({ code: 'COMM.ATTACHMENT_TYPE_NOT_ALLOWED' });
  });

  it('refuses a declared size that is not the uploaded size', async () => {
    const auth = await attachments.authorizeUpload({
      conversationId,
      actorId: s.parentId,
      ...PNG,
    });
    // Declared 4 KB, uploaded 400 MB. The presigned PUT signs only the host, so
    // nothing stopped the upload; this is what stops it being attached.
    storage.put(auth.objectKey, { byteSize: 400 * 1024 * 1024, mimeType: 'image/png' });

    await expect(
      attachments.validateForConversation(conversationId, [
        attachmentOf(auth.objectKey),
      ]),
    ).rejects.toMatchObject({ code: 'COMM.ATTACHMENT_TOO_LARGE' });
  });

  it('refuses a declared type that is not the uploaded type', async () => {
    const auth = await attachments.authorizeUpload({
      conversationId,
      actorId: s.parentId,
      ...PNG,
    });
    storage.put(auth.objectKey, {
      byteSize: PNG.byteSize,
      mimeType: 'application/x-msdownload',
    });

    await expect(
      attachments.validateForConversation(conversationId, [
        attachmentOf(auth.objectKey),
      ]),
    ).rejects.toMatchObject({ code: 'COMM.ATTACHMENT_TYPE_NOT_ALLOWED' });
  });

  it('tolerates a charset parameter on the stored content type', async () => {
    const auth = await attachments.authorizeUpload({
      conversationId,
      actorId: s.parentId,
      kind: 'file',
      mimeType: 'text/plain',
      byteSize: 100,
    });
    // Storage commonly records `text/plain; charset=utf-8`. Comparing the whole
    // header would reject a correct upload.
    storage.put(auth.objectKey, { byteSize: 100, mimeType: 'text/plain; charset=utf-8' });

    await expect(
      attachments.validateForConversation(conversationId, [
        { kind: 'file', mimeType: 'text/plain', byteSize: 100, objectKey: auth.objectKey },
      ]),
    ).resolves.toBeUndefined();
  });
});

describe('reading an attachment back', () => {
  it('mints a short-lived URL only for attachments of THIS conversation', async () => {
    const objectKey = await uploadTo(conversationId, s.parentId);
    const message = await g.prisma.message.create({
      data: {
        conversationId,
        type: 'text',
        body: 'see attached',
        authorType: 'contact',
        authorId: s.parentId,
        visibility: 'customer',
        clientMessageId: randomUUID(),
        attachments: {
          create: [{ kind: 'image', objectKey, mimeType: 'image/png', byteSize: 4096 }],
        },
      },
      select: { id: true },
    });

    const signed = await attachments.signUrlsForMessages([message.id], conversationId);
    expect(signed.size).toBe(1);

    // RT-006. The same message id, asked for through a DIFFERENT conversation,
    // yields nothing: `conversationId` is part of the query rather than an
    // assumption about the caller, so a message id slipped into the list from
    // elsewhere matches no row.
    const elsewhere = await attachments.signUrlsForMessages(
      [message.id],
      otherConversationId,
    );
    expect(elsewhere.size).toBe(0);
  });

  it('never produces a permanent public URL', async () => {
    const objectKey = await uploadTo(conversationId, s.parentId);
    const url = await storage.signedReadUrl(objectKey, 300);
    expect(url).toMatch(/sig=/);
    expect(url).toMatch(/ttl=300/);
  });
});
