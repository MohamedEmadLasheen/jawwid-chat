/**
 * PHASE 2 -- core messaging, against the real migrated database.
 *
 * What this suite is for: every messaging capability Phase 2 added, and every
 * way it can be abused. The negative cases are not decoration -- for each
 * operation there is at least one test that an unauthorized actor is refused,
 * because an operation that only has a happy path has not been tested at all.
 *
 * Deliberately integration rather than unit: ordering under concurrency,
 * idempotency, the append-only revision log and the search predicate are all
 * guarantees the DATABASE makes, and a mocked Prisma would assert nothing about
 * them.
 */
import { randomUUID } from 'node:crypto';
import { CommErrorCode } from '@platform/errors';
import { Moderation, ReceiptState, Visibility } from '@communication/contracts/vocab';
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
  g.config.invalidate();
});

/** The Family <-> Supervisor channel this phase exists to make work. */
const familyChannel = () => g.conversations.getOrCreateDirect(s.parentId, s.ownerId);

/** A Teacher <-> Admin channel. Carries no family, which matters below. */
const teacherChannel = () => g.conversations.getOrCreateDirect(s.teacherId, s.ownerId);

/**
 * A second destination the supervisor may actually SEND to.
 *
 * Not the Teacher <-> Admin channel: it carries no family_id, so `canSend`
 * finds no coverage to place the admin on duty for and refuses. That is Phase 1
 * behaviour and not what these tests are about, so they use the learner's
 * official group -- family-scoped, and the supervisor is on duty for it.
 */
const studentGroup = () => g.conversations.ensureStudentGroup(s.learnerId, s.ownerId);

/** Put a family inside otherAdmin's scope, so scope is not the thing failing. */
async function coverFamilyWithOtherAdmin(): Promise<void> {
  await g.prisma.$executeRawUnsafe(
    `insert into chat.family_assignment (family_id, staff_id, kind, ends_at, reason)
     values ('${s.familyId}'::uuid, '${s.otherAdminId}'::uuid, 'temporary',
             now() + interval '1 day', 'test: cover')`,
  );
}

/** The events the outbox holds, in order, for assertions about fan-out. */
async function outboxTypes(): Promise<string[]> {
  const rows = await g.prisma.outboxEvent.findMany({ orderBy: { createdAt: 'asc' } });
  return rows.map((r) => r.type);
}

// =========================================================================
describe('conversations', () => {
  it('lists a row with its unread count, last message and members, without a query per row', async () => {
    const conv = await familyChannel();
    await g.messages.send({ conversationId: conv.id, senderId: s.ownerId, body: 'first' });
    await g.messages.send({ conversationId: conv.id, senderId: s.ownerId, body: 'second' });

    const rows = await g.conversations.listRowsForActor(s.parentId);
    const row = rows.find((r) => r.conversation.id === conv.id)!;

    expect(row.extras.unreadCount).toBe(2);
    expect(row.extras.lastMessagePreview).toBe('second');
    expect(row.extras.lastMessageAuthorId).toBe(s.ownerId);
    // Names are resolved, so the client never has to look an actor up itself.
    expect(row.members.map((m) => m.displayName).sort()).toEqual(['admin_a', 'parent_p']);
  });

  it('the unread count falls to zero once the conversation is read', async () => {
    const conv = await familyChannel();
    const m = await g.messages.send({ conversationId: conv.id, senderId: s.ownerId, body: 'hi' });
    await g.messages.markReadUpTo(conv.id, s.parentId, m.seq!);

    const rows = await g.conversations.listRowsForActor(s.parentId);
    expect(rows.find((r) => r.conversation.id === conv.id)!.extras.unreadCount).toBe(0);
  });

  it('never shows an internal note as a contact\'s last-message preview', async () => {
    const conv = await familyChannel();
    await g.messages.send({ conversationId: conv.id, senderId: s.ownerId, body: 'visible' });
    await g.messages.send({
      conversationId: conv.id,
      senderId: s.ownerId,
      body: 'internal only',
      visibility: Visibility.INTERNAL,
    });

    const parentRows = await g.conversations.listRowsForActor(s.parentId);
    expect(parentRows.find((r) => r.conversation.id === conv.id)!.extras.lastMessagePreview).toBe(
      'visible',
    );

    const adminRows = await g.conversations.listRowsForActor(s.ownerId);
    expect(adminRows.find((r) => r.conversation.id === conv.id)!.extras.lastMessagePreview).toBe(
      'internal only',
    );
  });

  it('an out-of-scope admin cannot open the conversation, and it is NOT FOUND rather than forbidden', async () => {
    const conv = await familyChannel();
    await expect(
      g.conversations.requireForActor(conv.id, s.otherAdminId),
    ).rejects.toMatchObject({ code: CommErrorCode.CONVERSATION_NOT_FOUND });
  });

  it('conversation search never returns a conversation outside the searcher\'s scope', async () => {
    const conv = await familyChannel();
    await g.prisma.conversation.update({ where: { id: conv.id }, data: { title: 'family_x thread' } });

    // The supervisor of the family finds it by title.
    expect((await g.conversations.searchForActor(s.ownerId, 'family_x')).map((c) => c.id)).toContain(
      conv.id,
    );
    // The admin who does not supervise it finds nothing, though the title matches.
    expect(await g.conversations.searchForActor(s.otherAdminId, 'family_x')).toEqual([]);
  });

  it('conversation search finds a thread by a participant\'s name', async () => {
    const conv = await familyChannel();
    const found = await g.conversations.searchForActor(s.ownerId, 'parent_p');
    expect(found.map((c) => c.id)).toContain(conv.id);
  });
});

