/**
 * PD-44 PR-7 -- the Dashboard's Organization section, GET /dashboard/structure
 * (docs/product/pd044-manager-dashboard-plan.md §3.7, §6).
 *
 *   parity    every tile equals what the Organization page shows the same
 *             person at the same instant:
 *               learners.unsupervised  the Children tab, filter "Not assigned"
 *                                      (GET /org/learners, 2000 rows, then the filter)
 *               teachers.unsupervised  the Teachers tab's banner (GET /org/teacher-assignments)
 *               covers.active          the "covered by" badges on the Structure tab
 *                                      (GET /org/covers?active=true, status active)
 *   absent    a tile comes only to whom the page shows its tab: the Children
 *             tab and the covers to the super admin and the Operations
 *             Manager, the Teachers tab to the super admin and the Teachers
 *             Manager; anyone else gets none, never a 0
 *   bounded   the statements one request runs do not grow with the rows (N+1)
 *
 * Not built (plan §9.1): families.without_supervisor and backups.expiring --
 * no page lists them.
 *
 * Synthetic fixtures only (G-16).
 */
import { randomUUID } from 'node:crypto';
import { PrismaAuditService } from '@platform/audit.service';
import { CommError, CommErrorCode } from '@platform/errors';
import { PrismaService } from '@platform/prisma.service';
import { TeacherScopeService } from '@platform/teacher-scope';
import { SeatPolicyRegistry } from '@communication/seats/seat-policy';
import { OrgStructureService } from '../../src/org/org-structure.service';
import { SupervisorCoverService } from '../../src/org/supervisor-cover.service';
import { TeacherSupervisorService } from '../../src/teacher-supervisors/teacher-supervisor.service';
import { SupervisionConversationService } from '../../src/supervision/supervision-conversation.service';
import { CardPoster } from '../../src/supervision/card-poster';
import { TrialGroupService } from '../../src/lessons/trial-group.service';
import type { DashboardTile } from '../../src/dashboard/dashboard-tile';
import { buildGraph, seed, truncate, withAssignmentGate, Scenario } from './harness';

const logged = new PrismaService({ log: [{ emit: 'event', level: 'query' }] });
let statements = 0;
(logged as unknown as { $on(event: 'query', cb: () => void): void }).$on('query', () => {
  statements += 1;
});

const g = buildGraph(undefined, logged);
const audit = new PrismaAuditService();
const scope = new TeacherScopeService(g.prisma);
const supervisionChats = new SupervisionConversationService(g.prisma, g.authz, g.conversations, g.outbox, audit, scope);
const cards = new CardPoster(g.conversations, g.outbox, audit);
const trialGroups = new TrialGroupService(g.prisma, g.authz, g.conversations, g.outbox, cards, g.config, audit);
const org = new OrgStructureService(g.prisma, g.authz, g.conversations, audit);
const covers = new SupervisorCoverService(g.prisma, g.authz, g.conversations, g.notifications, g.config, audit);
const supervisors = new TeacherSupervisorService(g.prisma, g.conversations, new SeatPolicyRegistry(), scope, supervisionChats, trialGroups, audit);

jest.setTimeout(120_000);

const HOUR = 3_600_000;
const KEYS = ['learners.unsupervised', 'teachers.unsupervised', 'covers.active'] as const;

let s: Scenario;
let tmgr: string;
let tsup: string;
let obak: string;
let superId: string;

async function code(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (e) {
    if (e instanceof CommError) return e.code;
    throw e;
  }
  throw new Error('expected a refusal, got success');
}

const exec = (sql: string, ...args: unknown[]) => g.prisma.$executeRawUnsafe(sql, ...args);
const tileOf = (tiles: DashboardTile[], key: string) => tiles.find((t) => t.key === key);
const keys = (tiles: DashboardTile[]) => tiles.map((t) => t.key).sort();
const all = async (actorId: string) => [
  ...(await org.dashboardCounts(actorId)),
  ...(await supervisors.dashboardCounts(actorId)),
  ...(await covers.dashboardCounts(actorId)),
];

