/**
 * PD-52 · the teacher-records pages (docs/product/pd052-teacher-records-pages-plan.md).
 *
 * PR-1, the keys:
 *   1. the database holds the five keys, and every account that works the
 *      Teacher Supervision page today holds them through its legacy bundle
 *   2. the migration's copy gives every role that holds an old key its new keys
 *   3. GET /teacher-records/access answers per basis: Operations and the
 *      Teachers department both pages; Sales and an unplaced supervisor none
 *
 * PR-2, testimonials, corrections and links:
 *   4. a testimonial names its student and family; the database refuses a
 *      student of another family and one the teacher never taught
 *   5. a parent's praise is read in place, never copied, narrowed per family
 *   6. Operations sees and records only about their own families' children
 *   7. a void hides a complaint or testimonial once; never a parent's own
 *      complaint or a resolved one; the table stays append-only
 *   8. a complaint may name its student; the teacher's summary strip
 *
 * The seed's PD-8 structure: manager_c runs Operations; admin_a (s.ownerId) and
 * admin_b (s.otherAdminId) are Operations supervisors. Synthetic fixtures only
 * (QA gate G-16).
 */
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PrismaAuditService } from '@platform/audit.service';
import { PermissionService } from '@platform/permissions/permission.service';
import { TeacherFileService } from '../../src/teacher-file/teacher-file.service';
import { TeacherRecordsService } from '../../src/teacher-file/teacher-records.service';
import { ParentFeedbackService } from '../../src/teacher-file/parent-feedback.service';
import { CommError } from '@platform/errors';
import { LessonService } from '../../src/lessons/lesson.service';
import { SupervisionConversationService } from '../../src/supervision/supervision-conversation.service';
import { CardPoster } from '../../src/supervision/card-poster';
import { DisciplineService } from '../../src/discipline/discipline.service';
import { SchedulingService } from '../../src/lessons/scheduling.service';
import { TrialService } from '../../src/lessons/trial.service';
import { NewStudentsService } from '../../src/new-students/new-students.service';
import { TrialGroupService } from '../../src/lessons/trial-group.service';
import { buildGraph, seed, supervise, truncate, withAssignmentGate, Scenario } from './harness';

const g = buildGraph();
const audit = new PrismaAuditService();
const files = new TeacherFileService(g.prisma, g.authz, g.conversations, audit);
const feedback = new ParentFeedbackService(g.prisma, g.conversations, files, audit);
const records = new TeacherRecordsService(g.prisma, g.conversations, files, feedback, new PermissionService(g.prisma), audit);
const lessons = new LessonService(g.prisma, g.authz, g.conversations, g.outbox, g.config, audit);
const supervisionChats = new SupervisionConversationService(g.prisma, g.authz, g.conversations, g.outbox, audit);
const cards = new CardPoster(g.conversations, g.outbox, audit);
const scheduling = new SchedulingService(g.prisma, g.authz, g.conversations, lessons, g.outbox, g.config, g.reminders, audit);
const trialGroups = new TrialGroupService(g.prisma, g.authz, g.conversations, g.outbox, cards, g.config, audit);
const trials = new TrialService(g.prisma, g.conversations, lessons, scheduling, audit, trialGroups, new NewStudentsService(g.prisma));
const discipline = new DisciplineService(g.prisma, g.conversations, supervisionChats, cards, lessons, g.outbox, g.config, audit, trials);

jest.setTimeout(120_000);

const NEW_KEYS = ['teacher_attendance.decide', 'teacher_attendance.record', 'teacher_attendance.view', 'teacher_grants.record', 'teacher_grants.view'];
const MIGRATION = join(__dirname, '..', '..', '..', '..', 'supabase', 'migrations', '20261031170000_chat_pd052_teacher_records_keys.sql');

let s: Scenario;
let tsupId: string;
let superId: string;
let salesId: string;
let looseId: string;

