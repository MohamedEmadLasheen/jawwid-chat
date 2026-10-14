/**
 * PD-7 — no alternative path between a teacher and a parent outside the
 * Student Group.
 *
 * canOpenDirect / canSend / canCall and the database triggers close the main
 * doors (see br1-conformance, schema-invariants, relationship-predicate). This
 * file closes the side ones found in the 2026-10-14 bypass audit: a REACTION
 * and a TYPING indicator in a direct conversation left over from the PD-6
 * window only checked READ access, so a teacher could still signal a parent
 * there. History stays readable; nothing new gets through.
 */
import { randomUUID } from 'node:crypto';
import { CommError, CommErrorCode } from '@platform/errors';
import { buildGraph, legacyTeacherParentDirect, seed, truncate, Scenario } from './harness';

jest.setTimeout(60_000);

const g = buildGraph();
let s: Scenario;
let legacy: string;
let legacyMessageId: string;

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
  g.coverage.onDutyId = s.ownerId;
  legacy = await legacyTeacherParentDirect(g.prisma, s.teacherId, s.parentId, s.familyId);
  // A message from the PD-6 window, written as history (triggers bypassed).
  legacyMessageId = await g.prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`set local session_replication_role = replica`);
    const m = await tx.message.create({
      data: { conversationId: legacy, authorType: 'teacher', authorId: s.teacherId, type: 'text', body: 'from the PD-6 window', visibility: 'customer', seq: BigInt(1), attachmentsJson: [] },
    });
    return m.id;
  });
});

async function code(p: Promise<unknown>): Promise<string> {
  try {
    await p;
    return 'OK';
  } catch (e) {
    if (e instanceof CommError) return e.code;
    throw e;
  }
}

describe('PD-7 · side channels in a PD-6-era direct teacher<->parent conversation', () => {
  it('the conversation is detected as one (and a parent<->admin direct is not)', async () => {
    expect(await g.conversations.isDirectTeacherParent(legacy)).toBe(true);
    const adminDirect = await g.conversations.getOrCreateDirect(s.parentId, s.ownerId);
    expect(await g.conversations.isDirectTeacherParent(adminDirect.id)).toBe(false);
    const group = await g.conversations.ensureStudentGroup(s.learnerId, s.ownerId);
    expect(await g.conversations.isDirectTeacherParent(group.id)).toBe(false);
  });

  it('history stays readable to both members', async () => {
    for (const reader of [s.parentId, s.teacherId]) {
      const page = await g.messages.list({ conversationId: legacy, actorId: reader });
      expect(page.messages.map((m) => m.id)).toContain(legacyMessageId);
    }
  });

  it('a NEW reaction is refused from either side, and nothing is written', async () => {
    expect(await code(g.messages.react(legacyMessageId, s.parentId, '👍'))).toBe(CommErrorCode.BR1_TEACHER_PARENT_DIRECT);
    expect(await code(g.messages.react(legacyMessageId, s.teacherId, '👍'))).toBe(CommErrorCode.BR1_TEACHER_PARENT_DIRECT);
    expect(await g.prisma.messageReaction.count({ where: { messageId: legacyMessageId } })).toBe(0);
  });

  it('removing one\'s own earlier reaction is still allowed: it sends nothing new', async () => {
    await g.prisma.messageReaction.create({ data: { messageId: legacyMessageId, actorId: s.parentId, emoji: '👍' } });
    expect(await code(g.messages.unreact(legacyMessageId, s.parentId))).toBe('OK');
  });

  it('messages, attachments and calls stay refused (the main doors, re-asserted here)', async () => {
    expect(
      await code(g.messages.send({ conversationId: legacy, senderId: s.teacherId, body: 'x', clientMessageId: randomUUID() })),
    ).toBe(CommErrorCode.BR1_TEACHER_PARENT_DIRECT);
    expect(
      await code(g.attachments.authorizeUpload({ conversationId: legacy, actorId: s.parentId, kind: 'image', mimeType: 'image/jpeg', byteSize: 1000 })),
    ).toBe(CommErrorCode.BR1_TEACHER_PARENT_DIRECT);
    expect(await code(g.calls.start(legacy, s.teacherId))).toBe(CommErrorCode.BR1_TEACHER_PARENT_DIRECT);
    expect(await code(g.calls.start(legacy, s.parentId))).toBe(CommErrorCode.BR1_TEACHER_PARENT_DIRECT);
  });

  it('control: in the Student Group the same actors may react (with the admin present)', async () => {
    const group = await g.conversations.ensureStudentGroup(s.learnerId, s.ownerId);
    const m = await g.messages.send({ conversationId: group.id, senderId: s.ownerId, body: 'hello', clientMessageId: randomUUID() });
    expect(await code(g.messages.react(m.id, s.parentId, '👍'))).toBe('OK');
    expect(await code(g.messages.react(m.id, s.teacherId, '👍'))).toBe('OK');
  });
});