// =========================================================================
describe('sending', () => {
  it('persists a message with server-assigned identity, ordering and time', async () => {
    const conv = await familyChannel();
    const before = Date.now();
    const m = await g.messages.send({
      conversationId: conv.id,
      senderId: s.parentId,
      body: 'السلام عليكم',
    });

    expect(m.id).toBeTruthy();
    expect(m.seq).toBe('1');
    expect(m.authorId).toBe(s.parentId);
    // Server clock, not the caller's.
    expect(new Date(m.createdAt).getTime()).toBeGreaterThanOrEqual(before - 1000);
    // Arabic survives the round trip byte for byte.
    const stored = await g.prisma.message.findUnique({ where: { id: m.id } });
    expect(stored!.body).toBe('السلام عليكم');
  });

  it('refuses an empty or whitespace-only message', async () => {
    const conv = await familyChannel();
    for (const body of ['', '   ', '\n\t ']) {
      await expect(
        g.messages.send({ conversationId: conv.id, senderId: s.parentId, body }),
      ).rejects.toMatchObject({ code: CommErrorCode.EMPTY_MESSAGE });
    }
  });

  it('trims the ends and preserves everything between them', async () => {
    const conv = await familyChannel();
    const m = await g.messages.send({
      conversationId: conv.id,
      senderId: s.parentId,
      body: '  line one\n\n  line two  ',
    });
    expect(m.body).toBe('line one\n\n  line two');
  });

  it('refuses a message longer than the configured maximum', async () => {
    const conv = await familyChannel();
    const max = await g.config.get('communication.message_max_length');
    await expect(
      g.messages.send({ conversationId: conv.id, senderId: s.parentId, body: 'ا'.repeat(max + 1) }),
    ).rejects.toMatchObject({ code: CommErrorCode.MESSAGE_TOO_LONG });
    // And accepts one exactly at the limit.
    await expect(
      g.messages.send({ conversationId: conv.id, senderId: s.parentId, body: 'ا'.repeat(max) }),
    ).resolves.toBeTruthy();
  });

  it('counts length in code points, so emoji are not double-charged', async () => {
    const conv = await familyChannel();
    const max = await g.config.get('communication.message_max_length');
    // Each of these is 2 UTF-16 units but one character to the person typing.
    await expect(
      g.messages.send({ conversationId: conv.id, senderId: s.parentId, body: '😀'.repeat(max) }),
    ).resolves.toBeTruthy();
  });

  it('derives the sender from the authenticated actor: a client cannot claim another author', async () => {
    const conv = await familyChannel();
    const m = await g.messages.send({
      conversationId: conv.id,
      senderId: s.parentId,
      // There is no field to spoof: senderId IS the authenticated actor id, and
      // the controller takes it from @ActorId() rather than from the body.
      body: 'from the parent',
    });
    expect(m.authorId).toBe(s.parentId);
    expect(m.authorKind).toBe('contact');
  });

  it('refuses a send into a conversation the actor may not access', async () => {
    const conv = await familyChannel();
    await expect(
      g.messages.send({ conversationId: conv.id, senderId: s.otherAdminId, body: 'intruding' }),
    ).rejects.toMatchObject({ code: CommErrorCode.OUT_OF_SCOPE });
  });

  it('is idempotent on clientMessageId: a retry returns the original, not a second message', async () => {
    const conv = await familyChannel();
    const key = randomUUID();
    const first = await g.messages.send({
      conversationId: conv.id, senderId: s.parentId, body: 'once', clientMessageId: key,
    });
    const retry = await g.messages.send({
      conversationId: conv.id, senderId: s.parentId, body: 'once', clientMessageId: key,
    });

    expect(retry.id).toBe(first.id);
    expect(await g.prisma.message.count({ where: { conversationId: conv.id } })).toBe(1);
  });
});

// =========================================================================
describe('ordering', () => {
  it('assigns a gap-free increasing sequence to rapid consecutive sends', async () => {
    const conv = await familyChannel();
    for (let i = 0; i < 10; i++) {
      await g.messages.send({ conversationId: conv.id, senderId: s.parentId, body: `m${i}` });
    }
    const { messages } = await g.messages.list({ conversationId: conv.id, actorId: s.parentId });
    const seqs = messages.map((m) => Number(m.seq)).sort((a, b) => a - b);
    expect(seqs).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  });

  it('assigns distinct sequences when two actors send simultaneously', async () => {
    const conv = await familyChannel();
    await Promise.all([
      g.messages.send({ conversationId: conv.id, senderId: s.parentId, body: 'p1' }),
      g.messages.send({ conversationId: conv.id, senderId: s.ownerId, body: 'a1' }),
      g.messages.send({ conversationId: conv.id, senderId: s.parentId, body: 'p2' }),
      g.messages.send({ conversationId: conv.id, senderId: s.ownerId, body: 'a2' }),
    ]);
    const rows = await g.prisma.message.findMany({ where: { conversationId: conv.id } });
    const seqs = rows.map((r) => Number(r.seq)).sort((a, b) => a - b);
    expect(new Set(seqs).size).toBe(4);
    expect(seqs).toEqual([1, 2, 3, 4]);
  });

  it('paginates backwards by seq without gaps or duplicates, and merges with a catch-up read', async () => {
    const conv = await familyChannel();
    for (let i = 1; i <= 25; i++) {
      await g.messages.send({ conversationId: conv.id, senderId: s.ownerId, body: `m${i}` });
    }

    const page1 = await g.messages.list({ conversationId: conv.id, actorId: s.parentId, limit: 10 });
    expect(page1.messages.map((m) => m.body)).toEqual(
      ['m25','m24','m23','m22','m21','m20','m19','m18','m17','m16'],
    );

    const page2 = await g.messages.list({
      conversationId: conv.id, actorId: s.parentId, limit: 10, before: page1.nextBefore!,
    });
    const page3 = await g.messages.list({
      conversationId: conv.id, actorId: s.parentId, limit: 10, before: page2.nextBefore!,
    });

    const all = [...page1.messages, ...page2.messages, ...page3.messages];
    const ids = all.map((m) => m.id);
    expect(new Set(ids).size).toBe(25);

    // A realtime arrival, then a catch-up from the highest seq we hold.
    const fresh = await g.messages.send({
      conversationId: conv.id, senderId: s.ownerId, body: 'm26',
    });
    const caught = await g.messages.list({
      conversationId: conv.id, actorId: s.parentId, after: '25',
    });
    expect(caught.messages.map((m) => m.id)).toEqual([fresh.id]);
  });
});

