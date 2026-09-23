/**
 * Integration tests for the communication engine against the real migrated
 * database. These assert the guarantees that only the database can prove:
 * idempotency, deterministic ordering, approval containment, dedupe, and the
 * BR-1 backstops.
 */
import { randomUUID } from 'node:crypto';
import { CommError, CommErrorCode } from '@platform/errors';
import { buildGraph, seed, truncate, Scenario } from './harness';

jest.setTimeout(60_000);

const g = buildGraph();
let s: Scenario;

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
  g.authz && undefined;
});

async function parentAdminConversation() {
  return g.conversations.getOrCreateDirect(s.parentId, s.ownerId);
}

// -------------------------------------------------------------------------
describe('PD-6 — the relationship is enforced by the database, not only by the API', () => {
  /**
   * RE-VERSIONED 2026-09-23. This block used to assert that a teacher and a
   * parent could never share a direct channel. PD-6 changed which pairs are
   * forbidden, not whether the database enforces the answer, so every
   * assertion here kept its shape and gained its opposite.
   *
   * The harness seeds teacherId as the assigned teacher of learnerId in
   * parentId's family, so (teacherId, parentId) is AUTHORIZED and
   * (unrelatedTeacherId, parentId) is not.
   */
  it('refuses a direct conversation pairing a teacher with an UNAUTHORIZED parent', async () => {
    const convId = randomUUID();
    await g.prisma.$executeRawUnsafe(
      `insert into chat.conversation (id, type, direct_key, family_id)
       values ('${convId}'::uuid, 'direct', 'forced-${convId}', '${s.familyId}'::uuid)`,
    );
    await g.prisma.$executeRawUnsafe(
      `insert into chat.conversation_member (conversation_id, actor_kind, actor_id, member_role)
       values ('${convId}'::uuid, 'teacher', '${s.unrelatedTeacherId}'::uuid, 'teacher')`,
    );

    // A direct SQL session, bypassing the API entirely, still cannot do it.
    await expect(
      g.prisma.$executeRawUnsafe(
        `insert into chat.conversation_member (conversation_id, actor_kind, actor_id, member_role)
         values ('${convId}'::uuid, 'contact', '${s.parentId}'::uuid, 'parent')`,
      ),
    ).rejects.toThrow(/PD-6 violation/);
  });

  it('PERMITS the same shape when the relationship is authorized', async () => {
    // The positive control. Without it the assertion above could be passing
    // because the database rejects every direct teacher/contact pairing, which
    // is precisely the behaviour PD-6 removed.
    const convId = randomUUID();
    await g.prisma.$executeRawUnsafe(
      `insert into chat.conversation (id, type, direct_key, family_id)
       values ('${convId}'::uuid, 'direct', 'allowed-${convId}', '${s.familyId}'::uuid)`,
    );
    await g.prisma.$executeRawUnsafe(
      `insert into chat.conversation_member (conversation_id, actor_kind, actor_id, member_role)
       values ('${convId}'::uuid, 'teacher', '${s.teacherId}'::uuid, 'teacher')`,
    );
    await expect(
      g.prisma.$executeRawUnsafe(
        `insert into chat.conversation_member (conversation_id, actor_kind, actor_id, member_role)
         values ('${convId}'::uuid, 'contact', '${s.parentId}'::uuid, 'parent')`,
      ),
    ).resolves.toBeDefined();
  });

  it('refuses a direct call pairing a teacher with an UNAUTHORIZED parent', async () => {
    const conv = await g.conversations.getOrCreateDirect(s.unrelatedTeacherId, s.ownerId);
    const callId = randomUUID();
    await g.prisma.$executeRawUnsafe(
      `insert into chat.call (id, conversation_id, initiator_id, type, room_name)
       values ('${callId}'::uuid, '${conv.id}'::uuid, '${s.unrelatedTeacherId}'::uuid, 'direct', 'room-${callId}')`,
    );
    await g.prisma.$executeRawUnsafe(
      `insert into chat.call_participant (call_id, actor_id, actor_kind)
       values ('${callId}'::uuid, '${s.unrelatedTeacherId}'::uuid, 'teacher')`,
    );
    await expect(
      g.prisma.$executeRawUnsafe(
        `insert into chat.call_participant (call_id, actor_id, actor_kind)
         values ('${callId}'::uuid, '${s.parentId}'::uuid, 'contact')`,
      ),
    ).rejects.toThrow(/PD-6 violation/);
  });

  it('the API refuses to create the channel for an unauthorized pair', async () => {
    await expect(
      g.conversations.getOrCreateDirect(s.unrelatedTeacherId, s.parentId),
    ).rejects.toMatchObject({
      code: CommErrorCode.TEACHER_PARENT_NOT_AUTHORIZED,
    });
  });

  it('the API creates it for an authorized pair, in either direction', async () => {
    const a = await g.conversations.getOrCreateDirect(s.teacherId, s.parentId);
    const b = await g.conversations.getOrCreateDirect(s.parentId, s.teacherId);
    expect(a.id).toBe(b.id); // direct_key is the sorted pair; one channel, not two
    expect(a.familyId).toBe(s.familyId);
  });
});

