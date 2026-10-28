/**
 * PD-47 PR-2 -- system tasks from their sources (Phase A).
 * Plan: docs/product/pd047-tasks-plan.md §3.5-§3.6 and the priority amendment §2.
 *
 *   raise      chat.work_task_sweep (the worker) and the event-born sources'
 *              AFTER INSERT triggers; one task per source occurrence, for ever
 *   complete   the source's own transaction, on positive evidence, by the
 *              person the source names; the sweep re-reads it
 *   withdraw   the source went away without its work: the task stays, marked,
 *              until its assignee acknowledges it (plan Q4)
 *   reroute    a case's owner moving moves its task (exit 4, by that actor)
 *
 * Synthetic fixtures only (G-16).
 */
import { randomUUID } from 'node:crypto';
import { PrismaAuditService } from '@platform/audit.service';
import { CommError, CommErrorCode } from '@platform/errors';
import { TeacherScopeService } from '@platform/teacher-scope';
import { LessonService } from '../../src/lessons/lesson.service';
import { TaskService } from '../../src/tasks/task.service';
import { buildGraph, seed, truncate, Scenario } from './harness';

const g = buildGraph();
const audit = new PrismaAuditService();
const scope = new TeacherScopeService(g.prisma);
const lessons = new LessonService(g.prisma, g.authz, g.conversations, g.outbox, g.config, audit, undefined, undefined, scope);
const tasks = new TaskService(g.prisma, g.outbox);

jest.setTimeout(120_000);

let s: Scenario;
let tmgr: string;
let tsupA: string;
let sa: string;
let tdept: string;

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
const exec = (sql: string, ...args: unknown[]) => g.prisma.$executeRawUnsafe(sql, ...args);
const taskFor = async (key: string) =>
  (await g.prisma.$queryRaw<Array<{ id: string }>>`SELECT id::text AS id FROM chat.work_task WHERE source_key = ${key}`)[0]?.id;
const history = async (taskId: string) =>
  (await g.prisma.$queryRaw<Array<{ kind: string; actor_kind: string; actor_id: string | null }>>`
    SELECT kind, actor_kind, actor_id::text AS actor_id FROM chat.work_task_event WHERE task_id = ${taskId}::uuid ORDER BY at, id`)
    .map((e) => [e.kind, e.actor_kind, e.actor_id]);

/** A lesson of s.teacherId with s.learnerId that ended `agoMs` ago. */
async function pastLesson(agoMs: number): Promise<string> {
  const [{ id }] = await g.prisma.$queryRawUnsafe<Array<{ id: string }>>(
    `insert into chat.lesson (organization_id, learner_id, teacher_id, starts_at, ends_at, created_by_kind, created_by)
     select l.organization_id, l.id, $2::uuid, now() - $3::interval - interval '30 minutes', now() - $3::interval, 'staff', $4::uuid
       from chat.learner l where l.id = $1::uuid
     returning id::text as id`,
    s.learnerId, s.teacherId, `${Math.round(agoMs / 1000)} seconds`, tsupA,
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
  s = await seed(g.prisma);
  [tmgr, tsupA, sa] = [randomUUID(), randomUUID(), randomUUID()];
  await exec(`insert into chat.staff (id, name, role, is_active) values ($1::uuid, 'tmgr_s', 'manager', true), ($2::uuid, 'tsup_sa', 'admin', true)`, tmgr, tsupA);
  await g.prisma.$transaction([
    exec(`select set_config('chat.provisioning_super_admin', 'on', true)`),
    exec(`insert into chat.staff (id, name, role, is_active) values ($1::uuid, 'sa_s', 'super_admin', true)`, sa),
  ]);
  [{ id: tdept }] = await g.prisma.$queryRawUnsafe<Array<{ id: string }>>(
    `insert into chat.department (kind, display_name, manager_id) values ('teachers', 'teachers', $1::uuid) returning id::text as id`, tmgr,
  );
  await exec(
    `insert into chat.department_member (staff_id, organization_id, department_id, position) values ($1::uuid, chat.default_organization_id(), $2::uuid, 'supervisor')`,
    tsupA, tdept,
  );
  await exec(
    `insert into chat.teacher_supervisor_assignment (teacher_id, organization_id, supervisor_id) values ($1::uuid, chat.default_organization_id(), $2::uuid)`,
    s.teacherId, tsupA,
  );
  // Lesson reports are raised for lessons that ended after the first sweep; these tests start long before.
  await exec(`insert into chat.config (key, value) values ('tasks.lesson_report_since', to_jsonb('2000-01-01T00:00:00Z'::text))
              on conflict (key) do update set value = excluded.value`);
});

