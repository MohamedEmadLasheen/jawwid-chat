/**
 * PD-37 (closes RT-012): read state is no longer handed to every reader.
 *
 * Before this, every message on every page carried every recipient's
 * delivered/read times -- so a parent learned when the teacher and the
 * supervisor read each message, silent members and deleted messages included.
 * Now the message page carries one aggregate `status`, on the viewer's own
 * messages only, and the roster is `info()`, for the author or staff.
 *
 * The cast, in the learner's Student Group:
 *   parent_p (writer), parent_q, teacher_c, admin_a (supervisor) -- seated;
 *   admin_b -- a SILENT member;
 *   observer_o -- a member in the OBSERVER role;
 *   manager_c -- reads through PD-8 standing (manages Operations) without a seat.
 */
import { randomUUID } from 'node:crypto';
import { CommErrorCode } from '@platform/errors';
import { buildGraph, seed, truncate, Scenario } from './harness';

jest.setTimeout(60_000);

const g = buildGraph();
let s: Scenario;
let observerId: string;
let groupId: string;

beforeAll(async () => {
  await g.prisma.$connect();
});
afterAll(async () => {
  await g.prisma.$disconnect();
});
beforeEach(async () => {
  await truncate(g.prisma);
  s = await seed(g.prisma);
  g.coverage.onDutyId = s.ownerId;
  observerId = randomUUID();
  await g.prisma.$executeRawUnsafe(
    `insert into chat.staff (id, name, role, is_active) values ('${observerId}'::uuid, 'observer_o', 'admin', true)`,
  );
  groupId = (await g.conversations.ensureStudentGroup(s.learnerId, s.ownerId)).id;
  await g.prisma.conversationMember.createMany({
    data: [
      { conversationId: groupId, actorId: s.otherAdminId, actorKind: 'staff', memberRole: 'admin', isSilent: true },
      { conversationId: groupId, actorId: observerId, actorKind: 'staff', memberRole: 'observer' },
    ],
  });
});

const seated = () => [s.otherParentId, s.teacherId, s.ownerId];

async function lastSeq(): Promise<string> {
  const c = await g.prisma.conversation.findUniqueOrThrow({ where: { id: groupId } });
  return c.lastSeq.toString();
}

async function readAll(actorIds: string[]) {
  const seq = await lastSeq();
  for (const id of actorIds) await g.messages.markReadUpTo(groupId, id, seq);
}

/**
 * The silent and the observer member are staff with no PD-8 charge over this
 * family, so the read route refuses them outright. What matters here is that
 * their receipt rows exist and say "read" -- so write them as read directly,
 * the strongest case: even a recorded read never counts.
 */
async function forceRead(actorIds: string[]) {
  await g.prisma.messageReceipt.updateMany({
    where: { actorId: { in: actorIds }, message: { conversationId: groupId } },
    data: { state: 'read', readAt: new Date(), deliveredAt: new Date() },
  });
}

async function viewOf(actorId: string, messageId: string) {
  const page = await g.messages.list({ conversationId: groupId, actorId });
  return page.messages.find((m) => m.id === messageId)!;
}

describe('PD-37: no per-recipient read state on the message page', () => {
  it('no reader -- parent, teacher, staff, author -- receives a receipts roster', async () => {
    const m = await g.messages.send({ conversationId: groupId, senderId: s.teacherId, body: 'homework' });
    await readAll([s.parentId, s.ownerId]);

    for (const viewer of [s.parentId, s.otherParentId, s.teacherId, s.ownerId, s.managerId]) {
      const dto = await viewOf(viewer, m.id);
      expect(Object.keys(dto)).not.toContain('receipts');
      expect(JSON.stringify(dto)).not.toMatch(/readAt|deliveredAt/);
    }
    // A parent cannot see whether the teacher's message was read, by whom or when.
    expect((await viewOf(s.parentId, m.id)).status).toBeNull();
  });

  it("the author's ticks turn blue only when EVERY seated reader read it; silent, observer and standing readers never count", async () => {
    const m = await g.messages.send({ conversationId: groupId, senderId: s.parentId, body: 'is class on today?' });
    expect((await viewOf(s.parentId, m.id)).status).toBe('sent');

    // Everyone who must not count reads it -- nothing changes for the author.
    await forceRead([s.otherAdminId, observerId]);
    await readAll([s.managerId]);
    expect(await g.prisma.messageReceipt.count({ where: { messageId: m.id, actorId: s.managerId } })).toBe(0);
    expect((await viewOf(s.parentId, m.id)).status).toBe('sent');

    await readAll([s.otherParentId, s.teacherId]);
    expect((await viewOf(s.parentId, m.id)).status).toBe('sent'); // the supervisor has not

    await readAll([s.ownerId]);
    expect((await viewOf(s.parentId, m.id)).status).toBe('read');
  });

  it('a silent or observer member who never reads does not hold the ticks back', async () => {
    const m = await g.messages.send({ conversationId: groupId, senderId: s.parentId, body: 'see you at five' });
    await readAll(seated());
    const unread = await g.prisma.messageReceipt.findMany({
      where: { messageId: m.id, actorId: { in: [s.otherAdminId, observerId] } },
    });
    expect(unread.map((r) => r.state)).toEqual(['sent', 'sent']); // they have rows, unread
    expect((await viewOf(s.parentId, m.id)).status).toBe('read');
  });

  it('a deleted-for-all message carries no status and has no info', async () => {
    const m = await g.messages.send({ conversationId: groupId, senderId: s.parentId, body: 'oops' });
    await readAll(seated());
    await g.messages.deleteForEveryone(m.id, s.parentId, 'sent by mistake');

    expect((await viewOf(s.parentId, m.id)).status).toBeNull();
    await expect(g.messages.info(groupId, m.id, s.parentId)).rejects.toMatchObject({
      code: CommErrorCode.MESSAGE_NOT_FOUND,
    });
  });
});

