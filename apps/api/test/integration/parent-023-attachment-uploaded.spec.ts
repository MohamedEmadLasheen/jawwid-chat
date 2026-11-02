/**
 * PARENT-023: a message's attachment must really be in storage.
 *
 * On systest, sending a chat attachment whose object was never uploaded
 * answered 201, and the bubble could never play. The send path now reads the
 * object back (one byte) and refuses with 409 COMM.ATTACHMENT_NOT_UPLOADED
 * when it is missing, or is not the size or type the sender declares (the ones
 * its upload was authorized for). PARENT-017: the same for a video, and an
 * over-size video is refused before any upload.
 *
 * Synthetic fixtures only (QA gate G-16).
 */
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LocalFsBlobStore } from '@communication/attachments/blob-store';
import { CommErrorCode } from '@platform/errors';
import { buildGraph, seed, truncate, Scenario } from './harness';

jest.setTimeout(60_000);

const g = buildGraph();
let s: Scenario;
let groupId: string;
let root: string;
const originalRoot = process.env.STORAGE_LOCAL_ROOT;
const VIDEO = 'video/mp4';
const bytes = Buffer.from(Array.from({ length: 4096 }, (_, i) => (i * 31 + 7) % 256));

async function grant(kind: 'video' | 'image', mimeType: string, byteSize: number) {
  return g.attachments.authorizeUpload({ conversationId: groupId, actorId: s.parentId, kind, mimeType, byteSize });
}
function send(attachment: { kind: string; objectKey: string; mimeType: string; byteSize: number; durationMs?: number }) {
  return g.messages.send({
    conversationId: groupId, senderId: s.parentId, type: attachment.kind as 'video', clientMessageId: randomUUID(),
    attachments: [attachment],
  });
}
async function refusal(p: Promise<unknown>) {
  try {
    await p;
  } catch (e) {
    return e as { code: string; status: number };
  }
  throw new Error('expected a refusal');
}

beforeAll(async () => {
  await g.prisma.$connect();
});
afterAll(async () => {
  if (originalRoot === undefined) delete process.env.STORAGE_LOCAL_ROOT;
  else process.env.STORAGE_LOCAL_ROOT = originalRoot;
  await g.prisma.$disconnect();
});
beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), 'jawwid-parent023-'));
  process.env.STORAGE_LOCAL_ROOT = root;
  await truncate(g.prisma);
  s = await seed(g.prisma);
  groupId = (await g.conversations.ensureStudentGroup(s.learnerId, s.ownerId)).id;
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('PARENT-023: the object must be in storage, as authorized', () => {
  it('an uploaded video is sent, with its duration', async () => {
    const auth = await grant('video', VIDEO, bytes.length);
    await new LocalFsBlobStore().put(auth.objectKey, VIDEO, bytes);
    const sent = await send({ kind: 'video', objectKey: auth.objectKey, mimeType: VIDEO, byteSize: bytes.length, durationMs: 12_000 });
    expect(sent.attachments[0]).toMatchObject({ kind: 'video', mimeType: VIDEO, byteSize: bytes.length, durationMs: 12_000 });
  });

  it('a video whose object was never uploaded is refused 409, and no message is written', async () => {
    const auth = await grant('video', VIDEO, bytes.length);
    const e = await refusal(send({ kind: 'video', objectKey: auth.objectKey, mimeType: VIDEO, byteSize: bytes.length }));
    expect(e).toMatchObject({ code: CommErrorCode.ATTACHMENT_NOT_UPLOADED, status: 409 });
    expect(await g.prisma.messageAttachment.count({ where: { objectKey: auth.objectKey } })).toBe(0);
    expect(await g.prisma.message.count({ where: { conversationId: groupId, type: 'video' } })).toBe(0);
  });

  it('an object of another size than declared is refused 409', async () => {
    const auth = await grant('video', VIDEO, bytes.length);
    await new LocalFsBlobStore().put(auth.objectKey, VIDEO, bytes.subarray(0, 1000));
    const e = await refusal(send({ kind: 'video', objectKey: auth.objectKey, mimeType: VIDEO, byteSize: bytes.length }));
    expect(e).toMatchObject({ code: CommErrorCode.ATTACHMENT_NOT_UPLOADED, status: 409 });
  });

  it('an object of another type than declared is refused 409', async () => {
    const auth = await grant('video', VIDEO, bytes.length);
    await new LocalFsBlobStore().put(auth.objectKey, 'image/png', bytes);
    const e = await refusal(send({ kind: 'video', objectKey: auth.objectKey, mimeType: VIDEO, byteSize: bytes.length }));
    expect(e).toMatchObject({ code: CommErrorCode.ATTACHMENT_NOT_UPLOADED, status: 409 });
  });
});

describe('PARENT-017: an over-size video', () => {
  it('is refused at authorization, before a byte is uploaded (400 ATTACHMENT_TOO_LARGE)', async () => {
    const e = await refusal(grant('video', VIDEO, 100 * 1024 * 1024 + 1));
    expect(e).toMatchObject({ code: CommErrorCode.ATTACHMENT_TOO_LARGE, status: 400 });
  });

  it('and on send, whatever the client claims it uploaded', async () => {
    const e = await refusal(send({ kind: 'video', objectKey: `conversations/${groupId}/${randomUUID()}`, mimeType: VIDEO, byteSize: 100 * 1024 * 1024 + 1 }));
    expect(e).toMatchObject({ code: CommErrorCode.ATTACHMENT_TOO_LARGE, status: 400 });
  });
});
