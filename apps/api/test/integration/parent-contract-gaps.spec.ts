/**
 * The Parent-contract gaps PR #27 identified, rebuilt on the PD-8 line:
 *
 *   viewerRequiresApproval  -- the viewer's OWN rule, from the same function
 *                              that decides a sent message's moderation;
 *   viewerState             -- pin / archive / mute read back;
 *   lastMessage             -- the newest message THIS viewer may see;
 *   ?q=                     -- search inside the caller's own list only;
 *   systemEvent             -- a system message's event, parsed server-side.
 *
 * The privacy edges are the point: a parent's preview never carries an
 * internal note, someone else's held message, or what they deleted for
 * themselves; search never returns a conversation the list would not.
 * Real database, real services. Synthetic people only.
 */
import { randomUUID } from 'node:crypto';
import { ConversationController } from '@communication/api/conversation.controller';
import type { ConversationDto } from '@communication/contracts/dto';
import { buildGraph, seed, truncate, withAssignmentGate, supervise, Scenario } from './harness';

jest.setTimeout(60_000);

const g = buildGraph();
let s: Scenario;
let controller: ConversationController;

beforeAll(async () => {
  await g.prisma.$connect();
});
afterAll(async () => {
  await truncate(g.prisma);
  await g.prisma.$disconnect();
});
beforeEach(async () => {
  await truncate(g.prisma);
  s = await seed(g.prisma);
  controller = new ConversationController(g.conversations, g.messages, g.calls, g.authz, g.labels);
});

const send = (conversationId: string, senderId: string, body: string, visibility = 'customer') =>
  g.messages.send({ conversationId, senderId, body, visibility, clientMessageId: randomUUID() });

async function listed(actorId: string, q?: string): Promise<ConversationDto[]> {
  return (await controller.list(actorId, q)).conversations;
}
const row = async (actorId: string, id: string, q?: string) => (await listed(actorId, q)).find((c) => c.id === id);

describe('viewerRequiresApproval -- the viewer\'s own rule, never the other role\'s', () => {
  it('in a group that holds parents\' messages but not teachers\', the parent is told yes and the teacher no', async () => {
    const group = await g.conversations.ensureStudentGroup(s.learnerId, s.ownerId);
    await g.prisma.conversation.update({
      where: { id: group.id },
      data: { parentRequiresApproval: true, teacherRequiresApproval: false },
    });
    expect((await row(s.parentId, group.id))!.viewerRequiresApproval).toBe(true);
    expect((await row(s.teacherId, group.id))!.viewerRequiresApproval).toBe(false);
    expect((await row(s.ownerId, group.id))!.viewerRequiresApproval).toBe(false);
    // ...and it agrees with what actually happens on send.
    expect((await send(group.id, s.parentId, 'held?')).moderation).toBe('pending');
    expect((await send(group.id, s.teacherId, 'published?')).moderation).toBe('published');
  });

  it('a 1:1 never holds anything, whatever the stored flags say', async () => {
    const direct = await g.conversations.getOrCreateDirect(s.parentId, s.ownerId);
    expect(direct.parentRequiresApproval).toBe(true);
    expect((await row(s.parentId, direct.id))!.viewerRequiresApproval).toBe(false);
    expect((await send(direct.id, s.parentId, 'hi')).moderation).toBe('published');
  });
});

describe('viewerState -- what setPreferences stored, read back', () => {
  it('pin, archive and mute come back on the list and on the detail, for this viewer only', async () => {
    const direct = await g.conversations.getOrCreateDirect(s.parentId, s.ownerId);
    const until = new Date(Date.now() + 3_600_000);
    await g.conversations.setPreferences(direct.id, s.parentId, { pinned: true, archived: true, mutedUntil: until });

    const mine = (await row(s.parentId, direct.id))!;
    expect(mine.viewerState).toEqual({ pinned: true, archived: true, mutedUntil: until.toISOString() });
    expect((await controller.get(s.parentId, direct.id)).viewerState!.pinned).toBe(true);
    // The other side's preferences are their own.
    expect((await row(s.ownerId, direct.id))!.viewerState).toEqual({ pinned: false, archived: false, mutedUntil: null });
  });
});

