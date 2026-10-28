/**
 * PD-47 PR-4 -- task.changed reaches the people it is for (plan §3.10-§3.11).
 *
 *   signalled  every list that changed (the assignee, the person it left, the
 *              responsible managers, the super admin while it waits on a
 *              decision): task.changed on their actor rooms, ids only
 *   told       the one who must act now: a PD-34 'task' entry (Action tab,
 *              action open_task) with a generic push -- created/reassigned
 *              -> the assignee (not a lesson report when created), returned ->
 *              the assignee, out of scope -> the managers, overdue -> the
 *              assignee once per due date. Never the person who did it.
 *   settled    a task that left a person stops asking them anything
 *   never      the task's title or body, an amount, a family or a child in
 *              anything sent
 *
 * Synthetic fixtures only (G-16).
 */
import { randomUUID } from 'node:crypto';
import { OutboxWorker } from '@communication/outbox/outbox.worker';
import { TaskService } from '../../src/tasks/task.service';
import { buildGraph, seed, truncate, Scenario } from './harness';

const g = buildGraph();
const tasks = new TaskService(g.prisma, g.outbox);

const signals: Array<{ to: string[]; type: string; payload: Record<string, unknown> }> = [];
const recorder = {
  toThread: async () => undefined,
  toThreadAudience: async () => undefined,
  toUsers: async (to: string[], type: string, payload: Record<string, unknown>) => {
    signals.push({ to: [...to], type, payload });
  },
};
const worker = new OutboxWorker(g.prisma, g.notifications, recorder as never, g.identity, g.pipeline);

jest.setTimeout(120_000);

let s: Scenario;
let tmgr: string;

const staff = (id: string) => ({ kind: 'staff' as const, id });
const items = async (recipientId: string) =>
  g.prisma.notificationItem.findMany({ where: { recipientId, subjectType: 'task' }, orderBy: { createdAt: 'asc' } });
const taskSignals = () => signals.filter((x) => x.type === 'task.changed');
const hourAgo = () => new Date(Date.now() - 3_600_000).toISOString();

beforeAll(async () => {
  await g.prisma.$connect();
});
afterAll(async () => {
  await truncate(g.prisma);
  await g.prisma.$disconnect();
});
beforeEach(async () => {
  await truncate(g.prisma);
  signals.length = 0;
  // seed(): Operations is run by s.managerId; s.ownerId and s.otherAdminId are its supervisors.
  s = await seed(g.prisma);
  tmgr = randomUUID();
  await g.prisma.$executeRawUnsafe(`insert into chat.staff (id, name, role, is_active) values ($1::uuid, 'tmgr_k', 'manager', true)`, tmgr);
  await g.prisma.$executeRawUnsafe(`insert into chat.department (kind, display_name, manager_id) values ('teachers', 'teachers', $1::uuid)`, tmgr);
});

