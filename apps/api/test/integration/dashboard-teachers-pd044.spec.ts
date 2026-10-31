/**
 * PD-44 PR-6 -- the Dashboard's Teachers section, GET /dashboard/teachers
 * (docs/product/pd044-manager-dashboard-plan.md §3.6, §6).
 *
 *   parity    every tile equals what the list it links to shows the same
 *             person at the same instant:
 *               leave.pending          GET /teacher-leave-requests?state=requested
 *               absences.open          GET /discipline/violations?state=open&kind=absences
 *               lateness.open          GET /discipline/violations?state=open&kind=late
 *               feedback.received      GET /parent-feedback?status=received
 *               feedback.in_review     GET /parent-feedback?status=in_review
 *               certificates.student_requested / .teacher_requested
 *                                      GET /certificates?category=student|teacher&status=pending
 *               teacher_profiles.pending
 *                                      GET /teacher-profiles/review
 *   scope     the page's own rule (PD-35 / PD-26): the Teachers department
 *             whole; the Operations manager and an Operations supervisor
 *             (Q6) on the Operations basis -- teacher-level rows whole, rows
 *             about one child only for their own families. family_y's child
 *             shares teacher_c with family_x, so the shared teacher's
 *             child-level rows for family_y must not count for admin_a.
 *   absent    a tile outside the caller's basis is left out, never sent as 0
 *   bounded   the statements one request runs do not grow with the rows (N+1)
 *
 * Synthetic fixtures only (G-16).
 */
import { randomUUID } from 'node:crypto';
import { PrismaAuditService } from '@platform/audit.service';
import { CommError, CommErrorCode } from '@platform/errors';
import { PermissionService } from '@platform/permissions/permission.service';
import { LocalFsBlobStore } from '@communication/attachments/blob-store';
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
import { ParentFeedbackService } from '../../src/teacher-file/parent-feedback.service';
import { CertificateService } from '../../src/certificates/certificate.service';
import { CertificateTypeService } from '../../src/certificates/certificate-type.service';
import type { DashboardTile } from '../../src/dashboard/dashboard-tile';
import { buildGraph, seed, truncate, withAssignmentGate, Scenario } from './harness';
import { statementCounter } from './statement-counter';

const counter = statementCounter();

const g = buildGraph(undefined, counter.prisma);
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
const feedback = new ParentFeedbackService(g.prisma, g.conversations, files, audit);
const permissions = new PermissionService(g.prisma);
const certificates = new CertificateService(g.prisma, g.conversations, supervision, cards, g.storage, audit, permissions, g.stories);
const types = new CertificateTypeService(g.prisma, g.conversations, permissions, audit);
const profiles = g.teacherProfiles;
const blobs = new LocalFsBlobStore();

jest.setTimeout(120_000);

const HOUR = 3_600_000;
const at = (ms: number) => new Date(Date.now() + ms).toISOString();

const SUPERVISION_KEYS = ['leave.pending', 'absences.open', 'lateness.open', 'feedback.received', 'feedback.in_review'] as const;
const CERTIFICATE_KEYS = ['certificates.student_requested', 'certificates.teacher_requested'] as const;
const PROFILE_KEYS = ['teacher_profiles.pending'] as const;

let s: Scenario;
let tsupId: string;
let tmgrId: string;
let superId: string;
let outsiderId: string;
let today: string;
let juzTypeId: string;
let teacherTypeId: string;
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

const tileOf = (tiles: DashboardTile[], key: string) => tiles.find((t) => t.key === key);
const keys = (tiles: DashboardTile[]) => tiles.map((t) => t.key).sort();
const all = async (actorId: string) => [
  ...(await leave.dashboardCounts(actorId)),
  ...(await discipline.dashboardCounts(actorId)),
  ...(await feedback.dashboardCounts(actorId)),
  ...(await certificates.dashboardCounts(actorId)),
  ...(await profiles.dashboardCounts(actorId)),
];

const counted = counter.counted;

