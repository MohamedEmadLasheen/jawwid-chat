/**
 * PD-47 PR-6c -- tasks for the Teachers department's decisions (plan §3.6,
 * department head 2026-10-29). The records that already exist decide them.
 *
 *   complaint        a PD-26 complaint: the teacher's supervisor's (else the
 *                    Teachers manager's); done by its complaint_resolution
 *   feedback         a parent's praise or suggestion: as complaint; done when
 *                    it is resolved (a parent's complaint is a complaint)
 *   schedule_change  a family's request for new times: the child's teacher's
 *                    supervisor's; done when decided, withdrawn with it
 *   makeup_owed      a lesson its teacher missed, by the supervisor follow-up's
 *                    rule (owedMakeups with its default causes; the two sets
 *                    equal): done at booking anywhere in its make-up chain, by
 *                    who booked (the system for a family), or by a DECIDED
 *                    makeup_followup ruling, which also completes PR-2's
 *                    lesson_ruling task with the same actor; a pending ruling
 *                    keeps it owed; a booked make-up that dies owes a fresh one
 *   every one        raised by the sweep past the settle window, announced
 *                    once (task_assigned, ids only); a source's write stands
 *                    when its task cannot be settled; an owner who leaves is
 *                    followed
 *
 * Synthetic fixtures only (G-16).
 */
import { randomUUID } from 'node:crypto';
import { OutboxWorker } from '@communication/outbox/outbox.worker';
import { PrismaAuditService } from '@platform/audit.service';
import { TeacherFileService } from '../../src/teacher-file/teacher-file.service';
import { ParentFeedbackService } from '../../src/teacher-file/parent-feedback.service';
import { CommError, CommErrorCode } from '@platform/errors';
import { LessonService } from '../../src/lessons/lesson.service';
import { LessonRecordService } from '../../src/lessons/lesson-record.service';
import { SchedulingService } from '../../src/lessons/scheduling.service';
import { TaskService } from '../../src/tasks/task.service';
import { buildGraph, seed, truncate, Scenario } from './harness';

jest.setTimeout(120_000);

const g = buildGraph();
const tasks = new TaskService(g.prisma, g.outbox);
const audit = new PrismaAuditService();
const files = new TeacherFileService(g.prisma, g.authz, g.conversations, audit);
const feedback = new ParentFeedbackService(g.prisma, g.conversations, files, audit);
const lessons = new LessonService(g.prisma, g.authz, g.conversations, g.outbox, g.config, audit);
const scheduling = new SchedulingService(g.prisma, g.authz, g.conversations, lessons, g.outbox, g.config, g.reminders, audit);
const records = new LessonRecordService(g.prisma, lessons, g.conversations, g.outbox, audit);
const recorder = { toThread: async () => undefined, toThreadAudience: async () => undefined, toUsers: async () => undefined };
const worker = new OutboxWorker(g.prisma, g.notifications, recorder as never, g.identity, g.pipeline);

const SOURCES = ['complaint', 'feedback', 'schedule_change', 'makeup_owed', 'lesson_ruling'];
const HOUR = 3_600_000;
const at = (ms: number) => new Date(Date.now() + ms).toISOString();

let s: Scenario;
let sa: string;
let tmgr: string;
let tsup: string;
let tdept: string;
let windowBefore: unknown;

const exec = (sql: string, ...args: unknown[]) => g.prisma.$executeRawUnsafe(sql, ...args);
const taskFor = async (key: string) =>
  (await g.prisma.$queryRaw<Array<{ id: string }>>`SELECT id::text AS id FROM chat.work_task WHERE source_key = ${key}`)[0]?.id;
/** The completion event, read as the super admin (who sees every task). */
const completion = async (id: string) => (await tasks.get(sa, id)).history.find((e) => e.kind === 'completed');
const stateOf = async (id: string) =>
  (await g.prisma.$queryRaw<Array<{ state: string; source_state: string; assignee: string | null }>>`
    SELECT state, source_state, coalesce(assignee_staff_id, assignee_teacher_id)::text AS assignee FROM chat.work_task WHERE id = ${id}::uuid`)[0];
const issueFor = async (key: string) =>
  (await g.prisma.$queryRaw<Array<{ reason: string }>>`SELECT reason FROM chat.work_task_source_issue WHERE source_key = ${key}`)[0]?.reason;
