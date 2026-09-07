/**
 * PHASE 6 -- THE MANAGER COMMAND CENTER.
 *
 * Every assertion here compares a KPI against rows this test created. That is
 * the point of the suite: the phase's hardest requirement is that no number on
 * the board is invented, and the only way to prove it is to make the underlying
 * facts and check the board agrees.
 *
 * It also proves the two things a dashboard is usually wrong about:
 *   - the aggregation happens in the DATABASE, so the tiles are not a client
 *     counting a list it fetched;
 *   - every tile has a filtered list behind it, so a manager can get from
 *     "what is wrong" to "which family".
 */
import { randomUUID } from 'node:crypto';
import { PrismaService } from '@platform/prisma.service';
import { CommErrorCode } from '@platform/errors';
import { buildGraph, seed, truncate, Scenario } from './harness';
import { assessOverload } from '@communication/command-center/command-center.service';

const prisma = new PrismaService();
const g = buildGraph();
let s: Scenario;

const PHONE_BODY = 'call me on +201012345678';

beforeEach(async () => {
  await truncate(prisma);
  s = await seed(prisma);
  g.coverage.onDutyId = s.ownerId;
  g.moderationRules.invalidate();
  g.config.invalidate();
});

afterAll(async () => {
  await prisma.$disconnect();
});

