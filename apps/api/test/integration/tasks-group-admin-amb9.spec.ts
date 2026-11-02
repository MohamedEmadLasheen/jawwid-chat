/**
 * AMB-9 (G-43) -- a group left without a live admin becomes a Needs-action
 * task (department head, under the owner's Phase 1 delegation, 2026-11-02).
 *
 *   the state     the API's BR-1 rule: a group pairing a live teacher member
 *                 with a live parent member and no live admin (a member row
 *                 survives its staff member's deactivation). The teacher's
 *                 send is refused with BR1_ADMIN_PRESENCE_REQUIRED exactly
 *                 when chat.group_admin_absent says so.
 *   the task      group_admin_absent, raised by the sweep: the group's
 *                 child's live supervisor, else the Operations manager; high,
 *                 operational; announced once (task_assigned)
 *   done          when an admin is present again, at once, by who added them
 *                 (or the admin themself, reactivated); a later stretch is a
 *                 fresh task
 *   withdrawn     when the group no longer pairs a teacher with a parent
 *   never blocks  the staff or membership write that moves it
 *
 * Synthetic fixtures only (G-16).
 */
import { randomUUID } from 'node:crypto';
import { OutboxWorker } from '@communication/outbox/outbox.worker';
import { CommError, CommErrorCode } from '@platform/errors';
import { TaskService } from '../../src/tasks/task.service';
import { buildGraph, seed, truncate, Scenario } from './harness';

jest.setTimeout(120_000);

const g = buildGraph();
const tasks = new TaskService(g.prisma, g.outbox);
const recorder = { toThread: async () => undefined, toThreadAudience: async () => undefined, toUsers: async () => undefined };
const worker = new OutboxWorker(g.prisma, g.notifications, recorder as never, g.identity, g.pipeline);

let s: Scenario;
let sa: string;
let group: string;
/** A third admin, so each offboarding has someone live to take the families. */
let spare: string;

const exec = (sql: string, ...args: unknown[]) => g.prisma.$executeRawUnsafe(sql, ...args);
/**
 * The super admin offboards a staff member as the console does: their families
 * move to another (chat.offboard_staff), but a group's admin member row stays --
 * the state AMB-9 is about.
 */
const leaves = async (staffId: string) => {
  const [{ to }] = await g.prisma.$queryRaw<Array<{ to: string }>>`
    SELECT id::text AS to FROM chat.staff
     WHERE id IN (${s.ownerId}::uuid, ${s.otherAdminId}::uuid, ${spare}::uuid) AND id <> ${staffId}::uuid
       AND is_active AND left_at IS NULL
     ORDER BY name LIMIT 1`;
  await g.prisma.$queryRaw`SELECT count(*) FROM chat.offboard_staff(${staffId}::uuid, 'left the academy', ${to}::uuid, ${sa}::uuid)`;
};
const returns = (staffId: string) => exec(`update chat.staff set is_active = true, left_at = null where id = $1::uuid`, staffId);
/** An admin member added to the group by `by` (null: the system). */
const addAdmin = (conversationId: string, staffId: string, by: string | null) =>
  exec(
    `insert into chat.conversation_member (conversation_id, actor_kind, actor_id, member_role, added_by)
     values ($1::uuid, 'staff', $2::uuid, 'admin', $3::uuid)`,
    conversationId, staffId, by,
  );
const removeMember = (conversationId: string, actorId: string) =>
  exec(`update chat.conversation_member set left_at = now() where conversation_id = $1::uuid and actor_id = $2::uuid and left_at is null`,
    conversationId, actorId);
/** The group's tasks, oldest spell first. */
const groupTasks = (conversationId: string) =>
  g.prisma.$queryRaw<Array<{ id: string; spell: string; closed: boolean; state: string; source_state: string; assignee: string;
                             priority: string; category: string; opened_at: Date; due_at: Date }>>`
    SELECT t.id::text AS id, sp.id::text AS spell, sp.closed_at IS NOT NULL AS closed, t.state, t.source_state,
           t.assignee_staff_id::text AS assignee, t.priority, t.category, sp.opened_at, t.due_at
      FROM chat.work_task t JOIN chat.work_task_group_admin_spell sp ON t.source_key = 'group_admin_absent:' || sp.id
     WHERE sp.conversation_id = ${conversationId}::uuid
     ORDER BY sp.opened_at, sp.id`;
const spells = (conversationId: string) =>
  g.prisma.$queryRaw<Array<{ id: string; closed: boolean }>>`
    SELECT id::text AS id, closed_at IS NOT NULL AS closed FROM chat.work_task_group_admin_spell
     WHERE conversation_id = ${conversationId}::uuid ORDER BY opened_at, id`;
const absent = async (conversationId: string) =>
  (await g.prisma.$queryRaw<Array<{ a: boolean }>>`SELECT chat.group_admin_absent(${conversationId}::uuid) AS a`)[0]!.a;
