/**
 * A newly provisioned Student Group, with zero messages, accepts the FIRST
 * message from each role entitled to post in it -- under the rules that already
 * govern it, none relaxed:
 *
 *   - the family-owner admin's message is published at once -- while that admin
 *     is ON DUTY for the family (the staff duty rule; off duty it is refused,
 *     pinned below too);
 *   - the assigned teacher's and an authorized parent's are accepted and HELD
 *     for approval (the group's teacher_requires_approval /
 *     parent_requires_approval defaults), and a held message reaches no parent
 *     until the active handler approves it;
 *   - BR-1 admin presence holds: provisioning seats the owner admin, which is
 *     what lets the teacher and the parent post at all.
 *
 * "Empty" means: no message from any PERSON. Provisioning itself writes one
 * system notice (`group.created`, seq 1, no author) by design, so the first
 * person's message is seq 2.
 *
 * Why it exists: an empty message list must never make a valid conversation
 * read-only. (Found while diagnosing an Admin Portal "read-only" report: that
 * view is the super admin's read-only inspection surface by design, and the
 * group it showed had no members. This pins the other half -- a real, empty
 * group is writable by exactly the roles allowed to write in it.)
 *
 * The group is provisioned with ensureStudentGroup, the call behind
 * POST /conversations/student-group. Synthetic fixtures only.
 */
import { buildGraph, seed, truncate, Scenario } from './harness';

jest.setTimeout(60_000);

const g = buildGraph();
let s: Scenario;

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
  // The family owner is the admin on duty -- as in groups-approval-calls and
  // membership-authorization. The duty roster is coverage's answer, pinned here.
  g.coverage.onDutyId = s.ownerId;
});

/** A fresh group for the seeded learner, provisioned by its family's owner. */
async function provisionEmptyGroup(): Promise<string> {
  const group = await g.conversations.ensureStudentGroup(s.learnerId, s.ownerId);
  expect(group.type).toBe('student_group');
  return group.id;
}

const liveMembers = (conversationId: string) =>
  g.prisma.conversationMember.findMany({
    where: { conversationId, leftAt: null },
    select: { actorId: true, actorKind: true, memberRole: true },
  });

const messagesIn = async (conversationId: string) =>
  (
    await g.prisma.message.findMany({
      where: { conversationId },
      select: { id: true, authorId: true, type: true, seq: true, moderation: true },
      orderBy: { seq: 'asc' },
    })
  ).map((m) => ({ ...m, seq: Number(m.seq) }));

/** Messages written by a person -- everything but the provisioning notice. */
const authoredIn = async (conversationId: string) =>
  (await messagesIn(conversationId)).filter((m) => m.type !== 'system');

const visibleTo = async (conversationId: string, actorId: string): Promise<string[]> =>
  (await g.messages.list({ conversationId, actorId })).messages.map((m) => m.id);

