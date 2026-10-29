/**
 * PD-47 PR-6b -- tasks for work handed between people (plan §3.6, the owner's
 * answers of 2026-10-29).
 *
 *   teacher_unsupervised  an active teacher with no live supervisor: the
 *                         Teachers manager's, one per stretch (a spell); done
 *                         when a supervisor is assigned, by who assigned them;
 *                         withdrawn when the teacher leaves. Replaces PD-43's
 *                         two notices (pd043-manager-notifications-http.spec).
 *   every one             raised by the sweep and announced once
 *                         (task_assigned, ids only)
 *
 * Synthetic fixtures only (G-16).
 */
import { randomUUID } from 'node:crypto';
import { OutboxWorker } from '@communication/outbox/outbox.worker';
import { TaskService } from '../../src/tasks/task.service';
import { buildGraph, seed, truncate, Scenario } from './harness';

jest.setTimeout(120_000);

const g = buildGraph();
const tasks = new TaskService(g.prisma, g.outbox);
const recorder = { toThread: async () => undefined, toThreadAudience: async () => undefined, toUsers: async () => undefined };
const worker = new OutboxWorker(g.prisma, g.notifications, recorder as never, g.identity, g.pipeline);

const SOURCES = ['teacher_unsupervised'];

let s: Scenario;
let sa: string;
let tmgr: string;
let tsup: string;
let tsup2: string;
let tdept: string;

const exec = (sql: string, ...args: unknown[]) => g.prisma.$executeRawUnsafe(sql, ...args);
/** The completion event, read as the super admin (who sees every task). */
const completion = async (id: string) => (await tasks.get(sa, id)).history.find((e) => e.kind === 'completed');
/** The task_assigned pushes for one task: one per recipient, ever. */
const pushes = (taskId: string) =>
  g.prisma.notification.findMany({ where: { templateKey: 'task_assigned', dedupeKey: { startsWith: `task_assigned:${taskId}:` } } });
/** A teacher's teacher_unsupervised tasks, oldest spell first. */
const spellTasks = async (teacherId: string) =>
  g.prisma.$queryRaw<Array<{ id: string; spell: string; closed: boolean }>>`
    SELECT t.id::text AS id, sp.id::text AS spell, sp.closed_at IS NOT NULL AS closed
      FROM chat.work_task t JOIN chat.work_task_teacher_spell sp ON t.source_key = 'teacher_unsupervised:' || sp.id
     WHERE sp.teacher_id = ${teacherId}::uuid
     ORDER BY sp.opened_at, sp.id`;
const supervise = (teacherId: string, supervisorId: string, by: string | null) =>
  exec(
    `insert into chat.teacher_supervisor_assignment (teacher_id, organization_id, supervisor_id, assigned_by)
     values ($1::uuid, chat.default_organization_id(), $2::uuid, $3::uuid)
     on conflict (teacher_id) do update set supervisor_id = excluded.supervisor_id, assigned_by = excluded.assigned_by,
                                            assigned_at = now()`,
    teacherId, supervisorId, by,
  );
const leaves = (staffId: string) =>
  g.prisma.$queryRaw`SELECT chat.deactivate_principal('staff', ${staffId}::uuid, 'left the academy', null, 'deactivated')::text`;

beforeAll(async () => {
  await g.prisma.$connect();
});
afterAll(async () => {
  await truncate(g.prisma);
  await g.prisma.$disconnect();
});
beforeEach(async () => {
  await truncate(g.prisma);
  // seed(): s.teacherId has no supervisor of their own.
  s = await seed(g.prisma);
  g.coverage.onDutyId = s.ownerId;
  [sa, tmgr, tsup, tsup2] = [randomUUID(), randomUUID(), randomUUID(), randomUUID()];
  await g.prisma.$transaction([
    exec(`select set_config('chat.provisioning_super_admin', 'on', true)`),
    exec(`insert into chat.staff (id, name, role, is_active) values ($1::uuid, 'sa_h', 'super_admin', true)`, sa),
  ]);
  await exec(
    `insert into chat.staff (id, name, role, is_active) values ($1::uuid, 'tmgr_h', 'manager', true), ($2::uuid, 'tsup_h', 'admin', true),
       ($3::uuid, 'tsup2_h', 'admin', true)`, tmgr, tsup, tsup2,
  );
  [{ id: tdept }] = await g.prisma.$queryRawUnsafe<Array<{ id: string }>>(
    `insert into chat.department (kind, display_name, manager_id) values ('teachers', 'teachers', $1::uuid) returning id::text as id`, tmgr,
  );
  for (const staffId of [tsup, tsup2]) {
    await exec(
      `insert into chat.department_member (staff_id, organization_id, department_id, position)
       values ($1::uuid, chat.default_organization_id(), $2::uuid, 'supervisor')`, staffId, tdept,
    );
  }
  for (const src of SOURCES) {
    await exec(`insert into chat.config (key, value) values ($1, to_jsonb('2000-01-01T00:00:00Z'::text))
                on conflict (key) do update set value = excluded.value`, `tasks.since.${src}`);
  }
});

