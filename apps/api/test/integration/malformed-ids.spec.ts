/**
 * An id that is not a uuid names nothing. It is answered as an unknown row
 * (401 actor / 404 conversation / 404 message) -- never handed to Postgres,
 * whose type error used to surface as a 500 on every chat route (found on a
 * live stack, 2026-10-14).
 */
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
});

async function refusal(p: Promise<unknown>): Promise<[string, number]> {
  try {
    await p;
  } catch (e) {
    if (e instanceof CommError) return [e.code, e.status];
    throw e;
  }
  throw new Error('expected a refusal');
}

describe('malformed ids are unknown, not server errors', () => {
  it('a direct conversation with a non-uuid counterpart is an unknown actor', async () => {
    for (const bad of ['', 'not-a-uuid', '1; drop table x', undefined as unknown as string]) {
      expect(await refusal(g.conversations.getOrCreateDirect(s.parentId, bad))).toEqual([
        CommErrorCode.UNKNOWN_ACTOR,
        401,
      ]);
    }
  });

  it('a non-uuid conversation id is not found, on read and on send', async () => {
    expect(await refusal(g.messages.list({ conversationId: 'nope', actorId: s.parentId }))).toEqual([
      CommErrorCode.CONVERSATION_NOT_FOUND,
      404,
    ]);
    expect(
      await refusal(g.messages.send({ conversationId: 'nope', senderId: s.parentId, body: 'x' })),
    ).toEqual([CommErrorCode.CONVERSATION_NOT_FOUND, 404]);
  });

  it('a non-uuid message id is not found', async () => {
    expect(await refusal(g.messages.deleteForMe('nope', s.parentId))).toEqual([
      CommErrorCode.MESSAGE_NOT_FOUND,
      404,
    ]);
  });
});