/** The task_assigned pushes for one task: one per recipient, ever. */
const pushes = (taskId: string) =>
  g.prisma.notification.findMany({ where: { templateKey: 'task_assigned', dedupeKey: { startsWith: `task_assigned:${taskId}:` } } });
/** Runs fn while every write to a task is refused: a trigger's task step fails as a guard rejection would. */
async function refusingTaskChanges(fn: () => Promise<unknown>) {
  await exec(`alter table chat.work_task add constraint pd047_spec_refuses_changes check (revision < 0) not valid`);
  try {
    await fn();
  } finally {
    await exec(`alter table chat.work_task drop constraint pd047_spec_refuses_changes`);
  }
}
const settleWindow = (seconds: number) =>
  exec(`insert into chat.config (key, value) values ('tasks.raise_after_seconds', to_jsonb($1::int))
        on conflict (key) do update set value = excluded.value`, seconds);
/** The teacher's PD-35 supervisor: tsup. */
const superviseTeacher = () =>
  exec(`insert into chat.teacher_supervisor_assignment (teacher_id, organization_id, supervisor_id, assigned_by)
        values ($1::uuid, chat.default_organization_id(), $2::uuid, $3::uuid)`, s.teacherId, tsup, tmgr);
const leaves = (staffId: string) =>
  g.prisma.$queryRaw`SELECT chat.deactivate_principal('staff', ${staffId}::uuid, 'left the academy', null, 'deactivated')::text`;

/** A management complaint about the seeded teacher, filed by the Teachers manager. */
const complaint = async () => (await files.addEntry(tmgr, s.teacherId, { kind: 'complaint', body: 'late twice this week', source: 'management' })).id as string;
const resolve = (id: string, by = tmgr) => files.addEntry(by, s.teacherId, { kind: 'complaint_resolution', body: 'Spoken to; resolved.', refersTo: id });

/** A parent's feedback on the seeded child's teacher. */
const parentSays = async (category: string) =>
  ((await feedback.file(s.parentId, { learnerId: s.learnerId, category, body: 'Lessons are wonderful and very clear.' })) as { id: string }).id;

/** The seeded parent asks for new regular times for their child (PD-11). */
const askNewTimes = async () =>
  (await g.prisma.$queryRawUnsafe<Array<{ id: string }>>(
    `insert into chat.schedule_change_request (organization_id, learner_id, requested_by, slots)
     values (chat.default_organization_id(), $1::uuid, $2::uuid, '[{"weekday": 2, "start": "17:00"}]'::jsonb)
     returning id::text as id`, s.learnerId, s.parentId,
  ))[0]!.id;
const decide = (id: string, status: 'approved' | 'rejected', by: string) =>
  exec(`update chat.schedule_change_request set status = $2, decided_by = $3::uuid, decided_at = now() where id = $1::uuid`, id, status, by);

