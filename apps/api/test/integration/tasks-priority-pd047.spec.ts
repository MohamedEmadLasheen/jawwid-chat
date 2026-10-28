/**
 * PD-47 priority amendment, PR-1b -- a task's priority, its category, and the
 * order every list shows them in.
 * Plan: docs/product/pd047-amendment-priority.md (revision 2, APPROVED 2026-10-28).
 *
 *   manual     high | medium | low, set by the creator (default medium);
 *              changed only by a decider (the responsible manager, the manager
 *              who created it, the super admin); recorded as priority_changed
 *   effective  computed at read time by chat.work_task_effective, never stored:
 *              generic       overdue or due within 24 h -> high, 3 days -> medium
 *              overdue_only  medium while pending, high once overdue
 *              instalment    D-7 medium, D0 high, overdue from D+1 (academy days)
 *              source_floor  a level a source raises the task to
 *   category   financial | operational; a manager or the super admin may mark
 *              a manual task financial (owner Q-F3)
 *   order      level, then financial first, then the soonest due, then the
 *              undated, oldest first; the first page fixes asOf
 *
 * Synthetic fixtures only (G-16).
 */
import { randomUUID } from 'node:crypto';
import { CommError, CommErrorCode } from '@platform/errors';
import { TaskService } from '../../src/tasks/task.service';
import { buildGraph, seed, truncate, Scenario } from './harness';

const g = buildGraph();
const tasks = new TaskService(g.prisma, g.outbox);

jest.setTimeout(120_000);

let s: Scenario;
let tmgr: string;
let tsupA: string;
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

const staff = (id: string) => ({ kind: 'staff' as const, id });
const teacher = (id: string) => ({ kind: 'teacher' as const, id });
const HOUR = 3_600_000;
const iso = (msFromNow: number) => new Date(Date.now() + msFromNow).toISOString();
const give = (by: string, title: string, extra: Record<string, unknown> = {}) =>
  tasks.create(by, { assignee: staff(s.ownerId), title, ...extra });
const titles = async (by: string, query: Record<string, string> = {}) =>
  (await tasks.list(by, { view: 'mine', ...query })).items.map((t) => t.title);
const effective = async (priority: string, rule: string, dueAt: string | null, sourceFloor: string | null, state: string, asOf: string) =>
  (await g.prisma.$queryRawUnsafe<Array<{ level: string; reason: string }>>(
    `select level, reason from chat.work_task_effective($1, $2, $3::timestamptz, $4, $5, $6::timestamptz, 'Africa/Cairo')`,
    priority, rule, dueAt, sourceFloor, state, asOf,
  ))[0];

beforeAll(async () => {
  await g.prisma.$connect();
});
afterAll(async () => {
  await truncate(g.prisma);
  await g.prisma.$disconnect();
});
beforeEach(async () => {
  await truncate(g.prisma);
  // seed(): Operations is run by s.managerId; s.ownerId and s.otherAdminId are its supervisors.
  s = await seed(g.prisma);
  [tmgr, tsupA, sa] = [randomUUID(), randomUUID(), randomUUID()];
  await g.prisma.$executeRawUnsafe(
    `insert into chat.staff (id, name, role, is_active) values ($1::uuid, 'tmgr_p', 'manager', true), ($2::uuid, 'tsup_pa', 'admin', true)`,
    tmgr, tsupA,
  );
  await g.prisma.$transaction([
    g.prisma.$executeRawUnsafe(`select set_config('chat.provisioning_super_admin', 'on', true)`),
    g.prisma.$executeRawUnsafe(`insert into chat.staff (id, name, role, is_active) values ($1::uuid, 'sa_p', 'super_admin', true)`, sa),
  ]);
  const [{ id: tdept }] = await g.prisma.$queryRawUnsafe<Array<{ id: string }>>(
    `insert into chat.department (kind, display_name, manager_id) values ('teachers', 'teachers', $1::uuid) returning id::text as id`, tmgr,
  );
  await g.prisma.$executeRawUnsafe(
    `insert into chat.department_member (staff_id, organization_id, department_id, position) values ($1::uuid, chat.default_organization_id(), $2::uuid, 'supervisor')`,
    tsupA, tdept,
  );
  await g.prisma.$executeRawUnsafe(
    `insert into chat.teacher_supervisor_assignment (teacher_id, organization_id, supervisor_id) values ($1::uuid, chat.default_organization_id(), $2::uuid)`,
    s.teacherId, tsupA,
  );
});