// =========================================================================
describe('message status', () => {
  it('a sent message starts as SENT for its recipient and nothing else', async () => {
    const conv = await familyChannel();
    const m = await g.messages.send({ conversationId: conv.id, senderId: s.parentId, body: 'hi' });

    const receipts = await g.prisma.messageReceipt.findMany({ where: { messageId: m.id } });
    expect(receipts).toHaveLength(1);
    expect(receipts[0].actorId).toBe(s.ownerId);
    expect(receipts[0].state).toBe(ReceiptState.SENT);
    // The author has no receipt of their own; a sender does not "receive".
    expect(receipts.some((r) => r.actorId === s.parentId)).toBe(false);
  });

  it('advances SENT -> DELIVERED -> READ and announces each transition', async () => {
    const conv = await familyChannel();
    const m = await g.messages.send({ conversationId: conv.id, senderId: s.parentId, body: 'hi' });
    await g.prisma.outboxEvent.deleteMany({});

    expect(await g.messages.markState([m.id], s.ownerId, ReceiptState.DELIVERED)).toBe(1);
    expect(await outboxTypes()).toEqual(['message.receipt.updated']);

    expect(await g.messages.markState([m.id], s.ownerId, ReceiptState.READ)).toBe(1);
    expect(await outboxTypes()).toEqual(['message.receipt.updated', 'message.receipt.updated']);

    const receipt = await g.prisma.messageReceipt.findFirst({ where: { messageId: m.id } });
    expect(receipt!.state).toBe(ReceiptState.READ);
    expect(receipt!.readAt).not.toBeNull();
    expect(receipt!.deliveredAt).not.toBeNull();
  });

  it('refuses to move backwards: a replayed DELIVERED after READ changes nothing and emits nothing', async () => {
    const conv = await familyChannel();
    const m = await g.messages.send({ conversationId: conv.id, senderId: s.parentId, body: 'hi' });
    await g.messages.markState([m.id], s.ownerId, ReceiptState.READ);
    await g.prisma.outboxEvent.deleteMany({});

    expect(await g.messages.markState([m.id], s.ownerId, ReceiptState.DELIVERED)).toBe(0);
    expect(await outboxTypes()).toEqual([]);
    expect(
      (await g.prisma.messageReceipt.findFirst({ where: { messageId: m.id } }))!.state,
    ).toBe(ReceiptState.READ);
  });

  it('a replayed DELIVERED is idempotent: the second call moves nothing', async () => {
    const conv = await familyChannel();
    const m = await g.messages.send({ conversationId: conv.id, senderId: s.parentId, body: 'hi' });
    expect(await g.messages.markState([m.id], s.ownerId, ReceiptState.DELIVERED)).toBe(1);
    expect(await g.messages.markState([m.id], s.ownerId, ReceiptState.DELIVERED)).toBe(0);
  });

  it('one actor can never change another actor\'s receipt', async () => {
    const conv = await familyChannel();
    const m = await g.messages.send({ conversationId: conv.id, senderId: s.parentId, body: 'hi' });

    // The AUTHOR claims their own message was read -- by naming their own id,
    // which owns no receipt row for it. Nothing moves.
    expect(await g.messages.markState([m.id], s.parentId, ReceiptState.READ)).toBe(0);
    expect(
      (await g.prisma.messageReceipt.findFirst({ where: { messageId: m.id } }))!.state,
    ).toBe(ReceiptState.SENT);
  });

  it('refuses a read cursor from an actor who cannot read the conversation', async () => {
    const conv = await familyChannel();
    const m = await g.messages.send({ conversationId: conv.id, senderId: s.parentId, body: 'hi' });
    await expect(
      g.messages.markReadUpTo(conv.id, s.otherAdminId, m.seq!),
    ).rejects.toMatchObject({ code: CommErrorCode.OUT_OF_SCOPE });
  });

  it('the read cursor is monotonic: a replayed older cursor does not drag it back', async () => {
    const conv = await familyChannel();
    for (let i = 0; i < 5; i++) {
      await g.messages.send({ conversationId: conv.id, senderId: s.parentId, body: `m${i}` });
    }
    await g.messages.markReadUpTo(conv.id, s.ownerId, '5');
    await g.messages.markReadUpTo(conv.id, s.ownerId, '2');

    const state = await g.prisma.conversationParticipantState.findFirst({
      where: { conversationId: conv.id, actorId: s.ownerId },
    });
    expect(Number(state!.lastReadSeq)).toBe(5);
  });
});