const completion = async (id: string) => (await tasks.get(sa, id)).history.find((e) => e.kind === 'completed');
const pushes = (taskId: string) =>
  g.prisma.notification.findMany({ where: { templateKey: 'task_assigned', dedupeKey: { startsWith: `task_assigned:${taskId}:` } } });
/** The teacher's send: refused for BR-1, or let through. */
async function teacherMaySend(conversationId: string): Promise<boolean | string> {
  try {
    await g.messages.send({ conversationId, senderId: s.teacherId, body: `hello ${randomUUID().slice(0, 6)}`, clientMessageId: randomUUID() });
    return true;
  } catch (e) {
    if (e instanceof CommError) return e.code === CommErrorCode.BR1_ADMIN_PRESENCE_REQUIRED ? false : e.code;
    throw e;
  }
}
async function refusingTaskChanges(fn: () => Promise<unknown>) {
  await exec(`alter table chat.work_task add constraint amb9_spec_refuses_changes check (revision < 0) not valid`);
  try {
    await fn();
  } finally {
    await exec(`alter table chat.work_task drop constraint amb9_spec_refuses_changes`);
  }
}

let windowBefore: unknown;

beforeAll(async () => {
  await g.prisma.$connect();
  windowBefore = (await g.prisma.$queryRaw<Array<{ value: unknown }>>`SELECT value FROM chat.config WHERE key = 'tasks.raise_after_seconds'`)[0]?.value;
});
afterAll(async () => {
  if (windowBefore === undefined) await exec(`delete from chat.config where key = 'tasks.raise_after_seconds'`);
  else await exec(`update chat.config set value = $1::jsonb where key = 'tasks.raise_after_seconds'`, JSON.stringify(windowBefore));
  await truncate(g.prisma);
  await g.prisma.$disconnect();
});
beforeEach(async () => {
  await truncate(g.prisma);
  // seed(): admin_a (ownerId) supervises learner_l; manager_c (managerId) runs Operations.
  s = await seed(g.prisma);
  g.coverage.onDutyId = s.ownerId;
  sa = randomUUID();
  spare = randomUUID();
  await g.prisma.$transaction([
    exec(`select set_config('chat.provisioning_super_admin', 'on', true)`),
    exec(`insert into chat.staff (id, name, role, is_active) values ($1::uuid, 'sa_g', 'super_admin', true)`, sa),
  ]);
  await exec(`insert into chat.staff (id, name, role, is_active) values ($1::uuid, 'admin_z', 'admin', true)`, spare);
  await exec(`insert into chat.config (key, value) values ('tasks.since.group_admin_absent', to_jsonb('2000-01-01T00:00:00Z'::text))
              on conflict (key) do update set value = excluded.value`);
  await exec(`insert into chat.config (key, value) values ('tasks.raise_after_seconds', to_jsonb(0))
              on conflict (key) do update set value = excluded.value`);
  // learner_l's group: the parent, the teacher, and admin_a (the child's supervisor) as its admin.
  group = (await g.conversations.ensureStudentGroup(s.learnerId, s.ownerId)).id;
});

// ---------------------------------------------------------------------------

