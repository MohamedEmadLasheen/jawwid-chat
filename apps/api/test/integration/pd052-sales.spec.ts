/**
 * PD-52 PR-5 · the Sales basis on the teacher-records pages (plan §5.4; owner
 * §11 b: "yes, narrowly"). Sales sees and records rows about the trials it
 * reads and the families it owns -- trial lateness, complaints, testimonials,
 * grants without an amount -- and never decides, never sees leave, a step, an
 * amount, a regular lesson's discipline or a row about the teacher alone.
 *
 * The seed's PD-8 structure: admin_a (s.ownerId) is family_x's Operations
 * supervisor; teacher_c (s.teacherId) teaches learner_l. sales_a owns family_x
 * (chat.family_sales_owner); family_y (learner_y, also teacher_c's) is not
 * theirs. Synthetic fixtures only (QA gate G-16).
 *
 *   1. what the page offers Sales: both pages, record, never decide
 *   2. a complaint about a child of its family or a trial; never the teacher
 *      alone, another family, a handler, a resolution -- the database too
 *   3. testimonials and grants (no amount), about its children; the lists
 *      hold only those
 *   4. lateness on a trial it reads; a regular lesson is not found; no step
 *   5. nothing it may not decide: decide, uphold, take, leave, a complaint's
 *      correction -- refused
 */
import { randomUUID } from 'node:crypto';
import { PrismaAuditService } from '@platform/audit.service';
import { CommError } from '@platform/errors';
import { PermissionService } from '@platform/permissions/permission.service';
import { LessonService } from '../../src/lessons/lesson.service';
import { SupervisionConversationService } from '../../src/supervision/supervision-conversation.service';
import { CardPoster } from '../../src/supervision/card-poster';
import { LeaveService } from '../../src/leave/leave.service';
import { DisciplineService } from '../../src/discipline/discipline.service';
import { SchedulingService } from '../../src/lessons/scheduling.service';
import { TrialService } from '../../src/lessons/trial.service';
import { NewStudentsService } from '../../src/new-students/new-students.service';
import { TrialGroupService } from '../../src/lessons/trial-group.service';
import { TeacherFileService } from '../../src/teacher-file/teacher-file.service';
import { TeacherPayrollService } from '../../src/teacher-file/teacher-payroll.service';
import { SupervisionService } from '../../src/lessons/supervision.service';
import { ParentFeedbackService } from '../../src/teacher-file/parent-feedback.service';
import { TeacherRecordsService } from '../../src/teacher-file/teacher-records.service';
import { buildGraph, seed, supervise, truncate, withAssignmentGate, Scenario } from './harness';

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
const files = new TeacherFileService(g.prisma, g.authz, g.conversations, audit);
const timeline = new SupervisionService(g.prisma, g.conversations, lessons, g.outbox, supervision, audit);
const payroll = new TeacherPayrollService(g.prisma, files, audit, timeline);
const feedback = new ParentFeedbackService(g.prisma, g.conversations, files, audit);
const records = new TeacherRecordsService(g.prisma, g.conversations, files, feedback, new PermissionService(g.prisma), audit);

jest.setTimeout(120_000);
const HOUR = 3_600_000;

let s: Scenario;
let tsupId: string;
let superId: string;
let salesId: string;
let learnerY: string;
let slot = 0;

async function code(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (e) {
    if (e instanceof CommError) return `${e.code}:${e.status}`;
    throw e;
  }
  throw new Error('expected a refusal, got success');
}

