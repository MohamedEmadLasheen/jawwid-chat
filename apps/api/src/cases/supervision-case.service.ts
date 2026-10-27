import { Inject, Injectable, Optional } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../platform/prisma.service';
import { AuthorizationService } from '../platform/authorization.service';
import { CommError, CommErrorCode } from '../platform/errors';
import { AUDIT_SERVICE, REALTIME_REVOCATION } from '../platform/tokens';
import { NO_REALTIME_REVOCATION, type RealtimeRevocation } from '../platform/realtime-revocation';
import type { AuditService } from '../platform/audit.service';
import type { Actor } from '../platform/types';
import { ConversationService, isUuid } from '../communication/conversations/conversation.service';
import { OutboxService } from '../communication/outbox/outbox.service';
import { CommEvent } from '../communication/contracts/events';
import { ActorKind, CardKind, StaffRole } from '../communication/contracts/vocab';
import { LessonService, type Tx } from '../lessons/lesson.service';
import { ParentFeedbackService } from '../teacher-file/parent-feedback.service';
import { DepartmentRoomService, type RoomChange } from '../org/department-room.service';
import { CardPoster } from '../supervision/card-poster';

export const CASE_SUBJECTS = ['teacher', 'lesson', 'learner', 'complaint', 'feedback'] as const;
export type CaseSubjectKind = (typeof CASE_SUBJECTS)[number];
export const CASE_TARGETS = ['teachers', 'operations'] as const;
export type CaseTarget = (typeof CASE_TARGETS)[number];
export type CaseStatus = 'open' | 'in_progress' | 'resolved' | 'cancelled';

const TITLE_MAX = 200;
const BODY_MAX = 4000;
const NOTE_MAX = 2000;
const LIST_LIMIT = 200;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const invalid = (why: string) => new CommError(CommErrorCode.CASE_INVALID, why, 400);
const notFound = () => new CommError(CommErrorCode.CASE_NOT_FOUND, 'case not found');
const denied = () => new CommError(CommErrorCode.CASE_DENIED, 'a case is moved on by its owner, the department\'s manager or the super admin');
const closed = (why = 'this case is closed') => new CommError(CommErrorCode.CASE_STATE, why, 409);

interface Row {
  id: string;
  organization_id: string;
  title: string;
  body: string | null;
  status: CaseStatus;
  subject_kind: CaseSubjectKind;
  subject_id: string;
  target: CaseTarget;
  target_department_id: string;
  target_manager_id: string | null;
  teacher_id: string | null;
  teacher_name: string | null;
  learner_id: string | null;
  learner_name: string | null;
  lesson_starts_at: Date | null;
  owner_id: string | null;
  owner_name: string | null;
  /** The owner still fits, now (chat.case_owner_fits: in the department, and in scope of the subject). */
  owner_fits: boolean;
  opened_by: string;
  opener_name: string;
  due_on: string | null;
  created_at: Date;
  updated_at: Date;
  closed_at: Date | null;
}

/**
 * PD-35 B5: escalation cases -- what a supervisor cannot settle alone, sent to
 * the Teachers or the Operations department (chat.supervision_case).
 *
 *   open   anyone with teacher or lesson scope on the subject: a teacher, a
 *          complaint or a parent's feedback (PD-35's teacher scope); a lesson or
 *          a learner (PD-11's lesson standing -- the teacher's department, the
 *          child's PD-8 supervisor and their managers). Outside it the subject
 *          reads as not found. The owner defaults to the target's manager.
 *   see    the opener, the owner, the target department's manager, the super
 *          admin. Anyone else: not found.
 *   act    the owner, the target department's manager, the super admin.
 *
 * The database writes the history (one chat.supervision_case_event per change,
 * actor from chat.case_actor) and refuses what it can know by itself. PD-34
 * delivers: this only enqueues case.opened / case.assigned / case.due_soon.
 */