// ---------------------------------------------------------------------------

describe('lesson reports', () => {
  it('a lesson that ended raises one task for its teacher: Yellow until its 24 h pass, worded from the lesson', async () => {
    const lesson = await pastLesson(3_600_000);
    await tasks.sweep();
    await tasks.sweep();
    const [t] = (await tasks.list(s.teacherId, { view: 'mine' })).items;
    expect(t).toMatchObject({
      kind: 'system',
      assignee: { kind: 'teacher', id: s.teacherId },
      source: { type: 'lesson_report', id: lesson },
      sourceState: 'pending',
      effectivePriority: 'medium',
      titleKey: 'task.lesson_report',
      titleParams: expect.objectContaining({ learnerName: 'learner_l' }),
    });
    const [{ n }] = await g.prisma.$queryRaw<Array<{ n: bigint }>>`SELECT count(*) AS n FROM chat.work_task WHERE source_type = 'lesson_report'`;
    expect(Number(n)).toBe(1);
  });

  it('turns Red only once overdue (owner 2026-10-28)', async () => {
    await pastLesson(25 * 3_600_000);
    await tasks.sweep();
    const [t] = (await tasks.list(s.teacherId, { view: 'mine' })).items;
    expect(t).toMatchObject({ effectivePriority: 'high', priorityReason: 'overdue' });
  });

  it('is completed by the report itself, in its own transaction, by the teacher who filed it', async () => {
    const lesson = await pastLesson(3_600_000);
    await tasks.sweep();
    const id = (await taskFor(`lesson_report:${lesson}`)) as string;
    await lessons.report(s.teacherId, lesson, { covered: 'Al-Mulk 1-15' });
    const t = await tasks.get(s.teacherId, id);
    expect(t).toMatchObject({ state: 'completed', outcome: 'done', closedBy: { id: s.teacherId } });
    expect(await history(id)).toEqual([
      ['created', 'system', null],
      ['completed', 'teacher', s.teacherId],
    ]);
    expect((await tasks.list(s.teacherId, { view: 'mine' })).items).toEqual([]);
  });

  it('a teacher cannot mark a report task done by hand, and nobody reassigns it', async () => {
    const lesson = await pastLesson(3_600_000);
    await tasks.sweep();
    const id = (await taskFor(`lesson_report:${lesson}`)) as string;
    expect(await code(tasks.complete(s.teacherId, id, {}))).toBe(CommErrorCode.TASK_DENIED);
    expect(await code(tasks.reassign(tmgr, id, { to: staff(tsupA) }))).toBe(CommErrorCode.TASK_DENIED);
  });

  it('no backfill: a lesson that ended before the first sweep raises nothing', async () => {
    await exec(`update chat.config set value = to_jsonb(now()::text) where key = 'tasks.lesson_report_since'`);
    await pastLesson(3_600_000);
    await tasks.sweep();
    expect((await tasks.list(s.teacherId, { view: 'mine' })).items).toEqual([]);
  });

  it('a lesson the teacher missed withdraws the report task (it stays until acknowledged) and raises the violation decision for their supervisor', async () => {
    const lesson = await pastLesson(3_600_000);
    await tasks.sweep();
    const id = (await taskFor(`lesson_report:${lesson}`)) as string;
    await exec(
      `update chat.lesson set outcome = 'teacher_no_show', outcome_by = $2::uuid, outcome_by_kind = 'staff', outcome_at = now() where id = $1::uuid`,
      lesson, tsupA,
    );
    const withdrawn = await tasks.get(s.teacherId, id);
    expect(withdrawn).toMatchObject({ state: 'open', sourceState: 'withdrawn' });
    expect((await history(id)).map((e) => e[0])).toEqual(['created', 'source_withdrawn']);
    const acked = await tasks.acknowledge(s.teacherId, id);
    expect(acked).toMatchObject({ state: 'completed', outcome: 'acknowledged', closedBy: { id: s.teacherId } });

    const [v] = await g.prisma.$queryRaw<Array<{ id: string }>>`SELECT id::text AS id FROM chat.teacher_violation WHERE lesson_id = ${lesson}::uuid`;
    const vt = await taskFor(`violation_decision:${v.id}`);
    expect(vt).toBeDefined();
    expect((await tasks.get(tsupA, vt as string)).assignee).toEqual(staff(tsupA));
  });

  it('only a withdrawn task is acknowledged', async () => {
    const lesson = await pastLesson(3_600_000);
    await tasks.sweep();
    const id = (await taskFor(`lesson_report:${lesson}`)) as string;
    expect(await code(tasks.acknowledge(s.teacherId, id))).toBe(CommErrorCode.TASK_STATE);
  });
});

