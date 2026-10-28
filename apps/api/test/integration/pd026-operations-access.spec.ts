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
 *   8. the scope's time bound: a substitute's lessons tie them for 30 days
 *   9. leave allowance is the Teachers department's: absent for Operations
 *  10. another family's child: hidden, and refused as not found
 *  11. Operations answers a parent's feedback, through the database guard too
 *  12. a parent's complaint is about a family: unknown or another's is hidden
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
import { ParentFeedbackService } from '../../src/teacher-file/parent-feedback.service';
import { buildGraph, seed, truncate, withAssignmentGate, Scenario } from './harness';

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
const feedback = new ParentFeedbackService(g.prisma, g.conversations, files, audit);

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
    const c = await files.addEntry(ops(), s.teacherId, { kind: 'complaint', body: 'Late twice.', source: 'parent', sourceConversationId: await groupOf(s.learnerId) });
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


// ---------------------------------------------------------------------------
// Review of #175 (department head, 2026-10-27)
// ---------------------------------------------------------------------------

const DAY = 24 * HOUR;

/**
 * family_y: another family, supervised by admin_b, whose child learner_n is
 * ALSO taught by teacher_c -- so teacher_c is admin_a's, but learner_n is not.
 */
async function otherFamily() {
  const familyId = randomUUID();
  const parentId = randomUUID();
  const learnerId = randomUUID();
  await g.prisma.$executeRawUnsafe(
    `insert into chat.family (id, display_name, owner_id, language) values ($1::uuid, 'family_y', $2::uuid, 'ar')`,
    familyId,
    s.otherAdminId,
  );
  await g.prisma.$executeRawUnsafe(
    `insert into chat.contact (id, family_id, name, role_preset, can_message, is_active)
     values ($1::uuid, $2::uuid, 'parent_y', 'primary_guardian', true, true)`,
    parentId,
    familyId,
  );
  await withAssignmentGate(
    g.prisma,
    `insert into chat.learner (id, family_id, name, teacher_id)
     values ('${learnerId}'::uuid, '${familyId}'::uuid, 'learner_n', '${s.teacherId}'::uuid)`,
  );
  await g.prisma.$executeRawUnsafe(
    `insert into chat.learner_supervision (learner_id, organization_id, supervisor_id, assigned_by)
     values ($1::uuid, chat.default_organization_id(), $2::uuid, $3::uuid)`,
    learnerId,
    s.otherAdminId,
    s.managerId,
  );
  return { familyId, parentId, learnerId };
}

/** A lesson of learner_n with teacher_c, held three hours ago. */
async function theirHeldLesson(learnerId: string): Promise<string> {
  const id = (await lessons.schedule(tsupId, { learnerId, startsAt: at(-3 * HOUR), endsAt: at(-2.5 * HOUR) })).id;
  await lessons.report(s.teacherId, id, { covered: 'Al-Mulk' });
  return id;
}

const assignLearnerL = (teacher: string) =>
  withAssignmentGate(g.prisma, `update chat.learner set teacher_id = '${teacher}'::uuid where id = '${s.learnerId}'::uuid`);

/**
 * teacher_e taught learner_l `ago` before now (a substitute, before learner_l
 * went back to teacher_c): the learner is reassigned for the insert only.
 */
async function substituteLesson(ago: number) {
  await assignLearnerL(s.unrelatedTeacherId);
  await g.prisma.$executeRawUnsafe(
    `insert into chat.lesson (organization_id, learner_id, teacher_id, starts_at, ends_at, created_by_kind, created_by)
     select l.organization_id, l.id, $2::uuid, now() - $3::interval, now() - $3::interval + interval '30 minutes', 'staff', $4::uuid
       from chat.learner l where l.id = $1::uuid`,
    s.learnerId,
    s.unrelatedTeacherId,
    `${Math.round(ago / 1000)} seconds`,
    tsupId,
  );
  await assignLearnerL(s.teacherId);
}

