/**
 * The three findings the Phase 1 security review closed, and their regressions.
 *
 *   A-7 / RT-012  the receipt roster -- which staff member read a message, and
 *                 when -- was served to whoever could read the message,
 *                 including the family contact.
 *   A-8 / RT-006  signUrlsForMessages() minted signed object URLs for any
 *                 message id it was handed, performing no scoping of its own.
 *   (new)         delete-for-everyone compared `staffRole === 'manager'`, which
 *                 excluded super_admin and could not see a per-account DENY on
 *                 messages.delete.
 */
import { randomUUID } from 'node:crypto';
import { buildGraph, seed, truncate, Scenario } from './harness';
import { CommErrorCode } from '@platform/errors';

const g = buildGraph();
let s: Scenario;
let conversationId: string;

beforeEach(async () => {
  g.coverage.onDutyId = null;
  await truncate(g.prisma);
  s = await seed(g.prisma);
  const conv = await g.conversations.getOrCreateDirect(s.ownerId, s.parentId);
  conversationId = conv.id;
});

afterAll(async () => {
  await g.prisma.$disconnect();
});

// -------------------------------------------------------------------------
describe('A-7 / RT-012 · the receipt roster is viewer-scoped', () => {
  it('a family contact sees only their OWN receipt, never the staff roster', async () => {
    g.coverage.onDutyId = s.ownerId;
    await g.messages.send({ conversationId, senderId: s.ownerId, body: 'from Jawwid' });

    const asParent = await g.messages.list({ conversationId, actorId: s.parentId });
    const receipts = asParent.messages.flatMap((m) => m.receipts);
    expect(receipts.length).toBeGreaterThan(0);
    for (const r of receipts) expect(r.actorId).toBe(s.parentId);
    // The staff member's read time is not in the payload at all.
    expect(receipts.map((r) => r.actorId)).not.toContain(s.ownerId);
  });

  it('a supervisor still sees the full roster -- they need it to do the job', async () => {
    await g.messages.send({ conversationId, senderId: s.parentId, body: 'from the family' });
    const asStaff = await g.messages.list({ conversationId, actorId: s.ownerId });
    const receipts = asStaff.messages.flatMap((m) => m.receipts);
    expect(receipts.map((r) => r.actorId)).toContain(s.ownerId);
  });

  it('a teacher sees only their own receipt in a group', async () => {
    const group = await g.conversations.ensureStudentGroup(s.learnerId);
    await g.messages.send({ conversationId: group.id, senderId: s.parentId, body: 'hello all' });

    const asTeacher = await g.messages.list({ conversationId: group.id, actorId: s.teacherId });
    for (const r of asTeacher.messages.flatMap((m) => m.receipts)) {
      expect(r.actorId).toBe(s.teacherId);
    }
  });

  it('a caller that does not say who is looking gets no roster at all', async () => {
    // The default is the restrictive one: a forgotten argument discloses less,
    // not more.
    g.coverage.onDutyId = s.ownerId;
    await g.messages.send({ conversationId, senderId: s.ownerId, body: 'anything' });

    const { toMessageDto } = await import('@communication/contracts/dto');
    const row = await g.prisma.message.findFirst({
      where: { conversationId },
      include: { receipts: true },
    });
    expect(row!.conversationId).toBe(conversationId);
    expect(toMessageDto(row as never).receipts).toEqual([]);
  });
});

// -------------------------------------------------------------------------
describe('A-8 / RT-006 · signed URLs cannot escape the conversation they were asked for', () => {
  it('refuses to sign an attachment belonging to another conversation', async () => {
    const other = await g.conversations.ensureStudentGroup(s.learnerId);
    // Staff may only speak to a family they are on duty for; that is the
    // ordinary send rule, and it is not what this test is about.
    g.coverage.onDutyId = s.ownerId;
    const withAttachment = await g.messages.send({
      conversationId: other.id,
      senderId: s.ownerId,
      body: null,
      type: 'image',
      attachments: [
        {
          kind: 'image',
          objectKey: `conversations/${other.id}/${randomUUID()}.jpg`,
          mimeType: 'image/jpeg',
          byteSize: 1024,
        },
      ],
    });

    // The message id is real and its attachment exists -- but it is named
    // against the WRONG conversation, and nothing is signed.
    const signed = await g.attachments.signUrlsForMessages(
      [withAttachment.id],
      conversationId,
    );
    expect(signed.size).toBe(0);

    // Named against its own conversation, it signs as expected.
    expect((await g.attachments.signUrlsForMessages([withAttachment.id], other.id)).size).toBe(1);
  });
});

// -------------------------------------------------------------------------
describe('delete-for-everyone is a PERMISSION, not a role name', () => {
  it('a super_admin may delete another actor\'s message', async () => {
    const posted = await g.messages.send({
      conversationId,
      senderId: s.parentId,
      body: 'a message somebody else wrote',
    });
    await g.prisma.staff.update({ where: { id: s.managerId }, data: { role: 'super_admin' } });

    await g.messages.deleteForEveryone(posted.id, s.managerId, 'policy violation');
    const row = await g.prisma.message.findUnique({ where: { id: posted.id } });
    expect(row!.deletedForAll).toBe(true);
  });

  it('a manager with messages.delete DENIED cannot, however senior the role', async () => {
    const posted = await g.messages.send({
      conversationId,
      senderId: s.parentId,
      body: 'a message somebody else wrote',
    });
    await g.prisma.accountPermissionOverride.create({
      data: {
        accountId: s.accounts[s.managerId],
        permission: 'messages.delete',
        effect: 'deny',
        reason: 'test: an individual restriction',
      },
    });

    await expect(
      g.messages.deleteForEveryone(posted.id, s.managerId, 'attempt'),
    ).rejects.toMatchObject({ code: CommErrorCode.NOT_MESSAGE_AUTHOR });
  });

  it('an author may still delete their own within the window', async () => {
    const posted = await g.messages.send({
      conversationId,
      senderId: s.parentId,
      body: 'mine to withdraw',
    });
    await g.messages.deleteForEveryone(posted.id, s.parentId, 'sent by mistake');
    const row = await g.prisma.message.findUnique({ where: { id: posted.id } });
    expect(row!.deletedForAll).toBe(true);
  });
});
