/**
 * PD-44 PR-1 -- the Dashboard's Chats and Cases sections
 * (docs/product/pd044-manager-dashboard-plan.md §3.1, §3.2, §6).
 *
 *   parity    every tile equals the length of the list it links to, for every
 *             persona and every state the rows pass through:
 *               chats.waiting          GET /conversations (listForActor) rows in
 *                                      state waiting_on_jawwid, not archived
 *               cases.mine_open        GET /cases?tab=mine&status=open
 *               cases.department_open  GET /cases?tab=department&status=open
 *               cases.overdue          those two lists together, due date passed
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
import { TeacherScopeService } from '@platform/teacher-scope';
import { conversationState } from '@communication/contracts/dto';
import { ConversationState } from '@communication/contracts/vocab';
import { LessonService } from '../../src/lessons/lesson.service';
import { SupervisionCaseService } from '../../src/cases/supervision-case.service';
import { TeacherFileService } from '../../src/teacher-file/teacher-file.service';
import { ParentFeedbackService } from '../../src/teacher-file/parent-feedback.service';
import type { DashboardTile } from '../../src/dashboard/dashboard-tile';
import { buildGraph, seed, truncate, Scenario } from './harness';

// Query events on, so the N+1 guard can count what one request runs.
const logged = new PrismaService({ log: [{ emit: 'event', level: 'query' }] });
let statements = 0;
(logged as unknown as { $on(event: 'query', cb: () => void): void }).$on('query', () => {
  statements += 1;
});

const g = buildGraph(undefined, logged);
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
let sa: string;
let sa2: string;
let finance: string;
let org2: string;

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

/** How many statements `run` sends to the database. */
async function counted<T>(run: () => Promise<T>): Promise<{ result: T; n: number }> {
  statements = 0;
  const result = await run();
  return { result, n: statements };
}

// --- chats ------------------------------------------------------------------

/** What the Chat list's "Waiting for a reply" shows: listForActor's rows, waiting, not archived. */
async function listedWaiting(actorId: string): Promise<number> {
  const rows = await g.conversations.listForActor(actorId);
  return rows.filter((c) => conversationState(c) === ConversationState.WAITING_ON_JAWWID && c.archivedAt === null).length;
}

const parentWrote = (id: string, minutesAgo: number) =>
  g.prisma.$executeRaw`
    UPDATE chat.conversation
       SET last_customer_message_at = now() - make_interval(mins => ${minutesAgo}::int), last_staff_message_at = NULL
     WHERE id = ${id}::uuid`;
const staffAnswered = (id: string) =>
  g.prisma.$executeRaw`UPDATE chat.conversation SET last_staff_message_at = now() WHERE id = ${id}::uuid`;
const resolve = (id: string) => g.prisma.$executeRaw`UPDATE chat.conversation SET resolved_at = now() WHERE id = ${id}::uuid`;
const archive = (id: string) => g.prisma.$executeRaw`UPDATE chat.conversation SET archived_at = now() WHERE id = ${id}::uuid`;

// --- cases ------------------------------------------------------------------

const today = async () => (await g.prisma.$queryRaw<Array<{ d: string }>>`SELECT chat.academy_today()::text AS d`)[0].d;

/** What the Cases page lists for these tabs, open cases only. */
async function listed(actorId: string, tab: 'mine' | 'department') {
  return (await cases.list(actorId, { tab, status: 'open' })).cases;
}

/** A due date already past, written as the service writes one (its actor named). */
const backdate = (caseId: string, by: string) =>
  g.prisma.$transaction([
    g.prisma.$executeRawUnsafe(`select set_config('chat.case_actor', $1, true)`, by),
    g.prisma.$executeRawUnsafe(`update chat.supervision_case set due_on = chat.academy_today() - 2 where id = $1::uuid`, caseId),
  ]);