describe('a newly provisioned, empty Student Group', () => {
  it('is seated with the owner admin, the assigned teacher and the family contacts who may message -- and holds no message', async () => {
    const id = await provisionEmptyGroup();
    const members = await liveMembers(id);
    const seat = (actorId: string) => members.find((m) => m.actorId === actorId);

    expect(seat(s.ownerId)).toMatchObject({ actorKind: 'staff', memberRole: 'admin' });
    expect(seat(s.teacherId)).toMatchObject({ actorKind: 'teacher', memberRole: 'teacher' });
    expect(seat(s.parentId)).toMatchObject({ actorKind: 'contact', memberRole: 'parent' });
    expect(seat(s.otherParentId)).toMatchObject({ actorKind: 'contact', memberRole: 'parent' });
    // Nobody else: not the other admin, not the manager, not another teacher.
    for (const outsider of [s.otherAdminId, s.managerId, s.unrelatedTeacherId, s.newTeacherId]) {
      expect(seat(outsider)).toBeUndefined();
    }
    // No message from any person; only the provisioning notice.
    expect(await messagesIn(id)).toEqual([
      expect.objectContaining({ type: 'system', authorId: null, seq: 1, moderation: 'published' }),
    ]);
    expect(await authoredIn(id)).toEqual([]);
  });

  it('accepts the owner admin as the first author: published, seq 2, persisted once (a retry is the same message)', async () => {
    const id = await provisionEmptyGroup();
    const sent = await g.messages.send({ conversationId: id, senderId: s.ownerId, body: 'first: admin', clientMessageId: 'first-admin' });
    expect(sent.moderation).toBe('published');
    expect(await authoredIn(id)).toEqual([
      expect.objectContaining({ id: sent.id, authorId: s.ownerId, seq: 2, moderation: 'published' }),
    ]);
    expect(await visibleTo(id, s.parentId)).toContain(sent.id);
    expect(await visibleTo(id, s.teacherId)).toContain(sent.id);

    const again = await g.messages.send({ conversationId: id, senderId: s.ownerId, body: 'first: admin', clientMessageId: 'first-admin' });
    expect(again.id).toBe(sent.id);
    expect(await authoredIn(id)).toHaveLength(1);
  });

  it('accepts the assigned teacher as the first author, HELD for approval: no parent sees it until the seated admin approves', async () => {
    const id = await provisionEmptyGroup();
    const sent = await g.messages.send({ conversationId: id, senderId: s.teacherId, body: 'first: teacher', clientMessageId: 'first-teacher' });
    expect(sent.moderation).toBe('pending');
    expect(await authoredIn(id)).toEqual([
      expect.objectContaining({ id: sent.id, authorId: s.teacherId, seq: 2, moderation: 'pending' }),
    ]);
    expect(await visibleTo(id, s.parentId)).not.toContain(sent.id);

    const queue = await g.approvals.listPending(s.ownerId, id);
    const held = queue.find((p) => p.messageId === sent.id);
    expect(held).toBeDefined();
    await g.approvals.approve(held!.approvalId, s.ownerId);
    expect(await visibleTo(id, s.parentId)).toContain(sent.id);
  });

  it('accepts an authorized parent as the first author, HELD for approval', async () => {
    const id = await provisionEmptyGroup();
    const sent = await g.messages.send({ conversationId: id, senderId: s.parentId, body: 'first: parent', clientMessageId: 'first-parent' });
    expect(sent.moderation).toBe('pending');
    expect(await authoredIn(id)).toEqual([
      expect.objectContaining({ id: sent.id, authorId: s.parentId, seq: 2, moderation: 'pending' }),
    ]);
    const queue = await g.approvals.listPending(s.ownerId, id);
    expect(queue.map((p) => p.messageId)).toContain(sent.id);
  });

  it('the scope rule is not relaxed for an empty group: once the child moves to another supervisor, the seated admin is refused and nothing is written (PD-8)', async () => {
    const id = await provisionEmptyGroup();
    // The coverage engine decides nothing; the child's supervision does.
    g.coverage.onDutyId = s.ownerId;
    await g.prisma.learnerSupervision.update({
      where: { learnerId: s.learnerId },
      data: { supervisorId: s.otherAdminId },
    });
    await expect(
      g.messages.send({ conversationId: id, senderId: s.ownerId, body: 'not mine any more', clientMessageId: 'moved' }),
    ).rejects.toMatchObject({ name: 'CommError', code: 'COMM.STAFF_OUT_OF_SCOPE' });
    expect(await authoredIn(id)).toEqual([]);
  });

  it('an empty list opens the group to nobody else: a non-member admin and an unassigned teacher are refused, and nothing is written', async () => {
    const id = await provisionEmptyGroup();
    for (const outsider of [s.otherAdminId, s.unrelatedTeacherId]) {
      await expect(
        g.messages.send({ conversationId: id, senderId: outsider, body: 'not mine', clientMessageId: `x-${outsider}` }),
      ).rejects.toMatchObject({ name: 'CommError' });
    }
    expect(await authoredIn(id)).toEqual([]);
  });
});
