/**
 * PD-35 follow-up -- hardening the teacher-supervisor scope before the strict
 * switch may ever be turned on (department head's review of #136). Each case
 * failed before its fix.
 *
 *   1. an assignment never outlives its supervisor's place in the Teachers
 *      department: the guard locks the membership row (no race with a
 *      concurrent removal), and the scope re-checks it
 *   2. a deactivated supervisor's teachers count as unassigned
 *   3. the move guard also covers a change of department_member.staff_id
 *   5. re-seating handles inactive teachers and follows the switch both ways
 *   6. under strict scope a teacher supervisor moves a child only TO one of their
 *      own teachers, and lists only those
 *   7. a service constructed without the scope service is not department-wide by
 *      default: it reads the real switch
 *   9. the PD-38 calendar narrows a teacher supervisor under strict scope
 *
 * (4, the switch's boot mirroring, is a unit spec; 8 is the runbook.)
 * Synthetic fixtures only (G-16).
 */
import { randomUUID } from 'node:crypto';
import { PrismaAuditService } from '@platform/audit.service';
import { CommError, CommErrorCode } from '@platform/errors';
import { TeacherScopeService } from '@platform/teacher-scope';
import { SeatPolicyRegistry } from '@communication/seats/seat-policy';
import { LessonService } from '../../src/lessons/lesson.service';
import { SchedulingService } from '../../src/lessons/scheduling.service';
import { LifecycleService } from '../../src/lessons/lifecycle.service';
import { TrialGroupService } from '../../src/lessons/trial-group.service';
import { SupervisionConversationService } from '../../src/supervision/supervision-conversation.service';
import { CardPoster } from '../../src/supervision/card-poster';
import { TeacherFileService } from '../../src/teacher-file/teacher-file.service';
import { TeacherSupervisorService } from '../../src/teacher-supervisors/teacher-supervisor.service';
import { CalendarService } from '../../src/calendar/calendar.service';
import { buildGraph, seed, truncate, Scenario } from './harness';

const g = buildGraph();
const audit = new PrismaAuditService();
const scope = new TeacherScopeService(g.prisma);
const lessons = new LessonService(g.prisma, g.authz, g.conversations, g.outbox, g.config, audit, undefined, undefined, scope);
const supervisionChats = new SupervisionConversationService(g.prisma, g.authz, g.conversations, g.outbox, audit, scope);
const cards = new CardPoster(g.conversations, g.outbox, audit);
const trialGroups = new TrialGroupService(g.prisma, g.authz, g.conversations, g.outbox, cards, g.config, audit);
const scheduling = new SchedulingService(g.prisma, g.authz, g.conversations, lessons, g.outbox, g.config, g.reminders, audit);
const lifecycle = new LifecycleService(g.prisma, g.conversations, lessons, scheduling, g.outbox, g.config, audit, supervisionChats);
const supervisors = new TeacherSupervisorService(g.prisma, g.conversations, new SeatPolicyRegistry(), scope, supervisionChats, trialGroups, audit);
const calendar = new CalendarService(g.prisma, g.conversations, lessons, g.config);

jest.setTimeout(120_000);

let s: Scenario;
let tmgr: string;
let tsupA: string;
let tsupB: string;
let dept: string;

async function code(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (e) {
    if (e instanceof CommError) return e.code;
    throw e;
  }
  throw new Error('expected a refusal, got success');
}

const strict = (on: boolean) =>
  g.prisma.$executeRaw`UPDATE chat.config SET value = ${JSON.stringify(on)}::jsonb WHERE key = 'teacher_supervisor.strict_scope'`;
const teacherScope = async (staffId: string, teacherId: string) =>
  (await g.prisma.$queryRaw<Array<{ v: string | null }>>`SELECT chat.staff_teacher_scope(${staffId}::uuid, ${teacherId}::uuid, now()) AS v`)[0].v;
