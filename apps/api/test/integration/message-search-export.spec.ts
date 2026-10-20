/**
 * Search and export (Chat UI group B, owner decisions 2026-10-20):
 *
 *   A. search inside a chat: text, case and Arabic spelling variants; only what
 *      the message list would show this viewer; LIKE wildcards are literal
 *   B. search across chats: only the chats in the caller's own list
 *   C. export: the super admin only; logged before a byte leaves; a zip of a
 *      transcript and the media, deleted media never included
 */
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { crc32 } from 'node:zlib';
import { LocalFsBlobStore } from '@communication/attachments/blob-store';
import { ConversationExportService } from '@communication/export/conversation-export.service';
import { CommErrorCode } from '@platform/errors';
import { PrismaAuditService } from '@platform/audit.service';
import { buildGraph, seed, truncate, Scenario } from './harness';

jest.setTimeout(60_000);

// The graph's storage reads its root when it is built.
const originalRoot = process.env.STORAGE_LOCAL_ROOT;
const root = mkdtempSync(join(tmpdir(), 'jawwid-export-'));
process.env.STORAGE_LOCAL_ROOT = root;
const g = buildGraph();
let s: Scenario;
let groupId: string;
let directId: string;
let exporter: ConversationExportService;

async function say(body: string, senderId = s.ownerId, extra: Record<string, unknown> = {}, conversationId = groupId) {
  return g.messages.send({ conversationId, senderId, body, clientMessageId: randomUUID(), ...extra });
}

async function superAdmin(): Promise<string> {
  return g.prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`select set_config('chat.provisioning_super_admin', 'on', true)`);
    const row = await tx.staff.create({ data: { name: 'Org Owner', role: 'super_admin', isActive: true } });
    return row.id;
  });
}

const code = (c: CommErrorCode) => expect.objectContaining({ code: c });

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
  exporter = new ConversationExportService(g.prisma, g.conversations, g.messages, g.config, g.storage, new PrismaAuditService());
});

describe('A · search inside a chat', () => {
  it('matches text regardless of case and of Arabic diacritics and spelling variants', async () => {
    await say('Homework: Surah Al-Mulk');
    await say('مُحَمَّد أحسن في الحفظ');
    await say('موعد الحصة القادمة');
    await say('unrelated');

    const latin = await g.messages.search({ actorId: s.parentId, conversationId: groupId, q: 'surah al' });
    expect(latin.hits.map((m) => m.body)).toEqual(['Homework: Surah Al-Mulk']);
    // Typed without harakat and with a bare alef; a teh marbuta typed as heh.
    expect((await g.messages.search({ actorId: s.parentId, conversationId: groupId, q: 'محمد احسن' })).hits).toHaveLength(1);
    expect((await g.messages.search({ actorId: s.parentId, conversationId: groupId, q: 'الحصه' })).hits).toHaveLength(1);
  });

  it('finds only what the message list shows this viewer', async () => {
    await say('note: the fee is late', s.ownerId, { visibility: 'internal' });
    const mine = await say('fee reminder for the parent');
    const gone = await say('fee typo');
    await g.messages.deleteForEveryone(gone.id, s.ownerId, 'test');
    const hidden = await say('fee hidden for me');
    await g.messages.deleteForMe(hidden.id, s.parentId);
    await say('fee in another chat', s.ownerId, {}, directId);

    const parent = await g.messages.search({ actorId: s.parentId, conversationId: groupId, q: 'fee' });
    expect(parent.hits.map((m) => m.id)).toEqual([mine.id]);
    // Staff see their internal note; still never a deleted one.
    const staff = await g.messages.search({ actorId: s.ownerId, conversationId: groupId, q: 'fee' });
    expect(staff.hits.map((m) => m.body).sort()).toEqual(['fee hidden for me', 'fee reminder for the parent', 'note: the fee is late']);
  });

  it('refuses a reader who cannot open the chat, and a query too short to mean anything', async () => {
    await say('hello there');
    await expect(g.messages.search({ actorId: s.unrelatedTeacherId, conversationId: groupId, q: 'hello' })).rejects.toBeTruthy();
    await expect(g.messages.search({ actorId: s.parentId, conversationId: groupId, q: 'h' })).rejects.toEqual(code(CommErrorCode.VALIDATION));
    // Two characters that are only harakat are not two characters of text.
    const marks = String.fromCharCode(0x64e, 0x650);
    await expect(g.messages.search({ actorId: s.parentId, conversationId: groupId, q: marks })).rejects.toEqual(code(CommErrorCode.VALIDATION));
  });

  it('treats % and _ as text, not wildcards', async () => {
    await say('100% done');
    await say('1000 done');
    await say('ab');
    expect((await g.messages.search({ actorId: s.parentId, conversationId: groupId, q: '0%' })).hits.map((m) => m.body)).toEqual(['100% done']);
    expect((await g.messages.search({ actorId: s.parentId, conversationId: groupId, q: 'a_' })).hits).toEqual([]);
  });

  it('pages newest first without skipping a match', async () => {
    for (let i = 0; i < 55; i += 1) await say(`lesson note ${i}`);
    const first = await g.messages.search({ actorId: s.parentId, conversationId: groupId, q: 'lesson note' });
    expect(first.hits).toHaveLength(50);
    expect(first.hits[0]!.body).toBe('lesson note 54');
    expect(first.nextBefore).not.toBeNull();
    const second = await g.messages.search({ actorId: s.parentId, conversationId: groupId, q: 'lesson note', before: first.nextBefore! });
    expect(second.hits.map((m) => m.body)).toEqual(['lesson note 4', 'lesson note 3', 'lesson note 2', 'lesson note 1', 'lesson note 0']);
    expect(second.nextBefore).toBeNull();
  });

  it('reads past a window of matches this viewer cannot see (review fix, PR #68)', async () => {
    const visible = await say('zebra crossing practice');
    // More than one candidate window (200) of newer matches the parent may not see.
    for (let i = 0; i < 210; i += 1) await say(`zebra staff note ${i}`, s.ownerId, { visibility: 'internal' });

    const parent = await g.messages.search({ actorId: s.parentId, conversationId: groupId, q: 'zebra' });
    expect(parent.hits.map((m) => m.id)).toEqual([visible.id]);
    expect(parent.nextBefore).toBeNull();

    // Staff see the notes, a page at a time, and paging still reaches the oldest.
    const seen: string[] = [];
    let before: string | undefined;
    for (let i = 0; i < 10; i += 1) {
      const page = await g.messages.search({ actorId: s.ownerId, conversationId: groupId, q: 'zebra', before });
      seen.push(...page.hits.map((m) => m.id));
      if (!page.nextBefore) break;
      before = page.nextBefore;
    }
    expect(seen).toHaveLength(211);
    expect(seen[seen.length - 1]).toBe(visible.id);
  });
});

