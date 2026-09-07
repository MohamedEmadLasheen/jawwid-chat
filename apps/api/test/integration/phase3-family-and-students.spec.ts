/**
 * FAMILIES AND STUDENTS -- profile, multiple children, and lifecycle.
 *
 * The two properties this suite exists to pin down:
 *
 *   ONE LIFECYCLE SOURCE.  chat.family.state is it. There is no is_active
 *   column, so ACTIVE/INACTIVE is derived and cannot disagree with itself. The
 *   frozen renewal states (at_risk, renewal_due) are readable, preserved, and
 *   unreachable from any Phase 3 operation.
 *
 *   LIFECYCLE IS NOT AUTHORIZATION.  Deactivating a family must not silently
 *   change who can reach it, and must not change Phase 2 messaging.
 */
import { PrismaService } from '@platform/prisma.service';
import { buildGraph, seed, truncate, Scenario } from './harness';
import { CommErrorCode } from '@platform/errors';
import { familyStateIsActive } from '@platform/families/family.service';

const prisma = new PrismaService();
const g = buildGraph();
let s: Scenario;

const actorOf = async (id: string) => (await g.identity.resolveActor(id))!;
const stateOf = async (id: string) =>
  (await prisma.family.findUniqueOrThrow({ where: { id } })).state;

beforeEach(async () => {
  await truncate(prisma);
  s = await seed(prisma);
});
afterAll(async () => {
  await truncate(prisma);
  await prisma.$disconnect();
});

describe('families', () => {
  it('creates a family, which opens its primary supervisor assignment', async () => {
    const manager = await actorOf(s.managerId);
    const family = await g.families.createFamily(manager, {
      displayName: 'family_new',
      supervisorId: s.ownerId,
    });
    expect(family.supervisorId).toBe(s.ownerId);

    const assignments = await g.families.assignments(manager, family.id);
    expect(assignments.filter((a) => a.endedAt === null)).toHaveLength(1);
  });

  it('requires families.assign to create -- naming a supervisor is a manager act', async () => {
    const owner = await actorOf(s.ownerId);
    await expect(
      g.families.createFamily(owner, { displayName: 'x', supervisorId: s.ownerId }),
    ).rejects.toMatchObject({ code: CommErrorCode.PERMISSION_DENIED });
  });

  it('edits the profile without disturbing the lifecycle', async () => {
    const manager = await actorOf(s.managerId);
    const before = await stateOf(s.familyId);
    const updated = await g.families.updateFamily(manager, s.familyId, {
      displayName: 'family_renamed',
    });
    expect(updated.displayName).toBe('family_renamed');
    expect(await stateOf(s.familyId)).toBe(before);
  });

  it('supports multiple students under one family', async () => {
    const manager = await actorOf(s.managerId);
    await g.learners.create(manager, s.familyId, { name: 'Ahmed' });
    await g.learners.create(manager, s.familyId, { name: 'Omar' });
    await g.learners.create(manager, s.familyId, { name: 'Maryam' });

    const learners = await g.learners.listForFamily(manager, s.familyId);
    const names = learners.map((l) => l.name);
    expect(names).toEqual(expect.arrayContaining(['Ahmed', 'Omar', 'Maryam']));
    expect(learners.every((l) => l.familyId === s.familyId)).toBe(true);
  });
});

describe('family lifecycle -- one authoritative source', () => {
  it('deactivates to paused and reactivates, preserving every relationship', async () => {
    const manager = await actorOf(s.managerId);
    const contactsBefore = await prisma.contact.count({ where: { familyId: s.familyId } });
    const learnersBefore = await prisma.learner.count({ where: { familyId: s.familyId } });

    const paused = await g.families.deactivateFamily(manager, s.familyId, 'pilot ended');
    expect(paused.state).toBe('paused');
    expect(familyStateIsActive(paused.state)).toBe(false);

    // Nothing was deleted.
    expect(await prisma.contact.count({ where: { familyId: s.familyId } })).toBe(contactsBefore);
    expect(await prisma.learner.count({ where: { familyId: s.familyId } })).toBe(learnersBefore);
    expect(
      await prisma.familyAssignment.count({ where: { familyId: s.familyId, endedAt: null } }),
    ).toBe(1);

    const active = await g.families.activateFamily(manager, s.familyId, 'returning');
    expect(active.state).toBe('active');
    expect(familyStateIsActive(active.state)).toBe(true);
  });

  it('records lifecycle changes in the EXISTING event log', async () => {
    const manager = await actorOf(s.managerId);
    await g.families.deactivateFamily(manager, s.familyId, 'pilot ended');
    await g.families.activateFamily(manager, s.familyId, 'returning');

    const history = await g.families.lifecycleHistory(manager, s.familyId);
    expect(history).toHaveLength(2);
    expect(history[0]).toMatchObject({ to: 'active', reason: 'returning' });
    expect(history[1]).toMatchObject({ to: 'paused', reason: 'pilot ended' });
  });

  it('requires a reason for any lifecycle change', async () => {
    const manager = await actorOf(s.managerId);
    await expect(
      g.families.deactivateFamily(manager, s.familyId, '  '),
    ).rejects.toMatchObject({ code: CommErrorCode.APPROVAL_REASON_REQUIRED });
  });

  it('CANNOT manufacture the frozen renewal states', async () => {
    const manager = await actorOf(s.managerId);
    // The API surface admits only paused | churned, and the database function
    // validates the target against the same two-value allow-list. There is no
    // Phase 3 operation whose target at_risk or renewal_due can be.
    await expect(
      g.families.deactivateFamily(manager, s.familyId, 'x', 'at_risk' as never),
    ).rejects.toBeDefined();
    expect(await stateOf(s.familyId)).not.toBe('at_risk');
  });

  it('reactivation never overwrites a frozen state it does not own', async () => {
    const manager = await actorOf(s.managerId);
    await prisma.$executeRawUnsafe(
      `update chat.family set state='at_risk' where id='${s.familyId}'::uuid`,
    );
    await g.families.activateFamily(manager, s.familyId, 'noop');
    // at_risk is already ACTIVE, so activate() leaves it exactly as it was
    // rather than flattening a state the Phase 3 operator may not change.
    expect(await stateOf(s.familyId)).toBe('at_risk');
  });
});