async function counted<T>(run: () => Promise<T>): Promise<{ result: T; n: number }> {
  statements = 0;
  const result = await run();
  return { result, n: statements };
}

/** A family of `n` children nobody supervises yet (taught by teacher_c). */
async function unsupervisedFamily(n: number): Promise<void> {
  const familyId = randomUUID();
  await exec(`insert into chat.family (id, display_name, owner_id, language) values ($1::uuid, 'family_z', $2::uuid, 'ar')`, familyId, s.ownerId);
  for (let i = 0; i < n; i += 1) {
    await withAssignmentGate(
      g.prisma,
      `insert into chat.learner (id, family_id, name, teacher_id)
       values ('${randomUUID()}'::uuid, '${familyId}'::uuid, 'learner_z${i}', '${s.teacherId}'::uuid)`,
    );
  }
}

/** A live teacher, nobody's yet. */
async function teacher(name: string): Promise<string> {
  const id = randomUUID();
  await exec(`insert into chat.teacher (id, name, is_active) values ($1::uuid, $2, true)`, id, name);
  return id;
}

/**
 * What the Organization page shows this person -- only the tabs it shows them:
 * Children and the Structure tab's covers with an Operations department in
 * view, Teachers to whom assigns teachers.
 */
async function pages(actorId: string) {
  const out: Record<string, number | undefined> = {};
  let operations = false;
  try {
    operations = (await org.structure(actorId)).departments.some((d) => d.kind === 'operations');
  } catch (e) {
    if (!(e instanceof CommError)) throw e;
  }
  if (operations) {
    out['learners.unsupervised'] = (await org.learners(actorId, { unassigned: true })).learners.length;
    out['covers.active'] = (await covers.list(actorId, { active: 'true' })).covers.filter((c) => c.status === 'active').length;
  }
  try {
    out['teachers.unsupervised'] = (await supervisors.assignments(actorId)).unassigned;
  } catch (e) {
    if (!(e instanceof CommError)) throw e;
  }
  return out;
}

async function expectParity(actorId: string) {
  const tiles = await all(actorId);
  const page = await pages(actorId);
  for (const k of KEYS) expect({ actorId, k, n: tileOf(tiles, k)?.count }).toEqual({ actorId, k, n: page[k] });
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
  s = await seed(g.prisma);
  [tmgr, tsup, obak, superId] = [randomUUID(), randomUUID(), randomUUID(), randomUUID()];
  await exec(
    `insert into chat.staff (id, name, role, is_active)
     values ($1::uuid, 'tmgr_x', 'manager', true), ($2::uuid, 'tsup_a', 'admin', true), ($3::uuid, 'obak_c', 'admin', true)`,
    tmgr, tsup, obak,
  );
  await g.prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`select set_config('chat.provisioning_super_admin', 'on', true)`);
    await tx.$executeRawUnsafe(`insert into chat.staff (id, name, role, is_active) values ($1::uuid, 'root_d', 'super_admin', true)`, superId);
  });
  const [{ id: teachersDept }] = await g.prisma.$queryRawUnsafe<Array<{ id: string }>>(
    `insert into chat.department (kind, display_name, manager_id) values ('teachers', 'teachers', $1::uuid) returning id::text as id`,
    tmgr,
  );
  await exec(
    `insert into chat.department_member (staff_id, organization_id, department_id, position)
     values ($1::uuid, chat.default_organization_id(), $2::uuid, 'supervisor')`,
    tsup, teachersDept,
  );
  // Operations' backup supervisor, so a supervisor of the department can hand over (PD-33).
  await exec(
    `insert into chat.department_member (staff_id, organization_id, department_id, position)
     values ($1::uuid, chat.default_organization_id(), $2::uuid, 'backup_supervisor')`,
    obak, s.departmentId,
  );
});

// ---------------------------------------------------------------------------