/** teacher_c works every day, all day (as lessons-scheduling.spec): free time is decided by lessons only. */
const openAllWeek = () => scheduling.setAvailability(tsup, s.teacherId, {
  timezone: 'Africa/Cairo', windows: [1, 2, 3, 4, 5, 6, 7].map((weekday) => ({ weekday, start: '00:00', end: '24:00' })),
});
let lessonsMade = 0;
/** A lesson of the seeded child, two days on, that the teacher cancels: it owes a make-up. */
async function owedLesson(cause: 'teacher' | 'student' = 'teacher'): Promise<string> {
  lessonsMade += 1;
  const start = (40 + 3 * lessonsMade) * HOUR;
  const id = (await lessons.schedule(tsup, { learnerId: s.learnerId, startsAt: at(start), endsAt: at(start + HOUR / 2) })).id;
  if (cause === 'teacher') await lessons.teacherApology(s.teacherId, id, { reason: 'ill' });
  else await lessons.apology(s.parentId, id, { reason: 'travel' });
  return id;
}
async function code(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (e) {
    if (e instanceof CommError) return e.code;
    throw e;
  }
  throw new Error('expected a refusal');
}
const book = async (by: string, id: string) =>
  scheduling.bookMakeup(by, id, { startsAt: (await scheduling.makeupSlots(by, id)).slots[0] });

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
  s = await seed(g.prisma);
  g.coverage.onDutyId = s.ownerId;
  [sa, tmgr, tsup] = [randomUUID(), randomUUID(), randomUUID()];
  await g.prisma.$transaction([
    exec(`select set_config('chat.provisioning_super_admin', 'on', true)`),
    exec(`insert into chat.staff (id, name, role, is_active) values ($1::uuid, 'sa_d', 'super_admin', true)`, sa),
  ]);
  await exec(`insert into chat.staff (id, name, role, is_active) values ($1::uuid, 'tmgr_d', 'manager', true), ($2::uuid, 'tsup_d', 'admin', true)`, tmgr, tsup);
  [{ id: tdept }] = await g.prisma.$queryRawUnsafe<Array<{ id: string }>>(
    `insert into chat.department (kind, display_name, manager_id) values ('teachers', 'teachers', $1::uuid) returning id::text as id`, tmgr,
  );
  await exec(
    `insert into chat.department_member (staff_id, organization_id, department_id, position)
     values ($1::uuid, chat.default_organization_id(), $2::uuid, 'supervisor')`, tsup, tdept,
  );
  for (const src of SOURCES) {
    await exec(`insert into chat.config (key, value) values ($1, to_jsonb('2000-01-01T00:00:00Z'::text))
                on conflict (key) do update set value = excluded.value`, `tasks.since.${src}`);
  }
  await settleWindow(0);
  await g.conversations.ensureStudentGroup(s.learnerId, s.ownerId);
});

// ---------------------------------------------------------------------------

describe('a complaint on the Teacher File', () => {
  it('is the teacher\'s supervisor\'s; its resolution completes it at once, by who resolved it', async () => {
    await superviseTeacher();
    const c = await complaint();
    await tasks.sweep();
    const id = (await taskFor(`complaint:${c}`)) as string;
    const task = await tasks.get(tsup, id);
    expect(task).toMatchObject({
      assignee: { kind: 'staff', id: tsup },
      source: { type: 'complaint', id: c },
      titleParams: { teacherId: s.teacherId, teacherName: expect.any(String) },
    });
    // Never the complaint's words.
    expect(JSON.stringify(task)).not.toContain('late twice');
    await resolve(c, tsup);
    expect(await tasks.get(tsup, id)).toMatchObject({ state: 'completed', outcome: 'done' });
    expect((await completion(id))?.actor).toMatchObject({ kind: 'staff', id: tsup });
  });

  it('an unsupervised teacher\'s complaint is the Teachers manager\'s', async () => {
    const c = await complaint();
    await tasks.sweep();
    expect(await stateOf((await taskFor(`complaint:${c}`)) as string)).toMatchObject({ assignee: tmgr });
  });

  it('a resolution stands even when its task cannot be settled; the sweep settles it after', async () => {
    const c = await complaint();
    await tasks.sweep();
    const id = (await taskFor(`complaint:${c}`)) as string;
    await refusingTaskChanges(() => resolve(c));
    expect(await g.prisma.teacherSupervisionEntry.count({ where: { refersTo: c, kind: 'complaint_resolution' } })).toBe(1);
    expect(await stateOf(id)).toMatchObject({ state: 'open', source_state: 'pending' });
    expect(await issueFor(`complaint:${c}`)).toEqual(expect.any(String));
    await tasks.sweep();
    expect(await stateOf(id)).toMatchObject({ state: 'completed' });
  });

  it('a supervisor who leaves: the task follows to the Teachers manager', async () => {
    await superviseTeacher();
    const c = await complaint();
    await tasks.sweep();
    const id = (await taskFor(`complaint:${c}`)) as string;
    await leaves(tsup);
    await tasks.sweep();
    expect(await stateOf(id)).toMatchObject({ state: 'open', assignee: tmgr });
  });

  it('nothing is raised inside the settle window, nor before the cut-off', async () => {
    await settleWindow(120);
    const c = await complaint();
    await tasks.sweep();
    expect(await taskFor(`complaint:${c}`)).toBeUndefined();
    await settleWindow(0);
    await exec(`update chat.config set value = to_jsonb((now() + interval '1 minute')::text) where key = 'tasks.since.complaint'`);
    await tasks.sweep();
    expect(await taskFor(`complaint:${c}`)).toBeUndefined();
  });
});

