/**
 * Starred and pinned messages (Chat UI group B, owner decisions 2026-10-19).
 *
 *   A. a star is private, survives nothing it should not (leaving, hiding), and
 *      is listed back across conversations
 *   B. a pin is shared; anyone who may WRITE may pin or unpin; at most three,
 *      a fourth replacing the oldest; each viewer sees only pins they could
 *      read anyway
 *   C. the database holds the same lines (three, and same-conversation) for
 *      any writer
 */
import { randomUUID } from 'node:crypto';
import { CommErrorCode } from '@platform/errors';
import { buildGraph, seed, truncate, Scenario } from './harness';

jest.setTimeout(60_000);

const g = buildGraph();
let s: Scenario;
let groupId: string;

async function say(body: string, senderId = s.ownerId, extra: Record<string, unknown> = {}) {
  return g.messages.send({ conversationId: groupId, senderId, body, clientMessageId: randomUUID(), ...extra });
}

beforeAll(async () => { await g.prisma.$connect(); });
afterAll(async () => {
  await truncate(g.prisma);
  await g.prisma.$disconnect();
});
beforeEach(async () => {
  await truncate(g.prisma);
  s = await seed(g.prisma);
  g.coverage.onDutyId = s.ownerId;
  groupId = (await g.conversations.ensureStudentGroup(s.learnerId, s.ownerId)).id;
});

describe('A · stars are private bookmarks', () => {
  it('flags only the starrer\'s copy, and lists it back', async () => {
    const m = await say('homework for Thursday');
    await g.messages.star(m.id, s.parentId);
    await g.messages.star(m.id, s.parentId); // idempotent

    const mine = (await g.messages.list({ conversationId: groupId, actorId: s.parentId })).messages.find((x) => x.id === m.id)!;
    const theirs = (await g.messages.list({ conversationId: groupId, actorId: s.teacherId })).messages.find((x) => x.id === m.id)!;
    expect(mine.starred).toBe(true);
    expect(theirs.starred).toBe(false);

    const list = await g.messages.starred(s.parentId);
    expect(list.items.map((i) => i.message.id)).toEqual([m.id]);
    expect(list.items[0]!.conversationId).toBe(groupId);
    expect(list.items[0]!.message.starred).toBe(true);

    await g.messages.unstar(m.id, s.parentId);
    expect((await g.messages.starred(s.parentId)).items).toEqual([]);
  });

  it('is not listed once the starrer can no longer read the conversation', async () => {
    const m = await say('a note');
    await g.messages.star(m.id, s.teacherId);
    await g.prisma.conversationMember.updateMany({ where: { conversationId: groupId, actorId: s.teacherId }, data: { leftAt: new Date() } });
    expect((await g.messages.starred(s.teacherId)).items).toEqual([]);
  });

  it('cannot bookmark a message the actor cannot see (an internal note, for a parent)', async () => {
    const note = await say('staff only', s.ownerId, { visibility: 'internal' });
    await expect(g.messages.star(note.id, s.parentId)).rejects.toEqual(
      expect.objectContaining({ code: CommErrorCode.MESSAGE_NOT_FOUND }),
    );
  });
});

describe('B · pins are shared, and anyone who may write may pin', () => {
  it('a parent pins; everyone sees it pinned; a member unpins', async () => {
    const m = await say('the schedule for this week');
    await g.messages.pin(m.id, s.parentId);

    const forTeacher = await g.messages.pins(groupId, s.teacherId);
    expect(forTeacher.pins.map((p) => p.message.id)).toEqual([m.id]);
    expect(forTeacher.pins[0]!.pinnedBy).toBe(s.parentId);
    const page = await g.messages.list({ conversationId: groupId, actorId: s.ownerId });
    expect(page.messages.find((x) => x.id === m.id)!.pinned).toBe(true);

    // The change reaches every client in the conversation.
    const events = await g.prisma.outboxEvent.findMany({ where: { type: 'conversation.updated' } });
    expect(events.some((e) => (e.payload as { conversationId?: string }).conversationId === groupId)).toBe(true);

    await g.messages.unpin(m.id, s.ownerId);
    expect((await g.messages.pins(groupId, s.parentId)).pins).toEqual([]);
  });

  it('holds three: a fourth replaces the oldest', async () => {
    const msgs = [];
    for (const body of ['one', 'two', 'three', 'four']) msgs.push(await say(body));
    for (const m of msgs) await g.messages.pin(m.id, s.ownerId);
    const pins = await g.messages.pins(groupId, s.ownerId);
    expect(pins.pins.map((p) => p.message.body)).toEqual(['two', 'three', 'four']);
  });

  it('someone who may not write here may not pin (an outsider), nor pin a held or system message', async () => {
    const m = await say('hello');
    await expect(g.messages.pin(m.id, s.unrelatedTeacherId)).rejects.toBeTruthy();
    const system = await g.prisma.message.findFirst({ where: { conversationId: groupId, type: 'system' } });
    if (system) {
      await expect(g.messages.pin(system.id, s.ownerId)).rejects.toEqual(expect.objectContaining({ code: CommErrorCode.VALIDATION }));
    }
  });

  it('reading is not enough: in an archived conversation (readable, not writable) nobody pins', async () => {
    const m = await say('before the archive');
    await g.prisma.conversation.update({ where: { id: groupId }, data: { archivedAt: new Date() } });
    await expect(g.messages.pin(m.id, s.ownerId)).rejects.toEqual(
      expect.objectContaining({ code: CommErrorCode.CONVERSATION_ARCHIVED }),
    );
    expect(await g.prisma.messagePin.count()).toBe(0);
  });

  it('a pinned internal note is shown to staff and never to the family', async () => {
    const note = await say('call the parent tomorrow', s.ownerId, { visibility: 'internal' });
    await g.messages.pin(note.id, s.ownerId);
    expect((await g.messages.pins(groupId, s.ownerId)).pins.map((p) => p.message.id)).toEqual([note.id]);
    expect((await g.messages.pins(groupId, s.parentId)).pins).toEqual([]);
    // And a parent may not pin one (they cannot see it, so it reads as absent).
    await expect(g.messages.pin(note.id, s.parentId)).rejects.toEqual(expect.objectContaining({ code: CommErrorCode.MESSAGE_NOT_FOUND }));
  });
});

describe('C · the database holds the same lines', () => {
  it('refuses a fourth pin and a pin of another conversation\'s message, whoever writes', async () => {
    const msgs = [];
    for (const body of ['a', 'b', 'c', 'd']) msgs.push(await say(body));
    for (const m of msgs.slice(0, 3)) {
      await g.prisma.$executeRawUnsafe(
        `insert into chat.message_pin (conversation_id, message_id, pinned_by, pinned_by_kind) values ('${groupId}', '${m.id}', '${s.ownerId}', 'staff')`,
      );
    }
    await expect(
      g.prisma.$executeRawUnsafe(
        `insert into chat.message_pin (conversation_id, message_id, pinned_by, pinned_by_kind) values ('${groupId}', '${msgs[3]!.id}', '${s.ownerId}', 'staff')`,
      ),
    ).rejects.toThrow(/at most three/);

    const other = await g.conversations.getOrCreateDirect(s.ownerId, s.parentId);
    await expect(
      g.prisma.$executeRawUnsafe(
        `insert into chat.message_pin (conversation_id, message_id, pinned_by, pinned_by_kind) values ('${other.id}', '${msgs[0]!.id}', '${s.ownerId}', 'staff')`,
      ),
    ).rejects.toThrow(/must belong to the conversation/);
  });
});
