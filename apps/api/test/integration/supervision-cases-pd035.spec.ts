/**
 * PD-35 B5 -- escalation cases (chat.supervision_case).
 *
 *   open      anyone with teacher or lesson scope on the subject (a teacher,
 *             a lesson, a learner, a complaint, a parent's feedback --
 *             'feedback': PD-32 keeps its table in src/teacher-file), to the
 *             Teachers or the Operations department; the owner defaults to
 *             that department's manager
 *   see       the opener, the owner, the target department's manager, the
 *             super admin -- anyone else reads it as not found
 *   act       the owner, the target department's manager, the super admin:
 *             assign (within the target department), status, due date, notes
 *   record    every change is one chat.supervision_case_event, written by the
 *             database in the same transaction; nothing is ever deleted
 *   PD-34     case.opened / case.assigned / case.due_soon go to the outbox for
 *             PD-34 to deliver; B5 sends nothing itself
 *
 * Synthetic fixtures only (G-16).
 */
import { randomUUID } from 'node:crypto';
import { PrismaAuditService } from '@platform/audit.service';
import { CommError, CommErrorCode } from '@platform/errors';
import { TeacherScopeService } from '@platform/teacher-scope';
import { LessonService } from '../../src/lessons/lesson.service';
import { SupervisionCaseService } from '../../src/cases/supervision-case.service';
import { TeacherFileService } from '../../src/teacher-file/teacher-file.service';
import { ParentFeedbackService } from '../../src/teacher-file/parent-feedback.service';
import { buildGraph, seed, truncate, Scenario } from './harness';

const g = buildGraph();
const audit = new PrismaAuditService();
const scope = new TeacherScopeService(g.prisma);
const lessons = new LessonService(g.prisma, g.authz, g.conversations, g.outbox, g.config, audit, undefined, undefined, scope);
const files = new TeacherFileService(g.prisma, g.authz, g.conversations, audit, scope);
const feedback = new ParentFeedbackService(g.prisma, g.conversations, files, audit);
const cases = new SupervisionCaseService(g.prisma, g.conversations, lessons, g.authz, g.outbox, audit, feedback);

jest.setTimeout(120_000);

let s: Scenario;
let tmgr: string;
let tsupA: string;
let tsupB: string;
let sa: string;

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
const outbox = async (type: string) =>
  (await g.prisma.outboxEvent.findMany({ where: { type }, orderBy: { createdAt: 'asc' } })).map((r) => r.payload as Record<string, unknown>);
const events = async (caseId: string) =>
  (await g.prisma.$queryRaw<Array<{ kind: string; actor_id: string }>>`
    SELECT kind, actor_id::text AS actor_id FROM chat.supervision_case_event WHERE case_id = ${caseId}::uuid ORDER BY at, id`).map((e) => e.kind);
const teacherCase = (by: string, extra: Record<string, unknown> = {}) =>
  cases.open(by, { subject: { kind: 'teacher', id: s.teacherId }, target: 'teachers', title: 'late reports again', body: 'three this week', ...extra });

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
  [tmgr, tsupA, tsupB, sa] = [randomUUID(), randomUUID(), randomUUID(), randomUUID()];
  await g.prisma.$executeRawUnsafe(
    `insert into chat.staff (id, name, role, is_active) values
       ($1::uuid, 'tmgr_c', 'manager', true), ($2::uuid, 'tsup_ca', 'admin', true), ($3::uuid, 'tsup_cb', 'admin', true)`,
    tmgr, tsupA, tsupB,
  );
  // super_admin exists only through the bootstrap gate (20261013120000).
  await g.prisma.$transaction([
    g.prisma.$executeRawUnsafe(`select set_config('chat.provisioning_super_admin', 'on', true)`),
    g.prisma.$executeRawUnsafe(`insert into chat.staff (id, name, role, is_active) values ($1::uuid, 'sa_c', 'super_admin', true)`, sa),
  ]);
  const [{ id: dept }] = await g.prisma.$queryRawUnsafe<Array<{ id: string }>>(
    `insert into chat.department (kind, display_name, manager_id) values ('teachers', 'teachers', $1::uuid) returning id::text as id`, tmgr,
  );
  await g.prisma.$executeRawUnsafe(
    `insert into chat.department_member (staff_id, organization_id, department_id, position) values
       ($1::uuid, chat.default_organization_id(), $3::uuid, 'supervisor'), ($2::uuid, chat.default_organization_id(), $3::uuid, 'supervisor')`,
    tsupA, tsupB, dept,
  );
  await g.prisma.$executeRawUnsafe(
    `insert into chat.teacher_supervisor_assignment (teacher_id, organization_id, supervisor_id) values ($1::uuid, chat.default_organization_id(), $2::uuid)`,
    s.teacherId, tsupA,
  );
});