const keysOf = async (staffId: string) =>
  (
    await g.prisma.$queryRaw<Array<{ permissions: string[] | null }>>`
      SELECT permissions FROM chat.staff_access_profile(${staffId}::uuid)`
  )[0]?.permissions ?? [];

/** A Teachers supervisor, a Sales supervisor, a supervisor in no department, and a super admin. */
async function staffFixtures() {
  await g.prisma.$executeRawUnsafe(
    `insert into chat.staff (id, name, role, is_active) values
       ($1::uuid, 'tsup_a', 'admin', true), ($2::uuid, 'sales_a', 'admin', true), ($3::uuid, 'loose_a', 'admin', true)`,
    tsupId,
    salesId,
    looseId,
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
      `insert into chat.department_member (staff_id, organization_id, department_id, position)
       values ($1::uuid, chat.default_organization_id(), $2::uuid, 'supervisor')`,
      member,
      id,
    );
  }
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
  s = await seed(g.prisma);
  tsupId = randomUUID();
  superId = randomUUID();
  salesId = randomUUID();
  looseId = randomUUID();
  await staffFixtures();
});

describe('PD-52 PR-1: the keys', () => {
  it('1. the catalogue holds the five keys, held by exactly the accounts that hold the PD-26 page keys', async () => {
    const rows = await g.prisma.$queryRaw<Array<{ key: string }>>`
      SELECT key FROM chat.permission WHERE key LIKE 'teacher\_attendance.%' OR key LIKE 'teacher\_grants.%' ORDER BY key`;
    expect(rows.map((r) => r.key)).toEqual(NEW_KEYS);

    for (const who of [s.ownerId, s.managerId, tsupId, superId]) {
      const keys = await keysOf(who);
      expect(keys).toEqual(expect.arrayContaining(['teacher_supervision.view', ...NEW_KEYS]));
    }
    // PD-52 PR-5: Sales holds the view and record keys, never decide, never the old keys.
    const sales = await keysOf(salesId);
    expect(sales).not.toContain('teacher_supervision.view');
    expect(sales.filter((k) => NEW_KEYS.includes(k)).sort()).toEqual(['teacher_attendance.record', 'teacher_attendance.view', 'teacher_grants.record', 'teacher_grants.view']);
    expect((await keysOf(looseId)).filter((k) => NEW_KEYS.includes(k))).toEqual([]);
  });

  it('2. the migration copies every old grant of a role into its new keys, once', async () => {
    const define = (key: string, permissions: string[]) =>
      g.prisma.$queryRaw<Array<{ id: string }>>`
        SELECT chat.define_access_role(${key}, ${key + ' (en)'}, ${key + ' (ar)'}, null, 'specialist', ${permissions}::text[], 'spec', ${superId}::uuid)::text AS id`.then(
        (r) => r[0]!.id,
      );
    const viewer = await define('pd052_viewer', ['teacher_supervision.view']);
    const recorder = await define('pd052_recorder', ['teacher_supervision.view', 'teacher_supervision.record']);
    const other = await define('pd052_other', ['lessons.view']);

    // The copy as the migration runs it (its own section of the file), twice: idempotent.
    const sql = readFileSync(MIGRATION, 'utf8');
    const begin = sql.indexOf("select set_config('chat.pd040_access_change', 'on', true);");
    const end = sql.indexOf("select set_config('chat.pd040_access_change', 'off', true);");
    expect(begin).toBeGreaterThan(-1);
    const copy = sql.slice(begin, end).split(';').map((x) => x.trim()).filter(Boolean);
    for (let round = 0; round < 2; round++) {
      await g.prisma.$transaction(async (tx) => {
        for (const statement of copy) await tx.$executeRawUnsafe(statement);
      });
    }

    const keysOfRole = async (role: string) =>
      (
        await g.prisma.$queryRaw<Array<{ k: string }>>`
          SELECT permission_key AS k FROM chat.access_role_permission WHERE role_id = ${role}::uuid ORDER BY permission_key`
      ).map((r) => r.k);
    expect(await keysOfRole(viewer)).toEqual(['teacher_attendance.view', 'teacher_grants.view', 'teacher_supervision.view']);
    expect(await keysOfRole(recorder)).toEqual([...NEW_KEYS, 'teacher_supervision.record', 'teacher_supervision.view'].sort());
    expect(await keysOfRole(other)).toEqual(['lessons.view']);
  });

  it('3. GET /teacher-records/access: Operations and the Teachers department both pages; Sales records (PR-5); the unplaced none', async () => {
    const ops = await records.access(s.ownerId);
    expect(ops).toMatchObject({
      basis: 'operations',
      attendance: { view: true, record: true, decide: true },
      grants: { view: true, record: true },
      leaveBalance: false,
      amounts: false,
      opensFile: false,
    });
    const teachers = await records.access(tsupId);
    expect(teachers).toMatchObject({ basis: 'teachers', attendance: { view: true, decide: true }, grants: { view: true }, leaveBalance: true, opensFile: true });
    expect((await records.access(superId)).amounts).toBe(true);
    expect(await records.access(looseId)).toMatchObject({ basis: null, attendance: { view: false }, grants: { view: false } });
    // PD-52 PR-5: Sales records, never decides.
    expect(await records.access(salesId)).toMatchObject({ basis: 'sales', attendance: { view: true, record: true, decide: false }, grants: { view: true, record: true } });
  });
});

