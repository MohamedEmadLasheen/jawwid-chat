/**
 * PD-47 PR-6a -- set-up tasks from their sources (plan §3.6, Phase B).
 *
 *   family_unsupervised  a family with a child no Operations supervisor holds:
 *                        the Operations manager's; done when every child has
 *                        one, by who placed the last
 *   teacher_setup        an active teacher with PD-43's set-up unfinished: the
 *                        teacher's owner's; done when every item is (nobody
 *                        named), withdrawn when the teacher leaves
 *   new_student_assign   a subscribed trial's form not yet assigned: the
 *                        Operations manager's; done by the assignment,
 *                        withdrawn (and back) with the outcome's corrections
 *   new_student_group    a new family without its group: the children's
 *                        supervisor's; done when the group is opened
 *   every one            raised by the sweep once the occurrence is past the
 *                        settle window, announced once (task_assigned, ids
 *                        only), never raised for what is settled in the same
 *                        request; a source's write stands even when its task
 *                        cannot be settled; a task whose assignee left moves
 *                        to the owner now, or is recorded as orphaned
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
import { NewStudentEnrolmentService } from '../../src/new-students/enrolment.service';
import { OrgStructureService } from '../../src/org/org-structure.service';
import { CardPoster } from '../../src/supervision/card-poster';
import { TaskService } from '../../src/tasks/task.service';
import { buildGraph, seed, truncate, Scenario } from './harness';

jest.setTimeout(120_000);

const g = buildGraph();
const audit = new PrismaAuditService();
const tasks = new TaskService(g.prisma, g.outbox);
const lessons = new LessonService(g.prisma, g.authz, g.conversations, g.outbox, g.config, audit);
const scheduling = new SchedulingService(g.prisma, g.authz, g.conversations, lessons, g.outbox, g.config, g.reminders, audit);
const groups = new TrialGroupService(g.prisma, g.authz, g.conversations, g.outbox, new CardPoster(g.conversations, g.outbox, audit), g.config, audit);
const trials = new TrialService(g.prisma, g.conversations, lessons, scheduling, audit, groups, new NewStudentsService(g.prisma));
const enrolment = new NewStudentEnrolmentService(
  g.prisma, g.authz, g.conversations, new NewStudentsService(g.prisma), lessons, scheduling,
  new OrgStructureService(g.prisma, g.authz, g.conversations, audit), audit,
);
const recorder = { toThread: async () => undefined, toThreadAudience: async () => undefined, toUsers: async () => undefined };
const worker = new OutboxWorker(g.prisma, g.notifications, recorder as never, g.identity, g.pipeline);

const MIN = 60_000;
const SOURCES = ['family_unsupervised', 'teacher_setup', 'new_student_assign', 'new_student_group'];

let s: Scenario;
let sa: string;
let tmgr: string;
let tsup: string;
let salesId: string;
let trialsMade = 0;

const exec = (sql: string, ...args: unknown[]) => g.prisma.$executeRawUnsafe(sql, ...args);
const taskFor = async (key: string) =>
  (await g.prisma.$queryRaw<Array<{ id: string }>>`SELECT id::text AS id FROM chat.work_task WHERE source_key = ${key}`)[0]?.id;
/** The completion event, read as the super admin (who sees every task). */
const completion = async (id: string) => (await tasks.get(sa, id)).history.find((e) => e.kind === 'completed');
const missing = async (teacherId: string) =>
  (await g.prisma.$queryRaw<Array<{ n: number }>>`SELECT chat.work_task_setup_missing(${teacherId}::uuid) AS n`)[0]!.n;
/** The task_assigned pushes for one task: one per recipient, ever. */
const pushes = (taskId: string) =>
  g.prisma.notification.findMany({ where: { templateKey: 'task_assigned', dedupeKey: { startsWith: `task_assigned:${taskId}:` } } });

