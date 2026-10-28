import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../platform/prisma.service';
import { CommError, CommErrorCode } from '../platform/errors';
import { isUuid } from '../communication/conversations/conversation.service';
import { OutboxService } from '../communication/outbox/outbox.service';
import { CommEvent, type TaskChangedPayload } from '../communication/contracts/events';
import { dashboardTile, type DashboardTile } from '../dashboard/dashboard-tile';
import { nextState, type TaskAction, type TaskState } from './task-transitions';

export type PrincipalKind = 'staff' | 'teacher';
export interface Principal {
  kind: PrincipalKind;
  id: string;
}
/** Where a staff viewer stands to a task (chat.work_task_standing), or the assignee. */
type Standing = 'super_admin' | 'manager' | 'supervisor';

export const TASK_VIEWS = ['mine', 'team', 'decisions', 'all'] as const;
export type TaskView = (typeof TASK_VIEWS)[number];
export const DEPARTMENT_KINDS = ['operations', 'teachers', 'sales'] as const;
/** PD-47 priority amendment: the manual level a person sets, and the effective one the server computes. */
export const LEVELS = ['high', 'medium', 'low'] as const;
export type Level = (typeof LEVELS)[number];
export const CATEGORIES = ['financial', 'operational'] as const;
export type Category = (typeof CATEGORIES)[number];
export type PriorityReason = 'manual' | 'due_soon' | 'overdue' | 'source';
/** TaskService.rulesFor: who the viewer is to a task, and what that allows. */
interface TaskRules {
  mine: boolean;
  /** The responsible manager or the super admin: remove, return, due, priority. */
  decide: boolean;
  complete: boolean;
  acknowledge: boolean;
  outOfScope: boolean;
  comment: boolean;
  reassign: 'yes' | 'not_responsible' | 'follows_source';
}
/** What a viewer may do with a task now (TaskService.get `actions`). */
export type TaskActionName = 'complete' | 'acknowledge' | 'out_of_scope' | 'comment' | 'return' | 'remove' | 'reassign' | 'due' | 'priority';
/** What one worker sweep did (chat.work_task_sweep, summed over its batches). */
export interface SweepResult {
  skipped: boolean;
  raised: number;
  settled: number;
  withdrawn: number;
  restored: number;
  rerouted: number;
  /** PR-2b: financial tasks raised to High by their source (a balance used up). */
  floored: number;
  /** PR-2b: financial tasks whose assignee left with nobody live to follow (for the super admin). */
  orphaned: number;
  failed: number;
  /** Candidates whose raise declined (no assignee, not standing, covered): recorded with a back-off. */
  declined: number;
  /** Source occurrences waiting on a recorded issue (chat.work_task_source_issue). */
  issues: number;
  batches: number;
}
const SWEEP_BATCHES = 20;
/** GET /tasks/assignees: at most this many people, and `truncated` beyond it. */
const ASSIGNEES_MAX = 500;

/** PD-47 PR-2: the sources of system tasks (chat.work_task_sweep). */
export const SOURCE_TYPES = [
  'lesson_report', 'report_correction', 'lesson_ruling', 'leave_decision', 'violation_decision', 'case',
  // PD-47 PR-2b: the financial sources (priority amendment §5).
  'instalment', 'package_low', 'renewal_request', 'receipt_review', 'checkout_failed',
] as const;
const FINANCIAL: ReadonlySet<SourceType> = new Set(['instalment', 'package_low', 'renewal_request', 'receipt_review', 'checkout_failed']);
export type SourceType = (typeof SOURCE_TYPES)[number];
/**
 * Sources whose work only one person can do, or whose owner is decided on the
 * source's own page: their task is not reassigned here. A lesson report and a
 * correction are the lesson's teacher's (change the lesson's teacher on the
 * Schedule); a case follows its owner (assign it on the Cases page).
 */
const NOT_REASSIGNABLE: ReadonlySet<SourceType> = new Set(['lesson_report', 'report_correction', 'case', ...FINANCIAL]);
/** The reference time and zone every effective level of one response is computed at. */
interface Clock {
  asOf: string;
  zone: string;
}

const TITLE_MAX = 200;
const BODY_MAX = 4000;
const NOTE_MAX = 2000;
const PAGE = 200;
/** The Closed tab's default window (owner Q13: nothing is deleted; older closed tasks stay searchable). */
const CLOSED_DAYS = 90;
/** The Dashboard reads at most this many pending tasks of the organization (newest first); past it, tiles are `capped`. */
const TILE_SCAN = 5000;

const invalid = (why: string) => new CommError(CommErrorCode.TASK_INVALID, why, 400);
const notFound = () => new CommError(CommErrorCode.TASK_NOT_FOUND, 'task not found');
const denied = (why: string) => new CommError(CommErrorCode.TASK_DENIED, why);
const wrongState = (why: string) => new CommError(CommErrorCode.TASK_STATE, why, 409);

interface Viewer {
  id: string;
  kind: PrincipalKind;
  organizationId: string;
  superAdmin: boolean;
}

interface Row {
  id: string;
  kind: 'manual' | 'system';
  state: TaskState;
  outcome: 'done' | 'acknowledged' | null;
  assignee_staff_id: string | null;
  assignee_teacher_id: string | null;
  assignee_name: string | null;
  assignee_live: boolean;
  title: string | null;
  body: string | null;
  due_at: Date | null;
  instructions: string | null;
  created_by: string | null;
  creator_name: string | null;
  created_at: Date;
  created_at_key: string;
  updated_at: Date;
  activity_at: Date;
  closed_by: string | null;
  closer_name: string | null;
  closed_at: Date | null;
  close_reason: string | null;
  revision: number;
  disputed: number;
  unmanaged: boolean;
  standing: Standing | null;
  priority: Level;
  category: Category;
  source_type: SourceType | null;
  source_id: string | null;
  source_state: 'pending' | 'withdrawn' | null;
  /** The teacher a system task's decision is about (leave, violation, ruling): who a reassignment must stand to. */
  source_teacher_id: string | null;
  /** What the client words a system task's title with, read from the source now (never frozen). */
  title_params: Record<string, unknown> | null;
  eff_level: Level;
  eff_reason: PriorityReason;
  eff_overdue: boolean;
  /** Sort keys, as text to the microsecond, for the cursor. */
  k1: number;
  k2: number;
  k3: number;
  k4_key: string;
  closed_at_key: string | null;
}

interface EventRow {
  id: string;
  kind: string;
  actor_kind: string;
  actor_id: string | null;
  actor_name: string | null;
  from_assignee: string | null;
  to_assignee: string | null;
  body: string | null;
  before: unknown;
  after: unknown;
  at: Date;
}

/**
 * PD-47: tasks (chat.work_task) -- every person's responsibilities, durable
 * until one of the owner's four exits.
 *
 *   create  a manager for their team; a teacher supervisor for their own
 *           teachers (owner Q5); the super admin for anyone. Never peer to
 *           peer, and teachers create none.
 *   see     the assignee (Mine, always, whatever the scope does); the
 *           responsible manager -- the manager of the assignee's department,
 *           or the Teachers manager for a teacher (Team); a teacher's PD-35
 *           supervisor, read-only (Q3); the super admin (All). Anyone else:
 *           not found. Decided live at every read.
 *   exits   1 complete: the assignee (a manual task; a system task completes
 *           by its work, PR-2). 2 out of scope: the assignee, with a comment;
 *           the responsible manager or the super admin then removes, returns
 *           it with instructions, or reassigns. 3 remove, with a reason.
 *           4 reassign: within the manager's team, or to another
 *           department's manager (Q6); the super admin to anyone.
 *
 * The database writes the history (one chat.work_task_event per change, actor
 * from chat.task_actor, the reason or instructions from chat.task_note) and
 * refuses any move that is not an exit. Every change enqueues task.changed.
 */
