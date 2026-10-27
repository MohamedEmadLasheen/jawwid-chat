/**
 * PD-26 amendment, Operations access (owner 2026-10-27): "these pages ... visible
 * to the Operations Supervision team as well, since they will also use them to
 * record teacher delays and excuses" -- the whole page, the Teachers
 * department's rights on it, for the teachers of their families.
 *
 * The seed's PD-8 structure: manager_c runs Operations; admin_a (s.ownerId)
 * supervises both of family_x's children, so teacher_c and teacher_d are hers;
 * admin_b (s.otherAdminId) is in Operations with no charge; teacher_e
 * (s.unrelatedTeacherId) teaches nobody of theirs.
 *
 *   1. an Operations supervisor records lateness and an absence, and decides,
 *      for a teacher of her families -- and gets 404 for any other
 *   2. the lists hold only her teachers
 *   3. the Operations manager: the whole department's families
 *   4. a backup: nothing until the cover is active, then the covered set
 *   5. money and the Teacher File stay where they were
 *   6. leave and complaints, as the Teachers department
 *   7. the database backstop, with the application bypassed
 *
 * Synthetic fixtures only (QA gate G-16).
 */
import { randomUUID } from 'node:crypto';
import { PrismaAuditService } from '@platform/audit.service';
import { CommError, CommErrorCode } from '@platform/errors';
import { LessonService } from '../../src/lessons/lesson.service';
import { SupervisionConversationService } from '../../src/supervision/supervision-conversation.service';
import { CardPoster } from '../../src/supervision/card-poster';
import { LeaveService } from '../../src/leave/leave.service';
import { DisciplineService } from '../../src/discipline/discipline.service';
import { SchedulingService } from '../../src/lessons/scheduling.service';
import { TrialService } from '../../src/lessons/trial.service';
import { LifecycleService } from '../../src/lessons/lifecycle.service';
import { NewStudentsService } from '../../src/new-students/new-students.service';
import { TrialGroupService } from '../../src/lessons/trial-group.service';
import { TeacherFileService } from '../../src/teacher-file/teacher-file.service';
import { TeacherPayrollService } from '../../src/teacher-file/teacher-payroll.service';
import { SupervisionService } from '../../src/lessons/supervision.service';
import { buildGraph, seed, truncate, Scenario } from './harness';

const g = buildGraph();
const audit = new PrismaAuditService();
const lessons = new LessonService(g.prisma, g.authz, g.conversations, g.outbox, g.config, audit);
const supervision = new SupervisionConversationService(g.prisma, g.authz, g.conversations, g.outbox, audit);
const cards = new CardPoster(g.conversations, g.outbox, audit);
const scheduling = new SchedulingService(g.prisma, g.authz, g.conversations, lessons, g.outbox, g.config, g.reminders, audit);
const groups = new TrialGroupService(g.prisma, g.authz, g.conversations, g.outbox, cards, g.config, audit);
const trials = new TrialService(g.prisma, g.conversations, lessons, scheduling, audit, groups, new NewStudentsService(g.prisma));
const leave = new LeaveService(g.prisma, g.conversations, supervision, cards, lessons, audit, trials);
const discipline = new DisciplineService(g.prisma, g.conversations, supervision, cards, lessons, g.outbox, g.config, audit, trials);
const lifecycle = new LifecycleService(g.prisma, g.conversations, lessons, scheduling, g.outbox, g.config, audit, supervision);
const files = new TeacherFileService(g.prisma, g.authz, g.conversations, audit);
const timeline = new SupervisionService(g.prisma, g.conversations, lessons, g.outbox, supervision, audit);
const payroll = new TeacherPayrollService(g.prisma, files, audit, timeline);

// Each test truncates and seeds the database first; on a loaded machine that alone outruns Jest's 5 s default.
jest.setTimeout(120_000);

const HOUR = 3_600_000;
const at = (ms: number) => new Date(Date.now() + ms).toISOString();

