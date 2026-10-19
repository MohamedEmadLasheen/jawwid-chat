/**
 * Approval decisions: one decision per held message, by somebody who may act on
 * the conversation (2026-10-14).
 *
 * Found while testing RT-032: ApprovalService.decide checked "still pending?"
 * outside its transaction and then overwrote the row, never asked whether the
 * approver could READ the conversation, and canApprove ignored isActive. So two
 * concurrent decisions could both win (a message announced as published and
 * then stored as rejected), and a manager of another organization could decide
 * an approval by id.
 */
import { randomUUID } from 'node:crypto';
import { CommError, CommErrorCode } from '@platform/errors';
import { buildGraph, seed, truncate, Scenario } from './harness';

jest.setTimeout(60_000);

const g = buildGraph();
let s: Scenario;
let groupId: string;

beforeAll(async () => {
  await g.prisma.$connect();
});
afterAll(async () => {
  await truncate(g.prisma);
  await g.prisma.$executeRawUnsafe(`delete from chat.organization where slug like 'apdi-%'`);
  await g.prisma.$disconnect();
});
beforeEach(async () => {
  await truncate(g.prisma);
  await g.prisma.$executeRawUnsafe(`delete from chat.organization where slug like 'apdi-%'`);
  s = await seed(g.prisma);
  g.coverage.onDutyId = s.ownerId;
  groupId = (await g.conversations.ensureStudentGroup(s.learnerId, s.ownerId)).id;
});

async function held(): Promise<{ messageId: string; approvalId: string }> {
  const m = await g.messages.send({
    conversationId: groupId, senderId: s.teacherId, body: `held ${randomUUID()}`, clientMessageId: randomUUID(),
  });
  expect(m.moderation).toBe('pending');
  const a = await g.prisma.messageApproval.findFirstOrThrow({ where: { messageId: m.id } });
  return { messageId: m.id, approvalId: a.id };
}

const outcome = (p: Promise<unknown>) =>
  p.then(() => 'OK', (e) => (e instanceof CommError ? e.code : `THROWN ${String(e)}`));

const announced = async (messageId: string) =>
  (await g.prisma.outboxEvent.findMany({ where: { type: 'message.created' } })).filter(
    (e) => (e.payload as { messageId?: string }).messageId === messageId,
  ).length;

describe('one decision per held message', () => {
  it('approve and reject racing: exactly one wins, and the stored state matches what was announced', async () => {
    for (let round = 0; round < 10; round++) {
      const { messageId, approvalId } = await held();
      const results = await Promise.all([
        outcome(g.approvals.approve(approvalId, s.ownerId)),
        outcome(g.approvals.reject(approvalId, s.managerId, 'not appropriate')),
      ]);
      expect(results.filter((r) => r === 'OK')).toHaveLength(1);
      expect(results.filter((r) => r === CommErrorCode.APPROVAL_ALREADY_DECIDED)).toHaveLength(1);

      const msg = await g.prisma.message.findUniqueOrThrow({ where: { id: messageId } });
      const n = await announced(messageId);
      if (msg.moderation === 'published') expect(n).toBe(1);
      else expect([msg.moderation, n]).toEqual(['rejected', 0]);
    }
  });

  it('two approvals racing announce the message once', async () => {
    for (let round = 0; round < 10; round++) {
      const { messageId, approvalId } = await held();
      const results = await Promise.all([
        outcome(g.approvals.approve(approvalId, s.ownerId)),
        outcome(g.approvals.approve(approvalId, s.managerId)),
      ]);
      expect(results.sort()).toEqual([CommErrorCode.APPROVAL_ALREADY_DECIDED, 'OK'].sort());
      expect(await announced(messageId)).toBe(1);
      expect(await g.prisma.messageReceipt.count({ where: { messageId } })).toBeGreaterThan(0);
    }
  });

  it('concurrent sends into one conversation get distinct, gap-free sequence numbers', async () => {
    const sent = await Promise.all(
      Array.from({ length: 20 }, (_, i) =>
        g.messages.send({ conversationId: groupId, senderId: s.ownerId, body: `burst ${i}`, clientMessageId: randomUUID() }),
      ),
    );
    const seqs = sent.map((m) => Number(m.seq)).sort((a, b) => a - b);
    expect(new Set(seqs).size).toBe(20);
    expect(seqs[19] - seqs[0]).toBe(19);
  });
});

describe('who may decide', () => {
  it('a manager of ANOTHER organization cannot decide, and the message stays held', async () => {
    const orgB = randomUUID();
    const managerB = randomUUID();
    await g.prisma.$executeRawUnsafe(
      `insert into chat.organization (id, slug, display_name) values ('${orgB}'::uuid, 'apdi-${orgB.slice(0, 8)}', 'org_b')`,
    );
    await g.prisma.$executeRawUnsafe(
      `insert into chat.staff (id, name, role, is_active, organization_id) values ('${managerB}'::uuid, 'manager_b', 'manager', true, '${orgB}'::uuid)`,
    );
    const { messageId, approvalId } = await held();

    expect(await outcome(g.approvals.approve(approvalId, managerB))).toBe(CommErrorCode.CONVERSATION_NOT_FOUND);
    expect((await g.prisma.message.findUniqueOrThrow({ where: { id: messageId } })).moderation).toBe('pending');
  });

  it('an admin outside the family cannot decide (staff scope), and nothing changes', async () => {
    const { messageId, approvalId } = await held();
    expect(await outcome(g.approvals.approve(approvalId, s.otherAdminId))).toBe(CommErrorCode.STAFF_OUT_OF_SCOPE);
    expect((await g.prisma.message.findUniqueOrThrow({ where: { id: messageId } })).moderation).toBe('pending');
  });

  it('control: the on-duty owner and a same-organization manager may decide', async () => {
    expect(await outcome(g.approvals.approve((await held()).approvalId, s.ownerId))).toBe('OK');
    expect(await outcome(g.approvals.approve((await held()).approvalId, s.managerId))).toBe('OK');
  });
});