describe('B · search across chats', () => {
  it("searches every chat in the caller's list, and nothing outside it", async () => {
    await say('the trip is on Thursday');
    await say('trip permission slip', s.ownerId, {}, directId);
    const other = (await g.conversations.getOrCreateDirect(s.ownerId, s.otherParentId)).id;
    await say('trip for another family', s.ownerId, {}, other);
    await say('trip note for staff', s.ownerId, { visibility: 'internal' });

    const parent = await g.messages.searchAll({ actorId: s.parentId, q: 'trip' });
    expect(parent.hits.map((h) => [h.conversationId, h.message.body])).toEqual([
      [directId, 'trip permission slip'],
      [groupId, 'the trip is on Thursday'],
    ]);
    const teacher = await g.messages.searchAll({ actorId: s.teacherId, q: 'trip' });
    expect(teacher.hits.map((h) => h.message.body)).toEqual(['the trip is on Thursday']);
  });

  it('reads past a window of invisible matches, and needs three letters (review fix, PR #68)', async () => {
    const visible = await say('zebra crossing practice', s.ownerId, {}, directId);
    for (let i = 0; i < 210; i += 1) await say(`zebra staff note ${i}`, s.ownerId, { visibility: 'internal' });

    const parent = await g.messages.searchAll({ actorId: s.parentId, q: 'zebra' });
    expect(parent.hits.map((h) => h.message.id)).toEqual([visible.id]);
    // A two-letter term cannot use the trigram index; across chats it is refused.
    await expect(g.messages.searchAll({ actorId: s.parentId, q: 'ze' })).rejects.toEqual(code(CommErrorCode.VALIDATION));
    await expect(g.messages.searchAll({ actorId: s.parentId, q: 'z e' })).rejects.toEqual(code(CommErrorCode.VALIDATION));
    // Inside one chat two letters are still fine.
    expect((await g.messages.search({ actorId: s.parentId, conversationId: directId, q: 'ze' })).hits).toHaveLength(1);
  });
});

/** The entries of a STORED zip, checked against their CRCs and the central directory. */
function unzip(buf: Buffer): Map<string, Buffer> {
  const out = new Map<string, Buffer>();
  let at = 0;
  while (buf.readUInt32LE(at) === 0x04034b50) {
    const crc = buf.readUInt32LE(at + 14);
    const size = buf.readUInt32LE(at + 18);
    const nameLen = buf.readUInt16LE(at + 26);
    const extra = buf.readUInt16LE(at + 28);
    const name = buf.subarray(at + 30, at + 30 + nameLen).toString('utf8');
    const data = buf.subarray(at + 30 + nameLen + extra, at + 30 + nameLen + extra + size);
    expect(crc32(data)).toBe(crc);
    out.set(name, Buffer.from(data));
    at += 30 + nameLen + extra + size;
  }
  const eocd = buf.length - 22;
  expect(buf.readUInt32LE(eocd)).toBe(0x06054b50);
  expect(buf.readUInt16LE(eocd + 10)).toBe(out.size);
  expect(buf.readUInt32LE(eocd + 16)).toBe(at); // the central directory starts where the entries end
  return out;
}

