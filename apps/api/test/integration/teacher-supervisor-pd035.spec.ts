/**
 * PD-35 part 2 -- teacher supervisors: each teacher's one supervisor, the scope
 * that follows from it under TEACHER_SUPERVISOR_STRICT_SCOPE, and the
 * 'supervision' seat.
 *
 *   1. only the Teachers Manager and the super admin assign; only a primary
 *      supervisor of the Teachers department is assigned; it is audited, and the
 *      database keeps an assigned supervisor in the department
 *   2. switch OFF: the department works department-wide, exactly as before
 *   3. switch ON: a teacher supervisor works on their own teachers (and a
 *      supervisor they back up); the Teachers Manager on every teacher; anything
 *      else reads as not found -- Teacher File, lessons, the supervision chat
 *   4. the 'supervision' seat: a teacher supervisor joins their teacher's
 *      child's group, visibly; anyone else is refused; a change of teacher ends
 *      access at once and the sweep ends the seat
 *   5. join candidates are the groups of the caller's teachers, never content
 *   6. switch ON: a change of supervisor re-seats the supervision conversation
 *
 * Synthetic fixtures only (G-16).
 */
import { randomUUID } from 'node:crypto';
import { PrismaAuditService } from '@platform/audit.service';
import { CommError, CommErrorCode } from '@platform/errors';
import { NO_REALTIME_REVOCATION } from '@platform/realtime-revocation';
import { TeacherScopeService } from '@platform/teacher-scope';
import { ConversationSeatService } from '@communication/seats/conversation-seat.service';
import { SeatPolicyRegistry } from '@communication/seats/seat-policy';
import { LessonService } from '../../src/lessons/lesson.service';
import { TrialGroupService } from '../../src/lessons/trial-group.service';
import { SupervisionConversationService } from '../../src/supervision/supervision-conversation.service';
import { CardPoster } from '../../src/supervision/card-poster';
import { TeacherFileService } from '../../src/teacher-file/teacher-file.service';
import { TeacherSupervisorService } from '../../src/teacher-supervisors/teacher-supervisor.service';
import { activateBackup, buildGraph, seed, truncate, Scenario } from './harness';

const g = buildGraph();
const audit = new PrismaAuditService();
const scope = new TeacherScopeService(g.prisma);
const lessons = new LessonService(g.prisma, g.authz, g.conversations, g.outbox, g.config, audit, undefined, undefined, scope);
const supervisionChats = new SupervisionConversationService(g.prisma, g.authz, g.conversations, g.outbox, audit, scope);
const cards = new CardPoster(g.conversations, g.outbox, audit);
const trialGroups = new TrialGroupService(g.prisma, g.authz, g.conversations, g.outbox, cards, g.config, audit);
const files = new TeacherFileService(g.prisma, g.authz, g.conversations, audit, scope);
const registry = new SeatPolicyRegistry();
const seats = new ConversationSeatService(g.prisma, g.authz, g.conversations, g.outbox, registry, audit, NO_REALTIME_REVOCATION);
const supervisors = new TeacherSupervisorService(g.prisma, g.conversations, registry, scope, supervisionChats, trialGroups, audit);
supervisors.onModuleInit();

jest.setTimeout(120_000);

const HOUR = 3_600_000;
let s: Scenario;
let tmgr: string;
let tsupA: string;
let tsupB: string;
let tbak: string;
let superId: string;
let teachersDept: string;
let groupId: string;

async function code(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (e) {
    if (e instanceof CommError) return e.code;
    throw e;
  }
  throw new Error('expected a refusal, got success');
}

const actor = (id: string) => g.conversations.requireActor(id);
const strict = (on: boolean) =>
  g.prisma.$executeRaw`UPDATE chat.config SET value = ${JSON.stringify(on)}::jsonb WHERE key = 'teacher_supervisor.strict_scope'`;
const access = async (staffId: string, conversationId: string) =>
  (await g.prisma.$queryRaw<Array<{ basis: string | null }>>`
    SELECT chat.staff_conversation_access(${staffId}::uuid, ${conversationId}::uuid, now()) AS basis`)[0].basis;