describe('leave requests', () => {
  const insertLeave = async (firstDayOffset: number) => {
    const [{ id }] = await g.prisma.$queryRawUnsafe<Array<{ id: string }>>(
      `insert into chat.teacher_leave_request (organization_id, teacher_id, first_day, last_day, reason)
       values (chat.default_organization_id(), $1::uuid, chat.academy_today() + $2::int, chat.academy_today() + $2::int, 'family')
       returning id::text as id`,
      s.teacherId, firstDayOffset,
    );
    return id;
  };

  it('a request raises the decision for the teacher\'s supervisor at once; High when the leave starts within 3 days', async () => {
    const soon = await insertLeave(2);
    const id = (await taskFor(`leave_decision:${soon}`)) as string;
    expect(await tasks.get(tsupA, id)).toMatchObject({ assignee: staff(tsupA), manualPriority: 'high', source: { type: 'leave_decision' } });
    const later = await insertLeave(20);
    expect((await tasks.get(tsupA, (await taskFor(`leave_decision:${later}`)) as string)).manualPriority).toBe('medium');
  });

  it('is completed by the decision, by the person who decided', async () => {
    const req = await insertLeave(20);
    const id = (await taskFor(`leave_decision:${req}`)) as string;
    await exec(`update chat.teacher_leave_request set state = 'approved', decided_by = $2::uuid where id = $1::uuid`, req, tmgr);
    expect(await tasks.get(tmgr, id)).toMatchObject({ state: 'completed', outcome: 'done', closedBy: { id: tmgr } });
  });

  it('withdrawn by the teacher: the task stays, marked, for the supervisor to acknowledge', async () => {
    const req = await insertLeave(20);
    const id = (await taskFor(`leave_decision:${req}`)) as string;
    await exec(`update chat.teacher_leave_request set state = 'withdrawn', ended_by = $2::uuid where id = $1::uuid`, req, s.teacherId);
    expect(await tasks.get(tsupA, id)).toMatchObject({ state: 'open', sourceState: 'withdrawn' });
  });

  it('goes only to someone who supervises that teacher', async () => {
    const req = await insertLeave(20);
    const id = (await taskFor(`leave_decision:${req}`)) as string;
    expect(await code(tasks.reassign(tmgr, id, { to: staff(s.ownerId) }))).toBe(CommErrorCode.TASK_INVALID);
  });
});

describe('cases', () => {
  const asCaseActor = (actor: string, sql: string, ...args: unknown[]) =>
    g.prisma.$transaction([exec(`select set_config('chat.case_actor', $1, true)`, actor), exec(sql, ...args)]);

  it('a case raises its owner\'s task, follows its owner, and is completed when it closes', async () => {
    await asCaseActor(tmgr,
      `insert into chat.supervision_case (organization_id, subject_kind, subject_id, target_department_id, title, owner_id, opened_by)
       values (chat.default_organization_id(), 'teacher', $1::uuid, $2::uuid, 'late reports again', $3::uuid, $3::uuid)`,
      s.teacherId, tdept, tmgr);
    const [{ id: caseId }] = await g.prisma.$queryRaw<Array<{ id: string }>>`SELECT id::text AS id FROM chat.supervision_case`;
    const id = (await taskFor(`case:${caseId}`)) as string;
    expect(await tasks.get(tmgr, id)).toMatchObject({ assignee: staff(tmgr), titleParams: { caseTitle: 'late reports again' } });
    expect(await code(tasks.reassign(tmgr, id, { to: staff(tsupA) }))).toBe(CommErrorCode.TASK_DENIED);

    await asCaseActor(tmgr, `update chat.supervision_case set owner_id = $2::uuid where id = $1::uuid`, caseId, tsupA);
    expect((await tasks.get(tsupA, id)).assignee).toEqual(staff(tsupA));
    await g.prisma.$transaction([
      exec(`select set_config('chat.case_actor', $1, true)`, tmgr),
      exec(`select set_config('chat.case_note', 'talked it through', true)`),
      exec(`update chat.supervision_case set status = 'resolved' where id = $1::uuid`, caseId),
    ]);
    expect(await tasks.get(tsupA, id)).toMatchObject({ state: 'completed', closedBy: { id: tmgr } });
    expect((await history(id)).map((e) => e[0])).toEqual(['created', 'reassigned', 'completed']);
  });
});

