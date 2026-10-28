/**
 * PD-47 PR-2b -- financial tasks from their sources.
 * Plan: docs/product/pd047-amendment-priority.md §5-§6 (owner-approved 2026-10-28).
 *
 *   instalment       the billing owner's, from D-7 (Yellow) to D0 (Red); completed
 *                    when paid, withdrawn when voided
 *   package_low      the Sales owner's (else the Sales manager's) at <= 2 lessons
 *                    left; High at 0; completed by a new package
 *   renewal_request  the same owner's, High at once; completed by a new package
 *   every one        category financial; it follows its owner, never by hand
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
let smgr: string;
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

const exec = (sql: string, ...args: unknown[]) => g.prisma.$executeRawUnsafe(sql, ...args);
const taskFor = async (key: string) =>
  (await g.prisma.$queryRaw<Array<{ id: string }>>`SELECT id::text AS id FROM chat.work_task WHERE source_key = ${key}`)[0]?.id;
const SOURCES = ['instalment', 'renewal_request', 'receipt_review', 'checkout_failed'];

/** A child instalment of family_x's learner_l, due `days` from the academy's today. */
async function instalment(days: number): Promise<string> {
  const [{ id }] = await g.prisma.$queryRawUnsafe<Array<{ id: string }>>(
    `insert into chat.family_instalment (family_id, learner_id, label, amount_minor, currency, due_date, created_by)
     values ($1::uuid, $2::uuid, 'October', 50000, 'EGP', chat.academy_today() + $3::int, $4::uuid)
     returning id::text as id`,
    s.familyId, s.learnerId, days, s.managerId,
  );
  return id;
}

/** A package of `lessons` for learner_l, entered by the Operations manager. */
async function packageOf(lessons: number): Promise<string> {
  const [{ id }] = await g.prisma.$queryRawUnsafe<Array<{ id: string }>>(
    `insert into chat.learner_subscription (organization_id, learner_id, family_id, lessons_included, starts_on, source, created_by)
     values (chat.default_organization_id(), $1::uuid, $2::uuid, $3::int, chat.academy_today(), 'staff', $4::uuid)
     returning id::text as id`,
    s.learnerId, s.familyId, lessons, s.managerId,
  );
  return id;
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
  // seed(): Operations is run by s.managerId; s.ownerId supervises learner_l.
  s = await seed(g.prisma);
  [smgr, sa] = [randomUUID(), randomUUID()];
  await exec(`insert into chat.staff (id, name, role, is_active) values ($1::uuid, 'smgr_f', 'manager', true)`, smgr);
  await g.prisma.$transaction([
    exec(`select set_config('chat.provisioning_super_admin', 'on', true)`),
    exec(`insert into chat.staff (id, name, role, is_active) values ($1::uuid, 'sa_f', 'super_admin', true)`, sa),
  ]);
  await exec(`insert into chat.department (kind, display_name, manager_id) values ('sales', 'sales', $1::uuid)`, smgr);
  for (const src of SOURCES) {
    await exec(`insert into chat.config (key, value) values ($1, to_jsonb('2000-01-01T00:00:00Z'::text))
                on conflict (key) do update set value = excluded.value`, `tasks.since.${src}`);
  }
});

// ---------------------------------------------------------------------------

describe('instalments', () => {
  it('from D-7 an instalment is its child\'s supervisor\'s financial task, Yellow; not before', async () => {
    const soon = await instalment(5);
    const later = await instalment(10);
    await tasks.sweep();
    expect(await taskFor(`instalment:${later}`)).toBeUndefined();
    const id = (await taskFor(`instalment:${soon}`)) as string;
    expect(await tasks.get(s.ownerId, id)).toMatchObject({
      assignee: { kind: 'staff', id: s.ownerId },
      category: 'financial',
      effectivePriority: 'medium',
      priorityReason: 'due_soon',
      source: { type: 'instalment', id: soon },
      titleParams: expect.objectContaining({ label: 'October', currency: 'EGP' }),
    });
  });

  it('on its due day it is Red; overdue after it', async () => {
    const today = await instalment(0);
    const late = await instalment(-2);
    await tasks.sweep();
    expect(await tasks.get(s.ownerId, (await taskFor(`instalment:${today}`)) as string))
      .toMatchObject({ effectivePriority: 'high', priorityReason: 'due_soon', overdue: false });
    expect(await tasks.get(s.ownerId, (await taskFor(`instalment:${late}`)) as string))
      .toMatchObject({ effectivePriority: 'high', priorityReason: 'overdue', overdue: true });
  });

  it('a voided instalment withdraws its task; it stays until acknowledged', async () => {
    const inst = await instalment(3);
    await tasks.sweep();
    const id = (await taskFor(`instalment:${inst}`)) as string;
    await exec(`update chat.family_instalment set voided_at = now(), voided_by = $2::uuid, void_reason = 'entered twice' where id = $1::uuid`,
      inst, s.managerId);
    expect(await tasks.get(s.ownerId, id)).toMatchObject({ state: 'open', sourceState: 'withdrawn' });
  });

  it('follows its owner, never by hand', async () => {
    const inst = await instalment(3);
    await tasks.sweep();
    const id = (await taskFor(`instalment:${inst}`)) as string;
    expect(await code(tasks.reassign(s.managerId, id, { to: { kind: 'staff', id: s.otherAdminId } }))).toBe(CommErrorCode.TASK_DENIED);
    await expect(
      g.prisma.$transaction([
        exec(`select set_config('chat.task_actor', $1, true)`, sa),
        exec(`update chat.work_task set assignee_staff_id = $2::uuid where id = $1::uuid`, id, s.otherAdminId),
      ]),
    ).rejects.toThrow(/follows its source/);
  });

  it('sorts first among the operational tasks of its colour', async () => {
    await instalment(3);
    await tasks.create(s.managerId, { assignee: { kind: 'staff', id: s.ownerId }, title: 'call back', priority: 'medium' });
    await tasks.sweep();
    const [first, second] = (await tasks.list(s.ownerId, { view: 'mine' })).items;
    expect([first.category, second.category]).toEqual(['financial', 'operational']);
  });
});

describe('packages and renewals', () => {
  it('a child with 2 lessons left is the Sales manager\'s task (no Sales owner); a new package completes it', async () => {
    const first = await packageOf(2);
    const id = (await taskFor(`package_low:${first}`)) as string;
    expect(id).toBeDefined();
    expect(await tasks.get(smgr, id)).toMatchObject({
      assignee: { kind: 'staff', id: smgr }, category: 'financial', effectivePriority: 'medium',
    });
    await packageOf(10);
    expect(await tasks.get(smgr, id)).toMatchObject({ state: 'completed', closedBy: { id: s.managerId } });
  });

  it('a renewal the parent asks for is High at once, and a new package completes it', async () => {
    const first = await packageOf(8);
    await exec(`insert into chat.renewal_request (organization_id, learner_id, family_id, requested_by)
                values (chat.default_organization_id(), $1::uuid, $2::uuid, $3::uuid)`, s.learnerId, s.familyId, s.parentId);
    const id = (await taskFor(`renewal_request:${first}`)) as string;
    expect(await tasks.get(smgr, id)).toMatchObject({ effectivePriority: 'high', category: 'financial' });
    await packageOf(10);
    expect((await tasks.get(smgr, id)).state).toBe('completed');
  });
});