async function fixtures() {
  await g.prisma.$executeRawUnsafe(
    `insert into chat.staff (id, name, role, is_active) values ($1::uuid, 'tsup_a', 'admin', true), ($2::uuid, 'sales_a', 'admin', true)`,
    tsupId,
    salesId,
  );
  await g.prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`select set_config('chat.provisioning_super_admin', 'on', true)`);
    await tx.$executeRawUnsafe(`insert into chat.staff (id, name, role, is_active) values ($1::uuid, 'root_c', 'super_admin', true)`, superId);
  });
  for (const [kind, member] of [
    ['teachers', tsupId],
    ['sales', salesId],
  ] as const) {
    const [{ id }] = await g.prisma.$queryRawUnsafe<Array<{ id: string }>>(
      `insert into chat.department (kind, display_name) values ($1, $1) returning id::text as id`,
      kind,
    );
    await g.prisma.$executeRawUnsafe(
      `insert into chat.department_member (staff_id, organization_id, department_id, position) values ($1::uuid, chat.default_organization_id(), $2::uuid, 'supervisor')`,
      member,
      id,
    );
  }
  // sales_a owns family_x (PD-42), set by the super admin.
  await g.prisma.$executeRawUnsafe(
    `insert into chat.family_sales_owner (family_id, organization_id, staff_id, assigned_by) values ($1::uuid, chat.default_organization_id(), $2::uuid, $3::uuid)`,
    s.familyId,
    salesId,
    superId,
  );
  // family_y: learner_y, also teacher_c's, supervised by admin_b -- not Sales'.
  const familyY = randomUUID();
  learnerY = randomUUID();
  await g.prisma.$executeRawUnsafe(`insert into chat.family (id, display_name, owner_id, language) values ($1::uuid, 'family_y', $2::uuid, 'ar')`, familyY, s.otherAdminId);
  await withAssignmentGate(g.prisma, `insert into chat.learner (id, family_id, name, teacher_id) values ('${learnerY}'::uuid, '${familyY}'::uuid, 'learner_y', '${s.teacherId}'::uuid)`);
  await supervise(g.prisma, s.otherAdminId, [learnerY]);
}

/** A held trial of teacher_c, two hours ago (the teacher reported attendance). */
async function heldTrial(): Promise<{ lessonId: string; prospectId: string }> {
  const organizationId = (await g.prisma.teacher.findUniqueOrThrow({ where: { id: s.teacherId } })).organizationId;
  const prospect = await g.prisma.trialProspect.create({ data: { organizationId, displayName: 'prospect_q', createdBy: salesId } });
  const start = Date.now() - 2 * HOUR - (slot++ % 10) * 45 * 60_000;
  const trial = await g.prisma.lesson.create({
    data: {
      organizationId, kind: 'trial', prospectId: prospect.id, teacherId: s.teacherId,
      startsAt: new Date(start), endsAt: new Date(start + 30 * 60_000), createdByKind: 'staff', createdBy: salesId,
    },
  });
  await trials.attendance(s.teacherId, trial.id, { attended: true, covered: 'letters 1-5' });
  return { lessonId: trial.id, prospectId: prospect.id };
}

/** A held regular lesson of teacher_c with learner_l. */
async function heldRegular(): Promise<string> {
  const start = Date.now() - 3 * HOUR - (slot++ % 10) * 45 * 60_000;
  const id = (await lessons.schedule(tsupId, { learnerId: s.learnerId, startsAt: new Date(start).toISOString(), endsAt: new Date(start + HOUR / 2).toISOString() })).id;
  await lessons.report(s.teacherId, id, { covered: 'Al-Mulk' });
  return id;
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
  superId = randomUUID();
  salesId = randomUUID();
  await fixtures();
});

