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

  /** { assignee: { kind: 'staff' | 'teacher', id }, title, body?, dueAt? } */
  async create(actorId: string, body: Record<string, unknown>) {
    const viewer = await this.requireViewer(actorId);
    if (viewer.kind !== 'staff') throw denied('teachers do not create tasks');
    const assignee = principalOf(body.assignee, 'assignee');
    const title = text(body.title, 'title', TITLE_MAX, true) as string;
    const detail = text(body.body, 'body', BODY_MAX, false);
    const dueAt = dueField(body.dueAt);
    await this.requireLive(viewer.organizationId, assignee);
    const standing = await this.standingTo(viewer, assignee);
    const allowed =
      standing === 'super_admin' || standing === 'manager' || (standing === 'supervisor' && assignee.kind === 'teacher');
    if (!allowed) throw denied('a task is given by the assignee\'s manager, a teacher\'s supervisor, or the super admin');

    const id = await this.asActor(viewer.id, null, async (tx) => {
      const [row] = await tx.$queryRaw<Array<{ id: string; revision: number }>>`
        INSERT INTO chat.work_task (organization_id, kind, assignee_staff_id, assignee_teacher_id, title, body, due_at, created_by)
        VALUES (${viewer.organizationId}::uuid, 'manual',
                ${assignee.kind === 'staff' ? assignee.id : null}::uuid, ${assignee.kind === 'teacher' ? assignee.id : null}::uuid,
                ${title}, ${detail}, ${dueAt}::timestamptz, ${viewer.id}::uuid)
        RETURNING id::text AS id, revision`;
      await this.signal(tx, row.id, row.revision, 'created');
      return row.id;
    });
    return this.summary(await this.load(viewer, id));
  }

  /** ?view=mine|team|decisions|all &state=open|closed &cursor */
  async list(actorId: string, query: { view: string; state?: string; cursor?: string }) {
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
    const after = cursorSql(query.cursor);
    const rows = await this.rows(viewer, Prisma.sql`t.organization_id = ${viewer.organizationId}::uuid AND ${scope} AND ${states} AND ${after}`);
    const last = rows.length === PAGE ? rows[rows.length - 1] : undefined;
    return {
      items: rows.map((r) => this.summary(r)),
      nextCursor: last ? Buffer.from(`${last.created_at_key}|${last.id}`).toString('base64url') : null,
    };
  }

  /** The task and its whole history. */
  async get(actorId: string, taskId: string) {
    const viewer = await this.requireViewer(actorId);
    const row = await this.visible(viewer, taskId);
    const events = await this.prisma.$queryRaw<EventRow[]>`
      SELECT e.id::text AS id, e.kind, e.actor_kind, e.actor_id::text AS actor_id,
             coalesce(s.name, te.name) AS actor_name,
             e.from_assignee::text AS from_assignee, e.to_assignee::text AS to_assignee, e.body, e.at
        FROM chat.work_task_event e
        LEFT JOIN chat.staff s ON e.actor_kind = 'staff' AND s.id = e.actor_id
        LEFT JOIN chat.teacher te ON e.actor_kind = 'teacher' AND te.id = e.actor_id
       WHERE e.task_id = ${row.id}::uuid
       ORDER BY e.at, e.id`;
    return {
      ...this.summary(row),
      history: events.map((e) => ({
        id: e.id,
        kind: e.kind,
        actor: e.actor_id ? { kind: e.actor_kind, id: e.actor_id, name: e.actor_name ?? '' } : null,
        fromAssigneeId: e.from_assignee,
        toAssigneeId: e.to_assignee,
        body: e.body,
        at: e.at.toISOString(),
      })),
    };
  }

  /** Exit 1, a manual task: the assignee says it is done. { note? } */
  async complete(actorId: string, taskId: string, body: Record<string, unknown>) {
    const { viewer, row } = await this.forAssignee(actorId, taskId, 'complete');
    if (row.kind !== 'manual') throw denied('a system task is completed by doing its work');
    const note = text(body.note, 'note', NOTE_MAX, false);
    return this.move(viewer, row, 'complete', note, Prisma.sql`state = 'completed', outcome = 'done'`, 'completed', mineSql(viewer));
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
    const decider = row.standing === 'manager' || row.standing === 'super_admin';
    const handsOwn = !decider && isAssignee(viewer, row) && (await this.managesDepartment(viewer));
    if (!decider && !handsOwn) {
      throw denied('a task is reassigned by the responsible manager, the super admin, or a department manager it was sent to');
    }
    const instructions = text(body.instructions, 'instructions', NOTE_MAX, false);
    const to = await this.targetOf(viewer, body.to);
    await this.requireLive(viewer.organizationId, to.principal);
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
    return this.move(viewer, row, 'reassign', instructions, set, 'reassigned', Prisma.sql`${who} AND ${target}`);
  }

  /** { dueAt: ISO timestamp | null }: the responsible manager or the super admin. */
  async setDue(actorId: string, taskId: string, body: Record<string, unknown>) {
    const { viewer, row } = await this.forDecider(actorId, taskId);
    const dueAt = dueField(body.dueAt);
    if ((row.due_at?.toISOString() ?? null) === dueAt) throw invalid('dueAt: unchanged');
    return this.move(viewer, row, 'due', null, Prisma.sql`due_at = ${dueAt}::timestamptz`, 'due_changed', this.deciderSql(viewer));
  }

  /**
   * The assignee, a responsible manager or the super admin. It changes nothing
   * but the history. A teacher's supervisor reads the task and stays silent
   * (owner Q3: read-only). { body }
   */
  async comment(actorId: string, taskId: string, body: Record<string, unknown>) {
    const viewer = await this.requireViewer(actorId);
    const row = await this.visible(viewer, taskId);
    if (!isAssignee(viewer, row) && row.standing !== 'manager' && row.standing !== 'super_admin') {
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
   *   a department's      tasks.team_open, tasks.team_overdue           (view=team)
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
      }>
    >`
      SELECT (${sa}::boolean OR EXISTS (
                SELECT 1 FROM chat.department d WHERE d.manager_id = ${viewer.id}::uuid AND d.organization_id = ${viewer.organizationId}::uuid)) AS manages,
             count(*)::int AS scanned,
             count(*) FILTER (WHERE x.mine)::int AS mine,
             min(x.created_at) FILTER (WHERE x.mine) AS mine_oldest,
             count(*) FILTER (WHERE x.mine AND x.due_at < now())::int AS mine_overdue,
             count(*) FILTER (WHERE x.wide)::int AS wide,
             min(x.created_at) FILTER (WHERE x.wide) AS wide_oldest,
             count(*) FILTER (WHERE x.wide AND x.due_at < now())::int AS wide_overdue,
             count(*) FILTER (WHERE x.decides AND (x.state = 'awaiting_decision' OR x.unmanaged))::int AS decisions,
             min(x.created_at) FILTER (WHERE x.decides AND (x.state = 'awaiting_decision' OR x.unmanaged)) AS decisions_oldest,
             count(*) FILTER (WHERE x.wide AND NOT x.live)::int AS gone,
             count(*) FILTER (WHERE x.unmanaged)::int AS unmanaged
        FROM (
          SELECT t.created_at, t.due_at, t.state,
                 ${mineSql(viewer)} AS mine,
                 ${wide} AS wide,
                 ${this.deciderSql(viewer)} AS decides,
                 ${unmanaged} AS unmanaged,
                 coalesce(a.is_active AND a.left_at IS NULL, ta.is_active AND ta.left_at IS NULL, false) AS live
            FROM chat.work_task t
            LEFT JOIN chat.staff a ON a.id = t.assignee_staff_id
            LEFT JOIN chat.teacher ta ON ta.id = t.assignee_teacher_id
           WHERE t.organization_id = ${viewer.organizationId}::uuid
             AND t.state IN ('open', 'awaiting_decision')
           ORDER BY t.created_at DESC
           LIMIT ${TILE_SCAN}
        ) x`;
    const capped = (r?.scanned ?? 0) >= TILE_SCAN;
    const tiles = [
      dashboardTile('tasks.mine_open', r?.mine ?? 0, r?.mine_oldest ?? null, capped),
      dashboardTile('tasks.mine_overdue', r?.mine_overdue ?? 0, null, capped),
    ];
    if (r?.manages) {
      const scope = sa ? 'all' : 'team';
      tiles.push(
        dashboardTile(`tasks.${scope}_open`, r.wide, r.wide_oldest, capped),
        dashboardTile(`tasks.${scope}_overdue`, r.wide_overdue, null, capped),
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

  private async requireLive(org: string, p: Principal) {
    const [r] = await this.prisma.$queryRaw<Array<{ kind: string | null }>>`
      SELECT chat.task_principal_kind(${p.id}::uuid, ${org}::uuid) AS kind`;
    if (r?.kind !== p.kind) throw invalid(`${p.kind}: a live person of this organization`);
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

  private async forAssignee(actorId: string, taskId: string, action: TaskAction): Promise<{ viewer: Viewer; row: Row }> {
    const viewer = await this.requireViewer(actorId);
    const row = await this.visible(viewer, taskId);
    if (!isAssignee(viewer, row)) {
      throw denied(action === 'complete' ? 'only the assignee completes a task' : 'only the assignee says a task is outside their responsibility');
    }
    return { viewer, row };
  }

  private async forDecider(actorId: string, taskId: string): Promise<{ viewer: Viewer; row: Row }> {
    const viewer = await this.requireViewer(actorId);
    const row = await this.visible(viewer, taskId);
    if (row.standing !== 'manager' && row.standing !== 'super_admin') {
      throw denied('a task is removed, returned or reassigned by the responsible manager or the super admin');
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

  private async load(viewer: Viewer, id: string): Promise<Row> {
    const [row] = await this.rows(viewer, Prisma.sql`t.organization_id = ${viewer.organizationId}::uuid AND t.id = ${id}::uuid`);
    if (!row) throw notFound();
    return row;
  }

  private rows(viewer: Viewer, where: Prisma.Sql) {
    return this.prisma.$queryRaw<Row[]>`
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
             ${this.standingSql(viewer)} AS standing
        FROM chat.work_task t
        LEFT JOIN chat.staff a ON a.id = t.assignee_staff_id
        LEFT JOIN chat.teacher ta ON ta.id = t.assignee_teacher_id
        LEFT JOIN chat.staff cb ON cb.id = t.created_by
        LEFT JOIN chat.staff xs ON xs.id = t.closed_by
        LEFT JOIN chat.teacher xt ON xt.id = t.closed_by
       WHERE ${where}
       ORDER BY t.created_at DESC, t.id DESC
       LIMIT ${PAGE}`;
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

/** Keyset paging on (created_at to the microsecond, id), newest first. */
function cursorSql(cursor: string | undefined): Prisma.Sql {
  if (cursor === undefined || cursor === '') return Prisma.sql`true`;
  const [at, id] = Buffer.from(cursor, 'base64url').toString('utf8').split('|');
  if (!at || !id || !isUuid(id) || Number.isNaN(Date.parse(at))) throw invalid('cursor');
  return Prisma.sql`(t.created_at, t.id) < (${at}::timestamptz, ${id}::uuid)`;
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
