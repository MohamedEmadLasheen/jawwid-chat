/**
 * Forwarding (Chat UI group B, owner decisions 2026-10-19: anyone may forward
 * any message they can READ into any conversation they can WRITE in, text and
 * media, up to ten conversations).
 *
 *   A. a forward is a new message by the forwarder, flagged, source never named
 *   B. media are COPIED into the destination's namespace, never shared by key
 *   C. both authorizations hold: read the source, write every destination
 *   D. what may not leave: deleted, held, internal notes stay internal
 */
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LocalFsBlobStore } from '@communication/attachments/blob-store';
import { CommErrorCode } from '@platform/errors';
import { buildGraph, seed, truncate, Scenario } from './harness';

jest.setTimeout(60_000);

// The graph's storage reads its root when it is built, so the root is set first
// and the test writes through the same folder the services read.
const originalRoot = process.env.STORAGE_LOCAL_ROOT;
const root = mkdtempSync(join(tmpdir(), 'jawwid-fwd-'));
process.env.STORAGE_LOCAL_ROOT = root;
const g = buildGraph();
let s: Scenario;
let groupId: string;
let directId: string;
const bytes = Buffer.from(Array.from({ length: 1024 }, (_, i) => (i * 7 + 1) % 256));

async function say(body: string, senderId = s.ownerId, extra: Record<string, unknown> = {}, conversationId = groupId) {
  return g.messages.send({ conversationId, senderId, body, clientMessageId: randomUUID(), ...extra });
}

beforeAll(async () => { await g.prisma.$connect(); });
afterAll(async () => {
  await truncate(g.prisma);
  await g.prisma.$disconnect();
  rmSync(root, { recursive: true, force: true });
  if (originalRoot === undefined) delete process.env.STORAGE_LOCAL_ROOT;
  else process.env.STORAGE_LOCAL_ROOT = originalRoot;
});
beforeEach(async () => {
  await truncate(g.prisma);
  s = await seed(g.prisma);
  g.coverage.onDutyId = s.ownerId;
  groupId = (await g.conversations.ensureStudentGroup(s.learnerId, s.ownerId)).id;
  directId = (await g.conversations.getOrCreateDirect(s.ownerId, s.parentId)).id;
});

describe('A · a forward is a new message by the forwarder', () => {
  it('a parent forwards a group message into their chat with Jawwid: their own copy, flagged, source unnamed', async () => {
    const original = await say('homework: surah al-mulk, verses 1-5', s.ownerId);
    await g.messages.react(original.id, s.ownerId, '👍');

    const { sent } = await g.messages.forward({ actorId: s.parentId, conversationId: groupId, messageIds: [original.id], toConversationIds: [directId] });
    expect(sent).toHaveLength(1);
    const copy = sent[0]!;
    expect(copy.conversationId).toBe(directId);
    expect(copy.authorId).toBe(s.parentId);
    expect(copy.body).toBe(original.body);
    expect(copy.forwarded).toBe(true);
    expect(copy.reactions).toEqual([]);
    expect(Object.keys(copy)).not.toContain('forwardedFromMessageId');

    // The original is untouched; the provenance is kept server-side for audit.
    const row = await g.prisma.message.findUnique({ where: { id: copy.id } });
    expect(row?.forwardedFromMessageId).toBe(original.id);
    const audit = await g.prisma.auditLog.findMany({ where: { action: 'message.forwarded' } });
    expect(audit).toHaveLength(1);
  });

  it('several messages to several chats arrive in their original order, one copy per chat', async () => {
    const a = await say('first');
    const b = await say('second');
    const other = (await g.conversations.getOrCreateDirect(s.ownerId, s.otherParentId)).id;
    const { sent } = await g.messages.forward({ actorId: s.ownerId, conversationId: groupId, messageIds: [b.id, a.id], toConversationIds: [directId, other] });
    expect(sent.map((m) => [m.conversationId, m.body])).toEqual([
      [directId, 'first'], [directId, 'second'], [other, 'first'], [other, 'second'],
    ]);
  });
});