// -------------------------------------------------------------------------
describe('direct conversations', () => {
  it('parent and admin get exactly one conversation however often they ask', async () => {
    const a = await parentAdminConversation();
    const b = await g.conversations.getOrCreateDirect(s.ownerId, s.parentId); // reversed order
    expect(b.id).toBe(a.id);

    const count = await g.prisma.conversation.count({ where: { type: 'direct' } });
    expect(count).toBe(1);
  });

  it('is scoped to the family and is the family\'s only direct Jawwid conversation (OD-01)', async () => {
    // OD-01 removed chat.thread: the conversation is the only parent of a
    // message and carries the family scope itself (PRD §6, decision C-2).
    const conv = await parentAdminConversation();
    expect(conv.familyId).toBe(s.familyId);
    const perFamily = await g.prisma.conversation.count({
      where: { type: 'direct', familyId: s.familyId },
    });
    expect(perFamily).toBe(1);
  });
});

// -------------------------------------------------------------------------
describe('idempotent send', () => {
  it('the same client_message_id never creates two messages', async () => {
    const conv = await parentAdminConversation();
    const key = 'client-key-1';

    const first = await g.messages.send({
      conversationId: conv.id, senderId: s.parentId, body: 'hello', clientMessageId: key,
    });
    const second = await g.messages.send({
      conversationId: conv.id, senderId: s.parentId, body: 'hello', clientMessageId: key,
    });

    expect(second.id).toBe(first.id);
    expect(await g.prisma.message.count({ where: { conversationId: conv.id } })).toBe(1);
  });

  it('survives concurrent duplicate submissions', async () => {
    const conv = await parentAdminConversation();
    const key = 'concurrent-key';

    const results = await Promise.all(
      Array.from({ length: 5 }, () =>
        g.messages.send({
          conversationId: conv.id, senderId: s.parentId, body: 'retry storm', clientMessageId: key,
        }),
      ),
    );

    const ids = new Set(results.map((r) => r.id));
    expect(ids.size).toBe(1);
    expect(await g.prisma.message.count({ where: { conversationId: conv.id } })).toBe(1);
  });

  it('messages without a client key are independent', async () => {
    const conv = await parentAdminConversation();
    await g.messages.send({ conversationId: conv.id, senderId: s.parentId, body: 'one' });
    await g.messages.send({ conversationId: conv.id, senderId: s.parentId, body: 'two' });
    expect(await g.prisma.message.count({ where: { conversationId: conv.id } })).toBe(2);
  });
});

// -------------------------------------------------------------------------
describe('deterministic ordering', () => {
  it('assigns a gap-free increasing sequence even under concurrency', async () => {
    const conv = await parentAdminConversation();

    await Promise.all(
      Array.from({ length: 10 }, (_, i) =>
        g.messages.send({
          conversationId: conv.id, senderId: s.parentId, body: `m${i}`, clientMessageId: `k${i}`,
        }),
      ),
    );

    const rows = await g.prisma.message.findMany({
      where: { conversationId: conv.id }, orderBy: { seq: 'asc' }, select: { seq: true },
    });
    expect(rows.map((r) => Number(r.seq))).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);

    const conversation = await g.prisma.conversation.findUnique({ where: { id: conv.id } });
    expect(Number(conversation!.lastSeq)).toBe(10);
  });

  it('paginates backwards and catches up forwards by seq', async () => {
    const conv = await parentAdminConversation();
    for (let i = 0; i < 5; i += 1) {
      await g.messages.send({
        conversationId: conv.id, senderId: s.parentId, body: `m${i}`, clientMessageId: `p${i}`,
      });
    }

    const page = await g.messages.list({ conversationId: conv.id, actorId: s.parentId, limit: 2 });
    expect(page.messages.map((m) => m.seq)).toEqual(['5', '4']);

    const catchUp = await g.messages.list({ conversationId: conv.id, actorId: s.parentId, after: '3' });
    expect(catchUp.messages.map((m) => m.seq)).toEqual(['4', '5']);
  });
});

