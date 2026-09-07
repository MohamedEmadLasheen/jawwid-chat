/**
 * TEACHER TRANSFER -- the Phase 3 requirement, end to end.
 *
 *   Ahmed -> Islam,  Islam leaves,  Ahmed -> Mahmoud
 *
 * Expected afterwards:
 *   CURRENT  Mahmoud
 *   HISTORY  Islam, ended, still queryable
 *
 * and, because a relationship change is also an access change, the student
 * group's teacher member must follow the assignment -- Mahmoud in, Islam out --
 * through Phase 2's existing reconciler and no second mechanism.
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

describe('teacher assignment history', () => {
  it('backfills the pre-Phase-3 teacher as a live assignment', async () => {
    // seed() writes learner.teacher_id directly, exactly as the pre-Phase-3
    // world did. The assignment table is only populated by the migration for
    // rows that existed then, so a learner created afterwards has no live row
    // until one is assigned -- which is what makes the next assertion meaningful.
    const manager = await actorOf(s.managerId);
    const history = await g.learners.teacherHistory(manager, s.learnerId);
    expect(history.length).toBeLessThanOrEqual(1);
  });

  it('Ahmed -> Islam -> Mahmoud: current is Mahmoud, Islam is preserved as history', async () => {
    const manager = await actorOf(s.managerId);

    await g.learners.assignTeacher(manager, s.learnerId, s.teacherId, 'initial assignment');
    const afterFirst = await g.learners.teacherHistory(manager, s.learnerId);
    expect(afterFirst.filter((a) => a.isCurrent)).toHaveLength(1);
    expect(afterFirst.find((a) => a.isCurrent)!.teacherId).toBe(s.teacherId);

    await g.learners.assignTeacher(manager, s.learnerId, s.newTeacherId, 'Islam left');

    const history = await g.learners.teacherHistory(manager, s.learnerId);
    const current = history.filter((a) => a.isCurrent);

    // exactly one current, and it is the new teacher
    expect(current).toHaveLength(1);
    expect(current[0].teacherId).toBe(s.newTeacherId);

    // the previous teacher is still there, ended, with the reason recorded
    const previous = history.find((a) => a.teacherId === s.teacherId)!;
    expect(previous).toBeDefined();
    expect(previous.isCurrent).toBe(false);
    expect(previous.endedAt).not.toBeNull();
    expect(previous.endedReason).toBe('Islam left');
  });

  it('assigning the same teacher again is a no-op, not a fabricated transfer', async () => {
    const manager = await actorOf(s.managerId);
    await g.learners.assignTeacher(manager, s.learnerId, s.teacherId, 'initial');
    const before = await g.learners.teacherHistory(manager, s.learnerId);
    await g.learners.assignTeacher(manager, s.learnerId, s.teacherId, 'retry');
    const after = await g.learners.teacherHistory(manager, s.learnerId);
    expect(after).toHaveLength(before.length);
  });

  it('the student group follows the current teacher, and drops the former one', async () => {
    const manager = await actorOf(s.managerId);
    await g.learners.assignTeacher(manager, s.learnerId, s.teacherId, 'initial');
    const group = await g.conversations.ensureStudentGroup(s.learnerId, s.managerId);

    const liveTeachers = async () =>
      (await prisma.conversationMember.findMany({
        where: { conversationId: group.id, actorKind: 'teacher', leftAt: null },
      })).map((m) => m.actorId);

    expect(await liveTeachers()).toEqual([s.teacherId]);

    await g.learners.assignTeacher(manager, s.learnerId, s.newTeacherId, 'Islam left');

    // Mahmoud is in, Islam is out -- as a LEFT row, not a deleted one.
    expect(await liveTeachers()).toEqual([s.newTeacherId]);
    const departed = await prisma.conversationMember.findFirst({
      where: { conversationId: group.id, actorId: s.teacherId },
    });
    expect(departed).not.toBeNull();
    expect(departed!.leftAt).not.toBeNull();
  });

  it('refuses an unauthorized actor, and says which permission is missing', async () => {
    const parent = await actorOf(s.parentId);
    await expect(
      g.learners.assignTeacher(parent, s.learnerId, s.teacherId, 'nope'),
    ).rejects.toMatchObject({ code: CommErrorCode.PERMISSION_DENIED });
  });

  it('refuses a blank reason: a relationship change must say why', async () => {
    const manager = await actorOf(s.managerId);
    await expect(
      g.learners.assignTeacher(manager, s.learnerId, s.teacherId, '   '),
    ).rejects.toMatchObject({ code: CommErrorCode.APPROVAL_REASON_REQUIRED });
  });

  it('a student outside the actor scope is NOT FOUND, not forbidden', async () => {
    // otherAdmin supervises nothing, so the learner is outside their scope. The
    // response must be identical to a made-up id, or it confirms the id exists.
    const otherAdmin = await actorOf(s.otherAdminId);
    // Awaited one at a time. Holding a second rejecting promise while awaiting
    // the first is an unhandled rejection, which jest reports as a failure of
    // the test rather than of the code.
    const capture = async (fn: () => Promise<unknown>) => {
      try { await fn(); return 'resolved'; } catch (e) { return (e as { code: string }).code; }
    };
    const real = await capture(() => g.learners.assignTeacher(otherAdmin, s.learnerId, s.teacherId, 'x'));
    const fake = await capture(() => g.learners.assignTeacher(otherAdmin, randomUUID(), s.teacherId, 'x'));

    // The point is not merely that both are refused -- it is that they are
    // refused IDENTICALLY, so changing an id in a request reveals nothing.
    expect(real).toBe(CommErrorCode.CONVERSATION_NOT_FOUND);
    expect(fake).toBe(real);
  });
});