describe('GET /dashboard/structure -- children and teachers without a supervisor, covers under way', () => {
  beforeEach(async () => {
    // family_z: two children nobody supervises (family_x's two are admin_a's).
    await unsupervisedFamily(2);
    // teacher_c is tsup_a's; teacher_d and teacher_e are nobody's.
    await supervisors.assign(tmgr, s.teacherId, { supervisorId: tsup });
    // admin_a is away now, covered by obak_c; admin_b's cover starts in two days (scheduled, not counted).
    await covers.start(s.managerId, { supervisorId: s.ownerId, backupId: obak, until: new Date(Date.now() + 4 * HOUR).toISOString() });
    await covers.start(s.managerId, {
      supervisorId: s.otherAdminId,
      backupId: obak,
      from: new Date(Date.now() + 48 * HOUR).toISOString(),
      until: new Date(Date.now() + 52 * HOUR).toISOString(),
    });
  });

  it('equals the Organization page for every persona', async () => {
    for (const p of [s.managerId, tmgr, superId, s.ownerId, tsup]) await expectParity(p);
  });

  it('gives each manager the tabs their page shows, with the counts it shows', async () => {
    const ops = await all(s.managerId);
    expect(keys(ops)).toEqual(['covers.active', 'learners.unsupervised']);
    expect([tileOf(ops, 'learners.unsupervised')?.count, tileOf(ops, 'covers.active')?.count]).toEqual([2, 1]);
    const teachers = await all(tmgr);
    expect(keys(teachers)).toEqual(['teachers.unsupervised']);
    const unassigned = (await supervisors.assignments(tmgr)).unassigned;
    expect(tileOf(teachers, 'teachers.unsupervised')?.count).toBe(unassigned);
    expect(keys(await all(superId))).toEqual([...KEYS].sort());
  });

  it('follows the facts: an assignment and a new teacher move the teachers tile, a supervised child leaves the children tile', async () => {
    const before = tileOf(await all(tmgr), 'teachers.unsupervised')!.count;
    await teacher('teacher_n');
    expect(tileOf(await all(tmgr), 'teachers.unsupervised')?.count).toBe(before + 1);
    await supervisors.assign(tmgr, s.newTeacherId, { supervisorId: tsup });
    expect(tileOf(await all(tmgr), 'teachers.unsupervised')?.count).toBe(before);
    const [child] = (await org.learners(s.managerId, { unassigned: true })).learners;
    await exec(
      `insert into chat.learner_supervision (learner_id, organization_id, supervisor_id, assigned_by)
       values ($1::uuid, chat.default_organization_id(), $2::uuid, $3::uuid)`,
      child!.learnerId, s.otherAdminId, s.managerId,
    );
    await expectParity(s.managerId);
    expect(tileOf(await all(s.managerId), 'learners.unsupervised')?.count).toBe(1);
  });

  it('leaves out what the caller cannot open, and refuses anyone who is not staff', async () => {
    // A supervisor opens no Organization page: no tile, not a refusal.
    expect(await all(s.ownerId)).toEqual([]);
    expect(await all(tsup)).toEqual([]);
    expect(await code(org.dashboardCounts(s.parentId))).toBe(CommErrorCode.ORG_STRUCTURE_DENIED);
    expect(await code(supervisors.dashboardCounts(s.parentId))).toBe(CommErrorCode.TEACHER_FILE_DENIED);
    expect(await code(covers.dashboardCounts(s.parentId))).toBe(CommErrorCode.ORG_STRUCTURE_DENIED);
    expect((await all(superId)).every((t) => t.capped === false)).toBe(true);
  });

  it('runs the same number of statements for a few rows as for many (no N+1)', async () => {
    g.config.invalidate();
    const small = await counted(() => all(superId));
    await unsupervisedFamily(6);
    for (let i = 0; i < 4; i += 1) await teacher(`teacher_m${i}`);
    g.config.invalidate();
    const large = await counted(() => all(superId));
    await expectParity(superId);
    expect(tileOf(large.result, 'learners.unsupervised')?.count).toBe(8);
    expect(large.n).toBe(small.n);
  });
});
