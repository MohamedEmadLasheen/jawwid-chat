/**
 * Staff scope is evaluated from LIVE facts on every request (PD-8): a child
 * moved to another supervisor, a backup link deactivated, expired or ended, a
 * manager replaced -- each ends access at once, on every read path, with no
 * cache to wait out. And the grounds PD-8 retired (family ownership, on_duty(),
 * the sticky handler) grant nothing at all.
 *
 * The conversation: family_x has two supervisors (splitFamily -- learner_l is
 * admin_a's, learner_m is admin_b's), and the parent talks to admin_b. admin_a
 * supervises a child of the same family and must still see none of it.
 * (The realtime half -- the next delivery to an open socket is refused -- is
 * the same `canRead`, evaluated at delivery: realtime-delivery / org-scope-pd8.)
 */
import { randomUUID } from 'node:crypto';
import { CommError, CommErrorCode } from '@platform/errors';
import { activateBackup, buildGraph, moveFamily, seed, splitFamily, truncate, Scenario } from './harness';

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
  g.coverage.onDutyId = null;
  await splitFamily(g.prisma, s);
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

const listed = async (actorId: string) => (await g.conversations.listForActor(actorId)).some((c) => c.id === conversationId);

/** Every read path at once: list, page, detail, an internal note, the approval queue. */
async function outOfScopeEverywhere(actorId: string): Promise<void> {
  expect(await listed(actorId)).toBe(false);
  expect(await code(g.messages.list({ conversationId, actorId }))).toBe(CommErrorCode.STAFF_OUT_OF_SCOPE);
  expect(await code(g.conversations.readWithMembers(conversationId, actorId))).toBe(CommErrorCode.STAFF_OUT_OF_SCOPE);
  expect(
    await code(g.messages.send({ conversationId, senderId: actorId, body: 'x', clientMessageId: randomUUID(), visibility: 'internal' })),
  ).toBe(CommErrorCode.STAFF_OUT_OF_SCOPE);
  expect(await g.approvals.listPending(actorId, conversationId)).toEqual([]);
}

it("the family's OTHER supervisor never reads a colleague's 1:1 with the same parent", async () => {
  expect(await listed(s.otherAdminId)).toBe(true);
  await outOfScopeEverywhere(s.ownerId);
});

it('family ownership, on_duty() and a live sticky window grant nothing (PD-8 retired all three)', async () => {
  // admin_a owns the family row, the coverage engine names them, and they hold
  // a live sticky window on the conversation -- and still read nothing.
  await g.prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`select set_config('chat.transferring_ownership', 'on', true)`);
    await tx.$executeRawUnsafe(`update chat.family set owner_id = '${s.ownerId}'::uuid where id = '${s.familyId}'::uuid`);
  });
  g.coverage.onDutyId = s.ownerId;
  await g.prisma.conversation.update({
    where: { id: conversationId },
    data: { stickyHandlerId: s.ownerId, stickyUntil: new Date(Date.now() + 60_000) },
  });
  await outOfScopeEverywhere(s.ownerId);
});

it("after the child moves away, its former supervisor is out of scope EVERYWHERE, immediately", async () => {
  expect(await code(g.messages.list({ conversationId, actorId: s.otherAdminId }))).toBe('OK');
  await moveFamily(g.prisma, s, s.ownerId);
  // admin_b keeps the membership row of the 1:1 -- and it no longer counts.
  expect(await g.conversations.membershipOf(conversationId, s.otherAdminId)).not.toBeNull();
  await outOfScopeEverywhere(s.otherAdminId);
  // ...and the new supervisor does NOT inherit admin_b's private 1:1 either.
  await outOfScopeEverywhere(s.ownerId);
});

it('an ACTIVE backup reads; deactivated, expired or ended, the same link grants nothing', async () => {
  const link = await activateBackup(g.prisma, s.otherAdminId, s.ownerId);
  expect(await listed(s.ownerId)).toBe(true);
  expect(await code(g.messages.list({ conversationId, actorId: s.ownerId }))).toBe('OK');

  await g.prisma.supervisorBackup.update({ where: { id: link }, data: { deactivatedAt: new Date() } });
  await outOfScopeEverywhere(s.ownerId);

  await g.prisma.supervisorBackup.update({
    where: { id: link },
    data: { deactivatedAt: null, activeUntil: new Date(Date.now() - 1) },
  });
  await outOfScopeEverywhere(s.ownerId);

  await g.prisma.supervisorBackup.update({
    where: { id: link },
    data: { activeUntil: null, endedAt: new Date() },
  });
  await outOfScopeEverywhere(s.ownerId);
});

it('a backup link stops counting the moment either person leaves the department', async () => {
  await activateBackup(g.prisma, s.otherAdminId, s.ownerId);
  expect(await listed(s.ownerId)).toBe(true);
  // admin_a leaves Operations (their own child is handed over first, as the
  // database requires); the link row still says "active".
  await g.prisma.learnerSupervision.update({ where: { learnerId: s.learnerId }, data: { supervisorId: s.otherAdminId } });
  await g.prisma.departmentMember.delete({ where: { staffId: s.ownerId } });
  await outOfScopeEverywhere(s.ownerId);
});

it('the department manager reads; replaced as manager, they do not', async () => {
  expect(await listed(s.managerId)).toBe(true);
  expect(await code(g.messages.list({ conversationId, actorId: s.managerId }))).toBe('OK');
  await g.prisma.department.update({ where: { id: s.departmentId }, data: { managerId: null } });
  await outOfScopeEverywhere(s.managerId);
});