async function exportZip(actorId: string, conversationId = groupId): Promise<{ fileName: string; files: Map<string, Buffer> }> {
  const prepared = await exporter.prepare(actorId, conversationId);
  const chunks: Buffer[] = [];
  await prepared.write({ write: (c) => void chunks.push(Buffer.from(c)) });
  return { fileName: prepared.fileName, files: unzip(Buffer.concat(chunks)) };
}

describe('C · export: the super admin only, logged, transcript + media', () => {
  it('refuses every other role before reading anything', async () => {
    for (const who of [s.ownerId, s.managerId, s.parentId, s.teacherId]) {
      await expect(exporter.prepare(who, groupId)).rejects.toEqual(code(CommErrorCode.CONVERSATION_EXPORT_DENIED));
    }
    expect(await g.prisma.auditLog.count({ where: { action: 'conversation.exported' } })).toBe(0);
  });

  it('writes the transcript and the media; a deleted message keeps no media; the export is audited', async () => {
    const admin = await superAdmin();
    const bytes = Buffer.from(Array.from({ length: 2048 }, (_, i) => (i * 13 + 5) % 256));
    const upload = async (name: string) => {
      const auth = await g.attachments.authorizeUpload({ conversationId: groupId, actorId: s.ownerId, kind: 'image', mimeType: 'image/png', byteSize: bytes.length });
      await new LocalFsBlobStore().put(auth.objectKey, 'image/png', bytes);
      return g.messages.send({
        conversationId: groupId, senderId: s.ownerId, type: 'image', clientMessageId: randomUUID(),
        attachments: [{ kind: 'image', objectKey: auth.objectKey, mimeType: 'image/png', byteSize: bytes.length, originalName: name }],
      });
    };
    await say('السلام عليكم، الواجب: سورة الملك');
    await say('call them tomorrow', s.ownerId, { visibility: 'internal' });
    await upload('../../etc/passwd.png');
    const removed = await upload('removed.png');
    await g.messages.deleteForEveryone(removed.id, s.ownerId, 'test');

    const { fileName, files } = await exportZip(admin);
    expect(fileName).toMatch(/^jawwid-chat-\d{4}-\d{2}-\d{2}-[0-9a-f]{8}\.zip$/);
    expect([...files.keys()].sort()).toEqual(['chat.txt', 'media/0001-_.._etc_passwd.png']);
    expect(Buffer.compare(files.get('media/0001-_.._etc_passwd.png')!, bytes)).toBe(0);

    const text = files.get('chat.txt')!.toString('utf8');
    expect(text.charCodeAt(0)).toBe(0xfeff);
    expect(text).toContain('السلام عليكم، الواجب: سورة الملك');
    expect(text).toMatch(/\(internal staff note\) call them tomorrow/);
    expect(text).toContain('<attached: media/0001-_.._etc_passwd.png>');
    expect(text).toContain('This message was deleted.');
    expect(text).not.toContain('removed.png');
    // Oldest first.
    expect(text.indexOf('سورة الملك')).toBeLessThan(text.indexOf('call them tomorrow'));

    const audit = await g.prisma.auditLog.findMany({ where: { action: 'conversation.exported' } });
    expect(audit).toHaveLength(1);
    expect(audit[0]).toEqual(expect.objectContaining({ actorId: admin, entityId: groupId }));
    expect(audit[0]!.after).toEqual(expect.objectContaining({ mediaFiles: 1, internalNotes: 1 }));
    // The audit and the archive describe the same messages.
    const messages = (audit[0]!.after as { messages: number }).messages;
    expect(text).toContain(`Messages: ${messages}, media files: 1`);
  });

  it('never exports a file outside this conversation, whatever row points at it (review fix, PR #68)', async () => {
    const admin = await superAdmin();
    const secret = Buffer.from('another family\'s photo');
    // A real object in ANOTHER conversation's namespace...
    const foreign = await g.attachments.authorizeUpload({ conversationId: directId, actorId: s.ownerId, kind: 'image', mimeType: 'image/png', byteSize: secret.length });
    await new LocalFsBlobStore().put(foreign.objectKey, 'image/png', secret);
    // ...and a row in THIS conversation pointing at it (no API path writes one; a bad migration could).
    const host = await say('see attached');
    await g.prisma.messageAttachment.create({
      data: { messageId: host.id, kind: 'image', objectKey: foreign.objectKey, mimeType: 'image/png', byteSize: secret.length, originalName: 'leak.png' },
    });

    const { files } = await exportZip(admin);
    expect([...files.keys()]).toEqual(['chat.txt']);
    expect(files.get('chat.txt')!.toString('utf8')).toContain('<file missing: media/0001-leak.png>');
  });
});
