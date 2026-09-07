/**
 * SUPERVISOR TRANSFER -- Zainab -> Dina, and the two defects it exposed.
 *
 * The transfer mechanism itself is Phase 1's (chat.assign_family_supervisor)
 * and is NOT rebuilt here. What Phase 3 adds is the follow-through:
 *
 *   P3-1  the outgoing supervisor stayed a LIVE conversation_member of the
 *         family's student groups. API-CONTRACT.md §3.3 always specified the
 *         re-sync; nothing implemented it.
 *
 *   P3-2  ScopeService.conversationWhere ORed an UNCONDITIONAL membership
 *         disjunct, so that stale row put the family's conversations back in
 *         the former supervisor's LIST -- title, last message preview, resolved
 *         member names -- while canRead correctly refused to open them.
 *
 * Together those meant a historical relationship kept a live handle. The tests
 * below are the regression guard for both.
 */
import { PrismaService } from '@platform/prisma.service';
import { buildGraph, seed, truncate, Scenario } from './harness';
import { CommErrorCode } from '@platform/errors';

const prisma = new PrismaService();
const g = buildGraph();
let s: Scenario;

const actorOf = async (id: string) => (await g.identity.resolveActor(id))!;

beforeEach(async () => {
  await truncate(prisma);
  s = await seed(prisma);
});
afterAll(async () => {
  await truncate(prisma);
  await prisma.$disconnect();
});

/** Zainab = the seeded owner; Dina = the other admin. */
const ZAINAB = () => s.ownerId;
const DINA = () => s.otherAdminId;

describe('supervisor transfer: Zainab -> Dina', () => {
  it('moves current access and preserves the historical assignment', async () => {
    const manager = await actorOf(s.managerId);

    const before = await g.families.assignments(manager, s.familyId);
    expect(before.filter((a) => a.endedAt === null)).toHaveLength(1);
    expect(before.find((a) => a.endedAt === null)!.staffId).toBe(ZAINAB());

    await g.families.assignSupervisor(manager, s.familyId, DINA(), 'portfolio rebalance');

    const after = await g.families.assignments(manager, s.familyId);
    const live = after.filter((a) => a.endedAt === null);

    // exactly one current supervisor, and it is Dina
    expect(live).toHaveLength(1);
    expect(live[0].staffId).toBe(DINA());

    // Zainab is still on the record -- ended, with a reason
    const zainab = after.find((a) => a.staffId === ZAINAB())!;
    expect(zainab).toBeDefined();
    expect(zainab.endedAt).not.toBeNull();
  });

  it('DINA gains current access; ZAINAB loses it', async () => {
    const manager = await actorOf(s.managerId);
    await g.families.assignSupervisor(manager, s.familyId, DINA(), 'transfer');

    const dina = await actorOf(DINA());
    const zainab = await actorOf(ZAINAB());

    expect(await g.scope.canAccessFamily(dina, s.familyId)).toBe(true);
    expect(await g.scope.canAccessFamily(zainab, s.familyId)).toBe(false);

    // Dina can read the family; Zainab gets NOT FOUND, identical to a family
    // that does not exist.
    await expect(g.families.get(dina, s.familyId)).resolves.toMatchObject({ id: s.familyId });
    await expect(g.families.get(zainab, s.familyId)).rejects.toMatchObject({
      code: CommErrorCode.CONVERSATION_NOT_FOUND,
    });
  });

  it('P3-1: the former supervisor is removed from the family student groups', async () => {
    const manager = await actorOf(s.managerId);
    const group = await g.conversations.ensureStudentGroup(s.learnerId, s.managerId);

    const liveStaff = async () =>
      (await prisma.conversationMember.findMany({
        where: { conversationId: group.id, actorKind: 'staff', leftAt: null },
      })).map((m) => m.actorId);

    expect(await liveStaff()).toContain(ZAINAB());

    await g.families.assignSupervisor(manager, s.familyId, DINA(), 'transfer');

    const staff = await liveStaff();
    expect(staff).toContain(DINA());
    expect(staff).not.toContain(ZAINAB());

    // Removed by stamping left_at -- the row itself survives, because "Zainab
    // was in this group" is history and history is not deleted.
    const departed = await prisma.conversationMember.findFirst({
      where: { conversationId: group.id, actorId: ZAINAB() },
    });
    expect(departed).not.toBeNull();
    expect(departed!.leftAt).not.toBeNull();
  });

  it('P3-2: the former supervisor cannot OPEN the family conversation', async () => {
    const manager = await actorOf(s.managerId);
    const group = await g.conversations.ensureStudentGroup(s.learnerId, s.managerId);
    await g.families.assignSupervisor(manager, s.familyId, DINA(), 'transfer');

    await expect(g.conversations.rowForActor(group.id, ZAINAB())).rejects.toBeDefined();
    await expect(g.conversations.rowForActor(group.id, DINA())).resolves.toBeDefined();
  });

  it('P3-2: the former supervisor cannot SEE the family in their conversation list', async () => {
    const manager = await actorOf(s.managerId);
    const group = await g.conversations.ensureStudentGroup(s.learnerId, s.managerId);

    // Before the transfer Zainab legitimately sees it.
    const beforeIds = (await g.conversations.listForActor(ZAINAB())).map((c) => c.id);
    expect(beforeIds).toContain(group.id);

    await g.families.assignSupervisor(manager, s.familyId, DINA(), 'transfer');

    // After it, the conversation is gone from the LIST -- not merely refused on
    // open. A list that still carried the row would leak the family's title,
    // its last message preview and its member names.
    const afterIds = (await g.conversations.listForActor(ZAINAB())).map((c) => c.id);
    expect(afterIds).not.toContain(group.id);

    const dinaIds = (await g.conversations.listForActor(DINA())).map((c) => c.id);
    expect(dinaIds).toContain(group.id);
  });

  it('P3-2: a stale membership row alone never restores visibility', async () => {
    // The sharpest form of the defect: transfer the family, then forcibly
    // re-create the exact stale row the old code left behind. Visibility must
    // still be governed by the live assignment and nothing else.
    const manager = await actorOf(s.managerId);
    const group = await g.conversations.ensureStudentGroup(s.learnerId, s.managerId);
    await g.families.assignSupervisor(manager, s.familyId, DINA(), 'transfer');

    await prisma.conversationMember.create({
      data: {
        conversationId: group.id,
        actorKind: 'staff',
        actorId: ZAINAB(),
        memberRole: 'admin',
      },
    });

    const ids = (await g.conversations.listForActor(ZAINAB())).map((c) => c.id);
    expect(ids).not.toContain(group.id);
    await expect(g.conversations.rowForActor(group.id, ZAINAB())).rejects.toBeDefined();
  });

  it('a Teacher <-> Admin direct conversation is still reachable by membership', async () => {
    // The membership disjunct exists for THIS case, and narrowing it for staff
    // must not break it: the conversation carries no family_id, so membership is
    // the only thing that can make it theirs.
    const direct = await g.conversations.getOrCreateDirect(s.ownerId, s.teacherId);
    expect(direct.familyId).toBeNull();

    const ids = (await g.conversations.listForActor(s.ownerId)).map((c) => c.id);
    expect(ids).toContain(direct.id);
  });
});