@Injectable()
export class TaskService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly outbox: OutboxService,
  ) {}

  /** { assignee: { kind: 'staff' | 'teacher', id }, title, body?, dueAt?, priority?, category? } */
  async create(actorId: string, body: Record<string, unknown>) {
    const viewer = await this.requireViewer(actorId);
    if (viewer.kind !== 'staff') throw denied('teachers do not create tasks');
    const assignee = principalOf(body.assignee, 'assignee');
    const title = text(body.title, 'title', TITLE_MAX, true) as string;
    const detail = text(body.body, 'body', BODY_MAX, false);
    const dueAt = dueField(body.dueAt);
    const priority = levelField(body.priority, 'priority') ?? 'medium';
    const category = categoryField(body.category) ?? 'operational';
    await this.requireLive(viewer.organizationId, assignee);
    const standing = await this.standingTo(viewer, assignee);
    const allowed =
      standing === 'super_admin' || standing === 'manager' || (standing === 'supervisor' && assignee.kind === 'teacher');
    if (!allowed) throw denied('a task is given by the assignee\'s manager, a teacher\'s supervisor, or the super admin');
    // Owner Q-F3: a manager (or the super admin) may mark a manual task financial.
    if (category === 'financial' && standing !== 'super_admin' && standing !== 'manager') {
      throw denied('a manager or the super admin marks a task financial');
    }

    const id = await this.asActor(viewer.id, null, async (tx) => {
      const [row] = await tx.$queryRaw<Array<{ id: string; revision: number }>>`
        INSERT INTO chat.work_task (organization_id, kind, assignee_staff_id, assignee_teacher_id, title, body, due_at, created_by,
                                    priority, category)
        VALUES (${viewer.organizationId}::uuid, 'manual',
                ${assignee.kind === 'staff' ? assignee.id : null}::uuid, ${assignee.kind === 'teacher' ? assignee.id : null}::uuid,
                ${title}, ${detail}, ${dueAt}::timestamptz, ${viewer.id}::uuid, ${priority}, ${category})
        RETURNING id::text AS id, revision`;
      await this.signal(tx, row.id, row.revision, 'created');
      return row.id;
    });
    return this.summary(await this.load(viewer, id));
  }

  /**
   * ?view=mine|team|decisions|all &state=open|closed &level=high|medium|low
   * &category=financial|operational &overdue=true &cursor
   *
   * Pending tasks come most urgent first (PD-47 priority amendment §3): the
   * effective level (red, yellow, green), then financial before operational
   * inside a level, then the soonest due (most overdue first), then the undated,
   * oldest first. The first page fixes `asOf`; the cursor carries it, so a task
   * crossing a boundary while someone pages never moves between pages. Closed
   * tasks come newest first.
   */
  async list(actorId: string, query: { view: string; state?: string; cursor?: string; level?: string; category?: string; overdue?: string; limit?: string }) {
    const viewer = await this.requireViewer(actorId);
    const view = query.view as TaskView;
    if (!(TASK_VIEWS as readonly string[]).includes(view)) throw invalid('view: mine, team, decisions or all');
    const state = query.state ?? 'open';
    if (state !== 'open' && state !== 'closed') throw invalid('state: open or closed');
    if (view === 'all' && !viewer.superAdmin) throw denied('only the super admin sees every task');

    const standing = this.standingSql(viewer);
    const scope =
      view === 'mine'
        ? mineSql(viewer)
        : view === 'team'
          ? Prisma.sql`${standing} IN ('manager', 'supervisor')`
          : view === 'decisions'
            ? Prisma.sql`${standing} IN ('manager', 'super_admin')`
            : Prisma.sql`true`;
    // The super admin's Decisions also hold every pending task no live manager
    // stands to: only they can move it (chat.work_task_unmanaged).
    const states =
      view === 'decisions'
        ? viewer.superAdmin
          ? Prisma.sql`(t.state = 'awaiting_decision' OR (t.state = 'open' AND ${UNMANAGED}))`
          : Prisma.sql`t.state = 'awaiting_decision'`
        : state === 'open'
          ? Prisma.sql`t.state IN ('open', 'awaiting_decision')`
          : Prisma.sql`t.state IN ('completed', 'removed') AND t.closed_at > now() - make_interval(days => ${CLOSED_DAYS}::int)`;
    const order: Order = view !== 'decisions' && state === 'closed' ? 'closed' : 'urgency';
    const cursor = cursorOf(query.cursor, order);
    const clock = await this.clock(cursor?.asOf);
    const level = levelField(query.level, 'level');
    const category = categoryField(query.category);
    // overdue=true: past their deadline by their own floor rule (an instalment
    // on its due day is due, not overdue); overdue=false: not past it.
    if (query.overdue !== undefined && query.overdue !== '' && query.overdue !== 'true' && query.overdue !== 'false') {
      throw invalid('overdue: true or false');
    }
    const filters = category ? Prisma.sql`t.category = ${category}` : Prisma.sql`true`;
    const overdue =
      query.overdue === 'true' ? Prisma.sql`r.eff_overdue` : query.overdue === 'false' ? Prisma.sql`NOT r.eff_overdue` : Prisma.sql`true`;
    const outer = Prisma.sql`${level ? Prisma.sql`r.eff_level = ${level}` : Prisma.sql`true`} AND ${overdue} AND ${afterSql(cursor)}`;
    const limit = query.limit === undefined || query.limit === '' ? PAGE : Number(query.limit);
    if (!Number.isInteger(limit) || limit < 1 || limit > PAGE) throw invalid(`limit: 1 to ${PAGE}`);
    const rows = await this.rows(
      viewer,
      Prisma.sql`t.organization_id = ${viewer.organizationId}::uuid AND ${scope} AND ${states} AND ${filters}`,
      clock,
      order,
      outer,
      limit,
    );
    const last = rows.length === limit ? rows[rows.length - 1] : undefined;
    return {
      asOf: clock.asOf,
      items: rows.map((r) => this.summary(r)),
      nextCursor: last ? cursorFor(last, order, clock.asOf) : null,
    };
  }

  /** The task and its whole history. */
  async get(actorId: string, taskId: string) {
    const viewer = await this.requireViewer(actorId);
    const row = await this.visible(viewer, taskId);
    const events = await this.prisma.$queryRaw<EventRow[]>`
      SELECT e.id::text AS id, e.kind, e.actor_kind, e.actor_id::text AS actor_id,
             coalesce(s.name, te.name) AS actor_name,
             e.from_assignee::text AS from_assignee, e.to_assignee::text AS to_assignee, e.body, e.before, e.after, e.at
        FROM chat.work_task_event e
        LEFT JOIN chat.staff s ON e.actor_kind = 'staff' AND s.id = e.actor_id
        LEFT JOIN chat.teacher te ON e.actor_kind = 'teacher' AND te.id = e.actor_id
       WHERE e.task_id = ${row.id}::uuid
       ORDER BY e.at, e.id`;
    return {
      ...this.summary(row),
      /**
       * PD-47 PR-3: what this viewer may do with the task now, by the same
       * rules as the routes (which decide again on every write). A client
       * offers these and nothing else.
       */
      actions: await this.actionsFor(viewer, row),
      history: events.map((e) => ({
        id: e.id,
        kind: e.kind,
        actor: e.actor_id ? { kind: e.actor_kind, id: e.actor_id, name: e.actor_name ?? '' } : null,
        fromAssigneeId: e.from_assignee,
        toAssigneeId: e.to_assignee,
        body: e.body,
        /** What changed, for a client to say "Medium -> High" or "due Mon -> Wed"; the created event's after holds the initial priority and category. */
        before: e.before ?? null,
        after: e.after ?? null,
        at: e.at.toISOString(),
      })),
    };
  }

  /**
   * PD-47 PR-3: who the caller may give a task to (no `task`: creating) or
   * hand this task on to (`task`): live people, by the rules of create and
   * reassign, and the departments with a live manager. The routes decide again.
   */
  async assignees(actorId: string, query: { task?: string }) {
    const viewer = await this.requireViewer(actorId);
    if (viewer.kind !== 'staff') throw denied('teachers neither give nor hand on tasks');
    const row = query.task ? await this.visible(viewer, query.task) : null;
    // Handing on: only for whoever may (rulesFor); nobody to offer otherwise.
    if (row && (await this.rulesFor(viewer, row)).reassign !== 'yes') return { people: [], departments: [], truncated: false };
    const standing = Prisma.sql`chat.work_task_standing(${viewer.id}::uuid, ${viewer.organizationId}::uuid, p.sid, p.tid, NULL)`;
    // Creating: the assignee's manager, or a teacher's supervisor. Handing on:
    // a manager within their team, or to themselves.
    const may = viewer.superAdmin
      ? Prisma.sql`true`
      : row
        ? Prisma.sql`(p.sid = ${viewer.id}::uuid OR ${standing} = 'manager')`
        : Prisma.sql`(${standing} = 'manager' OR (${standing} = 'supervisor' AND p.tid IS NOT NULL))`;
    // A teacher's decision goes to someone who supervises that teacher.
    const stands = row?.source_teacher_id
      ? Prisma.sql`p.sid IS NOT NULL AND chat.staff_teacher_scope(p.sid, ${row.source_teacher_id}::uuid) IS NOT NULL`
      : Prisma.sql`true`;
    const current = row ? assigneeOf(row).id : null;
    const people = await this.prisma.$queryRaw<Array<{ kind: PrincipalKind; id: string; name: string }>>`
      SELECT p.kind, p.id::text AS id, p.name FROM (
        SELECT 'staff' AS kind, s.id, s.name, s.id AS sid, NULL::uuid AS tid FROM chat.staff s
         WHERE s.organization_id = ${viewer.organizationId}::uuid AND s.is_active AND s.left_at IS NULL AND s.role <> 'system'
        UNION ALL
        SELECT 'teacher', t.id, t.name, NULL::uuid, t.id FROM chat.teacher t
         WHERE t.organization_id = ${viewer.organizationId}::uuid AND t.is_active AND t.left_at IS NULL
      ) p
      WHERE ${may} AND ${stands} AND p.id IS DISTINCT FROM ${current}::uuid
      ORDER BY p.name, p.id
      LIMIT ${ASSIGNEES_MAX + 1}`;
    // A department is a handing-on target (it lands with its manager), not a
    // creating one. A teacher's decision goes only to a department whose
    // manager supervises that teacher (the route's own check).
    const departments = row
      ? await this.prisma.$queryRaw<Array<{ kind: string; managerName: string }>>`
          SELECT DISTINCT ON (d.kind) d.kind, m.name AS "managerName" FROM chat.department d
            JOIN chat.staff m ON m.id = d.manager_id AND m.is_active AND m.left_at IS NULL
           WHERE d.organization_id = ${viewer.organizationId}::uuid AND d.kind IN ('operations', 'teachers', 'sales')
             AND m.id IS DISTINCT FROM ${current}::uuid
             AND (${row.source_teacher_id}::uuid IS NULL OR chat.staff_teacher_scope(m.id, ${row.source_teacher_id}::uuid) IS NOT NULL)
           ORDER BY d.kind, d.id`
      : [];
    // An academy larger than the list: say so, rather than silently cut it.
    return { people: people.slice(0, ASSIGNEES_MAX), departments, truncated: people.length > ASSIGNEES_MAX };
  }

  /** Exit 1, a manual task: the assignee says it is done. { note? } */
  async complete(actorId: string, taskId: string, body: Record<string, unknown>) {
    const { viewer, row, rules } = await this.forAssignee(actorId, taskId, 'complete');
    if (!rules.complete) throw denied('a system task is completed by doing its work');
    const note = text(body.note, 'note', NOTE_MAX, false);
    return this.move(viewer, row, 'complete', note, Prisma.sql`state = 'completed', outcome = 'done'`, 'completed', mineSql(viewer));
  }

  /**
   * Exit 1 for a system task whose source went away without its work (a lesson
   * cancelled, a request withdrawn): the assignee acknowledges it (plan Q4).
   * Nothing closes it by itself.
   */
  async acknowledge(actorId: string, taskId: string) {
    const { viewer, row, rules } = await this.forAssignee(actorId, taskId, 'complete');
    if (!rules.acknowledge) throw wrongState('only a task whose work no longer exists is acknowledged');
    return this.move(viewer, row, 'complete', null, Prisma.sql`state = 'completed', outcome = 'acknowledged'`, 'completed', mineSql(viewer));
  }

  /**
   * PD-47 PR-2: the worker's sweep of the task sources (chat.work_task_sweep),
   * batch after batch (each its own transaction, at most 60 rows) while more
   * is waiting, up to SWEEP_BATCHES. Returns the totals; `failed` and
   * `issues` are what the worker logs.
   */
  async sweep(): Promise<SweepResult> {
    const total: SweepResult = {
      skipped: false, raised: 0, settled: 0, withdrawn: 0, restored: 0, rerouted: 0, floored: 0, orphaned: 0,
      failed: 0, declined: 0, issues: 0, batches: 0,
    };
    // PR-2's sources, then PR-2b's financial ones: each sweep its own lock and batches.
    let skipped = 0;
    for (const sweep of [Prisma.sql`chat.work_task_sweep(50)`, Prisma.sql`chat.work_task_sweep_financial(50)`]) {
      for (let i = 0; i < SWEEP_BATCHES; i++) {
        const [row] = await this.prisma.$queryRaw<Array<{ r: Record<string, unknown> }>>`SELECT ${sweep} AS r`;
        const r = row?.r ?? {};
        if (r.skipped === true) {
          if (i === 0) skipped += 1;
          break;
        }
        total.batches += 1;
        for (const k of ['raised', 'settled', 'withdrawn', 'restored', 'rerouted', 'floored', 'orphaned', 'failed', 'declined'] as const) total[k] += Number(r[k] ?? 0);
        total.issues = Number(r.issues ?? 0);
        if (r.more !== true) break;
      }
    }
    total.skipped = skipped === 2;
    return total;
  }

  /** Exit 2: the assignee says it is outside their responsibility. { comment } */
  async outOfScope(actorId: string, taskId: string, body: Record<string, unknown>) {
    const { viewer, row } = await this.forAssignee(actorId, taskId, 'out_of_scope');
    const comment = text(body.comment, 'comment', NOTE_MAX, true) as string;
    return this.move(viewer, row, 'out_of_scope', comment, Prisma.sql`state = 'awaiting_decision'`, 'out_of_scope', mineSql(viewer));
  }

  /** Exit 2's decision: back to the assignee, with instructions. { instructions } */
  async returnTask(actorId: string, taskId: string, body: Record<string, unknown>) {
    const { viewer, row } = await this.forDecider(actorId, taskId);
    const instructions = text(body.instructions, 'instructions', NOTE_MAX, true) as string;
    return this.move(viewer, row, 'return', instructions, Prisma.sql`state = 'open', instructions = ${instructions}`, 'returned', this.deciderSql(viewer));
  }

  /** Exit 3 (or exit 2's decision): removed, with a reason. { reason } */
  async remove(actorId: string, taskId: string, body: Record<string, unknown>) {
    const { viewer, row } = await this.forDecider(actorId, taskId);
    const reason = text(body.reason, 'reason', NOTE_MAX, true) as string;
    return this.move(viewer, row, 'remove', reason, Prisma.sql`state = 'removed'`, 'removed', this.deciderSql(viewer));
  }

  /**
   * Exit 4 (or exit 2's decision). { to: { kind, id } | { department: kind }, instructions? }
   * A manager hands it within their team, or sends it to another department,
   * whose manager distributes it (Q6). The super admin hands it to anyone.
   *
   * A task sent to a department lands with its manager, who belongs to no
   * department (PD-8) and so has no responsible manager of their own: as the
   * assignee, a department's manager hands their own task on -- within their
   * team, or to another department. Only reassigning: removing and returning
   * stay with a responsible manager or the super admin.
   */
  async reassign(actorId: string, taskId: string, body: Record<string, unknown>) {
    const viewer = await this.requireViewer(actorId);
    const row = await this.visible(viewer, taskId);
    const rules = await this.rulesFor(viewer, row);
    const decider = rules.decide;
    if (rules.reassign === 'not_responsible') {
      throw denied('a task is reassigned by the responsible manager, the super admin, or a department manager it was sent to');
    }
    if (rules.reassign === 'follows_source' && row.source_type) {
      throw denied(
        row.source_type === 'case'
          ? 'a case\'s task follows its owner: assign the case on its page'
          : FINANCIAL.has(row.source_type)
            ? 'a financial task follows the family\'s billing supervisor or Sales owner: change them, and the task follows'
            : 'only the lesson\'s teacher writes its report or correction: change the lesson\'s teacher on the Schedule, and the task follows',
      );
    }
    const instructions = text(body.instructions, 'instructions', NOTE_MAX, false);
    const to = await this.targetOf(viewer, body.to);
    await this.requireLive(viewer.organizationId, to.principal);
    // A teacher's decision (leave, violation, ruling) goes to someone who stands to that teacher.
    if (row.source_teacher_id) {
      const [ok] = await this.prisma.$queryRaw<Array<{ ok: boolean }>>`
        SELECT ${to.principal.kind === 'staff'}::boolean
               AND chat.staff_teacher_scope(${to.principal.id}::uuid, ${row.source_teacher_id}::uuid) IS NOT NULL AS ok`;
      if (!ok?.ok) throw invalid('to: someone who supervises this teacher');
    }
    const current = assigneeOf(row);
    if (current.kind === to.principal.kind && current.id === to.principal.id) throw invalid('to: the task is already theirs');
    if (!to.department && !viewer.superAdmin && to.principal.id !== viewer.id) {
      if ((await this.standingTo(viewer, to.principal)) !== 'manager') {
        throw denied('a manager hands a task within their team, or sends it to another department');
      }
    }
    const set = Prisma.sql`assignee_staff_id = ${to.principal.kind === 'staff' ? to.principal.id : null}::uuid,
                           assignee_teacher_id = ${to.principal.kind === 'teacher' ? to.principal.id : null}::uuid,
                           instructions = ${instructions},
                           state = 'open'`;
    // The target is decided again in the writing transaction too: still in the
    // caller's team, or still that department's manager.
    const target = to.department
      ? Prisma.sql`EXISTS (SELECT 1 FROM chat.department d WHERE d.organization_id = t.organization_id
                             AND d.kind = ${to.department} AND d.manager_id = ${to.principal.id}::uuid)`
      : viewer.superAdmin || to.principal.id === viewer.id
        ? Prisma.sql`true`
        : Prisma.sql`chat.work_task_standing(${viewer.id}::uuid, t.organization_id,
                       ${to.principal.kind === 'staff' ? to.principal.id : null}::uuid,
                       ${to.principal.kind === 'teacher' ? to.principal.id : null}::uuid, NULL) = 'manager'`;
    const who = decider ? this.deciderSql(viewer) : this.handsOwnSql(viewer);
    // A teacher's decision goes to someone who stands to that teacher -- decided again in the write.
    const stands = row.source_teacher_id
      ? Prisma.sql`chat.staff_teacher_scope(${to.principal.id}::uuid, ${row.source_teacher_id}::uuid) IS NOT NULL`
      : Prisma.sql`true`;
    return this.move(viewer, row, 'reassign', instructions, set, 'reassigned', Prisma.sql`${who} AND ${target} AND ${stands}`);
  }

  /** { dueAt: ISO timestamp | null }: the responsible manager or the super admin. */
  async setDue(actorId: string, taskId: string, body: Record<string, unknown>) {
    const { viewer, row } = await this.forDecider(actorId, taskId);
    const dueAt = dueField(body.dueAt);
    if ((row.due_at?.toISOString() ?? null) === dueAt) throw invalid('dueAt: unchanged');
    return this.move(viewer, row, 'due', null, Prisma.sql`due_at = ${dueAt}::timestamptz`, 'due_changed', this.deciderSql(viewer));
  }

  /**
   * { priority: high | medium | low }: the manual level. The responsible manager
   * (the line manager, or the manager who created the task) or the super admin,
   * as for the due date (owner, 2026-10-28). Recorded as priority_changed.
   */
  async setPriority(actorId: string, taskId: string, body: Record<string, unknown>) {
    const { viewer, row } = await this.forDecider(actorId, taskId);
    const priority = levelField(body.priority, 'priority');
    if (!priority) throw invalid('priority: high, medium or low');
    if (row.priority === priority) throw invalid('priority: unchanged');
    return this.move(viewer, row, 'priority', null, Prisma.sql`priority = ${priority}`, 'priority_changed', this.deciderSql(viewer));
  }

  /**
   * The assignee, a responsible manager or the super admin. It changes nothing
   * but the history. A teacher's supervisor reads the task and stays silent
   * (owner Q3: read-only). { body }
   */
  async comment(actorId: string, taskId: string, body: Record<string, unknown>) {
    const viewer = await this.requireViewer(actorId);
    const row = await this.visible(viewer, taskId);
    if (!(await this.rulesFor(viewer, row)).comment) {
      throw denied('a teacher\'s supervisor reads their teachers\' tasks; comments are the assignee\'s and their manager\'s');
    }
    if (nextState(row.state, 'comment') === null) throw wrongState('this task is closed');
    const note = text(body.body, 'body', NOTE_MAX, true) as string;
    await this.asActor(viewer.id, null, async (tx) => {
      // Standing re-checked under the row's lock, in the writing transaction.
      const [held] = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT t.id::text AS id FROM chat.work_task t
         WHERE t.id = ${row.id}::uuid AND t.state IN ('open', 'awaiting_decision')
           AND (${mineSql(viewer)} OR ${this.deciderSql(viewer)})
         FOR UPDATE`;
      if (!held) throw wrongState('the task changed meanwhile; reload it');
      // The event touches the task itself (chat.touch_work_task_on_comment).
      await tx.$executeRaw`
        INSERT INTO chat.work_task_event (task_id, organization_id, kind, actor_kind, actor_id, to_assignee, body)
        VALUES (${row.id}::uuid, ${viewer.organizationId}::uuid, 'commented', ${viewer.kind}, ${viewer.id}::uuid,
                ${assigneeOf(row).id}::uuid, ${note})`;
      const [after] = await tx.$queryRaw<Array<{ revision: number }>>`
        SELECT revision FROM chat.work_task WHERE id = ${row.id}::uuid`;
      await this.signal(tx, row.id, after.revision, 'commented');
    });
    return this.summary(await this.load(viewer, row.id));
  }

  /**
   * PD-44: the Dashboard's task tiles -- `list`'s own predicates, counted,
   * pending tasks only, so each tile equals the list it links to:
   *   everyone            tasks.mine_open, tasks.mine_overdue           (view=mine)
   *                       tasks.mine_urgent (level=high), tasks.mine_financial (category=financial)
   *   a department's      tasks.team_open, tasks.team_overdue, _urgent, _financial (view=team)
   *   manager             tasks.awaiting_decision                       (view=decisions)
   *                       tasks.needs_reassignment (team, assignee gone)
   *   the super admin     tasks.all_open, tasks.all_overdue             (view=all), the
   *                       decisions, needs_reassignment over all, and tasks.unmanaged
   * At most TILE_SCAN pending rows are read; a tile past that is `capped`.
   */
  async dashboardCounts(actorId: string): Promise<DashboardTile[]> {
    const viewer = await this.requireViewer(actorId);
    const sa = viewer.superAdmin;
    const standing = this.standingSql(viewer);
    // The super admin's wide tiles are view=all; anyone else's are view=team.
    const wide = sa ? Prisma.sql`true` : Prisma.sql`coalesce(${standing} IN ('manager', 'supervisor'), false)`;
    const unmanaged = sa ? UNMANAGED : Prisma.sql`false`;
    const [r] = await this.prisma.$queryRaw<
      Array<{
        manages: boolean; scanned: number;
        mine: number; mine_oldest: Date | null; mine_overdue: number;
        wide: number; wide_oldest: Date | null; wide_overdue: number;
        decisions: number; decisions_oldest: Date | null;
        gone: number; unmanaged: number;
        mine_urgent: number; mine_financial: number; wide_urgent: number; wide_financial: number;
      }>
    >`
      SELECT (${sa}::boolean OR EXISTS (
                SELECT 1 FROM chat.department d WHERE d.manager_id = ${viewer.id}::uuid AND d.organization_id = ${viewer.organizationId}::uuid)) AS manages,
             count(*)::int AS scanned,
             count(*) FILTER (WHERE x.mine)::int AS mine,
             min(x.created_at) FILTER (WHERE x.mine) AS mine_oldest,
             count(*) FILTER (WHERE x.mine AND x.overdue)::int AS mine_overdue,
             count(*) FILTER (WHERE x.wide)::int AS wide,
             min(x.created_at) FILTER (WHERE x.wide) AS wide_oldest,
             count(*) FILTER (WHERE x.wide AND x.overdue)::int AS wide_overdue,
             count(*) FILTER (WHERE x.decides AND (x.state = 'awaiting_decision' OR x.unmanaged))::int AS decisions,
             min(x.created_at) FILTER (WHERE x.decides AND (x.state = 'awaiting_decision' OR x.unmanaged)) AS decisions_oldest,
             count(*) FILTER (WHERE x.wide AND NOT x.live)::int AS gone,
             count(*) FILTER (WHERE x.unmanaged)::int AS unmanaged,
             count(*) FILTER (WHERE x.mine AND x.urgent)::int AS mine_urgent,
             count(*) FILTER (WHERE x.mine AND x.financial)::int AS mine_financial,
             count(*) FILTER (WHERE x.wide AND x.urgent)::int AS wide_urgent,
             count(*) FILTER (WHERE x.wide AND x.financial)::int AS wide_financial
        FROM (
          SELECT t.created_at, t.due_at, t.state,
                 (e.level = 'high') AS urgent,
                 e.overdue AS overdue,
                 (t.category = 'financial') AS financial,
                 ${mineSql(viewer)} AS mine,
                 ${wide} AS wide,
                 ${this.deciderSql(viewer)} AS decides,
                 ${unmanaged} AS unmanaged,
                 coalesce(a.is_active AND a.left_at IS NULL, ta.is_active AND ta.left_at IS NULL, false) AS live
            FROM chat.work_task t
            CROSS JOIN LATERAL chat.work_task_effective(t.priority, t.floor_rule, t.due_at, t.source_floor, t.state,
                                                         now(), chat.work_task_academy_zone()) e
            LEFT JOIN chat.staff a ON a.id = t.assignee_staff_id
            LEFT JOIN chat.teacher ta ON ta.id = t.assignee_teacher_id
           WHERE t.organization_id = ${viewer.organizationId}::uuid
             AND t.state IN ('open', 'awaiting_decision')
           ORDER BY t.created_at DESC
           LIMIT ${TILE_SCAN}
        ) x`;
    const capped = (r?.scanned ?? 0) >= TILE_SCAN;
    // *_urgent: effective High (list level=high); *_financial: list category=financial.
    const tiles = [
      dashboardTile('tasks.mine_open', r?.mine ?? 0, r?.mine_oldest ?? null, capped),
      dashboardTile('tasks.mine_overdue', r?.mine_overdue ?? 0, null, capped),
      dashboardTile('tasks.mine_urgent', r?.mine_urgent ?? 0, null, capped),
      dashboardTile('tasks.mine_financial', r?.mine_financial ?? 0, null, capped),
    ];
    if (r?.manages) {
      const scope = sa ? 'all' : 'team';
      tiles.push(
        dashboardTile(`tasks.${scope}_open`, r.wide, r.wide_oldest, capped),
        dashboardTile(`tasks.${scope}_overdue`, r.wide_overdue, null, capped),
        dashboardTile(`tasks.${scope}_urgent`, r.wide_urgent, null, capped),
        dashboardTile(`tasks.${scope}_financial`, r.wide_financial, null, capped),
        dashboardTile('tasks.awaiting_decision', r.decisions, r.decisions_oldest, capped),
        dashboardTile('tasks.needs_reassignment', r.gone, null, capped),
      );
    }
    if (sa) tiles.push(dashboardTile('tasks.unmanaged', r?.unmanaged ?? 0, null, capped));
    return tiles;
  }

  // ------------------------------------------------------------------

  /** One exit or edit, as `viewer`, recorded by the database and signalled. */
  private async move(
    viewer: Viewer,
    row: Row,
    action: TaskAction,
    note: string | null,
    set: Prisma.Sql,
    change: TaskChangedPayload['change'],
    /** Who may do this, re-checked in the writing transaction (the row is locked by the UPDATE). */
    auth: Prisma.Sql,
  ) {
    if (nextState(row.state, action) === null) {
      throw wrongState(row.state === 'completed' || row.state === 'removed' ? 'this task is closed' : `a task ${row.state.replace('_', ' ')} cannot do that`);
    }
    await this.asActor(viewer.id, note, async (tx) => {
      // Guarded by the state it was read in -- a concurrent exit wins, this one
      // is refused -- and by the caller's standing, decided again now.
      const [moved] = await tx.$queryRaw<Array<{ revision: number }>>`
        UPDATE chat.work_task t SET ${set}
         WHERE t.id = ${row.id}::uuid AND t.state = ${row.state} AND t.revision = ${row.revision} AND ${auth}
         RETURNING t.revision`;
      if (!moved) throw wrongState('the task changed meanwhile; reload it');
      await this.signal(tx, row.id, moved.revision, change);
    });
    return this.summary(await this.load(viewer, row.id));
  }

  private signal(tx: Prisma.TransactionClient, taskId: string, revision: number, change: TaskChangedPayload['change']) {
    return this.outbox.enqueue(tx, CommEvent.TASK_CHANGED, { taskId, revision, change });
  }

  /** The live person behind `actorId`: staff or a teacher, of an organization. */
  private async requireViewer(actorId: string): Promise<Viewer> {
    if (!isUuid(actorId)) throw denied('tasks are for staff and teachers');
    const [p] = await this.prisma.$queryRaw<Array<{ kind: PrincipalKind; organization_id: string; role: string | null }>>`
      SELECT 'staff' AS kind, s.organization_id::text AS organization_id, s.role
        FROM chat.staff s WHERE s.id = ${actorId}::uuid AND s.is_active AND s.left_at IS NULL
      UNION ALL
      SELECT 'teacher', t.organization_id::text, NULL
        FROM chat.teacher t WHERE t.id = ${actorId}::uuid AND t.is_active AND t.left_at IS NULL
      LIMIT 1`;
    if (!p) throw denied('tasks are for live staff and teachers');
    return { id: actorId, kind: p.kind, organizationId: p.organization_id, superAdmin: p.role === 'super_admin' };
  }

  private async isLive(org: string, p: Principal): Promise<boolean> {
    const [r] = await this.prisma.$queryRaw<Array<{ kind: string | null }>>`
      SELECT chat.task_principal_kind(${p.id}::uuid, ${org}::uuid) AS kind`;
    return r?.kind === p.kind;
  }

  private async requireLive(org: string, p: Principal) {
    if (!(await this.isLive(org, p))) throw invalid(`${p.kind}: a live person of this organization`);
  }

  private async standingTo(viewer: Viewer, p: Principal): Promise<Standing | null> {
    if (viewer.kind !== 'staff') return null;
    const [r] = await this.prisma.$queryRaw<Array<{ standing: Standing | null }>>`
      SELECT chat.work_task_standing(${viewer.id}::uuid, ${viewer.organizationId}::uuid,
                                     ${p.kind === 'staff' ? p.id : null}::uuid, ${p.kind === 'teacher' ? p.id : null}::uuid, NULL) AS standing`;
    return r?.standing ?? null;
  }

  private standingSql(viewer: Viewer): Prisma.Sql {
    return viewer.kind === 'staff'
      ? Prisma.sql`chat.work_task_standing(${viewer.id}::uuid, t.organization_id, t.assignee_staff_id, t.assignee_teacher_id, t.created_by)`
      : Prisma.sql`NULL::text`;
  }

  /** A responsible manager or the super admin, for the task row `t`. */
  private deciderSql(viewer: Viewer): Prisma.Sql {
    return Prisma.sql`coalesce(${this.standingSql(viewer)} IN ('manager', 'super_admin'), false)`;
  }

  /** The assignee, while they manage a department (see reassign). */
  private handsOwnSql(viewer: Viewer): Prisma.Sql {
    return Prisma.sql`(${mineSql(viewer)} AND EXISTS (
      SELECT 1 FROM chat.department d WHERE d.manager_id = ${viewer.id}::uuid AND d.organization_id = t.organization_id))`;
  }

  /**
   * Who may do what with this task, by who the viewer is to it. The ONE reading
   * of the rules: every route checks it before writing (and its write decides
   * again under the row's lock), and `actions` (TaskService.get) is read from
   * it, so what the page offers cannot drift from what the routes accept.
   * The state machine is nextState's.
   */
  private async rulesFor(viewer: Viewer, row: Row): Promise<TaskRules> {
    const mine = isAssignee(viewer, row);
    const decide = row.standing === 'manager' || row.standing === 'super_admin';
    // A department's manager hands their own task on (plan §3.7 amendment).
    const handsOwn = !decide && mine && (await this.managesDepartment(viewer));
    const followsSource = !!row.source_type && NOT_REASSIGNABLE.has(row.source_type);
    // PR-2b: the super admin hands on a financial task whose assignee left with
    // nobody live to follow; the sweep moves it to its owner again later.
    const orphaned = followsSource && viewer.superAdmin && FINANCIAL.has(row.source_type as SourceType)
      && !(await this.isLive(viewer.organizationId, assigneeOf(row)));
    return {
      mine,
      decide,
      complete: mine && row.kind === 'manual',
      acknowledge: mine && row.kind === 'system' && row.source_state === 'withdrawn',
      outOfScope: mine,
      comment: mine || decide,
      reassign: !decide && !handsOwn ? 'not_responsible' : followsSource && !orphaned ? 'follows_source' : 'yes',
    };
  }

  /** `rulesFor`, as the actions this viewer may take now (TaskService.get). */
  private async actionsFor(viewer: Viewer, row: Row): Promise<TaskActionName[]> {
    const r = await this.rulesFor(viewer, row);
    const can = (action: TaskAction) => nextState(row.state, action) !== null;
    const out: TaskActionName[] = [];
    if (r.complete && can('complete')) out.push('complete');
    if (r.acknowledge && can('complete')) out.push('acknowledge');
    if (r.outOfScope && can('out_of_scope')) out.push('out_of_scope');
    if (r.comment && can('comment')) out.push('comment');
    if (r.decide && can('return')) out.push('return');
    if (r.decide && can('remove')) out.push('remove');
    if (r.reassign === 'yes' && can('reassign')) out.push('reassign');
    if (r.decide && can('due')) out.push('due');
    if (r.decide && can('priority')) out.push('priority');
    return out;
  }

  private async managesDepartment(viewer: Viewer): Promise<boolean> {
    if (viewer.kind !== 'staff') return false;
    const [r] = await this.prisma.$queryRaw<Array<{ ok: boolean }>>`
      SELECT EXISTS (SELECT 1 FROM chat.department d
                      WHERE d.manager_id = ${viewer.id}::uuid AND d.organization_id = ${viewer.organizationId}::uuid) AS ok`;
    return r?.ok === true;
  }

  /** `{ kind, id }` or `{ department }` (that department's manager). */
  private async targetOf(viewer: Viewer, v: unknown): Promise<{ principal: Principal; department: string | null }> {
    if (v && typeof v === 'object' && 'department' in v) {
      const kind = (v as Record<string, unknown>).department;
      if (typeof kind !== 'string' || !(DEPARTMENT_KINDS as readonly string[]).includes(kind)) {
        throw invalid('to.department: operations, teachers or sales');
      }
      const [d] = await this.prisma.$queryRaw<Array<{ manager_id: string | null }>>`
        SELECT manager_id::text AS manager_id FROM chat.department
         WHERE organization_id = ${viewer.organizationId}::uuid AND kind = ${kind}
         ORDER BY id LIMIT 1`;
      if (!d?.manager_id) throw invalid(`to.department: the ${kind} department has no manager`);
      return { principal: { kind: 'staff', id: d.manager_id }, department: kind };
    }
    return { principal: principalOf(v, 'to'), department: null };
  }

  private async visible(viewer: Viewer, taskId: string): Promise<Row> {
    if (!isUuid(taskId)) throw notFound();
    const row = await this.load(viewer, taskId).catch((e: unknown) => {
      if (e instanceof CommError && e.code === CommErrorCode.TASK_NOT_FOUND) return null;
      throw e;
    });
    if (!row || !(isAssignee(viewer, row) || row.standing !== null)) throw notFound();
    return row;
  }

  private async forAssignee(actorId: string, taskId: string, action: TaskAction): Promise<{ viewer: Viewer; row: Row; rules: TaskRules }> {
    const viewer = await this.requireViewer(actorId);
    const row = await this.visible(viewer, taskId);
    const rules = await this.rulesFor(viewer, row);
    if (!rules.mine) {
      throw denied(action === 'complete' ? 'only the assignee completes a task' : 'only the assignee says a task is outside their responsibility');
    }
    return { viewer, row, rules };
  }

  private async forDecider(actorId: string, taskId: string): Promise<{ viewer: Viewer; row: Row }> {
    const viewer = await this.requireViewer(actorId);
    const row = await this.visible(viewer, taskId);
    if (!(await this.rulesFor(viewer, row)).decide) {
      throw denied('a task is removed, returned, reassigned, re-dated or re-prioritised by the responsible manager or the super admin');
    }
    return { viewer, row };
  }

  /** A write the database records as `actorId`'s (chat.task_actor), with its reason or instructions (chat.task_note). */
  private async asActor<T>(actorId: string, note: string | null, fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    try {
      return await this.prisma.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT set_config('chat.task_actor', ${actorId}, true), set_config('chat.task_note', ${note ?? ''}, true)`;
        return fn(tx);
      });
    } catch (e) {
      if (e instanceof CommError) throw e;
      // The database's own refusals (chat.guard_work_task), named.
      const message = String((e as Error).message ?? '');
      if (/a closed task stays closed|a task moves only by its four exits/.test(message)) throw wrongState('this task cannot move that way');
      const refused = /(a task is (?:re)?assigned to [^"`\n]*of its organization)/.exec(message);
      if (refused) throw invalid(refused[1]);
      throw e;
    }
  }

  /** `asOf` from the cursor (a later page), or the database's now; and the academy's zone. */
  private async clock(asOf?: string): Promise<Clock> {
    const [c] = await this.prisma.$queryRaw<Array<{ as_of: string; zone: string }>>`
      SELECT coalesce(${asOf ?? null}::timestamptz, now())::text AS as_of, chat.work_task_academy_zone() AS zone`;
    return { asOf: c.as_of, zone: c.zone };
  }

  private async load(viewer: Viewer, id: string): Promise<Row> {
    const [row] = await this.rows(viewer, Prisma.sql`t.organization_id = ${viewer.organizationId}::uuid AND t.id = ${id}::uuid`, await this.clock());
    if (!row) throw notFound();
    return row;
  }

  private rows(viewer: Viewer, where: Prisma.Sql, clock: Clock, order: Order = 'urgency', outer: Prisma.Sql = Prisma.sql`true`, limit = PAGE) {
    const orderBy =
      order === 'urgency'
        ? Prisma.sql`ORDER BY r.k1, r.k2, r.k3, coalesce(r.due_at, 'infinity'::timestamptz), r.created_at, r.id::uuid`
        : Prisma.sql`ORDER BY r.closed_at DESC, r.id::uuid DESC`;
    return this.prisma.$queryRaw<Row[]>`
      SELECT * FROM (
      SELECT t.id::text AS id, t.kind, t.state, t.outcome,
             t.assignee_staff_id::text AS assignee_staff_id, t.assignee_teacher_id::text AS assignee_teacher_id,
             coalesce(a.name, ta.name) AS assignee_name,
             coalesce(a.is_active AND a.left_at IS NULL, ta.is_active AND ta.left_at IS NULL, false) AS assignee_live,
             t.title, t.body, t.due_at, t.instructions,
             t.created_by::text AS created_by, cb.name AS creator_name,
             t.created_at, t.created_at::text AS created_at_key, t.updated_at, t.activity_at,
             t.closed_by::text AS closed_by, coalesce(xs.name, xt.name) AS closer_name, t.closed_at, t.close_reason,
             t.revision,
             (SELECT count(*)::int FROM chat.work_task_event e WHERE e.task_id = t.id AND e.kind = 'out_of_scope') AS disputed,
             ${UNMANAGED} AS unmanaged,
             ${this.standingSql(viewer)} AS standing,
             t.priority, t.category, e.level AS eff_level, e.reason AS eff_reason, e.overdue AS eff_overdue,
             t.source_type, t.source_id::text AS source_id, t.source_state,
             CASE t.source_type
               WHEN 'leave_decision' THEN (SELECT q.teacher_id::text FROM chat.teacher_leave_request q WHERE q.id = t.source_id)
               WHEN 'violation_decision' THEN (SELECT q.teacher_id::text FROM chat.teacher_violation q WHERE q.id = t.source_id)
               WHEN 'lesson_ruling' THEN (SELECT l.teacher_id::text FROM chat.lesson_ruling q JOIN chat.lesson l ON l.id = q.lesson_id WHERE q.id = t.source_id)
             END AS source_teacher_id,
             CASE t.source_type
               WHEN 'lesson_report' THEN (SELECT jsonb_build_object('learnerName', ln.name, 'startsAt', l.starts_at, 'lessonId', l.id)
                                            FROM chat.lesson l JOIN chat.learner ln ON ln.id = l.learner_id WHERE l.id = t.source_id)
               WHEN 'report_correction' THEN (SELECT jsonb_build_object('learnerName', ln.name, 'startsAt', l.starts_at, 'lessonId', l.id)
                                                FROM chat.report_correction_request q JOIN chat.lesson l ON l.id = q.lesson_id
                                                JOIN chat.learner ln ON ln.id = l.learner_id WHERE q.id = t.source_id)
               WHEN 'lesson_ruling' THEN (SELECT jsonb_build_object('learnerName', ln.name, 'startsAt', l.starts_at, 'lessonId', l.id)
                                            FROM chat.lesson_ruling q JOIN chat.lesson l ON l.id = q.lesson_id
                                            JOIN chat.learner ln ON ln.id = l.learner_id WHERE q.id = t.source_id)
               WHEN 'leave_decision' THEN (SELECT jsonb_build_object('teacherName', te.name, 'firstDay', q.first_day, 'lastDay', q.last_day)
                                             FROM chat.teacher_leave_request q JOIN chat.teacher te ON te.id = q.teacher_id WHERE q.id = t.source_id)
               WHEN 'violation_decision' THEN (SELECT jsonb_build_object('teacherName', te.name, 'kind', q.kind)
                                                 FROM chat.teacher_violation q JOIN chat.teacher te ON te.id = q.teacher_id WHERE q.id = t.source_id)
               WHEN 'case' THEN (SELECT jsonb_build_object('caseTitle', c.title) FROM chat.supervision_case c WHERE c.id = t.source_id)
               WHEN 'instalment' THEN (SELECT jsonb_build_object('label', i.label, 'amountMinor', i.amount_minor, 'currency', i.currency,
                                                                 'dueDate', i.due_date, 'learnerName', ln.name, 'familyName', f.display_name,
                                                                 'learnerId', i.learner_id)
                                         FROM chat.family_instalment i JOIN chat.family f ON f.id = i.family_id
                                         LEFT JOIN chat.learner ln ON ln.id = i.learner_id WHERE i.id = t.source_id)
               WHEN 'package_low' THEN (SELECT jsonb_build_object('learnerName', ln.name, 'balance', a.balance, 'learnerId', e.learner_id)
                                          FROM chat.work_task_package_episode e JOIN chat.learner ln ON ln.id = e.learner_id
                                          LEFT JOIN chat.learner_access a ON a.learner_id = e.learner_id WHERE e.id = t.source_id)
               WHEN 'renewal_request' THEN (SELECT jsonb_build_object('learnerName', ln.name, 'balance', a.balance, 'learnerId', e.learner_id)
                                              FROM chat.work_task_package_episode e JOIN chat.learner ln ON ln.id = e.learner_id
                                              LEFT JOIN chat.learner_access a ON a.learner_id = e.learner_id WHERE e.id = t.source_id)
               WHEN 'receipt_review' THEN (SELECT jsonb_build_object('familyName', f.display_name, 'amountMinor', r.amount_minor, 'currency', r.currency)
                                             FROM chat.payment_receipt r JOIN chat.family f ON f.id = r.family_id WHERE r.id = t.source_id)
               WHEN 'checkout_failed' THEN (SELECT jsonb_build_object('label', q.label, 'amountMinor', q.amount_minor, 'currency', q.currency,
                                                                      'familyName', f.display_name)
                                              FROM chat.payment_request q LEFT JOIN chat.family f ON f.id = q.family_id WHERE q.id = t.source_id)
             END AS title_params,
             -e.rank AS k1,
             CASE WHEN t.category = 'financial' THEN 0 ELSE 1 END AS k2,
             CASE WHEN t.due_at IS NULL THEN 1 ELSE 0 END AS k3,
             -- 'infinity' sorts the undated last; it stays text here because
             -- the client driver cannot decode an infinite timestamp.
             coalesce(t.due_at, 'infinity'::timestamptz)::text AS k4_key,
             t.closed_at::text AS closed_at_key
        FROM chat.work_task t
        CROSS JOIN LATERAL chat.work_task_effective(t.priority, t.floor_rule, t.due_at, t.source_floor, t.state,
                                                     ${clock.asOf}::timestamptz, ${clock.zone}) e
        LEFT JOIN chat.staff a ON a.id = t.assignee_staff_id
        LEFT JOIN chat.teacher ta ON ta.id = t.assignee_teacher_id
        LEFT JOIN chat.staff cb ON cb.id = t.created_by
        LEFT JOIN chat.staff xs ON xs.id = t.closed_by
        LEFT JOIN chat.teacher xt ON xt.id = t.closed_by
       WHERE ${where}
      ) r
      WHERE ${outer}
      ${orderBy}
      LIMIT ${limit}`;
  }

  private summary(r: Row) {
    return {
      id: r.id,
      kind: r.kind,
      state: r.state,
      outcome: r.outcome,
      assignee: assigneeOf(r),
      assigneeName: r.assignee_name ?? '',
      /** The assignee is no longer active (owner Q11): the task stays theirs until a manager reassigns it. */
      needsReassignment: !r.assignee_live,
      /** No live manager stands to it (the assignee left their department, their manager is gone, or they are a manager): only the super admin can move it. */
      unmanaged: r.unmanaged,
      title: r.title ?? '',
      body: r.body,
      dueAt: r.due_at?.toISOString() ?? null,
      instructions: r.instructions,
      disputedCount: r.disputed,
      createdBy: r.created_by ? { id: r.created_by, name: r.creator_name ?? '' } : null,
      createdAt: r.created_at.toISOString(),
      updatedAt: r.updated_at.toISOString(),
      activityAt: r.activity_at.toISOString(),
      closedBy: r.closed_by ? { id: r.closed_by, name: r.closer_name ?? '' } : null,
      closedAt: r.closed_at?.toISOString() ?? null,
      closeReason: r.close_reason,
      revision: r.revision,
      /** PD-47 priority: what a person set, what the server computed, and what raised it. */
      manualPriority: r.priority,
      effectivePriority: r.eff_level,
      priorityReason: r.eff_reason,
      /** Past its deadline by its floor rule, whatever raised the level (a manual High task can be overdue too). */
      overdue: r.eff_overdue,
      category: r.category,
      /**
       * PD-47 PR-2: a system task names its source; its title is the client's
       * words for `titleKey` with `titleParams`, read from the source now.
       * `sourceState: withdrawn` means the work no longer exists: the assignee
       * acknowledges it, or a manager removes it.
       */
      source: r.source_type ? { type: r.source_type, id: r.source_id as string } : null,
      sourceState: r.source_state,
      titleKey: r.source_type ? `task.${r.source_type}` : null,
      titleParams: r.title_params,
    };
  }
}

