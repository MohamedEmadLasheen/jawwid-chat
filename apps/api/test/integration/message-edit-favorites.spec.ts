/**
 * Edited messages and favorite chats (owner request 2026-10-19). Labels are
 * staff-tools.spec.ts (#66: private to each staff member).
 *
 *   A. an author edits their own published text within the window; the old
 *      wording is kept; a message still held from before PD-14 is not editable
 *   B. the database refuses any body rewrite that is not a recorded edit
 *   C. favorites are the viewer's own
 *   D. PD-14 (2026-10-20): an admin in charge edits or deletes someone else's
 *      message after it was sent, at any age; the revision names the admin
 */
import { randomUUID } from 'node:crypto';
import { CommErrorCode } from '@platform/errors';
import { ConversationController } from '@communication/api/conversation.controller';
import { buildGraph, legacyHeldMessage, seed, truncate, Scenario } from './harness';

jest.setTimeout(60_000);

const g = buildGraph();
let s: Scenario;
let groupId: string;
let controller: ConversationController;

const code = (c: CommErrorCode) => expect.objectContaining({ code: c });

async function say(body: string, senderId = s.ownerId, extra: Record<string, unknown> = {}) {
  return g.messages.send({ conversationId: groupId, senderId, body, clientMessageId: randomUUID(), ...extra });
}

beforeAll(async () => { await g.prisma.$connect(); });
afterAll(async () => {
  await truncate(g.prisma);
  await g.prisma.$disconnect();
});
beforeEach(async () => {
  await truncate(g.prisma);
  s = await seed(g.prisma);
  g.coverage.onDutyId = s.ownerId;
  groupId = (await g.conversations.ensureStudentGroup(s.learnerId, s.ownerId)).id;
  controller = new ConversationController(g.conversations, g.messages, g.calls, g.authz);
});

