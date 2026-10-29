/**
 * PD-44 PR-4 -- the Dashboard's Enrolment section, GET /dashboard/enrolment
 * (docs/product/pd044-manager-dashboard-plan.md §3.4, §6).
 *
 *   parity    every tile equals what the page it links to shows the same
 *             person at the same instant:
 *               trials.awaiting           GET /trials (TrialService.list, its
 *               trials.upcoming           default window) -- the "Needs a
 *                                         decision" and "Upcoming" tabs
 *               new_students.unassigned   GET /trials/new-students (page) --
 *               new_students.waiting      "Not assigned" and "Waiting for the
 *                                         parent" (a locked sign-up included)
 *   scope     the trial desk (Sales, Operations, the super admin) sees every
 *             trial, the Teachers department its PD-35 scope; New Students
 *             as the page filters it (Sales the unassigned, a supervisor
 *             their own children, the Operations manager and the super
 *             admin all)
 *   absent    a tile outside the caller's basis is left out, never sent as 0
 *   tenant    another organization's super admin counts nothing of this one
 *   bounded   the statements one request runs do not grow with the rows (N+1)
 *
 * Synthetic fixtures only (G-16).
 */
import { randomUUID } from 'node:crypto';
import { PrismaAuditService } from '@platform/audit.service';
import { CommError, CommErrorCode } from '@platform/errors';
import { PrismaService } from '@platform/prisma.service';
import { LessonService } from '../../src/lessons/lesson.service';
import { SchedulingService } from '../../src/lessons/scheduling.service';
import { TrialGroupService } from '../../src/lessons/trial-group.service';
import { TrialService } from '../../src/lessons/trial.service';
import { NewStudentsService } from '../../src/new-students/new-students.service';
import { NewStudentEnrolmentService } from '../../src/new-students/enrolment.service';
import { OrgStructureService } from '../../src/org/org-structure.service';
import { CardPoster } from '../../src/supervision/card-poster';
import type { DashboardTile } from '../../src/dashboard/dashboard-tile';
import { buildGraph, seed, truncate, Scenario } from './harness';

const logged = new PrismaService({ log: [{ emit: 'event', level: 'query' }] });
let statements = 0;
(logged as unknown as { $on(event: 'query', cb: () => void): void }).$on('query', () => {
  statements += 1;
});

const g = buildGraph(undefined, logged);
const audit = new PrismaAuditService();
const lessons = new LessonService(g.prisma, g.authz, g.conversations, g.outbox, g.config, audit);
const scheduling = new SchedulingService(g.prisma, g.authz, g.conversations, lessons, g.outbox, g.config, g.reminders, audit);
const groups = new TrialGroupService(g.prisma, g.authz, g.conversations, g.outbox, new CardPoster(g.conversations, g.outbox, audit), g.config, audit);
const trials = new TrialService(g.prisma, g.conversations, lessons, scheduling, audit, groups, new NewStudentsService(g.prisma));
const enrolment = new NewStudentEnrolmentService(
  g.prisma, g.authz, g.conversations, new NewStudentsService(g.prisma), lessons, scheduling,
  new OrgStructureService(g.prisma, g.authz, g.conversations, audit), audit,
);

// Each test records several subscribed trials before it starts.
jest.setTimeout(120_000);

const MIN = 60_000;
const TRIAL_KEYS = ['trials.awaiting', 'trials.upcoming'] as const;
const STUDENT_KEYS = ['new_students.unassigned', 'new_students.waiting'] as const;

let s: Scenario;
let tsupId: string;
let salesId: string;
let financeId: string;
let sa: string;
let sa2: string;
let org2: string;
let hour = 0;

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
const both = async (actorId: string) => [...(await trials.dashboardCounts(actorId)), ...(await enrolment.dashboardCounts(actorId))];

async function counted<T>(run: () => Promise<T>): Promise<{ result: T; n: number }> {
  statements = 0;
  const result = await run();
  return { result, n: statements };
}

async function department(kind: string, staffIds: string[]) {
  const [{ id }] = await g.prisma.$queryRawUnsafe<Array<{ id: string }>>(
    `insert into chat.department (kind, display_name) values ($1, $1) returning id::text as id`, kind,
  );
  for (const staffId of staffIds) {
    await g.prisma.$executeRawUnsafe(
      `insert into chat.department_member (staff_id, organization_id, department_id, position)
       values ($1::uuid, chat.default_organization_id(), $2::uuid, 'supervisor')`,
      staffId, id,
    );
  }
}

/** A trial lesson `offsetMin` from now; one teacher, never two lessons at once. */
async function trialAt(offsetMin: number): Promise<string> {
  const prospectId = (await trials.createProspect(salesId, { displayName: `prospect_${randomUUID().slice(0, 6)}` })).id;
  const startsAt = new Date(Date.now() + offsetMin * MIN);
  const lesson = await g.prisma.lesson.create({
    data: {
      organizationId: (await g.prisma.teacher.findUniqueOrThrow({ where: { id: s.teacherId } })).organizationId,
      kind: 'trial', prospectId, teacherId: s.teacherId, startsAt, endsAt: new Date(startsAt.getTime() + 30 * MIN),
      createdByKind: 'staff', createdBy: salesId,
    },
  });
  return lesson.id;
}

