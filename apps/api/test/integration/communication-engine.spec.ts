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
describe('BR-1 (PD-7) — the database refuses a direct teacher/parent pairing, not only the API', () => {
  /**
   * RE-VERSIONED 2026-10-14 BY PD-7, which supersedes PD-6 and restores BR-1.
   *
   * Under PD-6 (2026-09-23) this block asserted that only an UNAUTHORIZED
   * teacher/parent pair was refused, with an authorized pair as its positive
   * control. PD-7 removes the relationship as an input: a direct channel or
   * direct call may never pair a teacher with a family contact, whatever their
   * relationship. So the authorized pair is now refused too, and the positive
   * control moves to the pairs BR-1 does allow (teacher <-> admin), so the
   * refusals cannot be passing because the database rejects every direct row.
   *
   * The harness seeds teacherId as the assigned teacher of learnerId in
   * parentId's family, so (teacherId, parentId) IS related and
   * (unrelatedTeacherId, parentId) is not. Both are refused.
   */
  async function forcedDirect(teacherId: string): Promise<string> {
    const convId = randomUUID();
    await g.prisma.$executeRawUnsafe(
      `insert into chat.conversation (id, type, direct_key, family_id)
       values ('${convId}'::uuid, 'direct', 'forced-${convId}', '${s.familyId}'::uuid)`,
    );
    await g.prisma.$executeRawUnsafe(
      `insert into chat.conversation_member (conversation_id, actor_kind, actor_id, member_role)
       values ('${convId}'::uuid, 'teacher', '${teacherId}'::uuid, 'teacher')`,
    );
    return convId;
  }

  it('refuses a direct conversation pairing a teacher with an UNRELATED parent', async () => {
    const convId = await forcedDirect(s.unrelatedTeacherId);

    // A direct SQL session, bypassing the API entirely, still cannot do it.
    await expect(
      g.prisma.$executeRawUnsafe(
        `insert into chat.conversation_member (conversation_id, actor_kind, actor_id, member_role)
         values ('${convId}'::uuid, 'contact', '${s.parentId}'::uuid, 'parent')`,
      ),
    ).rejects.toThrow(/BR-1 violation/);
  });

  it('refuses the same shape when the relationship IS authorized: it is no longer an input', async () => {
    // PD-6 PERMITTED this exact insert. PD-7 must not.
    expect(await g.relationships.teacherParentAuthorized(s.teacherId, s.parentId)).toBe(true);
    const convId = await forcedDirect(s.teacherId);

    await expect(
      g.prisma.$executeRawUnsafe(
        `insert into chat.conversation_member (conversation_id, actor_kind, actor_id, member_role)
         values ('${convId}'::uuid, 'contact', '${s.parentId}'::uuid, 'parent')`,
      ),
    ).rejects.toThrow(/BR-1 violation/);
    expect(
      await g.prisma.conversationMember.count({ where: { conversationId: convId, actorKind: 'contact' } }),
    ).toBe(0);
  });

  it('PERMITS a direct teacher <-> admin pairing through the same raw path', async () => {
    // The positive control. Without it the refusals above could be passing
    // because the database rejects every direct pairing with a teacher.
    const convId = await forcedDirect(s.teacherId);
    await expect(
      g.prisma.$executeRawUnsafe(
        `insert into chat.conversation_member (conversation_id, actor_kind, actor_id, member_role)
         values ('${convId}'::uuid, 'staff', '${s.ownerId}'::uuid, 'admin')`,
      ),
    ).resolves.toBeDefined();
  });

  for (const [label, teacher] of [
    ['an UNRELATED', () => s.unrelatedTeacherId],
    ['an AUTHORIZED', () => s.teacherId],
  ] as const) {
    it(`refuses a direct call pairing ${label} teacher with a parent`, async () => {
      const conv = await g.conversations.getOrCreateDirect(teacher(), s.ownerId);
      const callId = randomUUID();
      await g.prisma.$executeRawUnsafe(
        `insert into chat.call (id, conversation_id, initiator_id, type, room_name)
         values ('${callId}'::uuid, '${conv.id}'::uuid, '${teacher()}'::uuid, 'direct', 'room-${callId}')`,
      );
      await g.prisma.$executeRawUnsafe(
        `insert into chat.call_participant (call_id, actor_id, actor_kind)
         values ('${callId}'::uuid, '${teacher()}'::uuid, 'teacher')`,
      );
      await expect(
        g.prisma.$executeRawUnsafe(
          `insert into chat.call_participant (call_id, actor_id, actor_kind)
           values ('${callId}'::uuid, '${s.parentId}'::uuid, 'contact')`,
        ),
      ).rejects.toThrow(/BR-1 violation/);
    });
  }

  it('the API refuses to create the channel for an unrelated pair', async () => {
    await expect(
      g.conversations.getOrCreateDirect(s.unrelatedTeacherId, s.parentId),
    ).rejects.toMatchObject({
      code: CommErrorCode.BR1_TEACHER_PARENT_DIRECT,
    });
  });

  it('the API refuses it for an authorized pair too, in either direction, and writes nothing', async () => {
    for (const [a, b] of [
      [s.teacherId, s.parentId],
      [s.parentId, s.teacherId],
    ]) {
      await expect(g.conversations.getOrCreateDirect(a, b)).rejects.toMatchObject({
        code: CommErrorCode.BR1_TEACHER_PARENT_DIRECT,
        status: 403,
      });
    }
    expect(await g.prisma.conversation.count()).toBe(0);
    expect(await g.prisma.outboxEvent.count()).toBe(0);
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

  it('creating it enqueues one membership change naming both members; finding it again enqueues nothing', async () => {
    // 2026-10-14: both devices must learn the channel exists without a manual
    // refresh, so creation emits conversation.membership_changed in the same
    // transaction (the worker fans it out as conversation.added per member).
    const a = await parentAdminConversation();
    await g.conversations.getOrCreateDirect(s.ownerId, s.parentId);

    const rows = await g.prisma.outboxEvent.findMany({
      where: { type: 'conversation.membership_changed' },
    });
    expect(rows).toHaveLength(1);
    const payload = rows[0].payload as { conversationId: string; added: string[]; removed: string[] };
    expect(payload.conversationId).toBe(a.id);
    expect([...payload.added].sort()).toEqual([s.parentId, s.ownerId].sort());
    expect(payload.removed).toEqual([]);
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

  it('a non-author who does not moderate the message cannot delete it for everyone', async () => {
    const conv = await parentAdminConversation();
    const m = await g.messages.send({ conversationId: conv.id, senderId: s.ownerId, body: 'from the admin' });
    // The parent can read this conversation, and did not write the message.
    // (Since staff scope an admin outside the family's charge is refused
    // earlier, at the read, and would not reach the author check.)
    await expect(g.messages.deleteForEveryone(m.id, s.parentId, 'no reason')).rejects.toMatchObject({
      code: CommErrorCode.NOT_MESSAGE_AUTHOR,
    });
    expect((await g.prisma.message.findUniqueOrThrow({ where: { id: m.id } })).deletedForAll).toBe(false);
  });

  it("PD-14: the admin of a parent's 1:1 deletes the parent's message for everyone", async () => {
    const conv = await parentAdminConversation();
    const m = await g.messages.send({ conversationId: conv.id, senderId: s.parentId, body: 'mine' });
    await g.messages.deleteForEveryone(m.id, s.ownerId, 'removed by the supervisor');
    expect((await g.prisma.message.findUniqueOrThrow({ where: { id: m.id } })).deletedForAll).toBe(true);
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