describe('A · editing a message', () => {
  it('the author rewrites their text; everyone reads the new wording, marked edited; the old one is kept', async () => {
    const m = await say('Lesson is at 5');
    const edited = await g.messages.edit(m.id, s.ownerId, '  Lesson is at 6  ', groupId);
    expect(edited.body).toBe('Lesson is at 6');
    expect(edited.editedAt).not.toBeNull();

    const forParent = (await g.messages.list({ conversationId: groupId, actorId: s.parentId })).messages.find((x) => x.id === m.id)!;
    expect(forParent.body).toBe('Lesson is at 6');
    expect(forParent.editedAt).toBe(edited.editedAt);

    const revisions = await g.prisma.messageRevision.findMany({ where: { messageId: m.id } });
    expect(revisions.map((r) => r.previousBody)).toEqual(['Lesson is at 5']);
    expect(revisions[0]!.editedBy).toBe(s.ownerId);

    // Announced without the text; audited without the text.
    const events = await g.prisma.outboxEvent.findMany({ where: { type: 'message.updated' } });
    expect(events).toHaveLength(1);
    expect(events[0]!.payload).toEqual({
      conversationId: groupId, messageId: m.id, visibility: 'customer', editedAt: edited.editedAt,
    });
    const audit = await g.prisma.auditLog.findFirst({ where: { action: 'message.edit', entityId: m.id } });
    expect(audit).not.toBeNull();
    expect(JSON.stringify({ ...audit, id: undefined })).not.toContain('Lesson is at');

    // The chat-list preview follows the edit.
    const row = (await controller.list(s.parentId)).conversations.find((c) => c.id === groupId)!;
    expect(row.lastMessage?.text).toBe('Lesson is at 6');
  });

  it('an unchanged body is a no-op: no revision, no event', async () => {
    const m = await say('same');
    await g.messages.edit(m.id, s.ownerId, 'same');
    expect(await g.prisma.messageRevision.count()).toBe(0);
    expect(await g.prisma.outboxEvent.count({ where: { type: 'message.updated' } })).toBe(0);
  });

  it("nobody but the author edits an admin's message -- except who moderates staff (D)", async () => {
    const m = await say('from the admin');
    // Readers who are not the author and do not moderate it: a parent, a teacher.
    await expect(g.messages.edit(m.id, s.parentId, 'hijack')).rejects.toEqual(code(CommErrorCode.NOT_MESSAGE_AUTHOR));
    await expect(g.messages.edit(m.id, s.teacherId, 'hijack')).rejects.toEqual(code(CommErrorCode.NOT_MESSAGE_AUTHOR));
    // Staff outside the family's charge, and an outsider, cannot even read it.
    await expect(g.messages.edit(m.id, s.otherAdminId, 'hijack')).rejects.toBeTruthy();
    await expect(g.messages.edit(m.id, s.unrelatedTeacherId, 'hijack')).rejects.toBeTruthy();
    expect((await g.prisma.message.findUniqueOrThrow({ where: { id: m.id } })).body).toBe('from the admin');
  });

  it('a parent edits their own published message in their 1:1 with the admin (the rule is the author)', async () => {
    const direct = await g.conversations.getOrCreateDirect(s.ownerId, s.parentId);
    const m = await g.messages.send({ conversationId: direct.id, senderId: s.parentId, body: 'my son is sick', clientMessageId: randomUUID() });
    expect(m.moderation).toBe('published');
    const edited = await g.messages.edit(m.id, s.parentId, 'my son is sick today', direct.id);
    expect(edited.body).toBe('my son is sick today');
  });

  it('PD-14: a parent edits their own group message -- nothing is held any more', async () => {
    const m = await say('a question', s.parentId);
    expect(m.moderation).toBe('published');
    expect((await g.messages.edit(m.id, s.parentId, 'a better question')).body).toBe('a better question');
  });

  it('refuses after the window, an empty body, the wrong conversation, and a deleted message', async () => {
    const m = await say('typo');
    await expect(g.messages.edit(m.id, s.ownerId, '   ')).rejects.toEqual(code(CommErrorCode.EMPTY_MESSAGE));
    const other = await g.conversations.getOrCreateDirect(s.ownerId, s.parentId);
    await expect(g.messages.edit(m.id, s.ownerId, 'x', other.id)).rejects.toEqual(code(CommErrorCode.MESSAGE_NOT_FOUND));

    await g.prisma.message.update({ where: { id: m.id }, data: { createdAt: new Date(Date.now() - 16 * 60_000) } });
    await expect(g.messages.edit(m.id, s.ownerId, 'too late')).rejects.toEqual(code(CommErrorCode.EDIT_WINDOW_EXPIRED));

    const gone = await say('to delete');
    await g.messages.deleteForEveryone(gone.id, s.ownerId, 'mistake');
    await expect(g.messages.edit(gone.id, s.ownerId, 'revive')).rejects.toEqual(code(CommErrorCode.MESSAGE_NOT_EDITABLE));
  });

  it('a message still held from before PD-14 is edited by nobody until decided; once approved it is an ordinary message', async () => {
    const held = await legacyHeldMessage(g, { conversationId: groupId, senderId: s.teacherId, body: 'homework' });
    await expect(g.messages.edit(held.id, s.teacherId, 'changed while held')).rejects.toEqual(code(CommErrorCode.MESSAGE_NOT_EDITABLE));
    await expect(g.messages.edit(held.id, s.ownerId, 'changed while held')).rejects.toEqual(code(CommErrorCode.MESSAGE_NOT_EDITABLE));
    expect((await g.prisma.message.findUniqueOrThrow({ where: { id: held.id } })).body).toBe('homework');

    await g.approvals.approve(held.approvalId, s.ownerId);
    // An approved text is no longer frozen (PD-14 retired "an approver never edits").
    expect((await g.messages.edit(held.id, s.ownerId, 'homework: pages 4-5')).body).toBe('homework: pages 4-5');
  });

  it('reading is not enough: in an archived conversation nobody edits', async () => {
    const m = await say('before the archive');
    await g.prisma.conversation.update({ where: { id: groupId }, data: { archivedAt: new Date() } });
    await expect(g.messages.edit(m.id, s.ownerId, 'after')).rejects.toEqual(code(CommErrorCode.CONVERSATION_ARCHIVED));
  });

  it('an internal note is edited and announced as internal', async () => {
    const note = await say('call them tomorrow', s.ownerId, { visibility: 'internal' });
    await g.messages.edit(note.id, s.ownerId, 'call them on Sunday');
    const ev = await g.prisma.outboxEvent.findFirstOrThrow({ where: { type: 'message.updated' } });
    expect((ev.payload as { visibility: string }).visibility).toBe('internal');
    // And a parent still cannot reach it.
    await expect(g.messages.edit(note.id, s.parentId, 'x')).rejects.toEqual(code(CommErrorCode.MESSAGE_NOT_FOUND));
  });
});

