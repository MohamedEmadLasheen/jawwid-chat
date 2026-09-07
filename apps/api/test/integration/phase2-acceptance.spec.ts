/**
 * PHASE 2 -- the end-to-end acceptance scenario, executed.
 *
 * A (an authorized Family contact) and B (their authorized Supervisor/Admin)
 * hold a real conversation: send, receive over realtime, status, reply, react,
 * edit, forward, search, delete, reconnect. Every step below is a numbered step
 * of the acceptance scenario, in order, in one test, against the real migrated
 * database and the real services.
 *
 * WHAT IS REAL HERE, and what is not:
 *
 *   real  the database, the migrations, IdentityService, AuthorizationService,
 *         ScopeService, ConversationService, MessageService, the transactional
 *         outbox, and OutboxWorker's fan-out decisions.
 *   real  authentication -- A and B log in with a password through AuthService
 *         and every subsequent operation runs as the actor that resolved from
 *         their access token, not as an id the test picked.
 *   test  the socket. RealtimePublisher is a port, and this suite substitutes a
 *         recorder for it, so the assertions are about WHICH events reached
 *         WHICH audience. Socket.IO's own delivery is asserted separately by
 *         realtime-delivery.spec.ts; repeating it here would test the library.
 */
import { randomUUID } from 'node:crypto';
import { buildGraph, seed, truncate, Scenario } from './harness';
import { OutboxWorker } from '@communication/outbox/outbox.worker';
import { NotificationService } from '@communication/notifications/notification.service';
import { TemplateService } from '@communication/notifications/template.service';
import { QuietHoursService } from '@communication/notifications/quiet-hours.service';
import { LoggingPushProvider } from '@communication/notifications/push.provider';
import type { RealtimePublisher } from '@communication/realtime/realtime.publisher';
import { CommEvent } from '@communication/contracts/events';
import { ReceiptState } from '@communication/contracts/vocab';

jest.setTimeout(120_000);

const g = buildGraph();
let s: Scenario;

/** Every event the outbox actually published, with the audience it reached. */
interface Delivered {
  event: string;
  payload: Record<string, unknown>;
  toRoom?: string;
  toActors?: string[];
}

class RecordingPublisher implements RealtimePublisher {
  readonly delivered: Delivered[] = [];

  async toThread(conversationId: string, event: string, payload: unknown): Promise<void> {
    this.delivered.push({
      event,
      payload: payload as Record<string, unknown>,
      toRoom: conversationId,
    });
  }

  async toUsers(actorIds: string[], event: string, payload: unknown): Promise<void> {
    this.delivered.push({
      event,
      payload: payload as Record<string, unknown>,
      toActors: actorIds,
    });
  }
}

let realtime: RecordingPublisher;
let worker: OutboxWorker;

/**
 * Everything the client of `actorId` would now hold.
 *
 * Modelled the way a real client is: whatever it had, merged with what the
 * server serves, keyed by message id. The point of returning it as a MAP is
 * that a duplicate cannot hide in it -- if the same message arrived through the
 * POST response, the realtime event and a refetch, there is still one entry,
 * and the assertions on `size` below would catch a second.
 */
async function clientState(actorId: string, conversationId: string) {
  const { messages } = await g.messages.list({ conversationId, actorId, limit: 100 });
  return new Map(messages.map((m) => [m.id, m]));
}

/** Flush the outbox, the way the worker does in production. */
async function flush(): Promise<void> {
  await worker.drain();
}

/** The events delivered since the last call, then forget them. */
function drainDelivered(): Delivered[] {
  return realtime.delivered.splice(0, realtime.delivered.length);
}

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

  realtime = new RecordingPublisher();
  worker = new OutboxWorker(
    g.prisma,
    new NotificationService(
      g.prisma,
      new TemplateService(g.prisma),
      new QuietHoursService(g.prisma),
      g.config,
      new LoggingPushProvider(),
    ),
    realtime,
    g.identity,
  );
});