// ---------------------------------------------------------------------------

describe('a teacher without a supervisor', () => {
  it('is the Teachers manager\'s task; assigning a supervisor completes it at once, by who assigned them', async () => {
    await tasks.sweep();
    const [first] = await spellTasks(s.teacherId);
    expect(first).toBeDefined();
    expect(await tasks.get(tmgr, first!.id)).toMatchObject({
      assignee: { kind: 'staff', id: tmgr },
      category: 'operational',
      source: { type: 'teacher_unsupervised', id: first!.spell },
      titleParams: { teacherId: s.teacherId, teacherName: expect.any(String) },
    });
    await supervise(s.teacherId, tsup, tmgr);
    expect(await tasks.get(tmgr, first!.id)).toMatchObject({ state: 'completed', outcome: 'done' });
    expect((await completion(first!.id))?.actor).toMatchObject({ kind: 'staff', id: tmgr });
    expect((await spellTasks(s.teacherId))[0]!.closed).toBe(true);
  });

  it('a teacher supervised before the sweep sees them has no task', async () => {
    await supervise(s.teacherId, tsup, tmgr);
    await tasks.sweep();
    expect(await spellTasks(s.teacherId)).toHaveLength(0);
  });

  it('their supervisor leaving starts a FRESH task: one per stretch, never the spent one again', async () => {
    await tasks.sweep();
    await supervise(s.teacherId, tsup, tmgr);
    await leaves(tsup);
    await tasks.sweep();
    const both = await spellTasks(s.teacherId);
    expect(both).toHaveLength(2);
    expect(both[0]!.spell).not.toBe(both[1]!.spell);
    expect(await tasks.get(tmgr, both[1]!.id)).toMatchObject({ state: 'open', sourceState: 'pending', assignee: { id: tmgr } });

    await supervise(s.teacherId, tsup2, tmgr);
    expect(await tasks.get(tmgr, both[1]!.id)).toMatchObject({ state: 'completed', outcome: 'done' });
    await tasks.sweep();
    expect(await spellTasks(s.teacherId)).toHaveLength(2);
  });

  it('a supervisor placed by the CLI names nobody: the system completes it', async () => {
    await tasks.sweep();
    const [first] = await spellTasks(s.teacherId);
    await supervise(s.teacherId, tsup, null);
    expect(await tasks.get(tmgr, first!.id)).toMatchObject({ state: 'completed', outcome: 'done' });
    expect((await completion(first!.id))?.actor ?? null).toBeNull();
  });

  it('a teacher who leaves takes the work with them: withdrawn; back if they return unsupervised', async () => {
    await tasks.sweep();
    const [first] = await spellTasks(s.teacherId);
    await exec(`update chat.teacher set is_active = false, left_at = now() where id = $1::uuid`, s.teacherId);
    await tasks.sweep();
    expect(await tasks.get(tmgr, first!.id)).toMatchObject({ state: 'open', sourceState: 'withdrawn' });
    await exec(`update chat.teacher set is_active = true, left_at = null where id = $1::uuid`, s.teacherId);
    await tasks.sweep();
    expect(await tasks.get(tmgr, first!.id)).toMatchObject({ state: 'open', sourceState: 'pending' });
  });

  it('with no Teachers manager, the super admin holds it', async () => {
    await exec(`update chat.department set manager_id = null where id = $1::uuid`, tdept);
    await tasks.sweep();
    const [first] = await spellTasks(s.teacherId);
    expect(await tasks.get(sa, first!.id)).toMatchObject({ assignee: { kind: 'staff', id: sa } });
  });

  it('a stretch begun before the cut-off stays a page\'s, not a task', async () => {
    await exec(`update chat.config set value = to_jsonb(now()::text) where key = 'tasks.since.teacher_unsupervised'`);
    await tasks.sweep();
    expect(await spellTasks(s.teacherId)).toHaveLength(0);
  });
});

describe('each source is announced once', () => {
  it('one task_assigned push per source, to its assignee, with no variables -- however often the sweep runs', async () => {
    await tasks.sweep();
    await worker.drain(500);
    await tasks.sweep();
    await worker.drain(500);

    const [spell] = await spellTasks(s.teacherId);
    const expected: Array<[string, string, string]> = [['teacher_unsupervised', spell!.id, tmgr]];
    for (const [key, id, to] of expected) {
      const sent = await pushes(id);
      expect({ key, recipients: sent.map((p) => p.recipientId) }).toEqual({ key, recipients: [to] });
      for (const p of sent) expect(p.variables ?? {}).toEqual({});
    }
  });
});