const UNMANAGED = Prisma.sql`chat.work_task_unmanaged(t.organization_id, t.assignee_staff_id, t.assignee_teacher_id, t.created_by)`;

function assigneeOf(r: Pick<Row, 'assignee_staff_id' | 'assignee_teacher_id'>): Principal {
  return r.assignee_staff_id ? { kind: 'staff', id: r.assignee_staff_id } : { kind: 'teacher', id: r.assignee_teacher_id as string };
}

function isAssignee(viewer: Viewer, r: Row): boolean {
  return viewer.kind === 'staff' ? r.assignee_staff_id === viewer.id : r.assignee_teacher_id === viewer.id;
}

function mineSql(viewer: Viewer): Prisma.Sql {
  return viewer.kind === 'staff' ? Prisma.sql`t.assignee_staff_id = ${viewer.id}::uuid` : Prisma.sql`t.assignee_teacher_id = ${viewer.id}::uuid`;
}

type Order = 'urgency' | 'closed';
/** The cursor's key shapes: what Postgres prints for an int, a timestamptz and a uuid. */
const INT = /^-?\d{1,3}$/;
const MOMENT = /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(\.\d{1,6})?([+-]\d{2}(:?\d{2})?|Z)$/;
const MOMENT_OR_INFINITY = /^(infinity|\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(\.\d{1,6})?([+-]\d{2}(:?\d{2})?|Z))$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
interface Cursor {
  order: Order;
  asOf: string;
  keys: string[];
}