/** A trial an hour or more ago, for which Sales recorded "subscribed" with a form (as PD-16's spec). */
async function subscribedTrial(): Promise<string> {
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
  await trials.outcome(salesId, lesson.id, { result: 'subscribed', subscription: form() });
  return lesson.id;
}

function form() {
  return {
    parent: { name: 'parent_t', email: `parent.${randomUUID().slice(0, 8)}@example.test`, phone: '+99 000 555 666' },
    children: [
      { name: 'child_t1', age: 9, course: 'course_t', teacherId: s.teacherId, packagePrice: 1000, lessonPrice: 125,
        schedule: [{ weekday: 2, time: '17:00' }] },
    ],
    payment: { currency: 'EGP', method: 'invoice' },
  };
}

/** A child the Operations manager enrols into family_x, placed on nobody yet. */
async function waitingChild(): Promise<string> {
  const [{ id }] = await g.prisma.$queryRawUnsafe<Array<{ id: string }>>(
    `select chat.enrol_learner($1::uuid, 'child_w', $2::uuid, $3::uuid)::text as id`, s.familyId, s.teacherId, s.managerId,
  );
  return id;
}

/** A teacher added now, with a live account (signed in), and nothing else of their set-up. */
async function newTeacher(): Promise<string> {
  const [account, id] = [randomUUID(), randomUUID()];
  await exec(
    `insert into chat.account (id, organization_id, subject, kind, status, is_active)
     values ($1::uuid, chat.default_organization_id(), $2, 'teacher', 'active', true)`, account, `teacher-${account.slice(0, 8)}`,
  );
  await exec(`insert into chat.teacher (id, name, is_active, account_id) values ($1::uuid, 'teacher_s', true, $2::uuid)`, id, account);
  return id;
}

/** Every item of PD-43's set-up, written by the Teachers manager (an hourly teacher: no availability needed). */
async function finishSetup(teacherId: string) {
  const org = `chat.default_organization_id()`;
  await exec(`insert into chat.teacher_supervisor_assignment (teacher_id, organization_id, supervisor_id) values ($1::uuid, ${org}, $2::uuid)`, teacherId, tsup);
  await exec(`insert into chat.teacher_file (teacher_id, organization_id, phone, updated_by) values ($1::uuid, ${org}, '+20 100 000 0001', $2::uuid)`, teacherId, tmgr);
  await exec(
    `insert into chat.teacher_pay_terms (organization_id, teacher_id, effective_month, salary_type, currency, hourly_rate, reason, created_by)
     values (${org}, $1::uuid, date_trunc('month', chat.academy_today())::date, 'hourly', 'EGP', 100, 'PD-47 test', $2::uuid)`, teacherId, tmgr,
  );
  await exec(
    `insert into chat.teacher_payout_account (teacher_id, organization_id, method, details_sealed, key_id, last4, updated_by)
     values ($1::uuid, ${org}, 'instapay', decode(repeat('ab', 40), 'hex'), 'k1', '1234', $2::uuid)`, teacherId, tmgr,
  );
  await exec(
    `insert into chat.teacher_leave_allowance (organization_id, teacher_id, leave_year, days, set_by)
     values (${org}, $1::uuid, extract(year from chat.academy_today())::int, 21, $2::uuid)`, teacherId, tmgr,
  );
  await exec(
    `insert into chat.teacher_work_pattern (organization_id, teacher_id, category, timezone, valid_from, created_by)
     values (${org}, $1::uuid, 'hourly', 'Africa/Cairo', chat.academy_today(), $2::uuid)`, teacherId, tmgr,
  );
  await exec(`insert into chat.teacher_professional_profile (teacher_id) values ($1::uuid)`, teacherId);
}

/** The settle window as this suite found it (restored after): 0 here, so a sweep sees what a test just wrote. */
let windowBefore: unknown;
const settleWindow = (seconds: number) =>
  exec(`insert into chat.config (key, value) values ('tasks.raise_after_seconds', to_jsonb($1::int))
        on conflict (key) do update set value = excluded.value`, seconds);
