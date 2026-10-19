/**
 * Outbox claim precision (issue #29), deterministic.
 *
 * `availableAt` is written by Prisma's client-side default and can land one
 * millisecond after a clock read taken in the same millisecond (measured 12.7%
 * of inserts on Linux). drain() used `availableAt <= now`, so such a row waited
 * for the next pass -- up to OUTBOX_IDLE_BACKOFF_MS (5 s) when no wake hint
 * came. The randomness is removed here: the row's availableAt is pinned one
 * millisecond after the drain's clock.
 */
import { OutboxWorker } from '@communication/outbox/outbox.worker';
import { buildGraph, truncate } from './harness';

jest.setTimeout(30_000);

const g = buildGraph();
const delivered: string[] = [];
const worker = new OutboxWorker(
  g.prisma,
  g.notifications,
  {
    toThread: async (id: string) => {
      delivered.push(id);
    },
    toUsers: async () => undefined,
  } as never,
  g.identity,
);

beforeAll(async () => {
  await g.prisma.$connect();
});
afterAll(async () => {
  await truncate(g.prisma);
  await g.prisma.$disconnect();
});
beforeEach(async () => {
  await truncate(g.prisma);
  delivered.length = 0;
});

async function row(availableAt: Date): Promise<string> {
  const r = await g.prisma.outboxEvent.create({
    data: { type: 'conversation.updated', payload: { conversationId: `c-${availableAt.getTime()}` }, availableAt },
  });
  return r.id;
}

it('a row stamped one millisecond after the drain clock is claimed by THAT drain', async () => {
  const T = new Date('2026-10-14T05:00:00.000Z');
  const id = await row(new Date(T.getTime() + 1));

  expect(await worker.drain(100, T)).toBe(1);
  expect((await g.prisma.outboxEvent.findUniqueOrThrow({ where: { id } })).status).toBe('published');
  expect(delivered).toHaveLength(1);
});

it('a retry backoff is still honoured: a row due in one second is not claimed early', async () => {
  const T = new Date('2026-10-14T05:00:00.000Z');
  const id = await row(new Date(T.getTime() + 1000));

  expect(await worker.drain(100, T)).toBe(0);
  expect((await g.prisma.outboxEvent.findUniqueOrThrow({ where: { id } })).status).toBe('pending');
});

it('a claimed row is never claimed twice, however many passes run (duplicate wake hints)', async () => {
  const T = new Date();
  await row(T);
  const passes = await Promise.all(Array.from({ length: 10 }, () => worker.drain(100, new Date(T.getTime() + 5))));
  expect(passes.reduce((a, b) => a + b, 0)).toBe(1);
  expect(delivered).toHaveLength(1);
});