// ---------------------------------------------------------------------------

describe('opening a case', () => {
  it('a teacher supervisor escalates about their teacher to the Teachers Manager, who owns it by default', async () => {
    const c = await teacherCase(tsupA, { dueOn: null });
    expect(c).toMatchObject({
      status: 'open',
      target: 'teachers',
      subject: { kind: 'teacher', id: s.teacherId },
      teacher: { id: s.teacherId },
      owner: { id: tmgr },
      openedBy: { id: tsupA },
      title: 'late reports again',
    });
    expect(await events(c.id)).toEqual(['opened']);
    expect(await outbox('case.opened')).toEqual([expect.objectContaining({ caseId: c.id, ownerId: tmgr, openedBy: tsupA })]);
  });

  it('under strict scope only about their own teacher; another teacher reads as not found', async () => {
    await strict(true);
    expect((await teacherCase(tsupA)).owner?.id).toBe(tmgr);
    expect(await code(teacherCase(tsupB))).toBe(CommErrorCode.CASE_NOT_FOUND);
    await strict(false);
    expect((await teacherCase(tsupB)).openedBy.id).toBe(tsupB);
  });

  it('an Operations supervisor escalates about their own child to the Operations Manager, never about another\'s', async () => {
    const c = await cases.open(s.ownerId, { subject: { kind: 'learner', id: s.learnerId }, target: 'operations', title: 'missed payments and lessons' });
    expect(c).toMatchObject({ target: 'operations', owner: { id: s.managerId }, learner: { id: s.learnerId }, teacher: { id: s.teacherId } });
    expect(await code(cases.open(s.otherAdminId, { subject: { kind: 'learner', id: s.learnerId }, target: 'operations', title: 'x' })))
      .toBe(CommErrorCode.CASE_NOT_FOUND);
  });

  it('a complaint is a subject too, and names its teacher', async () => {
    const [{ id: entry }] = await g.prisma.$queryRawUnsafe<Array<{ id: string }>>(
      `insert into chat.teacher_supervision_entry (organization_id, teacher_id, kind, body, created_by, complaint_source)
       values (chat.default_organization_id(), $1::uuid, 'complaint', 'rude to the child', $2::uuid, 'management') returning id::text as id`,
      s.teacherId, tmgr,
    );
    const c = await cases.open(tsupA, { subject: { kind: 'complaint', id: entry }, target: 'teachers', title: 'complaint not settling' });
    expect(c).toMatchObject({ subject: { kind: 'complaint', id: entry }, teacher: { id: s.teacherId } });
    // An Operations supervisor has no standing to a teacher's complaint.
    expect(await code(cases.open(s.ownerId, { subject: { kind: 'complaint', id: entry }, target: 'operations', title: 'x' })))
      .toBe(CommErrorCode.CASE_NOT_FOUND);
  });

  it('a parent\'s feedback is a subject through the Teacher File, by its ids only', async () => {
    const [{ id: fb }] = await g.prisma.$queryRawUnsafe<Array<{ id: string }>>(
      `insert into chat.parent_feedback (organization_id, family_id, contact_id, learner_id, teacher_id, category, body)
       values (chat.default_organization_id(), $1::uuid, $2::uuid, $3::uuid, $4::uuid, 'complaint', 'the lesson started late') returning id::text as id`,
      s.familyId, s.parentId, s.learnerId, s.teacherId,
    );
    const c = await cases.open(tsupA, { subject: { kind: 'feedback', id: fb }, target: 'teachers', title: 'parent unhappy' });
    expect(c).toMatchObject({ subject: { kind: 'feedback', id: fb }, teacher: { id: s.teacherId }, learner: { id: s.learnerId } });
    expect(JSON.stringify(c)).not.toContain('started late');
    await strict(true);
    expect(await code(cases.open(tsupB, { subject: { kind: 'feedback', id: fb }, target: 'teachers', title: 'x' }))).toBe(CommErrorCode.CASE_NOT_FOUND);
  });

  it('refuses a bad request: no title, an unknown target, a past due date', async () => {
    expect(await code(teacherCase(tsupA, { title: '  ' }))).toBe(CommErrorCode.CASE_INVALID);
    expect(await code(teacherCase(tsupA, { target: 'sales' }))).toBe(CommErrorCode.CASE_INVALID);
    expect(await code(teacherCase(tsupA, { dueOn: '2020-01-01' }))).toBe(CommErrorCode.CASE_INVALID);
  });
});