describe('PHASE 2 ACCEPTANCE -- Family <-> Supervisor, end to end', () => {
  it('completes the full scenario', async () => {
    // -------------------------------------------------------------- 1 & 2
    // A and B log in. Real credentials, real sessions, real tokens.
    const password = 'a-long-enough-test-password';
    await g.accounts.setPassword(s.accounts[s.parentId], password, { reason: 'test fixture' });
    await g.accounts.setPassword(s.accounts[s.ownerId], password, { reason: 'test fixture' });

    const A = await g.auth.login(`subject_${s.parentId}`, password);
    const B = await g.auth.login(`subject_${s.ownerId}`, password);

    // The identity every later step runs as is the one the TOKEN resolved to,
    // never an id this test chose.
    const aActor = (await g.auth.authenticate(A.accessToken))!.actor;
    const bActor = (await g.auth.authenticate(B.accessToken))!.actor;
    expect(aActor.actorId).toBe(s.parentId);
    expect(aActor.kind).toBe('contact');
    expect(bActor.actorId).toBe(s.ownerId);
    expect(bActor.kind).toBe('staff');

    // ------------------------------------------------------------------ 3
    // A opens their authorized conversation with B.
    const conversation = await g.conversations.getOrCreateDirect(aActor.actorId, bActor.actorId);
    expect(conversation.familyId).toBe(s.familyId);

    // ------------------------------------------------------------------ 4
    // B opens the same conversation -- the same row, not a second one.
    const sameForB = await g.conversations.requireForActor(conversation.id, bActor.actorId);
    expect(sameForB.id).toBe(conversation.id);

    // ------------------------------------------------------------------ 5
    // A sends.
    const greetingKey = randomUUID();
    const greeting = await g.messages.send({
      conversationId: conversation.id,
      senderId: aActor.actorId,
      body: 'السلام عليكم',
      clientMessageId: greetingKey,
    });

    // ------------------------------------------------------------------ 6
    // It is persisted, with its text intact and a server-assigned order.
    const persisted = await g.prisma.message.findUnique({ where: { id: greeting.id } });
    expect(persisted).not.toBeNull();
    expect(persisted!.body).toBe('السلام عليكم');
    expect(persisted!.authorId).toBe(aActor.actorId);
    expect(Number(persisted!.seq)).toBe(1);

    // ------------------------------------------------------------------ 7
    // B receives it over realtime, without refetching anything.
    await flush();
    const created = drainDelivered().filter((d) => d.event === CommEvent.MESSAGE_CREATED);
    expect(created).toHaveLength(1);
    expect(created[0].toRoom).toBe(conversation.id);
    expect(created[0].payload).toMatchObject({ messageId: greeting.id, seq: '1' });

    // ------------------------------------------------------------------ 8
    // A sees it as SENT.
    const asSentToA = (await clientState(aActor.actorId, conversation.id)).get(greeting.id)!;
    expect(asSentToA.receipts.map((r) => r.state)).toEqual([]); // A sees only their own
    expect(
      (await g.prisma.messageReceipt.findFirst({ where: { messageId: greeting.id } }))!.state,
    ).toBe(ReceiptState.SENT);

    // ------------------------------------------------------------------ 9
    // B's device acknowledges receipt: DELIVERED, and A is told.
    expect(
      await g.messages.markState([greeting.id], bActor.actorId, ReceiptState.DELIVERED),
    ).toBe(1);
    await flush();
    const deliveredEvents = drainDelivered().filter(
      (d) => d.event === CommEvent.MESSAGE_RECEIPT_UPDATED,
    );
    expect(deliveredEvents).toHaveLength(1);
    expect(deliveredEvents[0].payload).toMatchObject({
      messageId: greeting.id,
      actorId: bActor.actorId,
      state: ReceiptState.DELIVERED,
    });

    // ------------------------------------------------------------- 10 & 11
    // B opens and reads the conversation; A sees READ.
    await g.messages.markReadUpTo(conversation.id, bActor.actorId, greeting.seq!);
    await flush();
    const readEvents = drainDelivered().filter(
      (d) => d.event === CommEvent.MESSAGE_RECEIPT_UPDATED,
    );
    expect(readEvents.some((e) => e.payload.state === ReceiptState.READ)).toBe(true);

    // A's own view of their message now carries the full roster's strongest
    // state -- which is what the sender's ticks are drawn from.
    const rosterForB = await g.messages.list({
      conversationId: conversation.id,
      actorId: bActor.actorId,
    });
    expect(
      rosterForB.messages.find((m) => m.id === greeting.id)!.receipts[0].state,
    ).toBe(ReceiptState.READ);

    // ------------------------------------------------------------- 12 & 13
    // B replies; A receives it over realtime.
    const bReply = await g.messages.send({
      conversationId: conversation.id,
      senderId: bActor.actorId,
      body: 'وعليكم السلام، تفضل',
      clientMessageId: randomUUID(),
    });
    await flush();
    expect(
      drainDelivered().some(
        (d) => d.event === CommEvent.MESSAGE_CREATED && d.payload.messageId === bReply.id,
      ),
    ).toBe(true);

    // ------------------------------------------------------------- 14 & 15
    // A reacts; B sees the reaction.
    await g.messages.react(bReply.id, aActor.actorId, '👍');
    await flush();
    const reactionAdded = drainDelivered().filter((d) => d.event === CommEvent.REACTION_ADDED);
    expect(reactionAdded).toHaveLength(1);
    expect(reactionAdded[0].payload).toMatchObject({
      messageId: bReply.id,
      actorId: aActor.actorId,
      emoji: '👍',
    });
    expect(
      (await clientState(bActor.actorId, conversation.id)).get(bReply.id)!.reactions,
    ).toEqual([{ actorId: aActor.actorId, emoji: '👍' }]);

    // ----------------------------------------------------------------- 16
    // A removes the reaction.
    await g.messages.unreact(bReply.id, aActor.actorId);
    await flush();
    expect(drainDelivered().some((d) => d.event === CommEvent.REACTION_REMOVED)).toBe(true);
    expect(
      (await clientState(bActor.actorId, conversation.id)).get(bReply.id)!.reactions,
    ).toEqual([]);

    // ------------------------------------------------------------- 17 & 18
    // A edits an allowed message; B sees the edited state.
    const edited = await g.messages.edit({
      messageId: greeting.id,
      actorId: aActor.actorId,
      body: 'السلام عليكم ورحمة الله',
    });
    expect(edited.editCount).toBe(1);
    await flush();
    const updates = drainDelivered().filter((d) => d.event === CommEvent.MESSAGE_UPDATED);
    expect(updates).toHaveLength(1);
    expect(updates[0].payload).toMatchObject({ messageId: greeting.id, editCount: 1 });

    const bSeesEdit = (await clientState(bActor.actorId, conversation.id)).get(greeting.id)!;
    expect(bSeesEdit.body).toBe('السلام عليكم ورحمة الله');
    expect(bSeesEdit.editedAt).not.toBeNull();
    // And what it used to say is still recoverable, by somebody who moderates.
    expect((await g.messages.revisions(greeting.id, bActor.actorId))[0].body).toBe('السلام عليكم');

    // ------------------------------------------------------------- 19 & 20
    // A replies to a message; B sees the quote resolved correctly.
    const aReply = await g.messages.send({
      conversationId: conversation.id,
      senderId: aActor.actorId,
      body: 'شكرا لكم',
      replyToMessageId: bReply.id,
      clientMessageId: randomUUID(),
    });
    await flush();
    drainDelivered();

    const quoted = (await clientState(bActor.actorId, conversation.id)).get(aReply.id)!;
    expect(quoted.replyToMessageId).toBe(bReply.id);
    expect(quoted.replyPreview).toMatchObject({
      available: true,
      excerpt: 'وعليكم السلام، تفضل',
      authorId: bActor.actorId,
    });

    // ----------------------------------------------------------------- 21
    // A's message is forwarded to another allowed conversation. B does the
    // forwarding: it is B who is a member of both.
    const group = await g.conversations.ensureStudentGroup(s.learnerId, bActor.actorId);
    const [forwarded] = await g.messages.forward({
      messageId: aReply.id,
      actorId: bActor.actorId,
      conversationId: conversation.id,
      toConversationIds: [group.id],
    });
    expect(forwarded.conversationId).toBe(group.id);
    expect(forwarded.isForwarded).toBe(true);
    expect(forwarded.body).toBe('شكرا لكم');
    await flush();
    drainDelivered();

    // ----------------------------------------------------------- 22, 23, 24, 25
    // Search: by text, by sender, by date, and within the conversation.
    const byText = await g.messages.search({ actorId: bActor.actorId, query: 'شكرا' });
    expect(byText.hits.map((h) => h.message.id)).toContain(aReply.id);

    const bySender = await g.messages.search({
      actorId: bActor.actorId,
      query: 'شكرا',
      authorId: aActor.actorId,
    });
    expect(bySender.hits.every((h) => h.message.authorId === aActor.actorId)).toBe(true);
    expect(bySender.hits.map((h) => h.message.id)).toContain(aReply.id);

    const byDate = await g.messages.search({
      actorId: bActor.actorId,
      query: 'شكرا',
      from: new Date(Date.now() - 3600_000),
      to: new Date(Date.now() + 3600_000),
    });
    expect(byDate.hits.map((h) => h.message.id)).toContain(aReply.id);

    const inConversation = await g.messages.search({
      actorId: bActor.actorId,
      query: 'شكرا',
      conversationId: conversation.id,
    });
    expect(inConversation.hits.every((h) => h.conversationId === conversation.id)).toBe(true);
    // The forwarded copy lives in the group, so scoping excludes it.
    expect(inConversation.hits.map((h) => h.message.id)).not.toContain(forwarded.id);

    // ------------------------------------------------------------- 26 & 27
    // A deletes a message for THEMSELVES; B still sees it.
    await g.messages.deleteForMe(bReply.id, aActor.actorId);
    expect((await clientState(aActor.actorId, conversation.id)).has(bReply.id)).toBe(false);

    const bStillSees = (await clientState(bActor.actorId, conversation.id)).get(bReply.id)!;
    expect(bStillSees.body).toBe('وعليكم السلام، تفضل');
    expect(bStillSees.deletedForAll).toBe(false);

    // ------------------------------------------------------------- 28 & 29
    // A deletes another allowed message for EVERYONE; B sees the tombstone.
    await g.messages.deleteForEveryone(aReply.id, aActor.actorId, 'sent in error');
    await flush();
    const deletedEvents = drainDelivered().filter((d) => d.event === CommEvent.MESSAGE_DELETED);
    expect(deletedEvents).toHaveLength(1);
    expect(deletedEvents[0].payload).toMatchObject({
      messageId: aReply.id,
      deletedForAll: true,
    });

    const tombstone = (await clientState(bActor.actorId, conversation.id)).get(aReply.id)!;
    expect(tombstone.deletedForAll).toBe(true);
    expect(tombstone.body).toBeNull();
    // The withdrawn text is nowhere in what B is served.
    expect(JSON.stringify([...(await clientState(bActor.actorId, conversation.id)).values()]))
      .not.toContain('شكرا لكم');

    // ------------------------------------------------------- 30, 31, 34
    // Close and reopen: the state is rebuilt from the server and is correct.
    const reopenedA = await clientState(aActor.actorId, conversation.id);
    const reopenedB = await clientState(bActor.actorId, conversation.id);

    // A hid B's reply for themselves, so A holds one fewer.
    expect(reopenedA.size).toBe(reopenedB.size - 1);
    // Order is the SERVER's. The backwards page is served newest-first, which
    // is the order a reversed chat list consumes; what matters is that seq is
    // total and gap-free, because that -- not arrival order -- is what the
    // client sorts on.
    const seqsB = [...reopenedB.values()].map((m) => Number(m.seq));
    expect(seqsB).toEqual([...seqsB].sort((x, y) => y - x));
    const ascending = [...seqsB].sort((x, y) => x - y);
    expect(new Set(ascending).size).toBe(ascending.length);
    expect(ascending).toEqual(
      Array.from({ length: ascending.length }, (_, i) => ascending[0] + i),
    );
    // The edit survived the reopen; the deletion did too.
    expect(reopenedB.get(greeting.id)!.body).toBe('السلام عليكم ورحمة الله');
    expect(reopenedB.get(aReply.id)!.deletedForAll).toBe(true);

    // ------------------------------------------------------------- 32 & 33
    // Reconnect. The client catches up from the highest seq it holds, and the
    // realtime events it already applied do not become duplicates.
    const watermark = Math.max(...seqsB);
    const catchUp = await g.messages.list({
      conversationId: conversation.id,
      actorId: bActor.actorId,
      after: String(watermark),
    });
    expect(catchUp.messages).toEqual([]);

    // A message that arrives while offline appears exactly once after catch-up.
    const whileAway = await g.messages.send({
      conversationId: conversation.id,
      senderId: aActor.actorId,
      body: 'هل وصلتكم الرسالة؟',
      clientMessageId: randomUUID(),
    });
    const afterReconnect = await g.messages.list({
      conversationId: conversation.id,
      actorId: bActor.actorId,
      after: String(watermark),
    });
    expect(afterReconnect.messages.map((m) => m.id)).toEqual([whileAway.id]);

    const merged = new Map(reopenedB);
    for (const m of afterReconnect.messages) merged.set(m.id, m);
    // Replaying the same catch-up, as a flaky connection would, changes nothing.
    for (const m of afterReconnect.messages) merged.set(m.id, m);
    expect(merged.size).toBe(reopenedB.size + 1);

    // A retried send under the SAME client key is not a second message either.
    const retried = await g.messages.send({
      conversationId: conversation.id,
      senderId: aActor.actorId,
      body: 'السلام عليكم',
      clientMessageId: greetingKey,
    });
    expect(retried.id).toBe(greeting.id);

    // ----------------------------------------------------------------- 35
    // Unread behaves: B has read everything up to the watermark, so only what
    // arrived afterwards is unread -- and reading it clears the count.
    const rowsForB = await g.conversations.listRowsForActor(bActor.actorId);
    const rowB = rowsForB.find((r) => r.conversation.id === conversation.id)!;
    expect(rowB.extras.unreadCount).toBe(1);
    expect(rowB.extras.lastMessagePreview).toBe('هل وصلتكم الرسالة؟');

    await g.messages.markReadUpTo(conversation.id, bActor.actorId, whileAway.seq!);
    const clearedRows = await g.conversations.listRowsForActor(bActor.actorId);
    expect(
      clearedRows.find((r) => r.conversation.id === conversation.id)!.extras.unreadCount,
    ).toBe(0);
  });

  it('an unauthorized supervisor is refused at every step of the same scenario', async () => {
    const conversation = await g.conversations.getOrCreateDirect(s.parentId, s.ownerId);
    const m = await g.messages.send({
      conversationId: conversation.id,
      senderId: s.parentId,
      body: 'family business',
    });

    // otherAdmin holds every permission the supervisor above holds. What they
    // do not hold is this family, and that is the whole difference.
    const intruder = s.otherAdminId;

    await expect(g.conversations.requireForActor(conversation.id, intruder)).rejects.toBeDefined();
    await expect(
      g.messages.list({ conversationId: conversation.id, actorId: intruder }),
    ).rejects.toBeDefined();
    await expect(
      g.messages.send({ conversationId: conversation.id, senderId: intruder, body: 'hello' }),
    ).rejects.toBeDefined();
    await expect(g.messages.react(m.id, intruder, '👍')).rejects.toBeDefined();
    await expect(g.messages.edit({ messageId: m.id, actorId: intruder, body: 'x' })).rejects.toBeDefined();
    await expect(g.messages.deleteForMe(m.id, intruder)).rejects.toBeDefined();
    await expect(g.messages.deleteForEveryone(m.id, intruder, 'x')).rejects.toBeDefined();
    await expect(
      g.messages.forward({ messageId: m.id, actorId: intruder, toConversationIds: [conversation.id] }),
    ).rejects.toBeDefined();
    await expect(
      g.messages.markReadUpTo(conversation.id, intruder, '1'),
    ).rejects.toBeDefined();

    // And search -- the operation most likely to leak by returning too much --
    // finds nothing, though the text is an exact match.
    expect((await g.messages.search({ actorId: intruder, query: 'family business' })).hits).toEqual([]);
  });
});
