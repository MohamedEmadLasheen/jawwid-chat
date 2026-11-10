/**
 * OA-12 (docs/release/app-review-notes-payments.md): ONE LEARNER PER PAID LESSON CALL.
 *
 * The app takes lesson payments outside store billing under Apple 3.1.3(d) and
 * Google Play's 1:1 rule, which hold only for a live service between a teacher
 * and ONE learner. A lesson already names one learner (chat.lesson.learner_id)
 * and a teacher cannot hold two lessons at once (lesson_no_teacher_overlap).
 * What was left open is the CALL: a call carries no lesson id, so nothing
 * stopped the call held in a lesson's window from also seating another child.
 *
 * A child has no account of their own: on a call a learner is present through
 * their family's guardians. So, while one of the teacher's lessons is in its
 * window (the PD-57 lesson-call window), a call that seats the lesson's family
 * may not also seat a guardian of ANOTHER family -- another learner. Refused at
 * start (and in the capability answer) and when that guardian answers or asks
 * for media, with COMM.LESSON_ONE_LEARNER. The lesson's own parents, the
 * teacher and staff are seated as before; outside every window nothing changes;
 * a family's own sibling group (one family) is unaffected.
 *
 * Only a class group may span families in the database; the other family's
 * guardian is seated here the one way that bypasses the family-scope trigger
 * (session_replication_role = replica, transaction-local), as the harness's
 * legacy fixtures do.
 */
import { randomUUID } from 'node:crypto';
import { CommErrorCode } from '@platform/errors';
import { buildGraph, seed, truncate, withAssignmentGate, type Scenario } from './harness';

jest.setTimeout(60_000);

const g = buildGraph();
const MINUTE = 60_000;
let s: Scenario;
let groupId: string;
/** A guardian of ANOTHER family, and that family's child. */
let otherFamilyId: string;
let otherGuardianId: string;
let otherLearnerId: string;

beforeAll(async () => { await g.prisma.$connect(); });
afterAll(async () => { await g.prisma.$disconnect(); });
beforeEach(async () => {
  await truncate(g.prisma);
  s = await seed(g.prisma);
  g.coverage.onDutyId = s.ownerId;
  groupId = (await g.conversations.ensureStudentGroup(s.learnerId)).id;

  otherFamilyId = randomUUID();
  otherGuardianId = randomUUID();
  otherLearnerId = randomUUID();
  await g.prisma.$executeRawUnsafe(
    `insert into chat.family (id, display_name, owner_id, language) values ($1::uuid, 'family_y', $2::uuid, 'ar')`,
    otherFamilyId, s.ownerId,
  );
  await g.prisma.$executeRawUnsafe(
    `insert into chat.contact (id, family_id, name, role_preset, can_message, is_active)
     values ($1::uuid, $2::uuid, 'parent_r', 'primary_guardian', true, true)`,
    otherGuardianId, otherFamilyId,
  );
  await withAssignmentGate(
    g.prisma,
    `insert into chat.learner (id, family_id, name, teacher_id)
     values ('${otherLearnerId}'::uuid, '${otherFamilyId}'::uuid, 'learner_n', '${s.teacherId}'::uuid)`,
  );
});

/** A lesson of learner_l with teacher_c, `offset` from now, 30 minutes long. */
async function lessonAt(offsetMs: number) {
  return g.prisma.lesson.create({
    data: {
      learnerId: s.learnerId,
      teacherId: s.teacherId,
      createdBy: s.ownerId,
      startsAt: new Date(Date.now() + offsetMs),
      endsAt: new Date(Date.now() + offsetMs + 30 * MINUTE),
    },
    select: { id: true },
  });
}
/** Happening now: started five minutes ago. */
const lessonNow = () => lessonAt(-5 * MINUTE);

/** Seat the other family's guardian in learner_l's group (see the header). */
async function seatOtherGuardian(conversationId = groupId): Promise<void> {
  await g.prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`set local session_replication_role = replica`);
    await tx.conversationMember.create({
      data: { conversationId, actorId: otherGuardianId, actorKind: 'contact', memberRole: 'parent' },
    });
  });
}

const seatedOn = async (callId: string) =>
  (await g.prisma.callParticipant.findMany({ where: { callId }, select: { actorId: true } })).map((p) => p.actorId);