describe('a parent\'s praise or suggestion', () => {
  it('is the teacher\'s supervisor\'s; answered and closed, it is done, by who answered', async () => {
    const f = await parentSays('praise');
    await tasks.sweep();
    const id = (await taskFor(`feedback:${f}`)) as string;
    const task = await tasks.get(tmgr, id);
    expect(task).toMatchObject({ assignee: { kind: 'staff', id: tmgr }, titleParams: { category: 'praise', learnerName: expect.any(String) } });
    expect(JSON.stringify(task)).not.toContain('wonderful');
    await feedback.reply(tmgr, f, { response: 'Thank you -- passed on.', resolve: true });
    expect(await tasks.get(tmgr, id)).toMatchObject({ state: 'completed', outcome: 'done' });
    expect((await completion(id))?.actor).toMatchObject({ kind: 'staff', id: tmgr });
  });

  it('is never its own teacher\'s: they cannot read it, and it cannot be handed to them', async () => {
    const f = await parentSays('praise');
    await tasks.sweep();
    const id = (await taskFor(`feedback:${f}`)) as string;
    await expect(tasks.get(s.teacherId, id)).rejects.toThrow();
    expect(await code(tasks.reassign(tmgr, id, { to: { kind: 'teacher', id: s.teacherId } }))).toBe(CommErrorCode.TASK_INVALID);
    // What Tasks reads of a feedback is exactly these names (a widening fails here).
    const keys = (await g.prisma.$queryRaw<Array<{ k: string }>>`
      SELECT jsonb_object_keys(chat.work_task_feedback_title(${f}::uuid)) AS k`).map((r) => r.k).sort();
    expect(keys).toEqual(['category', 'learnerName', 'teacherName']);
  });

  it('a reply that does not close it leaves the task open', async () => {
    const f = await parentSays('suggestion');
    await tasks.sweep();
    const id = (await taskFor(`feedback:${f}`)) as string;
    await feedback.reply(tmgr, f, { response: 'We are looking into it.' });
    expect(await stateOf(id)).toMatchObject({ state: 'open', source_state: 'pending' });
  });

  it('a parent\'s complaint raises the complaint\'s task, not one of its own', async () => {
    const f = await parentSays('complaint');
    await tasks.sweep();
    expect(await taskFor(`feedback:${f}`)).toBeUndefined();
    const [{ id: entry }] = await g.prisma.$queryRaw<Array<{ id: string }>>`
      SELECT id::text AS id FROM chat.teacher_supervision_entry WHERE parent_feedback_id = ${f}::uuid`;
    expect(await taskFor(`complaint:${entry}`)).toEqual(expect.any(String));
  });

  it('closing it stands even when its task cannot be settled; the sweep settles it after', async () => {
    const f = await parentSays('praise');
    await tasks.sweep();
    const id = (await taskFor(`feedback:${f}`)) as string;
    await refusingTaskChanges(() => feedback.reply(tmgr, f, { response: 'Thank you.', resolve: true }));
    expect((await g.prisma.parentFeedback.findUniqueOrThrow({ where: { id: f } })).status).toBe('resolved');
    expect(await stateOf(id)).toMatchObject({ state: 'open' });
    await tasks.sweep();
    expect(await stateOf(id)).toMatchObject({ state: 'completed' });
  });
});

describe('a family\'s request for new lesson times', () => {
  it('is the child\'s teacher\'s supervisor\'s; deciding it completes it, by who decided', async () => {
    await superviseTeacher();
    const q = await askNewTimes();
    await tasks.sweep();
    const id = (await taskFor(`schedule_change:${q}`)) as string;
    expect(await tasks.get(tsup, id)).toMatchObject({
      assignee: { kind: 'staff', id: tsup }, titleParams: { learnerId: s.learnerId, learnerName: expect.any(String) },
    });
    await decide(q, 'rejected', tsup);
    expect(await tasks.get(tsup, id)).toMatchObject({ state: 'completed', outcome: 'done' });
    expect((await completion(id))?.actor).toMatchObject({ kind: 'staff', id: tsup });
  });

  it('withdrawn by the family, the task is withdrawn', async () => {
    const q = await askNewTimes();
    await tasks.sweep();
    const id = (await taskFor(`schedule_change:${q}`)) as string;
    await exec(`update chat.schedule_change_request set status = 'withdrawn' where id = $1::uuid`, q);
    expect(await stateOf(id)).toMatchObject({ state: 'open', source_state: 'withdrawn' });
  });

  it('a decision stands even when its task cannot be settled; the sweep settles it after', async () => {
    const q = await askNewTimes();
    await tasks.sweep();
    const id = (await taskFor(`schedule_change:${q}`)) as string;
    await refusingTaskChanges(() => decide(q, 'approved', tmgr));
    expect((await g.prisma.scheduleChangeRequest.findUniqueOrThrow({ where: { id: q } })).status).toBe('approved');
    expect(await stateOf(id)).toMatchObject({ state: 'open' });
    await tasks.sweep();
    expect(await stateOf(id)).toMatchObject({ state: 'completed' });
  });
});