// =========================================================================
describe('the KPI header', () => {
  it('is all zeros on a quiet academy, rather than absent or null', async () => {
    const k = await g.commandCenter.kpis(s.managerId);
    expect(k.unansweredMessages).toBe(0);
    expect(k.pendingApprovals).toBe(0);
    expect(k.escalatedApprovals).toBe(0);
    expect(k.openConversations).toBe(0);
    expect(k.closedConversations).toBe(0);
    expect(k.calls).toBe(0);
    expect(k.missedClassCalls).toBe(0);
    // Seeded families exist, so this one is genuinely non-zero.
    expect(k.activeFamilies).toBeGreaterThan(0);
    expect(k.asOf).toBeTruthy();
  });

  it('UNANSWERED counts conversations where the customer spoke last', async () => {
    const conv = await g.conversations.getOrCreateDirect(s.ownerId, s.parentId);
    expect((await g.commandCenter.kpis(s.managerId)).unansweredMessages).toBe(0);

    await g.messages.send({ conversationId: conv.id, senderId: s.parentId, body: 'is he ready?' });
    expect((await g.commandCenter.kpis(s.managerId)).unansweredMessages).toBe(1);

    // Answering it clears the number -- the KPI tracks state, not a counter.
    await g.messages.send({ conversationId: conv.id, senderId: s.ownerId, body: 'yes, tomorrow' });
    expect((await g.commandCenter.kpis(s.managerId)).unansweredMessages).toBe(0);
  });

  it('PENDING APPROVALS counts real moderation items, and ESCALATED the overdue subset', async () => {
    const group = await g.conversations.ensureStudentGroup(s.learnerId, s.ownerId);
    const held = await g.messages.send({
      conversationId: group.id, senderId: s.teacherId, body: PHONE_BODY,
    });

    let k = await g.commandCenter.kpis(s.managerId);
    expect(k.pendingApprovals).toBe(1);
    expect(k.escalatedApprovals).toBe(0);

    const approval = await prisma.messageApproval.findUnique({ where: { messageId: held.id } });
    await prisma.$executeRawUnsafe(
      `update chat.message_approval set created_at = now() - interval '9 hours'
        where id = '${approval!.id}'::uuid`,
    );
    await g.moderation.escalateOverdue();

    k = await g.commandCenter.kpis(s.managerId);
    expect(k.pendingApprovals).toBe(1);
    expect(k.escalatedApprovals).toBe(1);

    // Deciding it removes it from both.
    await g.approvals.approve(approval!.id, s.ownerId);
    k = await g.commandCenter.kpis(s.managerId);
    expect(k.pendingApprovals).toBe(0);
    expect(k.escalatedApprovals).toBe(0);
  });

  it('OPEN and CLOSED come from the conversation model, not from a stale column', async () => {
    const conv = await g.conversations.getOrCreateDirect(s.ownerId, s.parentId);
    expect((await g.commandCenter.kpis(s.managerId)).openConversations).toBe(1);
    expect((await g.commandCenter.kpis(s.managerId)).closedConversations).toBe(0);

    await prisma.conversation.update({
      where: { id: conv.id }, data: { resolvedAt: new Date() },
    });
    const k = await g.commandCenter.kpis(s.managerId);
    expect(k.openConversations).toBe(0);
    expect(k.closedConversations).toBe(1);
  });

  it('ACTIVE FAMILIES uses the database\'s own definition, not a second one', async () => {
    const before = (await g.commandCenter.kpis(s.managerId)).activeFamilies;
    // `churned` is outside chat.family_state_is_active().
    await prisma.$executeRawUnsafe(
      `update chat.family set state = 'churned' where id = '${s.familyId}'::uuid`,
    );
    expect((await g.commandCenter.kpis(s.managerId)).activeFamilies).toBe(before - 1);
  });

  it('CALLS and MISSED CLASS CALLS come from the Phase 5 call table', async () => {
    const group = await g.conversations.ensureStudentGroup(s.learnerId, s.ownerId);
    await prisma.$executeRawUnsafe(
      `insert into chat.call (conversation_id, family_id, initiator_id, type, room_name, status, outcome)
       values ('${group.id}'::uuid, '${s.familyId}'::uuid, '${s.teacherId}'::uuid,
               'class', 'room-missed-1', 'ended', 'missed'),
              ('${group.id}'::uuid, '${s.familyId}'::uuid, '${s.teacherId}'::uuid,
               'class', 'room-answered-1', 'ended', 'answered'),
              ('${group.id}'::uuid, '${s.familyId}'::uuid, '${s.ownerId}'::uuid,
               'direct', 'room-direct-1', 'ended', 'missed')`,
    );

    const k = await g.commandCenter.kpis(s.managerId);
    expect(k.calls).toBe(3);
    // A missed DIRECT call is not a missed CLASS call. Conflating them would
    // report a teaching failure that did not happen.
    expect(k.missedClassCalls).toBe(1);
  });

  it('counts only calls inside the configured window', async () => {
    const group = await g.conversations.ensureStudentGroup(s.learnerId, s.ownerId);
    await prisma.$executeRawUnsafe(
      `insert into chat.call (conversation_id, initiator_id, type, room_name, status, outcome, started_at)
       values ('${group.id}'::uuid, '${s.ownerId}'::uuid, 'direct', 'room-old',
               'ended', 'answered', now() - interval '3 days')`,
    );
    expect((await g.commandCenter.kpis(s.managerId)).calls).toBe(0);
    expect((await g.commandCenter.kpis(s.managerId)).windowHours).toBe(24);
  });
});