// ---------------------------------------------------------------------------
// PR-2
// ---------------------------------------------------------------------------

async function code(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (e) {
    if (e instanceof CommError) return `${e.code}:${e.status}`;
    throw e;
  }
  throw new Error('expected a refusal, got success');
}

/** family_y: learner_y, taught by teacher_c, supervised by admin_b (Operations, s.otherAdminId). */
async function otherFamily(): Promise<{ familyY: string; learnerY: string }> {
  const familyY = randomUUID();
  const learnerY = randomUUID();
  await g.prisma.$executeRawUnsafe(
    `insert into chat.family (id, display_name, owner_id, language) values ($1::uuid, 'family_y', $2::uuid, 'ar')`,
    familyY,
    s.otherAdminId,
  );
  await withAssignmentGate(
    g.prisma,
    `insert into chat.learner (id, family_id, name, teacher_id) values ('${learnerY}'::uuid, '${familyY}'::uuid, 'learner_y', '${s.teacherId}'::uuid)`,
  );
  await supervise(g.prisma, s.otherAdminId, [learnerY]);
  return { familyY, learnerY };
}

const praiseFrom = (learnerId: string, body = 'She is wonderful with my son.') =>
  feedback.file(s.parentId, { learnerId, category: 'praise', body });

describe('PD-52 PR-2: testimonials, corrections and links', () => {
  it('4. a testimonial names its student (the family follows); a wrong family or an untaught student is refused', async () => {
    const t = await records.recordTestimonial(tsupId, s.teacherId, { body: 'Parents thanked him on the phone.', source: 'parent_call', learnerId: s.learnerId });
    const row = await g.prisma.teacherSupervisionEntry.findUniqueOrThrow({ where: { id: t.id } });
    expect(row).toMatchObject({ kind: 'testimonial', testimonialSource: 'parent_call', learnerId: s.learnerId, familyId: s.familyId, createdBy: tsupId });

    const { familyY } = await otherFamily();
    expect(await code(records.recordTestimonial(tsupId, s.teacherId, { body: 'x', source: 'other', learnerId: s.learnerId, familyId: familyY }))).toBe(
      'COMMON.VALIDATION:400',
    );
    // learner_m is teacher_d's: teacher_c never taught them.
    expect(await code(records.recordTestimonial(tsupId, s.teacherId, { body: 'x', source: 'other', learnerId: s.secondLearnerId }))).toBe(
      'COMM.TEACHER_FILE_CONFLICT:409',
    );
    expect(await code(records.recordTestimonial(tsupId, s.teacherId, { body: 'x', source: 'gossip' }))).toBe('COMMON.VALIDATION:400');

    // The database alone, with the application bypassed: a learner of another family.
    await expect(
      g.prisma.$executeRawUnsafe(
        `insert into chat.teacher_supervision_entry (organization_id, teacher_id, kind, body, testimonial_source, created_by, learner_id, family_id)
         values (chat.default_organization_id(), $1::uuid, 'testimonial', 'x', 'other', $2::uuid, $3::uuid, $4::uuid)`,
        s.teacherId,
        tsupId,
        s.learnerId,
        familyY,
      ),
    ).rejects.toThrow(/belongs to its family/);
    // ...and a link on a kind that is about no child.
    await expect(
      g.prisma.$executeRawUnsafe(
        `insert into chat.teacher_supervision_entry (organization_id, teacher_id, kind, body, period, created_by, learner_id, family_id)
         values (chat.default_organization_id(), $1::uuid, 'monthly_comment', 'x', '2026-11-01', $2::uuid, $3::uuid, $4::uuid)`,
        s.teacherId,
        tsupId,
        s.learnerId,
        s.familyId,
      ),
    ).rejects.toThrow(/about_shape/);
  });

  it('5. a parent\'s praise appears on page B for its family\'s supervisors only, and is never copied', async () => {
    const { learnerY } = await otherFamily();
    const filed = await praiseFrom(s.learnerId);
    const before = await g.prisma.teacherSupervisionEntry.count();

    const forTeachers = await records.testimonials(tsupId, { teacher: s.teacherId });
    expect(forTeachers.testimonials).toEqual([expect.objectContaining({ id: filed.id, origin: 'parent', source: 'parent_app', child: { id: s.learnerId, name: 'learner_l' } })]);
    expect((await records.testimonials(s.ownerId, {})).testimonials.map((t) => t.id)).toEqual([filed.id]);
    // admin_b works on teacher_c through learner_y, but family_x's praise is not theirs.
    expect((await records.testimonials(s.otherAdminId, { teacher: s.teacherId })).testimonials).toEqual([]);
    expect(learnerY).toBeDefined();

    expect(await g.prisma.teacherSupervisionEntry.count()).toBe(before);
    expect(await g.prisma.teacherSupervisionEntry.count({ where: { kind: 'testimonial' } })).toBe(0);
  });

  it('6. Operations records and sees testimonials about their own families\' children only', async () => {
    const { learnerY, familyY } = await otherFamily();
    const mine = await records.recordTestimonial(s.otherAdminId, s.teacherId, { body: 'Great progress.', source: 'parent_message', learnerId: learnerY });
    expect(await code(records.recordTestimonial(s.otherAdminId, s.teacherId, { body: 'x', source: 'other', learnerId: s.learnerId }))).toBe(
      'COMMON.VALIDATION:400',
    );
    expect(await code(records.recordTestimonial(s.otherAdminId, s.teacherId, { body: 'x', source: 'other', familyId: s.familyId }))).toBe(
      'COMMON.VALIDATION:400',
    );
    expect((await records.testimonials(s.otherAdminId, {})).testimonials.map((t) => t.id)).toEqual([mine.id]);
    expect((await records.testimonials(s.ownerId, {})).testimonials).toEqual([]);
    expect((await records.testimonials(tsupId, {})).testimonials.map((t) => [t.id, t.familyId])).toEqual([[mine.id, familyY]]);
    // A teacher outside the caller's scope is not found (PD-35).
    expect(await code(records.testimonials(s.otherAdminId, { teacher: s.unrelatedTeacherId }))).toBe('COMM.TEACHER_FILE_NOT_FOUND:404');
  });

  it('7. a void hides a record once; never a parent\'s own complaint or a resolved one; the table stays append-only', async () => {
    const t = await records.recordTestimonial(tsupId, s.teacherId, { body: 'Kind words.', source: 'staff_observation' });
    const v = await records.voidEntry(tsupId, t.id, { reason: 'Recorded for the wrong teacher.' });
    expect(v.voids).toBe(t.id);
    expect(await code(records.voidEntry(tsupId, t.id, { reason: 'again' }))).toBe('COMM.TEACHER_FILE_CONFLICT:409');
    expect(await code(records.voidEntry(tsupId, t.id, {}))).toMatch(/VALIDATION|CONFLICT/);
    expect((await records.testimonials(tsupId, {})).testimonials).toEqual([]);
    const all = (await records.testimonials(tsupId, { voided: 'include' })).testimonials;
    expect(all).toEqual([expect.objectContaining({ id: t.id, voided: expect.objectContaining({ body: 'Recorded for the wrong teacher.' }) })]);

    // A staff complaint: voided, hidden from the list, its follow-ups refused.
    const c = await files.addEntry(tsupId, s.teacherId, { kind: 'complaint', body: 'Started late.', source: 'management' });
    await records.voidEntry(tsupId, c.id, { reason: 'Duplicate of an earlier one.' });
    expect((await files.complaints(tsupId, {})).complaints.map((x) => x.id)).not.toContain(c.id);
    expect((await files.complaints(tsupId, { voided: 'include' })).complaints.find((x) => x.id === c.id)?.voided).not.toBeNull();
    expect(await code(files.addEntry(tsupId, s.teacherId, { kind: 'complaint_followup', body: 'x', refersTo: c.id }))).toBe('COMM.TEACHER_FILE_CONFLICT:409');

    // A resolved complaint keeps its history.
    const r = await files.addEntry(tsupId, s.teacherId, { kind: 'complaint', body: 'Rude.', source: 'management' });
    await files.addEntry(tsupId, s.teacherId, { kind: 'complaint_resolution', body: 'Talked it through.', refersTo: r.id });
    expect(await code(records.voidEntry(tsupId, r.id, { reason: 'no' }))).toBe('COMM.TEACHER_FILE_CONFLICT:409');

    // A parent's own complaint is answered, never voided.
    const filed = await feedback.file(s.parentId, { learnerId: s.learnerId, category: 'complaint', body: 'The lesson was cut short.' });
    const app = await g.prisma.teacherSupervisionEntry.findFirstOrThrow({ where: { parentFeedbackId: filed.id } });
    expect(await code(records.voidEntry(tsupId, app.id, { reason: 'no' }))).toBe('COMM.TEACHER_FILE_CONFLICT:409');
    await expect(
      g.prisma.$executeRawUnsafe(
        `insert into chat.teacher_supervision_entry (organization_id, teacher_id, kind, body, refers_to, created_by)
         values (chat.default_organization_id(), $1::uuid, 'entry_void', 'x', $2::uuid, $3::uuid)`,
        s.teacherId,
        app.id,
        tsupId,
      ),
    ).rejects.toThrow(/answered, never voided/);

    // Append-only: no UPDATE or DELETE, on the void or its target.
    await expect(g.prisma.$executeRawUnsafe(`update chat.teacher_supervision_entry set body = 'edited' where id = $1::uuid`, v.id)).rejects.toThrow(/append-only/);
    await expect(g.prisma.$executeRawUnsafe(`delete from chat.teacher_supervision_entry where id = $1::uuid`, t.id)).rejects.toThrow(/append-only/);

    // Every write is in the action log.
    expect(await g.prisma.auditLog.count({ where: { action: 'teacher_file.entry_voided' } })).toBe(2);
  });

  it('8. a complaint may name its student; the summary counts what the caller can see, the ladder whole', async () => {
    const { learnerY } = await otherFamily();
    // admin_a (family_x) files about learner_l with no conversation: it names its student.
    const mine = await files.addEntry(s.ownerId, s.teacherId, { kind: 'complaint', body: 'Late again.', source: 'parent', learnerId: s.learnerId });
    const theirs = await files.addEntry(s.otherAdminId, s.teacherId, { kind: 'complaint', body: 'Camera off.', source: 'parent', learnerId: learnerY });
    expect((await files.complaints(s.ownerId, {})).complaints.map((c) => c.id)).toEqual([mine.id]);
    expect((await files.complaints(s.otherAdminId, {})).complaints.map((c) => c.id)).toEqual([theirs.id]);
    expect((await files.complaints(tsupId, {})).complaints.map((c) => c.id).sort()).toEqual([mine.id, theirs.id].sort());
    expect(await code(files.addEntry(s.ownerId, s.teacherId, { kind: 'complaint', body: 'x', source: 'parent', learnerId: learnerY }))).toBe(
      'COMMON.VALIDATION:400',
    );

    await records.recordTestimonial(tsupId, s.teacherId, { body: 'Lovely.', source: 'parent_message', learnerId: s.learnerId });
    await praiseFrom(s.learnerId);
    const whole = await records.summary(tsupId, s.teacherId);
    expect(whole).toMatchObject({ teacher: { id: s.teacherId }, openComplaints: 2, testimonials: 2, grants: 0, opensFile: true, ladder: { counted: 0, nextStep: 'warning' } });
    const ops = await records.summary(s.otherAdminId, s.teacherId);
    expect(ops).toMatchObject({ openComplaints: 1, testimonials: 0, opensFile: false });
    expect(await code(records.summary(s.otherAdminId, s.unrelatedTeacherId))).toBe('COMM.TEACHER_FILE_NOT_FOUND:404');

    // PD-52 PR-4: the student picker -- the teacher's students, narrowed for Operations.
    expect((await records.students(tsupId, s.teacherId)).students.map((x) => x.id).sort()).toEqual([s.learnerId, learnerY].sort());
    expect((await records.students(s.otherAdminId, s.teacherId)).students).toEqual([{ id: learnerY, name: 'learner_y', familyId: expect.any(String) }]);
    expect((await records.students(s.ownerId, s.teacherId)).students.map((x) => x.id)).toEqual([s.learnerId]);
    // Review of #377: who may not ask, and which teachers are not found.
    expect(await code(records.students(looseId, s.teacherId))).toBe('COMM.TEACHER_FILE_DENIED:403');
    expect(await code(records.students(salesId, s.teacherId))).toBe('COMM.TEACHER_FILE_DENIED:403');
    expect(await code(records.students(s.ownerId, s.unrelatedTeacherId))).toBe('COMM.TEACHER_FILE_NOT_FOUND:404');
    const elsewhere = randomUUID();
    const foreignTeacher = randomUUID();
    await g.prisma.$executeRawUnsafe(`insert into chat.organization (id, slug, display_name) values ($1::uuid, $2, 'Elsewhere academy')`, elsewhere, `pd52-${elsewhere.slice(0, 8)}`);
    await g.prisma.$executeRawUnsafe(`insert into chat.teacher (id, name, is_active, organization_id) values ($1::uuid, 'teacher_x', true, $2::uuid)`, foreignTeacher, elsewhere);
    expect(await code(records.students(tsupId, foreignTeacher))).toBe('COMM.TEACHER_FILE_NOT_FOUND:404');
    await asGrantsOnly(async () => {
      expect(await code(records.students(tsupId, s.teacherId))).toBe('COMM.TEACHER_FILE_DENIED:403');
    }, ['teacher_grants.record']);
  });
});