/** The last row's sort keys, and the page's asOf, opaque to the client. */
function cursorFor(r: Row, order: Order, asOf: string): string {
  const keys = order === 'urgency'
    ? [String(r.k1), String(r.k2), String(r.k3), r.k4_key, r.created_at_key, r.id]
    : [r.closed_at_key ?? '', r.id];
  return Buffer.from(JSON.stringify({ o: order, a: asOf, k: keys })).toString('base64url');
}

function cursorOf(cursor: string | undefined, order: Order): Cursor | null {
  if (cursor === undefined || cursor === '') return null;
  let parsed: { o?: unknown; a?: unknown; k?: unknown };
  try {
    parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
  } catch {
    throw invalid('cursor');
  }
  // Every key is checked here, so a forged or truncated cursor is a 400, never a cast error.
  const keys = parsed.k;
  const shape = order === 'urgency' ? [INT, INT, INT, MOMENT_OR_INFINITY, MOMENT, UUID] : [MOMENT, UUID];
  const ok =
    parsed.o === order &&
    typeof parsed.a === 'string' && MOMENT.test(parsed.a) &&
    Array.isArray(keys) && keys.length === shape.length &&
    keys.every((x, i) => typeof x === 'string' && shape[i].test(x));
  if (!ok) throw invalid('cursor');
  return { order, asOf: parsed.a as string, keys: keys as string[] };
}

