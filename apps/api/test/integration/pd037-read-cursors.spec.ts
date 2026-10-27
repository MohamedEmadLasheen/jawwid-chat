/**
 * PD-37 P1a-1: read and delivery cursors, and the ticks they move.
 *
 *   - A cursor only moves FORWARD and never past the conversation's last seq.
 *   - A read implies delivered.
 *   - A seated reader's move writes ONE `receipts.advanced` outbox row in the
 *     same transaction; a repeat, or a reader without a seat, writes none.
 *   - The worker turns that row into `message.status` for each AUTHOR, through
 *     an audience delivery -- never the room -- and fails rather than widen it.
 *
 * Cast as in pd037-message-receipts: the learner's Student Group with parent_p,
 * parent_q, teacher_c and admin_a (supervisor) seated; manager_c reads through
 * PD-8 standing without a seat.
 */
import { CommErrorCode } from '@platform/errors';
import { CommEvent } from '@communication/contracts/events';
import { OutboxWorker } from '@communication/outbox/outbox.worker';
import type { DeliveryAudience, RealtimePublisher } from '@communication/realtime/realtime.publisher';
import { buildGraph, legacyTeacherParentDirect, seed, truncate, Scenario } from './harness';

jest.setTimeout(60_000);

const g = buildGraph();
let s: Scenario;
let groupId: string;

/** Records every delivery the worker asks for. */
class Recorder implements RealtimePublisher {
  readonly thread: Array<{ conversationId: string; event: string }> = [];
  readonly audience: Array<{ conversationId: string; event: string; payload: unknown; audience: DeliveryAudience }> = [];
  async toThread(conversationId: string, event: string): Promise<void> {
    this.thread.push({ conversationId, event });
  }
  async toUsers(): Promise<void> {}
  async toThreadAudience(conversationId: string, event: string, payload: unknown, audience: DeliveryAudience): Promise<void> {
    this.audience.push({ conversationId, event, payload, audience });
  }
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
  groupId = (await g.conversations.ensureStudentGroup(s.learnerId, s.ownerId)).id;
  await setAnnounce(true);
});

/** The deploy switch (realtime.receipts_announce): ON once the PD-37 worker runs everywhere. */
async function setAnnounce(on: boolean) {
  await g.prisma.$executeRawUnsafe(
    `insert into chat.config (key, value, scope) values ('realtime.receipts_announce', '${on}'::jsonb, 'realtime')
     on conflict (key) do update set value = excluded.value`,
  );
  g.config.invalidate();
}

async function cursorOf(actorId: string) {
  return g.prisma.conversationParticipantState.findUnique({
    where: { conversationId_actorId: { conversationId: groupId, actorId } },
  });
}

async function advancedRows() {
  const rows = await g.prisma.outboxEvent.findMany({
    where: { type: CommEvent.RECEIPTS_ADVANCED },
    orderBy: { createdAt: 'asc' },
  });
  return rows.map((r) => r.payload as Record<string, string>);
}

/**
 * Three messages from the parent, with their seqs. A Student Group opens with
 * its own system message, so the parent's are NOT seq 1..3: every cursor in
 * these tests is taken from a real seq, never assumed.
 */
async function threeFromParent() {
  const sent: Array<{ id: string; seq: string }> = [];
  for (const body of ['one', 'two', 'three']) {
    const m = await g.messages.send({ conversationId: groupId, senderId: s.parentId, body });
    sent.push({ id: m.id, seq: m.seq! });
  }
  return sent;
}
const big = (seq: string) => BigInt(seq);