describe('family lifecycle is NOT authorization', () => {
  it('the supervisor keeps the family in scope while it is inactive', async () => {
    const manager = await actorOf(s.managerId);
    await g.families.deactivateFamily(manager, s.familyId, 'paused');

    const owner = await actorOf(s.ownerId);
    // They must keep it: winding the family down and bringing it back are both
    // done by the supervisor, and neither is possible from outside scope.
    expect(await g.scope.canAccessFamily(owner, s.familyId)).toBe(true);
    await expect(g.families.get(owner, s.familyId)).resolves.toMatchObject({ state: 'paused' });
  });

  it('does not grant access to anyone new', async () => {
    const manager = await actorOf(s.managerId);
    await g.families.deactivateFamily(manager, s.familyId, 'paused');
    const otherAdmin = await actorOf(s.otherAdminId);
    expect(await g.scope.canAccessFamily(otherAdmin, s.familyId)).toBe(false);
  });

  it('does not disturb Phase 2 messaging', async () => {
    const manager = await actorOf(s.managerId);
    const group = await g.conversations.ensureStudentGroup(s.learnerId, s.managerId);
    const before = (await g.conversations.listForActor(s.ownerId)).map((c) => c.id);
    expect(before).toContain(group.id);

    await g.families.deactivateFamily(manager, s.familyId, 'paused');

    // The conversation is neither archived nor hidden: a paused family may
    // still need to be talked to, and Phase 3 does not silently change Phase 2.
    const after = (await g.conversations.listForActor(s.ownerId)).map((c) => c.id);
    expect(after).toContain(group.id);
    const conv = await prisma.conversation.findUniqueOrThrow({ where: { id: group.id } });
    expect(conv.archivedAt).toBeNull();
  });
});

describe('student lifecycle', () => {
  it('deactivates without deleting, preserving family, history and membership', async () => {
    const manager = await actorOf(s.managerId);
    await g.learners.assignTeacher(manager, s.learnerId, s.teacherId, 'initial');
    const group = await g.groups.create(manager, { name: 'G', ownerId: s.ownerId });
    await g.groups.addMember(manager, group.id, s.learnerId);

    const deactivated = await g.learners.deactivate(manager, s.learnerId, 'left the academy');
    expect(deactivated.isActive).toBe(false);
    expect(deactivated.deactivatedAt).not.toBeNull();

    // The row is still there, and so is everything hanging off it.
    expect(await prisma.learner.findUnique({ where: { id: s.learnerId } })).not.toBeNull();
    expect(deactivated.familyId).toBe(s.familyId);
    expect((await g.learners.teacherHistory(manager, s.learnerId)).length).toBeGreaterThan(0);
    expect(await g.groups.members(manager, group.id)).toHaveLength(1);
  });

  it('archives the student group -- Phase 2 terminal state, history readable', async () => {
    const manager = await actorOf(s.managerId);
    const group = await g.conversations.ensureStudentGroup(s.learnerId, s.managerId);
    await g.learners.deactivate(manager, s.learnerId, 'left');

    const conv = await prisma.conversation.findUniqueOrThrow({ where: { id: group.id } });
    expect(conv.archivedAt).not.toBeNull();
    // Archived, not deleted: the messages remain.
    expect(await prisma.conversation.count({ where: { id: group.id } })).toBe(1);
  });

  it('reactivation is supported and does not resurrect the archived group', async () => {
    const manager = await actorOf(s.managerId);
    const group = await g.conversations.ensureStudentGroup(s.learnerId, s.managerId);
    await g.learners.deactivate(manager, s.learnerId, 'left');
    const back = await g.learners.activate(manager, s.learnerId, 'returned');

    expect(back.isActive).toBe(true);
    expect(back.deactivatedAt).toBeNull();
    // conversation_one_group_per_learner is PARTIAL on archived_at is null, so
    // archiving frees the slot by design; a returning student gets a fresh
    // group rather than a resurrected one. Phase 2's design, not an accident.
    const old = await prisma.conversation.findUniqueOrThrow({ where: { id: group.id } });
    expect(old.archivedAt).not.toBeNull();
  });

  it('requires a reason, and refuses an unauthorized actor', async () => {
    const manager = await actorOf(s.managerId);
    const parent = await actorOf(s.parentId);
    await expect(g.learners.deactivate(manager, s.learnerId, ' ')).rejects.toMatchObject({
      code: CommErrorCode.APPROVAL_REASON_REQUIRED,
    });
    await expect(g.learners.deactivate(parent, s.learnerId, 'x')).rejects.toMatchObject({
      code: CommErrorCode.PERMISSION_DENIED,
    });
  });
});
