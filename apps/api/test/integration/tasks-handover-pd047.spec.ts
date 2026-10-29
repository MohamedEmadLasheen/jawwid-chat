/**
 * PD-47 PR-6b -- tasks for work handed between people (plan §3.6, the owner's
 * answers of 2026-10-29).
 *
 *   teacher_unsupervised  an active teacher with no live supervisor: the
 *                         Teachers manager's, one per stretch (a spell); done
 *                         when a supervisor is assigned, by who assigned them;
 *                         withdrawn when the teacher leaves. Replaces PD-43's
 *                         two notices (pd043-manager-notifications-http.spec).
 *   trial_attendance      a trial over with no attendance: the teacher's; done
 *                         when it is recorded, by who recorded it
 *   trial_outcome         raised only once attendance is held: the prospect's
 *                         Sales owner's; done when the outcome is recorded.
 *                         Two tasks, each person seeing only their own step
 *                         (owner 2026-10-29, "Two tasks")
 *   every one             raised by the sweep and announced once
 *                         (task_assigned, ids only)
 *
 * Synthetic fixtures only (G-16).
 */
import { randomUUID } from 'node:crypto';
import { OutboxWorker } from '@communication/outbox/outbox.worker';
import { PrismaAuditService } from '@platform/audit.service';
import { LessonService } from '../../src/lessons/lesson.service';
import { SchedulingService } from '../../src/lessons/scheduling.service';
import { TrialGroupService } from '../../src/lessons/trial-group.service';
import { TrialService } from '../../src/lessons/trial.service';
import { NewStudentsService } from '../../src/new-students/new-students.service';
import { CardPoster } from '../../src/supervision/card-poster';
import { TaskService } from '../../src/tasks/task.service';
import { buildGraph, seed, truncate, Scenario } from './harness';

jest.setTimeout(120_000);

const g = buildGraph();
const tasks = new TaskService(g.prisma, g.outbox);
const audit = new PrismaAuditService();
const lessons = new LessonService(g.prisma, g.authz, g.conversations, g.outbox, g.config, audit);
const scheduling = new SchedulingService(g.prisma, g.authz, g.conversations, lessons, g.outbox, g.config, g.reminders, audit);
const groups = new TrialGroupService(g.prisma, g.authz, g.conversations, g.outbox, new CardPoster(g.conversations, g.outbox, audit), g.config, audit);
const trials = new TrialService(g.prisma, g.conversations, lessons, scheduling, audit, groups, new NewStudentsService(g.prisma));
const recorder = { toThread: async () => undefined, toThreadAudience: async () => undefined, toUsers: async () => undefined };
const worker = new OutboxWorker(g.prisma, g.notifications, recorder as never, g.identity, g.pipeline);

const MIN = 60_000;
const SOURCES = ['teacher_unsupervised', 'trial_attendance', 'trial_outcome'];

let s: Scenario;
let sa: string;
let tmgr: string;
let tsup: string;
let tsup2: string;
let tdept: string;
let salesId: string;
let smgr: string;
let trialsMade = 0;

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
const taskFor = async (key: string) =>
  (await g.prisma.$queryRaw<Array<{ id: string }>>`SELECT id::text AS id FROM chat.work_task WHERE source_key = ${key}`)[0]?.id;
