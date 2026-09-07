/**
 * LABELS -- vocabulary, filing, bulk operations and intersection filtering.
 *
 * The security-relevant property is that a bulk call can never reach a family
 * the actor could not reach one at a time, and reports what it skipped.
 */
import { randomUUID } from 'node:crypto';
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

describe('the label vocabulary', () => {
  it('creates, edits without changing identity, and soft-deletes', async () => {
    const manager = await actorOf(s.managerId);

    const label = await g.labels.create(manager, { name: 'Renewal', color: '#f00' });
    expect(label.name).toBe('Renewal');

    // An edit is an EDIT: same id, so every family stays filed under it.
    const renamed = await g.labels.update(manager, label.id, { name: 'Renewal Soon' });
    expect(renamed.id).toBe(label.id);
    expect(renamed.name).toBe('Renewal Soon');

    await g.labels.remove(manager, label.id, 'no longer used');
    expect((await g.labels.list(manager)).map((l) => l.id)).not.toContain(label.id);
  });

  it('refuses a duplicate name, case-insensitively', async () => {
    const manager = await actorOf(s.managerId);
    await g.labels.create(manager, { name: 'VIP' });
    await expect(g.labels.create(manager, { name: 'vip' })).rejects.toMatchObject({
      code: CommErrorCode.GROUP_ALREADY_EXISTS,
    });
  });

  it('a deleted name may be reused', async () => {
    const manager = await actorOf(s.managerId);
    const first = await g.labels.create(manager, { name: 'Course A' });
    await g.labels.remove(manager, first.id, 'retired');
    const second = await g.labels.create(manager, { name: 'Course A' });
    expect(second.id).not.toBe(first.id);
  });

  it('deleting a label touches no family, student or conversation', async () => {
    const manager = await actorOf(s.managerId);
    const label = await g.labels.create(manager, { name: 'Wednesday' });
    await g.labels.addFamilies(manager, label.id, [s.familyId]);

    const families = await prisma.family.count();
    const learners = await prisma.learner.count();
    const conversations = await prisma.conversation.count();

    await g.labels.remove(manager, label.id, 'retired');

    expect(await prisma.family.count()).toBe(families);
    expect(await prisma.learner.count()).toBe(learners);
    expect(await prisma.conversation.count()).toBe(conversations);
    // The association survives as a record; it is simply no longer offered.
    expect(await prisma.familyLabel.count({ where: { labelId: label.id } })).toBe(1);
  });

  it('an admin may file families but may NOT curate the vocabulary', async () => {
    const owner = await actorOf(s.ownerId);
    const manager = await actorOf(s.managerId);
    const label = await g.labels.create(manager, { name: 'VIP' });

    await expect(g.labels.create(owner, { name: 'Nope' })).rejects.toMatchObject({
      code: CommErrorCode.PERMISSION_DENIED,
    });
    await expect(g.labels.remove(owner, label.id, 'x')).rejects.toMatchObject({
      code: CommErrorCode.PERMISSION_DENIED,
    });
    // ...but filing their own family is an ordinary supervisor's act.
    const outcomes = await g.labels.addFamilies(owner, label.id, [s.familyId]);
    expect(outcomes).toEqual([{ familyId: s.familyId, status: 'applied' }]);
  });
});

describe('filing families', () => {
  it('is idempotent: adding twice creates one association', async () => {
    const manager = await actorOf(s.managerId);
    const label = await g.labels.create(manager, { name: 'VIP' });

    expect(await g.labels.addFamilies(manager, label.id, [s.familyId])).toEqual([
      { familyId: s.familyId, status: 'applied' },
    ]);
    expect(await g.labels.addFamilies(manager, label.id, [s.familyId])).toEqual([
      { familyId: s.familyId, status: 'already' },
    ]);
    expect(await prisma.familyLabel.count({ where: { labelId: label.id } })).toBe(1);
  });

  it('supports several labels on one family', async () => {
    const manager = await actorOf(s.managerId);
    const vip = await g.labels.create(manager, { name: 'VIP' });
    const renewal = await g.labels.create(manager, { name: 'Renewal' });
    const wed = await g.labels.create(manager, { name: 'Wednesday' });
    for (const l of [vip, renewal, wed]) {
      await g.labels.addFamilies(manager, l.id, [s.familyId]);
    }
    const names = (await g.labels.forFamily(manager, s.familyId)).map((l) => l.name);
    expect(names).toEqual(['Renewal', 'VIP', 'Wednesday']);
  });

  it('removes an association without touching the family', async () => {
    const manager = await actorOf(s.managerId);
    const label = await g.labels.create(manager, { name: 'VIP' });
    await g.labels.addFamilies(manager, label.id, [s.familyId]);
    expect(await g.labels.removeFamilies(manager, label.id, [s.familyId])).toEqual([
      { familyId: s.familyId, status: 'applied' },
    ]);
    expect(await g.labels.removeFamilies(manager, label.id, [s.familyId])).toEqual([
      { familyId: s.familyId, status: 'already' },
    ]);
    expect(await prisma.family.findUnique({ where: { id: s.familyId } })).not.toBeNull();
  });
});

