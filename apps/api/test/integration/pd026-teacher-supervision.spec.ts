/**
 * PD-26 -- the Teacher Supervision page.
 *
 *   1. an absence with no lesson: recorded by the Teachers department, with a
 *      note, once it has happened; it joins the month's ladder
 *   2. an upheld complaint joins the same ladder, once; the complaint reads
 *      open -> upheld -> actioned -> resolved, with its source, handler and
 *      follow-ups
 *   3. a deduction is priced the moment it is decided, from the super admin's
 *      default for the teacher's pay currency; no default leaves it unpriced
 *   4. away: leave and suspension are computed from the days off; staff read
 *      why, a parent reads "leave" or "away"; a transfer to a teacher on leave
 *      is refused; the overview shows a blank balance and still the leave
 *   5. lateness says whether the lesson was a trial
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
const payroll = new TeacherPayrollService(g.prisma, files, audit);

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

describe('1. an absence with no lesson', () => {
  it('is recorded with a note, lists among absences with no lesson, and takes its place on the ladder', async () => {
    const first = await discipline.recordAbsence(tsupId, s.teacherId, { occurredOn: today, note: 'missed the staff meeting' });
    expect(first.violation).toMatchObject({ kind: 'absence', lesson: null, step: 1, suggestedDecision: 'warning', note: 'missed the staff meeting' });

    const missed = await lesson(-2 * HOUR);
    await lessons.teacherNoShow(tsupId, missed, { note: 'did not join' });

    const listed = (await discipline.list(tsupId, { kind: 'absences', state: 'all' })).violations;
    expect(listed.map((v) => v.kind).sort()).toEqual(['absence', 'teacher_no_show']);
    expect((await discipline.list(tsupId, { kind: 'late', state: 'all' })).violations).toEqual([]);
  });

  it('needs a note, a past or present day, and the Teachers department', async () => {
    expect(await code(discipline.recordAbsence(tsupId, s.teacherId, { occurredOn: today }))).toBe(CommErrorCode.VALIDATION);
    expect(await code(discipline.recordAbsence(tsupId, s.teacherId, { occurredOn: plusDays(today, 2), note: 'x' }))).toBe(
      CommErrorCode.DISCIPLINE_STATE,
    );
    expect(await code(discipline.recordAbsence(s.ownerId, s.teacherId, { occurredOn: today, note: 'x' }))).toBe(
      CommErrorCode.DISCIPLINE_DENIED,
    );
  });

  it('the database refuses an absence without a note or a recorder, and a lesson incident without its lesson', async () => {
    const base = { organizationId: (await g.prisma.teacher.findUniqueOrThrow({ where: { id: s.teacherId } })).organizationId, teacherId: s.teacherId, occurredAt: new Date(), month: new Date(0) };
    await expect(g.prisma.teacherViolation.create({ data: { ...base, kind: 'absence', recordedBy: tsupId } })).rejects.toThrow(/lesson_shape/);
    await expect(g.prisma.teacherViolation.create({ data: { ...base, kind: 'absence', note: 'x' } })).rejects.toThrow(/lesson_shape/);
    await expect(g.prisma.teacherViolation.create({ data: { ...base, kind: 'teacher_no_show', recordedBy: tsupId } })).rejects.toThrow(/lesson_shape/);
    await expect(
      g.prisma.teacherViolation.create({ data: { ...base, kind: 'absence', note: 'x', recordedBy: s.ownerId } }),
    ).rejects.toThrow(/Teachers department/);
  });
});

describe('2. an upheld complaint joins the ladder', () => {
  it('counts after the month\'s other violations; the complaint reads open, upheld, actioned, resolved', async () => {
    await discipline.recordAbsence(tsupId, s.teacherId, { occurredOn: today, note: 'missed the meeting' });
    const c = await complaint('parent');
    let file = await files.detail(tsupId, s.teacherId);
    expect(file.supervision.complaints[0]).toMatchObject({ id: c.id, from: 'parent', handledBy: { id: tsupId }, status: 'open', action: null });

    const upheld = await discipline.upholdComplaint(tmgrId, c.id, { note: 'confirmed with the family' });
    expect(upheld.violation).toMatchObject({ kind: 'complaint', lesson: null, step: 2, suggestedDecision: 'deduction_1', complaint: { id: c.id, from: 'parent' } });
    expect(await code(discipline.upholdComplaint(tmgrId, c.id, {}))).toBe(CommErrorCode.DISCIPLINE_STATE);
    file = await files.detail(tsupId, s.teacherId);
    expect(file.supervision.complaints[0].status).toBe('upheld');

    await discipline.decide(tmgrId, upheld.violation.id, { decision: 'deduction_1' });
    file = await files.detail(tsupId, s.teacherId);
    expect(file.supervision.complaints[0]).toMatchObject({ status: 'actioned', action: { decision: 'deduction_1' } });
    expect(file.history.deductions.map((d) => d.violation)).toEqual(['complaint']);

    await files.addEntry(tsupId, s.teacherId, { kind: 'complaint_followup', body: 'Called the parent.', refersTo: c.id });
    await files.addEntry(tsupId, s.teacherId, { kind: 'complaint_followup', body: 'On time since.', refersTo: c.id });
    await files.addEntry(tmgrId, s.teacherId, { kind: 'complaint_resolution', body: 'Closed.', refersTo: c.id });
    file = await files.detail(tsupId, s.teacherId);
    expect(file.supervision.complaints[0]).toMatchObject({ status: 'resolved', resolution: { body: 'Closed.' } });
    expect(file.supervision.complaints[0].followUps.map((f) => f.body)).toEqual(['Called the parent.', 'On time since.']);
    expect((await files.list(tsupId)).teachers.find((t) => t.id === s.teacherId)?.openComplaints).toBe(0);

    // The Supervision page's list: the same shape, with the teacher, by source and status.
    const fromParents = await files.complaints(tsupId, { from: 'parent' });
    expect(fromParents.complaints.map((x) => [x.id, x.teacher.name, x.status, x.followUps.length])).toEqual([[c.id, 'teacher_c', 'resolved', 2]]);
    expect((await files.complaints(tsupId, { from: 'management' })).complaints).toEqual([]);
    expect((await files.complaints(tsupId, { status: 'open' })).complaints).toEqual([]);
    expect(await code(files.complaints(s.ownerId, {}))).toBe(CommErrorCode.TEACHER_FILE_DENIED);
  });

  it('a follow-up does not resolve a complaint; a second resolution is still refused', async () => {
    const c = await complaint('management');
    await files.addEntry(tsupId, s.teacherId, { kind: 'complaint_followup', body: 'Watching.', refersTo: c.id });
    expect((await files.list(tsupId)).teachers.find((t) => t.id === s.teacherId)?.openComplaints).toBe(1);
    await files.addEntry(tsupId, s.teacherId, { kind: 'complaint_resolution', body: 'Done.', refersTo: c.id });
    expect(await code(files.addEntry(tsupId, s.teacherId, { kind: 'complaint_resolution', body: 'Again.', refersTo: c.id }))).toBe(
      CommErrorCode.TEACHER_FILE_CONFLICT,
    );
  });

  it('a complaint is handled by the Teachers department only', async () => {
    expect(
      await code(files.addEntry(tsupId, s.teacherId, { kind: 'complaint', body: 'x', source: 'management', handledBy: s.ownerId })),
    ).toBe(CommErrorCode.TEACHER_FILE_CONFLICT);
    const ok = await files.addEntry(tsupId, s.teacherId, { kind: 'complaint', body: 'x', source: 'management', handledBy: tmgrId });
    expect((await files.detail(tsupId, s.teacherId)).supervision.complaints.find((c) => c.id === ok.id)?.handledBy?.id).toBe(tmgrId);
    expect((await files.list(tsupId)).supervisors.map((x) => x.id).sort()).toEqual([tsupId, tmgrId, superId].sort());
  });
});

describe('3. a decided deduction is priced from the default', () => {
  async function terms(currency: string) {
    const month = today.slice(0, 7);
    await g.prisma.teacherPayTerms.create({
      data: {
        organizationId: (await g.prisma.teacher.findUniqueOrThrow({ where: { id: s.teacherId } })).organizationId,
        teacherId: s.teacherId,
        effectiveMonth: new Date(`${month}-01T00:00:00Z`),
        salaryType: 'shift',
        currency,
        monthlyAmount: '9000',
        reason: 'contract',
        createdBy: superId,
      },
    });
  }

  async function deductionDecided(): Promise<string> {
    await discipline.recordAbsence(tsupId, s.teacherId, { occurredOn: today, note: 'one' });
    const second = await discipline.recordAbsence(tsupId, s.teacherId, { occurredOn: today, note: 'two' });
    // Two absences on one day tie on time, so their order is by id: decide with a reason either way.
    await discipline.decide(tmgrId, second.violation.id, { decision: 'deduction_1', note: 'second absence this month' });
    return second.violation.id;
  }

  it('in the teacher\'s currency, from the newest default; Payroll shows it priced', async () => {
    await terms('EGP');
    await payroll.setDeductionDefault(superId, { kind: 'deduction_1', currency: 'EGP', amount: '100' });
    await payroll.setDeductionDefault(superId, { kind: 'deduction_1', currency: 'EGP', amount: '150.50' });
    await payroll.setDeductionDefault(superId, { kind: 'deduction_1', currency: 'USD', amount: '5' });
    const defaults = await payroll.deductionDefaults(superId);
    expect(defaults.defaults.find((d) => d.currency === 'EGP')).toMatchObject({ kind: 'deduction_1', amount: '150.50' });

    const violationId = await deductionDecided();
    const rows = await g.prisma.teacherPayAdjustment.findMany({ where: { violationId } });
    expect(rows.map((r) => [r.kind, String(r.amount), r.currency, r.createdBy])).toEqual([['deduction', '150.5', 'EGP', tmgrId]]);
    const finance = await payroll.finance(superId, s.teacherId, today.slice(0, 7));
    expect(finance.unpriced.violationIds).toEqual([]);
    expect(finance.summary[0]).toMatchObject({ deductions: '150.50' });
  });

  it('no terms, or no default in that currency, or a default of 0: left for Payroll to price by hand', async () => {
    let violationId = await deductionDecided();
    expect(await g.prisma.teacherPayAdjustment.count({ where: { violationId } })).toBe(0);

    await truncate(g.prisma);
    s = await seed(g.prisma);
    await staffFixtures();
    await terms('EGP');
    await payroll.setDeductionDefault(superId, { kind: 'deduction_1', currency: 'EGP', amount: '100' });
    await payroll.setDeductionDefault(superId, { kind: 'deduction_1', currency: 'EGP', amount: '0' });
    violationId = await deductionDecided();
    expect(await g.prisma.teacherPayAdjustment.count({ where: { violationId } })).toBe(0);
    expect((await payroll.finance(superId, s.teacherId, today.slice(0, 7))).unpriced.violationIds).toEqual([violationId]);
  });

  it('only the super admin sets a default, even with the application bypassed', async () => {
    expect(await code(payroll.setDeductionDefault(tmgrId, { kind: 'deduction_1', currency: 'EGP', amount: '10' }))).toBe(
      CommErrorCode.TEACHER_FILE_DENIED,
    );
    const org = (await g.prisma.teacher.findUniqueOrThrow({ where: { id: s.teacherId } })).organizationId;
    await expect(
      g.prisma.teacherPayDefault.create({ data: { organizationId: org, kind: 'deduction_1', currency: 'EGP', amount: '10', createdBy: tmgrId } }),
    ).rejects.toThrow(/super admin/);
  });

  it('the Rewards list shows amounts to the super admin only', async () => {
    await terms('EGP');
    const bonus = await g.prisma.teacherSupervisionEntry.create({
      data: {
        organizationId: (await g.prisma.teacher.findUniqueOrThrow({ where: { id: s.teacherId } })).organizationId,
        teacherId: s.teacherId,
        kind: 'bonus',
        body: 'Ten perfect reports',
        createdBy: tsupId,
      },
    });
    await payroll.addAdjustment(superId, s.teacherId, { kind: 'bonus', bonusEntryId: bonus.id, amount: '300', reason: 'reward' });
    const asSuper = await payroll.rewards(superId);
    expect(asSuper.rewards[0]).toMatchObject({ reason: 'Ten perfect reports', recordedBy: { id: tsupId }, amount: { amount: '300.00', currency: 'EGP' } });
    const asSupervisor = await payroll.rewards(tsupId);
    expect(asSupervisor.canViewAmounts).toBe(false);
    expect(asSupervisor.rewards[0]).not.toHaveProperty('amount');
  });
});

describe('4. away', () => {
  async function onLeave(days: number) {
    const req = await leave.request(s.teacherId, { firstDay: today, lastDay: plusDays(today, days - 1), reason: 'family' });
    await leave.approve(tmgrId, req.request.id, { cancelCollidingLessons: true });
  }

  it('leave: the overview has a blank balance but still the leave; staff and the parent read leave until its last day', async () => {
    await onLeave(3);
    const row = (await leave.overview(tsupId)).teachers.find((t) => t.id === s.teacherId);
    expect(row).toMatchObject({ allowance: null, balance: null, used: 3, away: { kind: 'leave', until: plusDays(today, 2) } });
    expect((await files.list(tsupId)).teachers.find((t) => t.id === s.teacherId)?.away).toEqual({ kind: 'leave', until: plusDays(today, 2) });
    expect([...(await g.conversations.teachersAway([s.teacherId], false)).values()]).toEqual([{ kind: 'leave', until: plusDays(today, 2) }]);
  });

  it('a transfer to a teacher on leave is refused, naming the day they are back', async () => {
    await onLeave(2);
    const other = s.secondLearnerId;
    const err = await lifecycle.transfer(tmgrId, other, { toTeacherId: s.teacherId, reason: 'schedule_fit' }).catch((e) => e);
    expect(err).toBeInstanceOf(CommError);
    expect([err.code, err.message]).toEqual([CommErrorCode.LESSON_STATE, `teacher_c is on leave until ${plusDays(today, 1)}; choose another teacher`]);
  });

  it('a suspension reads "suspended" to staff and "away" to a parent; a plain day off does not block a transfer', async () => {
    const v = await discipline.recordAbsence(tsupId, s.teacherId, { occurredOn: today, note: 'x' });
    await discipline.decide(tmgrId, v.violation.id, {
      decision: 'temporary_suspension',
      note: 'serious',
      startsOn: today,
      endsOn: plusDays(today, 4),
      cancelCollidingLessons: true,
    });
    expect([...(await g.conversations.teachersAway([s.teacherId], true)).values()]).toEqual([{ kind: 'suspended', until: plusDays(today, 4) }]);
    expect([...(await g.conversations.teachersAway([s.teacherId], false)).values()]).toEqual([{ kind: 'away', until: plusDays(today, 4) }]);

    await scheduling.addDayOff(tmgrId, s.newTeacherId, { date: today, reason: 'errand' });
    expect([...(await g.conversations.teachersAway([s.newTeacherId], true)).values()]).toEqual([{ kind: 'day_off', until: today }]);
    await expect(lifecycle.transfer(tmgrId, s.learnerId, { toTeacherId: s.newTeacherId, reason: 'schedule_fit' })).resolves.toBeDefined();
  });
});

describe('5. lateness, trial or regular', () => {
  it('a regular lesson reads regular', async () => {
    const held = await lesson(-2 * HOUR);
    await lessons.report(s.teacherId, held, { covered: 'Al-Mulk' });
    const late = await discipline.recordLateness(tsupId, held, { minutes: 15 });
    expect(late.violation.lesson).toMatchObject({ id: held, kind: 'regular' });
  });
});