// ---------------------------------------------------------------------------
// Review of #374
// ---------------------------------------------------------------------------

/**
 * A Teachers supervisor who holds page B's keys and none of page A's (their
 * legacy bundle trimmed for the test, then restored): a basis, grants only.
 * `alsoTrim` takes more keys away (e.g. grants.record: view only).
 */
async function asGrantsOnly<T>(fn: () => Promise<T>, alsoTrim: string[] = []): Promise<T> {
  const trimmed = ['teacher_supervision.view', 'teacher_supervision.record', 'teacher_attendance.view', 'teacher_attendance.record', 'teacher_attendance.decide', ...alsoTrim];
  const flip = (on: boolean) => `select set_config('chat.pd040_catalogue_change', '${on ? 'on' : 'off'}', true)`;
  await g.prisma.$transaction([
    g.prisma.$executeRawUnsafe(flip(true)),
    g.prisma.$executeRawUnsafe(`delete from chat.legacy_permission_bundle where tier = 'supervisor' and department_kind = 'teachers' and permission_key = any($1::text[])`, trimmed),
  ]);
  try {
    return await fn();
  } finally {
    await g.prisma.$transaction([
      g.prisma.$executeRawUnsafe(flip(true)),
      g.prisma.$executeRawUnsafe(
        `insert into chat.legacy_permission_bundle (tier, department_kind, permission_key) select 'supervisor', 'teachers', k from unnest($1::text[]) k on conflict do nothing`,
        trimmed,
      ),
    ]);
  }
}