/** Keyset paging: everything after the cursor in the list's own order. */
function afterSql(c: Cursor | null): Prisma.Sql {
  if (!c) return Prisma.sql`true`;
  const k = c.keys;
  return c.order === 'urgency'
    ? Prisma.sql`(r.k1, r.k2, r.k3, coalesce(r.due_at, 'infinity'::timestamptz), r.created_at, r.id::uuid)
                 > (${k[0]}::int, ${k[1]}::int, ${k[2]}::int, ${k[3]}::timestamptz, ${k[4]}::timestamptz, ${k[5]}::uuid)`
    : Prisma.sql`(r.closed_at, r.id::uuid) < (${k[0]}::timestamptz, ${k[1]}::uuid)`;
}

function levelField(v: unknown, field: string): Level | null {
  if (v === undefined || v === null || v === '') return null;
  if (typeof v !== 'string' || !(LEVELS as readonly string[]).includes(v)) throw invalid(`${field}: high, medium or low`);
  return v as Level;
}

function categoryField(v: unknown): Category | null {
  if (v === undefined || v === null || v === '') return null;
  if (typeof v !== 'string' || !(CATEGORIES as readonly string[]).includes(v)) throw invalid('category: financial or operational');
  return v as Category;
}

function principalOf(v: unknown, field: string): Principal {
  if (!v || typeof v !== 'object') throw invalid(`${field}: { kind, id }`);
  const { kind, id } = v as Record<string, unknown>;
  if (kind !== 'staff' && kind !== 'teacher') throw invalid(`${field}.kind: staff or teacher`);
  if (typeof id !== 'string' || !isUuid(id)) throw invalid(`${field}.id: a uuid`);
  return { kind, id };
}

/** An ISO timestamp with its zone; null or '' clears; undefined is none. */
function dueField(v: unknown): string | null {
  if (v === undefined || v === null || v === '') return null;
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}T.+(Z|[+-]\d{2}:?\d{2})$/.test(v) || Number.isNaN(Date.parse(v))) {
    throw invalid('dueAt: an ISO timestamp with its zone');
  }
  return new Date(v).toISOString();
}

function text(v: unknown, field: string, max: number, required: boolean): string | null {
  if (v === undefined || v === null) {
    if (required) throw invalid(`${field}: required`);
    return null;
  }
  if (typeof v !== 'string') throw invalid(`${field}: text`);
  const t = v.trim();
  if (!t) {
    if (required) throw invalid(`${field}: required`);
    return null;
  }
  if (t.length > max) throw invalid(`${field}: at most ${max} characters`);
  return t;
}