function plusDays(day: string, n: number): string {
  return new Date(Date.parse(`${day}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
}

/** A lesson of `learnerId` with its teacher, held `ago` before now. */
async function heldLesson(learnerId = s.learnerId): Promise<string> {
  const start = -3 * HOUR - (slot++ % 20) * 40 * 60_000;
  const id = (await lessons.schedule(tsupId, { learnerId, startsAt: at(start), endsAt: at(start + HOUR / 2) })).id;
  await lessons.report(s.teacherId, id, { covered: 'Al-Mulk' });
  return id;
}

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
    familyId, s.otherAdminId,
  );
  await g.prisma.$executeRawUnsafe(
    `insert into chat.contact (id, family_id, name, role_preset, can_message, is_active)
     values ($1::uuid, $2::uuid, 'parent_y', 'primary_guardian', true, true)`,
    parentId, familyId,
  );
  await withAssignmentGate(
    g.prisma,
    `insert into chat.learner (id, family_id, name, teacher_id)
     values ('${learnerId}'::uuid, '${familyId}'::uuid, 'learner_n', '${s.teacherId}'::uuid)`,
  );
  await g.prisma.$executeRawUnsafe(
    `insert into chat.learner_supervision (learner_id, organization_id, supervisor_id, assigned_by)
     values ($1::uuid, chat.default_organization_id(), $2::uuid, $3::uuid)`,
    learnerId, s.otherAdminId, s.managerId,
  );
  return { familyId, parentId, learnerId };
}

/** A teacher's credential upload, waiting for review (the client's authorize-then-claim). */
async function pendingCredential(teacherId: string, title: string): Promise<void> {
  const authorization = await profiles.authorizeCertificateUpload(teacherId, { mimeType: 'application/pdf', byteSize: 1024 });
  const pdf = Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.alloc(1024 - 16, 0x20), Buffer.from('\n%%EOF\n')]);
  await blobs.put(authorization.uploadToken, 'application/pdf', pdf);
  await profiles.addCertificate(teacherId, { title, mimeType: 'application/pdf', byteSize: 1024, uploadToken: authorization.uploadToken });
}

/** What each page shows this person (absent: the page refuses them). */
async function pages(actorId: string) {
  const out: Record<string, number | undefined> = {};
  const shown = async (key: string, run: () => Promise<number>) => {
    try {
      out[key] = await run();
    } catch (e) {
      if (!(e instanceof CommError)) throw e;
    }
  };
  await shown('leave.pending', async () => (await leave.list(actorId, { state: 'requested' })).requests.length);
  await shown('absences.open', async () => (await discipline.list(actorId, { state: 'open', kind: 'absences' })).violations.length);
  await shown('lateness.open', async () => (await discipline.list(actorId, { state: 'open', kind: 'late' })).violations.length);
  await shown('feedback.received', async () => (await feedback.list(actorId, { status: 'received' })).feedback.length);
  await shown('feedback.in_review', async () => (await feedback.list(actorId, { status: 'in_review' })).feedback.length);
  // The Certificates page shows a category's tab only to whom it reaches (CertificatesPage's own rule).
  const a = await certificates.access(actorId);
  for (const category of ['student', 'teacher'] as const) {
    if (!a.view || !(a.design || a.categories[category].request || a.categories[category].oversee)) continue;
    await shown(`certificates.${category}_requested`, async () => (await certificates.list(actorId, { category, status: 'pending' })).certificates.length);
  }
  await shown('teacher_profiles.pending', async () => (await profiles.certificateReviewQueue(actorId)).length);
  return out;
}

/** Tile == list for each key the page shows; no tile for a page that refuses them. */
async function expectParity(actorId: string) {
  const tiles = await all(actorId);
  const page = await pages(actorId);
  for (const k of [...SUPERVISION_KEYS, ...CERTIFICATE_KEYS, ...PROFILE_KEYS]) {
    expect({ actorId, k, n: tileOf(tiles, k)?.count }).toEqual({ actorId, k, n: page[k] });
  }
}

// ---------------------------------------------------------------------------

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
  [tsupId, tmgrId, superId, outsiderId] = [randomUUID(), randomUUID(), randomUUID(), randomUUID()];
  await g.prisma.$executeRawUnsafe(
    `insert into chat.staff (id, name, role, is_active)
     values ($1::uuid, 'tsup_a', 'admin', true), ($2::uuid, 'tmgr_b', 'manager', true), ($3::uuid, 'admin_z', 'admin', true)`,
    tsupId, tmgrId, outsiderId,
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
    tsupId, dept,
  );
  [{ today }] = await g.prisma.$queryRaw<Array<{ today: string }>>`SELECT chat.academy_today()::text AS today`;
  juzTypeId = (await types.create(superId, { category: 'student', key: 'juz_completed', labelEn: "Juz' completed", labelAr: 'إتمام جزء', needsJuz: true })).type.id;
  teacherTypeId = (await types.create(superId, { category: 'teacher', key: 'teacher_of_month', labelEn: 'Teacher of the Month', labelAr: 'المعلم المثالي', needsPeriod: 'month' })).type.id;
});

// ---------------------------------------------------------------------------

describe('GET /dashboard/teachers -- leave, absences, lateness, feedback, certificates, credentials', () => {
  let y: { familyId: string; parentId: string; learnerId: string };

  beforeEach(async () => {
    y = await otherFamily();
    // Leave: two of teacher_c's (one of them withdrawn later is not pending), one of teacher_e's (nobody's of admin_a).
    await leave.request(s.teacherId, { firstDay: plusDays(today, 30), lastDay: plusDays(today, 31), reason: 'family' });
    await leave.request(s.teacherId, { firstDay: plusDays(today, 40), lastDay: plusDays(today, 41), reason: 'family' });
    await leave.request(s.unrelatedTeacherId, { firstDay: plusDays(today, 50), lastDay: plusDays(today, 51), reason: 'family' });
    // Absences, teacher-level: teacher_c's and teacher_e's, undecided.
    await discipline.recordAbsence(tsupId, s.teacherId, { occurredOn: today, note: 'a staff meeting' });
    await discipline.recordAbsence(tsupId, s.unrelatedTeacherId, { occurredOn: today, note: 'a staff meeting' });
    // Lateness, about one child: teacher_c late for learner_l (family_x) and for learner_n (family_y).
    await discipline.recordLateness(tsupId, await heldLesson(s.learnerId), { minutes: 15 });
    await discipline.recordLateness(tsupId, await heldLesson(y.learnerId), { minutes: 20 });
    // Feedback about teacher_c, from both families; family_x's second one taken (in review).
    await feedback.file(s.parentId, { learnerId: s.learnerId, category: 'praise', body: 'Thank you.' });
    const taken = await feedback.file(s.parentId, { learnerId: s.learnerId, category: 'suggestion', body: 'More revision.' });
    await feedback.take(tsupId, taken.id);
    await feedback.file(y.parentId, { learnerId: y.learnerId, category: 'complaint', body: 'Too fast.' });
    // Certificates: a student request (admin_a, for learner_l) and a teacher one (the Teachers department).
    await certificates.create(s.ownerId, {
      category: 'student', typeId: juzTypeId, learnerId: s.learnerId, printedName: 'learner_l', juz: 30, requestKey: randomUUID(),
    });
    await certificates.create(tsupId, {
      category: 'teacher', typeId: teacherTypeId, teacherId: s.teacherId, printedName: 'teacher_c', periodStart: '2026-10-01', requestKey: randomUUID(),
    });
    // A credential teacher_c uploaded, waiting for review.
    await pendingCredential(s.teacherId, 'Ijazah');
  });

  it('equals each list for every persona', async () => {
    for (const p of [tmgrId, tsupId, s.managerId, s.ownerId, s.otherAdminId, superId, outsiderId]) await expectParity(p);
  });

  it('the Teachers department counts every teacher whole', async () => {
    const t = await all(tmgrId);
    expect(SUPERVISION_KEYS.map((k) => tileOf(t, k)?.count)).toEqual([3, 2, 2, 2, 1]);
  });

  it('an Operations supervisor (Q6): her teachers, and of the shared teacher only her own families\' child-level rows', async () => {
    const t = await all(s.ownerId);
    // leave and absences are teacher-level: teacher_c's count whole, teacher_e's not at all.
    // lateness and feedback are about one child: learner_l's count, learner_n's (family_y) do not.
    expect(SUPERVISION_KEYS.map((k) => tileOf(t, k)?.count)).toEqual([2, 1, 1, 1, 1]);
    // admin_b supervises family_y: teacher_c through learner_n, so its child-level rows are family_y's.
    const b = await all(s.otherAdminId);
    expect(SUPERVISION_KEYS.map((k) => tileOf(b, k)?.count)).toEqual([2, 1, 1, 1, 0]);
    // The Operations manager: the whole department's families.
    const m = await all(s.managerId);
    expect(SUPERVISION_KEYS.map((k) => tileOf(m, k)?.count)).toEqual([2, 1, 2, 2, 1]);
  });

  it('leaves out what the caller cannot open, and refuses anyone who is not staff', async () => {
    // A staff member outside both departments, holding neither certificate nor review rights, has no tile at all.
    expect(keys(await leave.dashboardCounts(outsiderId))).toEqual([]);
    expect(keys(await discipline.dashboardCounts(outsiderId))).toEqual([]);
    expect(keys(await feedback.dashboardCounts(outsiderId))).toEqual([]);
    expect(keys(await all(superId))).toEqual([...SUPERVISION_KEYS, ...CERTIFICATE_KEYS, ...PROFILE_KEYS].sort());
    expect(await code(leave.dashboardCounts(s.parentId))).toBe(CommErrorCode.LEAVE_DENIED);
    expect(await code(discipline.dashboardCounts(s.parentId))).toBe(CommErrorCode.DISCIPLINE_DENIED);
    expect(await code(feedback.dashboardCounts(s.parentId))).toBe(CommErrorCode.TEACHER_FILE_DENIED);
    expect(await code(certificates.dashboardCounts(s.parentId))).toBe(CommErrorCode.CERTIFICATE_DENIED);
    expect(await code(profiles.dashboardCounts(s.parentId))).toBe(CommErrorCode.TEACHER_PROFILE_CANNOT_REVIEW);
    expect((await all(superId)).every((t) => t.capped === false)).toBe(true);
  });

  it('follows a decision: a decided violation and a resolved feedback leave their tiles', async () => {
    const [late] = (await discipline.list(tmgrId, { state: 'open', kind: 'late' })).violations;
    await discipline.decide(tmgrId, late!.id, { decision: 'warning', note: 'a first lateness: a warning' });
    // A reply resolves praise (PD-32): it leaves the received tile.
    const [praise] = (await feedback.list(tmgrId, { status: 'received', category: 'praise' })).feedback;
    await feedback.reply(tmgrId, praise!.id, { response: 'Thank you!' });
    await expectParity(tmgrId);
    const t = await all(tmgrId);
    expect([tileOf(t, 'lateness.open')?.count, tileOf(t, 'feedback.received')?.count]).toEqual([1, 1]);
  });

  it('runs the same number of statements for a few rows as for many (no N+1)', async () => {
    g.config.invalidate();
    const small = await counted(() => all(superId));
    for (let i = 0; i < 4; i += 1) {
      await leave.request(s.teacherId, { firstDay: plusDays(today, 60 + i * 3), lastDay: plusDays(today, 61 + i * 3), reason: 'family' });
      await discipline.recordAbsence(tsupId, s.teacherId, { occurredOn: plusDays(today, -(i + 1)), note: `meeting ${i}` });
      await discipline.recordLateness(tsupId, await heldLesson(s.learnerId), { minutes: 10 + i });
    }
    // learner_m's (at most 3 a child a day, PD-32): teacher_d's, so it adds to the received tile's candidates.
    for (let i = 0; i < 3; i += 1) await feedback.file(s.parentId, { learnerId: s.secondLearnerId, category: 'praise', body: `Thanks ${i}.` });
    await pendingCredential(s.newTeacherId, 'Tajweed');
    g.config.invalidate();
    const large = await counted(() => all(superId));
    await expectParity(superId);
    expect(tileOf(large.result, 'leave.pending')?.count).toBe(7);
    expect(large.n).toBe(small.n);
  });
});