const directoryOf = async (who: string) => (await files.directory(who)).teachers.map((t) => t.id).sort();

describe('8. the scope\'s time bound (P2-3): a lesson ties its teacher for chat.operations_lesson_window()', () => {
  it('the window is one named constant: 30 days', async () => {
    const [{ w }] = await g.prisma.$queryRaw<Array<{ w: string }>>`SELECT chat.operations_lesson_window()::text AS w`;
    expect(w).toBe('30 days');
  });

  it('an old substitute (40 days ago) is out of scope', async () => {
    await substituteLesson(40 * DAY);
    expect(await directoryOf(ops())).toEqual([s.teacherId, s.newTeacherId].sort());
    expect(await code(discipline.recordAbsence(ops(), s.unrelatedTeacherId, { occurredOn: today, note: 'x' }))).toBe(CommErrorCode.DISCIPLINE_NOT_FOUND);
  });

  it('a recent substitute (10 days ago) is in scope, and the database agrees', async () => {
    await substituteLesson(10 * DAY);
    expect(await directoryOf(ops())).toEqual([s.teacherId, s.newTeacherId, s.unrelatedTeacherId].sort());
    await expect(discipline.recordAbsence(ops(), s.unrelatedTeacherId, { occurredOn: today, note: 'covered for teacher_c' })).resolves.toBeDefined();
  });

  it('a coming lesson ties its teacher; once the academy cancels it, it ties nobody', async () => {
    await assignLearnerL(s.unrelatedTeacherId);
    const coming = (await lessons.schedule(tsupId, { learnerId: s.learnerId, startsAt: at(2 * DAY), endsAt: at(2 * DAY + HOUR / 2) })).id;
    await assignLearnerL(s.teacherId);
    expect(await directoryOf(ops())).toEqual([s.teacherId, s.newTeacherId, s.unrelatedTeacherId].sort());
    await lessons.cancel(tsupId, coming, { reason: 'teacher_e is away' });
    expect(await directoryOf(ops())).toEqual([s.teacherId, s.newTeacherId].sort());
  });
});

describe('9. leave allowance is the Teachers department\'s (P1-1): absent for Operations, at the server', () => {
  it('overview, one teacher\'s leave, and a request\'s balance', async () => {
    const year = Number(today.slice(0, 4));
    await leave.setAllowance(tmgrId, s.teacherId, { year, days: 21 });
    const req = await leave.request(s.teacherId, { firstDay: plusDays(today, 30), lastDay: plusDays(today, 31), reason: 'family' });

    const mine = (await leave.overview(ops())).teachers.find((t) => t.id === s.teacherId);
    expect(mine).toBeDefined();
    for (const field of ['allowance', 'used', 'balance']) expect(mine).not.toHaveProperty(field);
    expect(mine).toMatchObject({ id: s.teacherId, pendingRequests: 1 });

    const one = await leave.teacherLeave(ops(), s.teacherId);
    for (const field of ['allowance', 'used', 'balance', 'allowanceHistory']) expect(one).not.toHaveProperty(field);
    expect(one.requests.map((r) => r.id)).toEqual([req.request.id]);

    const [listed] = (await leave.list(ops(), { state: 'requested' })).requests;
    expect(listed.balance).toBeUndefined();
    expect(JSON.parse(JSON.stringify(listed))).not.toHaveProperty('balance');

    // The Teachers department reads them as before.
    expect((await leave.overview(tsupId)).teachers.find((t) => t.id === s.teacherId)).toMatchObject({ allowance: 21, used: 0, balance: 21 });
    expect(await leave.teacherLeave(tsupId, s.teacherId)).toMatchObject({ allowance: 21, allowanceHistory: [expect.objectContaining({ days: 21 })] });
    expect((await leave.list(tsupId, { state: 'requested' })).requests[0].balance).toBe(21);
  });
});