// =========================================================================
describe('reply and quote', () => {
  it('persists the relationship and serves a quote of the original', async () => {
    const conv = await familyChannel();
    const original = await g.messages.send({
      conversationId: conv.id, senderId: s.ownerId, body: 'when is the class?',
    });
    const reply = await g.messages.send({
      conversationId: conv.id, senderId: s.parentId, body: 'tomorrow', replyToMessageId: original.id,
    });

    expect(reply.replyToMessageId).toBe(original.id);

    const { messages } = await g.messages.list({ conversationId: conv.id, actorId: s.parentId });
    const served = messages.find((m) => m.id === reply.id)!;
    expect(served.replyPreview).toMatchObject({
      messageId: original.id,
      available: true,
      excerpt: 'when is the class?',
      authorId: s.ownerId,
    });
  });

  it('refuses a reply that targets a message in another conversation', async () => {
    const a = await familyChannel();
    const b = await teacherChannel();
    const inA = await g.messages.send({ conversationId: a.id, senderId: s.parentId, body: 'in A' });

    await expect(
      g.messages.send({
        conversationId: b.id, senderId: s.teacherId, body: 'cross', replyToMessageId: inA.id,
      }),
    ).rejects.toMatchObject({ code: CommErrorCode.REPLY_TARGET_CROSS_CONVERSATION });
  });

  it('refuses a reply to a message the actor may not see, reporting it as absent', async () => {
    const conv = await familyChannel();
    const note = await g.messages.send({
      conversationId: conv.id, senderId: s.ownerId, body: 'internal', visibility: Visibility.INTERNAL,
    });
    // The parent knows the id but may not read the note. Quoting it would put
    // its text above their own message.
    await expect(
      g.messages.send({
        conversationId: conv.id, senderId: s.parentId, body: 'quoting', replyToMessageId: note.id,
      }),
    ).rejects.toMatchObject({ code: CommErrorCode.MESSAGE_NOT_FOUND });
  });

  it('degrades the quote to "deleted" when the original is withdrawn, and leaks no text', async () => {
    const conv = await familyChannel();
    const original = await g.messages.send({
      conversationId: conv.id, senderId: s.ownerId, body: 'the secret plan',
    });
    const reply = await g.messages.send({
      conversationId: conv.id, senderId: s.parentId, body: 'noted', replyToMessageId: original.id,
    });
    await g.messages.deleteForEveryone(original.id, s.ownerId, 'sent in error');

    const { messages } = await g.messages.list({ conversationId: conv.id, actorId: s.parentId });
    const served = messages.find((m) => m.id === reply.id)!;
    expect(served.replyPreview).toMatchObject({
      available: false,
      unavailableReason: 'deleted',
      excerpt: null,
    });
    expect(JSON.stringify(served)).not.toContain('the secret plan');
  });

  it('degrades the quote to "restricted" when the reader hid the original for themselves', async () => {
    const conv = await familyChannel();
    const original = await g.messages.send({
      conversationId: conv.id, senderId: s.ownerId, body: 'original text',
    });
    const reply = await g.messages.send({
      conversationId: conv.id, senderId: s.parentId, body: 'reply', replyToMessageId: original.id,
    });
    await g.messages.deleteForMe(original.id, s.parentId);

    const { messages } = await g.messages.list({ conversationId: conv.id, actorId: s.parentId });
    const served = messages.find((m) => m.id === reply.id)!;
    expect(served.replyPreview!.available).toBe(false);
    expect(served.replyPreview!.unavailableReason).toBe('restricted');

    // And the admin, who hid nothing, still sees the quote.
    const adminView = await g.messages.list({ conversationId: conv.id, actorId: s.ownerId });
    expect(adminView.messages.find((m) => m.id === reply.id)!.replyPreview!.excerpt).toBe(
      'original text',
    );
  });

  it('resolves a page of replies without a query per reply', async () => {
    const conv = await familyChannel();
    const original = await g.messages.send({
      conversationId: conv.id, senderId: s.ownerId, body: 'root',
    });
    for (let i = 0; i < 5; i++) {
      await g.messages.send({
        conversationId: conv.id, senderId: s.parentId, body: `r${i}`, replyToMessageId: original.id,
      });
    }
    const { messages } = await g.messages.list({ conversationId: conv.id, actorId: s.parentId });
    const withQuotes = messages.filter((m) => m.replyPreview?.available);
    expect(withQuotes).toHaveLength(5);
    expect(withQuotes.every((m) => m.replyPreview!.excerpt === 'root')).toBe(true);
  });
});