/** Runs fn while every change to a task is refused: a trigger's settle fails as a guard rejection would. */
async function refusingTaskChanges(fn: () => Promise<unknown>) {
  await exec(`alter table chat.work_task add constraint pd047_spec_refuses_changes check (revision < 0) not valid`);
  try {
    await fn();
  } finally {
    await exec(`alter table chat.work_task drop constraint pd047_spec_refuses_changes`);
  }
}
const issueFor = async (key: string) =>
  (await g.prisma.$queryRaw<Array<{ reason: string }>>`SELECT reason FROM chat.work_task_source_issue WHERE source_key = ${key}`)[0]?.reason;
const sourceStateOf = async (id: string) =>
  (await g.prisma.$queryRaw<Array<{ state: string; source_state: string }>>`
    SELECT state, source_state FROM chat.work_task WHERE id = ${id}::uuid`)[0];

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
  // seed(): Operations is run by s.managerId; s.ownerId supervises family_x's children.
  s = await seed(g.prisma);
  g.coverage.onDutyId = s.ownerId;
  [sa, tmgr, tsup, salesId] = [randomUUID(), randomUUID(), randomUUID(), randomUUID()];
  await g.prisma.$transaction([
    exec(`select set_config('chat.provisioning_super_admin', 'on', true)`),
    exec(`insert into chat.staff (id, name, role, is_active) values ($1::uuid, 'sa_s', 'super_admin', true)`, sa),
  ]);
  await exec(
    `insert into chat.staff (id, name, role, is_active) values ($1::uuid, 'tmgr_s', 'manager', true), ($2::uuid, 'tsup_s', 'admin', true),
       ($3::uuid, 'sales_s', 'admin', true)`, tmgr, tsup, salesId,
  );
  const [{ id: tdept }] = await g.prisma.$queryRawUnsafe<Array<{ id: string }>>(
    `insert into chat.department (kind, display_name, manager_id) values ('teachers', 'teachers', $1::uuid) returning id::text as id`, tmgr,
  );
  const [{ id: sdept }] = await g.prisma.$queryRawUnsafe<Array<{ id: string }>>(
    `insert into chat.department (kind, display_name) values ('sales', 'sales') returning id::text as id`,
  );
  for (const [staffId, dept] of [[tsup, tdept], [salesId, sdept]]) {
    await exec(
      `insert into chat.department_member (staff_id, organization_id, department_id, position)
       values ($1::uuid, chat.default_organization_id(), $2::uuid, 'supervisor')`, staffId, dept,
    );
  }
  for (const src of SOURCES) {
    await exec(`insert into chat.config (key, value) values ($1, to_jsonb('2000-01-01T00:00:00Z'::text))
                on conflict (key) do update set value = excluded.value`, `tasks.since.${src}`);
  }
  await settleWindow(0);
});

// ---------------------------------------------------------------------------