/** The Teachers department: tmgr manages; tsupA and tsupB are supervisors; tbak a backup; and a super admin. */
async function teachersFixtures() {
  await g.prisma.$executeRawUnsafe(
    `insert into chat.staff (id, name, role, is_active) values
       ($1::uuid, 'tmgr_x', 'manager', true), ($2::uuid, 'tsup_a', 'admin', true),
       ($3::uuid, 'tsup_b', 'admin', true), ($4::uuid, 'tbak_c', 'admin', true)`,
    tmgr, tsupA, tsupB, tbak,
  );
  await g.prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`select set_config('chat.provisioning_super_admin', 'on', true)`);
    await tx.$executeRawUnsafe(`insert into chat.staff (id, name, role, is_active) values ($1::uuid, 'root_d', 'super_admin', true)`, superId);
  });
  [{ id: teachersDept }] = await g.prisma.$queryRawUnsafe<Array<{ id: string }>>(
    `insert into chat.department (kind, display_name, manager_id) values ('teachers', 'teachers', $1::uuid) returning id::text as id`,
    tmgr,
  );
  await g.prisma.$executeRawUnsafe(
    `insert into chat.department_member (staff_id, organization_id, department_id, position) values
       ($1::uuid, chat.default_organization_id(), $4::uuid, 'supervisor'),
       ($2::uuid, chat.default_organization_id(), $4::uuid, 'supervisor'),
       ($3::uuid, chat.default_organization_id(), $4::uuid, 'backup_supervisor')`,
    tsupA, tsupB, tbak, teachersDept,
  );
}

beforeAll(async () => {
  await g.prisma.$connect();
});
afterAll(async () => {
  await strict(false);
  await truncate(g.prisma);
  await g.prisma.$disconnect();
});
beforeEach(async () => {
  await truncate(g.prisma);
  await strict(false);
  s = await seed(g.prisma);
  g.coverage.onDutyId = s.ownerId;
  [tmgr, tsupA, tsupB, tbak, superId] = [randomUUID(), randomUUID(), randomUUID(), randomUUID(), randomUUID()];
  await teachersFixtures();
  groupId = (await g.conversations.ensureStudentGroup(s.learnerId, s.ownerId)).id;
});

// ---------------------------------------------------------------------------