describe('who sees a case', () => {
  it('the opener, the owner, the target manager and the super admin; anyone else reads it as not found', async () => {
    const c = await teacherCase(tsupA);
    for (const who of [tsupA, tmgr, sa]) expect((await cases.get(who, c.id)).id).toBe(c.id);
    for (const who of [tsupB, s.managerId, s.ownerId]) expect(await code(cases.get(who, c.id))).toBe(CommErrorCode.CASE_NOT_FOUND);
  });

  it('lists Mine, Opened by me and My department', async () => {
    const c = await teacherCase(tsupA);
    expect((await cases.list(tmgr, { tab: 'mine' })).cases.map((x) => x.id)).toEqual([c.id]);
    expect((await cases.list(tsupA, { tab: 'opened' })).cases.map((x) => x.id)).toEqual([c.id]);
    expect((await cases.list(tmgr, { tab: 'department' })).cases.map((x) => x.id)).toEqual([c.id]);
    expect((await cases.list(tsupB, { tab: 'department' })).cases).toEqual([]);
    expect((await cases.list(s.managerId, { tab: 'department' })).cases).toEqual([]);
  });
});

describe('acting on a case', () => {
  it('the owner moves it on; the opener may not; every change is one event; a closed case stays closed', async () => {
    const c = await teacherCase(tsupA);
    expect(await code(cases.setStatus(tsupA, c.id, { status: 'in_progress' }))).toBe(CommErrorCode.CASE_DENIED);
    await cases.setStatus(tmgr, c.id, { status: 'in_progress' });
    await cases.note(tmgr, c.id, { note: 'spoke to the teacher' });
    expect(await code(cases.setStatus(tmgr, c.id, { status: 'resolved' }))).toBe(CommErrorCode.CASE_INVALID); // needs a note
    const done = await cases.setStatus(tmgr, c.id, { status: 'resolved', note: 'reports on time for two weeks' });
    expect(done.status).toBe('resolved');
    expect(done.closedAt).not.toBeNull();
    expect(await code(cases.setStatus(sa, c.id, { status: 'in_progress' }))).toBe(CommErrorCode.CASE_STATE);
    expect(await events(c.id)).toEqual(['opened', 'status', 'note', 'status']);
    const detail = await cases.get(tsupA, c.id);
    expect(detail.events.map((e) => e.kind)).toEqual(['opened', 'status', 'note', 'status']);
    expect(detail.canAct).toBe(false);
    expect((await cases.get(tmgr, c.id)).canAct).toBe(true);
  });

  it('assigns within the target department only, and tells PD-34', async () => {
    const c = await teacherCase(tsupA);
    expect(await code(cases.assign(tmgr, c.id, { ownerId: s.ownerId }))).toBe(CommErrorCode.CASE_INVALID);
    const moved = await cases.assign(tmgr, c.id, { ownerId: tsupB });
    expect(moved.owner?.id).toBe(tsupB);
    expect(await outbox('case.assigned')).toEqual([expect.objectContaining({ caseId: c.id, ownerId: tsupB, previousOwnerId: tmgr })]);
    // The new owner sees and acts on it; the opener still sees it.
    expect((await cases.get(tsupB, c.id)).canAct).toBe(true);
    expect((await cases.get(tsupA, c.id)).id).toBe(c.id);
    expect(await events(c.id)).toEqual(['opened', 'assigned']);
  });

  it('a due date: set, moved and cleared, each an event', async () => {
    const c = await teacherCase(tsupA);
    const [{ d }] = await g.prisma.$queryRaw<Array<{ d: string }>>`SELECT (chat.academy_today() + 7)::text AS d`;
    expect((await cases.setDue(tmgr, c.id, { dueOn: d })).dueOn).toBe(d);
    expect((await cases.setDue(tmgr, c.id, { dueOn: null })).dueOn).toBeNull();
    expect(await events(c.id)).toEqual(['opened', 'due', 'due']);
  });
});

