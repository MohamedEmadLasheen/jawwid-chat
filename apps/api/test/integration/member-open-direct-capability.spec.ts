/**
 * PD-6, delivered to the client: `ConversationMemberDto.canOpenDirect`.
 *
 * WHY THIS EXISTS. PD-6 permits a teacher and a parent to hold a direct channel
 * when an authorized relationship exists, and forbids it otherwise. That makes
 * the pairing undecidable from roles alone, and the mobile client is never told
 * the relationship -- so it offered the action to nobody and the permitted
 * channel was unreachable from either side. The advisory is the server answering
 * the question it is the only party able to answer.
 *
 * WHAT IS ASSERTED. That the advisory equals the enforcement. Every case below
 * pairs the flag with the decision `POST /conversations/direct` would actually
 * take, because an advisory that can disagree with the gate is worse than none:
 * it either hides a legitimate channel or promises one that is refused.
 */
import { ConversationService } from '@communication/conversations/conversation.service';
import { CommError } from '@platform/errors';
import { buildGraph, seed, truncate, Scenario } from './harness';

const g = buildGraph();
let s: Scenario;

beforeAll(async () => g.prisma.$connect());
afterAll(async () => g.prisma.$disconnect());
beforeEach(async () => {
  await truncate(g.prisma);
  s = await seed(g.prisma);
  g.coverage.onDutyId = s.ownerId;
});

/** The advisory for one member of a conversation, as a given viewer sees it. */
async function flagFor(
  conversationId: string,
  viewerId: string,
  memberId: string,
): Promise<boolean | undefined> {
  const viewer = await g.conversations.requireActor(viewerId);
  const members = await g.conversations.membersOf(conversationId, viewer);
  return members.find((m) => m.actorId === memberId)?.canOpenDirect;
}