describe('B · the database refuses every other rewrite', () => {
  it('a body change without a revision row is refused', async () => {
    const m = await say('original');
    await expect(
      g.prisma.$executeRawUnsafe(`update chat.message set body = 'tampered', edited_at = now() where id = '${m.id}'`),
    ).rejects.toThrow(/immutable/);
  });

  it('a revision cannot launder a rewrite of a message still held, and revisions are immutable', async () => {
    const held = await legacyHeldMessage(g, { conversationId: groupId, senderId: s.teacherId, body: 'homework' });
    const at = new Date();
    await g.prisma.messageRevision.create({
      data: { messageId: held.id, previousBody: 'homework', editedBy: s.teacherId, editedByKind: 'teacher', editedAt: at },
    });
    await expect(
      g.prisma.message.update({ where: { id: held.id }, data: { body: 'tampered', editedAt: at } }),
    ).rejects.toThrow(/immutable/);

    await expect(
      g.prisma.$executeRawUnsafe(`update chat.message_revision set previous_body = 'x' where message_id = '${held.id}'`),
    ).rejects.toThrow(/immutable/);
  });
});

describe('C · favorites are the viewer\'s own', () => {
  it('marks the chat for the viewer only', async () => {
    await g.conversations.setPreferences(groupId, s.ownerId, { favorite: true });
    const mine = (await controller.list(s.ownerId)).conversations.find((c) => c.id === groupId)!;
    const theirs = (await controller.list(s.parentId)).conversations.find((c) => c.id === groupId)!;
    expect(mine.viewerState?.favorite).toBe(true);
    expect(theirs.viewerState?.favorite).toBe(false);

    await g.conversations.setPreferences(groupId, s.ownerId, { favorite: false });
    expect((await controller.get(s.ownerId, groupId)).viewerState?.favorite).toBe(false);
  });
});