describe('a family waiting for its Operations supervisor', () => {
  it('is the Operations manager\'s task; placing the child completes it at once, by them', async () => {
    const child = await waitingChild();
    await tasks.sweep();
    const id = (await taskFor(`family_unsupervised:${s.familyId}`)) as string;
    expect(await tasks.get(s.managerId, id)).toMatchObject({
      assignee: { kind: 'staff', id: s.managerId },
      category: 'operational',
      source: { type: 'family_unsupervised', id: s.familyId },
      titleParams: { familyName: 'family_x', familyId: s.familyId, count: 1 },
    });
    await exec(
      `insert into chat.learner_supervision (learner_id, organization_id, supervisor_id, assigned_by)
       values ($1::uuid, chat.default_organization_id(), $2::uuid, $3::uuid)`, child, s.ownerId, s.managerId,
    );
    expect(await tasks.get(s.managerId, id)).toMatchObject({ state: 'completed', outcome: 'done' });
    expect((await completion(id))?.actor).toMatchObject({ kind: 'staff', id: s.managerId });
  });

  it('an academy import places the child naming nobody: the system completes it', async () => {
    const child = await waitingChild();
    await tasks.sweep();
    const id = (await taskFor(`family_unsupervised:${s.familyId}`)) as string;
    await g.prisma.$transaction([
      exec(`select set_config('chat.syncing_supervision', 'on', true)`),
      exec(`select set_config('chat.syncing_supervision_source', 'PD-47 spec import', true)`),
      exec(
        `insert into chat.learner_supervision (learner_id, organization_id, supervisor_id, assigned_by)
         values ($1::uuid, chat.default_organization_id(), $2::uuid, null)`, child, s.ownerId,
      ),
    ]);
    expect(await tasks.get(s.managerId, id)).toMatchObject({ state: 'completed', outcome: 'done' });
    expect((await completion(id))?.actor ?? null).toBeNull();
  });

  it('a placement stands even when its task cannot be settled; the sweep settles it after', async () => {
    const child = await waitingChild();
    await tasks.sweep();
    const key = `family_unsupervised:${s.familyId}`;
    const id = (await taskFor(key)) as string;
    await refusingTaskChanges(() => exec(
      `insert into chat.learner_supervision (learner_id, organization_id, supervisor_id, assigned_by)
       values ($1::uuid, chat.default_organization_id(), $2::uuid, $3::uuid)`, child, s.ownerId, s.managerId,
    ));
    expect(await g.prisma.learnerSupervision.findUnique({ where: { learnerId: child } })).toMatchObject({ supervisorId: s.ownerId });
    expect(await sourceStateOf(id)).toEqual({ state: 'open', source_state: 'pending' });
    expect(await issueFor(key)).toEqual(expect.any(String));
    await exec(`delete from chat.work_task_source_issue where source_key = $1`, key);
    await tasks.sweep();
    expect(await tasks.get(s.managerId, id)).toMatchObject({ state: 'completed', outcome: 'done' });
  });

  it('a family entered with its supervisor in one go raises nothing', async () => {
    await enrolment.assign(s.managerId, await subscribedTrial(), { supervisorId: s.ownerId });
    await tasks.sweep();
    const [{ n }] = await g.prisma.$queryRaw<Array<{ n: bigint }>>`
      SELECT count(*) AS n FROM chat.work_task WHERE source_type = 'family_unsupervised'`;
    expect(Number(n)).toBe(0);
  });

  it('a child from before the cut-off stays on the page only', async () => {
    await waitingChild();
    await exec(`update chat.config set value = to_jsonb((now() + interval '1 minute')::text) where key = 'tasks.since.family_unsupervised'`);
    await tasks.sweep();
    expect(await taskFor(`family_unsupervised:${s.familyId}`)).toBeUndefined();
  });
});