describe('a group left without a live admin', () => {
  it('is the state the API refuses: the teacher may send with an admin present, not once the admin is gone', async () => {
    expect(await absent(group)).toBe(false);
    expect(await teacherMaySend(group)).toBe(true);
    await leaves(s.ownerId);
    expect(await absent(group)).toBe(true);
    expect(await teacherMaySend(group)).toBe(false);
  });

  it('becomes a high operational task for the Operations manager when the child\'s supervisor is the admin who left; announced once', async () => {
    await leaves(s.ownerId);
    // The spell opened at the moment the admin left; the sweep raises its task.
    expect(await spells(group)).toHaveLength(1);
    await tasks.sweep();
    const [t] = await groupTasks(group);
    expect(t).toMatchObject({ state: 'open', source_state: 'pending', assignee: s.managerId, priority: 'high', category: 'operational' });
    expect(t!.due_at.getTime() - t!.opened_at.getTime()).toBe(24 * 3_600_000);
    expect(await tasks.get(s.managerId, t!.id)).toMatchObject({
      source: { type: 'group_admin_absent', id: t!.spell },
      titleParams: { conversationId: group, groupType: 'student_group', groupTitle: expect.any(String) },
    });
    await tasks.sweep();
    expect(await groupTasks(group)).toHaveLength(1);
  });

  it('is the group\'s supervisor\'s when the admin who left was someone else', async () => {
    // admin_b becomes the group's admin in admin_a's place; admin_a still supervises learner_l.
    await addAdmin(group, s.otherAdminId, s.managerId);
    await removeMember(group, s.ownerId);
    await leaves(s.otherAdminId);
    await tasks.sweep();
    expect((await groupTasks(group))[0]).toMatchObject({ assignee: s.ownerId });
  });

  it('an admin added back completes it at once, by who added them; the teacher may send again', async () => {
    await leaves(s.ownerId);
    await tasks.sweep();
    const [t] = await groupTasks(group);
    await addAdmin(group, s.otherAdminId, s.managerId);
    expect(await tasks.get(sa, t!.id)).toMatchObject({ state: 'completed', outcome: 'done' });
    expect((await completion(t!.id))?.actor).toMatchObject({ kind: 'staff', id: s.managerId });
    expect((await groupTasks(group))[0]!.closed).toBe(true);
    expect(await teacherMaySend(group)).toBe(true);
  });

  it('the admin reactivated completes it, as the admin themself', async () => {
    await leaves(s.ownerId);
    await tasks.sweep();
    const [t] = await groupTasks(group);
    await returns(s.ownerId);
    expect(await tasks.get(sa, t!.id)).toMatchObject({ state: 'completed', outcome: 'done' });
    expect((await completion(t!.id))?.actor).toMatchObject({ kind: 'staff', id: s.ownerId });
  });

  it('an admin replaced before the sweep sees the group raises nothing', async () => {
    await leaves(s.ownerId);
    await addAdmin(group, s.otherAdminId, s.managerId);
    await tasks.sweep();
    expect(await groupTasks(group)).toHaveLength(0);
    expect(await spells(group)).toEqual([expect.objectContaining({ closed: true })]);
  });

  it('a second stretch without an admin is a FRESH task, never the spent one again', async () => {
    await leaves(s.ownerId);
    await tasks.sweep();
    await addAdmin(group, s.otherAdminId, s.managerId);
    await leaves(s.otherAdminId);
    await tasks.sweep();
    const both = await groupTasks(group);
    expect(both.map((t) => [t.state, t.closed])).toEqual([['completed', true], ['open', false]]);
    expect(both[0]!.spell).not.toBe(both[1]!.spell);
  });

  it('is withdrawn when the group no longer pairs a teacher with a parent, and back when it does again', async () => {
    await leaves(s.ownerId);
    await tasks.sweep();
    const [t] = await groupTasks(group);
    await removeMember(group, s.teacherId);
    await tasks.sweep();
    expect((await groupTasks(group))[0]).toMatchObject({ state: 'open', source_state: 'withdrawn' });
    await exec(`insert into chat.conversation_member (conversation_id, actor_kind, actor_id, member_role)
                values ($1::uuid, 'teacher', $2::uuid, 'teacher')`, group, s.teacherId);
    await tasks.sweep();
    expect((await groupTasks(group))[0]).toMatchObject({ id: t!.id, state: 'open', source_state: 'pending' });
  });

  it('a group without a parent, or a direct channel, never raises one', async () => {
    await exec(`update chat.conversation_member set left_at = now() where conversation_id = $1::uuid and actor_kind = 'contact' and left_at is null`, group);
    await leaves(s.ownerId);
    await tasks.sweep();
    expect(await absent(group)).toBe(false);
    expect(await spells(group)).toHaveLength(0);
  });

  it('never blocks the write that moves it: a refused task step is recorded, and the sweep settles it after', async () => {
    await leaves(s.ownerId);
    await tasks.sweep();
    const [t] = await groupTasks(group);
    await refusingTaskChanges(() => returns(s.ownerId));
    expect((await g.prisma.staff.findUniqueOrThrow({ where: { id: s.ownerId } })).isActive).toBe(true);
    expect((await groupTasks(group))[0]).toMatchObject({ state: 'open' });
    const issues = await g.prisma.$queryRaw<Array<{ n: number }>>`
      SELECT count(*)::int AS n FROM chat.work_task_source_issue WHERE source_key LIKE 'group_admin_absent:%'`;
    expect(issues[0]!.n).toBeGreaterThan(0);
    await tasks.sweep();
    expect(await tasks.get(sa, t!.id)).toMatchObject({ state: 'completed', outcome: 'done' });
    expect((await completion(t!.id))?.actor).toMatchObject({ kind: 'staff', id: s.ownerId });
  });

  it('an assignee who leaves hands it to the group\'s owner now', async () => {
    await leaves(s.ownerId);
    await tasks.sweep();
    const [t] = await groupTasks(group);
    expect(t!.assignee).toBe(s.managerId);
    await leaves(s.managerId);
    await tasks.sweep();
    expect((await groupTasks(group))[0]).toMatchObject({ assignee: sa });
  });

  it('announces the task once to its assignee, with no variables, however often the sweep runs', async () => {
    await leaves(s.ownerId);
    await tasks.sweep();
    await worker.drain(500);
    await tasks.sweep();
    await worker.drain(500);
    const [t] = await groupTasks(group);
    const sent = await pushes(t!.id);
    expect(sent.map((p) => p.recipientId)).toEqual([s.managerId]);
    for (const p of sent) expect(p.variables ?? {}).toEqual({});
  });
});