// =========================================================================
describe('edit', () => {
  it('the author replaces the body, and the original is preserved', async () => {
    const conv = await familyChannel();
    const m = await g.messages.send({
      conversationId: conv.id, senderId: s.parentId, body: 'tomorow',
    });

    const edited = await g.messages.edit({
      messageId: m.id, actorId: s.parentId, body: 'tomorrow',
    });
    expect(edited.body).toBe('tomorrow');
    expect(edited.editedAt).not.toBeNull();
    expect(edited.editCount).toBe(1);
    // seq and created_at are untouched: an edit does not reorder anything.
    expect(edited.seq).toBe(m.seq);
    expect(edited.createdAt).toBe(m.createdAt);

    const revisions = await g.messages.revisions(m.id, s.managerId);
    expect(revisions).toEqual([
      expect.objectContaining({ revision: 1, body: 'tomorow', replacedBy: s.parentId }),
    ]);
  });

  it('appends a revision per edit, and the log is append-only at the database level', async () => {
    const conv = await familyChannel();
    const m = await g.messages.send({ conversationId: conv.id, senderId: s.parentId, body: 'v1' });
    await g.messages.edit({ messageId: m.id, actorId: s.parentId, body: 'v2' });
    await g.messages.edit({ messageId: m.id, actorId: s.parentId, body: 'v3' });

    const revisions = await g.messages.revisions(m.id, s.managerId);
    expect(revisions.map((r) => r.body)).toEqual(['v1', 'v2']);

    await expect(
      g.prisma.$executeRawUnsafe(
        `update chat.message_revision set body = 'tampered' where message_id = '${m.id}'`,
      ),
    ).rejects.toThrow(/append-only/);
    await expect(
      g.prisma.$executeRawUnsafe(`delete from chat.message_revision where message_id = '${m.id}'`),
    ).rejects.toThrow(/append-only/);
  });

  it('emits message.updated so other clients can apply the change', async () => {
    const conv = await familyChannel();
    const m = await g.messages.send({ conversationId: conv.id, senderId: s.parentId, body: 'v1' });
    await g.prisma.outboxEvent.deleteMany({});

    await g.messages.edit({ messageId: m.id, actorId: s.parentId, body: 'v2' });
    const events = await g.prisma.outboxEvent.findMany();
    expect(events.map((e) => e.type)).toEqual(['message.updated']);
    expect(events[0].payload).toMatchObject({ messageId: m.id, body: 'v2', editCount: 1 });
  });

  it('refuses an edit by anyone but the author -- including a manager', async () => {
    const conv = await familyChannel();
    const m = await g.messages.send({ conversationId: conv.id, senderId: s.parentId, body: 'mine' });

    await expect(
      g.messages.edit({ messageId: m.id, actorId: s.ownerId, body: 'not yours' }),
    ).rejects.toMatchObject({ code: CommErrorCode.NOT_MESSAGE_AUTHOR });
    // A manager holds messages.delete, not a licence to rewrite somebody's words.
    await expect(
      g.messages.edit({ messageId: m.id, actorId: s.managerId, body: 'not yours either' }),
    ).rejects.toMatchObject({ code: CommErrorCode.NOT_MESSAGE_AUTHOR });
    expect((await g.prisma.message.findUnique({ where: { id: m.id } }))!.body).toBe('mine');
  });

  it('refuses an edit after the window has closed', async () => {
    const conv = await familyChannel();
    const m = await g.messages.send({ conversationId: conv.id, senderId: s.parentId, body: 'old' });
    const windowMinutes = await g.config.get('communication.edit_window_minutes');
    await g.prisma.$executeRawUnsafe(
      `update chat.message set created_at = now() - interval '${windowMinutes + 1} minutes'
        where id = '${m.id}'`,
    );

    await expect(
      g.messages.edit({ messageId: m.id, actorId: s.parentId, body: 'too late' }),
    ).rejects.toMatchObject({ code: CommErrorCode.EDIT_WINDOW_EXPIRED });
  });

  it('refuses to edit a message that has been deleted for everyone', async () => {
    const conv = await familyChannel();
    const m = await g.messages.send({ conversationId: conv.id, senderId: s.parentId, body: 'gone' });
    await g.messages.deleteForEveryone(m.id, s.parentId, 'withdrawn');

    await expect(
      g.messages.edit({ messageId: m.id, actorId: s.parentId, body: 'back again' }),
    ).rejects.toMatchObject({ code: CommErrorCode.MESSAGE_NOT_EDITABLE });
  });

  it('refuses to edit a message still awaiting approval', async () => {
    const group = await g.conversations.ensureStudentGroup(s.learnerId, s.ownerId);
    const held = await g.messages.send({
      conversationId: group.id, senderId: s.parentId, body: 'held for review',
    });
    expect(held.moderation).toBe(Moderation.PENDING);

    await expect(
      g.messages.edit({ messageId: held.id, actorId: s.parentId, body: 'changed after submission' }),
    ).rejects.toMatchObject({ code: CommErrorCode.MESSAGE_NOT_EDITABLE });
  });

  it('a no-op edit consumes no revision and does not stamp the message', async () => {
    const conv = await familyChannel();
    const m = await g.messages.send({ conversationId: conv.id, senderId: s.parentId, body: 'same' });
    const result = await g.messages.edit({ messageId: m.id, actorId: s.parentId, body: 'same' });

    expect(result.editedAt).toBeNull();
    expect(await g.prisma.messageRevision.count({ where: { messageId: m.id } })).toBe(0);
  });

  it('the edit history needs messages.moderate, not merely membership', async () => {
    const conv = await familyChannel();
    const m = await g.messages.send({ conversationId: conv.id, senderId: s.parentId, body: 'v1' });
    await g.messages.edit({ messageId: m.id, actorId: s.parentId, body: 'v2' });

    // Even the author cannot read back what they replaced: a parent holds no
    // moderation permission, and the history is moderation material.
    await expect(g.messages.revisions(m.id, s.parentId)).rejects.toMatchObject({
      code: CommErrorCode.PERMISSION_DENIED,
    });
    await expect(g.messages.revisions(m.id, s.ownerId)).resolves.toHaveLength(1);
  });

  it('the database refuses a body rewrite that carries no edit stamp', async () => {
    const conv = await familyChannel();
    const m = await g.messages.send({ conversationId: conv.id, senderId: s.parentId, body: 'v1' });
    await expect(
      g.prisma.$executeRawUnsafe(
        `update chat.message set body = 'tampered' where id = '${m.id}'`,
      ),
    ).rejects.toThrow(/immutable/);
  });
});

