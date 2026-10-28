/**
 * PD-47 PR-1 -- tasks (chat.work_task) and their history (chat.work_task_event).
 * Plan: docs/product/pd047-tasks-plan.md (APPROVED 2026-10-28, Q1-Q13).
 *
 *   create    a manager for their team, a teacher supervisor for their own
 *             teachers (Q5), the super admin for anyone; nobody peer to peer
 *   see       Mine for the assignee; Team for the responsible manager (and a
 *             teacher supervisor, read-only, Q3); Decisions for whoever
 *             decides; All for the super admin; anyone else: not found
 *   exits     1 complete (the assignee, manual tasks); 2 out of scope (the
 *             assignee, a comment) -> the manager or super admin removes,
 *             returns with instructions, or reassigns; 3 remove (a reason);
 *             4 reassign (within the team, or to another department's
 *             manager, Q6; the super admin anywhere)
 *   record    every change is one chat.work_task_event written by the
 *             database in the same transaction, naming its actor; completed
 *             and removed are final; nothing is ever deleted
 *   signal    every change enqueues task.changed { taskId, revision, change }
 *
 * The legacy chat.task (PD-4, frozen) is never written: a row there would
 * widen chat.staff_can_see_family.
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
let tmgr: string; // Teachers manager
let tsupA: string; // supervises s.teacherId
let tsupB: string; // Teachers member, not s.teacherId's supervisor
let smgr: string; // Sales manager
let srep: string; // a Sales member
let sa: string;
let farOrg: string; // another organization
let farStaff: string; // live staff of farOrg

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
const manual = (by: string, to: { kind: 'staff' | 'teacher'; id: string }, extra: Record<string, unknown> = {}) =>
  tasks.create(by, { assignee: to, title: 'call the family back', body: 'about Thursday', ...extra });
const ids = async (by: string, view: string, state?: string) => (await tasks.list(by, { view, state })).items.map((t) => t.id);
const history = async (taskId: string) =>
  g.prisma.$queryRaw<Array<{ kind: string; actor_id: string | null; to_assignee: string | null; body: string | null }>>`
    SELECT kind, actor_id::text AS actor_id, to_assignee::text AS to_assignee, body
      FROM chat.work_task_event WHERE task_id = ${taskId}::uuid ORDER BY at, id`;
const signals = async (taskId: string) =>
  (await g.prisma.outboxEvent.findMany({ where: { type: 'task.changed' }, orderBy: { createdAt: 'asc' } }))
    .map((r) => r.payload as { taskId: string; revision: number; change: string })
    .filter((p) => p.taskId === taskId);

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
  [tmgr, tsupA, tsupB, smgr, sa] = [randomUUID(), randomUUID(), randomUUID(), randomUUID(), randomUUID()];
  await g.prisma.$executeRawUnsafe(
    `insert into chat.staff (id, name, role, is_active) values
       ($1::uuid, 'tmgr_t', 'manager', true), ($2::uuid, 'tsup_ta', 'admin', true),
       ($3::uuid, 'tsup_tb', 'admin', true), ($4::uuid, 'smgr_t', 'manager', true)`,
    tmgr, tsupA, tsupB, smgr,
  );
  await g.prisma.$transaction([
    g.prisma.$executeRawUnsafe(`select set_config('chat.provisioning_super_admin', 'on', true)`),
    g.prisma.$executeRawUnsafe(`insert into chat.staff (id, name, role, is_active) values ($1::uuid, 'sa_t', 'super_admin', true)`, sa),
  ]);
  const [{ id: tdept }] = await g.prisma.$queryRawUnsafe<Array<{ id: string }>>(
    `insert into chat.department (kind, display_name, manager_id) values ('teachers', 'teachers', $1::uuid) returning id::text as id`, tmgr,
  );
  const [{ id: sdept }] = await g.prisma.$queryRawUnsafe<Array<{ id: string }>>(
    `insert into chat.department (kind, display_name, manager_id) values ('sales', 'sales', $1::uuid) returning id::text as id`, smgr,
  );
  srep = randomUUID();
  await g.prisma.$executeRawUnsafe(`insert into chat.staff (id, name, role, is_active) values ($1::uuid, 'srep_t', 'admin', true)`, srep);
  await g.prisma.$executeRawUnsafe(
    `insert into chat.department_member (staff_id, organization_id, department_id, position) values ($1::uuid, chat.default_organization_id(), $2::uuid, 'supervisor')`,
    srep, sdept,
  );
  [farOrg, farStaff] = [randomUUID(), randomUUID()];
  await g.prisma.$executeRawUnsafe(
    `insert into chat.organization (id, slug, display_name) values ($1::uuid, 'pd047-' || left($1::text, 8), 'pd047 far')`, farOrg,
  );
  await g.prisma.$executeRawUnsafe(
    `insert into chat.staff (id, organization_id, name, role, is_active) values ($1::uuid, $2::uuid, 'far_t', 'admin', true)`, farStaff, farOrg,
  );
  await g.prisma.$executeRawUnsafe(
    `insert into chat.department_member (staff_id, organization_id, department_id, position) values
       ($1::uuid, chat.default_organization_id(), $3::uuid, 'supervisor'), ($2::uuid, chat.default_organization_id(), $3::uuid, 'supervisor')`,
    tsupA, tsupB, tdept,
  );
  await g.prisma.$executeRawUnsafe(
    `insert into chat.teacher_supervisor_assignment (teacher_id, organization_id, supervisor_id) values ($1::uuid, chat.default_organization_id(), $2::uuid)`,
    s.teacherId, tsupA,
  );
});

// ---------------------------------------------------------------------------

describe('creating a manual task (Q5)', () => {
  it('a manager assigns one to a member of their team; it is open, in the assignee\'s Mine, and recorded', async () => {
    const t = await manual(s.managerId, staff(s.ownerId), { dueAt: '2026-11-02T09:00:00Z' });
    expect(t).toMatchObject({ kind: 'manual', state: 'open', assignee: staff(s.ownerId), title: 'call the family back', createdBy: { id: s.managerId } });
    expect(await ids(s.ownerId, 'mine')).toEqual([t.id]);
    expect((await history(t.id)).map((e) => [e.kind, e.actor_id])).toEqual([['created', s.managerId]]);
  });

  it('a manager may not assign outside their team', async () => {
    expect(await code(manual(s.managerId, staff(tsupA)))).toBe(CommErrorCode.TASK_DENIED);
    expect(await code(manual(s.managerId, teacher(s.teacherId)))).toBe(CommErrorCode.TASK_DENIED);
  });

  it('a teacher supervisor assigns to their own teacher, and to no one else', async () => {
    const t = await manual(tsupA, teacher(s.teacherId));
    expect(t.assignee).toEqual(teacher(s.teacherId));
    expect(await code(manual(tsupB, teacher(s.teacherId)))).toBe(CommErrorCode.TASK_DENIED);
    expect(await code(manual(tsupA, staff(tsupB)))).toBe(CommErrorCode.TASK_DENIED);
  });

  it('there is no peer-to-peer task, and a teacher creates none', async () => {
    expect(await code(manual(s.ownerId, staff(s.otherAdminId)))).toBe(CommErrorCode.TASK_DENIED);
    expect(await code(manual(s.teacherId, teacher(s.teacherId)))).toBe(CommErrorCode.TASK_DENIED);
  });

  it('the super admin assigns to anyone, a manager included', async () => {
    expect((await manual(sa, staff(tmgr))).assignee).toEqual(staff(tmgr));
    expect((await manual(sa, teacher(s.unrelatedTeacherId))).assignee).toEqual(teacher(s.unrelatedTeacherId));
  });

  it('a blank title is refused', async () => {
    expect(await code(manual(s.managerId, staff(s.ownerId), { title: '   ' }))).toBe(CommErrorCode.TASK_INVALID);
  });
});

describe('who sees a task', () => {
  it('Mine, Team, All; anyone else reads it as not found', async () => {
    const t = await manual(s.managerId, staff(s.ownerId));
    expect(await ids(s.managerId, 'team')).toEqual([t.id]);
    expect(await ids(sa, 'all')).toContain(t.id);
    expect(await ids(s.otherAdminId, 'mine')).toEqual([]);
    expect(await code(tasks.get(s.otherAdminId, t.id))).toBe(CommErrorCode.TASK_NOT_FOUND);
    expect(await code(tasks.get(tmgr, t.id))).toBe(CommErrorCode.TASK_NOT_FOUND);
    expect(await code(tasks.get(s.ownerId, randomUUID()))).toBe(CommErrorCode.TASK_NOT_FOUND);
    expect(await code(tasks.get(s.ownerId, 'not-a-uuid'))).toBe(CommErrorCode.TASK_NOT_FOUND);
  });

  it('a teacher sees their own tasks; the Teachers manager sees them as Team; their supervisor read-only (Q3)', async () => {
    const t = await manual(tmgr, teacher(s.teacherId));
    expect(await ids(s.teacherId, 'mine')).toEqual([t.id]);
    expect(await ids(tmgr, 'team')).toEqual([t.id]);
    expect(await ids(tsupA, 'team')).toEqual([t.id]);
    expect(await ids(tsupB, 'team')).toEqual([]);
    expect(await code(tasks.remove(tsupA, t.id, { reason: 'not needed' }))).toBe(CommErrorCode.TASK_DENIED);
  });

  it('a teacher supervisor reads, and does nothing else: no comment, return, reassign or due date (Q3)', async () => {
    const t = await manual(tmgr, teacher(s.teacherId));
    expect((await tasks.get(tsupA, t.id)).id).toBe(t.id);
    expect(await code(tasks.comment(tsupA, t.id, { body: 'any news?' }))).toBe(CommErrorCode.TASK_DENIED);
    expect(await code(tasks.reassign(tsupA, t.id, { to: teacher(s.newTeacherId) }))).toBe(CommErrorCode.TASK_DENIED);
    expect(await code(tasks.setDue(tsupA, t.id, { dueAt: '2026-11-02T09:00:00Z' }))).toBe(CommErrorCode.TASK_DENIED);
    await tasks.outOfScope(s.teacherId, t.id, { comment: 'not my student' });
    expect(await code(tasks.returnTask(tsupA, t.id, { instructions: 'it is' }))).toBe(CommErrorCode.TASK_DENIED);
    expect((await tasks.returnTask(tmgr, t.id, { instructions: 'it is' })).state).toBe('open');
  });

  it('only the super admin has All', async () => {
    expect(await code(tasks.list(s.managerId, { view: 'all' }))).toBe(CommErrorCode.TASK_DENIED);
  });
});

describe('exit 1: complete', () => {
  it('the assignee completes a manual task with a note; it leaves Mine and is final', async () => {
    const t = await manual(s.managerId, staff(s.ownerId));
    const done = await tasks.complete(s.ownerId, t.id, { note: 'called, rescheduled' });
    expect(done).toMatchObject({ state: 'completed', outcome: 'done', closedBy: { id: s.ownerId } });
    expect(await ids(s.ownerId, 'mine')).toEqual([]);
    expect(await ids(s.ownerId, 'mine', 'closed')).toEqual([t.id]);
    expect(await code(tasks.complete(s.ownerId, t.id, {}))).toBe(CommErrorCode.TASK_STATE);
    expect(await code(tasks.remove(s.managerId, t.id, { reason: 'x' }))).toBe(CommErrorCode.TASK_STATE);
    expect((await history(t.id)).map((e) => [e.kind, e.actor_id, e.body])).toEqual([
      ['created', s.managerId, null],
      ['completed', s.ownerId, 'called, rescheduled'],
    ]);
  });

  it('nobody else completes it, not even the manager', async () => {
    const t = await manual(s.managerId, staff(s.ownerId));
    expect(await code(tasks.complete(s.managerId, t.id, {}))).toBe(CommErrorCode.TASK_DENIED);
    expect(await code(tasks.complete(s.otherAdminId, t.id, {}))).toBe(CommErrorCode.TASK_NOT_FOUND);
  });
});

describe('exit 2: out of scope, then a decision', () => {
  it('needs a comment; the task stays in Mine as awaiting a decision and shows in Decisions', async () => {
    const t = await manual(s.managerId, staff(s.ownerId));
    expect(await code(tasks.outOfScope(s.ownerId, t.id, { comment: ' ' }))).toBe(CommErrorCode.TASK_INVALID);
    const w = await tasks.outOfScope(s.ownerId, t.id, { comment: 'this family is Sales\'s' });
    expect(w.state).toBe('awaiting_decision');
    expect(await ids(s.ownerId, 'mine')).toEqual([t.id]);
    expect(await ids(s.managerId, 'decisions')).toEqual([t.id]);
    expect(await ids(sa, 'decisions')).toEqual([t.id]);
    expect(await ids(tmgr, 'decisions')).toEqual([]);
  });

  it('returned with instructions: open again, the instructions on the task and in the history', async () => {
    const t = await manual(s.managerId, staff(s.ownerId));
    await tasks.outOfScope(s.ownerId, t.id, { comment: 'not mine' });
    expect(await code(tasks.returnTask(s.managerId, t.id, { instructions: '' }))).toBe(CommErrorCode.TASK_INVALID);
    const r = await tasks.returnTask(s.managerId, t.id, { instructions: 'you supervise this child; call before 6 pm' });
    expect(r).toMatchObject({ state: 'open', instructions: 'you supervise this child; call before 6 pm' });
    expect(await ids(s.managerId, 'decisions')).toEqual([]);
    expect((await history(t.id)).map((e) => e.kind)).toEqual(['created', 'out_of_scope', 'returned']);
  });

  it('may be disputed again after a return, and the count shows it (Q8)', async () => {
    const t = await manual(s.managerId, staff(s.ownerId));
    await tasks.outOfScope(s.ownerId, t.id, { comment: 'not mine' });
    await tasks.returnTask(s.managerId, t.id, { instructions: 'it is' });
    const again = await tasks.outOfScope(s.ownerId, t.id, { comment: 'still not mine' });
    expect(again.disputedCount).toBe(2);
  });

  it('only the assignee disputes; only the responsible manager or the super admin decides', async () => {
    const t = await manual(s.managerId, staff(s.ownerId));
    expect(await code(tasks.outOfScope(s.managerId, t.id, { comment: 'x' }))).toBe(CommErrorCode.TASK_DENIED);
    await tasks.outOfScope(s.ownerId, t.id, { comment: 'not mine' });
    expect(await code(tasks.returnTask(s.ownerId, t.id, { instructions: 'x' }))).toBe(CommErrorCode.TASK_DENIED);
    expect(await code(tasks.returnTask(tmgr, t.id, { instructions: 'x' }))).toBe(CommErrorCode.TASK_NOT_FOUND);
    expect((await tasks.returnTask(sa, t.id, { instructions: 'do it' })).state).toBe('open');
  });
});

describe('exit 3: remove', () => {
  it('the responsible manager removes it with a reason; it is final and kept', async () => {
    const t = await manual(s.managerId, staff(s.ownerId));
    expect(await code(tasks.remove(s.managerId, t.id, { reason: '' }))).toBe(CommErrorCode.TASK_INVALID);
    const r = await tasks.remove(s.managerId, t.id, { reason: 'the family cancelled' });
    expect(r).toMatchObject({ state: 'removed', closedBy: { id: s.managerId }, closeReason: 'the family cancelled' });
    expect(await ids(s.ownerId, 'mine')).toEqual([]);
    expect(await ids(s.ownerId, 'mine', 'closed')).toEqual([t.id]);
    expect(await code(tasks.returnTask(s.managerId, t.id, { instructions: 'x' }))).toBe(CommErrorCode.TASK_STATE);
  });

  it('neither the assignee nor a peer removes it', async () => {
    const t = await manual(s.managerId, staff(s.ownerId));
    expect(await code(tasks.remove(s.ownerId, t.id, { reason: 'x' }))).toBe(CommErrorCode.TASK_DENIED);
    expect(await code(tasks.remove(s.otherAdminId, t.id, { reason: 'x' }))).toBe(CommErrorCode.TASK_NOT_FOUND);
  });

  it('a decision may be a removal', async () => {
    const t = await manual(s.managerId, staff(s.ownerId));
    await tasks.outOfScope(s.ownerId, t.id, { comment: 'not mine' });
    expect((await tasks.remove(sa, t.id, { reason: 'agreed, not needed' })).state).toBe('removed');
  });
});

describe('exit 4: reassign', () => {
  it('within the team: it leaves the old list and appears in the new one, same task, same history', async () => {
    const t = await manual(s.managerId, staff(s.ownerId));
    const r = await tasks.reassign(s.managerId, t.id, { to: staff(s.otherAdminId), instructions: 'admin_a is away' });
    expect(r).toMatchObject({ id: t.id, state: 'open', assignee: staff(s.otherAdminId) });
    expect(await ids(s.ownerId, 'mine')).toEqual([]);
    expect(await ids(s.otherAdminId, 'mine')).toEqual([t.id]);
    expect((await history(t.id)).map((e) => [e.kind, e.actor_id, e.to_assignee, e.body])).toEqual([
      ['created', s.managerId, s.ownerId, null],
      ['reassigned', s.managerId, s.otherAdminId, 'admin_a is away'],
    ]);
  });

  it('a manager may not hand it to another department\'s member, but may send it to that department (Q6)', async () => {
    const t = await manual(s.managerId, staff(s.ownerId));
    expect(await code(tasks.reassign(s.managerId, t.id, { to: staff(tsupA) }))).toBe(CommErrorCode.TASK_DENIED);
    const sent = await tasks.reassign(s.managerId, t.id, { to: { department: 'sales' } });
    expect(sent.assignee).toEqual(staff(smgr));
    expect(await ids(smgr, 'mine')).toEqual([t.id]);
    // The manager who created it still watches it (plan §3.7).
    expect(await ids(s.managerId, 'team')).toEqual([t.id]);
  });

  it('the department manager it was sent to hands it on: within their team, or onward -- never removes or returns it', async () => {
    const t = await manual(s.managerId, staff(s.ownerId));
    await tasks.reassign(s.managerId, t.id, { to: { department: 'sales' } });
    expect(await code(tasks.remove(smgr, t.id, { reason: 'not ours' }))).toBe(CommErrorCode.TASK_DENIED);
    expect(await code(tasks.reassign(smgr, t.id, { to: staff(tsupA) }))).toBe(CommErrorCode.TASK_DENIED);
    const handed = await tasks.reassign(smgr, t.id, { to: staff(srep), instructions: 'the family is ours now' });
    expect(handed).toMatchObject({ assignee: staff(srep), instructions: 'the family is ours now' });
    expect(await ids(srep, 'mine')).toEqual([t.id]);
    expect(await ids(smgr, 'mine')).toEqual([]);
    // Now a member of Sales: the Sales manager is responsible, and decides.
    expect(await ids(smgr, 'team')).toEqual([t.id]);
    expect((await tasks.remove(smgr, t.id, { reason: 'done by phone' })).state).toBe('removed');
  });

  it('a department manager sends their own task onward to another department', async () => {
    const t = await manual(sa, staff(smgr));
    const sent = await tasks.reassign(smgr, t.id, { to: { department: 'teachers' } });
    expect(sent.assignee).toEqual(staff(tmgr));
  });

  it('the super admin reassigns anywhere; the assignee cannot reassign their own task', async () => {
    const t = await manual(s.managerId, staff(s.ownerId));
    expect(await code(tasks.reassign(s.ownerId, t.id, { to: staff(s.otherAdminId) }))).toBe(CommErrorCode.TASK_DENIED);
    expect((await tasks.reassign(sa, t.id, { to: teacher(s.teacherId) })).assignee).toEqual(teacher(s.teacherId));
  });

  it('a decision may be a reassignment', async () => {
    const t = await manual(s.managerId, staff(s.ownerId));
    await tasks.outOfScope(s.ownerId, t.id, { comment: 'admin_b handles this family' });
    expect(await tasks.reassign(s.managerId, t.id, { to: staff(s.otherAdminId) })).toMatchObject({ state: 'open', assignee: staff(s.otherAdminId) });
  });

  it('not to an inactive person', async () => {
    const t = await manual(s.managerId, staff(s.ownerId));
    await g.prisma.$executeRaw`UPDATE chat.staff SET is_active = false WHERE id = ${s.otherAdminId}::uuid`;
    expect(await code(tasks.reassign(s.managerId, t.id, { to: staff(s.otherAdminId) }))).toBe(CommErrorCode.TASK_INVALID);
  });
});

describe('nothing disappears on its own', () => {
  it('an assignee who leaves the team keeps the task; the manager no longer watches it; the super admin sees it as unmanaged', async () => {
    // admin_b: admin_a supervises the family's children, so they cannot leave the department.
    // Created by the super admin, so no manager stands to it as its creator.
    const t = await manual(sa, staff(s.otherAdminId));
    expect(t.unmanaged).toBe(false);
    await g.prisma.$executeRaw`DELETE FROM chat.department_member WHERE staff_id = ${s.otherAdminId}::uuid`;
    expect(await ids(s.otherAdminId, 'mine')).toEqual([t.id]);
    expect(await ids(s.managerId, 'team')).toEqual([]);
    expect(await ids(sa, 'all')).toContain(t.id);
    expect((await tasks.get(sa, t.id)).unmanaged).toBe(true);
    expect(await ids(sa, 'decisions')).toEqual([t.id]);
  });

  it('a task assigned to a manager is unmanaged unless a manager created it: only the super admin stands over them', async () => {
    const byAdmin = await manual(sa, staff(tmgr));
    expect(byAdmin.unmanaged).toBe(true);
    expect(await ids(sa, 'decisions')).toEqual([byAdmin.id]);
    const sent = await manual(s.managerId, staff(s.ownerId));
    await tasks.reassign(s.managerId, sent.id, { to: { department: 'sales' } });
    expect((await tasks.get(sa, sent.id)).unmanaged).toBe(false);
  });

  it('an inactive assignee keeps the task, flagged for reassignment (Q11)', async () => {
    // admin_b: admin_a owns the family and cannot be deactivated.
    const t = await manual(s.managerId, staff(s.otherAdminId));
    await g.prisma.$executeRaw`UPDATE chat.staff SET is_active = false WHERE id = ${s.otherAdminId}::uuid`;
    const [row] = (await tasks.list(s.managerId, { view: 'team' })).items;
    expect(row).toMatchObject({ id: t.id, state: 'open', needsReassignment: true });
  });

  it('a comment changes nothing but the history', async () => {
    const t = await manual(s.managerId, staff(s.ownerId));
    await tasks.comment(s.managerId, t.id, { body: 'any news?' });
    await tasks.comment(s.ownerId, t.id, { body: 'tomorrow' });
    expect((await tasks.get(s.ownerId, t.id)).state).toBe('open');
    expect((await history(t.id)).map((e) => [e.kind, e.actor_id])).toEqual([
      ['created', s.managerId], ['commented', s.managerId], ['commented', s.ownerId],
    ]);
    expect(await code(tasks.comment(s.otherAdminId, t.id, { body: 'x' }))).toBe(CommErrorCode.TASK_NOT_FOUND);
  });
});

describe('the database', () => {
  it('refuses a change with no actor, a deletion, a move out of a final state, and any edit of the history', async () => {
    const t = await manual(s.managerId, staff(s.ownerId));
    await expect(g.prisma.$executeRaw`UPDATE chat.work_task SET state = 'removed' WHERE id = ${t.id}::uuid`).rejects.toThrow();
    await expect(g.prisma.$executeRaw`DELETE FROM chat.work_task WHERE id = ${t.id}::uuid`).rejects.toThrow();
    await expect(g.prisma.$executeRaw`UPDATE chat.work_task_event SET body = 'x' WHERE task_id = ${t.id}::uuid`).rejects.toThrow();
    await expect(g.prisma.$executeRaw`DELETE FROM chat.work_task_event WHERE task_id = ${t.id}::uuid`).rejects.toThrow();
    await tasks.complete(s.ownerId, t.id, {});
    await expect(
      g.prisma.$transaction([
        g.prisma.$executeRawUnsafe(`select set_config('chat.task_actor', $1, true)`, sa),
        g.prisma.$executeRawUnsafe(`update chat.work_task set state = 'open' where id = $1::uuid`, t.id),
      ]),
    ).rejects.toThrow();
  });

  it('refuses a removal or a return without a reason, even with an actor', async () => {
    const t = await manual(s.managerId, staff(s.ownerId));
    await expect(
      g.prisma.$transaction([
        g.prisma.$executeRawUnsafe(`select set_config('chat.task_actor', $1, true)`, sa),
        g.prisma.$executeRawUnsafe(`update chat.work_task set state = 'removed' where id = $1::uuid`, t.id),
      ]),
    ).rejects.toThrow();
  });

  it('refuses an actor who is inactive, or live staff of another organization', async () => {
    const t = await manual(s.managerId, staff(s.ownerId));
    const removeAs = (actor: string) =>
      g.prisma.$transaction([
        g.prisma.$executeRawUnsafe(`select set_config('chat.task_actor', $1, true)`, actor),
        g.prisma.$executeRawUnsafe(`select set_config('chat.task_note', 'x', true)`),
        g.prisma.$executeRawUnsafe(`update chat.work_task set state = 'removed' where id = $1::uuid`, t.id),
      ]);
    await expect(removeAs(farStaff)).rejects.toThrow(/live person of its organization/);
    await g.prisma.$executeRaw`UPDATE chat.staff SET is_active = false WHERE id = ${s.otherAdminId}::uuid`;
    await expect(removeAs(s.otherAdminId)).rejects.toThrow(/live person of its organization/);
    expect(await code(tasks.get(farStaff, t.id))).toBe(CommErrorCode.TASK_NOT_FOUND);
  });

  it('refuses a change that writes no history: instructions or activity on their own', async () => {
    const t = await manual(s.managerId, staff(s.ownerId));
    const asManager = (sql: string) =>
      g.prisma.$transaction([
        g.prisma.$executeRawUnsafe(`select set_config('chat.task_actor', $1, true)`, s.managerId),
        g.prisma.$executeRawUnsafe(`select set_config('chat.task_note', 'x', true)`),
        g.prisma.$executeRawUnsafe(sql, t.id),
      ]);
    await expect(asManager(`update chat.work_task set instructions = 'do it' where id = $1::uuid`)).rejects.toThrow(/instructions come with/);
    await expect(asManager(`update chat.work_task set activity_at = now() + interval '1 hour' where id = $1::uuid`)).rejects.toThrow(/recorded event/);
    expect((await tasks.get(s.ownerId, t.id)).revision).toBe(1);
  });

  it('refuses a forged event: only a comment is written directly, and only by the named actor', async () => {
    const t = await manual(s.managerId, staff(s.ownerId));
    const insertAs = (actor: string, kind: string, by: string) =>
      g.prisma.$transaction([
        g.prisma.$executeRawUnsafe(`select set_config('chat.task_actor', $1, true)`, actor),
        g.prisma.$executeRawUnsafe(
          `insert into chat.work_task_event (task_id, organization_id, kind, actor_kind, actor_id, body)
           values ($1::uuid, chat.default_organization_id(), $2, 'staff', $3::uuid, 'forged')`,
          t.id, kind, by,
        ),
      ]);
    await expect(insertAs(s.managerId, 'completed', s.managerId)).rejects.toThrow(/only a comment is written directly/);
    await expect(insertAs(s.managerId, 'commented', s.ownerId)).rejects.toThrow(/written by its actor/);
    await insertAs(s.ownerId, 'commented', s.ownerId);
    expect((await history(t.id)).map((e) => e.kind)).toEqual(['created', 'commented']);
    expect((await tasks.get(s.ownerId, t.id)).state).toBe('open');
  });

  it('refuses TRUNCATE of either table, outside the harness', async () => {
    await manual(s.managerId, staff(s.ownerId));
    await expect(g.prisma.$executeRawUnsafe(`truncate chat.work_task_event`)).rejects.toThrow(/never truncated/);
    await expect(g.prisma.$executeRawUnsafe(`truncate chat.work_task cascade`)).rejects.toThrow(/never truncated/);
    const [{ n }] = await g.prisma.$queryRaw<Array<{ n: bigint }>>`SELECT count(*) AS n FROM chat.work_task_event`;
    expect(Number(n)).toBe(1);
  });

  it('an assignee is exactly one of a staff member or a teacher', async () => {
    await expect(
      g.prisma.$transaction([
        g.prisma.$executeRawUnsafe(`select set_config('chat.task_actor', $1, true)`, sa),
        g.prisma.$executeRawUnsafe(
          `insert into chat.work_task (organization_id, kind, title, assignee_staff_id, assignee_teacher_id, created_by)
           values (chat.default_organization_id(), 'manual', 'x', $1::uuid, $2::uuid, $3::uuid)`,
          s.ownerId, s.teacherId, sa,
        ),
      ]),
    ).rejects.toThrow();
  });

  it('never writes the legacy chat.task (PD-4): it would widen family visibility', async () => {
    const t = await manual(s.managerId, staff(s.ownerId));
    await tasks.reassign(s.managerId, t.id, { to: staff(s.otherAdminId) });
    await tasks.complete(s.otherAdminId, t.id, {});
    const [{ n }] = await g.prisma.$queryRaw<Array<{ n: bigint }>>`SELECT count(*) AS n FROM chat.task`;
    expect(Number(n)).toBe(0);
  });
});

describe('the Dashboard (PD-44)', () => {
  it('counts what the lists show: Mine for everyone; the team, the decisions and the gone for a manager; unmanaged for the super admin', async () => {
    await manual(s.managerId, staff(s.ownerId), { dueAt: '2020-01-01T00:00:00Z' });
    const disputed = await manual(s.managerId, staff(s.otherAdminId));
    await tasks.outOfScope(s.otherAdminId, disputed.id, { comment: 'not mine' });
    await manual(sa, staff(tmgr));
    const tile = (tiles: Array<{ key: string; count: number }>, key: string) => tiles.find((t) => t.key === key)?.count;

    const mine = await tasks.dashboardCounts(s.ownerId);
    expect(mine.map((t) => t.key)).toEqual(['tasks.mine_open', 'tasks.mine_overdue']);
    expect([tile(mine, 'tasks.mine_open'), tile(mine, 'tasks.mine_overdue')]).toEqual([1, 1]);

    const mgr = await tasks.dashboardCounts(s.managerId);
    expect(tile(mgr, 'tasks.team_open')).toBe((await tasks.list(s.managerId, { view: 'team' })).items.length);
    expect(tile(mgr, 'tasks.team_open')).toBe(2);
    expect(tile(mgr, 'tasks.team_overdue')).toBe(1);
    expect(tile(mgr, 'tasks.awaiting_decision')).toBe((await tasks.list(s.managerId, { view: 'decisions' })).items.length);
    expect(tile(mgr, 'tasks.awaiting_decision')).toBe(1);
    expect(tile(mgr, 'tasks.unmanaged')).toBeUndefined();

    const top = await tasks.dashboardCounts(sa);
    expect(tile(top, 'tasks.unmanaged')).toBe(1);
    expect(tile(top, 'tasks.awaiting_decision')).toBe((await tasks.list(sa, { view: 'decisions' })).items.length);
  });
});

describe('the realtime signal', () => {
  it('every change enqueues task.changed with a rising revision, ids only', async () => {
    const t = await manual(s.managerId, staff(s.ownerId));
    await tasks.comment(s.ownerId, t.id, { body: 'on it' });
    await tasks.reassign(s.managerId, t.id, { to: staff(s.otherAdminId) });
    await tasks.complete(s.otherAdminId, t.id, {});
    const sig = await signals(t.id);
    expect(sig.map((p) => p.change)).toEqual(['created', 'commented', 'reassigned', 'completed']);
    const revs = sig.map((p) => p.revision);
    expect([...revs].sort((a, b) => a - b)).toEqual(revs);
    expect(new Set(revs).size).toBe(revs.length);
    for (const p of sig) expect(Object.keys(p).sort()).toEqual(['change', 'revision', 'taskId']);
  });
});