describe('canOpenDirect is the server answering PD-6 for the viewer', () => {
  it('is TRUE for the parent of a learner this teacher actually teaches', async () => {
    const group = await g.conversations.ensureStudentGroup(s.learnerId, s.ownerId);

    expect(await flagFor(group.id, s.teacherId, s.parentId)).toBe(true);

    // The advisory agrees with the gate: the channel really does open.
    const conv = await g.conversations.getOrCreateDirect(s.teacherId, s.parentId);
    expect(conv.id).toBeTruthy();
  });

  it('is FALSE for a teacher who teaches nobody in this family', async () => {
    const group = await g.conversations.ensureStudentGroup(s.learnerId, s.ownerId);
    await g.prisma.conversationMember.create({
      data: {
        conversationId: group.id,
        actorId: s.unrelatedTeacherId,
        actorKind: 'teacher',
        memberRole: 'teacher',
      },
    });

    expect(await flagFor(group.id, s.unrelatedTeacherId, s.parentId)).toBe(false);

    // And the gate refuses, which is what makes the false honest rather than shy.
    await expect(
      g.conversations.getOrCreateDirect(s.unrelatedTeacherId, s.parentId),
    ).rejects.toBeInstanceOf(CommError);
  });

  it('is symmetric: the parent sees the same answer about the teacher', async () => {
    const group = await g.conversations.ensureStudentGroup(s.learnerId, s.ownerId);

    // PD-6 is a property of the pair, not of who asks. A parent offered a channel
    // the teacher is not offered would be the same bug seen from the other end.
    expect(await flagFor(group.id, s.parentId, s.teacherId)).toBe(true);
  });

  it('is TRUE for the family-facing admin, which needs no relationship', async () => {
    const group = await g.conversations.ensureStudentGroup(s.learnerId, s.ownerId);

    expect(await flagFor(group.id, s.teacherId, s.ownerId)).toBe(true);
    expect(await flagFor(group.id, s.parentId, s.ownerId)).toBe(true);
  });

  it('is FALSE for yourself, and for a teacher looking at another teacher', async () => {
    const group = await g.conversations.ensureStudentGroup(s.learnerId, s.ownerId);
    await g.prisma.conversationMember.create({
      data: {
        conversationId: group.id,
        actorId: s.unrelatedTeacherId,
        actorKind: 'teacher',
        memberRole: 'teacher',
      },
    });

    expect(await flagFor(group.id, s.teacherId, s.teacherId)).toBe(false);
    expect(await flagFor(group.id, s.teacherId, s.unrelatedTeacherId)).toBe(false);
  });

  it('FAILS CLOSED when no viewer is given', async () => {
    const group = await g.conversations.ensureStudentGroup(s.learnerId, s.ownerId);

    // A roster built without knowing who is asking cannot answer "may you message
    // them". False is the only safe answer; true would be a guess in the
    // permissive direction.
    const members = await g.conversations.membersOf(group.id);
    expect(members.every((m) => m.canOpenDirect === false)).toBe(true);
    expect(members.length).toBeGreaterThan(0);
  });

  it('loses the channel when the assignment that authorized it goes away', async () => {
    const group = await g.conversations.ensureStudentGroup(s.learnerId, s.ownerId);
    expect(await flagFor(group.id, s.teacherId, s.parentId)).toBe(true);

    // Reassign the learner to another teacher, the way ingestion would. The
    // advisory is derived, never stored, so it has to follow.
    await g.prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`set local chat.syncing_assignment = 'on'`);
      await tx.$executeRawUnsafe(
        `update chat.learner set teacher_id = '${s.newTeacherId}' where id = '${s.learnerId}'`,
      );
    });

    expect(await flagFor(group.id, s.teacherId, s.parentId)).toBe(false);
  });

  it('the DTO carries it, so the client is not left inferring', async () => {
    const group = await g.conversations.ensureStudentGroup(s.learnerId, s.ownerId);
    const { members } = await g.conversations.readWithMembers(group.id, s.teacherId);

    const parent = members.find((m) => m.actorId === s.parentId);
    expect(parent).toBeDefined();
    expect(parent!.canOpenDirect).toBe(true);
    // Spelled on every member, never omitted for the false ones: an absent field
    // and a false one must not be distinguishable to the client.
    expect(members.every((m) => typeof m.canOpenDirect === 'boolean')).toBe(true);
  });
});

describe('the advisory is not a directory', () => {
  it('names no member the caller could not already see', async () => {
    const group = await g.conversations.ensureStudentGroup(s.learnerId, s.ownerId);
    const viewer = await g.conversations.requireActor(s.teacherId);

    const withViewer = await g.conversations.membersOf(group.id, viewer);
    const without = await g.conversations.membersOf(group.id);

    // Same roster, same order, same people. The advisory adds a verb, not a name:
    // membership must never become a way to discover actors (§25).
    expect(withViewer.map((m) => m.actorId)).toEqual(without.map((m) => m.actorId));
  });

  it('is refused outright to a non-member, advisory and all', async () => {
    const group = await g.conversations.ensureStudentGroup(s.learnerId, s.ownerId);

    // A real, active teacher who teaches nobody in this family and is not in this
    // group. readWithMembers is the authorized route; an outsider gets nothing at
    // all, so there is no roster on which an advisory could leak.
    //
    // Deliberately NOT the family's second contact: `otherParentId` is a member of
    // this very group, so it would have proved that members can read, which is not
    // the claim.
    await expect(
      g.conversations.readWithMembers(group.id, s.unrelatedTeacherId),
    ).rejects.toBeInstanceOf(CommError);
  });
});

/** Guards the wiring, not the rule: a viewer must actually reach membersOf. */
describe('the viewer reaches the resolver', () => {
  it('readWithMembers passes the reader through', async () => {
    const source = ConversationService.prototype.readWithMembers.toString();
    expect(source).toMatch(/membersOf\(\s*conversation\.id\s*,\s*actor\s*\)/);
  });
});
