/**
 * The direct-channel rule, delivered to the client:
 * `ConversationMemberDto.canOpenDirect`.
 *
 * WHY THIS EXISTS. It was introduced for PD-6, which let a teacher and a parent
 * hold a direct channel when an authorized relationship existed -- a pairing
 * the client could not decide from roles alone. The advisory is the server
 * answering "may you open a 1:1 with this member" so the client never infers it.
 *
 * RE-VERSIONED 2026-10-14 BY PD-7, which supersedes PD-6 and restores BR-1: a
 * teacher and a parent may NEVER hold a direct channel, whatever their
 * relationship; they speak only in the Student Group, with a live admin. So
 * every teacher <-> parent case below that PD-6 answered TRUE now answers
 * FALSE, the relationship (held, absent or revoked) no longer moves it, and
 * the family-facing admin remains the one member both sides may open.
 *
 * WHAT IS ASSERTED. That the advisory equals the enforcement. Every case below
 * pairs the flag with the decision `POST /conversations/direct` would actually
 * take, because an advisory that can disagree with the gate is worse than none:
 * it either hides a legitimate channel or promises one that is refused.
 */
import { ConversationService } from '@communication/conversations/conversation.service';
import { CommError, CommErrorCode } from '@platform/errors';
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

describe('canOpenDirect is the server answering BR-1 (PD-7) for the viewer', () => {
  it('is FALSE even for the parent of a learner this teacher actually teaches', async () => {
    const group = await g.conversations.ensureStudentGroup(s.learnerId, s.ownerId);
    // The relationship holds -- PD-6 would have answered TRUE here.
    expect(await g.relationships.teacherParentAuthorized(s.teacherId, s.parentId)).toBe(true);

    expect(await flagFor(group.id, s.teacherId, s.parentId)).toBe(false);

    // The advisory agrees with the gate: the channel really is refused, by BR-1.
    await expect(
      g.conversations.getOrCreateDirect(s.teacherId, s.parentId),
    ).rejects.toMatchObject({ code: CommErrorCode.BR1_TEACHER_PARENT_DIRECT });
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
    ).rejects.toMatchObject({ code: CommErrorCode.BR1_TEACHER_PARENT_DIRECT });
  });

  it('is symmetric: the parent sees the same answer about the teacher', async () => {
    const group = await g.conversations.ensureStudentGroup(s.learnerId, s.ownerId);

    // BR-1 is a property of the pair, not of who asks. A parent offered a channel
    // the teacher is not offered would be the same bug seen from the other end.
    expect(await flagFor(group.id, s.parentId, s.teacherId)).toBe(false);
    await expect(
      g.conversations.getOrCreateDirect(s.parentId, s.teacherId),
    ).rejects.toMatchObject({ code: CommErrorCode.BR1_TEACHER_PARENT_DIRECT });
  });

  it('is TRUE for the family-facing admin, which needs no relationship', async () => {
    const group = await g.conversations.ensureStudentGroup(s.learnerId, s.ownerId);

    expect(await flagFor(group.id, s.teacherId, s.ownerId)).toBe(true);
    expect(await flagFor(group.id, s.parentId, s.ownerId)).toBe(true);

    // The positive control the FALSE cases above need: both channels open.
    await expect(g.conversations.getOrCreateDirect(s.teacherId, s.ownerId)).resolves.toBeDefined();
    await expect(g.conversations.getOrCreateDirect(s.parentId, s.ownerId)).resolves.toBeDefined();
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

  it('does not move with the assignment: FALSE before and after it goes away', async () => {
    // PD-6 flipped this from TRUE to FALSE on reassignment. Under PD-7 the
    // relationship is not an input, so the answer is FALSE throughout.
    const group = await g.conversations.ensureStudentGroup(s.learnerId, s.ownerId);
    expect(await flagFor(group.id, s.teacherId, s.parentId)).toBe(false);

    // Reassign the learner to another teacher, the way ingestion would.
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
    const admin = members.find((m) => m.actorId === s.ownerId);
    expect(parent).toBeDefined();
    expect(parent!.canOpenDirect).toBe(false);
    expect(admin!.canOpenDirect).toBe(true);
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