describe('PD-37: cursors move forward only', () => {
  it('a later, lower read changes nothing; a read past the end stops at the last message', async () => {
    const [m1, , m3] = await threeFromParent();
    await g.messages.markReadUpTo(groupId, s.teacherId, m3.seq);
    const atEnd = await cursorOf(s.teacherId);
    expect(atEnd!.lastReadSeq).toBe(big(m3.seq));
    expect(atEnd!.lastReadAt).not.toBeNull();

    await g.messages.markReadUpTo(groupId, s.teacherId, m1.seq); // replayed / late
    expect((await cursorOf(s.teacherId))!.lastReadSeq).toBe(big(m3.seq));
    expect((await cursorOf(s.teacherId))!.lastReadAt).toEqual(atEnd!.lastReadAt);
    const r1 = await g.prisma.messageReceipt.findFirstOrThrow({ where: { messageId: m1.id, actorId: s.teacherId } });
    expect(r1.state).toBe('read');

    await g.messages.markReadUpTo(groupId, s.ownerId, '999');
    expect((await cursorOf(s.ownerId))!.lastReadSeq).toBe(big(m3.seq)); // the last message, not 999
    const r3 = await g.prisma.messageReceipt.findFirstOrThrow({ where: { messageId: m3.id, actorId: s.ownerId } });
    expect(r3.state).toBe('read');
  });

  it('a read implies delivered; delivered never passes read backwards', async () => {
    const [m1, m2, m3] = await threeFromParent();
    await g.messages.markReadUpTo(groupId, s.teacherId, m2.seq);
    expect((await cursorOf(s.teacherId))!.lastDeliveredSeq).toBe(big(m2.seq));
    await g.messages.markDeliveredUpTo(groupId, s.teacherId, m1.seq);
    expect((await cursorOf(s.teacherId))!.lastDeliveredSeq).toBe(big(m2.seq));
    await g.messages.markDeliveredUpTo(groupId, s.teacherId, m3.seq);
    const c = await cursorOf(s.teacherId);
    expect([c!.lastReadSeq, c!.lastDeliveredSeq]).toEqual([big(m2.seq), big(m3.seq)]);
  });

  it('delivered moves receipts from sent to delivered and never downgrades a read', async () => {
    const [m1, m2, m3] = await threeFromParent();
    await g.messages.markReadUpTo(groupId, s.ownerId, m1.seq);
    await g.messages.markDeliveredUpTo(groupId, s.ownerId, m2.seq);
    const states = await Promise.all(
      [m1, m2, m3].map((m) => g.prisma.messageReceipt.findFirstOrThrow({ where: { messageId: m.id, actorId: s.ownerId } })),
    );
    expect(states.map((r) => r.state)).toEqual(['read', 'delivered', 'sent']);
    expect(states[1].deliveredAt).not.toBeNull();
  });

  it('refuses a malformed or negative cursor', async () => {
    for (const bad of ['abc', '-1', '1.5']) {
      await expect(g.messages.markReadUpTo(groupId, s.teacherId, bad)).rejects.toMatchObject({
        code: CommErrorCode.VALIDATION,
      });
    }
  });
});

describe('PD-37: receipts.advanced', () => {
  it('one row per forward move of a seated reader, none for a repeat, none without a seat', async () => {
    const [m1, m2, m3] = await threeFromParent();
    await g.messages.markReadUpTo(groupId, s.teacherId, m2.seq);
    await g.messages.markReadUpTo(groupId, s.teacherId, m2.seq); // repeat
    await g.messages.markReadUpTo(groupId, s.teacherId, m1.seq); // backwards
    await g.messages.markReadUpTo(groupId, s.managerId, m3.seq); // standing, no seat
    await g.messages.markDeliveredUpTo(groupId, s.ownerId, m3.seq);

    expect(await advancedRows()).toEqual([
      { conversationId: groupId, actorId: s.teacherId, kind: 'read', fromSeq: '0', toSeq: m2.seq },
      { conversationId: groupId, actorId: s.ownerId, kind: 'delivered', fromSeq: '0', toSeq: m3.seq },
    ]);
  });
});