describe('the database', () => {
  it('a system task is made, withdrawn and completed only by its source', async () => {
    await expect(
      g.prisma.$transaction([
        exec(`select set_config('chat.task_actor', $1, true)`, sa),
        exec(
          `insert into chat.work_task (organization_id, kind, source_type, source_id, source_key, source_state, assignee_staff_id)
           values (chat.default_organization_id(), 'system', 'case', $1::uuid, 'case:' || $1, 'pending', $2::uuid)`,
          randomUUID(), tmgr,
        ),
      ]),
    ).rejects.toThrow(/made by its source/);

    const lesson = await pastLesson(3_600_000);
    await tasks.sweep();
    const id = (await taskFor(`lesson_report:${lesson}`)) as string;
    const asSa = (sql: string) => g.prisma.$transaction([exec(`select set_config('chat.task_actor', $1, true)`, sa), exec(sql, id)]);
    await expect(asSa(`update chat.work_task set source_state = 'withdrawn' where id = $1::uuid`)).rejects.toThrow(/only with its source/);
    await expect(asSa(`update chat.work_task set state = 'completed', outcome = 'done' where id = $1::uuid`)).rejects.toThrow(/doing its work/);
  });

  it('chat.task_system forges nothing: a request role reaches neither the tables nor the helpers, whatever it sets', async () => {
    const lesson = await pastLesson(3_600_000);
    await tasks.sweep();
    const id = (await taskFor(`lesson_report:${lesson}`)) as string;
    const attempt = (role: string, sql: string, ...args: unknown[]) =>
      g.prisma.$transaction(async (tx) => {
        await tx.$executeRawUnsafe(`set local role ${role}`);
        await tx.$executeRawUnsafe(`select set_config('chat.task_system', 'on', true)`);
        await tx.$executeRawUnsafe(`select set_config('chat.task_actor', $1, true)`, s.teacherId);
        return tx.$executeRawUnsafe(sql, ...args).then(() => 'executed', (e: Error) => e.message);
      });
    for (const role of ['chat_app', 'authenticated', 'anon']) {
      expect(await attempt(role, `update chat.work_task set state = 'completed', outcome = 'done' where id = $1::uuid`, id)).toMatch(/permission denied/);
      expect(await attempt(role,
        `insert into chat.work_task (organization_id, kind, source_type, source_id, source_key, source_state, assignee_teacher_id)
         values (chat.default_organization_id(), 'system', 'case', $1::uuid, 'case:' || $1, 'pending', $2::uuid)`,
        randomUUID(), s.teacherId)).toMatch(/permission denied/);
      expect(await attempt(role, `select chat.work_task_settle(chat.default_organization_id(), $1, $2::uuid)`, `lesson_report:${lesson}`, s.teacherId))
        .toMatch(/permission denied/);
      expect(await attempt(role, `insert into chat.work_task_event (task_id, organization_id, kind, actor_kind, actor_id, body)
                                  values ($1::uuid, chat.default_organization_id(), 'commented', 'teacher', $2::uuid, 'x')`, id, s.teacherId))
        .toMatch(/permission denied/);
    }
    expect((await tasks.get(s.teacherId, id)).state).toBe('open');
  });

  it('the sweep reconciles a source whose trigger missed it: positive evidence only', async () => {
    const lesson = await pastLesson(3_600_000);
    await tasks.sweep();
    const id = (await taskFor(`lesson_report:${lesson}`)) as string;
    // The report filed with the task trigger out of the way.
    await exec(`alter table chat.lesson disable trigger lesson_settles_its_task`);
    try {
      await lessons.report(s.teacherId, lesson, { covered: 'x' });
    } finally {
      await exec(`alter table chat.lesson enable trigger lesson_settles_its_task`);
    }
    expect((await tasks.get(s.teacherId, id)).state).toBe('open');
    await tasks.sweep();
    expect(await tasks.get(s.teacherId, id)).toMatchObject({ state: 'completed', closedBy: { id: s.teacherId } });
  });
});
