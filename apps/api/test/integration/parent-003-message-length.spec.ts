/**
 * PARENT-003 -- no message length limit (QA P-030: 95,000 characters were
 * accepted). A body is at most 4000 characters, counted as a person sees them
 * (the mobile composer's own limit): a text, a caption and an edit alike are
 * refused past it with COMM.MESSAGE_TOO_LONG, which names the limit; nothing
 * is stored.
 *
 * Synthetic fixtures only (G-16).
 */
import { randomUUID } from 'node:crypto';
import { CommError, CommErrorCode } from '@platform/errors';
import { buildGraph, seed, truncate, Scenario } from './harness';

jest.setTimeout(60_000);

const g = buildGraph();
let s: Scenario;
let groupId: string;

const say = (body: string, senderId?: string) =>
  g.messages.send({ conversationId: groupId, senderId: senderId ?? s.parentId, body, clientMessageId: randomUUID() });

async function refusal(p: Promise<unknown>): Promise<{ code: string; message: string } | 'sent'> {
  try {
    await p;
    return 'sent';
  } catch (e) {
    if (e instanceof CommError) return { code: e.code, message: e.message };
    throw e;
  }
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

describe('PARENT-003: a message is at most 4000 characters', () => {
  it('a parent sends 4000 characters; 4001 -- or the 95,000 QA sent -- are refused, naming the limit, and nothing is stored', async () => {
    expect((await say('a'.repeat(4000))).body).toHaveLength(4000);
    const before = await g.prisma.message.count({ where: { conversationId: groupId } });
    for (const n of [4001, 95_000]) {
      expect(await refusal(say('b'.repeat(n)))).toEqual({
        code: CommErrorCode.MESSAGE_TOO_LONG,
        message: 'a message may be at most 4000 characters',
      });
    }
    expect(await g.prisma.message.count({ where: { conversationId: groupId } })).toBe(before);
  });

  it('counts as a person does: 4000 emoji pass though they are 8000 code units', async () => {
    const heart = '❤️';
    expect((await say(heart.repeat(4000))).body).toBe(heart.repeat(4000));
    expect(await refusal(say(heart.repeat(4001)))).toMatchObject({ code: CommErrorCode.MESSAGE_TOO_LONG });
  });

  it('staff are held to it too, and an edit may not grow a message past it', async () => {
    expect(await refusal(say('c'.repeat(4001), s.ownerId))).toMatchObject({ code: CommErrorCode.MESSAGE_TOO_LONG });
    const m = await say('short', s.ownerId);
    expect(await refusal(g.messages.edit(m.id, s.ownerId, 'd'.repeat(4001), groupId))).toMatchObject({
      code: CommErrorCode.MESSAGE_TOO_LONG,
    });
    expect((await g.messages.edit(m.id, s.ownerId, 'd'.repeat(4000), groupId)).body).toHaveLength(4000);
  });
});