const assign = (teacherId: string, supervisorId: string) =>
  g.prisma.$executeRawUnsafe(
    `insert into chat.teacher_supervisor_assignment (teacher_id, organization_id, supervisor_id) values ($1::uuid, chat.default_organization_id(), $2::uuid)`,
    teacherId, supervisorId,
  );
const seatedStaff = async (conversationId: string) =>
  (await g.prisma.conversationMember.findMany({ where: { conversationId, leftAt: null, actorKind: 'staff' } })).map((m) => m.actorId).sort();

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
  [tmgr, tsupA, tsupB] = [randomUUID(), randomUUID(), randomUUID()];
  await g.prisma.$executeRawUnsafe(
    `insert into chat.staff (id, name, role, is_active) values ($1::uuid, 'tmgr_h', 'manager', true), ($2::uuid, 'tsup_ha', 'admin', true), ($3::uuid, 'tsup_hb', 'admin', true)`,
    tmgr, tsupA, tsupB,
  );
  [{ id: dept }] = await g.prisma.$queryRawUnsafe<Array<{ id: string }>>(
    `insert into chat.department (kind, display_name, manager_id) values ('teachers', 'teachers', $1::uuid) returning id::text as id`, tmgr,
  );
  await g.prisma.$executeRawUnsafe(
    `insert into chat.department_member (staff_id, organization_id, department_id, position) values
       ($1::uuid, chat.default_organization_id(), $3::uuid, 'supervisor'), ($2::uuid, chat.default_organization_id(), $3::uuid, 'supervisor')`,
    tsupA, tsupB, dept,
  );
});

// ---------------------------------------------------------------------------

describe('1. an assignment never outlives its supervisor\'s place in the department', () => {
  it('a concurrent removal from the department cannot slip past the assignment guard', async () => {
    let release!: () => void;
    const held = new Promise<void>((r) => (release = r));
    // T2 removes tsupB from the department and holds its transaction open.
    const removal = g.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`DELETE FROM chat.department_member WHERE staff_id = ${tsupB}::uuid`;
      await held;
    }, { timeout: 30_000 });
    await new Promise((r) => setTimeout(r, 300));
    // T1 assigns a teacher to tsupB meanwhile.
    const assignment = assign(s.teacherId, tsupB).then(() => 'assigned', (e: Error) => e.message);
    await new Promise((r) => setTimeout(r, 300));
    release();
    await removal;
    expect(await assignment).toMatch(/primary supervisor of the Teachers department/);
  });

  it('the scope re-checks the department: an assignment left behind grants nothing', async () => {
    await assign(s.teacherId, tsupA);
    expect(await teacherScope(tsupA, s.teacherId)).toBe('self');
    await g.prisma.$executeRawUnsafe(`alter table chat.department_member disable trigger department_member_keeps_teacher_assignments`);
    try {
      await g.prisma.$executeRaw`DELETE FROM chat.department_member WHERE staff_id = ${tsupA}::uuid`;
    } finally {
      await g.prisma.$executeRawUnsafe(`alter table chat.department_member enable trigger department_member_keeps_teacher_assignments`);
    }
    expect(await teacherScope(tsupA, s.teacherId)).toBeNull();
  });
});

describe('2. a deactivated supervisor', () => {
  it('leaves their teachers unassigned in the count the Teachers Manager sees', async () => {
    await assign(s.teacherId, tsupA);
    const before = (await supervisors.assignments(tmgr)).unassigned;
    await g.prisma.$executeRaw`UPDATE chat.staff SET is_active = false WHERE id = ${tsupA}::uuid`;
    const view = await supervisors.assignments(tmgr);
    expect(view.unassigned).toBe(before + 1);
    expect(view.teachers.find((t) => t.id === s.teacherId)?.supervisor).toMatchObject({ id: tsupA, isActive: false });
  });
});