describe('lastMessage -- the newest message THIS viewer may see', () => {
  it('a parent never sees an internal note in the preview; staff do', async () => {
    const direct = await g.conversations.getOrCreateDirect(s.parentId, s.ownerId);
    await send(direct.id, s.ownerId, 'visible to the parent');
    await send(direct.id, s.ownerId, 'staff-only note', 'internal');

    expect((await row(s.parentId, direct.id))!.lastMessage!.text).toBe('visible to the parent');
    expect((await row(s.ownerId, direct.id))!.lastMessage!.text).toBe('staff-only note');
  });

  it("someone else's held message is never previewed; the author sees their own", async () => {
    const group = await g.conversations.ensureStudentGroup(s.learnerId, s.ownerId);
    await g.prisma.conversation.update({ where: { id: group.id }, data: { parentRequiresApproval: true } });
    await send(group.id, s.ownerId, 'published by the supervisor');
    await send(group.id, s.parentId, 'awaiting approval');

    expect((await row(s.parentId, group.id))!.lastMessage!.text).toBe('awaiting approval');
    expect((await row(s.otherParentId, group.id))!.lastMessage!.text).toBe('published by the supervisor');
    expect((await row(s.teacherId, group.id))!.lastMessage!.text).toBe('published by the supervisor');
  });

  it('what a viewer deleted for themselves is skipped; a message deleted for everyone shows as deleted, without text', async () => {
    const direct = await g.conversations.getOrCreateDirect(s.parentId, s.ownerId);
    await send(direct.id, s.ownerId, 'first');
    const second = await send(direct.id, s.ownerId, 'second');
    await g.messages.deleteForMe(second.id, s.parentId);
    expect((await row(s.parentId, direct.id))!.lastMessage!.text).toBe('first');

    const third = await send(direct.id, s.ownerId, 'third');
    await g.messages.deleteForEveryone(third.id, s.ownerId, 'sent by mistake');
    const preview = (await row(s.ownerId, direct.id))!.lastMessage!;
    expect([preview.deleted, preview.text]).toEqual([true, null]);
  });

  it('a system event is previewed by its kind, never as JSON text', async () => {
    const group = await g.conversations.ensureStudentGroup(s.learnerId, s.ownerId);
    const preview = (await row(s.parentId, group.id))!.lastMessage!;
    expect(preview.type).toBe('system');
    expect(preview.systemKind).toBe('group.created');
    expect(preview.text).toBeNull();
  });

  it('a conversation with nothing visible has a null preview', async () => {
    const direct = await g.conversations.getOrCreateDirect(s.parentId, s.ownerId);
    expect((await row(s.parentId, direct.id))!.lastMessage).toBeNull();
  });
});

describe('?q= -- search narrows the caller\'s own list and never widens it', () => {
  it('matches a title, a child\'s name and a member\'s name -- case-insensitively', async () => {
    const group = await g.conversations.ensureStudentGroup(s.learnerId, s.ownerId);
    const direct = await g.conversations.getOrCreateDirect(s.parentId, s.ownerId);
    expect((await listed(s.parentId, 'LEARNER_L')).map((c) => c.id)).toEqual([group.id]);
    expect((await listed(s.parentId, 'admin_a')).map((c) => c.id).sort()).toEqual([group.id, direct.id].sort());
    expect(await listed(s.parentId, 'nobody-is-called-this')).toEqual([]);
  });

  it("another family's conversation is never found, however exactly it is named", async () => {
    const familyY = randomUUID();
    const learnerY = randomUUID();
    await g.prisma.$executeRawUnsafe(
      `insert into chat.family (id, display_name, owner_id, language) values ('${familyY}'::uuid, 'family_y', '${s.ownerId}'::uuid, 'ar')`,
    );
    await g.prisma.$executeRawUnsafe(
      `insert into chat.contact (id, family_id, name, role_preset, can_message, is_active)
       values ('${randomUUID()}'::uuid, '${familyY}'::uuid, 'parent_y', 'primary_guardian', true, true)`,
    );
    await withAssignmentGate(g.prisma, `insert into chat.learner (id, family_id, name, teacher_id) values ('${learnerY}'::uuid, '${familyY}'::uuid, 'unique_child_y', null)`);
    await supervise(g.prisma, s.ownerId, [learnerY]);
    await g.conversations.ensureStudentGroup(learnerY, s.ownerId);

    expect(await listed(s.parentId, 'unique_child_y')).toEqual([]);
    // The supervisor, whose list it IS in, finds it.
    expect((await listed(s.ownerId, 'unique_child_y')).length).toBe(1);
    // ...and another Operations supervisor, outside PD-8 scope, does not.
    expect(await listed(s.otherAdminId, 'unique_child_y')).toEqual([]);
  });
});

describe('systemEvent -- parsed on the server, body unchanged for existing clients', () => {
  it('a system message carries its event; a text message carries none', async () => {
    const group = await g.conversations.ensureStudentGroup(s.learnerId, s.ownerId);
    await send(group.id, s.ownerId, 'hello');
    const page = await g.messages.list({ conversationId: group.id, actorId: s.parentId });
    const system = page.messages.find((m) => m.type === 'system')!;
    expect(system.systemEvent).toEqual(expect.objectContaining({ kind: 'group.created' }));
    expect(system.body).not.toBeNull();
    expect(page.messages.find((m) => m.type === 'text')!.systemEvent).toBeNull();
  });
});