@Injectable()
export class SupervisionCaseService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly conversations: ConversationService,
    private readonly lessons: LessonService,
    private readonly authz: AuthorizationService,
    private readonly outbox: OutboxService,
    @Inject(AUDIT_SERVICE) private readonly audit: AuditService,
    // A parent's feedback is read only in src/teacher-file (PD-32): asked here for its ids.
    private readonly feedback: ParentFeedbackService,
    // PD-35 B6: a new case is announced in its target department's room. Optional
    // for positional harness constructions: without them no card is posted.
    @Optional() private readonly rooms?: DepartmentRoomService,
    @Optional() private readonly cards?: CardPoster,
    @Optional()
    @Inject(REALTIME_REVOCATION)
    private readonly revocation: RealtimeRevocation = NO_REALTIME_REVOCATION,
  ) {}

  /** { subject: { kind, id }, target: 'teachers' | 'operations', title, body?, dueOn?, ownerId? } */
  async open(actorId: string, body: Record<string, unknown>) {
    const actor = await this.requireStaff(actorId);
    const org = actor.organizationId as string;
    const subject = subjectOf(body.subject);
    const target = body.target;
    if (typeof target !== 'string' || !(CASE_TARGETS as readonly string[]).includes(target)) {
      throw invalid('target: teachers or operations');
    }
    const title = text(body.title, 'title', TITLE_MAX, true) as string;
    const detail = text(body.body, 'body', BODY_MAX, false);
    const dueOn = await this.dueField(body.dueOn);
    await this.requireSubjectScope(actor, subject);

    const [dept] = await this.prisma.$queryRaw<Array<{ id: string; manager_id: string | null; manager_fits: boolean }>>`
      SELECT d.id::text AS id, d.manager_id::text AS manager_id,
             (d.manager_id IS NOT NULL AND chat.case_owner_fits(d.manager_id, d.id, NULL, NULL)) AS manager_fits
        FROM chat.department d
       WHERE d.organization_id = ${org}::uuid AND d.kind = ${target}
       ORDER BY d.id LIMIT 1`;
    if (!dept) throw invalid(`this organization has no ${target} department`);
    let ownerId: string | null = dept.manager_fits ? dept.manager_id : null;
    if (body.ownerId !== undefined && body.ownerId !== null) {
      if (typeof body.ownerId !== 'string' || !isUuid(body.ownerId)) throw invalid('ownerId: a uuid');
      // In the department here; the database also checks the subject's scope once it knows the subject.
      if (!(await this.ownerFits(body.ownerId, dept.id, null, null))) throw invalid('ownerId: someone in the target department');
      ownerId = body.ownerId;
    }

    let roomChange: RoomChange | null = null;
    const id = await this.asActor(actor.actorId, null, async (tx) => {
      const [row] = await tx.$queryRaw<Array<{ id: string; organization_id: string }>>`
        INSERT INTO chat.supervision_case (organization_id, subject_kind, subject_id, target_department_id, title, body, owner_id, due_on, opened_by)
        VALUES (${org}::uuid, ${subject.kind}, ${subject.id}::uuid, ${dept.id}::uuid, ${title}, ${detail},
                ${ownerId}::uuid, ${dueOn}::date, ${actor.actorId}::uuid)
        RETURNING id::text AS id, organization_id::text AS organization_id`;
      await this.outbox.enqueue(tx, CommEvent.CASE_OPENED, {
        caseId: row.id,
        organizationId: row.organization_id,
        targetDepartmentId: dept.id,
        ownerId,
        openedBy: actor.actorId,
      });
      roomChange = await this.announce(tx, actor, dept.id, row.id, ownerId);
      await this.audit.audit(tx, {
        actorId: actor.actorId,
        action: 'supervision_case.opened',
        entity: 'supervision_case',
        entityId: row.id,
        after: { subject, target, ownerId, dueOn },
        reason: title,
      });
      return row.id;
    });
    // RT-009: whom the room's sync took out leave its live room, after commit.
    const removed = (roomChange as RoomChange | null)?.removed ?? [];
    if (roomChange && removed.length > 0) {
      this.revocation.leaveConversation(removed, (roomChange as RoomChange).conversationId);
      await this.revocation.confirmRevoked();
    }
    return this.summary(await this.load(org, id));
  }

  /** ?tab=mine|opened|department &status=open|closed|all */
  async list(actorId: string, query: { tab?: string; status?: string }) {
    const actor = await this.requireStaff(actorId);
    const tab = query.tab ?? 'mine';
    if (!['mine', 'opened', 'department'].includes(tab)) throw invalid('tab: mine, opened or department');
    const status = query.status ?? 'open';
    if (!['open', 'closed', 'all'].includes(status)) throw invalid('status: open, closed or all');
    const me = actor.actorId;
    const superAdmin = actor.staffRole === StaffRole.SUPER_ADMIN;
    const where = Prisma.sql`c.organization_id = ${actor.organizationId}::uuid AND ${
      tab === 'mine'
        ? Prisma.sql`c.owner_id = ${me}::uuid AND chat.case_owner_fits(c.owner_id, c.target_department_id, c.teacher_id, c.learner_id)`
        : tab === 'opened'
          ? Prisma.sql`c.opened_by = ${me}::uuid`
          : superAdmin
            ? Prisma.sql`true`
            : Prisma.sql`d.manager_id = ${me}::uuid`
    } AND ${
      status === 'open'
        ? Prisma.sql`c.status IN ('open', 'in_progress')`
        : status === 'closed'
          ? Prisma.sql`c.status IN ('resolved', 'cancelled')`
          : Prisma.sql`true`
    }`;
    const rows = await this.rows(where);
    // "Opened by me" is the opener's while they still stand to the subject (R2).
    const shown = tab === 'opened' && !superAdmin
      ? (await Promise.all(rows.map(async (r) => ((await this.canSee(actor, r)) ? r : null)))).filter((r): r is Row => r !== null)
      : rows;
    return { cases: shown.map((r) => this.summary(r)) };
  }

  async get(actorId: string, caseId: string) {
    const actor = await this.requireStaff(actorId);
    const row = await this.visible(actor, caseId);
    const events = await this.prisma.$queryRaw<Array<{ id: string; kind: string; actor_id: string; actor_name: string; at: Date; note: string | null; before: unknown; after: unknown }>>`
      SELECT e.id::text AS id, e.kind, e.actor_id::text AS actor_id, s.name AS actor_name, e.at, e.note, e.before, e.after
        FROM chat.supervision_case_event e JOIN chat.staff s ON s.id = e.actor_id
       WHERE e.case_id = ${row.id}::uuid
       ORDER BY e.at, e.id`;
    return {
      ...this.summary(row),
      canAct: this.canAct(actor, row),
      events: events.map((e) => ({
        id: e.id,
        kind: e.kind,
        actor: { id: e.actor_id, name: e.actor_name },
        at: e.at.toISOString(),
        note: e.note,
        before: e.before ?? null,
        after: e.after ?? null,
      })),
    };
  }

  /** The people the case may be assigned to: the target department's manager and members. */
  async owners(actorId: string, caseId: string) {
    const actor = await this.requireStaff(actorId);
    const row = await this.visible(actor, caseId);
    if (!this.canAct(actor, row)) throw denied();
    const owners = await this.prisma.$queryRaw<Array<{ id: string; name: string }>>`
      SELECT s.id::text AS id, s.name
        FROM chat.staff s
       WHERE chat.case_owner_fits(s.id, ${row.target_department_id}::uuid, ${row.teacher_id}::uuid, ${row.learner_id}::uuid)
       ORDER BY s.name`;
    return { owners };
  }

  /** { ownerId } */
  async assign(actorId: string, caseId: string, body: Record<string, unknown>) {
    const { actor, row } = await this.forAct(actorId, caseId);
    const ownerId = body.ownerId;
    if (typeof ownerId !== 'string' || !isUuid(ownerId)) throw invalid('ownerId: a uuid');
    if (ownerId === row.owner_id) return this.get(actorId, caseId);
    if (!(await this.ownerFits(ownerId, row.target_department_id, row.teacher_id, row.learner_id))) {
      throw invalid('ownerId: someone in the target department who stands to the subject');
    }
    await this.asActor(actor.actorId, null, async (tx) => {
      await tx.$executeRaw`UPDATE chat.supervision_case SET owner_id = ${ownerId}::uuid WHERE id = ${row.id}::uuid`;
      await this.outbox.enqueue(tx, CommEvent.CASE_ASSIGNED, {
        caseId: row.id,
        organizationId: row.organization_id,
        ownerId,
        previousOwnerId: row.owner_id,
        assignedBy: actor.actorId,
      });
      await this.audit.audit(tx, {
        actorId: actor.actorId,
        action: 'supervision_case.assigned',
        entity: 'supervision_case',
        entityId: row.id,
        before: { ownerId: row.owner_id },
        after: { ownerId },
        reason: 'case assigned',
      });
    });
    return this.get(actorId, caseId);
  }

  /** { status: in_progress | resolved | cancelled, note? } -- closing needs a note. */
  async setStatus(actorId: string, caseId: string, body: Record<string, unknown>) {
    const { actor, row } = await this.forAct(actorId, caseId);
    const status = body.status;
    if (status !== 'in_progress' && status !== 'resolved' && status !== 'cancelled') {
      throw invalid('status: in_progress, resolved or cancelled');
    }
    const note = text(body.note, 'note', NOTE_MAX, false);
    if (row.status === 'resolved' || row.status === 'cancelled') throw closed();
    if (status === row.status) throw closed(`this case is already ${status}`);
    if (status !== 'in_progress' && !note) throw invalid('note: say how it was settled');
    await this.asActor(actor.actorId, note, async (tx) => {
      await tx.$executeRaw`UPDATE chat.supervision_case SET status = ${status} WHERE id = ${row.id}::uuid`;
      await this.audit.audit(tx, {
        actorId: actor.actorId,
        action: 'supervision_case.status',
        entity: 'supervision_case',
        entityId: row.id,
        before: { status: row.status },
        after: { status },
        reason: note ?? `case ${status}`,
      });
    });
    return this.get(actorId, caseId);
  }

  /** { dueOn: YYYY-MM-DD | null } */
  async setDue(actorId: string, caseId: string, body: Record<string, unknown>) {
    const { actor, row } = await this.forAct(actorId, caseId);
    if (!('dueOn' in body)) throw invalid('dueOn: a date, or null to clear it');
    const dueOn = await this.dueField(body.dueOn);
    if (row.status === 'resolved' || row.status === 'cancelled') throw closed();
    if (dueOn === row.due_on) return this.get(actorId, caseId);
    await this.asActor(actor.actorId, null, async (tx) => {
      await tx.$executeRaw`UPDATE chat.supervision_case SET due_on = ${dueOn}::date WHERE id = ${row.id}::uuid`;
    });
    return this.get(actorId, caseId);
  }

  /**
   * { note } -- on a live case, by whoever may act on it. On a closed case a
   * note is a post-mortem: the target department's manager and the super admin
   * only (the owner's part ended with the case).
   */
  async note(actorId: string, caseId: string, body: Record<string, unknown>) {
    const { actor, row } = await this.forAct(actorId, caseId);
    const note = text(body.note, 'note', NOTE_MAX, true) as string;
    if ((row.status === 'resolved' || row.status === 'cancelled')
        && actor.staffRole !== StaffRole.SUPER_ADMIN && row.target_manager_id !== actor.actorId) {
      throw closed('a closed case takes notes from the department\'s manager or the super admin only');
    }
    await this.prisma.$executeRaw`
      INSERT INTO chat.supervision_case_event (case_id, kind, actor_id, note)
      VALUES (${row.id}::uuid, 'note', ${actor.actorId}::uuid, ${note})`;
    return this.get(actorId, caseId);
  }

  /**
   * Cases due tomorrow or earlier, still open, whose due date was not announced
   * yet: one case.due_soon each, once per due date (a new date announces again).
   * Run by the worker.
   */
  async sweepDueSoon(): Promise<number> {
    return this.prisma.$transaction(async (tx) => {
      const due = await tx.$queryRaw<Array<{ id: string; organization_id: string; owner_id: string | null; due_on: string }>>`
        WITH due AS (
          SELECT c.id, c.organization_id, c.owner_id, c.due_on
            FROM chat.supervision_case c
           WHERE c.status IN ('open', 'in_progress') AND c.due_on IS NOT NULL
             AND c.due_on <= chat.academy_today() + 1
        ), fresh AS (
          INSERT INTO chat.supervision_case_due_notice (case_id, due_on)
          SELECT id, due_on FROM due
          ON CONFLICT DO NOTHING
          RETURNING case_id, due_on
        )
        SELECT d.id::text AS id, d.organization_id::text AS organization_id, d.owner_id::text AS owner_id, d.due_on::text AS due_on
          FROM due d JOIN fresh f ON f.case_id = d.id AND f.due_on = d.due_on
         ORDER BY d.due_on, d.id`;
      for (const c of due) {
        await this.outbox.enqueue(tx, CommEvent.CASE_DUE_SOON, {
          caseId: c.id,
          organizationId: c.organization_id,
          ownerId: c.owner_id,
          dueOn: c.due_on,
        });
      }
      return due.length;
    });
  }

  // ------------------------------------------------------------------

  /**
   * PD-35 B6: case_escalated in the target department's room -- who opened it
   * and who owns it, and its id to open it in Escalations. Never its title,
   * body or subject: most of the room may not see the case itself.
   */
  private async announce(tx: Tx, actor: Actor, departmentId: string, caseId: string, ownerId: string | null): Promise<RoomChange | null> {
    if (!this.rooms || !this.cards) return null;
    const synced = await this.rooms.roomInTx(tx, departmentId, actor.actorId);
    if (!synced) return null;
    const room = synced.conversation;
    const names = new Map(
      (await tx.staff.findMany({ where: { id: { in: [actor.actorId, ...(ownerId ? [ownerId] : [])] } }, select: { id: true, name: true } }))
        .map((p) => [p.id, p.name]),
    );
    const openedByName = names.get(actor.actorId) ?? '';
    const ownerName = ownerId ? (names.get(ownerId) ?? '') : null;
    const payload = { caseId, ownerId, ownerName, openedBy: actor.actorId, openedByName };
    const body = ownerName
      ? `تصعيد جديد من ${openedByName}، المسؤول: ${ownerName} · New escalation from ${openedByName}, owner: ${ownerName}`
      : `تصعيد جديد من ${openedByName} · New escalation from ${openedByName}`;
    await this.cards.post(tx, room, actor, { kind: CardKind.CASE_ESCALATED, payload, body });
    return synced.change;
  }

  private async requireStaff(actorId: string): Promise<Actor> {
    const actor = await this.conversations.requireActor(actorId);
    if (actor.kind !== ActorKind.STAFF || !actor.isActive || !actor.organizationId) {
      throw new CommError(CommErrorCode.CASE_DENIED, 'cases are for staff');
    }
    return actor;
  }

  /**
   * The caller stands to the subject: PD-35's teacher scope for a teacher, a
   * complaint or a parent's feedback; PD-11's lesson standing (manager or
   * supervisor) for a lesson or a learner. Anything else reads as not found.
   */
  private async requireSubjectScope(actor: Actor, subject: { kind: CaseSubjectKind; id: string }) {
    const org = actor.organizationId as string;
    const superAdmin = actor.staffRole === StaffRole.SUPER_ADMIN;
    const teacherScoped = async (teacherId: string | null | undefined) =>
      !!teacherId && (superAdmin || (await this.lessons.supervisesTeacher(actor, teacherId)));
    switch (subject.kind) {
      case 'teacher': {
        const t = await this.prisma.teacher.findFirst({ where: { id: subject.id, organizationId: org }, select: { id: true } });
        if (!t || !(await teacherScoped(t.id))) throw notFound();
        return;
      }
      case 'complaint': {
        const e = await this.prisma.teacherSupervisionEntry.findFirst({
          where: { id: subject.id, organizationId: org, kind: 'complaint' },
          select: { teacherId: true },
        });
        if (!e || !(await teacherScoped(e.teacherId))) throw notFound();
        return;
      }
      case 'feedback': {
        const f = await this.feedback.subjectOf(org, subject.id);
        if (!f || !(await teacherScoped(f.teacherId))) throw notFound();
        return;
      }
      case 'lesson': {
        try {
          const { standing } = await this.lessons.load(actor, subject.id);
          if (standing !== 'manager' && standing !== 'supervisor') throw notFound();
        } catch (e) {
          if (e instanceof CommError && e.code !== CommErrorCode.CASE_NOT_FOUND) throw notFound();
          throw e;
        }
        return;
      }
      case 'learner': {
        const l = await this.prisma.learner.findFirst({
          where: { id: subject.id, organizationId: org },
          select: { id: true, organizationId: true, teacherId: true, familyId: true },
        });
        if (!l) throw notFound();
        const standing = this.authz.lessonStanding(
          actor,
          { organizationId: l.organizationId, teacherId: l.teacherId ?? '', familyId: l.familyId },
          {
            teachersDepartment: await this.lessons.supervisesTeacher(actor, l.teacherId),
            supervisesLearner: (await this.lessons.supervisedLearnerIds(actor, new Date(), l.id)).length > 0,
          },
        );
        if (standing !== 'manager' && standing !== 'supervisor') throw notFound();
        return;
      }
    }
  }

  /**
   * Live, at every read (R2): the super admin; the target department's manager;
   * the owner while they still fit (in the department, in scope of the subject);
   * the opener while they still stand to the subject.
   */
  private async canSee(actor: Actor, row: Row): Promise<boolean> {
    if (this.canAct(actor, row)) return true;
    if (row.opened_by !== actor.actorId) return false;
    return this.requireSubjectScope(actor, { kind: row.subject_kind, id: row.subject_id }).then(
      () => true,
      (e: unknown) => {
        if (e instanceof CommError && e.code === CommErrorCode.CASE_NOT_FOUND) return false;
        throw e;
      },
    );
  }

  /** The owner (while they fit), the target department's manager, the super admin. */
  private canAct(actor: Actor, row: Row): boolean {
    const me = actor.actorId;
    return actor.staffRole === StaffRole.SUPER_ADMIN || row.target_manager_id === me || (row.owner_id === me && row.owner_fits);
  }

  private async visible(actor: Actor, caseId: string): Promise<Row> {
    if (!isUuid(caseId)) throw notFound();
    const row = await this.load(actor.organizationId as string, caseId).catch(() => null);
    if (!row || !(await this.canSee(actor, row))) throw notFound();
    return row;
  }

  private async forAct(actorId: string, caseId: string): Promise<{ actor: Actor; row: Row }> {
    const actor = await this.requireStaff(actorId);
    const row = await this.visible(actor, caseId);
    if (!this.canAct(actor, row)) throw denied();
    return { actor, row };
  }

  private async ownerFits(staffId: string, departmentId: string, teacherId: string | null, learnerId: string | null): Promise<boolean> {
    const [r] = await this.prisma.$queryRaw<Array<{ ok: boolean }>>`
      SELECT chat.case_owner_fits(${staffId}::uuid, ${departmentId}::uuid, ${teacherId}::uuid, ${learnerId}::uuid) AS ok`;
    return r?.ok === true;
  }

  /** YYYY-MM-DD, today or later on the academy's calendar; null clears; undefined is none. */
  private async dueField(v: unknown): Promise<string | null> {
    if (v === undefined || v === null || v === '') return null;
    if (typeof v !== 'string' || !DATE_RE.test(v) || Number.isNaN(Date.parse(`${v}T00:00:00Z`))) {
      throw invalid('dueOn: YYYY-MM-DD');
    }
    const [r] = await this.prisma.$queryRaw<Array<{ ok: boolean }>>`SELECT ${v}::date >= chat.academy_today() AS ok`;
    if (!r?.ok) throw invalid('dueOn: today or later');
    return v;
  }

  /** A write the database records as `actorId`'s (chat.case_actor), with a status note (chat.case_note). */
  private async asActor<T>(actorId: string, note: string | null, fn: (tx: Tx) => Promise<T>): Promise<T> {
    try {
      return await this.prisma.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT set_config('chat.case_actor', ${actorId}, true), set_config('chat.case_note', ${note ?? ''}, true)`;
        return fn(tx);
      });
    } catch (e) {
      // The database's own refusals (chat.guard_supervision_case), named.
      const message = String((e as Error).message ?? '');
      if (/a closed case stays closed|a case moves open/.test(message)) throw closed();
      const refused = /(a case is owned inside its target department[^"`]*|a case is about something that exists|a case goes to the Teachers or the Operations department of its organization)/.exec(message);
      if (refused) throw invalid(refused[1]);
      throw e;
    }
  }

  private async load(organizationId: string, id: string): Promise<Row> {
    const [row] = await this.rows(Prisma.sql`c.organization_id = ${organizationId}::uuid AND c.id = ${id}::uuid`);
    if (!row) throw notFound();
    return row;
  }

  private rows(where: Prisma.Sql) {
    return this.prisma.$queryRaw<Row[]>`
      SELECT c.id::text AS id, c.organization_id::text AS organization_id, c.title, c.body, c.status,
             c.subject_kind, c.subject_id::text AS subject_id,
             d.kind AS target, c.target_department_id::text AS target_department_id, d.manager_id::text AS target_manager_id,
             c.teacher_id::text AS teacher_id, t.name AS teacher_name,
             c.learner_id::text AS learner_id, l.name AS learner_name,
             ls.starts_at AS lesson_starts_at,
             c.owner_id::text AS owner_id, o.name AS owner_name,
             (c.owner_id IS NOT NULL AND chat.case_owner_fits(c.owner_id, c.target_department_id, c.teacher_id, c.learner_id)) AS owner_fits,
             c.opened_by::text AS opened_by, ob.name AS opener_name,
             c.due_on::text AS due_on, c.created_at, c.updated_at, c.closed_at
        FROM chat.supervision_case c
        JOIN chat.department d ON d.id = c.target_department_id
        JOIN chat.staff ob ON ob.id = c.opened_by
        LEFT JOIN chat.staff o ON o.id = c.owner_id
        LEFT JOIN chat.teacher t ON t.id = c.teacher_id
        LEFT JOIN chat.learner l ON l.id = c.learner_id
        LEFT JOIN chat.lesson ls ON c.subject_kind = 'lesson' AND ls.id = c.subject_id
       WHERE ${where}
       ORDER BY (c.status IN ('open', 'in_progress')) DESC, c.due_on NULLS LAST, c.created_at DESC
       LIMIT ${LIST_LIMIT}`;
  }

  private summary(r: Row) {
    return {
      id: r.id,
      title: r.title,
      body: r.body,
      status: r.status,
      target: r.target,
      subject: { kind: r.subject_kind, id: r.subject_id, label: subjectLabel(r) },
      teacher: r.teacher_id ? { id: r.teacher_id, name: r.teacher_name ?? '' } : null,
      learner: r.learner_id ? { id: r.learner_id, name: r.learner_name ?? '' } : null,
      owner: r.owner_id ? { id: r.owner_id, name: r.owner_name ?? '' } : null,
      openedBy: { id: r.opened_by, name: r.opener_name },
      dueOn: r.due_on,
      createdAt: r.created_at.toISOString(),
      updatedAt: r.updated_at.toISOString(),
      closedAt: r.closed_at?.toISOString() ?? null,
    };
  }
}

/** Who or what the case is about, in a few words (the page links the subject by kind and id). */
function subjectLabel(r: Row): string {
  switch (r.subject_kind) {
    case 'teacher':
    case 'complaint':
      return r.teacher_name ?? '';
    case 'lesson':
      return [r.learner_name, r.lesson_starts_at?.toISOString().slice(0, 10)].filter(Boolean).join(' · ');
    case 'learner':
    case 'feedback':
      return r.learner_name ?? '';
  }
}

function subjectOf(v: unknown): { kind: CaseSubjectKind; id: string } {
  if (!v || typeof v !== 'object') throw invalid('subject: { kind, id }');
  const { kind, id } = v as Record<string, unknown>;
  if (typeof kind !== 'string' || !(CASE_SUBJECTS as readonly string[]).includes(kind)) {
    throw invalid(`subject.kind: one of ${CASE_SUBJECTS.join(', ')}`);
  }
  if (typeof id !== 'string' || !isUuid(id)) throw notFound();
  return { kind: kind as CaseSubjectKind, id };
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
