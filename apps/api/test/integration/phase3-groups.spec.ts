/**
 * GROUPS -- stable identity, membership and teachers with history, and the
 * full close -> archive -> replacement lifecycle.
 *
 * The scenario the requirement names:
 *
 *   Group A:  Ahmed + Islam  ->  Islam leaves  ->  Ahmed + Mahmoud
 *
 * with Islam still visible as a PREVIOUS assignment afterwards.
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

async function newGroup(name = 'Group A') {
  const manager = await actorOf(s.managerId);
  return g.groups.create(manager, { name, ownerId: s.ownerId });
}

describe('group identity', () => {
  it('a group is NOT a conversation: creating one creates no conversation', async () => {
    const before = await prisma.conversation.count();
    await newGroup();
    expect(await prisma.conversation.count()).toBe(before);
  });

  it('the id survives a rename, a teacher change and a membership change', async () => {
    const manager = await actorOf(s.managerId);
    const group = await newGroup();
    const id = group.id;

    await g.groups.rename(manager, id, 'Group A (evening)');
    await g.groups.addTeacher(manager, id, s.teacherId);
    await g.groups.addMember(manager, id, s.learnerId);
    await g.groups.removeTeacher(manager, id, s.teacherId, 'left');

    const after = await g.groups.get(manager, id);
    expect(after.id).toBe(id);
    expect(after.name).toBe('Group A (evening)');
  });
});

describe('group teachers: Ahmed + Islam -> Ahmed + Mahmoud', () => {
  it('replaces the current teacher and keeps the previous one as history', async () => {
    const manager = await actorOf(s.managerId);
    const group = await newGroup();
    await g.groups.addMember(manager, group.id, s.learnerId);
    await g.groups.addTeacher(manager, group.id, s.teacherId);

    await g.groups.removeTeacher(manager, group.id, s.teacherId, 'Islam left');
    const teachers = await g.groups.addTeacher(manager, group.id, s.newTeacherId);

    const current = teachers.filter((t) => t.isCurrent);
    expect(current).toHaveLength(1);
    expect(current[0].teacherId).toBe(s.newTeacherId);

    const islam = teachers.find((t) => t.teacherId === s.teacherId)!;
    expect(islam.isCurrent).toBe(false);
    expect(islam.endedAt).not.toBeNull();
    expect(islam.removedReason).toBe('Islam left');
  });

  it('adding a current teacher twice is idempotent', async () => {
    const manager = await actorOf(s.managerId);
    const group = await newGroup();
    await g.groups.addTeacher(manager, group.id, s.teacherId);
    const after = await g.groups.addTeacher(manager, group.id, s.teacherId);
    expect(after.filter((t) => t.isCurrent)).toHaveLength(1);
    expect(after).toHaveLength(1);
  });
});

describe('group members', () => {
  it('distinguishes CURRENT from FORMER, and never deletes a departure', async () => {
    const manager = await actorOf(s.managerId);
    const group = await newGroup();
    await g.groups.addMember(manager, group.id, s.learnerId);
    const members = await g.groups.removeMember(manager, group.id, s.learnerId, 'moved away');

    expect(members.filter((m) => m.isCurrent)).toHaveLength(0);
    const former = members.find((m) => m.learnerId === s.learnerId)!;
    expect(former).toBeDefined();
    expect(former.leftAt).not.toBeNull();
    expect(former.removedReason).toBe('moved away');
  });

  it('a former member may rejoin, as a distinguishable new period', async () => {
    const manager = await actorOf(s.managerId);
    const group = await newGroup();
    await g.groups.addMember(manager, group.id, s.learnerId);
    await g.groups.removeMember(manager, group.id, s.learnerId, 'moved');
    const members = await g.groups.addMember(manager, group.id, s.learnerId);

    const rows = members.filter((m) => m.learnerId === s.learnerId);
    expect(rows).toHaveLength(2);
    expect(rows.filter((m) => m.isCurrent)).toHaveLength(1);
  });

  it('adding a current member twice is idempotent', async () => {
    const manager = await actorOf(s.managerId);
    const group = await newGroup();
    await g.groups.addMember(manager, group.id, s.learnerId);
    const after = await g.groups.addMember(manager, group.id, s.learnerId);
    expect(after.filter((m) => m.isCurrent)).toHaveLength(1);
  });
});

describe('group lifecycle', () => {
  it('active -> closed -> archived, and never backwards', async () => {
    const manager = await actorOf(s.managerId);
    const group = await newGroup();

    await expect(g.groups.archive(manager, group.id, 'skip')).rejects.toBeDefined();

    expect((await g.groups.close(manager, group.id, 'term ended')).state).toBe('closed');
    expect((await g.groups.archive(manager, group.id, 'done')).state).toBe('archived');
  });

  it('an archived group cannot be mutated -- enforced by the database', async () => {
    const manager = await actorOf(s.managerId);
    const group = await newGroup();
    await g.groups.addMember(manager, group.id, s.learnerId);
    await g.groups.close(manager, group.id, 'term ended');
    await g.groups.archive(manager, group.id, 'done');

    await expect(g.groups.rename(manager, group.id, 'new name')).rejects.toBeDefined();
    await expect(g.groups.addTeacher(manager, group.id, s.teacherId)).rejects.toBeDefined();
    await expect(
      g.groups.removeMember(manager, group.id, s.learnerId, 'x'),
    ).rejects.toBeDefined();
  });

  it('the archived group stays queryable, with its history intact', async () => {
    const manager = await actorOf(s.managerId);
    const group = await newGroup();
    await g.groups.addMember(manager, group.id, s.learnerId);
    await g.groups.addTeacher(manager, group.id, s.teacherId);
    await g.groups.close(manager, group.id, 'term ended');
    await g.groups.archive(manager, group.id, 'done');

    expect((await g.groups.get(manager, group.id)).id).toBe(group.id);
    expect(await g.groups.members(manager, group.id)).toHaveLength(1);
    expect(await g.groups.teachers(manager, group.id)).toHaveLength(1);
    expect((await g.groups.history(manager, group.id)).length).toBeGreaterThan(0);
  });

  it('a replacement gets a NEW id; the old id and history are untouched', async () => {
    const manager = await actorOf(s.managerId);
    const group = await newGroup();
    await g.groups.addMember(manager, group.id, s.learnerId);
    await g.groups.close(manager, group.id, 'term ended');
    await g.groups.archive(manager, group.id, 'done');

    const replacement = await g.groups.createReplacement(manager, group.id, 'Group B', 'restart');

    expect(replacement.id).not.toBe(group.id);
    expect(replacement.state).toBe('active');

    const old = await g.groups.get(manager, group.id);
    expect(old.id).toBe(group.id);
    expect(old.replacedByGroupId).toBe(replacement.id);
    expect(old.state).toBe('archived');
    // The old roster did NOT move to the replacement.
    expect(await g.groups.members(manager, group.id)).toHaveLength(1);
    expect(await g.groups.members(manager, replacement.id)).toHaveLength(0);
  });

  it('refuses a second replacement', async () => {
    const manager = await actorOf(s.managerId);
    const group = await newGroup();
    await g.groups.createReplacement(manager, group.id, 'B', 'first');
    await expect(
      g.groups.createReplacement(manager, group.id, 'C', 'second'),
    ).rejects.toBeDefined();
  });
});

describe('group authorization', () => {
  it('a parent reaches no group at all -- refused at the permission gate', async () => {
    // A parent holds no groups.read, so the request is refused BEFORE any query
    // runs. That is stronger than returning an empty list: no group row is ever
    // read on a contact's behalf, so there is nothing to leak through a count,
    // a timing difference or a future change to the filter.
    const parent = await actorOf(s.parentId);
    const group = await newGroup();

    await expect(g.groups.list(parent)).rejects.toMatchObject({
      code: CommErrorCode.PERMISSION_DENIED,
    });
    await expect(g.groups.get(parent, group.id)).rejects.toMatchObject({
      code: CommErrorCode.PERMISSION_DENIED,
    });
    await expect(g.groups.members(parent, group.id)).rejects.toMatchObject({
      code: CommErrorCode.PERMISSION_DENIED,
    });
  });

  it('a teacher sees only the groups they CURRENTLY teach', async () => {
    const manager = await actorOf(s.managerId);
    const teacher = await actorOf(s.teacherId);
    const mine = await newGroup('Mine');
    const other = await newGroup('Not mine');
    await g.groups.addTeacher(manager, mine.id, s.teacherId);

    const visible = (await g.groups.list(teacher)).map((x) => x.id);
    expect(visible).toContain(mine.id);
    expect(visible).not.toContain(other.id);
  });

  it('a FORMER teacher loses group access; the historical row grants nothing', async () => {
    const manager = await actorOf(s.managerId);
    const teacher = await actorOf(s.teacherId);
    const group = await newGroup();
    await g.groups.addTeacher(manager, group.id, s.teacherId);
    expect((await g.groups.list(teacher)).map((x) => x.id)).toContain(group.id);

    await g.groups.removeTeacher(manager, group.id, s.teacherId, 'reassigned');

    expect((await g.groups.list(teacher)).map((x) => x.id)).not.toContain(group.id);
    await expect(g.groups.get(teacher, group.id)).rejects.toMatchObject({
      code: CommErrorCode.CONVERSATION_NOT_FOUND,
    });
  });

  it('a supervisor sees only the roster rows of families they supervise', async () => {
    // otherAdmin supervises nothing, so even though they may read groups, the
    // roster must come back empty rather than exposing another family's student.
    const manager = await actorOf(s.managerId);
    const otherAdmin = await actorOf(s.otherAdminId);
    const group = await newGroup();
    await g.groups.addMember(manager, group.id, s.learnerId);

    expect(await g.groups.members(manager, group.id)).toHaveLength(1);
    expect(await g.groups.members(otherAdmin, group.id)).toHaveLength(0);
  });

  it('refuses group mutation without groups.manage', async () => {
    const teacher = await actorOf(s.teacherId);
    await expect(g.groups.create(teacher, { name: 'nope' })).rejects.toMatchObject({
      code: CommErrorCode.PERMISSION_DENIED,
    });
  });
});
