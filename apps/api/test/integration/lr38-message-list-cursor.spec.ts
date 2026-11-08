/**
 * LR-38 (RT-017/RT-018): the message list refuses a malformed or contradictory
 * cursor with a 400, against the real service and the real controller.
 *
 * Before: `?before=abc` reached `BigInt("abc")` and answered 500, and
 * `?before=..&after=..` let `after` overwrite `before` without a word.
 */
import { CommError, CommErrorCode } from '@platform/errors';
import { MessageController } from '@communication/api/message.controller';
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
});

/** The controller is a thin pass-through; built here so the query strings arrive exactly as HTTP gives them. */
const controller = () => new MessageController(g.messages, undefined as never);

async function conversationWithFive() {
  const conv = await g.conversations.getOrCreateDirect(s.parentId, s.ownerId);
  for (let i = 0; i < 5; i += 1) {
    await g.messages.send({ conversationId: conv.id, senderId: s.parentId, body: `m${i}`, clientMessageId: `lr38-${i}` });
  }
  return conv;
}

async function refusal(promise: Promise<unknown>): Promise<CommError> {
  try {
    await promise;
  } catch (error) {
    return error as CommError;
  }
  throw new Error('expected the list to be refused');
}

describe('LR-38: message list cursors', () => {
  it('a non-numeric before is a 400 VALIDATION, not a 500', async () => {
    const conv = await conversationWithFive();
    const error = await refusal(controller().list(s.parentId, conv.id, 'abc', undefined, undefined));
    expect(error).toBeInstanceOf(CommError);
    expect(error.code).toBe(CommErrorCode.VALIDATION);
    expect(error.status).toBe(400);
  });

  it('a non-numeric after is a 400 VALIDATION', async () => {
    const conv = await conversationWithFive();
    const error = await refusal(g.messages.list({ conversationId: conv.id, actorId: s.parentId, after: '3.5' }));
    expect(error.code).toBe(CommErrorCode.VALIDATION);
    expect(error.status).toBe(400);
  });

  it('before and after together are a 400, instead of after silently winning', async () => {
    const conv = await conversationWithFive();
    const error = await refusal(controller().list(s.parentId, conv.id, '4', '1', undefined));
    expect(error.code).toBe(CommErrorCode.VALIDATION);
    expect(error.status).toBe(400);
  });

  it('a valid before still pages backwards', async () => {
    const conv = await conversationWithFive();
    const page = await controller().list(s.parentId, conv.id, '4', undefined, '2');
    expect(page.messages.map((m) => m.seq)).toEqual(['3', '2']);
    expect(page.nextBefore).toBe('2');
  });

  it('a valid after still catches up forwards, including after=0', async () => {
    const conv = await conversationWithFive();
    const catchUp = await controller().list(s.parentId, conv.id, undefined, '3', undefined);
    expect(catchUp.messages.map((m) => m.seq)).toEqual(['4', '5']);
    const all = await controller().list(s.parentId, conv.id, undefined, '0', undefined);
    expect(all.messages.map((m) => m.seq)).toEqual(['1', '2', '3', '4', '5']);
  });
});