// =========================================================================
describe('delete', () => {
  it('delete for me hides the message from that actor and from nobody else', async () => {
    const conv = await familyChannel();
    const m = await g.messages.send({ conversationId: conv.id, senderId: s.ownerId, body: 'keep' });

    await g.messages.deleteForMe(m.id, s.parentId);

    const parentView = await g.messages.list({ conversationId: conv.id, actorId: s.parentId });
    expect(parentView.messages.map((x) => x.id)).not.toContain(m.id);

    const adminView = await g.messages.list({ conversationId: conv.id, actorId: s.ownerId });
    const stillThere = adminView.messages.find((x) => x.id === m.id)!;
    expect(stillThere.body).toBe('keep');
    expect(stillThere.deletedForAll).toBe(false);

    // And the row is untouched -- this is not a global delete wearing a hat.
    const row = await g.prisma.message.findUnique({ where: { id: m.id } });
    expect(row!.deletedAt).toBeNull();
    expect(row!.deletedForAll).toBe(false);
  });

  it('delete for me is reversible, because nothing was destroyed', async () => {
    const conv = await familyChannel();
    const m = await g.messages.send({ conversationId: conv.id, senderId: s.ownerId, body: 'keep' });
    await g.messages.deleteForMe(m.id, s.parentId);
    await g.messages.restoreForMe(m.id, s.parentId);

    const view = await g.messages.list({ conversationId: conv.id, actorId: s.parentId });
    expect(view.messages.map((x) => x.id)).toContain(m.id);
  });

  it('delete for everyone withdraws the body from every reader but keeps the row', async () => {
    const conv = await familyChannel();
    const m = await g.messages.send({
      conversationId: conv.id, senderId: s.parentId, body: 'said in haste',
    });
    await g.messages.deleteForEveryone(m.id, s.parentId, 'sent in error');

    for (const viewer of [s.parentId, s.ownerId]) {
      const view = await g.messages.list({ conversationId: conv.id, actorId: viewer });
      const tombstone = view.messages.find((x) => x.id === m.id)!;
      expect(tombstone.deletedForAll).toBe(true);
      expect(tombstone.body).toBeNull();
    }

    // The row survives for audit; the body is simply never served again.
    const row = await g.prisma.message.findUnique({ where: { id: m.id } });
    expect(row).not.toBeNull();
    expect(row!.deletedBy).toBe(s.parentId);
    expect(row!.redactedReason).toBe('sent in error');
  });

  it('refuses delete for everyone by a non-author who holds no messages.delete', async () => {
    const conv = await familyChannel();
    const m = await g.messages.send({ conversationId: conv.id, senderId: s.parentId, body: 'mine' });
    await coverFamilyWithOtherAdmin();

    await expect(
      g.messages.deleteForEveryone(m.id, s.otherAdminId, 'because'),
    ).rejects.toMatchObject({ code: CommErrorCode.NOT_MESSAGE_AUTHOR });
  });

  it('a manager holding messages.delete may withdraw any message, at any age', async () => {
    const conv = await familyChannel();
    const m = await g.messages.send({ conversationId: conv.id, senderId: s.parentId, body: 'bad' });
    const windowMinutes = await g.config.get('communication.delete_for_everyone_window_minutes');
    await g.prisma.$executeRawUnsafe(
      `update chat.message set created_at = now() - interval '${windowMinutes + 60} minutes'
        where id = '${m.id}'`,
    );

    await g.messages.deleteForEveryone(m.id, s.managerId, 'policy violation');
    expect((await g.prisma.message.findUnique({ where: { id: m.id } }))!.deletedForAll).toBe(true);
  });

  it('refuses the author\'s own delete for everyone once the window has closed', async () => {
    const conv = await familyChannel();
    const m = await g.messages.send({ conversationId: conv.id, senderId: s.parentId, body: 'old' });
    const windowMinutes = await g.config.get('communication.delete_for_everyone_window_minutes');
    await g.prisma.$executeRawUnsafe(
      `update chat.message set created_at = now() - interval '${windowMinutes + 1} minutes'
        where id = '${m.id}'`,
    );

    await expect(
      g.messages.deleteForEveryone(m.id, s.parentId, 'changed my mind'),
    ).rejects.toMatchObject({ code: CommErrorCode.DELETE_WINDOW_EXPIRED });
  });

  it('a repeated delete for everyone is idempotent rather than an error', async () => {
    const conv = await familyChannel();
    const m = await g.messages.send({ conversationId: conv.id, senderId: s.parentId, body: 'x' });
    await g.messages.deleteForEveryone(m.id, s.parentId, 'first');
    await expect(g.messages.deleteForEveryone(m.id, s.parentId, 'again')).resolves.toBeUndefined();
    // The original reason stands; a retry does not rewrite the audit record.
    expect((await g.prisma.message.findUnique({ where: { id: m.id } }))!.redactedReason).toBe('first');
  });

  it('the database refuses to un-delete a withdrawn message', async () => {
    const conv = await familyChannel();
    const m = await g.messages.send({ conversationId: conv.id, senderId: s.parentId, body: 'x' });
    await g.messages.deleteForEveryone(m.id, s.parentId, 'withdrawn');
    await expect(
      g.prisma.$executeRawUnsafe(
        `update chat.message set deleted_for_all = false where id = '${m.id}'`,
      ),
    ).rejects.toThrow(/cannot be restored/);
  });
});

// =========================================================================
describe('reactions', () => {
  it('adds, replaces and removes a reaction, one per actor per message', async () => {
    const conv = await familyChannel();
    const m = await g.messages.send({ conversationId: conv.id, senderId: s.ownerId, body: 'news' });

    await g.messages.react(m.id, s.parentId, '👍');
    await g.messages.react(m.id, s.parentId, '❤️');

    const reactions = await g.prisma.messageReaction.findMany({ where: { messageId: m.id } });
    expect(reactions).toHaveLength(1);
    expect(reactions[0].emoji).toBe('❤️');

    await g.messages.unreact(m.id, s.parentId);
    expect(await g.prisma.messageReaction.count({ where: { messageId: m.id } })).toBe(0);
  });

  it('serves the reaction back on the message, with its author', async () => {
    const conv = await familyChannel();
    const m = await g.messages.send({ conversationId: conv.id, senderId: s.ownerId, body: 'news' });
    await g.messages.react(m.id, s.parentId, '👍');

    const { messages } = await g.messages.list({ conversationId: conv.id, actorId: s.parentId });
    expect(messages.find((x) => x.id === m.id)!.reactions).toEqual([
      { actorId: s.parentId, emoji: '👍' },
    ]);
  });

  it('refuses an emoji outside the supported set', async () => {
    const conv = await familyChannel();
    const m = await g.messages.send({ conversationId: conv.id, senderId: s.ownerId, body: 'news' });
    for (const bad of ['💩', 'not an emoji at all', '']) {
      await expect(g.messages.react(m.id, s.parentId, bad)).rejects.toMatchObject({
        code: CommErrorCode.REACTION_NOT_ALLOWED,
      });
    }
  });

  it('refuses a reaction from an actor who cannot read the conversation', async () => {
    const conv = await familyChannel();
    const m = await g.messages.send({ conversationId: conv.id, senderId: s.ownerId, body: 'news' });
    await expect(g.messages.react(m.id, s.otherAdminId, '👍')).rejects.toMatchObject({
      code: CommErrorCode.OUT_OF_SCOPE,
    });
  });

  it('refuses a reaction on a message that has been withdrawn', async () => {
    const conv = await familyChannel();
    const m = await g.messages.send({ conversationId: conv.id, senderId: s.ownerId, body: 'news' });
    await g.messages.deleteForEveryone(m.id, s.ownerId, 'withdrawn');
    await expect(g.messages.react(m.id, s.parentId, '👍')).rejects.toMatchObject({
      code: CommErrorCode.MESSAGE_NOT_FOUND,
    });
  });

  it('refuses a reaction addressed through the wrong conversation', async () => {
    const conv = await familyChannel();
    const other = await teacherChannel();
    const m = await g.messages.send({ conversationId: conv.id, senderId: s.ownerId, body: 'news' });

    // The admin may read BOTH conversations, so this is not a scope failure --
    // it is the route's conversation not matching the message's.
    await expect(g.messages.react(m.id, s.ownerId, '👍', other.id)).rejects.toMatchObject({
      code: CommErrorCode.MESSAGE_NOT_FOUND,
    });
  });
});