describe('a teacher still being set up', () => {
  it('is their owner\'s one task, the checklist inside; done when every item is, by nobody in particular', async () => {
    const t = await newTeacher();
    await tasks.sweep();
    const id = (await taskFor(`teacher_setup:${t}`)) as string;
    // No supervisor yet: the Teachers manager's (PD-43).
    expect(await tasks.get(tmgr, id)).toMatchObject({
      assignee: { kind: 'staff', id: tmgr },
      source: { type: 'teacher_setup', id: t },
      titleParams: { teacherName: 'teacher_s', teacherId: t, count: await missing(t) },
    });
    await finishSetup(t);
    expect(await missing(t)).toBe(0);
    await tasks.sweep();
    expect(await tasks.get(tmgr, id)).toMatchObject({ state: 'completed', outcome: 'done' });
    expect((await completion(id))?.actor).toBeNull();
    // Finished, it is never raised again.
    await tasks.sweep();
    const [{ n }] = await g.prisma.$queryRaw<Array<{ n: bigint }>>`SELECT count(*) AS n FROM chat.work_task WHERE source_key = ${`teacher_setup:${t}`}`;
    expect(Number(n)).toBe(1);
  });

  it('a teacher who leaves takes the work with them: withdrawn, and acknowledged', async () => {
    const t = await newTeacher();
    await tasks.sweep();
    const id = (await taskFor(`teacher_setup:${t}`)) as string;
    await exec(`update chat.teacher set is_active = false, left_at = now() where id = $1::uuid`, t);
    await tasks.sweep();
    expect(await tasks.get(tmgr, id)).toMatchObject({ state: 'open', sourceState: 'withdrawn' });
    await tasks.acknowledge(tmgr, id);
    expect(await tasks.get(tmgr, id)).toMatchObject({ state: 'completed', outcome: 'acknowledged' });
  });

  it('a teacher reactivated with the set-up unfinished is owed again, while the withdrawn task is open', async () => {
    const t = await newTeacher();
    await tasks.sweep();
    const id = (await taskFor(`teacher_setup:${t}`)) as string;
    await exec(`update chat.teacher set is_active = false, left_at = now() where id = $1::uuid`, t);
    await tasks.sweep();
    expect(await tasks.get(tmgr, id)).toMatchObject({ state: 'open', sourceState: 'withdrawn' });
    await exec(`update chat.teacher set is_active = true, left_at = null where id = $1::uuid`, t);
    await tasks.sweep();
    expect(await tasks.get(tmgr, id)).toMatchObject({ state: 'open', sourceState: 'pending' });
  });

  it('an owner who leaves: orphaned while nobody live follows, then moved to the new owner', async () => {
    const t = await newTeacher();
    await tasks.sweep();
    const key = `teacher_setup:${t}`;
    const id = (await taskFor(key)) as string;
    await exec(`update chat.department set manager_id = null where kind = 'teachers'`);
    await exec(`update chat.staff set is_active = false, left_at = now() where id = $1::uuid`, tmgr);
    await tasks.sweep();
    expect(await issueFor(key)).toMatch(/^orphaned:/);

    const tmgr2 = randomUUID();
    await exec(`insert into chat.staff (id, name, role, is_active) values ($1::uuid, 'tmgr2_s', 'manager', true)`, tmgr2);
    await exec(`update chat.department set manager_id = $1::uuid where kind = 'teachers'`, tmgr2);
    await tasks.sweep();
    expect(await tasks.get(tmgr2, id)).toMatchObject({ state: 'open', assignee: { kind: 'staff', id: tmgr2 } });
    expect(await issueFor(key)).toBeUndefined();
  });
});