/** Run two acts at once, many times over; return how many of each settled each way. */
async function race(make: () => Promise<{ a: () => Promise<unknown>; b: () => Promise<unknown> }>, rounds = 5) {
  const outcomes: Array<[string, string]> = [];
  for (let i = 0; i < rounds; i++) {
    const { a, b } = await make();
    const [ra, rb] = await Promise.allSettled([a(), b()]);
    outcomes.push([ra.status, rb.status]);
  }
  return outcomes;
}

describe('PD-52, review of #374', () => {
  it('P1: a voided complaint is never upheld -- by the service, and by the database with the app bypassed', async () => {
    const c = await files.addEntry(tsupId, s.teacherId, { kind: 'complaint', body: 'Late.', source: 'management' });
    await records.voidEntry(tsupId, c.id, { reason: 'Entered twice.' });
    expect(await code(discipline.upholdComplaint(tsupId, c.id, { note: 'x' }))).toMatch(/DISCIPLINE_STATE:409$/);
    await expect(
      g.prisma.$executeRawUnsafe(
        `insert into chat.teacher_violation (organization_id, teacher_id, kind, complaint_entry_id, occurred_at, month, recorded_by)
         values (chat.default_organization_id(), $1::uuid, 'complaint', $2::uuid, now(), current_date, $3::uuid)`,
        s.teacherId,
        c.id,
        tsupId,
      ),
    ).rejects.toThrow(/voided complaint is not upheld/);
    expect(await g.prisma.teacherViolation.count({ where: { complaintEntryId: c.id } })).toBe(0);
  });

  it('P1: a void racing an uphold, or a resolution, of one complaint -- exactly one lands, every time', async () => {
    const upheld = await race(async () => {
      const c = await files.addEntry(tsupId, s.teacherId, { kind: 'complaint', body: 'Rude.', source: 'management' });
      return { a: () => records.voidEntry(tsupId, c.id, { reason: 'mistake' }), b: () => discipline.upholdComplaint(tsupId, c.id, {}) };
    });
    for (const [a, b] of upheld) expect([a, b].filter((x) => x === 'fulfilled')).toHaveLength(1);
    const resolved = await race(async () => {
      const c = await files.addEntry(tsupId, s.teacherId, { kind: 'complaint', body: 'Rude.', source: 'management' });
      return {
        a: () => records.voidEntry(tsupId, c.id, { reason: 'mistake' }),
        b: () => files.addEntry(tsupId, s.teacherId, { kind: 'complaint_resolution', body: 'Talked.', refersTo: c.id }),
      };
    });
    for (const [a, b] of resolved) expect([a, b].filter((x) => x === 'fulfilled')).toHaveLength(1);
    // And the rows agree: no complaint is both voided and upheld or resolved.
    const [{ both }] = await g.prisma.$queryRaw<Array<{ both: number }>>`
      SELECT count(*)::int AS both FROM chat.teacher_supervision_entry v
       WHERE v.kind = 'entry_void'
         AND (EXISTS (SELECT 1 FROM chat.teacher_violation x WHERE x.complaint_entry_id = v.refers_to)
              OR EXISTS (SELECT 1 FROM chat.teacher_supervision_entry r WHERE r.refers_to = v.refers_to AND r.kind = 'complaint_resolution'))`;
    expect(both).toBe(0);
  });

  it('P2: the strip gives each section only to the key that covers it; the feedback tiles count only the categories held', async () => {
    await files.addEntry(tsupId, s.teacherId, { kind: 'complaint', body: 'Late.', source: 'management' });
    await feedback.file(s.parentId, { learnerId: s.learnerId, category: 'praise', body: 'Kind.' });
    await feedback.file(s.parentId, { learnerId: s.learnerId, category: 'complaint', body: 'Short.' });
    const whole = await records.summary(tsupId, s.teacherId);
    expect(whole).toMatchObject({ openComplaints: 2, testimonials: 1, ladder: { counted: 0 } });
    const tiles = (t: Array<{ key: string; count: number }>) => Object.fromEntries(t.map((x) => [x.key, x.count]));
    expect(tiles(await feedback.dashboardCounts(tsupId))).toMatchObject({ 'feedback.received': 2 });

    await asGrantsOnly(async () => {
      expect(await records.access(tsupId)).toMatchObject({ attendance: { view: false }, grants: { view: true } });
      expect(await records.summary(tsupId, s.teacherId)).toMatchObject({ away: null, ladder: null, openComplaints: null, testimonials: 1, grants: 0 });
      expect(tiles(await feedback.dashboardCounts(tsupId))).toMatchObject({ 'feedback.received': 1 });
    });
  });

  it('P3: a lesson only booked, not yet begun, does not make a teacher "taught" -- a trial in three days names no trial family', async () => {
    const organizationId = (await g.prisma.teacher.findUniqueOrThrow({ where: { id: s.teacherId } })).organizationId;
    const prospect = await g.prisma.trialProspect.create({ data: { organizationId, displayName: 'prospect_q', createdBy: tsupId } });
    const start = Date.now() + 3 * 86_400_000;
    await g.prisma.lesson.create({
      data: {
        organizationId, kind: 'trial', prospectId: prospect.id, teacherId: s.teacherId,
        startsAt: new Date(start), endsAt: new Date(start + 1_800_000), createdByKind: 'staff', createdBy: tsupId,
      },
    });
    expect(await code(records.recordTestimonial(tsupId, s.teacherId, { body: 'x', source: 'other', prospectId: prospect.id }))).toBe('COMM.TEACHER_FILE_CONFLICT:409');
  });

  it('owner decision: a testimonial is corrected by the department that recorded it, the Operations Manager or the super admin', async () => {
    const t = await records.recordTestimonial(tsupId, s.teacherId, { body: 'Kind words.', source: 'staff_observation' });
    // admin_a holds grants.record (Operations) and sees the row, but did not record it.
    expect(await code(records.voidEntry(s.ownerId, t.id, { reason: 'x' }))).toBe('COMM.TEACHER_FILE_DENIED:403');
    await expect(
      g.prisma.$executeRawUnsafe(
        `insert into chat.teacher_supervision_entry (organization_id, teacher_id, kind, body, refers_to, created_by)
         values (chat.default_organization_id(), $1::uuid, 'entry_void', 'x', $2::uuid, $3::uuid)`,
        s.teacherId,
        t.id,
        s.ownerId,
      ),
    ).rejects.toThrow(/department that recorded it/);
    // The Operations Manager may.
    await records.voidEntry(s.managerId, t.id, { reason: 'Recorded for the wrong teacher.' });
    // An Operations testimonial is Operations' to correct; the Teachers department may not.
    const ops = await records.recordTestimonial(s.ownerId, s.teacherId, { body: 'Mother thanked her.', source: 'parent_call', learnerId: s.learnerId });
    expect(await code(records.voidEntry(tsupId, ops.id, { reason: 'x' }))).toBe('COMM.TEACHER_FILE_DENIED:403');
    await records.voidEntry(superId, ops.id, { reason: 'Wrong child.' });
    expect(await g.prisma.teacherSupervisionEntry.count({ where: { kind: 'entry_void', refersTo: ops.id } })).toBe(1);
  });
});