describe('3. the move guard', () => {
  it('refuses handing a supervisor\'s department row to someone else while they have teachers', async () => {
    await assign(s.teacherId, tsupA);
    const other = randomUUID();
    await g.prisma.$executeRawUnsafe(`insert into chat.staff (id, name, role, is_active) values ($1::uuid, 'other_h', 'admin', true)`, other);
    await expect(g.prisma.$executeRaw`UPDATE chat.department_member SET staff_id = ${other}::uuid WHERE staff_id = ${tsupA}::uuid`)
      .rejects.toThrow(/reassign this supervisor's teachers/);
  });
});

describe('5. re-seating', () => {
  it('handles an inactive teacher and follows the switch both ways', async () => {
    await assign(s.teacherId, tsupA);
    const chat = await supervisionChats.ensureForTeacher(tmgr, s.teacherId);
    await g.prisma.$executeRaw`UPDATE chat.teacher SET is_active = false WHERE id = ${s.teacherId}::uuid`;
    expect(await seatedStaff(chat.conversationId)).toEqual([tmgr, tsupA, tsupB].sort());

    await strict(true);
    await supervisors.reseatAll();
    expect(await seatedStaff(chat.conversationId)).toEqual([tmgr, tsupA].sort());

    await strict(false);
    await supervisors.reseatAll();
    expect(await seatedStaff(chat.conversationId)).toEqual([tmgr, tsupA, tsupB].sort());
  });
});

describe('6. change of teacher under strict scope', () => {
  it('lists and moves to the supervisor\'s own teachers only', async () => {
    await assign(s.teacherId, tsupA);
    await strict(true);
    const listed = (await lifecycle.candidates(tsupA)).teachers.map((t) => t.id);
    expect(listed).toContain(s.teacherId);
    expect(listed).not.toContain(s.newTeacherId);
    expect(await code(lifecycle.transferPreview(tsupA, s.learnerId, s.newTeacherId))).toBe(CommErrorCode.LESSON_NOT_FOUND);
    expect(await code(lifecycle.transfer(tsupA, s.learnerId, { toTeacherId: s.newTeacherId, reasonCode: 'other' })))
      .toBe(CommErrorCode.LESSON_NOT_FOUND);
    // The Teachers Manager still moves anyone anywhere.
    expect((await lifecycle.candidates(tmgr)).teachers.map((t) => t.id)).toContain(s.newTeacherId);
  });
});

describe('7. no fail-open default', () => {
  it('a LessonService built without the scope service reads the real switch', async () => {
    const bare = new LessonService(g.prisma, g.authz, g.conversations, g.outbox, g.config, audit);
    await assign(s.teacherId, tsupA);
    const id = (await bare.schedule(tmgr, { learnerId: s.learnerId, startsAt: new Date(Date.now() + 3_600_000).toISOString(), endsAt: new Date(Date.now() + 5_400_000).toISOString() })).id;
    await strict(true);
    expect(await code(bare.get(tsupB, id))).toBe(CommErrorCode.LESSON_NOT_FOUND);
  });
});

describe('9. the PD-38 calendar', () => {
  it('narrows a teacher supervisor to their own teachers\' children under strict scope', async () => {
    await assign(s.teacherId, tsupA);
    expect((await calendar.scopeOf(await g.conversations.requireActor(tsupB)))?.kind).toBe('academy');
    await strict(true);
    const b = await calendar.scopeOf(await g.conversations.requireActor(tsupB));
    expect(b).toMatchObject({ kind: 'supervisor' });
    expect(b?.kind === 'supervisor' && b.ownLearners.has(s.learnerId)).toBe(false);
    const a = await calendar.scopeOf(await g.conversations.requireActor(tsupA));
    expect(a?.kind === 'supervisor' && a.ownLearners.has(s.learnerId)).toBe(true);
    expect((await calendar.scopeOf(await g.conversations.requireActor(tmgr)))?.kind).toBe('academy');
  });
});
