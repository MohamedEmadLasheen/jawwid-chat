/**
 * Edited messages and favorite chats (owner request 2026-10-19). Labels are
 * staff-tools.spec.ts (#66: private to each staff member).
 *
 *   A. an author edits their own published text within the window; the old
 *      wording is kept; nobody else edits; approval is never bypassed
 *   B. the database refuses any body rewrite that is not a recorded edit
 *   C. favorites are the viewer's own
 */
import { randomUUID } from 'node:crypto';
import { CommErrorCode } from '@platform/errors';
import { ConversationController } from '@communication/api/conversation.controller';
import { buildGraph, seed, truncate, Scenario } from './harness';

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

  it('only the author may edit', async () => {
    const m = await say('from the admin');
    // Readers who are not the author -- a manager (who may delete it), a parent.
    await expect(g.messages.edit(m.id, s.managerId, 'hijack')).rejects.toEqual(code(CommErrorCode.NOT_MESSAGE_AUTHOR));
    await expect(g.messages.edit(m.id, s.parentId, 'hijack')).rejects.toEqual(code(CommErrorCode.NOT_MESSAGE_AUTHOR));
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

  it('a parent whose group messages are held for approval may not edit them', async () => {
    const held = await say('a question', s.parentId);
    expect(held.moderation).toBe('pending');
    await expect(g.messages.edit(held.id, s.parentId, 'changed')).rejects.toEqual(code(CommErrorCode.MESSAGE_NOT_EDITABLE));
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

  it('never bypasses approval: a held message, and an approved one, cannot be edited', async () => {
    const held = await say('homework', s.teacherId);
    expect(held.moderation).toBe('pending');
    await expect(g.messages.edit(held.id, s.teacherId, 'changed while held')).rejects.toEqual(code(CommErrorCode.MESSAGE_NOT_EDITABLE));

    const approval = await g.prisma.messageApproval.findUniqueOrThrow({ where: { messageId: held.id } });
    await g.approvals.approve(approval.id, s.ownerId);
    await expect(g.messages.edit(held.id, s.teacherId, 'changed after approval')).rejects.toEqual(code(CommErrorCode.MESSAGE_NOT_EDITABLE));
    expect((await g.prisma.message.findUniqueOrThrow({ where: { id: held.id } })).body).toBe('homework');
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

  it('a revision cannot launder a rewrite of an approved message, and revisions are immutable', async () => {
    const held = await say('homework', s.teacherId);
    const approval = await g.prisma.messageApproval.findUniqueOrThrow({ where: { messageId: held.id } });
    await g.approvals.approve(approval.id, s.ownerId);
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