describe('bulk operations', () => {
  it('never touches an out-of-scope family, and says so per id', async () => {
    // otherAdmin supervises nothing. A bulk call naming a real family they do
    // not supervise must skip it and report why -- not apply it, and not fail
    // the whole request.
    const manager = await actorOf(s.managerId);
    const otherAdmin = await actorOf(s.otherAdminId);
    const label = await g.labels.create(manager, { name: 'VIP' });
    const ghost = randomUUID();

    const outcomes = await g.labels.addFamilies(otherAdmin, label.id, [s.familyId, ghost]);

    expect(outcomes).toEqual([
      { familyId: s.familyId, status: 'out_of_scope' },
      { familyId: ghost, status: 'not_found' },
    ]);
    expect(await prisma.familyLabel.count({ where: { labelId: label.id } })).toBe(0);
  });

  it('reports an outcome for every id supplied, in order', async () => {
    const manager = await actorOf(s.managerId);
    const label = await g.labels.create(manager, { name: 'VIP' });
    const ghost = randomUUID();
    const outcomes = await g.labels.addFamilies(manager, label.id, [ghost, s.familyId]);
    expect(outcomes.map((o) => o.familyId)).toEqual([ghost, s.familyId]);
  });

  it('de-duplicates a repeated id rather than writing twice', async () => {
    const manager = await actorOf(s.managerId);
    const label = await g.labels.create(manager, { name: 'VIP' });
    const outcomes = await g.labels.addFamilies(manager, label.id, [
      s.familyId,
      s.familyId,
      s.familyId,
    ]);
    expect(outcomes).toHaveLength(1);
    expect(await prisma.familyLabel.count({ where: { labelId: label.id } })).toBe(1);
  });
});

describe('label filtering', () => {
  it('filters, and INTERSECTS several labels', async () => {
    const manager = await actorOf(s.managerId);
    const vip = await g.labels.create(manager, { name: 'VIP' });
    const renewal = await g.labels.create(manager, { name: 'Renewal' });

    const second = await g.families.createFamily(manager, {
      displayName: 'family_y',
      supervisorId: s.ownerId,
    });

    await g.labels.addFamilies(manager, vip.id, [s.familyId, second.id]);
    await g.labels.addFamilies(manager, renewal.id, [s.familyId]);

    const vipOnly = await g.families.list(manager, undefined, 50, [vip.id]);
    expect(vipOnly.map((f) => f.id).sort()).toEqual([s.familyId, second.id].sort());

    // VIP + Renewal = BOTH, not either.
    const both = await g.families.list(manager, undefined, 50, [vip.id, renewal.id]);
    expect(both.map((f) => f.id)).toEqual([s.familyId]);
  });

  it('a label filter narrows scope and can never widen it', async () => {
    const manager = await actorOf(s.managerId);
    const otherAdmin = await actorOf(s.otherAdminId);
    const vip = await g.labels.create(manager, { name: 'VIP' });
    await g.labels.addFamilies(manager, vip.id, [s.familyId]);

    // otherAdmin supervises nothing, so filtering by a label that DOES match a
    // real family still returns nothing.
    expect(await g.families.list(otherAdmin, undefined, 50, [vip.id])).toEqual([]);
  });

  it('a soft-deleted label filters nothing', async () => {
    const manager = await actorOf(s.managerId);
    const vip = await g.labels.create(manager, { name: 'VIP' });
    await g.labels.addFamilies(manager, vip.id, [s.familyId]);
    await g.labels.remove(manager, vip.id, 'retired');
    expect(await g.families.list(manager, undefined, 50, [vip.id])).toEqual([]);
  });
});