/** A past trial, each on its own hour. */
const pastTrial = () => trialAt(-(60 + 60 * ++hour));

/** A past trial with Sales' "subscribed" decision and its form: a New Students entry. */
async function subscribedTrial(): Promise<string> {
  const id = await pastTrial();
  await trials.outcome(salesId, id, {
    result: 'subscribed',
    subscription: {
      parent: { name: 'parent_e', email: `parent.${randomUUID().slice(0, 8)}@example.test`, phone: '+99 000 555 666' },
      children: [
        { name: 'child_e', age: 9, course: 'course_e', teacherId: s.teacherId, packagePrice: 1000, lessonPrice: 125,
          schedule: [{ weekday: 2, time: '17:00' }] },
      ],
      payment: { currency: 'EGP', method: 'invoice' },
    },
  });
  return id;
}

/** The trial attended, with no decision yet ("awaiting"), written as data. */
async function held(lessonId: string) {
  await g.prisma.$transaction([
    g.prisma.$executeRawUnsafe(`set local session_replication_role = replica`),
    g.prisma.$executeRawUnsafe(
      `update chat.lesson set outcome = 'held', outcome_by_kind = 'staff', outcome_by = $2::uuid, outcome_at = now()
        where id = $1::uuid`,
      lessonId, salesId,
    ),
  ]);
}

/** The parent of this enrolment finished signing up (an account with a password). */
async function signedUp(trialId: string) {
  const e = await g.prisma.studentEnrolment.findUniqueOrThrow({ where: { lessonId: trialId } });
  await g.prisma.$executeRawUnsafe(
    `insert into chat.account_credential (account_id, password_hash) values ($1::uuid, 'fixture-hash')`, e.accountId,
  );
}

/** What the Trials page's tabs and the New Students page's filters show this person. */
async function pages(actorId: string, trialDesk: boolean, studentsPage: boolean) {
  const out: Record<string, number | undefined> = {};
  if (trialDesk) {
    const list = (await trials.list(actorId, {})).trials;
    out['trials.awaiting'] = list.filter((t) => t.outcome === 'awaiting').length;
    out['trials.upcoming'] = list.filter((t) => t.outcome === 'upcoming').length;
  }
  if (studentsPage) {
    const students = (await enrolment.page(actorId)).students;
    out['new_students.unassigned'] = students.filter((x) => x.enrolment === null).length;
    out['new_students.waiting'] = students.filter((x) => x.enrolment !== null && x.enrolment.parentSignup.state !== 'signed_up').length;
  }
  return out;
}

/** Every tile against the pages it links to; a page the person cannot open has no tiles. */
async function expectParity(actorId: string, trialDesk: boolean, studentsPage: boolean) {
  const tiles = await both(actorId);
  const page = await pages(actorId, trialDesk, studentsPage);
  for (const k of TRIAL_KEYS) expect({ actorId, k, n: tileOf(tiles, k)?.count }).toEqual({ actorId, k, n: trialDesk ? page[k] : undefined });
  for (const k of STUDENT_KEYS) expect({ actorId, k, n: tileOf(tiles, k)?.count }).toEqual({ actorId, k, n: studentsPage ? page[k] : undefined });
}

// ---------------------------------------------------------------------------

beforeAll(async () => {
  await g.prisma.$connect();
});
afterAll(async () => {
  await truncate(g.prisma);
  await g.prisma.$executeRawUnsafe(`delete from chat.organization where slug like 'pd044e-%'`).catch(() => undefined);
  await g.prisma.$disconnect();
});
beforeEach(async () => {
  await truncate(g.prisma);
  await g.prisma.$executeRawUnsafe(`delete from chat.organization where slug like 'pd044e-%'`).catch(() => undefined);
  await g.prisma.$executeRaw`UPDATE chat.config SET value = 'false'::jsonb WHERE key = 'teacher_supervisor.strict_scope'`;
  s = await seed(g.prisma);
  hour = 0;
  [tsupId, salesId, financeId, sa, sa2, org2] = [randomUUID(), randomUUID(), randomUUID(), randomUUID(), randomUUID(), randomUUID()];
  await g.prisma.$executeRawUnsafe(
    `insert into chat.staff (id, name, role, is_active) values
       ($1::uuid, 'tsup_e', 'admin', true), ($2::uuid, 'sales_e', 'admin', true), ($3::uuid, 'fin_e', 'finance', true)`,
    tsupId, salesId, financeId,
  );
  await g.prisma.$executeRawUnsafe(`insert into chat.organization (id, slug, display_name) values ($1::uuid, $2, 'org_two')`, org2, `pd044e-${org2.slice(0, 8)}`);
  await g.prisma.$transaction([
    g.prisma.$executeRawUnsafe(`select set_config('chat.provisioning_super_admin', 'on', true)`),
    g.prisma.$executeRawUnsafe(`insert into chat.staff (id, name, role, is_active) values ($1::uuid, 'sa_e', 'super_admin', true)`, sa),
    g.prisma.$executeRawUnsafe(
      `insert into chat.staff (id, name, role, is_active, organization_id) values ($1::uuid, 'sa_two_e', 'super_admin', true, $2::uuid)`, sa2, org2,
    ),
  ]);
  await department('teachers', [tsupId]);
  await department('sales', [salesId]);
});