// ---------------------------------------------------------------------------

describe('the effective level (chat.work_task_effective)', () => {
  const asOf = '2026-11-10T10:00:00Z';
  const at = (ms: number) => new Date(Date.parse(asOf) + ms).toISOString();

  it('generic: overdue or within 24 h is high, within 3 days medium, to the minute; a manual level is never lowered', async () => {
    expect(await effective('low', 'generic', null, null, 'open', asOf)).toEqual({ level: 'low', reason: 'manual' });
    expect(await effective('low', 'generic', at(-1000), null, 'open', asOf)).toEqual({ level: 'high', reason: 'overdue' });
    expect(await effective('low', 'generic', at(24 * HOUR), null, 'open', asOf)).toEqual({ level: 'high', reason: 'due_soon' });
    expect(await effective('low', 'generic', at(24 * HOUR + 60_000), null, 'open', asOf)).toEqual({ level: 'medium', reason: 'due_soon' });
    expect(await effective('low', 'generic', at(72 * HOUR), null, 'open', asOf)).toEqual({ level: 'medium', reason: 'due_soon' });
    expect(await effective('low', 'generic', at(72 * HOUR + 60_000), null, 'open', asOf)).toEqual({ level: 'low', reason: 'manual' });
    expect(await effective('medium', 'generic', at(48 * HOUR), null, 'open', asOf)).toEqual({ level: 'medium', reason: 'manual' });
    expect(await effective('high', 'generic', at(-1000), null, 'open', asOf)).toEqual({ level: 'high', reason: 'manual' });
  });

  it('overdue_only (routine work): medium while pending, high only once overdue (owner 2026-10-28)', async () => {
    expect(await effective('low', 'overdue_only', at(HOUR), null, 'open', asOf)).toEqual({ level: 'medium', reason: 'due_soon' });
    expect(await effective('medium', 'overdue_only', at(HOUR), null, 'open', asOf)).toEqual({ level: 'medium', reason: 'manual' });
    expect(await effective('low', 'overdue_only', at(-60_000), null, 'open', asOf)).toEqual({ level: 'high', reason: 'overdue' });
  });

  it('instalment: medium from D-7, high on D0, overdue from D+1 -- the academy\'s calendar days', async () => {
    // D0 starts at 00:00 Cairo on 2026-11-20 (UTC+2 in November).
    const d0 = '2026-11-19T22:00:00Z';
    const day = 24 * HOUR;
    const atD0 = (ms: number) => new Date(Date.parse(d0) + ms).toISOString();
    expect(await effective('low', 'instalment', d0, null, 'open', atD0(-7 * day - 60_000))).toEqual({ level: 'low', reason: 'manual' });
    expect(await effective('low', 'instalment', d0, null, 'open', atD0(-7 * day))).toEqual({ level: 'medium', reason: 'due_soon' });
    expect(await effective('low', 'instalment', d0, null, 'open', atD0(-60_000))).toEqual({ level: 'medium', reason: 'due_soon' });
    expect(await effective('low', 'instalment', d0, null, 'open', atD0(0))).toEqual({ level: 'high', reason: 'due_soon' });
    expect(await effective('low', 'instalment', d0, null, 'open', atD0(day - 60_000))).toEqual({ level: 'high', reason: 'due_soon' });
    expect(await effective('low', 'instalment', d0, null, 'open', atD0(day))).toEqual({ level: 'high', reason: 'overdue' });
  });

  it('a source floor raises the level; a closed task shows its manual level only', async () => {
    expect(await effective('low', 'none', null, 'high', 'open', asOf)).toEqual({ level: 'high', reason: 'source' });
    expect(await effective('low', 'none', null, 'medium', 'awaiting_decision', asOf)).toEqual({ level: 'medium', reason: 'source' });
    expect(await effective('low', 'generic', at(-1000), 'high', 'completed', asOf)).toEqual({ level: 'low', reason: 'manual' });
  });
});