describe('PD-37: nothing a worker from before PD-37 could broadcast', () => {
  /**
   * A worker from before PD-37 has no case for receipts.advanced; its DEFAULT
   * branch hands any event with a conversationId to the whole room -- the
   * reader's cursor, to silent members, observers and PD-8 readers alike. So
   * until the switch is on, the row must never be written at all.
   */
  it('with the deploy switch OFF (the default), no receipts.advanced row is ever written', async () => {
    await setAnnounce(false);
    const [, , m3] = await threeFromParent();
    await g.messages.markReadUpTo(groupId, s.teacherId, m3.seq);
    await g.messages.markDeliveredUpTo(groupId, s.ownerId, m3.seq);
    expect(await advancedRows()).toEqual([]);
    // The cursors and receipts still moved; only the live push waits.
    expect((await cursorOf(s.teacherId))!.lastReadSeq).toBe(BigInt(m3.seq));
  });

  it('the compiled default is OFF', async () => {
    await g.prisma.$executeRawUnsafe(`delete from chat.config where key = 'realtime.receipts_announce'`);
    g.config.invalidate();
    expect(await g.config.get('realtime.receipts_announce')).toBe(false);
  });

  it('PD-7: a direct teacher<->parent conversation never announces, switch on or not', async () => {
    const directId = await legacyTeacherParentDirect(g.prisma, s.teacherId, s.parentId, s.familyId);
    // A PD-6-era message in it, written the way that era did (triggers off).
    await g.prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`set local session_replication_role = replica`);
      const m = await tx.message.create({
        data: { conversationId: directId, authorType: 'contact', authorId: s.parentId, type: 'text', body: 'legacy', seq: 1n, visibility: 'customer' },
      });
      await tx.messageReceipt.create({ data: { messageId: m.id, actorId: s.teacherId, state: 'sent' } });
      await tx.conversation.update({ where: { id: directId }, data: { lastSeq: 1n } });
    });
    await g.messages.markReadUpTo(directId, s.teacherId, '1');
    // The read itself happened (history stays readable under PD-7)...
    const cursor = await g.prisma.conversationParticipantState.findUnique({
      where: { conversationId_actorId: { conversationId: directId, actorId: s.teacherId } },
    });
    expect(cursor!.lastReadSeq).toBe(1n);
    // ...and announced nothing to the other side.
    expect((await advancedRows()).filter((r) => r.conversationId === directId)).toEqual([]);
  });
});

describe('PD-37: the worker tells authors, never the room', () => {
  it("each author gets their own ticks through an audience of one; the reader's row never reaches the room", async () => {
    const [m1, m2] = await threeFromParent();
    const fromTeacher = await g.messages.send({ conversationId: groupId, senderId: s.teacherId, body: 'noted' });
    for (const id of [s.otherParentId, s.teacherId]) await g.messages.markReadUpTo(groupId, id, fromTeacher.seq!);
    await g.messages.markReadUpTo(groupId, s.ownerId, m2.seq);

    const recorder = new Recorder();
    const worker = new OutboxWorker(g.prisma, g.notifications, recorder, g.identity);
    await worker.drain(500);

    expect(recorder.thread.map((t) => t.event)).not.toContain(CommEvent.RECEIPTS_ADVANCED);
    expect(recorder.thread.map((t) => t.event)).not.toContain(CommEvent.MESSAGE_STATUS);
    expect(recorder.audience.every((d) => d.event === CommEvent.MESSAGE_STATUS)).toBe(true);
    // One delivery per cursor move, however many authors it covers; each
    // author's payload is their own (perActor), and only authors are in it.
    for (const d of recorder.audience) {
      expect(Object.keys(d.audience.perActor ?? {}).sort()).toEqual([...(d.audience.onlyActors ?? [])].sort());
    }

    // Each author's last word on each of their messages, in delivery order.
    const forParent = new Map<string, string>();
    const forTeacher = new Map<string, string>();
    for (const d of recorder.audience) {
      for (const [target, own] of Object.entries(d.audience.perActor ?? {})) {
        expect([s.parentId, s.teacherId]).toContain(target);
        const into = target === s.parentId ? forParent : forTeacher;
        for (const it of (own as { items: Array<{ messageId: string; status: string }> }).items) into.set(it.messageId, it.status);
      }
    }
    // The parent's first two: everyone seated has read them once the supervisor reads to the second.
    expect(forParent.get(m1.id)).toBe('read');
    expect(forParent.get(m2.id)).toBe('read');
    // The teacher's message (the newest): the supervisor stopped earlier -- not blue.
    expect(forTeacher.get(fromTeacher.id)).not.toBe('read');
    expect(forParent.has(fromTeacher.id)).toBe(false);
  });

  it('fails -- and keeps the row -- rather than fall back to the whole room', async () => {
    const [, , m3] = await threeFromParent();
    await g.messages.markReadUpTo(groupId, s.teacherId, m3.seq);
    const roomOnly: RealtimePublisher = { toThread: async () => {}, toUsers: async () => {} };
    const worker = new OutboxWorker(g.prisma, g.notifications, roomOnly, g.identity);
    await worker.drain(500);

    const row = await g.prisma.outboxEvent.findFirstOrThrow({ where: { type: CommEvent.RECEIPTS_ADVANCED } });
    expect(row.status).toBe('pending');
    expect(row.lastError).toMatch(/cannot address part of a conversation/);
  });
});