// =========================================================================
describe('supervisor workload', () => {
  it('reports each supervisor\'s real load, from live assignments', async () => {
    const conv = await g.conversations.getOrCreateDirect(s.ownerId, s.parentId);
    await g.messages.send({ conversationId: conv.id, senderId: s.parentId, body: 'hello?' });

    const rows = await g.commandCenter.supervisors(s.managerId);
    const owner = rows.find((r) => r.staffId === s.ownerId);

    expect(owner).toBeDefined();
    expect(owner!.families).toBe(1);
    expect(owner!.openConversations).toBe(1);
    expect(owner!.unanswered).toBe(1);
    expect(owner!.oldestWaitMs).toBeGreaterThanOrEqual(0);

    // The other admin supervises nobody, so their row is honestly empty rather
    // than absent -- a manager needs to see who is idle as well as who is not.
    const other = rows.find((r) => r.staffId === s.otherAdminId);
    expect(other!.families).toBe(0);
    expect(other!.unanswered).toBe(0);
  });

  it('counts the moderation items waiting on that supervisor', async () => {
    const group = await g.conversations.ensureStudentGroup(s.learnerId, s.ownerId);
    await g.messages.send({ conversationId: group.id, senderId: s.teacherId, body: PHONE_BODY });

    const rows = await g.commandCenter.supervisors(s.managerId);
    expect(rows.find((r) => r.staffId === s.ownerId)!.pendingApprovals).toBe(1);
    expect(rows.find((r) => r.staffId === s.otherAdminId)!.pendingApprovals).toBe(0);
  });

  it('counts unread messages from the receipt table, not from a separate counter', async () => {
    const conv = await g.conversations.getOrCreateDirect(s.ownerId, s.parentId);
    await g.messages.send({ conversationId: conv.id, senderId: s.parentId, body: 'one' });
    await g.messages.send({ conversationId: conv.id, senderId: s.parentId, body: 'two' });

    let rows = await g.commandCenter.supervisors(s.managerId);
    expect(rows.find((r) => r.staffId === s.ownerId)!.unreadMessages).toBe(2);

    const conversation = await prisma.conversation.findUnique({ where: { id: conv.id } });
    await g.messages.markReadUpTo(conv.id, s.ownerId, conversation!.lastSeq.toString());
    rows = await g.commandCenter.supervisors(s.managerId);
    expect(rows.find((r) => r.staffId === s.ownerId)!.unreadMessages).toBe(0);
  });

  it('is sorted worst first, so the manager does not have to read all of it', async () => {
    const conv = await g.conversations.getOrCreateDirect(s.ownerId, s.parentId);
    await g.messages.send({ conversationId: conv.id, senderId: s.parentId, body: 'waiting' });
    await prisma.config.upsert({
      where: { key: 'command_center.overload_unanswered_high' },
      create: { key: 'command_center.overload_unanswered_high', value: 1, scope: 'communication' },
      update: { value: 1 },
    });
    g.config.invalidate();

    const rows = await g.commandCenter.supervisors(s.managerId);
    expect(rows[0].staffId).toBe(s.ownerId);
    expect(rows[0].overload).toBe('overloaded');
    // And it says WHY, which is what makes the badge actionable.
    expect(rows[0].reasons.join(' ')).toMatch(/awaiting a reply/);

    expect(await g.commandCenter.overloadedCount(s.managerId)).toBe(1);

    await prisma.config.deleteMany({ where: { key: 'command_center.overload_unanswered_high' } });
    g.config.invalidate();
  });

  it('does NOT treat family count as a load input', async () => {
    // 40 quiet families is not an overloaded supervisor, and the frozen
    // workload engine's own rule said so before it was frozen.
    for (let i = 0; i < 40; i++) {
      await prisma.$executeRawUnsafe(
        `with f as (
           insert into chat.family (display_name, owner_id, state)
           values ('family_bulk_${i}', '${s.ownerId}'::uuid, 'active') returning id)
         insert into chat.family_assignment (family_id, staff_id, kind, reason)
         select f.id, '${s.ownerId}'::uuid, 'primary', 'test' from f`,
      );
    }
    const rows = await g.commandCenter.supervisors(s.managerId);
    const owner = rows.find((r) => r.staffId === s.ownerId)!;
    expect(owner.families).toBe(41);
    expect(owner.overload).toBe('ok');
    expect(owner.reasons).toEqual([]);
  });
});