describe('OA-12: one learner per paid lesson call', () => {
  it('a second learner is refused at start: in the lesson window, another family\'s guardian would be seated', async () => {
    await lessonNow();
    await seatOtherGuardian();

    await expect(g.calls.start(groupId, s.ownerId)).rejects.toMatchObject({
      code: CommErrorCode.LESSON_ONE_LEARNER,
    });
    await expect(g.calls.start(groupId, s.teacherId)).rejects.toMatchObject({
      code: CommErrorCode.LESSON_ONE_LEARNER,
    });
    expect(await g.prisma.call.count({ where: { conversationId: groupId } })).toBe(0);
    // The advisory answer agrees with start().
    await expect(g.calls.callCapability(groupId, s.ownerId)).resolves.toEqual({
      canCall: false,
      code: CommErrorCode.LESSON_ONE_LEARNER,
    });
  });

  it('a second learner is refused at join: a call begun before the window cannot seat them once it opens', async () => {
    await seatOtherGuardian();
    const { callId } = await g.calls.start(groupId, s.ownerId);
    expect(await seatedOn(callId)).toContain(otherGuardianId);

    // The lesson's window opens while the call is ringing.
    await lessonNow();

    await expect(g.calls.accept(callId, otherGuardianId)).rejects.toMatchObject({
      code: CommErrorCode.LESSON_ONE_LEARNER,
    });
    await expect(g.calls.issueToken(callId, otherGuardianId)).rejects.toMatchObject({
      code: CommErrorCode.LESSON_ONE_LEARNER,
    });
    const mine = await g.prisma.callParticipant.findFirstOrThrow({ where: { callId, actorId: otherGuardianId } });
    expect(mine.joinedAt).toBeNull();

    // The lesson's own parent and its teacher are seated as before.
    await expect(g.calls.accept(callId, s.parentId)).resolves.toBeUndefined();
    await expect(g.calls.issueToken(callId, s.parentId)).resolves.toMatchObject({ token: expect.any(String) });
    await expect(g.calls.issueToken(callId, s.teacherId)).resolves.toMatchObject({ token: expect.any(String) });
    await expect(g.calls.issueToken(callId, s.ownerId)).resolves.toMatchObject({ token: expect.any(String) });
  });

  it('the lesson\'s own parents and its teacher may start, answer and join a paid lesson call', async () => {
    await lessonNow();

    const { callId } = await g.calls.start(groupId, s.teacherId);
    expect((await seatedOn(callId)).sort()).toEqual([s.parentId, s.otherParentId, s.teacherId, s.ownerId].sort());
    await expect(g.calls.accept(callId, s.parentId)).resolves.toBeUndefined();
    await expect(g.calls.accept(callId, s.otherParentId)).resolves.toBeUndefined();
    await expect(g.calls.issueToken(callId, s.teacherId)).resolves.toMatchObject({ token: expect.any(String) });
    await g.calls.end(callId, s.teacherId);

    // A parent may start it too (PD-19).
    const byParent = await g.calls.start(groupId, s.parentId);
    await expect(g.calls.accept(byParent.callId, s.teacherId)).resolves.toBeUndefined();
    await expect(g.calls.callCapability(groupId, s.parentId)).resolves.toEqual({ canCall: true, code: null });
  });

  it('outside every lesson window nothing changes: the same call seats both families', async () => {
    // Two hours away: the window opens fifteen minutes before the start.
    await lessonAt(2 * 60 * MINUTE);
    await seatOtherGuardian();

    const { callId } = await g.calls.start(groupId, s.ownerId);
    expect(await seatedOn(callId)).toEqual(expect.arrayContaining([s.parentId, otherGuardianId, s.teacherId]));
    await expect(g.calls.callCapability(groupId, s.ownerId)).resolves.toEqual({ canCall: true, code: null });
  });

  it('a lesson that did not take place opens no window', async () => {
    const lesson = await lessonNow();
    // Closed as the teacher's apology. The outcome is the lesson writer's
    // (guard_lesson); a fixture stands in for it with triggers off, and the
    // table's CHECK constraints still hold.
    await g.prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`set local session_replication_role = replica`);
      await tx.$executeRawUnsafe(
        `update chat.lesson
            set outcome = 'teacher_apology', outcome_by_kind = 'teacher', outcome_by = $2::uuid, outcome_at = now()
          where id = $1::uuid`,
        lesson.id, s.teacherId,
      );
    });
    await seatOtherGuardian();

    const { callId } = await g.calls.start(groupId, s.ownerId);
    expect(await seatedOn(callId)).toContain(otherGuardianId);
  });

  it('a family group about several siblings, with no lesson on, is unaffected', async () => {
    const siblings = await g.conversations.createFamilyGroup(s.ownerId, {
      learnerIds: [s.learnerId, s.secondLearnerId],
      contactIds: [s.parentId, s.otherParentId],
      teacherIds: [s.teacherId, s.newTeacherId],
    });

    const { callId } = await g.calls.start(siblings.id, s.ownerId);
    expect(await seatedOn(callId)).toEqual(expect.arrayContaining([s.parentId, s.otherParentId, s.teacherId]));
    await expect(g.calls.accept(callId, s.parentId)).resolves.toBeUndefined();
    await expect(g.calls.issueToken(callId, s.teacherId)).resolves.toMatchObject({ token: expect.any(String) });
  });

  it('in a lesson window the family\'s own sibling group still calls: its guardians are the lesson learner\'s guardians', async () => {
    const siblings = await g.conversations.createFamilyGroup(s.ownerId, {
      learnerIds: [s.learnerId, s.secondLearnerId],
      contactIds: [s.parentId, s.otherParentId],
      teacherIds: [s.teacherId, s.newTeacherId],
    });
    await lessonNow();

    const { callId } = await g.calls.start(siblings.id, s.teacherId);
    await expect(g.calls.accept(callId, s.parentId)).resolves.toBeUndefined();
    await expect(g.calls.issueToken(callId, s.otherParentId)).resolves.toMatchObject({ token: expect.any(String) });
  });

  it('the refused guardian may still decline the ringing call', async () => {
    await seatOtherGuardian();
    const { callId } = await g.calls.start(groupId, s.ownerId);
    await lessonNow();

    await expect(g.calls.decline(callId, otherGuardianId)).resolves.toBeUndefined();
  });

  it('another teacher\'s lesson opens no window on this call', async () => {
    await g.prisma.lesson.create({
      data: {
        learnerId: s.secondLearnerId,
        teacherId: s.newTeacherId,
        createdBy: s.ownerId,
        startsAt: new Date(Date.now() - 5 * MINUTE),
        endsAt: new Date(Date.now() + 25 * MINUTE),
      },
    });
    await seatOtherGuardian();

    // teacher_d is not on learner_l's group, so this is not teacher_d's lesson call.
    const { callId } = await g.calls.start(groupId, s.ownerId);
    expect(await seatedOn(callId)).toContain(otherGuardianId);
  });
});