describe('PD-52 PR-5: Sales', () => {
  it('1. is offered both pages and their records, never a decision, a balance, an amount or the Teacher File', async () => {
    expect(await records.access(salesId)).toEqual({
      basis: 'sales',
      attendance: { view: true, record: true, decide: false },
      grants: { view: true, record: true },
      leaveBalance: false,
      amounts: false,
      opensFile: false,
    });
    const directory = await files.directory(salesId);
    expect(directory).toMatchObject({ basis: 'sales', supervisors: [], familyChats: [] });
    // family_x's children's teachers (learner_l: teacher_c, learner_m: teacher_d); never teacher_e.
    expect(directory.teachers.map((t) => t.id).sort()).toEqual([s.teacherId, s.newTeacherId].sort());
  });

  it('2. files a complaint about its family\'s child or a trial, handled by the Teachers department; never the teacher alone or another family', async () => {
    const c = await files.addEntry(salesId, s.teacherId, { kind: 'complaint', body: 'Camera off all lesson.', source: 'parent', learnerId: s.learnerId });
    expect(await g.prisma.teacherSupervisionEntry.findUniqueOrThrow({ where: { id: c.id } })).toMatchObject({ handledBy: null, learnerId: s.learnerId, familyId: s.familyId, createdBy: salesId });
    const { prospectId } = await heldTrial();
    const t = await files.addEntry(salesId, s.teacherId, { kind: 'complaint', body: 'Late to the trial.', source: 'parent', prospectId });
    await files.addEntry(salesId, s.teacherId, { kind: 'complaint_followup', body: 'Called the parent back.', refersTo: c.id });

    expect((await files.complaints(salesId, {})).complaints.map((x) => x.id).sort()).toEqual([c.id, t.id].sort());
    // admin_b (family_y) sees neither; the Teachers department sees both.
    expect((await files.complaints(s.otherAdminId, {})).complaints).toEqual([]);
    expect((await files.complaints(tsupId, {})).complaints.map((x) => x.id).sort()).toEqual([c.id, t.id].sort());

    const VALIDATION = 'COMMON.VALIDATION:400';
    expect(await code(files.addEntry(salesId, s.teacherId, { kind: 'complaint', body: 'x', source: 'management' }))).toBe(VALIDATION);
    expect(await code(files.addEntry(salesId, s.teacherId, { kind: 'complaint', body: 'x', source: 'parent', learnerId: learnerY }))).toBe(VALIDATION);
    expect(await code(files.addEntry(salesId, s.teacherId, { kind: 'complaint', body: 'x', source: 'parent', learnerId: s.learnerId, handledBy: tsupId }))).toBe(VALIDATION);
    expect(await code(files.addEntry(salesId, s.teacherId, { kind: 'complaint_resolution', body: 'x', refersTo: c.id }))).toBe('COMM.TEACHER_FILE_DENIED:403');
    expect(await code(files.addEntry(salesId, s.unrelatedTeacherId, { kind: 'complaint', body: 'x', source: 'parent', learnerId: s.learnerId }))).toBe('COMM.TEACHER_FILE_NOT_FOUND:404');

    // The database alone: Sales cannot write about the teacher alone, nor another family's child.
    const insert = (learner: string | null, family: string | null) =>
      g.prisma.$executeRawUnsafe(
        `insert into chat.teacher_supervision_entry (organization_id, teacher_id, kind, body, complaint_source, created_by, learner_id, family_id)
         values (chat.default_organization_id(), $1::uuid, 'complaint', 'x', 'management', $2::uuid, $3::uuid, $4::uuid)`,
        s.teacherId,
        salesId,
        learner,
        family,
      );
    await expect(insert(null, null)).rejects.toThrow(/Teachers department/);
    const yFamily = (await g.prisma.learner.findUniqueOrThrow({ where: { id: learnerY } })).familyId;
    await expect(insert(learnerY, yFamily)).rejects.toThrow(/supervisors|Teachers department/);
  });

  it('3. records testimonials and grants (never an amount) about its children; reads only those', async () => {
    const mine = await records.recordTestimonial(salesId, s.teacherId, { body: 'The mother called to thank her.', source: 'parent_call', learnerId: s.learnerId });
    const teacherLevel = await records.recordTestimonial(tsupId, s.teacherId, { body: 'Great in the staff meeting.', source: 'staff_observation' });
    const theirs = await records.recordTestimonial(s.otherAdminId, s.teacherId, { body: 'Family y is happy.', source: 'parent_message', learnerId: learnerY });
    const praise = await feedback.file(s.parentId, { learnerId: s.learnerId, category: 'praise', body: 'Wonderful teacher.' });
    expect((await records.testimonials(salesId, {})).testimonials.map((t) => t.id).sort()).toEqual([mine.id, praise.id].sort());
    expect((await records.testimonials(tsupId, {})).testimonials.map((t) => t.id)).toEqual(expect.arrayContaining([teacherLevel.id, theirs.id]));
    expect(await code(records.recordTestimonial(salesId, s.teacherId, { body: 'x', source: 'other' }))).toBe('COMMON.VALIDATION:400');

    const grant = await timeline.bonus(salesId, s.teacherId, { reason: 'Brought in three families', learnerId: s.learnerId });
    expect(await g.prisma.teacherSupervisionEntry.findUniqueOrThrow({ where: { id: grant.id } })).toMatchObject({ kind: 'bonus', learnerId: s.learnerId, createdBy: salesId });
    await timeline.bonus(tsupId, s.teacherId, { reason: 'Covered extra lessons' });
    expect(await code(timeline.bonus(salesId, s.teacherId, { reason: 'x', learnerId: s.learnerId, amount: '300' }))).toMatch(/VALIDATION:400$/);
    expect(await code(timeline.bonus(salesId, s.teacherId, { reason: 'x' }))).toMatch(/VALIDATION:400$/);
    expect(await code(timeline.bonus(salesId, s.teacherId, { reason: 'x', learnerId: learnerY }))).toMatch(/VALIDATION:400$/);
    const rewards = await payroll.rewards(salesId);
    expect(rewards.rewards.map((r) => r.id)).toEqual([grant.id]);
    expect(rewards.canViewAmounts).toBe(false);

    // Sales corrects its testimonial, never a complaint.
    await records.voidEntry(salesId, mine.id, { reason: 'Wrong child.' });
    const c = await files.addEntry(salesId, s.teacherId, { kind: 'complaint', body: 'x', source: 'parent', learnerId: s.learnerId });
    expect(await code(records.voidEntry(salesId, c.id, { reason: 'x' }))).toBe('COMM.TEACHER_FILE_DENIED:403');

    // The strip: no ladder step and no leave for Sales; counts of its rows.
    const strip = await records.summary(salesId, s.teacherId);
    expect(strip).toMatchObject({ ladder: null, away: null, opensFile: false, grants: 1, openComplaints: 1 });
  });

  it('4. records lateness on a trial it reads; a regular lesson is not found; the list holds no step', async () => {
    const { lessonId } = await heldTrial();
    const late = await discipline.recordLateness(salesId, lessonId, { minutes: 20 });
    expect(late.violation).toMatchObject({ kind: 'late', step: null, suggestedDecision: null, decision: null, lesson: { id: lessonId, kind: 'trial' } });
    const regular = await heldRegular();
    expect(await code(discipline.recordLateness(salesId, regular, { minutes: 20 }))).toBe('COMM.DISCIPLINE_NOT_FOUND:404');
    await discipline.recordLateness(tsupId, regular, { minutes: 25 });

    const listed = await discipline.list(salesId, { state: 'all' });
    expect(listed.violations.map((v) => [v.lesson?.id, v.step])).toEqual([[lessonId, null]]);
    expect((await discipline.list(salesId, { state: 'all', kind: 'absences' })).violations).toEqual([]);
    // The ladder is the Teachers department's to decide.
    expect(await code(discipline.decide(salesId, late.violation!.id as string, { decision: 'warning' }))).toMatch(/DISCIPLINE_DENIED:403$/);
  });

  it('5. decides nothing: uphold, take, leave and the held-lessons of a regular lesson are refused or empty', async () => {
    const c = await files.addEntry(salesId, s.teacherId, { kind: 'complaint', body: 'x', source: 'parent', learnerId: s.learnerId });
    expect(await code(discipline.upholdComplaint(salesId, c.id, { note: 'x' }))).toMatch(/DENIED:403$/);
    const filed = await feedback.file(s.parentId, { learnerId: s.learnerId, category: 'complaint', body: 'Cut short.' });
    expect(await code(feedback.take(salesId, filed.id))).toMatch(/DENIED:403$/);
    expect(await code(leave.list(salesId, {}))).toMatch(/DENIED:403$/);
    expect((await files.heldLessons(salesId, s.teacherId, 'regular')).lessons).toEqual([]);
    const { lessonId, prospectId } = await heldTrial();
    expect((await files.heldLessons(salesId, s.teacherId, 'trial')).lessons.map((l) => l.id)).toEqual([lessonId]);
    // The record dialogs' picker: its family's child and the trial; never family_y's.
    const picker = await records.students(salesId, s.teacherId);
    expect(picker.students.map((x) => x.id)).toEqual([s.learnerId]);
    expect(picker.trials).toEqual([{ id: prospectId, name: 'prospect_q' }]);
  });
});