describe('D · PD-14: an admin in charge moderates after sending', () => {
  const old = (id: string) =>
    g.prisma.message.update({ where: { id }, data: { createdAt: new Date(Date.now() - 3 * 24 * 60 * 60_000) } });

  it("the children's supervisor edits a parent's days-old message: everyone reads it edited, the revision names the supervisor", async () => {
    const m = await say('rude words', s.parentId);
    await old(m.id);
    const edited = await g.messages.edit(m.id, s.ownerId, 'kind words', groupId);
    expect(edited.body).toBe('kind words');
    expect(edited.authorId).toBe(s.parentId); // still the parent's message

    const forTeacher = (await g.messages.list({ conversationId: groupId, actorId: s.teacherId })).messages.find((x) => x.id === m.id)!;
    expect([forTeacher.body, forTeacher.editedAt]).toEqual(['kind words', edited.editedAt]);

    const [rev] = await g.prisma.messageRevision.findMany({ where: { messageId: m.id } });
    expect(rev).toMatchObject({ previousBody: 'rude words', editedBy: s.ownerId, editedByKind: 'staff' });
    const audit = await g.prisma.auditLog.findFirstOrThrow({ where: { action: 'message.edit', entityId: m.id } });
    expect(audit.actorId).toBe(s.ownerId);
    expect(audit.reason).toBe('edited by group admin (PD-14)');
    // The author's own window still applies to the author.
    await expect(g.messages.edit(m.id, s.parentId, 'back again')).rejects.toEqual(code(CommErrorCode.EDIT_WINDOW_EXPIRED));
  });

  it("the supervisor deletes a teacher's days-old message for everyone", async () => {
    const m = await say('wrong link', s.teacherId);
    await old(m.id);
    await g.messages.deleteForEveryone(m.id, s.ownerId, 'shared a private link');
    const row = await g.prisma.message.findUniqueOrThrow({ where: { id: m.id } });
    expect([row.deletedForAll, row.deletedBy]).toEqual([true, s.ownerId]);
    const forParent = (await g.messages.list({ conversationId: groupId, actorId: s.parentId })).messages.find((x) => x.id === m.id)!;
    expect(forParent.deletedForAll).toBe(true);
    expect(forParent.body).toBeNull();
  });

  it("a supervisor never rewrites a colleague; the department manager may", async () => {
    const m = await say('from the supervisor');
    await old(m.id);
    const fromManager = await say('from the manager', s.managerId);
    await expect(g.messages.edit(fromManager.id, s.ownerId, 'x')).rejects.toEqual(code(CommErrorCode.NOT_MESSAGE_AUTHOR));
    await expect(g.messages.deleteForEveryone(fromManager.id, s.ownerId, 'x')).rejects.toEqual(code(CommErrorCode.NOT_MESSAGE_AUTHOR));

    expect((await g.messages.edit(m.id, s.managerId, 'from the supervisor, corrected')).body).toBe('from the supervisor, corrected');
  });

  it('no charge over the conversation, no moderation: an out-of-scope admin and a teacher are refused, nothing changes', async () => {
    const m = await say('a question', s.parentId);
    await expect(g.messages.edit(m.id, s.otherAdminId, 'x')).rejects.toBeTruthy();
    await expect(g.messages.deleteForEveryone(m.id, s.otherAdminId, 'x')).rejects.toBeTruthy();
    await expect(g.messages.edit(m.id, s.teacherId, 'x')).rejects.toEqual(code(CommErrorCode.NOT_MESSAGE_AUTHOR));
    await expect(g.messages.deleteForEveryone(m.id, s.teacherId, 'x')).rejects.toEqual(code(CommErrorCode.NOT_MESSAGE_AUTHOR));
    const row = await g.prisma.message.findUniqueOrThrow({ where: { id: m.id } });
    expect([row.body, row.deletedForAll]).toEqual(['a question', false]);
  });

  it('a moderator edits text only, and only where they may still write', async () => {
    // A non-text message: retyped in place, because an upload is not this test's subject.
    const media = await say('caption', s.parentId);
    await g.prisma.message.update({ where: { id: media.id }, data: { type: 'image' } });
    await expect(g.messages.edit(media.id, s.ownerId, 'x')).rejects.toEqual(code(CommErrorCode.MESSAGE_NOT_EDITABLE));
    const m = await say('before the archive', s.parentId);
    await g.prisma.conversation.update({ where: { id: groupId }, data: { archivedAt: new Date() } });
    await expect(g.messages.edit(m.id, s.ownerId, 'after')).rejects.toEqual(code(CommErrorCode.CONVERSATION_ARCHIVED));
  });

  it('viewerModerates tells each viewer whose messages they moderate here', async () => {
    expect((await controller.get(s.ownerId, groupId)).viewerModerates).toEqual(['teacher', 'contact']);
    expect((await controller.get(s.managerId, groupId)).viewerModerates).toEqual(['teacher', 'contact', 'staff']);
    expect((await controller.get(s.parentId, groupId)).viewerModerates).toEqual([]);
    expect((await controller.get(s.teacherId, groupId)).viewerModerates).toEqual([]);
  });
});