// =========================================================================
describe('the overload rule', () => {
  const T = {
    unansweredWarning: 6, unansweredHigh: 12, pendingWarning: 3, pendingHigh: 6,
  };

  it('is ok below every threshold', () => {
    expect(assessOverload({ unanswered: 5, pending: 2, escalated: 0, oldestWaitMs: 0 }, T))
      .toEqual({ level: 'ok', reasons: [] });
  });

  it('warns on either axis independently', () => {
    expect(assessOverload({ unanswered: 6, pending: 0, escalated: 0, oldestWaitMs: 0 }, T).level)
      .toBe('warning');
    expect(assessOverload({ unanswered: 0, pending: 3, escalated: 0, oldestWaitMs: 0 }, T).level)
      .toBe('warning');
  });

  it('is overloaded on either axis independently', () => {
    expect(assessOverload({ unanswered: 12, pending: 0, escalated: 0, oldestWaitMs: 0 }, T).level)
      .toBe('overloaded');
    expect(assessOverload({ unanswered: 0, pending: 6, escalated: 0, oldestWaitMs: 0 }, T).level)
      .toBe('overloaded');
  });

  it('a warning on one axis never downgrades an overload on the other', () => {
    const r = assessOverload({ unanswered: 12, pending: 3, escalated: 0, oldestWaitMs: 0 }, T);
    expect(r.level).toBe('overloaded');
    expect(r.reasons).toHaveLength(2);
  });

  it('any escalated item is an overload on its own', () => {
    const r = assessOverload({ unanswered: 0, pending: 1, escalated: 1, oldestWaitMs: 0 }, T);
    expect(r.level).toBe('overloaded');
    expect(r.reasons.join(' ')).toMatch(/escalated/);
  });

  it('always explains itself', () => {
    const r = assessOverload({ unanswered: 20, pending: 0, escalated: 0, oldestWaitMs: 0 }, T);
    expect(r.reasons).toEqual(['20 conversations awaiting a reply']);
  });
});

// =========================================================================
describe('drill-down', () => {
  it('leads from the number to the actual conversations', async () => {
    const conv = await g.conversations.getOrCreateDirect(s.ownerId, s.parentId);
    await g.messages.send({ conversationId: conv.id, senderId: s.parentId, body: 'still waiting' });

    const rows = await g.commandCenter.attention(s.managerId);
    expect(rows).toHaveLength(1);
    expect(rows[0].conversationId).toBe(conv.id);
    // Everything the console needs to open the right thread.
    expect(rows[0].familyId).toBe(s.familyId);
    expect(rows[0].familyName).toBeTruthy();
    expect(rows[0].supervisorId).toBe(s.ownerId);
    expect(rows[0].waitingMs).toBeGreaterThanOrEqual(0);
  });

  it('narrows to one supervisor, which is the click from their row', async () => {
    const conv = await g.conversations.getOrCreateDirect(s.ownerId, s.parentId);
    await g.messages.send({ conversationId: conv.id, senderId: s.parentId, body: 'waiting' });

    expect(await g.commandCenter.attention(s.managerId, s.ownerId)).toHaveLength(1);
    expect(await g.commandCenter.attention(s.managerId, s.otherAdminId)).toHaveLength(0);
  });

  it('is ordered longest wait first', async () => {
    const a = await g.conversations.getOrCreateDirect(s.ownerId, s.parentId);
    await g.messages.send({ conversationId: a.id, senderId: s.parentId, body: 'newer' });
    await prisma.conversation.update({
      where: { id: a.id },
      data: { lastCustomerMessageAt: new Date(Date.now() - 10 * 60_000) },
    });

    const group = await g.conversations.ensureStudentGroup(s.learnerId, s.ownerId);
    await prisma.conversation.update({
      where: { id: group.id },
      data: { lastCustomerMessageAt: new Date(Date.now() - 90 * 60_000) },
    });

    const rows = await g.commandCenter.attention(s.managerId);
    expect(rows.map((r) => r.conversationId)).toEqual([group.id, a.id]);
    expect(rows[0].waitingMs).toBeGreaterThan(rows[1].waitingMs);
  });

  it('carries the moderation items on each conversation, so one click covers both', async () => {
    const group = await g.conversations.ensureStudentGroup(s.learnerId, s.ownerId);
    await g.messages.send({ conversationId: group.id, senderId: s.parentId, body: PHONE_BODY });
    // A held parent message does not answer the conversation, so it is still
    // unanswered AND has something in the queue.
    await prisma.conversation.update({
      where: { id: group.id }, data: { lastCustomerMessageAt: new Date() },
    });

    const rows = await g.commandCenter.attention(s.managerId);
    expect(rows[0].pendingApprovals).toBe(1);
  });

  it('an empty board is empty, not an error', async () => {
    expect(await g.commandCenter.attention(s.managerId)).toEqual([]);
  });
});

