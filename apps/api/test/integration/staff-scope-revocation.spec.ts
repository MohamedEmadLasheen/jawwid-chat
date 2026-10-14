/**
 * Staff scope is evaluated from LIVE facts on every request: a stale ownership,
 * an ended duty or an expired sticky window grants nothing.
 *
 * The admin here reads a conversation ONLY through the family's ownership (not
 * a member, not on duty): the family's parent talking to a different admin.
 * Transferring the family away must end that access at once -- list, history,
 * send, approvals -- with no cache to wait out. (The realtime half -- the next
 * delivery to that admin's open socket is refused -- is the same `canRead`
 * evaluated at delivery; it is exercised live in the QA probe.)
 */
import { randomUUID } from 'node:crypto';
import { CommError, CommErrorCode } from '@platform/errors';
import { buildGraph, seed, truncate, Scenario } from './harness';

jest.setTimeout(60_000);

const g = buildGraph();
let s: Scenario;
let conversationId: string;

beforeAll(async () => {
  await g.prisma.$connect();
});
afterAll(async () => {
  await truncate(g.prisma);
  await g.prisma.$disconnect();
});
beforeEach(async () => {
  await truncate(g.prisma);
  s = await seed(g.prisma);
  g.coverage.onDutyId = null; // nobody on duty: ownership is the only ground
  conversationId = (await g.conversations.getOrCreateDirect(s.parentId, s.otherAdminId)).id;
  await g.messages.send({ conversationId, senderId: s.parentId, body: 'hello', clientMessageId: randomUUID() });
});

async function code(p: Promise<unknown>): Promise<string> {
  try {
    await p;
    return 'OK';
  } catch (e) {
    if (e instanceof CommError) return e.code;
    throw e;
  }
}

async function transferFamilyTo(staffId: string): Promise<void> {
  await g.prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`select set_config('chat.transferring_ownership', 'on', true)`);
    await tx.$executeRawUnsafe(`update chat.family set owner_id = '${staffId}'::uuid where id = '${s.familyId}'::uuid`);
  });
}

const listed = async (actorId: string) => (await g.conversations.listForActor(actorId)).some((c) => c.id === conversationId);

it('the OWNER reads the family\'s conversation through ownership alone', async () => {
  expect(await listed(s.ownerId)).toBe(true);
  expect(await code(g.messages.list({ conversationId, actorId: s.ownerId }))).toBe('OK');
});

it('after the family is transferred away, the former owner is out of scope EVERYWHERE, immediately', async () => {
  await transferFamilyTo(s.managerId);

  expect(await listed(s.ownerId)).toBe(false);
  expect(await code(g.messages.list({ conversationId, actorId: s.ownerId }))).toBe(CommErrorCode.STAFF_OUT_OF_SCOPE);
  expect(await code(g.conversations.readWithMembers(conversationId, s.ownerId))).toBe(CommErrorCode.STAFF_OUT_OF_SCOPE);
  expect(
    await code(g.messages.send({ conversationId, senderId: s.ownerId, body: 'x', clientMessageId: randomUUID(), visibility: 'internal' })),
  ).toBe(CommErrorCode.STAFF_OUT_OF_SCOPE);
  expect(await g.approvals.listPending(s.ownerId, conversationId)).toEqual([]);
});

it('an ENDED duty grants nothing: on duty reads, off duty does not', async () => {
  g.coverage.onDutyId = s.otherAdminId === s.ownerId ? s.managerId : s.ownerId;
  const covering = g.coverage.onDutyId!;
  await transferFamilyTo(s.managerId);
  expect(await code(g.messages.list({ conversationId, actorId: covering }))).toBe('OK');
  g.coverage.onDutyId = null;
  expect(await code(g.messages.list({ conversationId, actorId: covering }))).toBe(CommErrorCode.STAFF_OUT_OF_SCOPE);
});

it('an EXPIRED sticky window grants nothing (a live one does, by the established handler rule)', async () => {
  await transferFamilyTo(s.managerId);
  await g.prisma.conversation.update({
    where: { id: conversationId },
    data: { stickyHandlerId: s.ownerId, stickyUntil: new Date(Date.now() + 60_000) },
  });
  expect(await code(g.messages.list({ conversationId, actorId: s.ownerId }))).toBe('OK');
  await g.prisma.conversation.update({ where: { id: conversationId }, data: { stickyUntil: new Date(Date.now() - 1) } });
  expect(await code(g.messages.list({ conversationId, actorId: s.ownerId }))).toBe(CommErrorCode.STAFF_OUT_OF_SCOPE);
});