let s: Scenario;
let tsupId: string;
let tmgrId: string;
let superId: string;
let today: string;
let slot = 0;

async function code(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (e) {
    if (e instanceof CommError) return e.code;
    throw e;
  }
  throw new Error('expected a refusal, got success');
}

function plusDays(day: string, n: number): string {
  return new Date(Date.parse(`${day}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
}

async function lesson(ms: number): Promise<string> {
  const start = ms + (slot++ % 20) * 40 * 60_000 * (ms < 0 ? -1 : 1);
  return (await lessons.schedule(tsupId, { learnerId: s.learnerId, startsAt: at(start), endsAt: at(start + HOUR / 2) })).id;
}

async function complaint(source: 'management' | 'parent' = 'parent') {
  return files.addEntry(tsupId, s.teacherId, { kind: 'complaint', body: 'Lessons start late.', source });
}

/** The Teachers department (tmgr manages, tsup is a member) and a super admin, opened the bootstrap way. */
async function staffFixtures() {
  await g.prisma.$executeRawUnsafe(
    `insert into chat.staff (id, name, role, is_active) values ($1::uuid, 'tsup_a', 'admin', true), ($2::uuid, 'tmgr_b', 'manager', true)`,
    tsupId,
    tmgrId,
  );
  await g.prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`select set_config('chat.provisioning_super_admin', 'on', true)`);
    await tx.$executeRawUnsafe(`insert into chat.staff (id, name, role, is_active) values ($1::uuid, 'root_c', 'super_admin', true)`, superId);
  });
  const [{ id: dept }] = await g.prisma.$queryRawUnsafe<Array<{ id: string }>>(
    `insert into chat.department (kind, display_name, manager_id) values ('teachers', 'teachers', $1::uuid) returning id::text as id`,
    tmgrId,
  );
  await g.prisma.$executeRawUnsafe(
    `insert into chat.department_member (staff_id, organization_id, department_id, position)
     values ($1::uuid, chat.default_organization_id(), $2::uuid, 'supervisor')`,
    tsupId,
    dept,
  );
}

beforeAll(async () => {
  await g.prisma.$connect();
});
afterAll(async () => {
  await truncate(g.prisma);
  await g.prisma.$disconnect();
});
beforeEach(async () => {
  await truncate(g.prisma);
  slot = 0;
  s = await seed(g.prisma);
  g.coverage.onDutyId = s.ownerId;
  await g.conversations.ensureStudentGroup(s.learnerId, s.ownerId);
  tsupId = randomUUID();
  tmgrId = randomUUID();
  superId = randomUUID();
  await staffFixtures();
  [{ today }] = await g.prisma.$queryRaw<Array<{ today: string }>>`SELECT chat.academy_today()::text AS today`;
});


// ---------------------------------------------------------------------------

const ops = () => s.ownerId;

async function heldLessonOf(): Promise<string> {
  const id = await lesson(-2 * HOUR);
  await lessons.report(s.teacherId, id, { covered: 'Al-Mulk' });
  return id;
}

/** admin_b backs up admin_a, the link active from an hour ago (PD-8; a PD-33 cover is this activation). */
async function activeBackup() {
  const org = (await g.prisma.staff.findUniqueOrThrow({ where: { id: s.ownerId } })).organizationId;
  await g.prisma.$executeRawUnsafe(
    `insert into chat.supervisor_backup (organization_id, primary_id, backup_id, activated_at)
     values ($1::uuid, $2::uuid, $3::uuid, now() - interval '1 hour')`,
    org, s.ownerId, s.otherAdminId,
  );
}

describe('1. an Operations supervisor works on the teachers of her families', () => {
  it('records lateness and an absence, and decides them -- for teacher_c', async () => {
    const late = await discipline.recordLateness(ops(), await heldLessonOf(), { minutes: 15 });
    expect(late.violation).toMatchObject({ kind: 'late', lateMinutes: 15, recordedBy: { id: ops() } });
    const absent = await discipline.recordAbsence(ops(), s.teacherId, { occurredOn: today, note: 'missed the meeting' });
    expect(absent.violation).toMatchObject({ kind: 'absence', recordedBy: { id: ops() } });
    const decided = await discipline.decide(ops(), late.violation.id, { decision: 'warning', note: 'first this month' });
    expect(decided.violation).toMatchObject({ decision: 'warning', decidedBy: { id: ops() } });
  });

  it('teacher_e, who teaches nobody of hers, is not found -- as an unknown id', async () => {
    expect(await code(discipline.recordAbsence(ops(), s.unrelatedTeacherId, { occurredOn: today, note: 'x' }))).toBe(CommErrorCode.DISCIPLINE_NOT_FOUND);
    expect(await code(discipline.recordAbsence(ops(), randomUUID(), { occurredOn: today, note: 'x' }))).toBe(CommErrorCode.DISCIPLINE_NOT_FOUND);
    expect(await code(discipline.teacherMonth(ops(), s.unrelatedTeacherId))).toBe(CommErrorCode.DISCIPLINE_NOT_FOUND);
    expect(await code(timeline.bonus(ops(), s.unrelatedTeacherId, { reason: 'x' }))).toBe(CommErrorCode.LESSON_NOT_FOUND);
  });

  it('a Sales or other staff member outside both departments is still refused', async () => {
    const outsider = randomUUID();
    await g.prisma.$executeRawUnsafe(`insert into chat.staff (id, name, role, is_active) values ($1::uuid, 'admin_z', 'admin', true)`, outsider);
    expect(await code(discipline.list(outsider, {}))).toBe(CommErrorCode.DISCIPLINE_DENIED);
    expect(await code(files.directory(outsider))).toBe(CommErrorCode.TEACHER_FILE_DENIED);
  });
});

describe('2. the page\'s lists hold only her teachers', () => {
  it('violations, the leave overview and the directory', async () => {
    await discipline.recordAbsence(tsupId, s.teacherId, { occurredOn: today, note: 'mine' });
    await discipline.recordAbsence(tsupId, s.unrelatedTeacherId, { occurredOn: today, note: 'not hers' });
    const seen = (await discipline.list(ops(), { state: 'all' })).violations.map((v) => v.teacher.id);
    expect(seen).toEqual([s.teacherId]);
    const overview = (await leave.overview(ops())).teachers.map((t) => t.id).sort();
    expect(overview).toEqual([s.teacherId, s.newTeacherId].sort());
    const dir = await files.directory(ops());
    expect(dir.basis).toBe('operations');
    expect(dir.teachers.map((t) => t.id).sort()).toEqual([s.teacherId, s.newTeacherId].sort());
    expect(dir.access).toEqual({ canWriteSupervision: true, canViewFinance: false });
    // She may handle a complaint herself, besides the Teachers department.
    expect(dir.supervisors.map((p) => p.id)).toEqual(expect.arrayContaining([ops(), tsupId, tmgrId]));
    // The Teachers department's own view is as wide as before.
    expect((await files.directory(tsupId)).teachers.map((t) => t.id)).toEqual(expect.arrayContaining([s.teacherId, s.newTeacherId, s.unrelatedTeacherId]));
  });

  it('held lessons for the lateness picker: her teacher\'s, regular or trial; another\'s is not found', async () => {
    const held = await heldLessonOf();
    expect((await files.heldLessons(ops(), s.teacherId, 'regular')).lessons.map((l) => l.id)).toEqual([held]);
    expect((await files.heldLessons(ops(), s.teacherId, 'trial')).lessons).toEqual([]);
    expect(await code(files.heldLessons(ops(), s.unrelatedTeacherId, 'regular'))).toBe(CommErrorCode.TEACHER_FILE_NOT_FOUND);
    expect(await code(files.heldLessons(ops(), s.teacherId, 'any'))).toBe(CommErrorCode.VALIDATION);
  });
});

describe('3. the Operations manager: the whole department\'s families', () => {
  it('sees and records for every teacher of the department\'s learners, and no other', async () => {
    expect((await files.directory(s.managerId)).teachers.map((t) => t.id).sort()).toEqual([s.teacherId, s.newTeacherId].sort());
    await expect(discipline.recordAbsence(s.managerId, s.newTeacherId, { occurredOn: today, note: 'x' })).resolves.toBeDefined();
    expect(await code(discipline.recordAbsence(s.managerId, s.unrelatedTeacherId, { occurredOn: today, note: 'x' }))).toBe(CommErrorCode.DISCIPLINE_NOT_FOUND);
  });
});

describe('4. a backup works on the covered supervisor\'s teachers, only while the cover is active', () => {
  it('admin_b: nothing, then admin_a\'s set', async () => {
    expect((await files.directory(s.otherAdminId)).teachers).toEqual([]);
    expect(await code(discipline.recordAbsence(s.otherAdminId, s.teacherId, { occurredOn: today, note: 'x' }))).toBe(CommErrorCode.DISCIPLINE_NOT_FOUND);
    await activeBackup();
    expect((await files.directory(s.otherAdminId)).teachers.map((t) => t.id).sort()).toEqual([s.teacherId, s.newTeacherId].sort());
    await expect(discipline.recordAbsence(s.otherAdminId, s.teacherId, { occurredOn: today, note: 'covering' })).resolves.toBeDefined();
  });
});

describe('5. money and the Teacher File stay where they were', () => {
  it('rewards without amounts; no reward amount, no deduction defaults, no payroll, no file', async () => {
    await expect(timeline.bonus(ops(), s.teacherId, { reason: 'Covered a class' })).resolves.toMatchObject({ kind: 'bonus' });
    const rewards = await payroll.rewards(ops());
    expect(rewards.canViewAmounts).toBe(false);
    expect(rewards.rewards.map((r) => r.teacher.id)).toEqual([s.teacherId]);
    expect(rewards.rewards[0]).not.toHaveProperty('amount');
    expect(await code(payroll.recordReward(ops(), s.teacherId, { reason: 'x', amount: '10' }))).toBe(CommErrorCode.TEACHER_FILE_DENIED);
    expect(await code(payroll.deductionDefaults(ops()))).toBe(CommErrorCode.TEACHER_FILE_DENIED);
    expect(await code(payroll.finance(ops(), s.teacherId))).toBe(CommErrorCode.TEACHER_FILE_DENIED);
    expect(await code(files.detail(ops(), s.teacherId))).toBe(CommErrorCode.TEACHER_FILE_DENIED);
    expect(await code(files.list(ops()))).toBe(CommErrorCode.TEACHER_FILE_DENIED);
    expect(await code(files.addEntry(ops(), s.teacherId, { kind: 'monthly_comment', body: 'x', month: today.slice(0, 7) }))).toBe(CommErrorCode.TEACHER_FILE_DENIED);
    expect(await code(files.addEntry(ops(), s.teacherId, { kind: 'day_off', body: 'x', dayOffOn: today }))).toBe(CommErrorCode.TEACHER_FILE_DENIED);
    expect(await code(leave.setAllowance(ops(), s.teacherId, { year: Number(today.slice(0, 4)), days: 21 }))).toBe(CommErrorCode.LEAVE_DENIED);
  });

  it('a deduction she decides is priced from the default exactly as the Teachers department\'s', async () => {
    const org = (await g.prisma.teacher.findUniqueOrThrow({ where: { id: s.teacherId } })).organizationId;
    await g.prisma.teacherPayTerms.create({
      data: { organizationId: org, teacherId: s.teacherId, effectiveMonth: new Date(`${today.slice(0, 7)}-01T00:00:00Z`), salaryType: 'shift', currency: 'EGP', monthlyAmount: '9000', reason: 'contract', createdBy: superId },
    });
    await payroll.setDeductionDefault(superId, { kind: 'deduction_1', currency: 'EGP', amount: '150' });
    const v = await discipline.recordAbsence(ops(), s.teacherId, { occurredOn: today, note: 'x' });
    await discipline.decide(ops(), v.violation.id, { decision: 'deduction_1', note: 'per policy' });
    const priced = await g.prisma.teacherPayAdjustment.findMany({ where: { violationId: v.violation.id } });
    expect(priced.map((a) => [String(a.amount), a.createdBy])).toEqual([['150', ops()]]);
  });
});

describe('6. leave and complaints, with the Teachers department\'s rights', () => {
  it('decides her teacher\'s leave request; not another\'s', async () => {
    const req = await leave.request(s.teacherId, { firstDay: plusDays(today, 30), lastDay: plusDays(today, 31), reason: 'family' });
    expect((await leave.list(ops(), { state: 'requested' })).requests.map((r) => r.id)).toEqual([req.request.id]);
    await expect(leave.approve(ops(), req.request.id, {})).resolves.toBeDefined();
  });

  it('records a complaint (she handles it), a follow-up and the resolution; upholds it', async () => {
    const c = await files.addEntry(ops(), s.teacherId, { kind: 'complaint', body: 'Late twice.', source: 'parent' });
    const row = await g.prisma.teacherSupervisionEntry.findUniqueOrThrow({ where: { id: c.id } });
    expect([row.complaintSource, row.handledBy, row.createdBy]).toEqual(['parent', ops(), ops()]);
    await files.addEntry(ops(), s.teacherId, { kind: 'complaint_followup', body: 'Called.', refersTo: c.id });
    const upheld = await discipline.upholdComplaint(ops(), c.id, {});
    expect(upheld.violation).toMatchObject({ kind: 'complaint' });
    await files.addEntry(ops(), s.teacherId, { kind: 'complaint_resolution', body: 'Done.', refersTo: c.id });
    const listed = (await files.complaints(ops(), {})).complaints;
    expect(listed.map((x) => [x.id, x.status])).toEqual([[c.id, 'resolved']]);
    expect(await code(files.addEntry(ops(), s.unrelatedTeacherId, { kind: 'complaint', body: 'x', source: 'parent' }))).toBe(CommErrorCode.TEACHER_FILE_NOT_FOUND);
  });
});

describe('7. the database backstop', () => {
  it('refuses an Operations supervisor\'s write about a teacher not of her families, even with the application bypassed', async () => {
    const org = (await g.prisma.teacher.findUniqueOrThrow({ where: { id: s.teacherId } })).organizationId;
    const base = { organizationId: org, occurredAt: new Date(), month: new Date(0), kind: 'absence', note: 'x', recordedBy: ops() };
    await expect(g.prisma.teacherViolation.create({ data: { ...base, teacherId: s.teacherId } })).resolves.toBeDefined();
    await expect(g.prisma.teacherViolation.create({ data: { ...base, teacherId: s.unrelatedTeacherId } })).rejects.toThrow(/Operations supervisor/);
    await expect(
      g.prisma.teacherSupervisionEntry.create({ data: { organizationId: org, teacherId: s.unrelatedTeacherId, kind: 'note', body: 'x', createdBy: ops() } }),
    ).rejects.toThrow(/Teachers department/);
    // A complaint about her teacher may not be handed to admin_b, who has no charge here.
    await expect(
      g.prisma.teacherSupervisionEntry.create({
        data: { organizationId: org, teacherId: s.teacherId, kind: 'complaint', body: 'x', complaintSource: 'parent', handledBy: s.otherAdminId, createdBy: ops() },
      }),
    ).rejects.toThrow(/handled by the Teachers department/);
    const [{ ok }] = await g.prisma.$queryRaw<Array<{ ok: boolean }>>`
      SELECT chat.may_supervise_teacher(${s.otherAdminId}::uuid, ${s.teacherId}::uuid, ${org}::uuid) AS ok`;
    expect(ok).toBe(false);
  });
});