describe('10. another family\'s child is not hers (P2-4)', () => {
  it('lessons: not in the picker; lateness on one is not found; the database refuses it too', async () => {
    const y = await otherFamily();
    const theirs = await theirHeldLesson(y.learnerId);
    const mine = await heldLessonOf();
    expect((await files.heldLessons(ops(), s.teacherId, 'regular')).lessons.map((l) => l.id)).toEqual([mine]);
    expect((await files.heldLessons(tsupId, s.teacherId, 'regular')).lessons.map((l) => l.id).sort()).toEqual([mine, theirs].sort());
    expect(await code(discipline.recordLateness(ops(), theirs, { minutes: 15 }))).toBe(CommErrorCode.DISCIPLINE_NOT_FOUND);

    const org = (await g.prisma.teacher.findUniqueOrThrow({ where: { id: s.teacherId } })).organizationId;
    await expect(
      g.prisma.teacherViolation.create({
        data: { organizationId: org, teacherId: s.teacherId, lessonId: theirs, kind: 'late', lateMinutes: 15, occurredAt: new Date(), month: new Date(0), recordedBy: ops() },
      }),
    ).rejects.toThrow(/Operations supervisor of the lesson's child/);
  });

  it('violations: another family\'s lateness is neither listed nor decided; teacher-level ones are', async () => {
    const y = await otherFamily();
    const late = await discipline.recordLateness(tsupId, await theirHeldLesson(y.learnerId), { minutes: 15 });
    const absent = await discipline.recordAbsence(tsupId, s.teacherId, { occurredOn: today, note: 'a staff meeting' });
    expect((await discipline.list(ops(), { state: 'all' })).violations.map((v) => v.id)).toEqual([absent.violation.id]);
    const month = await discipline.teacherMonth(ops(), s.teacherId);
    expect(month.violations.map((v) => v.id)).toEqual([absent.violation.id]);
    // The ladder is the teacher's: what counts is the same for both callers.
    expect(month.counted).toBe((await discipline.teacherMonth(tsupId, s.teacherId)).counted);
    expect(await code(discipline.decide(ops(), late.violation.id, { decision: 'warning' }))).toBe(CommErrorCode.DISCIPLINE_NOT_FOUND);
    expect((await discipline.list(tsupId, { state: 'all' })).violations.map((v) => v.id).sort()).toEqual([late.violation.id, absent.violation.id].sort());
  });

  it('complaints and feedback: another family\'s are hidden and not found; management\'s show', async () => {
    const y = await otherFamily();
    const theirs = await feedback.file(y.parentId, { learnerId: y.learnerId, category: 'complaint', body: 'Too fast.' });
    const ours = await feedback.file(s.parentId, { learnerId: s.learnerId, category: 'praise', body: 'Thank you.' });
    const management = await complaint('management');
    const entry = await g.prisma.teacherSupervisionEntry.findFirstOrThrow({ where: { parentFeedbackId: theirs.id } });

    expect((await files.complaints(ops(), {})).complaints.map((c) => c.id)).toEqual([management.id]);
    expect((await files.complaints(tsupId, {})).complaints.map((c) => c.id).sort()).toEqual([management.id, entry.id].sort());
    expect(await code(files.addEntry(ops(), s.teacherId, { kind: 'complaint_followup', body: 'Called.', refersTo: entry.id }))).toBe(CommErrorCode.TEACHER_FILE_NOT_FOUND);
    expect(await code(discipline.upholdComplaint(ops(), entry.id, {}))).toBe(CommErrorCode.DISCIPLINE_NOT_FOUND);
    await expect(files.addEntry(ops(), s.teacherId, { kind: 'complaint_followup', body: 'Talked to teacher_c.', refersTo: management.id })).resolves.toBeDefined();

    expect((await feedback.list(ops(), {})).feedback.map((f) => f.id)).toEqual([ours.id]);
    expect(await code(feedback.take(ops(), theirs.id))).toBe(CommErrorCode.FEEDBACK_NOT_FOUND);
    expect(await code(feedback.reply(ops(), theirs.id, { response: 'Sorry.' }))).toBe(CommErrorCode.FEEDBACK_NOT_FOUND);
  });
});

describe('11. Operations answers a parent\'s feedback (P1-2)', () => {
  it('her family\'s: the reply is written, through chat.guard_parent_feedback', async () => {
    const praise = await feedback.file(s.parentId, { learnerId: s.learnerId, category: 'praise', body: 'Thank you.' });
    const replied = await feedback.reply(ops(), praise.id, { response: 'Thank you, we told the teacher.' });
    expect(replied).toMatchObject({ id: praise.id });
    const row = await g.prisma.parentFeedback.findUniqueOrThrow({ where: { id: praise.id } });
    expect([row.respondedBy, row.parentResponse]).toEqual([ops(), 'Thank you, we told the teacher.']);
  });

  it('another family\'s: the database refuses, with the application bypassed', async () => {
    const y = await otherFamily();
    const theirs = await feedback.file(y.parentId, { learnerId: y.learnerId, category: 'praise', body: 'Thank you.' });
    await expect(
      g.prisma.parentFeedback.update({ where: { id: theirs.id }, data: { respondedBy: ops(), parentResponse: 'x', respondedAt: new Date() } }),
    ).rejects.toThrow(/child's Operations supervisor/);
    // admin_b, who supervises learner_n, may.
    await expect(
      g.prisma.parentFeedback.update({ where: { id: theirs.id }, data: { respondedBy: s.otherAdminId, parentResponse: 'x', respondedAt: new Date() } }),
    ).resolves.toBeDefined();
  });
});

/** The learner's student group (family_x's is opened in beforeEach with admin_a; family_y's with admin_b). */
async function groupOf(learnerId: string): Promise<string> {
  return (await g.prisma.conversation.findFirstOrThrow({ where: { type: 'student_group', learnerId }, select: { id: true } })).id;
}

describe('12. a parent\'s complaint is about a family (re-review, P2-A)', () => {
  it('one with no family (no source conversation) is hidden and not found to Operations; the Teachers department works it', async () => {
    const c = await complaint('parent');
    expect((await files.complaints(ops(), {})).complaints.map((x) => x.id)).toEqual([]);
    expect(await code(files.addEntry(ops(), s.teacherId, { kind: 'complaint_followup', body: 'Called.', refersTo: c.id }))).toBe(CommErrorCode.TEACHER_FILE_NOT_FOUND);
    expect(await code(files.addEntry(ops(), s.teacherId, { kind: 'complaint_resolution', body: 'Done.', refersTo: c.id }))).toBe(CommErrorCode.TEACHER_FILE_NOT_FOUND);
    expect(await code(discipline.upholdComplaint(ops(), c.id, {}))).toBe(CommErrorCode.DISCIPLINE_NOT_FOUND);
    expect((await files.complaints(tsupId, {})).complaints.map((x) => x.id)).toEqual([c.id]);
    await expect(discipline.upholdComplaint(tsupId, c.id, {})).resolves.toBeDefined();
    // The upheld violation carries the complaint's text: hidden from her as well.
    expect((await discipline.list(ops(), { state: 'all' })).violations).toEqual([]);
  });

  it('the family comes from the source conversation: her family\'s shows, another family\'s does not', async () => {
    const y = await otherFamily();
    await g.conversations.ensureStudentGroup(y.learnerId, s.otherAdminId);
    // Each filed by the family's own Operations supervisor, from that family's group.
    const file = async (by: string, learnerId: string) =>
      files.addEntry(by, s.teacherId, { kind: 'complaint', body: 'Started late.', source: 'parent', sourceConversationId: await groupOf(learnerId) });
    const ours = await file(ops(), s.learnerId);
    const theirs = await file(s.otherAdminId, y.learnerId);
    expect((await files.complaints(s.otherAdminId, {})).complaints.map((x) => x.id)).toEqual([theirs.id]);
    expect((await files.complaints(ops(), {})).complaints.map((x) => x.id)).toEqual([ours.id]);
    await expect(files.addEntry(ops(), s.teacherId, { kind: 'complaint_followup', body: 'Called.', refersTo: ours.id })).resolves.toBeDefined();
    expect(await code(files.addEntry(ops(), s.teacherId, { kind: 'complaint_followup', body: 'Called.', refersTo: theirs.id }))).toBe(CommErrorCode.TEACHER_FILE_NOT_FOUND);
    expect(await code(discipline.upholdComplaint(ops(), theirs.id, {}))).toBe(CommErrorCode.DISCIPLINE_NOT_FOUND);
  });

  it('Operations files a parent\'s complaint only from a conversation with her family; management\'s needs none', async () => {
    // The page's directory offers her own families' chats for it, and marks whose complaints need one.
    const dir = await files.directory(ops());
    expect(dir.familyChats).toEqual([{ conversationId: await groupOf(s.learnerId), learnerName: 'learner_l' }]);
    expect(dir.teachers.every((t) => t.operationsOnly)).toBe(true);
    const theirs = await files.directory(tsupId);
    expect([theirs.familyChats, theirs.teachers.some((t) => t.operationsOnly)]).toEqual([[], false]);

    expect(await code(files.addEntry(ops(), s.teacherId, { kind: 'complaint', body: 'x', source: 'parent' }))).toBe(CommErrorCode.VALIDATION);
    await expect(files.addEntry(ops(), s.teacherId, { kind: 'complaint', body: 'x', source: 'management' })).resolves.toBeDefined();
    const y = await otherFamily();
    await g.conversations.ensureStudentGroup(y.learnerId, s.otherAdminId);
    expect(await code(files.addEntry(ops(), s.teacherId, { kind: 'complaint', body: 'x', source: 'parent', sourceConversationId: await groupOf(y.learnerId) }))).toBe(CommErrorCode.VALIDATION);
    await expect(
      files.addEntry(ops(), s.teacherId, { kind: 'complaint', body: 'x', source: 'parent', sourceConversationId: await groupOf(s.learnerId) }),
    ).resolves.toBeDefined();
  });
});

describe('13. leave responses, as Operations reads them (re-review)', () => {
  it('approve, decline and cancel answer without a balance', async () => {
    const year = Number(today.slice(0, 4));
    await leave.setAllowance(tmgrId, s.teacherId, { year, days: 21 });
    const a = await leave.request(s.teacherId, { firstDay: plusDays(today, 40), lastDay: plusDays(today, 41), reason: 'family' });
    const b = await leave.request(s.teacherId, { firstDay: plusDays(today, 50), lastDay: plusDays(today, 51), reason: 'family' });
    const answers = [
      (await leave.approve(ops(), a.request.id, {})).request,
      (await leave.decline(ops(), b.request.id, { note: 'busy week' })).request,
      (await leave.cancel(ops(), a.request.id, { note: 'plans changed' })).request,
    ];
    for (const r of answers) expect(JSON.parse(JSON.stringify(r))).not.toHaveProperty('balance');
  });

  it('a colliding lesson of another family comes without the child\'s name; hers is named', async () => {
    const y = await otherFamily();
    await lessons.schedule(tsupId, { learnerId: s.learnerId, startsAt: at(30 * DAY), endsAt: at(30 * DAY + HOUR / 2) });
    await lessons.schedule(tsupId, { learnerId: y.learnerId, startsAt: at(30 * DAY + 2 * HOUR), endsAt: at(30 * DAY + 2.5 * HOUR) });
    await leave.request(s.teacherId, { firstDay: plusDays(today, 29), lastDay: plusDays(today, 32), reason: 'family' });
    const [mine] = (await leave.list(ops(), { state: 'requested' })).requests;
    expect(mine.collidingLessons?.map((l) => l.learnerName)).toEqual(['learner_l', null]);
    const [theirs] = (await leave.list(tsupId, { state: 'requested' })).requests;
    expect(theirs.collidingLessons?.map((l) => l.learnerName)).toEqual(['learner_l', 'learner_n']);
  });
});