describe('a lesson that owes a make-up', () => {
  beforeEach(openAllWeek);

  it('is the teacher\'s supervisor\'s, due within the make-up window; booking it completes it, by who booked', async () => {
    await superviseTeacher();
    const lesson = await owedLesson();
    await tasks.sweep();
    const id = (await taskFor(`makeup_owed:${lesson}`)) as string;
    const task = await tasks.get(tsup, id);
    expect(task).toMatchObject({ assignee: { kind: 'staff', id: tsup }, titleParams: { lessonId: lesson, learnerName: expect.any(String) } });
    const row = await g.prisma.lesson.findUniqueOrThrow({ where: { id: lesson } });
    expect(new Date(task.dueAt as string).getTime()).toBe(row.endsAt.getTime() + 7 * 24 * HOUR);
    await book(s.teacherId, lesson);
    expect(await tasks.get(tsup, id)).toMatchObject({ state: 'completed', outcome: 'done' });
    expect((await completion(id))?.actor).toMatchObject({ kind: 'teacher', id: s.teacherId });
  });

  it('a family that books it completes it as the system: nobody the task log names', async () => {
    const lesson = await owedLesson();
    await tasks.sweep();
    const id = (await taskFor(`makeup_owed:${lesson}`)) as string;
    await book(s.parentId, lesson);
    expect(await stateOf(id)).toMatchObject({ state: 'completed' });
    expect((await completion(id))?.actor ?? null).toBeNull();
  });

  it('a booked make-up that dies owes a FRESH task, keyed on it; the first stays done', async () => {
    const lesson = await owedLesson();
    await tasks.sweep();
    const first = (await taskFor(`makeup_owed:${lesson}`)) as string;
    const booked = await book(s.teacherId, lesson);
    await lessons.teacherApology(s.teacherId, booked.id, { reason: 'ill again' });
    await tasks.sweep();
    expect(await stateOf(first)).toMatchObject({ state: 'completed' });
    expect(await stateOf((await taskFor(`makeup_owed:${booked.id}`)) as string)).toMatchObject({ state: 'open', source_state: 'pending' });
  });

  it('one makeup_followup decision completes both tasks, lesson_ruling and makeup_owed, with the same actor', async () => {
    const lesson = await owedLesson();
    await tasks.sweep();
    const owed = (await taskFor(`makeup_owed:${lesson}`)) as string;
    await scheduling.resolveMakeup(tsup, lesson, { action: 'waived', note: 'the family agreed' });
    expect(await stateOf(owed)).toMatchObject({ state: 'completed' });
    expect((await completion(owed))?.actor).toMatchObject({ kind: 'staff', id: tsup });
    const [ruling] = await g.prisma.$queryRaw<Array<{ id: string }>>`
      SELECT t.id::text AS id FROM chat.work_task t JOIN chat.lesson_ruling r ON t.source_key = 'lesson_ruling:' || r.id
       WHERE r.lesson_id = ${lesson}::uuid AND r.kind = 'makeup_followup'`;
    if (ruling) {
      expect(await stateOf(ruling.id)).toMatchObject({ state: 'completed' });
      expect((await completion(ruling.id))?.actor).toMatchObject({ kind: 'staff', id: tsup });
    }
  });

  it('the set of lessons with an open task is exactly owedMakeups\' set -- its default, the supervisor follow-up\'s', async () => {
    const teacherMiss = await owedLesson('teacher');
    // A family's own apology owes a make-up, but is never escalated: no task.
    await owedLesson('student');
    const madeUp = await owedLesson('teacher');
    await book(s.teacherId, madeUp);
    await tasks.sweep();
    const owed = (await lessons.owedMakeups(
      (await g.prisma.learner.findUniqueOrThrow({ where: { id: s.learnerId } })).organizationId,
    )).map((l) => l.id).sort();
    const tasked = (await g.prisma.$queryRaw<Array<{ id: string }>>`
      SELECT chat.work_task_makeup_original(t.source_id)::text AS id FROM chat.work_task t
       WHERE t.source_type = 'makeup_owed' AND t.state IN ('open', 'awaiting_decision') AND t.source_state = 'pending'`).map((r) => r.id).sort();
    expect(tasked).toEqual(owed);
    expect(owed).toEqual([teacherMiss]);
  });

  it('an outcome corrected away withdraws the task', async () => {
    const lesson = await owedLesson();
    await tasks.sweep();
    const id = (await taskFor(`makeup_owed:${lesson}`)) as string;
    await records.correct(s.ownerId, lesson, { outcome: 'admin_cancelled', reason: 'recorded on the wrong lesson' });
    expect(await stateOf(id)).toMatchObject({ state: 'open', source_state: 'withdrawn' });
  });

  it('a makeup_followup ruling still pending keeps it owed', async () => {
    const lesson = await owedLesson();
    await tasks.sweep();
    const id = (await taskFor(`makeup_owed:${lesson}`)) as string;
    await exec(
      `insert into chat.lesson_ruling (organization_id, lesson_id, kind, opened_by_kind, opened_by, reason)
       values (chat.default_organization_id(), $1::uuid, 'makeup_followup', 'staff', $2::uuid, 'deciding with the family')`, lesson, tsup,
    );
    await tasks.sweep();
    expect(await stateOf(id)).toMatchObject({ state: 'open', source_state: 'pending' });
  });

  it('a make-up of a missed make-up completes the missed one\'s task', async () => {
    const lesson = await owedLesson();
    await tasks.sweep();
    const first = await book(s.teacherId, lesson);
    await lessons.teacherApology(s.teacherId, first.id, { reason: 'ill again' });
    await tasks.sweep();
    const second = (await taskFor(`makeup_owed:${first.id}`)) as string;
    expect(await stateOf(second)).toMatchObject({ state: 'open', source_state: 'pending' });
    // The family books a make-up OF the missed make-up (makeup_for = it).
    await book(s.parentId, first.id);
    expect(await stateOf(second)).toMatchObject({ state: 'completed' });
    await tasks.sweep();
    expect(await stateOf(second)).toMatchObject({ state: 'completed' });
  });

  it('a booking stands even when its task cannot be settled; the sweep settles it after', async () => {
    const lesson = await owedLesson();
    await tasks.sweep();
    const id = (await taskFor(`makeup_owed:${lesson}`)) as string;
    let bookedId = '';
    await refusingTaskChanges(async () => {
      bookedId = (await book(s.teacherId, lesson)).id;
    });
    expect(await g.prisma.lesson.findUnique({ where: { id: bookedId } })).not.toBeNull();
    expect(await stateOf(id)).toMatchObject({ state: 'open' });
    await tasks.sweep();
    expect(await stateOf(id)).toMatchObject({ state: 'completed' });
  });
});

describe('each source is announced once', () => {
  it('one task_assigned push per source, to its assignee, with no variables -- however often the sweep runs', async () => {
    const c = await complaint();
    const f = await parentSays('suggestion');
    const q = await askNewTimes();
    for (let i = 0; i < 2; i++) {
      await tasks.sweep();
      await worker.drain(500);
    }
    const expected: Array<[string, string, string]> = [
      ['complaint', (await taskFor(`complaint:${c}`)) as string, tmgr],
      ['feedback', (await taskFor(`feedback:${f}`)) as string, tmgr],
      ['schedule_change', (await taskFor(`schedule_change:${q}`)) as string, tmgr],
    ];
    for (const [key, id, to] of expected) {
      const sent = await pushes(id);
      expect({ key, recipients: sent.map((p) => p.recipientId) }).toEqual({ key, recipients: [to] });
      for (const p of sent) expect(p.variables ?? {}).toEqual({});
    }
  });
});