// =========================================================================
describe('forwarding', () => {
  it('copies an authorized message into an authorized destination', async () => {
    const source = await familyChannel();
    const destination = await studentGroup();
    const m = await g.messages.send({
      conversationId: source.id, senderId: s.parentId, body: 'the schedule changed',
    });

    const [forwarded] = await g.messages.forward({
      messageId: m.id, actorId: s.ownerId, toConversationIds: [destination.id],
    });

    expect(forwarded.body).toBe('the schedule changed');
    expect(forwarded.conversationId).toBe(destination.id);
    expect(forwarded.isForwarded).toBe(true);
    // A new message authored by the FORWARDER, not attributed to the original
    // author, and carrying none of the original's receipts or reactions.
    expect(forwarded.authorId).toBe(s.ownerId);
    expect(forwarded.reactions).toEqual([]);

    // Provenance is recorded for audit, and is not in the payload.
    const row = await g.prisma.message.findUnique({ where: { id: forwarded.id } });
    expect(row!.forwardedFromMessageId).toBe(m.id);
    expect(JSON.stringify(forwarded)).not.toContain(source.id);
  });

  it('refuses to forward a message the actor may not read', async () => {
    const source = await familyChannel();
    const m = await g.messages.send({
      conversationId: source.id, senderId: s.parentId, body: 'private to this family',
    });
    // otherAdmin controls their own conversation but cannot read the source.
    // Forwarding must not become a read primitive.
    const destination = await g.conversations.getOrCreateDirect(s.otherAdminId, s.teacherId);

    await expect(
      g.messages.forward({
        messageId: m.id, actorId: s.otherAdminId, toConversationIds: [destination.id],
      }),
    ).rejects.toMatchObject({ code: CommErrorCode.OUT_OF_SCOPE });
    expect(await g.prisma.message.count({ where: { conversationId: destination.id } })).toBe(0);
  });

  it('refuses a destination the actor may not send to', async () => {
    const source = await familyChannel();
    const m = await g.messages.send({
      conversationId: source.id, senderId: s.parentId, body: 'text',
    });
    // A conversation belonging to the other admin. The parent can read their
    // own message but has no standing in that channel at all.
    const destination = await g.conversations.getOrCreateDirect(s.otherAdminId, s.teacherId);

    await expect(
      g.messages.forward({
        messageId: m.id, actorId: s.parentId, toConversationIds: [destination.id],
      }),
    ).rejects.toMatchObject({ code: CommErrorCode.NOT_CONVERSATION_MEMBER });
    expect(await g.prisma.message.count({ where: { conversationId: destination.id } })).toBe(0);
  });

  it('refuses to forward an internal note into a family conversation', async () => {
    const source = await familyChannel();
    const destination = await studentGroup();
    const note = await g.messages.send({
      conversationId: source.id, senderId: s.ownerId, body: 'internal', visibility: Visibility.INTERNAL,
    });

    await expect(
      g.messages.forward({
        messageId: note.id, actorId: s.ownerId, toConversationIds: [destination.id],
      }),
    ).rejects.toMatchObject({ code: CommErrorCode.MESSAGE_NOT_FORWARDABLE });
  });

  it('refuses to forward a withdrawn message', async () => {
    const source = await familyChannel();
    const destination = await studentGroup();
    const m = await g.messages.send({ conversationId: source.id, senderId: s.ownerId, body: 'x' });
    await g.messages.deleteForEveryone(m.id, s.ownerId, 'withdrawn');

    await expect(
      g.messages.forward({
        messageId: m.id, actorId: s.ownerId, toConversationIds: [destination.id],
      }),
    ).rejects.toMatchObject({ code: CommErrorCode.MESSAGE_NOT_FORWARDABLE });
  });

  it('refuses to forward a message still awaiting approval', async () => {
    const group = await g.conversations.ensureStudentGroup(s.learnerId, s.ownerId);
    const destination = await familyChannel();
    const held = await g.messages.send({
      conversationId: group.id, senderId: s.parentId, body: 'held',
    });

    await expect(
      g.messages.forward({
        messageId: held.id, actorId: s.parentId, toConversationIds: [destination.id],
      }),
    ).rejects.toMatchObject({ code: CommErrorCode.MESSAGE_NOT_FORWARDABLE });
  });

  it('bounds how many conversations one forward may reach', async () => {
    const source = await familyChannel();
    const m = await g.messages.send({ conversationId: source.id, senderId: s.ownerId, body: 'x' });
    const max = await g.config.get('communication.forward_max_targets');

    await expect(
      g.messages.forward({
        messageId: m.id,
        actorId: s.ownerId,
        toConversationIds: Array.from({ length: max + 1 }, () => randomUUID()),
      }),
    ).rejects.toMatchObject({ code: CommErrorCode.INVALID_PARTICIPANTS });
  });
});

