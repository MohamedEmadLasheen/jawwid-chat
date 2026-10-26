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
import { buildGraph, seed, truncate, Scenario } from './harness';

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
});

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

async function threeFromParent() {
  const ids: string[] = [];
  for (const body of ['one', 'two', 'three']) {
    ids.push((await g.messages.send({ conversationId: groupId, senderId: s.parentId, body })).id);
  }
  return ids;
}

describe('PD-37: cursors move forward only', () => {
  it('a later, lower read changes nothing; a read past the end stops at the last message', async () => {
    const [m1, , m3] = await threeFromParent();
    await g.messages.markReadUpTo(groupId, s.teacherId, '3');
    const at3 = await cursorOf(s.teacherId);
    expect(at3!.lastReadSeq).toBe(3n);
    expect(at3!.lastReadAt).not.toBeNull();

    await g.messages.markReadUpTo(groupId, s.teacherId, '1'); // replayed / late
    expect((await cursorOf(s.teacherId))!.lastReadSeq).toBe(3n);
    expect((await cursorOf(s.teacherId))!.lastReadAt).toEqual(at3!.lastReadAt);
    const r1 = await g.prisma.messageReceipt.findFirstOrThrow({ where: { messageId: m1, actorId: s.teacherId } });
    expect(r1.state).toBe('read');

    await g.messages.markReadUpTo(groupId, s.ownerId, '999');
    expect((await cursorOf(s.ownerId))!.lastReadSeq).toBe(3n);
    const r3 = await g.prisma.messageReceipt.findFirstOrThrow({ where: { messageId: m3, actorId: s.ownerId } });
    expect(r3.state).toBe('read');
  });

  it('a read implies delivered; delivered never passes read backwards', async () => {
    await threeFromParent();
    await g.messages.markReadUpTo(groupId, s.teacherId, '2');
    expect((await cursorOf(s.teacherId))!.lastDeliveredSeq).toBe(2n);
    await g.messages.markDeliveredUpTo(groupId, s.teacherId, '1');
    expect((await cursorOf(s.teacherId))!.lastDeliveredSeq).toBe(2n);
    await g.messages.markDeliveredUpTo(groupId, s.teacherId, '3');
    const c = await cursorOf(s.teacherId);
    expect([c!.lastReadSeq, c!.lastDeliveredSeq]).toEqual([2n, 3n]);
  });

  it('delivered moves receipts from sent to delivered and never downgrades a read', async () => {
    const [m1, m2, m3] = await threeFromParent();
    await g.messages.markReadUpTo(groupId, s.ownerId, '1');
    await g.messages.markDeliveredUpTo(groupId, s.ownerId, '2');
    const states = await Promise.all(
      [m1, m2, m3].map((id) => g.prisma.messageReceipt.findFirstOrThrow({ where: { messageId: id, actorId: s.ownerId } })),
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
    await threeFromParent();
    await g.messages.markReadUpTo(groupId, s.teacherId, '2');
    await g.messages.markReadUpTo(groupId, s.teacherId, '2'); // repeat
    await g.messages.markReadUpTo(groupId, s.teacherId, '1'); // backwards
    await g.messages.markReadUpTo(groupId, s.managerId, '3'); // standing, no seat
    await g.messages.markDeliveredUpTo(groupId, s.ownerId, '3');

    expect(await advancedRows()).toEqual([
      { conversationId: groupId, actorId: s.teacherId, kind: 'read', fromSeq: '0', toSeq: '2' },
      { conversationId: groupId, actorId: s.ownerId, kind: 'delivered', fromSeq: '0', toSeq: '3' },
    ]);
  });
});

describe('PD-37: the worker tells authors, never the room', () => {
  it("each author gets their own ticks through an audience of one; the reader's row never reaches the room", async () => {
    const [m1, m2] = await threeFromParent();
    const fromTeacher = await g.messages.send({ conversationId: groupId, senderId: s.teacherId, body: 'noted' });
    for (const id of [s.otherParentId, s.teacherId]) await g.messages.markReadUpTo(groupId, id, '4');
    await g.messages.markReadUpTo(groupId, s.ownerId, '2');

    const recorder = new Recorder();
    const worker = new OutboxWorker(g.prisma, g.notifications, recorder, g.identity);
    await worker.drain(500);

    expect(recorder.thread.map((t) => t.event)).not.toContain(CommEvent.RECEIPTS_ADVANCED);
    expect(recorder.thread.map((t) => t.event)).not.toContain(CommEvent.MESSAGE_STATUS);
    expect(recorder.audience.every((d) => d.event === CommEvent.MESSAGE_STATUS)).toBe(true);
    expect(recorder.audience.every((d) => d.audience.onlyActors?.length === 1)).toBe(true);

    // The parent's last word on each of their messages, in delivery order.
    const forParent = new Map<string, string>();
    const forTeacher = new Map<string, string>();
    for (const d of recorder.audience) {
      const target = d.audience.onlyActors![0];
      const items = (d.payload as { items: Array<{ messageId: string; status: string }> }).items;
      expect([s.parentId, s.teacherId]).toContain(target);
      const into = target === s.parentId ? forParent : forTeacher;
      for (const it of items) into.set(it.messageId, it.status);
    }
    // Messages 1 and 2: everyone seated has read them once the supervisor reads to 2.
    expect(forParent.get(m1)).toBe('read');
    expect(forParent.get(m2)).toBe('read');
    // The teacher's message (seq 4): the supervisor read only to 2 -- not blue.
    expect(forTeacher.get(fromTeacher.id)).not.toBe('read');
    expect(forParent.has(fromTeacher.id)).toBe(false);
  });

  it('fails -- and keeps the row -- rather than fall back to the whole room', async () => {
    await threeFromParent();
    await g.messages.markReadUpTo(groupId, s.teacherId, '3');
    const roomOnly: RealtimePublisher = { toThread: async () => {}, toUsers: async () => {} };
    const worker = new OutboxWorker(g.prisma, g.notifications, roomOnly, g.identity);
    await worker.drain(500);

    const row = await g.prisma.outboxEvent.findFirstOrThrow({ where: { type: CommEvent.RECEIPTS_ADVANCED } });
    expect(row.status).toBe('pending');
    expect(row.lastError).toMatch(/cannot address part of a conversation/);
  });
});