describe('the order of every list', () => {
  it('level first, financial first inside a level, then the soonest due, then the undated oldest; never a bare colour', async () => {
    await give(s.managerId, 'green', { priority: 'low' });
    await give(s.managerId, 'yellow-undated', { priority: 'medium' });
    await give(s.managerId, 'yellow-dated', { priority: 'low', dueAt: iso(48 * HOUR) });
    await give(s.managerId, 'yellow-financial', { priority: 'medium', category: 'financial' });
    await give(s.managerId, 'red-undated', { priority: 'high' });
    await give(s.managerId, 'red-overdue', { priority: 'medium', dueAt: iso(-HOUR) });
    await give(s.managerId, 'red-financial', { priority: 'high', category: 'financial' });
    expect(await titles(s.ownerId)).toEqual([
      'red-financial', 'red-overdue', 'red-undated', 'yellow-financial', 'yellow-dated', 'yellow-undated', 'green',
    ]);
    const [first] = (await tasks.list(s.ownerId, { view: 'mine' })).items;
    expect(first).toMatchObject({ manualPriority: 'high', effectivePriority: 'high', priorityReason: 'manual', category: 'financial' });
    const overdue = (await tasks.list(s.ownerId, { view: 'mine' })).items.find((t) => t.title === 'red-overdue');
    expect(overdue).toMatchObject({ manualPriority: 'medium', effectivePriority: 'high', priorityReason: 'overdue' });
  });

  it('pages in the same order, all at the first page\'s asOf', async () => {
    for (const [title, priority] of [['a', 'low'], ['b', 'high'], ['c', 'medium'], ['d', 'high'], ['e', 'low']] as const) {
      await give(s.managerId, title, { priority });
    }
    const whole = await titles(s.ownerId);
    const seen: string[] = [];
    let page = await tasks.list(s.ownerId, { view: 'mine', limit: '2' });
    const asOf = page.asOf;
    seen.push(...page.items.map((t) => t.title));
    while (page.nextCursor) {
      page = await tasks.list(s.ownerId, { view: 'mine', limit: '2', cursor: page.nextCursor });
      expect(page.asOf).toBe(asOf);
      seen.push(...page.items.map((t) => t.title));
    }
    expect(seen).toEqual(whole);
    expect(whole).toEqual(['b', 'd', 'c', 'a', 'e']);
  });

  it('filters by effective level, category and overdue, as the Dashboard counts them', async () => {
    await give(s.managerId, 'late', { dueAt: iso(-HOUR) });
    await give(s.managerId, 'money', { category: 'financial' });
    await give(s.managerId, 'calm', { priority: 'low' });
    expect(await titles(s.ownerId, { level: 'high' })).toEqual(['late']);
    expect(await titles(s.ownerId, { category: 'financial' })).toEqual(['money']);
    expect(await titles(s.ownerId, { overdue: 'true' })).toEqual(['late']);
    const tiles = await tasks.dashboardCounts(s.ownerId);
    const tile = (key: string) => tiles.find((t) => t.key === key)?.count;
    expect(tile('tasks.mine_urgent')).toBe(1);
    expect(tile('tasks.mine_financial')).toBe(1);
    expect(tile('tasks.mine_overdue')).toBe((await titles(s.ownerId, { overdue: 'true' })).length);
    const mgr = await tasks.dashboardCounts(s.managerId);
    expect(mgr.find((t) => t.key === 'tasks.team_urgent')?.count).toBe((await tasks.list(s.managerId, { view: 'team', level: 'high' })).items.length);
    expect(mgr.find((t) => t.key === 'tasks.team_financial')?.count).toBe(1);
  });

  it('refuses an unknown level, category, limit or cursor', async () => {
    expect(await code(tasks.list(s.ownerId, { view: 'mine', level: 'urgent' }))).toBe(CommErrorCode.TASK_INVALID);
    expect(await code(tasks.list(s.ownerId, { view: 'mine', category: 'money' }))).toBe(CommErrorCode.TASK_INVALID);
    expect(await code(tasks.list(s.ownerId, { view: 'mine', limit: '0' }))).toBe(CommErrorCode.TASK_INVALID);
    expect(await code(tasks.list(s.ownerId, { view: 'mine', cursor: 'not-a-cursor' }))).toBe(CommErrorCode.TASK_INVALID);
  });
});