describe('B · media are copied, never shared', () => {
  it('a photo lands under the destination\'s own key with the same bytes; the source keeps its own', async () => {
    const auth = await g.attachments.authorizeUpload({ conversationId: groupId, actorId: s.ownerId, kind: 'image', mimeType: 'image/png', byteSize: bytes.length });
    await new LocalFsBlobStore().put(auth.objectKey, 'image/png', bytes);
    const original = await g.messages.send({
      conversationId: groupId, senderId: s.ownerId, type: 'image', clientMessageId: randomUUID(),
      attachments: [{ kind: 'image', objectKey: auth.objectKey, mimeType: 'image/png', byteSize: bytes.length }],
    });

    const { sent } = await g.messages.forward({ actorId: s.parentId, conversationId: groupId, messageIds: [original.id], toConversationIds: [directId] });
    const stored = await g.prisma.messageAttachment.findMany({ where: { messageId: sent[0]!.id } });
    expect(stored).toHaveLength(1);
    expect(stored[0]!.objectKey.startsWith(`conversations/${directId}/`)).toBe(true);
    expect(stored[0]!.objectKey).not.toBe(auth.objectKey);
    const copied = await new LocalFsBlobStore().get(stored[0]!.objectKey);
    expect(copied && Buffer.compare(copied.bytes, bytes)).toBe(0);
    expect(await new LocalFsBlobStore().get(auth.objectKey)).not.toBeNull();
  });
});

describe('C · read the source, write every destination', () => {
  it('cannot forward from a conversation the forwarder cannot read', async () => {
    const m = await say('private');
    await expect(
      g.messages.forward({ actorId: s.unrelatedTeacherId, conversationId: groupId, messageIds: [m.id], toConversationIds: [directId] }),
    ).rejects.toBeTruthy();
  });

  it('cannot forward into a conversation the forwarder may not write in -- and nothing is sent anywhere', async () => {
    const m = await say('hello');
    await expect(
      g.messages.forward({ actorId: s.teacherId, conversationId: groupId, messageIds: [m.id], toConversationIds: [directId] }),
    ).rejects.toBeTruthy();
    expect(await g.prisma.message.count({ where: { conversationId: directId } })).toBe(0);
  });

  it('caps a forward at ten destinations', async () => {
    const m = await say('hello');
    const many = Array.from({ length: 11 }, () => randomUUID());
    await expect(
      g.messages.forward({ actorId: s.ownerId, conversationId: groupId, messageIds: [m.id], toConversationIds: many }),
    ).rejects.toEqual(expect.objectContaining({ code: CommErrorCode.VALIDATION }));
  });
});

describe('D · what may not leave', () => {
  it('an internal note forwards only as an internal note -- never to a family', async () => {
    const note = await say('call them tomorrow', s.ownerId, { visibility: 'internal' });
    const { sent } = await g.messages.forward({ actorId: s.ownerId, conversationId: groupId, messageIds: [note.id], toConversationIds: [directId] });
    expect(sent[0]!.visibility).toBe('internal');
    const parentView = await g.messages.list({ conversationId: directId, actorId: s.parentId });
    expect(parentView.messages.find((x) => x.id === sent[0]!.id)).toBeUndefined();
  });

  it('a deleted or held message cannot be forwarded', async () => {
    const gone = await say('oops');
    await g.messages.deleteForEveryone(gone.id, s.ownerId, 'test');
    await expect(
      g.messages.forward({ actorId: s.ownerId, conversationId: groupId, messageIds: [gone.id], toConversationIds: [directId] }),
    ).rejects.toEqual(expect.objectContaining({ code: CommErrorCode.MESSAGE_NOT_FORWARDABLE }));

    await g.prisma.conversation.update({ where: { id: groupId }, data: { teacherRequiresApproval: true } });
    const held = await say('needs approval', s.teacherId);
    if (held.moderation === 'pending') {
      await expect(
        g.messages.forward({ actorId: s.ownerId, conversationId: groupId, messageIds: [held.id], toConversationIds: [directId] }),
      ).rejects.toEqual(expect.objectContaining({ code: CommErrorCode.MESSAGE_NOT_FORWARDABLE }));
    }
  });
});