describe('due soon', () => {
  it('a case due tomorrow is announced once; a new due date announces again', async () => {
    const c = await teacherCase(tsupA);
    const [{ d1, d2 }] = await g.prisma.$queryRaw<Array<{ d1: string; d2: string }>>`
      SELECT (chat.academy_today() + 1)::text AS d1, chat.academy_today()::text AS d2`;
    await cases.setDue(tmgr, c.id, { dueOn: d1 });
    await cases.sweepDueSoon();
    await cases.sweepDueSoon();
    expect(await outbox('case.due_soon')).toEqual([expect.objectContaining({ caseId: c.id, ownerId: tmgr, dueOn: d1 })]);
    await cases.setDue(tmgr, c.id, { dueOn: d2 });
    await cases.sweepDueSoon();
    expect((await outbox('case.due_soon')).map((p) => p.dueOn)).toEqual([d1, d2]);
    // A closed case is never announced.
    await cases.setStatus(tmgr, c.id, { status: 'cancelled', note: 'duplicate' });
    await g.prisma.$executeRaw`DELETE FROM chat.supervision_case_due_notice`;
    await cases.sweepDueSoon();
    expect(await outbox('case.due_soon')).toHaveLength(2);
  });
});

describe('the database keeps the record', () => {
  it('refuses a change without an actor, a delete, and any edit of an event', async () => {
    const c = await teacherCase(tsupA);
    await expect(g.prisma.$executeRaw`UPDATE chat.supervision_case SET status = 'in_progress' WHERE id = ${c.id}::uuid`)
      .rejects.toThrow(/actor/);
    await expect(g.prisma.$executeRaw`DELETE FROM chat.supervision_case WHERE id = ${c.id}::uuid`).rejects.toThrow(/never deleted/);
    await expect(g.prisma.$executeRaw`UPDATE chat.supervision_case_event SET note = 'x' WHERE case_id = ${c.id}::uuid`).rejects.toThrow();
    await expect(g.prisma.$executeRaw`DELETE FROM chat.supervision_case_event WHERE case_id = ${c.id}::uuid`).rejects.toThrow();
  });

  it('refuses an owner outside the target department, even written directly', async () => {
    const c = await teacherCase(tsupA);
    await expect(
      g.prisma.$transaction([
        g.prisma.$executeRawUnsafe(`select set_config('chat.case_actor', $1, true)`, tmgr),
        g.prisma.$executeRawUnsafe(`update chat.supervision_case set owner_id = $1::uuid where id = $2::uuid`, s.ownerId, c.id),
      ]),
    ).rejects.toThrow(/target department/);
  });
});