describe('a new family from a trial', () => {
  it('the form is the Operations manager\'s to assign: done by the assignment, by them', async () => {
    const trial = await subscribedTrial();
    await tasks.sweep();
    const id = (await taskFor(`new_student_assign:${trial}`)) as string;
    const task = await tasks.get(s.managerId, id);
    expect(task).toMatchObject({ assignee: { kind: 'staff', id: s.managerId }, source: { type: 'new_student_assign', id: trial } });
    expect(task.titleParams).toEqual({ prospectName: expect.stringMatching(/^prospect_/), startsAt: expect.any(String) });
    // The form's contents never reach the task (G-07).
    expect(JSON.stringify(task)).not.toMatch(/parent_t|555 666|child_t1/);
    await enrolment.assign(s.managerId, trial, { supervisorId: s.ownerId });
    expect(await tasks.get(s.managerId, id)).toMatchObject({ state: 'completed', outcome: 'done' });
    expect((await completion(id))?.actor).toMatchObject({ kind: 'staff', id: s.managerId });
  });

  it('an assignment and a correction stand even when their task cannot be moved', async () => {
    const trial = await subscribedTrial();
    const other = await subscribedTrial();
    await tasks.sweep();
    const [assignId, otherId] = [(await taskFor(`new_student_assign:${trial}`)) as string, (await taskFor(`new_student_assign:${other}`)) as string];
    await refusingTaskChanges(async () => {
      await enrolment.assign(s.managerId, trial, { supervisorId: s.ownerId });
      await trials.correct(salesId, other, { result: 'not_subscribed', reason: 'chose_other', why: 'the family cancelled' });
    });
    expect(await g.prisma.studentEnrolment.findFirst({ where: { lessonId: trial } })).not.toBeNull();
    expect(await sourceStateOf(assignId)).toEqual({ state: 'open', source_state: 'pending' });
    expect(await sourceStateOf(otherId)).toEqual({ state: 'open', source_state: 'pending' });
    expect(await issueFor(`new_student_assign:${trial}`)).toEqual(expect.any(String));
    expect(await issueFor(`new_student_assign:${other}`)).toEqual(expect.any(String));
    await exec(`delete from chat.work_task_source_issue where source_key like 'new_student_assign:%'`);
    await tasks.sweep();
    expect(await sourceStateOf(assignId)).toMatchObject({ state: 'completed' });
    expect(await sourceStateOf(otherId)).toEqual({ state: 'open', source_state: 'withdrawn' });
  });

  it('a group opened while its task cannot be settled still opens', async () => {
    const trial = await subscribedTrial();
    await enrolment.assign(s.managerId, trial, { supervisorId: s.ownerId });
    await tasks.sweep();
    const [{ id: enrolmentId }] = await g.prisma.$queryRaw<Array<{ id: string }>>`
      SELECT id::text AS id FROM chat.student_enrolment WHERE lesson_id = ${trial}::uuid`;
    const id = (await taskFor(`new_student_group:${enrolmentId}`)) as string;
    await refusingTaskChanges(() => enrolment.createGroup(s.ownerId, trial));
    expect((await g.prisma.studentEnrolment.findUniqueOrThrow({ where: { id: enrolmentId } })).groupConversationId).not.toBeNull();
    expect(await sourceStateOf(id)).toEqual({ state: 'open', source_state: 'pending' });
    await exec(`delete from chat.work_task_source_issue where source_key = $1`, `new_student_group:${enrolmentId}`);
    await tasks.sweep();
    expect(await sourceStateOf(id)).toMatchObject({ state: 'completed' });
  });

  it('children added to an existing family raise no group task: only a new family opens one', async () => {
    const first = await subscribedTrial();
    await enrolment.assign(s.managerId, first, { supervisorId: s.ownerId });
    const [{ family }] = await g.prisma.$queryRaw<Array<{ family: string }>>`
      SELECT family_id::text AS family FROM chat.student_enrolment WHERE lesson_id = ${first}::uuid`;
    const second = await subscribedTrial();
    await enrolment.assign(s.managerId, second, { familyId: family });
    const rows = await g.prisma.$queryRaw<Array<{ id: string; kind: string }>>`
      SELECT id::text AS id, kind FROM chat.student_enrolment WHERE lesson_id IN (${first}::uuid, ${second}::uuid) ORDER BY kind`;
    expect(rows.map((r) => r.kind)).toEqual(['added_children', 'new_family']);
    await tasks.sweep();
    expect(await taskFor(`new_student_group:${rows[0]!.id}`)).toBeUndefined();
    expect(await taskFor(`new_student_group:${rows[1]!.id}`)).toEqual(expect.any(String));
  });

  it('a form corrected away is withdrawn; corrected back, it is owed again', async () => {
    const trial = await subscribedTrial();
    await tasks.sweep();
    const id = (await taskFor(`new_student_assign:${trial}`)) as string;
    await trials.correct(salesId, trial, { result: 'not_subscribed', reason: 'chose_other', why: 'the family cancelled' });
    expect(await tasks.get(s.managerId, id)).toMatchObject({ state: 'open', sourceState: 'withdrawn' });
    await trials.correct(salesId, trial, { result: 'subscribed', subscription: form(), why: 'they came back' });
    expect(await tasks.get(s.managerId, id)).toMatchObject({ state: 'open', sourceState: 'pending' });
  });

  it('then the children\'s supervisor opens the family group: done at once, by them', async () => {
    const trial = await subscribedTrial();
    await enrolment.assign(s.managerId, trial, { supervisorId: s.ownerId });
    await tasks.sweep();
    const [{ id: enrolmentId, family }] = await g.prisma.$queryRaw<Array<{ id: string; family: string }>>`
      SELECT id::text AS id, family_id::text AS family FROM chat.student_enrolment WHERE lesson_id = ${trial}::uuid`;
    const id = (await taskFor(`new_student_group:${enrolmentId}`)) as string;
    expect(await tasks.get(s.ownerId, id)).toMatchObject({
      assignee: { kind: 'staff', id: s.ownerId },
      source: { type: 'new_student_group', id: enrolmentId },
      titleParams: { familyId: family },
    });
    await enrolment.createGroup(s.ownerId, trial);
    expect(await tasks.get(s.ownerId, id)).toMatchObject({ state: 'completed', outcome: 'done' });
    expect((await completion(id))?.actor).toMatchObject({ kind: 'staff', id: s.ownerId });
  });
});