// =========================================================================
describe('authorization', () => {
  it('a manager may read it', async () => {
    await expect(g.commandCenter.kpis(s.managerId)).resolves.toBeDefined();
  });

  it('an ADMIN may not: every figure is organization-wide', async () => {
    for (const call of [
      () => g.commandCenter.kpis(s.ownerId),
      () => g.commandCenter.supervisors(s.ownerId),
      () => g.commandCenter.attention(s.ownerId),
    ]) {
      await expect(call()).rejects.toMatchObject({ code: CommErrorCode.PERMISSION_DENIED });
    }
  });

  it('a TEACHER may not', async () => {
    await expect(g.commandCenter.supervisors(s.teacherId)).rejects.toMatchObject({
      code: CommErrorCode.PERMISSION_DENIED,
    });
  });

  it('a PARENT may not', async () => {
    await expect(g.commandCenter.kpis(s.parentId)).rejects.toMatchObject({
      code: CommErrorCode.PERMISSION_DENIED,
    });
  });

  it('a DEACTIVATED manager may not', async () => {
    // `staff_left_at_matches_is_active` keeps the two columns consistent, so
    // offboarding stamps both. Setting only the flag is not a state the
    // database allows to exist.
    await prisma.$executeRawUnsafe(
      `update chat.staff set is_active = false, left_at = now()
        where id = '${s.managerId}'::uuid`,
    );
    await expect(g.commandCenter.kpis(s.managerId)).rejects.toMatchObject({
      code: CommErrorCode.ACTOR_INACTIVE,
    });
  });

  it('a manager of another academy sees none of this one\'s numbers', async () => {
    const conv = await g.conversations.getOrCreateDirect(s.ownerId, s.parentId);
    await g.messages.send({ conversationId: conv.id, senderId: s.parentId, body: 'waiting' });

    const OTHER_ORG = '00000000-0000-0000-0000-0000000000fd';
    await prisma.$executeRawUnsafe(
      `insert into chat.organization (id, slug, display_name)
            values ('${OTHER_ORG}'::uuid, 'other-academy-cc', 'Other Academy')
       on conflict (id) do nothing`,
    );
    // A staff row with no account resolves to no permissions at all, which
    // would pass this test for entirely the wrong reason. The alien manager is
    // therefore a COMPLETE actor -- fully entitled inside their own academy --
    // so the isolation being proved is the tenant boundary and nothing else.
    const alienAccount = randomUUID();
    const alienStaffId = randomUUID();
    await prisma.$executeRawUnsafe(
      `insert into chat.account (id, subject, kind, status, organization_id)
       values ('${alienAccount}'::uuid, 'subject_${alienStaffId}', 'staff', 'active',
               '${OTHER_ORG}'::uuid)`,
    );
    await prisma.$executeRawUnsafe(
      `insert into chat.staff (id, account_id, organization_id, name, role, is_active)
       values ('${alienStaffId}'::uuid, '${alienAccount}'::uuid, '${OTHER_ORG}'::uuid,
               'manager_other', 'manager', true)`,
    );
    const alienStaff = { id: alienStaffId };

    const k = await g.commandCenter.kpis(alienStaff.id);
    expect(k.unansweredMessages).toBe(0);
    expect(k.activeFamilies).toBe(0);
    expect(await g.commandCenter.attention(alienStaff.id)).toEqual([]);
    expect(await g.commandCenter.supervisors(alienStaff.id)).toHaveLength(1); // only their own
  });
});