/** Every case tile against the lists it links to; the department tile only for someone who manages one. */
async function expectCaseParity(actorId: string, managesDepartment: boolean) {
  const tiles = await cases.dashboardCounts(actorId);
  const mine = await listed(actorId, 'mine');
  expect(tileOf(tiles, 'cases.mine_open')?.count).toBe(mine.length);
  const department = await listed(actorId, 'department');
  if (managesDepartment) expect(tileOf(tiles, 'cases.department_open')?.count).toBe(department.length);
  else expect(tileOf(tiles, 'cases.department_open')).toBeUndefined();
  const day = await today();
  const union = new Map([...mine, ...(managesDepartment ? department : [])].map((c) => [c.id, c]));
  const overdue = [...union.values()].filter((c) => c.dueOn !== null && c.dueOn < day).length;
  expect(tileOf(tiles, 'cases.overdue')?.count).toBe(overdue);
  expect(tiles.every((t) => t.capped === false)).toBe(true);
}

// ---------------------------------------------------------------------------

beforeAll(async () => {
  await g.prisma.$connect();
});
afterAll(async () => {
  await truncate(g.prisma);
  await g.prisma.$executeRawUnsafe(`delete from chat.organization where slug like 'pd044-%'`).catch(() => undefined);
  await g.prisma.$disconnect();
});
beforeEach(async () => {
  await truncate(g.prisma);
  await g.prisma.$executeRawUnsafe(`delete from chat.organization where slug like 'pd044-%'`).catch(() => undefined);
  // PD-35's switch is a stored row another suite may leave on: department-wide here.
  await g.prisma.$executeRaw`UPDATE chat.config SET value = 'false'::jsonb WHERE key = 'teacher_supervisor.strict_scope'`;
  s = await seed(g.prisma);
  [tmgr, tsupA, sa, sa2, finance, org2] = [randomUUID(), randomUUID(), randomUUID(), randomUUID(), randomUUID(), randomUUID()];
  await g.prisma.$executeRawUnsafe(
    `insert into chat.staff (id, name, role, is_active) values
       ($1::uuid, 'tmgr_d', 'manager', true), ($2::uuid, 'tsup_da', 'admin', true), ($3::uuid, 'fin_d', 'finance', true)`,
    tmgr, tsupA, finance,
  );
  // super_admin exists only through the bootstrap gate (20261013120000).
  await g.prisma.$executeRawUnsafe(`insert into chat.organization (id, slug, display_name) values ($1::uuid, $2, 'org_two')`, org2, `pd044-${org2.slice(0, 8)}`);
  await g.prisma.$transaction([
    g.prisma.$executeRawUnsafe(`select set_config('chat.provisioning_super_admin', 'on', true)`),
    g.prisma.$executeRawUnsafe(`insert into chat.staff (id, name, role, is_active) values ($1::uuid, 'sa_d', 'super_admin', true)`, sa),
    g.prisma.$executeRawUnsafe(
      `insert into chat.staff (id, name, role, is_active, organization_id) values ($1::uuid, 'sa_two', 'super_admin', true, $2::uuid)`, sa2, org2,
    ),
  ]);
  const [{ id: dept }] = await g.prisma.$queryRawUnsafe<Array<{ id: string }>>(
    `insert into chat.department (kind, display_name, manager_id) values ('teachers', 'teachers', $1::uuid) returning id::text as id`, tmgr,
  );
  await g.prisma.$executeRawUnsafe(
    `insert into chat.department_member (staff_id, organization_id, department_id, position) values ($1::uuid, chat.default_organization_id(), $2::uuid, 'supervisor')`,
    tsupA, dept,
  );
  await g.prisma.$executeRawUnsafe(
    `insert into chat.teacher_supervisor_assignment (teacher_id, organization_id, supervisor_id) values ($1::uuid, chat.default_organization_id(), $2::uuid)`,
    s.teacherId, tsupA,
  );
});

// ---------------------------------------------------------------------------

