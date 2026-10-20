/**
 * Edited messages, chat labels and favorite chats (owner request 2026-10-19).
 *
 *   A. an author edits their own published text within the window; the old
 *      wording is kept; nobody else edits; approval is never bypassed
 *   B. the database refuses any body rewrite that is not a recorded edit
 *   C. favorites are the viewer's own
 *   D. labels are staff-only, shared within the organization, and never reach
 *      a parent or a teacher
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
  controller = new ConversationController(g.conversations, g.messages, g.calls, g.authz, g.labels);
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

describe('D · labels are staff tools', () => {
  it('staff create, rename, recolour and delete; names are unique per organization', async () => {
    const urgent = await g.labels.create(s.ownerId, { name: '  Payment   issue ', color: 3 });
    expect(urgent).toEqual({ id: expect.any(String), name: 'Payment issue', color: 3 });
    await expect(g.labels.create(s.otherAdminId, { name: 'payment ISSUE' })).rejects.toEqual(code(CommErrorCode.LABEL_NAME_TAKEN));
    await expect(g.labels.create(s.ownerId, { name: '' })).rejects.toEqual(code(CommErrorCode.VALIDATION));
    await expect(g.labels.create(s.ownerId, { name: 'x', color: 9 })).rejects.toEqual(code(CommErrorCode.VALIDATION));

    // Shared: another staff member sees and edits it.
    expect((await g.labels.list(s.otherAdminId)).labels.map((l) => l.name)).toEqual(['Payment issue']);
    const renamed = await g.labels.update(s.otherAdminId, urgent.id, { name: 'Billing', color: 5 });
    expect(renamed).toEqual({ id: urgent.id, name: 'Billing', color: 5 });

    await g.labels.remove(s.ownerId, urgent.id);
    expect((await g.labels.list(s.ownerId)).labels).toEqual([]);
    expect(await g.prisma.auditLog.count({ where: { entity: 'chat_label' } })).toBe(3);
  });

  it('a parent or a teacher has no labels at all', async () => {
    for (const who of [s.parentId, s.teacherId]) {
      await expect(g.labels.list(who)).rejects.toEqual(code(CommErrorCode.LABELS_STAFF_ONLY));
      await expect(g.labels.create(who, { name: 'mine' })).rejects.toEqual(code(CommErrorCode.LABELS_STAFF_ONLY));
    }
  });

  it('applied labels show on the staff list only; deleting a label removes it everywhere', async () => {
    const trial = await g.labels.create(s.ownerId, { name: 'Trial' });
    await g.labels.setOnConversation(s.ownerId, groupId, trial.id, true);
    await g.labels.setOnConversation(s.ownerId, groupId, trial.id, true); // idempotent

    const staffRow = (await controller.list(s.ownerId)).conversations.find((c) => c.id === groupId)!;
    expect(staffRow.labelIds).toEqual([trial.id]);
    expect((await controller.get(s.ownerId, groupId)).labelIds).toEqual([trial.id]);
    for (const who of [s.parentId, s.teacherId]) {
      const row = (await controller.list(who)).conversations.find((c) => c.id === groupId)!;
      expect(row).not.toHaveProperty('labelIds', expect.anything());
      expect(row.labelIds).toBeUndefined();
    }

    await g.labels.setOnConversation(s.ownerId, groupId, trial.id, false);
    expect((await controller.list(s.ownerId)).conversations.find((c) => c.id === groupId)!.labelIds).toEqual([]);

    await g.labels.setOnConversation(s.ownerId, groupId, trial.id, true);
    await g.labels.remove(s.ownerId, trial.id);
    expect(await g.prisma.conversationLabel.count()).toBe(0);
  });

  it('labelling needs read access, and an unknown label reads as absent', async () => {
    const l = await g.labels.create(s.ownerId, { name: 'VIP' });
    await expect(g.labels.setOnConversation(s.ownerId, groupId, randomUUID(), true)).rejects.toEqual(code(CommErrorCode.LABEL_NOT_FOUND));
    await expect(g.labels.setOnConversation(s.ownerId, randomUUID(), l.id, true)).rejects.toEqual(code(CommErrorCode.CONVERSATION_NOT_FOUND));
    await expect(g.labels.setOnConversation(s.parentId, groupId, l.id, true)).rejects.toEqual(code(CommErrorCode.LABELS_STAFF_ONLY));
  });

  it('the database keeps a label inside its organization', async () => {
    const org2 = randomUUID();
    await g.prisma.$executeRawUnsafe(`insert into chat.organization (id, slug, display_name) values ('${org2}', 'other-${org2.slice(0, 8)}', 'Other academy')`);
    await g.prisma.$executeRawUnsafe(
      `insert into chat.chat_label (organization_id, name, created_by) values ('${org2}', 'Foreign', '${s.ownerId}')`,
    );
    const foreign = await g.prisma.chatLabel.findFirstOrThrow({ where: { organizationId: org2 } });
    await expect(g.labels.setOnConversation(s.ownerId, groupId, foreign.id, true)).rejects.toEqual(code(CommErrorCode.LABEL_NOT_FOUND));
    await expect(
      g.prisma.$executeRawUnsafe(
        `insert into chat.conversation_label (conversation_id, label_id, labeled_by) values ('${groupId}', '${foreign.id}', '${s.ownerId}')`,
      ),
    ).rejects.toThrow(/organization/);
    await g.prisma.$executeRawUnsafe(`delete from chat.organization where id = '${org2}'`);
  });
});