describe('who sets the level', () => {
  it('the creator picks it; medium by default; only a manager or the super admin marks a task financial (Q-F3)', async () => {
    expect((await give(s.managerId, 'plain')).manualPriority).toBe('medium');
    expect((await give(s.managerId, 'money', { category: 'financial' })).category).toBe('financial');
    expect(await code(tasks.create(tsupA, { assignee: teacher(s.teacherId), title: 'x', category: 'financial' }))).toBe(CommErrorCode.TASK_DENIED);
    expect((await tasks.create(tsupA, { assignee: teacher(s.teacherId), title: 'x', priority: 'high' })).manualPriority).toBe('high');
    expect(await code(give(s.managerId, 'x', { priority: 'urgent' }))).toBe(CommErrorCode.TASK_INVALID);
  });

  it('a decider changes it, recorded with before and after; the assignee and a teacher\'s supervisor may not', async () => {
    const t = await give(s.managerId, 'call back');
    expect(await code(tasks.setPriority(s.ownerId, t.id, { priority: 'high' }))).toBe(CommErrorCode.TASK_DENIED);
    const raised = await tasks.setPriority(s.managerId, t.id, { priority: 'high' });
    expect(raised).toMatchObject({ manualPriority: 'high', effectivePriority: 'high' });
    expect(await code(tasks.setPriority(s.managerId, t.id, { priority: 'high' }))).toBe(CommErrorCode.TASK_INVALID);
    const [e] = await g.prisma.$queryRaw<Array<{ actor_id: string; before: unknown; after: unknown }>>`
      SELECT actor_id::text AS actor_id, before, after FROM chat.work_task_event WHERE task_id = ${t.id}::uuid AND kind = 'priority_changed'`;
    expect(e).toEqual({ actor_id: s.managerId, before: { priority: 'medium' }, after: { priority: 'high' } });

    const forTeacher = await tasks.create(tmgr, { assignee: teacher(s.teacherId), title: 'y' });
    expect(await code(tasks.setPriority(tsupA, forTeacher.id, { priority: 'low' }))).toBe(CommErrorCode.TASK_DENIED);
    expect((await tasks.setPriority(sa, forTeacher.id, { priority: 'low' })).manualPriority).toBe('low');
  });

  it('the manager who created a task keeps the right after it went to another department (plan §3.7, owner 2026-10-28)', async () => {
    const t = await give(s.managerId, 'send on');
    // Now a teacher's task: the Operations manager no longer stands to it by the line, only as its creator.
    await tasks.reassign(sa, t.id, { to: teacher(s.teacherId) });
    expect((await tasks.setPriority(s.managerId, t.id, { priority: 'low' })).manualPriority).toBe('low');
  });

  it('a closed task\'s level no longer changes', async () => {
    const t = await give(s.managerId, 'done soon');
    await tasks.complete(s.ownerId, t.id, {});
    expect(await code(tasks.setPriority(s.managerId, t.id, { priority: 'high' }))).toBe(CommErrorCode.TASK_STATE);
  });
});

describe('the database', () => {
  it('refuses a priority change with no actor, and any change of category or floor rule', async () => {
    const t = await give(s.managerId, 'fixed');
    await expect(g.prisma.$executeRaw`UPDATE chat.work_task SET priority = 'high' WHERE id = ${t.id}::uuid`).rejects.toThrow();
    const asSa = (sql: string) =>
      g.prisma.$transaction([
        g.prisma.$executeRawUnsafe(`select set_config('chat.task_actor', $1, true)`, sa),
        g.prisma.$executeRawUnsafe(sql, t.id),
      ]);
    await expect(asSa(`update chat.work_task set category = 'financial' where id = $1::uuid`)).rejects.toThrow(/never change/);
    await expect(asSa(`update chat.work_task set floor_rule = 'none' where id = $1::uuid`)).rejects.toThrow(/never change/);
    await expect(asSa(`update chat.work_task set source_floor = 'high' where id = $1::uuid`)).rejects.toThrow(/never change/);
  });

  it('a manual task has the generic floor and no source floor', async () => {
    await expect(
      g.prisma.$transaction([
        g.prisma.$executeRawUnsafe(`select set_config('chat.task_actor', $1, true)`, sa),
        g.prisma.$executeRawUnsafe(
          `insert into chat.work_task (organization_id, kind, title, assignee_staff_id, created_by, floor_rule)
           values (chat.default_organization_id(), 'manual', 'x', $1::uuid, $2::uuid, 'overdue_only')`,
          s.ownerId, sa,
        ),
      ]),
    ).rejects.toThrow(/generic floor/);
  });
});