describe('1. assigning a teacher', () => {
  it('is the Teachers Manager\'s (or the super admin\'s), to a primary supervisor of the department, audited', async () => {
    expect(await code(supervisors.assign(tsupA, s.teacherId, { supervisorId: tsupA }))).toBe(CommErrorCode.TEACHER_FILE_DENIED);
    expect(await code(supervisors.assign(s.managerId, s.teacherId, { supervisorId: tsupA }))).toBe(CommErrorCode.TEACHER_FILE_DENIED);
    // An Operations supervisor, and a Teachers backup, are not assignable.
    expect(await code(supervisors.assign(tmgr, s.teacherId, { supervisorId: s.ownerId }))).toBe(CommErrorCode.VALIDATION);
    expect(await code(supervisors.assign(tmgr, s.teacherId, { supervisorId: tbak }))).toBe(CommErrorCode.VALIDATION);

    await supervisors.assign(tmgr, s.teacherId, { supervisorId: tsupA, reason: 'new term' });
    const view = await supervisors.assignments(tmgr);
    expect(view.strictScope).toBe(false);
    expect(view.teachers.find((t) => t.id === s.teacherId)?.supervisor).toEqual({ id: tsupA, name: 'tsup_a' });
    expect(view.unassigned).toBe(view.teachers.filter((t) => t.isActive).length - 1);
    expect(view.supervisors.map((x) => x.name)).toEqual(['tsup_a', 'tsup_b']);

    await supervisors.assign(superId, s.teacherId, { supervisorId: null });
    expect(await g.prisma.auditLog.count({ where: { entityId: s.teacherId, action: { startsWith: 'teacher_supervisor.' } } })).toBe(2);

    // The database keeps an assigned supervisor where they are.
    await supervisors.assign(tmgr, s.teacherId, { supervisorId: tsupB });
    await expect(g.prisma.$executeRaw`DELETE FROM chat.department_member WHERE staff_id = ${tsupB}::uuid`)
      .rejects.toThrow(/reassign this supervisor's teachers/);
  });
});

describe('2. switch OFF', () => {
  it('works department-wide, exactly as before PD-35', async () => {
    await supervisors.assign(tmgr, s.teacherId, { supervisorId: tsupA });
    // tsupB has no teacher, and still sees everything.
    expect((await files.list(tsupB)).teachers.map((t) => t.id)).toContain(s.teacherId);
    await expect(files.detail(tsupB, s.teacherId)).resolves.toBeDefined();
    const chat = await supervisionChats.ensureForTeacher(tmgr, s.teacherId);
    expect(await access(tsupB, chat.conversationId)).toBe('member');
    const lesson = await lessons.schedule(tmgr, { learnerId: s.learnerId, startsAt: new Date(Date.now() + 2 * HOUR).toISOString(), endsAt: new Date(Date.now() + 2.5 * HOUR).toISOString() });
    await expect(lessons.get(tsupB, lesson.id)).resolves.toMatchObject({ id: lesson.id });
  });
});

describe('3. switch ON', () => {
  it('a teacher supervisor works on their own teachers; the manager on all; the rest reads as not found', async () => {
    await supervisors.assign(tmgr, s.teacherId, { supervisorId: tsupA });
    const chat = await supervisionChats.ensureForTeacher(tmgr, s.teacherId);
    const lesson = await lessons.schedule(tmgr, { learnerId: s.learnerId, startsAt: new Date(Date.now() + 2 * HOUR).toISOString(), endsAt: new Date(Date.now() + 2.5 * HOUR).toISOString() });
    await strict(true);

    // tsupA: their teacher.
    expect((await files.list(tsupA)).teachers.map((t) => t.id)).toEqual([s.teacherId]);
    await expect(files.detail(tsupA, s.teacherId)).resolves.toBeDefined();
    expect(await access(tsupA, chat.conversationId)).toBe('member');
    await expect(lessons.get(tsupA, lesson.id)).resolves.toMatchObject({ id: lesson.id });

    // tsupB: none of it, answered as not found.
    expect((await files.list(tsupB)).teachers).toEqual([]);
    expect(await code(files.detail(tsupB, s.teacherId))).toBe(CommErrorCode.TEACHER_FILE_NOT_FOUND);
    expect(await access(tsupB, chat.conversationId)).toBeNull();
    expect(await code(lessons.get(tsupB, lesson.id))).toBe(CommErrorCode.LESSON_NOT_FOUND);
    expect(await code(supervisionChats.ensureForTeacher(tsupB, s.teacherId))).toBe(CommErrorCode.SUPERVISION_NOT_FOUND);
    expect((await lessons.list(tsupB, {})).lessons).toEqual([]);

    // The Teachers Manager: every teacher.
    expect((await files.list(tmgr)).teachers.map((t) => t.id)).toEqual(expect.arrayContaining([s.teacherId, s.newTeacherId]));
    expect(await access(tmgr, chat.conversationId)).toBe('member');

    // A backup of tsupA works on tsupA's teachers while the link is active.
    expect(await access(tbak, chat.conversationId)).toBeNull();
    await activateBackup(g.prisma, tsupA, tbak);
    expect(await access(tbak, chat.conversationId)).toBe('member');
    await expect(files.detail(tbak, s.teacherId)).resolves.toBeDefined();
  });
});

describe('4. the supervision seat', () => {
  it('lets a teacher supervisor join their teacher\'s child\'s group, visibly; refuses anyone else; ends with the teacher', async () => {
    await supervisors.assign(tmgr, s.teacherId, { supervisorId: tsupA });
    expect(await access(tsupA, groupId)).toBeNull();

    const seat = await seats.join(await actor(tsupA), groupId, { reason: 'supervision' });
    expect(seat.effective).toBe(false);
    expect(await access(tsupA, groupId)).toBe('seated');
    const line = (await g.prisma.message.findMany({ where: { conversationId: groupId, authorType: 'system' } }))
      .map((m) => JSON.parse(m.body ?? '{}')).find((b) => b.kind === 'seat.joined');
    expect(line).toEqual({ kind: 'seat.joined', name: 'tsup_a', role: 'teacher_supervisor', reason: 'supervision' });

    // Another teacher supervisor: refused, by name -- ask the Teachers Manager.
    expect(await code(seats.join(await actor(tsupB), groupId, { reason: 'supervision' }))).toBe(CommErrorCode.SEAT_NOT_ELIGIBLE);
    // Someone outside the department with no basis here: not found.
    expect(await code(seats.join(await actor(s.otherAdminId), groupId, { reason: 'supervision' }))).toBe(CommErrorCode.CONVERSATION_NOT_FOUND);
    // The Teachers Manager may join any teacher's group.
    await seats.join(await actor(tmgr), groupId, { reason: 'supervision' });
    // Never in a 1:1.
    const direct = await g.conversations.getOrCreateDirect(s.parentId, s.ownerId);
    expect(await code(seats.join(await actor(tsupA), direct.id, { reason: 'supervision' }))).toBe(CommErrorCode.SEAT_NOT_ALLOWED_HERE);

    // A change of teacher ends tsupA's access at once; the sweep ends the seat.
    await g.prisma.$queryRawUnsafe(
      `select * from chat.transfer_learner($1::uuid, $2::uuid, 'other', null, null, $3::uuid)`,
      s.learnerId, s.newTeacherId, s.ownerId,
    );
    expect(await access(tsupA, groupId)).toBeNull();
    expect(await access(tmgr, groupId)).toBe('seated');
    expect(await seats.sweep()).toBe(1);
    const [row] = await g.prisma.$queryRaw<Array<{ left_kind: string }>>`
      SELECT left_kind FROM chat.conversation_seat WHERE conversation_id = ${groupId}::uuid AND staff_id = ${tsupA}::uuid`;
    expect(row.left_kind).toBe('ineligible');
  });
});

describe('5. join candidates', () => {
  it('are the groups of the caller\'s teachers, with no content', async () => {
    await supervisors.assign(tmgr, s.teacherId, { supervisorId: tsupA });
    const mine = await supervisors.joinCandidates(tsupA, {});
    expect(mine.groups.map((x) => x.conversationId)).toContain(groupId);
    const g0 = mine.groups.find((x) => x.conversationId === groupId)!;
    expect(g0).toMatchObject({ type: 'student_group', teacher: { id: s.teacherId }, membership: 'none' });
    expect(Object.keys(g0).sort()).toEqual(['conversationId', 'lastActivityAt', 'learners', 'membership', 'teacher', 'title', 'type']);
    expect((await supervisors.joinCandidates(tsupB, {})).groups).toEqual([]);

    await seats.join(await actor(tsupA), groupId, { reason: 'supervision' });
    expect((await supervisors.joinCandidates(tsupA, {})).groups.find((x) => x.conversationId === groupId)?.membership).toBe('seated');
  });
});

describe('6. switch ON: a change of supervisor re-seats the supervision conversation', () => {
  it('seats the teacher\'s own supervisor and the manager only, and moves with the assignment', async () => {
    await supervisors.assign(tmgr, s.teacherId, { supervisorId: tsupA });
    const chat = await supervisionChats.ensureForTeacher(tmgr, s.teacherId);
    const seated = async () =>
      (await g.prisma.conversationMember.findMany({ where: { conversationId: chat.conversationId, leftAt: null, actorKind: 'staff' } }))
        .map((m) => m.actorId).sort();
    // OFF: the whole department.
    expect(await seated()).toEqual([tmgr, tsupA, tsupB, tbak].sort());

    await strict(true);
    expect(await supervisors.reseatAll()).toBeGreaterThan(0);
    expect(await seated()).toEqual([tmgr, tsupA].sort());

    await supervisors.assign(tmgr, s.teacherId, { supervisorId: tsupB });
    expect(await seated()).toEqual([tmgr, tsupB].sort());
    expect(await access(tsupA, chat.conversationId)).toBeNull();
  });
});