describe('a task reaches the person who must act', () => {
  it('given: the assignee is told -- an Action entry that opens the task -- and every list that changed is signalled; the giver is not told', async () => {
    const t = await tasks.create(s.managerId, { assignee: staff(s.otherAdminId), title: 'secret title', body: 'secret body', dueAt: '2026-12-01T09:00:00Z' });
    await worker.drain(100);
    const [entry] = await items(s.otherAdminId);
    expect(entry).toMatchObject({
      eventType: 'task_assigned', category: 'task', subjectType: 'task', subjectId: t.id,
      requiresAction: true, ownerId: s.otherAdminId, taskStatus: 'open', actedAt: null,
    });
    expect(entry?.dueAt?.toISOString()).toBe('2026-12-01T09:00:00.000Z');
    expect(entry?.action).toEqual({ kind: 'open_task', taskId: t.id });
    expect(await items(s.managerId)).toEqual([]);
    const [signal] = taskSignals();
    expect(signal?.to.sort()).toEqual([s.managerId, s.otherAdminId].sort());
    expect(Object.keys(signal!.payload).sort()).toEqual(['change', 'revision', 'taskId']);
    const sent = JSON.stringify({ entries: await g.prisma.notificationItem.findMany(), pushes: await g.prisma.notification.findMany() });
    expect(sent).not.toMatch(/secret/);
  });

  it('handed on: the new assignee is told; the one it left stops being asked, and their list is signalled', async () => {
    const t = await tasks.create(s.managerId, { assignee: staff(s.otherAdminId), title: 'x' });
    await worker.drain(100);
    signals.length = 0;
    await tasks.reassign(s.managerId, t.id, { to: staff(s.ownerId) });
    await worker.drain(100);
    expect((await items(s.ownerId)).map((i) => [i.eventType, i.actedAt])).toEqual([['task_assigned', null]]);
    const [left] = await items(s.otherAdminId);
    expect(left).toMatchObject({ eventType: 'task_assigned', taskStatus: 'cancelled' });
    expect(left?.actedAt).not.toBeNull();
    expect(taskSignals()[0]?.to).toEqual(expect.arrayContaining([s.ownerId, s.otherAdminId, s.managerId]));
  });

  it('not mine: the manager is told it waits on them; returned: the assignee is told; done: nobody is asked any more', async () => {
    const t = await tasks.create(s.managerId, { assignee: staff(s.otherAdminId), title: 'x' });
    await tasks.outOfScope(s.otherAdminId, t.id, { comment: 'not mine' });
    await worker.drain(100);
    expect((await items(s.managerId)).map((i) => [i.eventType, i.taskStatus])).toEqual([['task_out_of_scope', 'escalated']]);
    await tasks.returnTask(s.managerId, t.id, { instructions: 'it is yours' });
    await worker.drain(100);
    expect((await items(s.otherAdminId)).map((i) => i.eventType)).toEqual(['task_assigned', 'task_returned']);
    await tasks.complete(s.otherAdminId, t.id, {});
    await worker.drain(100);
    const all = await g.prisma.notificationItem.findMany({ where: { subjectType: 'task', subjectId: t.id } });
    expect(all.length).toBe(3);
    for (const i of all) {
      expect(i.actedAt).not.toBeNull();
      expect(i.taskStatus).toBe('done');
    }
  });

  it('overdue: the assignee is told once per due date; re-dated and overdue again, told again', async () => {
    const t = await tasks.create(s.managerId, { assignee: staff(s.otherAdminId), title: 'x', dueAt: hourAgo() });
    await worker.drain(100);
    expect(await tasks.sweepOverdue()).toBe(1);
    expect(await tasks.sweepOverdue()).toBe(0);
    await worker.drain(100);
    expect((await items(s.otherAdminId)).map((i) => i.eventType)).toEqual(['task_assigned', 'task_overdue']);
    await tasks.setDue(s.managerId, t.id, { dueAt: new Date(Date.now() - 1_800_000).toISOString() });
    expect(await tasks.sweepOverdue()).toBe(1);
    await worker.drain(100);
    expect((await items(s.otherAdminId)).filter((i) => i.eventType === 'task_overdue')).toHaveLength(2);
  });

  it('a lesson report is not announced when raised -- the teacher just taught it -- but is once overdue', async () => {
    const lesson = randomUUID();
    await g.prisma.$queryRaw`SELECT chat.work_task_raise(chat.default_organization_id(), 'lesson_report', ${lesson}::uuid, NULL,
      ${s.teacherId}::uuid, 'medium', 'operational', 'overdue_only', now() - interval '1 hour')`;
    await worker.drain(100);
    expect(await items(s.teacherId)).toEqual([]);
    expect(taskSignals().some((x) => x.to.includes(s.teacherId))).toBe(true);
    await tasks.sweepOverdue();
    await worker.drain(100);
    expect((await items(s.teacherId)).map((i) => i.eventType)).toEqual(['task_overdue']);
  });

  it('a financial task says nothing of money: no amount, no family, no variables at all', async () => {
    const source = randomUUID();
    await g.prisma.$queryRaw`SELECT chat.work_task_raise(chat.default_organization_id(), 'instalment', ${source}::uuid, ${s.ownerId}::uuid,
      NULL, 'low', 'financial', 'instalment', now() + interval '3 days')`;
    await worker.drain(100);
    const [entry] = await items(s.ownerId);
    expect(entry?.eventType).toBe('task_assigned');
    expect(entry?.variables).toEqual({});
    const pushes = await g.prisma.notification.findMany({ where: { recipientId: s.ownerId } });
    expect(pushes.length).toBeGreaterThan(0);
    for (const p of pushes) expect(p.variables ?? {}).toEqual({});
  });

  it('every task text is generic: no placeholder, no amount, no currency, no card, no name', async () => {
    const rows = await g.prisma.$queryRaw<Array<{ key: string; locale: string; title: string; body: string }>>`
      SELECT key, locale, title, body FROM chat.notification_template WHERE key LIKE 'task\\_%' OR key LIKE 'inbox.task\\_%'`;
    expect(rows.map((r) => `${r.key}:${r.locale}`).sort()).toEqual(
      ['task_assigned', 'task_returned', 'task_out_of_scope', 'task_overdue']
        .flatMap((k) => [k, `inbox.${k}`])
        .flatMap((k) => [`${k}:ar`, `${k}:en`])
        .sort(),
    );
    for (const r of rows) {
      const text = `${r.title} ${r.body}`;
      // Nothing is filled in, so nothing from the task, the family or the money can reach a lock screen.
      expect(text, r.key).not.toMatch(/\{|\}/);
      expect(text, r.key).not.toMatch(/[0-9\u0660-\u0669]/);
      expect(text, r.key).not.toMatch(/EGP|USD|SAR|\$|£|€|ج\.م|card|بطاقة|instalment|قسط|family|أسرة|عائلة|child|طفل/i);
    }
  });

  it('a task closed before its signal is delivered tells no one, and signals still go', async () => {
    const t = await tasks.create(s.managerId, { assignee: staff(s.otherAdminId), title: 'x' });
    await tasks.remove(s.managerId, t.id, { reason: 'duplicate' });
    await worker.drain(100);
    expect(await items(s.otherAdminId)).toEqual([]);
    expect(taskSignals().length).toBeGreaterThan(0);
  });
});