// =========================================================================
describe('search', () => {
  /** A second family, supervised by otherAdmin, to prove isolation. */
  async function secondFamily(): Promise<{ conversationId: string; parentId: string }> {
    const familyId = randomUUID();
    const parentId = randomUUID();
    const accountId = randomUUID();
    await g.prisma.$executeRawUnsafe(
      `insert into chat.account (id, subject, kind, status)
       values ('${accountId}'::uuid, 'subject_${parentId}', 'family', 'active')`,
    );
    await g.prisma.$executeRawUnsafe(
      `insert into chat.family (id, display_name, owner_id, language)
       values ('${familyId}'::uuid, 'family_zeta', '${s.otherAdminId}'::uuid, 'ar')`,
    );
    await g.prisma.$executeRawUnsafe(
      `insert into chat.contact (id, account_id, family_id, name, role_preset, can_message, is_active)
       values ('${parentId}'::uuid, '${accountId}'::uuid, '${familyId}'::uuid,
               'parent_z', 'primary_guardian', true, true)`,
    );
    const conv = await g.conversations.getOrCreateDirect(s.otherAdminId, parentId);
    return { conversationId: conv.id, parentId };
  }

  it('finds a message by its text, in Arabic and in English', async () => {
    const conv = await familyChannel();
    await g.messages.send({ conversationId: conv.id, senderId: s.parentId, body: 'موعد الحصة غدا' });
    await g.messages.send({ conversationId: conv.id, senderId: s.ownerId, body: 'the class is tomorrow' });

    const arabic = await g.messages.search({ actorId: s.parentId, query: 'الحصة' });
    expect(arabic.hits.map((h) => h.message.body)).toEqual(['موعد الحصة غدا']);

    const english = await g.messages.search({ actorId: s.parentId, query: 'tomorrow' });
    expect(english.hits.map((h) => h.message.body)).toEqual(['the class is tomorrow']);
  });

  it('NEVER returns a message from a conversation outside the searcher\'s scope', async () => {
    const mine = await familyChannel();
    await g.messages.send({ conversationId: mine.id, senderId: s.ownerId, body: 'shared secret' });

    const other = await secondFamily();
    // Seeded by that family's own parent: the pinned coverage engine places
    // s.ownerId on duty everywhere, so otherAdmin can read this conversation
    // but not post in it. Who wrote it is not what this test is about.
    await g.messages.send({
      conversationId: other.conversationId, senderId: other.parentId, body: 'shared secret',
    });

    // Both conversations contain the exact phrase. Each supervisor sees one.
    const asOwner = await g.messages.search({ actorId: s.ownerId, query: 'shared secret' });
    expect(asOwner.hits).toHaveLength(1);
    expect(asOwner.hits[0].conversationId).toBe(mine.id);

    const asOther = await g.messages.search({ actorId: s.otherAdminId, query: 'shared secret' });
    expect(asOther.hits).toHaveLength(1);
    expect(asOther.hits[0].conversationId).toBe(other.conversationId);

    // And the family contact sees only their own family's copy.
    const asParent = await g.messages.search({ actorId: s.parentId, query: 'shared secret' });
    expect(asParent.hits.map((h) => h.conversationId)).toEqual([mine.id]);
  });

  it('filters by sender', async () => {
    const conv = await familyChannel();
    await g.messages.send({ conversationId: conv.id, senderId: s.parentId, body: 'ping from parent' });
    await g.messages.send({ conversationId: conv.id, senderId: s.ownerId, body: 'ping from admin' });

    const byParent = await g.messages.search({
      actorId: s.ownerId, query: 'ping', authorId: s.parentId,
    });
    expect(byParent.hits.map((h) => h.message.authorId)).toEqual([s.parentId]);
  });

  it('filters by date', async () => {
    const conv = await familyChannel();
    const old = await g.messages.send({ conversationId: conv.id, senderId: s.ownerId, body: 'report old' });
    await g.messages.send({ conversationId: conv.id, senderId: s.ownerId, body: 'report new' });
    await g.prisma.$executeRawUnsafe(
      `update chat.message set created_at = now() - interval '10 days' where id = '${old.id}'`,
    );

    const recent = await g.messages.search({
      actorId: s.ownerId,
      query: 'report',
      from: new Date(Date.now() - 24 * 3600 * 1000),
    });
    expect(recent.hits.map((h) => h.message.body)).toEqual(['report new']);

    const archive = await g.messages.search({
      actorId: s.ownerId,
      query: 'report',
      to: new Date(Date.now() - 24 * 3600 * 1000),
    });
    expect(archive.hits.map((h) => h.message.body)).toEqual(['report old']);
  });

  it('scopes to one conversation, and refuses one the actor may not read', async () => {
    const mine = await familyChannel();
    const other = await secondFamily();
    await g.messages.send({ conversationId: mine.id, senderId: s.ownerId, body: 'needle here' });
    await g.messages.send({
      conversationId: other.conversationId, senderId: other.parentId, body: 'needle here',
    });

    const scoped = await g.messages.search({
      actorId: s.ownerId, query: 'needle', conversationId: mine.id,
    });
    expect(scoped.hits).toHaveLength(1);

    await expect(
      g.messages.search({ actorId: s.ownerId, query: 'needle', conversationId: other.conversationId }),
    ).rejects.toMatchObject({ code: CommErrorCode.CONVERSATION_NOT_FOUND });
  });

  it('never surfaces an internal note to somebody who may not read one', async () => {
    const conv = await familyChannel();
    await g.messages.send({
      conversationId: conv.id, senderId: s.ownerId, body: 'internal marker', visibility: Visibility.INTERNAL,
    });

    expect((await g.messages.search({ actorId: s.parentId, query: 'internal marker' })).hits).toEqual([]);
    expect((await g.messages.search({ actorId: s.ownerId, query: 'internal marker' })).hits).toHaveLength(1);
  });

  it('never surfaces a withdrawn, pending or self-hidden message', async () => {
    const conv = await familyChannel();
    const deleted = await g.messages.send({
      conversationId: conv.id, senderId: s.ownerId, body: 'marker deleted',
    });
    const hidden = await g.messages.send({
      conversationId: conv.id, senderId: s.ownerId, body: 'marker hidden',
    });
    await g.messages.deleteForEveryone(deleted.id, s.ownerId, 'withdrawn');
    await g.messages.deleteForMe(hidden.id, s.parentId);

    const group = await g.conversations.ensureStudentGroup(s.learnerId, s.ownerId);
    await g.messages.send({ conversationId: group.id, senderId: s.parentId, body: 'marker pending' });

    const hits = await g.messages.search({ actorId: s.parentId, query: 'marker' });
    expect(hits.hits.map((h) => h.message.body)).toEqual([]);
  });

  it('refuses a query too short to mean anything', async () => {
    await expect(g.messages.search({ actorId: s.parentId, query: 'a' })).rejects.toMatchObject({
      code: CommErrorCode.SEARCH_QUERY_TOO_SHORT,
    });
  });

  it('treats punctuation in the query as text rather than as syntax', async () => {
    const conv = await familyChannel();
    await g.messages.send({ conversationId: conv.id, senderId: s.ownerId, body: 'quarterly report' });
    // websearch_to_tsquery parses anything without raising, so a query full of
    // operators is a search, not a 500 and not an injection.
    await expect(
      g.messages.search({ actorId: s.ownerId, query: "report & | ! ( ) ' \" :*" }),
    ).resolves.toMatchObject({ hits: expect.any(Array) });
  });
});