describe('GET /dashboard/chats -- chats.waiting', () => {
  let groupA: string;
  let groupB: string;
  beforeEach(async () => {
    groupA = (await g.conversations.ensureStudentGroup(s.learnerId, s.ownerId)).id;
    groupB = (await g.conversations.ensureStudentGroup(s.secondLearnerId, s.ownerId)).id;
  });

  it('equals the Chat list\'s waiting rows for every persona, through every state a conversation passes', async () => {
    // supervisor, their Operations manager, the in-department outsider, the super admin, another organization's super admin
    const personas = [s.ownerId, s.managerId, s.otherAdminId, sa, sa2];
    const check = async (expected: Record<string, number>) => {
      for (const p of personas) {
        const tile = tileOf(await g.conversations.dashboardWaiting(p), 'chats.waiting');
        expect(tile).toBeDefined();
        expect({ p, count: tile?.count }).toEqual({ p, count: await listedWaiting(p) });
        expect({ p, count: tile?.count }).toEqual({ p, count: expected[p] ?? 0 });
      }
    };

    await check({});
    await parentWrote(groupA, 30);
    await check({ [s.ownerId]: 1, [s.managerId]: 1, [sa]: 1 });
    await parentWrote(groupB, 5);
    await check({ [s.ownerId]: 2, [s.managerId]: 2, [sa]: 2 });
    await staffAnswered(groupB);
    await check({ [s.ownerId]: 1, [s.managerId]: 1, [sa]: 1 });
    await parentWrote(groupB, 5);
    await resolve(groupA);
    await check({ [s.ownerId]: 1, [s.managerId]: 1, [sa]: 1 });
    await archive(groupB);
    await check({});
  });

  it('says how long the oldest has waited', async () => {
    await parentWrote(groupA, 90);
    await parentWrote(groupB, 10);
    const [row] = await g.prisma.$queryRaw<Array<{ at: Date }>>`
      SELECT last_customer_message_at AS at FROM chat.conversation WHERE id = ${groupA}::uuid`;
    const tile = tileOf(await g.conversations.dashboardWaiting(s.ownerId), 'chats.waiting');
    expect(tile).toEqual({ key: 'chats.waiting', count: 2, oldestAt: row.at.toISOString(), capped: false });
    expect(tileOf(await g.conversations.dashboardWaiting(s.otherAdminId), 'chats.waiting')).toEqual({
      key: 'chats.waiting', count: 0, oldestAt: null, capped: false,
    });
  });

  it('is absent for staff who hold no conversations, and refused to anyone who is not staff', async () => {
    expect(await g.conversations.dashboardWaiting(finance)).toEqual([]);
    expect(await code(g.conversations.dashboardWaiting(s.parentId))).toBe(CommErrorCode.PERMISSION_DENIED);
    expect(await code(g.conversations.dashboardWaiting(s.teacherId))).toBe(CommErrorCode.PERMISSION_DENIED);
    // admin_b owns no family (a family's primary owner cannot be deactivated before offboarding).
    await g.prisma.$executeRaw`UPDATE chat.staff SET is_active = false, left_at = now() WHERE id = ${s.otherAdminId}::uuid`;
    expect(await code(g.conversations.dashboardWaiting(s.otherAdminId))).toBe(CommErrorCode.ACTOR_INACTIVE);
  });

  it('runs the same number of statements for 2 conversations as for 30 (no N+1)', async () => {
    await parentWrote(groupA, 30);
    const small = await counted(() => g.conversations.dashboardWaiting(sa));
    // 28 more waiting family conversations the super admin sees.
    for (let i = 0; i < 28; i += 1) {
      const [{ id }] = await g.prisma.$queryRawUnsafe<Array<{ id: string }>>(
        `insert into chat.conversation (type, family_id, direct_key) values ('direct', $1::uuid, $2) returning id::text as id`,
        s.familyId, `pd044-${i}-${randomUUID()}`,
      );
      await parentWrote(id, i + 1);
    }
    const large = await counted(() => g.conversations.dashboardWaiting(sa));
    expect(tileOf(large.result, 'chats.waiting')?.count).toBe(await listedWaiting(sa));
    expect(tileOf(large.result, 'chats.waiting')?.count).toBeGreaterThan(tileOf(small.result, 'chats.waiting')?.count ?? 0);
    expect(large.n).toBe(small.n);
    expect(large.n).toBeLessThanOrEqual(4);
  });
});