describe('the sweep', () => {
  it('leaves an occurrence alone for the settle window, then raises it', async () => {
    await settleWindow(120);
    const t = await newTeacher();
    await tasks.sweep();
    expect(await taskFor(`teacher_setup:${t}`)).toBeUndefined();
    await settleWindow(1);
    await new Promise((r) => setTimeout(r, 1500));
    await tasks.sweep();
    expect(await taskFor(`teacher_setup:${t}`)).toEqual(expect.any(String));
  });

  it('two at once raise each task once, and announce it once', async () => {
    await waitingChild();
    const t = await newTeacher();
    const trial = await subscribedTrial();
    await Promise.all([tasks.sweep(), tasks.sweep()]);
    await tasks.sweep();
    await worker.drain(500);
    for (const key of [`family_unsupervised:${s.familyId}`, `teacher_setup:${t}`, `new_student_assign:${trial}`]) {
      const [{ n }] = await g.prisma.$queryRaw<Array<{ n: bigint }>>`SELECT count(*) AS n FROM chat.work_task WHERE source_key = ${key}`;
      expect({ key, n: Number(n) }).toEqual({ key, n: 1 });
      expect({ key, pushes: (await pushes((await taskFor(key)) as string)).length }).toEqual({ key, pushes: 1 });
    }
  });
});

describe('each source is announced once', () => {
  it('one task_assigned push per source, to its assignee, with no variables -- however often the sweep runs', async () => {
    await waitingChild();
    const teacher = await newTeacher();
    const unassigned = await subscribedTrial();
    const assigned = await subscribedTrial();
    await enrolment.assign(s.managerId, assigned, { supervisorId: s.ownerId });
    await tasks.sweep();
    await worker.drain(500);
    await tasks.sweep();
    await worker.drain(500);

    const [{ id: enrolmentId }] = await g.prisma.$queryRaw<Array<{ id: string }>>`
      SELECT id::text AS id FROM chat.student_enrolment WHERE lesson_id = ${assigned}::uuid`;
    const expected: Array<[string, string]> = [
      [`family_unsupervised:${s.familyId}`, s.managerId],
      [`teacher_setup:${teacher}`, tmgr],
      [`new_student_assign:${unassigned}`, s.managerId],
      [`new_student_group:${enrolmentId}`, s.ownerId],
    ];
    for (const [key, to] of expected) {
      const id = (await taskFor(key)) as string;
      expect({ key, id: !!id }).toEqual({ key, id: true });
      const sent = await pushes(id);
      expect({ key, recipients: sent.map((p) => p.recipientId) }).toEqual({ key, recipients: [to] });
      for (const p of sent) expect(p.variables ?? {}).toEqual({});
    }
    // A form assigned before the sweep saw it, and the family it made with its
    // supervisor: no task, so nothing announced.
    expect(await taskFor(`new_student_assign:${assigned}`)).toBeUndefined();
  });
});