// ---------------------------------------------------------------------------

describe('GET /dashboard/enrolment -- trials and new students', () => {
  beforeEach(async () => {
    // New Students: one waiting for its parent (admin_a's), one signed up (admin_a's), one not assigned.
    const waiting = await subscribedTrial();
    await enrolment.assign(s.managerId, waiting, { supervisorId: s.ownerId });
    const done = await subscribedTrial();
    await enrolment.assign(s.managerId, done, { supervisorId: s.ownerId });
    await signedUp(done);
    await subscribedTrial();
    // Trials: one started with nothing recorded, one attended without a decision, two to come.
    await pastTrial();
    await held(await pastTrial());
    await trialAt(24 * 60);
    await trialAt(48 * 60);
  });

  it('equals the Trials tabs and the New Students filters for every persona', async () => {
    // [persona, works the trial desk or the Teachers queue, opens New Students]
    const personas: Array<[string, boolean, boolean]> = [
      [s.managerId, true, true], // the Operations manager: every trial, every entry
      [salesId, true, true], // Sales: every trial, the entries not yet assigned
      [s.ownerId, true, true], // an Operations supervisor: every trial, their own children's entries
      [s.otherAdminId, true, true], // an Operations supervisor with no new children
      [tsupId, true, false], // the Teachers department: its trials; New Students is not theirs
      [sa, true, true],
      [sa2, true, true],
    ];
    for (const [p, desk, students] of personas) await expectParity(p, desk, students);

    const mgr = await both(s.managerId);
    expect(tileOf(mgr, 'trials.awaiting')?.count).toBe(2);
    expect(tileOf(mgr, 'trials.upcoming')?.count).toBe(2);
    expect(tileOf(mgr, 'new_students.unassigned')?.count).toBe(1);
    expect(tileOf(mgr, 'new_students.waiting')?.count).toBe(1);
    // Sales sees only what is not yet assigned; admin_b none of admin_a's children.
    expect(tileOf(await both(salesId), 'new_students.waiting')?.count).toBe(0);
    expect(tileOf(await both(salesId), 'new_students.unassigned')?.count).toBe(1);
    expect(tileOf(await both(s.otherAdminId), 'new_students.waiting')?.count).toBe(0);
    expect(tileOf(await both(s.ownerId), 'new_students.waiting')?.count).toBe(1);
  });

  it('narrows a strict Teachers supervisor to their teachers, as the Trials page does', async () => {
    await g.prisma.$executeRaw`UPDATE chat.config SET value = 'true'::jsonb WHERE key = 'teacher_supervisor.strict_scope'`;
    await expectParity(tsupId, true, false);
    // tsup_e is assigned no teacher: no trial is theirs.
    expect((await both(tsupId)).every((t) => t.count === 0)).toBe(true);
    await g.prisma.$executeRaw`UPDATE chat.config SET value = 'false'::jsonb WHERE key = 'teacher_supervisor.strict_scope'`;
  });

  it('leaves out what the caller cannot open, and refuses anyone who is not staff', async () => {
    expect(keys(await both(tsupId))).toEqual([...TRIAL_KEYS].sort());
    expect(keys(await both(s.managerId))).toEqual([...TRIAL_KEYS, ...STUDENT_KEYS].sort());
    expect(await both(financeId)).toEqual([]);
    expect(await code(trials.dashboardCounts(s.parentId))).toBe(CommErrorCode.LESSON_DENIED);
    expect(await code(enrolment.dashboardCounts(s.parentId))).toBe(CommErrorCode.LESSON_DENIED);
    expect(await code(trials.dashboardCounts(s.teacherId))).toBe(CommErrorCode.LESSON_DENIED);
    expect((await both(sa2)).every((t) => t.count === 0)).toBe(true);
    expect((await both(sa)).every((t) => t.capped === false)).toBe(true);
  });

  it('runs the same number of statements for a few rows as for many (no N+1)', async () => {
    g.config.invalidate();
    const small = await counted(() => both(s.managerId));
    for (let i = 0; i < 4; i += 1) await subscribedTrial();
    for (let i = 0; i < 6; i += 1) await pastTrial();
    g.config.invalidate();
    const large = await counted(() => both(s.managerId));
    await expectParity(s.managerId, true, true);
    expect(tileOf(large.result, 'new_students.unassigned')?.count).toBe(5);
    expect(large.n).toBe(small.n);
  });
});