/** A trial Sales booked for a prospect, over an hour or more ago, with nothing recorded yet. */
async function pastTrial(): Promise<string> {
  trialsMade += 1;
  const prospectId = (await trials.createProspect(salesId, { displayName: `prospect_${randomUUID().slice(0, 6)}` })).id;
  const startsAt = new Date(Date.now() - (60 + 60 * trialsMade) * MIN);
  const lesson = await g.prisma.lesson.create({
    data: {
      organizationId: (await g.prisma.teacher.findUniqueOrThrow({ where: { id: s.teacherId } })).organizationId,
      kind: 'trial', prospectId, teacherId: s.teacherId, startsAt, endsAt: new Date(startsAt.getTime() + 45 * MIN),
      createdByKind: 'staff', createdBy: salesId,
    },
  });
  return lesson.id;
}
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
  [sa, tmgr, tsup, tsup2, salesId, smgr] = [randomUUID(), randomUUID(), randomUUID(), randomUUID(), randomUUID(), randomUUID()];
  await g.prisma.$transaction([
    exec(`select set_config('chat.provisioning_super_admin', 'on', true)`),
    exec(`insert into chat.staff (id, name, role, is_active) values ($1::uuid, 'sa_h', 'super_admin', true)`, sa),
  ]);
  await exec(
    `insert into chat.staff (id, name, role, is_active) values ($1::uuid, 'tmgr_h', 'manager', true), ($2::uuid, 'tsup_h', 'admin', true),
       ($3::uuid, 'tsup2_h', 'admin', true), ($4::uuid, 'sales_h', 'admin', true), ($5::uuid, 'smgr_h', 'manager', true)`,
    tmgr, tsup, tsup2, salesId, smgr,
  );
  const [{ id: sdept }] = await g.prisma.$queryRawUnsafe<Array<{ id: string }>>(
    `insert into chat.department (kind, display_name, manager_id) values ('sales', 'sales', $1::uuid) returning id::text as id`, smgr,
  );
  await exec(
    `insert into chat.department_member (staff_id, organization_id, department_id, position)
     values ($1::uuid, chat.default_organization_id(), $2::uuid, 'supervisor')`, salesId, sdept,
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

describe('a trial: the teacher\'s attendance, then Sales\' outcome', () => {
  it('two tasks, each person seeing only their own step; each done by who did it', async () => {
    const lesson = await pastTrial();
    await tasks.sweep();
    const attendance = (await taskFor(`trial_attendance:${lesson}`)) as string;
    expect(await tasks.get(s.teacherId, attendance)).toMatchObject({
      assignee: { kind: 'teacher', id: s.teacherId },
      source: { type: 'trial_attendance', id: lesson },
      titleParams: { prospectName: expect.stringMatching(/^prospect_/), startsAt: expect.any(String) },
    });
    expect(await taskFor(`trial_outcome:${lesson}`)).toBeUndefined();
    await expect(tasks.get(salesId, attendance)).rejects.toThrow();

    await trials.attendance(s.teacherId, lesson, { attended: true, covered: 'tajweed basics' });
    expect(await tasks.get(s.teacherId, attendance)).toMatchObject({ state: 'completed', outcome: 'done' });
    expect((await completion(attendance))?.actor).toMatchObject({ kind: 'teacher', id: s.teacherId });

    await tasks.sweep();
    const outcome = (await taskFor(`trial_outcome:${lesson}`)) as string;
    expect(await tasks.get(salesId, outcome)).toMatchObject({ assignee: { kind: 'staff', id: salesId }, source: { type: 'trial_outcome', id: lesson } });
    await expect(tasks.get(s.teacherId, outcome)).rejects.toThrow();

    await trials.outcome(salesId, lesson, { result: 'not_subscribed', reason: 'price' });
    expect(await tasks.get(salesId, outcome)).toMatchObject({ state: 'completed', outcome: 'done' });
    expect((await completion(outcome))?.actor).toMatchObject({ kind: 'staff', id: salesId });
  });

  it('a prospect who did not attend owes no outcome task', async () => {
    const lesson = await pastTrial();
    await tasks.sweep();
    await trials.attendance(s.teacherId, lesson, { attended: false, note: 'did not join' });
    await tasks.sweep();
    expect(await tasks.get(s.teacherId, (await taskFor(`trial_attendance:${lesson}`)) as string)).toMatchObject({ state: 'completed' });
    expect(await taskFor(`trial_outcome:${lesson}`)).toBeUndefined();
  });

  it('with the prospect\'s creator gone, the Sales manager holds the outcome', async () => {
    const lesson = await pastTrial();
    await trials.attendance(s.teacherId, lesson, { attended: true, covered: 'tajweed basics' });
    await leaves(salesId);
    await tasks.sweep();
    const outcome = (await taskFor(`trial_outcome:${lesson}`)) as string;
    expect(await tasks.get(smgr, outcome)).toMatchObject({ assignee: { kind: 'staff', id: smgr } });
  });

  it('a trial cancelled before its attendance withdraws the teacher\'s task', async () => {
    const lesson = await pastTrial();
    await tasks.sweep();
    const attendance = (await taskFor(`trial_attendance:${lesson}`)) as string;
    await trials.cancel(salesId, lesson, { reason: 'the family asked to cancel' });
    expect(await tasks.get(s.teacherId, attendance)).toMatchObject({ state: 'open', sourceState: 'withdrawn' });
  });

  it('a trial not over yet has no task', async () => {
    const prospectId = (await trials.createProspect(salesId, { displayName: 'prospect_later' })).id;
    const startsAt = new Date(Date.now() + 60 * MIN);
    const later = await g.prisma.lesson.create({
      data: {
        organizationId: (await g.prisma.teacher.findUniqueOrThrow({ where: { id: s.teacherId } })).organizationId,
        kind: 'trial', prospectId, teacherId: s.teacherId, startsAt, endsAt: new Date(startsAt.getTime() + 45 * MIN),
        createdByKind: 'staff', createdBy: salesId,
      },
    });
    await tasks.sweep();
    expect(await taskFor(`trial_attendance:${later.id}`)).toBeUndefined();
  });
});

describe('each source is announced once', () => {
  it('one task_assigned push per source, to its assignee, with no variables -- however often the sweep runs', async () => {
    const waiting = await pastTrial();
    const attended = await pastTrial();
    await trials.attendance(s.teacherId, attended, { attended: true, covered: 'tajweed basics' });
    await tasks.sweep();
    await worker.drain(500);
    await tasks.sweep();
    await worker.drain(500);

    const [spell] = await spellTasks(s.teacherId);
    const expected: Array<[string, string, string]> = [
      ['teacher_unsupervised', spell!.id, tmgr],
      ['trial_attendance', (await taskFor(`trial_attendance:${waiting}`)) as string, s.teacherId],
      ['trial_outcome', (await taskFor(`trial_outcome:${attended}`)) as string, salesId],
    ];
    for (const [key, id, to] of expected) {
      const sent = await pushes(id);
      expect({ key, recipients: sent.map((p) => p.recipientId) }).toEqual({ key, recipients: [to] });
      for (const p of sent) expect(p.variables ?? {}).toEqual({});
    }
  });
});