// -------------------------------------------------------------------------
describe('message immutability and deletion', () => {
  it('the database refuses to rewrite a sent message body', async () => {
    const conv = await parentAdminConversation();
    const m = await g.messages.send({ conversationId: conv.id, senderId: s.parentId, body: 'original' });

    await expect(
      g.prisma.$executeRawUnsafe(
        `update chat.message set body = 'tampered' where id = '${m.id}'::uuid`,
      ),
    ).rejects.toThrow(/immutable/);
  });

  it('delete-for-me hides the message only from that actor', async () => {
    const conv = await parentAdminConversation();
    const m = await g.messages.send({ conversationId: conv.id, senderId: s.parentId, body: 'private' });

    await g.messages.deleteForMe(m.id, s.parentId);

    const mine = await g.messages.list({ conversationId: conv.id, actorId: s.parentId });
    expect(mine.messages).toHaveLength(0);

    const theirs = await g.messages.list({ conversationId: conv.id, actorId: s.ownerId });
    expect(theirs.messages).toHaveLength(1);
  });

  it('delete-for-everyone redacts the body but keeps the row for audit', async () => {
    const conv = await parentAdminConversation();
    const m = await g.messages.send({ conversationId: conv.id, senderId: s.parentId, body: 'oops' });

    await g.messages.deleteForEveryone(m.id, s.parentId, 'sent by mistake');

    const seen = await g.messages.list({ conversationId: conv.id, actorId: s.ownerId });
    expect(seen.messages[0].body).toBeNull();
    expect(seen.messages[0].deletedForAll).toBe(true);

    expect(await g.prisma.message.count({ where: { id: m.id } })).toBe(1);
    const audits = await g.prisma.auditLog.count({
      where: { entityId: m.id, action: 'message.delete_for_everyone' },
    });
    expect(audits).toBe(1);
  });

  it('a non-author cannot delete for everyone', async () => {
    const conv = await parentAdminConversation();
    const m = await g.messages.send({ conversationId: conv.id, senderId: s.parentId, body: 'mine' });
    await expect(g.messages.deleteForEveryone(m.id, s.otherAdminId, 'no reason')).rejects.toMatchObject({
      code: CommErrorCode.NOT_MESSAGE_AUTHOR,
    });
  });
});

// -------------------------------------------------------------------------
describe('replies and reactions', () => {
  it('rejects a reply that targets another conversation', async () => {
    const a = await parentAdminConversation();
    const b = await g.conversations.getOrCreateDirect(s.teacherId, s.ownerId);
    const inA = await g.messages.send({ conversationId: a.id, senderId: s.parentId, body: 'in A' });

    await expect(
      g.messages.send({
        conversationId: b.id, senderId: s.teacherId, body: 'cross', replyToMessageId: inA.id,
      }),
    ).rejects.toMatchObject({ code: CommErrorCode.REPLY_TARGET_CROSS_CONVERSATION });
  });

  it('one reaction per actor per message; reacting again replaces it', async () => {
    const conv = await parentAdminConversation();
    const m = await g.messages.send({ conversationId: conv.id, senderId: s.parentId, body: 'react to me' });

    await g.messages.react(m.id, s.ownerId, '👍');
    await g.messages.react(m.id, s.ownerId, '❤️');

    const reactions = await g.prisma.messageReaction.findMany({ where: { messageId: m.id } });
    expect(reactions).toHaveLength(1);
    expect(reactions[0].emoji).toBe('❤️');

    await g.messages.unreact(m.id, s.ownerId);
    expect(await g.prisma.messageReaction.count({ where: { messageId: m.id } })).toBe(0);
  });
});

// -------------------------------------------------------------------------
describe('delivery receipts', () => {
  it('are created per recipient and advance monotonically', async () => {
    const conv = await parentAdminConversation();
    const m = await g.messages.send({ conversationId: conv.id, senderId: s.parentId, body: 'hi' });

    const receipts = await g.prisma.messageReceipt.findMany({ where: { messageId: m.id } });
    expect(receipts.map((r) => r.actorId)).toEqual([s.ownerId]); // never the author
    expect(receipts[0].state).toBe('sent');

    await g.messages.markState([m.id], s.ownerId, 'read');
    await g.messages.markState([m.id], s.ownerId, 'delivered'); // late replay

    const after = await g.prisma.messageReceipt.findFirst({ where: { messageId: m.id } });
    expect(after!.state).toBe('read'); // never downgraded
  });

  it('unread count falls to zero once read up to the latest seq', async () => {
    const conv = await parentAdminConversation();
    for (let i = 0; i < 3; i += 1) {
      await g.messages.send({ conversationId: conv.id, senderId: s.parentId, body: `m${i}` });
    }
    expect(await g.messages.unreadCount(conv.id, s.ownerId)).toBe(3);

    await g.messages.markReadUpTo(conv.id, s.ownerId, '3');
    expect(await g.messages.unreadCount(conv.id, s.ownerId)).toBe(0);
  });
});

// -------------------------------------------------------------------------
describe('internal notes', () => {
  it('are invisible to the family contact and visible to staff', async () => {
    const conv = await parentAdminConversation();
    await g.messages.send({
      conversationId: conv.id, senderId: s.ownerId, body: 'internal only', visibility: 'internal',
    });

    const parentView = await g.messages.list({ conversationId: conv.id, actorId: s.parentId });
    expect(parentView.messages).toHaveLength(0);

    const staffView = await g.messages.list({ conversationId: conv.id, actorId: s.ownerId });
    expect(staffView.messages).toHaveLength(1);
  });

  it('never create a receipt for a family contact', async () => {
    const conv = await parentAdminConversation();
    const m = await g.messages.send({
      conversationId: conv.id, senderId: s.ownerId, body: 'note', visibility: 'internal',
    });
    const receipts = await g.prisma.messageReceipt.findMany({ where: { messageId: m.id } });
    expect(receipts.map((r) => r.actorId)).not.toContain(s.parentId);
  });
});