describe('PD-37: Message info', () => {
  it('lists the seated readers with times; never the silent, observer or standing reader', async () => {
    const m = await g.messages.send({ conversationId: groupId, senderId: s.parentId, body: 'thank you' });
    await readAll([s.teacherId, s.managerId]);
    await forceRead([s.otherAdminId, observerId]);
    await g.messages.markState([m.id], s.ownerId, 'delivered');

    const info = await g.messages.info(groupId, m.id, s.parentId);
    expect(info.status).toBe('sent');
    expect(info.readBy.map((e) => e.actorId)).toEqual([s.teacherId]);
    expect(info.readBy[0].at).not.toBeNull();
    expect(info.readBy[0].displayName).toBe('teacher_c');
    expect(info.deliveredTo.map((e) => e.actorId)).toEqual([s.ownerId]);
    expect(info.pending.map((e) => e.actorId)).toEqual([s.otherParentId]);

    const listed = [...info.readBy, ...info.deliveredTo, ...info.pending].map((e) => e.actorId);
    for (const hidden of [s.otherAdminId, observerId, s.managerId, s.parentId]) {
      expect(listed).not.toContain(hidden);
    }
  });

  it("a parent cannot open info on the teacher's or the supervisor's message", async () => {
    const fromTeacher = await g.messages.send({ conversationId: groupId, senderId: s.teacherId, body: 'lesson notes' });
    const fromSupervisor = await g.messages.send({ conversationId: groupId, senderId: s.ownerId, body: 'schedule' });
    await readAll(seated());

    for (const m of [fromTeacher, fromSupervisor]) {
      await expect(g.messages.info(groupId, m.id, s.parentId)).rejects.toMatchObject({
        code: CommErrorCode.NOT_MESSAGE_AUTHOR,
      });
    }
    // ...nor can the teacher open it on the supervisor's.
    await expect(g.messages.info(groupId, fromSupervisor.id, s.teacherId)).rejects.toMatchObject({
      code: CommErrorCode.NOT_MESSAGE_AUTHOR,
    });
  });

  it('staff may open info on any message they can read, including a reader with standing only', async () => {
    const m = await g.messages.send({ conversationId: groupId, senderId: s.parentId, body: 'question' });
    await readAll([s.teacherId]);
    const info = await g.messages.info(groupId, m.id, s.managerId);
    expect(info.readBy.map((e) => e.actorId)).toEqual([s.teacherId]);
  });

  it('is refused to someone who cannot read the conversation, and outside the named conversation', async () => {
    const m = await g.messages.send({ conversationId: groupId, senderId: s.parentId, body: 'hello' });
    await expect(g.messages.info(groupId, m.id, s.unrelatedTeacherId)).rejects.toBeDefined();
    await expect(g.messages.info(randomUUID(), m.id, s.parentId)).rejects.toMatchObject({
      code: CommErrorCode.MESSAGE_NOT_FOUND,
    });
  });

  it('a message the viewer deleted for themselves has no info for them', async () => {
    const m = await g.messages.send({ conversationId: groupId, senderId: s.parentId, body: 'draft' });
    await g.messages.deleteForMe(m.id, s.parentId);
    await expect(g.messages.info(groupId, m.id, s.parentId)).rejects.toMatchObject({
      code: CommErrorCode.MESSAGE_NOT_FOUND,
    });
  });
});

describe('PD-37: a 1:1 with Jawwid', () => {
  it("the parent's ticks follow the supervisor's read", async () => {
    const conv = await g.conversations.getOrCreateDirect(s.parentId, s.ownerId);
    const m = await g.messages.send({ conversationId: conv.id, senderId: s.parentId, body: 'hi' });
    const statusFor = async () =>
      (await g.messages.list({ conversationId: conv.id, actorId: s.parentId })).messages.find((x) => x.id === m.id)!.status;

    expect(await statusFor()).toBe('sent');
    await g.messages.markState([m.id], s.ownerId, 'delivered');
    expect(await statusFor()).toBe('delivered');
    await g.messages.markReadUpTo(conv.id, s.ownerId, m.seq!);
    expect(await statusFor()).toBe('read');
  });
});