describe('GET /dashboard/cases -- mine, department, overdue', () => {
  let teacherCase: string;
  let learnerCase: string;
  beforeEach(async () => {
    // To the Teachers department: owned by its manager by default.
    teacherCase = (await cases.open(tsupA, { subject: { kind: 'teacher', id: s.teacherId }, target: 'teachers', title: 'late reports' })).id;
    // To Operations, about the supervisor's own child: owned by the Operations manager.
    learnerCase = (await cases.open(s.ownerId, { subject: { kind: 'learner', id: s.learnerId }, target: 'operations', title: 'missed lessons' })).id;
  });

  it('equals the Cases page\'s tabs for every persona, through assignment, a passed due date and closing', async () => {
    // [persona, manages a department]
    const personas: Array<[string, boolean]> = [[tmgr, true], [tsupA, false], [s.managerId, true], [s.ownerId, false], [sa, true], [sa2, true]];
    const all = async () => {
      for (const [p, manages] of personas) await expectCaseParity(p, manages);
    };

    await all();
    expect(tileOf(await cases.dashboardCounts(tmgr), 'cases.department_open')?.count).toBe(1);
    expect(tileOf(await cases.dashboardCounts(sa), 'cases.department_open')?.count).toBe(2);

    await cases.assign(tmgr, teacherCase, { ownerId: tsupA });
    await all();
    expect(tileOf(await cases.dashboardCounts(tsupA), 'cases.mine_open')?.count).toBe(1);

    await backdate(teacherCase, tmgr);
    await all();
    expect(tileOf(await cases.dashboardCounts(tsupA), 'cases.overdue')?.count).toBe(1);
    expect(tileOf(await cases.dashboardCounts(tmgr), 'cases.overdue')?.count).toBe(1);
    expect(tileOf(await cases.dashboardCounts(s.managerId), 'cases.overdue')?.count).toBe(0);

    await cases.setStatus(s.managerId, learnerCase, { status: 'in_progress' });
    await all();
    expect(tileOf(await cases.dashboardCounts(s.managerId), 'cases.mine_open')?.count).toBe(1);

    await cases.setStatus(s.managerId, learnerCase, { status: 'resolved', note: 'settled with the family' });
    await all();
    expect(tileOf(await cases.dashboardCounts(s.managerId), 'cases.mine_open')?.count).toBe(0);
    expect(tileOf(await cases.dashboardCounts(sa), 'cases.department_open')?.count).toBe(1);
  });

  it('leaves the department tile out for someone who manages no department, and counts nothing in another organization', async () => {
    expect(keys(await cases.dashboardCounts(tsupA))).toEqual(['cases.mine_open', 'cases.overdue']);
    expect(keys(await cases.dashboardCounts(tmgr))).toEqual(['cases.department_open', 'cases.mine_open', 'cases.overdue']);
    const other = await cases.dashboardCounts(sa2);
    expect(other.map((t) => t.count)).toEqual([0, 0, 0]);
    expect(await code(cases.dashboardCounts(s.parentId))).toBe(CommErrorCode.CASE_DENIED);
  });

  it('says how old the oldest open case is', async () => {
    const [row] = await g.prisma.$queryRaw<Array<{ at: Date }>>`
      SELECT min(created_at) AS at FROM chat.supervision_case WHERE status IN ('open', 'in_progress')`;
    expect(tileOf(await cases.dashboardCounts(sa), 'cases.department_open')?.oldestAt).toBe(row.at.toISOString());
  });

  it('runs the same number of statements for 2 cases as for 20 (no N+1)', async () => {
    const small = await counted(() => cases.dashboardCounts(sa));
    for (let i = 0; i < 18; i += 1) {
      await cases.open(tsupA, { subject: { kind: 'teacher', id: s.teacherId }, target: 'teachers', title: `case ${i}` });
    }
    const large = await counted(() => cases.dashboardCounts(sa));
    expect(tileOf(large.result, 'cases.department_open')?.count).toBe(20);
    expect(large.n).toBe(small.n);
    expect(large.n).toBeLessThanOrEqual(3);
  });
});
