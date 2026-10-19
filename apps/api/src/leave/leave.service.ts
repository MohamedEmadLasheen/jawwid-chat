import { Inject, Injectable, Logger } from '@nestjs/common';
import { Prisma, TeacherLeaveRequest } from '@prisma/client';
import { PrismaService } from '../platform/prisma.service';
import { CommError, CommErrorCode } from '../platform/errors';
import { AUDIT_SERVICE } from '../platform/tokens';
import type { AuditService } from '../platform/audit.service';
import type { Actor } from '../platform/types';
import { isLiveTeacher } from '../platform/pd012-policy';
import { ConversationService, isUuid } from '../communication/conversations/conversation.service';
import { CardKind, LeaveState } from '../communication/contracts/vocab';
import { CardPoster } from '../supervision/card-poster';
import { SupervisionConversationService } from '../supervision/supervision-conversation.service';
import { renderPd012CardBody, type CardLanguage } from '../supervision/pd012-cards';
import { LessonService } from '../lessons/lesson.service';
import { TrialService } from '../lessons/trial.service';

type Tx = Prisma.TransactionClient;

const MAX_TEXT = 1000;
const MAX_NOTE = 500;
const MAX_DAYS = 62;
const DEFAULT_TIME_ZONE = 'Africa/Cairo';

export interface LeaveBalance {
  year: number;
  /** Null until the Teachers department types one in. */
  allowance: number | null;
  /** Live (uncancelled) days off in the year, whatever recorded them. */
  used: number;
  /** allowance - used; null while there is no allowance. Never stored. */
  balance: number | null;
}

/**
 * PD-12 S1: teacher leave.
 *
 * An approved leave IS its rows in PD-11's chat.teacher_day_off -- the one
 * record of days off, which the scheduler and make-up booking already read
 * (PD-12: "There is no second leave table"). So an approved day is off for
 * scheduling the moment it is approved.
 *
 *   allowance   typed in by the Teachers department's manager (or the super admin)
 *   request     the teacher's Leave ticket; its card lands in their supervision
 *               conversation
 *   approve     writes one teacher_day_off row per chosen day, linked to the request
 *   cancel      removes the linked rows for the days that have not passed
 *   balance     allowance - teacher_day_off rows in the year: computed on every
 *               read, so a cancellation restores it with no correction step
 *
 * A day off recorded directly (Teacher File, availability) is a day off too, and
 * counts the same way: there is one record of days off, not two.
 *
 * Lessons inside an approved leave are cancelled as admin_cancelled with the
 * reason "teacher on leave" (PD-12 §4), through LessonService so each one posts
 * its card to the family exactly as any other cancellation does. They never
 * count as violations.
 */
@Injectable()
export class LeaveService {
  private readonly logger = new Logger(LeaveService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly conversations: ConversationService,
    private readonly supervision: SupervisionConversationService,
    private readonly cards: CardPoster,
    private readonly lessons: LessonService,
    @Inject(AUDIT_SERVICE) private readonly audit: AuditService,
    private readonly trials: TrialService,
  ) {}

  // ------------------------------------------------------------------
  // The teacher's side
  // ------------------------------------------------------------------

  /** The teacher's own balance and requests for a year (default: this year). */
  async ownLeave(actorId: string, yearQuery?: string) {
    const actor = await this.requireTeacher(actorId);
    const tz = await this.timeZone();
    const year = yearField(yearQuery, todayIn(tz));
    return this.view(actor.actorId, year, false);
  }

  async request(actorId: string, body: Record<string, unknown>) {
    const actor = await this.requireTeacher(actorId);
    const firstDay = dateField(body, 'firstDay');
    const lastDay = dateField(body, 'lastDay');
    const reason = textField(body, 'reason', MAX_TEXT, true) as string;
    if (lastDay < firstDay) throw invalid('lastDay: on or after firstDay');
    if (firstDay.slice(0, 4) !== lastDay.slice(0, 4)) {
      throw state('a leave request stays inside one calendar year; send one for each year');
    }
    if (daysBetween(firstDay, lastDay).length > MAX_DAYS) throw state(`a leave request covers at most ${MAX_DAYS} days`);
    const tz = await this.timeZone();
    if (firstDay < todayIn(tz)) throw state('leave is requested for days that have not passed');

    const created = await this.write(() =>
      this.prisma.$transaction(async (tx) => {
        const row = await tx.teacherLeaveRequest.create({
          data: {
            organizationId: actor.organizationId as string,
            teacherId: actor.actorId,
            firstDay: asDate(firstDay),
            lastDay: asDate(lastDay),
            reason,
          },
        });
        const conv = await this.supervision.ensureInTx(tx, actor.actorId, actor.organizationId as string, null);
        const balance = await this.balanceOf(tx, actor.actorId, Number(firstDay.slice(0, 4)));
        const payload = {
          leaveRequestId: row.id,
          firstDay,
          lastDay,
          days: daysBetween(firstDay, lastDay).length,
          reason,
          balance: balance.balance,
        };
        const messageId = await this.cards.post(tx, conv, actor, {
          kind: CardKind.LEAVE_REQUESTED,
          payload,
          body: renderPd012CardBody(CardKind.LEAVE_REQUESTED, payload, langOf(actor)),
        });
        await tx.teacherLeaveRequest.update({ where: { id: row.id }, data: { requestMessageId: messageId } });
        await this.audit.audit(tx, {
          actorId: null,
          action: 'teacher_leave.requested',
          entity: 'teacher_leave_request',
          entityId: row.id,
          after: { teacherId: actor.actorId, firstDay, lastDay },
          reason: 'leave requested by the teacher',
        });
        return { id: row.id, conversationId: conv.id };
      }),
    );
    return { request: await this.dtoById(created.id), conversationId: created.conversationId };
  }

  async withdraw(actorId: string, requestId: string) {
    const actor = await this.requireTeacher(actorId);
    const row = await this.loadRequest(actor.organizationId as string, requestId);
    if (row.teacherId !== actor.actorId) throw new CommError(CommErrorCode.LEAVE_NOT_FOUND, 'leave request not found');
    if (row.state !== LeaveState.REQUESTED) throw state('only a request that has not been decided can be withdrawn');
    await this.write(() =>
      this.prisma.$transaction(async (tx) => {
        await tx.teacherLeaveRequest.update({
          where: { id: row.id },
          data: { state: LeaveState.WITHDRAWN, endedBy: actor.actorId, endedAt: new Date() },
        });
        await this.postToTeacher(tx, row, actor, CardKind.LEAVE_WITHDRAWN, {}, actor);
        await this.audit.audit(tx, {
          actorId: null,
          action: 'teacher_leave.withdrawn',
          entity: 'teacher_leave_request',
          entityId: row.id,
          reason: 'leave request withdrawn by the teacher',
        });
      }),
    );
    return { request: await this.dtoById(row.id) };
  }

  // ------------------------------------------------------------------
  // The Teachers department's side
  // ------------------------------------------------------------------

  /** The leave requests of the organization, oldest open first. */
  async list(actorId: string, query: { state?: string }) {
    const actor = await this.requireSupervisor(actorId);
    if (query.state !== undefined && !Object.values(LeaveState).includes(query.state as never)) {
      throw invalid('state: requested | approved | declined | withdrawn | cancelled');
    }
    const rows = await this.prisma.teacherLeaveRequest.findMany({
      where: { organizationId: actor.organizationId, ...(query.state ? { state: query.state } : {}) },
      orderBy: query.state === LeaveState.REQUESTED ? { requestedAt: 'asc' } : { firstDay: 'desc' },
      take: 500,
    });
    return { requests: await this.dtos(rows, true) };
  }

  /** One teacher's leave for a year, for the Teacher File and the Supervision page. */
  async teacherLeave(actorId: string, teacherId: string, yearQuery?: string) {
    const actor = await this.requireSupervisor(actorId);
    await this.requireTeacherOf(actor, teacherId);
    const year = yearField(yearQuery, todayIn(await this.timeZone()));
    const view = await this.view(teacherId, year, true);
    const history = await this.prisma.teacherLeaveAllowance.findMany({
      where: { teacherId, leaveYear: year },
      orderBy: { setAt: 'desc' },
      take: 20,
    });
    const setters = await this.staffNames(history.map((h) => h.setBy));
    return {
      ...view,
      allowanceHistory: history.map((h) => ({
        days: h.days,
        note: h.note,
        setAt: h.setAt.toISOString(),
        setBy: { id: h.setBy, name: setters.get(h.setBy) ?? null },
      })),
    };
  }

  async setAllowance(actorId: string, teacherId: string, body: Record<string, unknown>) {
    const actor = await this.conversations.requireActor(actorId);
    if (!(await this.supervision.staffAccess(actor)).canSetAllowance) {
      throw new CommError(CommErrorCode.LEAVE_DENIED, "only the Teachers department's manager sets a leave allowance");
    }
    await this.requireTeacherOf(actor, teacherId);
    const year = body.year;
    if (typeof year !== 'number' || !Number.isInteger(year) || year < 2000 || year > 2100) throw invalid('year: a calendar year');
    const days = body.days;
    if (typeof days !== 'number' || !Number.isInteger(days) || days < 0 || days > 366) throw invalid('days: 0 to 366');
    const note = textField(body, 'note', MAX_NOTE, false);
    await this.write(() =>
      this.prisma.$transaction(async (tx) => {
        const row = await tx.teacherLeaveAllowance.create({
          data: { organizationId: actor.organizationId as string, teacherId, leaveYear: year, days, note, setBy: actor.actorId },
        });
        await this.audit.audit(tx, {
          actorId: actor.actorId,
          action: 'teacher_leave.allowance_set',
          entity: 'teacher_leave_allowance',
          entityId: row.id,
          after: { teacherId, year, days },
          reason: note ?? 'leave allowance set',
        });
      }),
    );
    return this.teacherLeave(actorId, teacherId, String(year));
  }

  /**
   * Approve a request. `days` (optional) are the calendar days that consume the
   * allowance -- by default every day of the request; the approver unticks the
   * teacher's regular day off, which is not leave. A day already recorded off is
   * not written twice.
   *
   * Open lessons inside the leave must be handled: without
   * `cancelCollidingLessons: true` the approval is refused (409) and nothing is
   * written. With it, the leave is approved first and each lesson is then
   * cancelled through LessonService; a lesson that could not be cancelled is
   * reported back and stays on the Teachers department's needs-action list.
   */
  async approve(actorId: string, requestId: string, body: Record<string, unknown>) {
    const actor = await this.requireSupervisor(actorId);
    const row = await this.loadRequest(actor.organizationId as string, requestId);
    if (row.state !== LeaveState.REQUESTED) throw state('this request has already been decided');
    const firstDay = isoDate(row.firstDay);
    const lastDay = isoDate(row.lastDay);
    const range = daysBetween(firstDay, lastDay);
    let chosen = range;
    if (body.days !== undefined) {
      if (!Array.isArray(body.days) || body.days.some((d) => typeof d !== 'string')) throw invalid('days: a list of dates');
      const set = new Set(body.days as string[]);
      if (set.size === 0 || [...set].some((d) => !range.includes(d))) throw invalid('days: dates inside the request');
      chosen = range.filter((d) => set.has(d));
    }
    const note = textField(body, 'note', MAX_TEXT, false);
    const tz = await this.timeZone();
    const colliding = await this.collidingLessons(row.teacherId, firstDay, lastDay, tz);
    if (colliding.length > 0 && body.cancelCollidingLessons !== true) {
      throw new CommError(
        CommErrorCode.LEAVE_LESSONS_COLLIDE,
        `${colliding.length} open lesson(s) fall inside this leave; approve with cancelCollidingLessons to cancel them`,
        409,
      );
    }
    const teacher = await this.conversations.requireActor(row.teacherId);
    const year = Number(firstDay.slice(0, 4));

    await this.write(() =>
      this.prisma.$transaction(async (tx) => {
        await tx.teacherLeaveRequest.update({
          where: { id: row.id },
          data: { state: LeaveState.APPROVED, decidedBy: actor.actorId, decisionNote: note },
        });
        const alreadyOff = new Set(await this.daysAlreadyOff(tx, row.teacherId, chosen));
        const toWrite = chosen.filter((d) => !alreadyOff.has(d));
        for (const day of toWrite) {
          await tx.teacherDayOff.create({
            data: {
              organizationId: row.organizationId,
              teacherId: row.teacherId,
              day: asDate(day),
              reason: `Leave: ${row.reason}`.slice(0, 500),
              createdBy: actor.actorId,
              leaveRequestId: row.id,
            },
          });
        }
        const balance = await this.balanceOf(tx, row.teacherId, year);
        await this.postToTeacher(tx, row, actor, CardKind.LEAVE_APPROVED, { days: toWrite.length, balance: balance.balance, note }, teacher);
        await this.audit.audit(tx, {
          actorId: actor.actorId,
          action: 'teacher_leave.approved',
          entity: 'teacher_leave_request',
          entityId: row.id,
          after: { days: toWrite, collidingLessons: colliding.map((l) => l.id) },
          reason: note ?? 'leave approved',
        });
      }),
    );

    const notCancelled: Array<{ lessonId: string; reason: string }> = [];
    for (const lesson of colliding) {
      try {
        const reason = teacher.locale === 'en' ? 'The teacher is on approved leave' : 'المعلم في إجازة معتمدة';
        // A trial (PD-11 T4) is cancelled as a trial: LessonService never sees one.
        if (lesson.kind === 'trial') await this.trials.cancel(actorId, lesson.id, { reason });
        else await this.lessons.cancel(actorId, lesson.id, { reason });
      } catch (e) {
        const reason = e instanceof Error ? e.message : String(e);
        this.logger.warn(`lesson ${lesson.id} inside approved leave ${row.id} was not cancelled: ${reason}`);
        notCancelled.push({ lessonId: lesson.id, reason });
      }
    }
    return { request: await this.dtoById(row.id), cancelledLessons: colliding.length - notCancelled.length, notCancelled };
  }

  async decline(actorId: string, requestId: string, body: Record<string, unknown>) {
    const actor = await this.requireSupervisor(actorId);
    const row = await this.loadRequest(actor.organizationId as string, requestId);
    if (row.state !== LeaveState.REQUESTED) throw state('this request has already been decided');
    const note = textField(body, 'note', MAX_TEXT, true) as string;
    const teacher = await this.conversations.requireActor(row.teacherId);
    await this.write(() =>
      this.prisma.$transaction(async (tx) => {
        await tx.teacherLeaveRequest.update({
          where: { id: row.id },
          data: { state: LeaveState.DECLINED, decidedBy: actor.actorId, decisionNote: note },
        });
        await this.postToTeacher(tx, row, actor, CardKind.LEAVE_DECLINED, { note }, teacher);
        await this.audit.audit(tx, {
          actorId: actor.actorId,
          action: 'teacher_leave.declined',
          entity: 'teacher_leave_request',
          entityId: row.id,
          reason: note,
        });
      }),
    );
    return { request: await this.dtoById(row.id) };
  }

  /**
   * Cancel an approved leave. Days that have not passed go back to the balance
   * (a day_off_cancellation each); days already taken stay taken. Lessons that
   * were cancelled for the leave are not re-created: the Teachers department
   * schedules them again if they are still wanted.
   */
  async cancel(actorId: string, requestId: string, body: Record<string, unknown>) {
    const actor = await this.requireSupervisor(actorId);
    const row = await this.loadRequest(actor.organizationId as string, requestId);
    if (row.state !== LeaveState.APPROVED) throw state('only an approved leave can be cancelled');
    const note = textField(body, 'note', MAX_TEXT, true) as string;
    const teacher = await this.conversations.requireActor(row.teacherId);
    const today = todayIn(await this.timeZone());
    let returned = 0;
    await this.write(() =>
      this.prisma.$transaction(async (tx) => {
        await tx.teacherLeaveRequest.update({
          where: { id: row.id },
          data: { state: LeaveState.CANCELLED, endedBy: actor.actorId, endedAt: new Date() },
        });
        const removed = await tx.teacherDayOff.deleteMany({
          where: { leaveRequestId: row.id, day: { gte: asDate(today) } },
        });
        returned = removed.count;
        await this.postToTeacher(tx, row, actor, CardKind.LEAVE_CANCELLED, { daysReturned: returned, note }, teacher);
        await this.audit.audit(tx, {
          actorId: actor.actorId,
          action: 'teacher_leave.cancelled',
          entity: 'teacher_leave_request',
          entityId: row.id,
          after: { daysReturned: returned },
          reason: note,
        });
      }),
    );
    return { request: await this.dtoById(row.id), daysReturned: returned };
  }

  // ------------------------------------------------------------------
  // The balance
  // ------------------------------------------------------------------

  async balanceOf(db: Tx | PrismaService, teacherId: string, year: number): Promise<LeaveBalance> {
    const rows = await db.$queryRaw<Array<{ allowance: number | null; used: number }>>`
      SELECT
        (SELECT a.days FROM chat.teacher_leave_allowance a
          WHERE a.teacher_id = ${teacherId}::uuid AND a.leave_year = ${year}
          ORDER BY a.set_at DESC, a.id DESC LIMIT 1) AS allowance,
        (SELECT count(*)::int FROM chat.teacher_day_off o
          WHERE o.teacher_id = ${teacherId}::uuid
            AND o.suspension_id IS NULL -- a suspension is not leave (PD-12 S2)
            AND extract(year FROM o.day) = ${year}) AS used`;
    const allowance = rows[0]?.allowance ?? null;
    const used = rows[0]?.used ?? 0;
    return { year, allowance, used, balance: allowance === null ? null : allowance - used };
  }

  // ------------------------------------------------------------------

  private async view(teacherId: string, year: number, staffView: boolean) {
    const balance = await this.balanceOf(this.prisma, teacherId, year);
    const rows = await this.prisma.teacherLeaveRequest.findMany({
      where: { teacherId, firstDay: { gte: asDate(`${year}-01-01`), lte: asDate(`${year}-12-31`) } },
      orderBy: { firstDay: 'desc' },
    });
    return { ...balance, requests: await this.dtos(rows, staffView) };
  }

  /** Open lessons of the teacher whose start falls on a day of the leave, in the academy's time zone. */
  private async collidingLessons(teacherId: string, firstDay: string, lastDay: string, tz: string) {
    return this.prisma.$queryRaw<Array<{ id: string; kind: string; starts_at: Date; learner_name: string }>>`
      SELECT l.id::text AS id, l.kind, l.starts_at, coalesce(ln.name, p.display_name) AS learner_name
        FROM chat.lesson l
        LEFT JOIN chat.learner ln ON ln.id = l.learner_id
        LEFT JOIN chat.trial_prospect p ON p.id = l.prospect_id -- PD-11 T4: a trial is the teacher's time too
       WHERE l.teacher_id = ${teacherId}::uuid
         AND l.outcome IS NULL
         AND (l.starts_at AT TIME ZONE ${tz})::date BETWEEN ${firstDay}::date AND ${lastDay}::date
       ORDER BY l.starts_at`;
  }

  private async daysAlreadyOff(tx: Tx, teacherId: string, days: string[]): Promise<string[]> {
    if (days.length === 0) return [];
    const rows = await tx.$queryRaw<Array<{ day: string }>>`
      SELECT o.day::text AS day
        FROM chat.teacher_day_off o
       WHERE o.teacher_id = ${teacherId}::uuid
         AND o.day = ANY(${days}::date[])`;
    return rows.map((r) => r.day);
  }

  /** A card about a request, in the teacher's supervision conversation. */
  private async postToTeacher(
    tx: Tx,
    row: TeacherLeaveRequest,
    recorder: Actor,
    kind: string,
    extra: Record<string, unknown>,
    teacher: Actor,
  ) {
    const conv = await this.supervision.ensureInTx(tx, row.teacherId, row.organizationId, recorder.kind === 'staff' ? recorder.actorId : null);
    const payload = { leaveRequestId: row.id, firstDay: isoDate(row.firstDay), lastDay: isoDate(row.lastDay), ...extra };
    await this.cards.post(tx, conv, recorder, { kind, payload, body: renderPd012CardBody(kind, payload, langOf(teacher)) });
  }

  private async dtoById(id: string) {
    const row = await this.prisma.teacherLeaveRequest.findUniqueOrThrow({ where: { id } });
    return (await this.dtos([row], true))[0];
  }

  private async dtos(rows: TeacherLeaveRequest[], withCollisions: boolean) {
    if (rows.length === 0) return [];
    const teachers = await this.prisma.teacher.findMany({
      where: { id: { in: [...new Set(rows.map((r) => r.teacherId))] } },
      select: { id: true, name: true },
    });
    const names = new Map(teachers.map((t) => [t.id, t.name]));
    const deciders = await this.staffNames(rows.map((r) => r.decidedBy).filter((x): x is string => !!x));
    const tz = withCollisions ? await this.timeZone() : DEFAULT_TIME_ZONE;
    const out = [];
    for (const r of rows) {
      const firstDay = isoDate(r.firstDay);
      const lastDay = isoDate(r.lastDay);
      const year = Number(firstDay.slice(0, 4));
      const open = r.state === LeaveState.REQUESTED;
      out.push({
        id: r.id,
        teacher: { id: r.teacherId, name: names.get(r.teacherId) ?? null },
        firstDay,
        lastDay,
        days: daysBetween(firstDay, lastDay).length,
        reason: r.reason,
        state: r.state,
        requestedAt: r.requestedAt.toISOString(),
        decidedAt: r.decidedAt?.toISOString() ?? null,
        decidedBy: r.decidedBy ? { id: r.decidedBy, name: deciders.get(r.decidedBy) ?? null } : null,
        decisionNote: r.decisionNote,
        endedAt: r.endedAt?.toISOString() ?? null,
        // For the approver: what approving would do, computed now.
        balance: withCollisions && open ? (await this.balanceOf(this.prisma, r.teacherId, year)).balance : undefined,
        collidingLessons:
          withCollisions && open
            ? (await this.collidingLessons(r.teacherId, firstDay, lastDay, tz)).map((l) => ({
                id: l.id,
                startsAt: l.starts_at.toISOString(),
                learnerName: l.learner_name,
              }))
            : undefined,
      });
    }
    return out;
  }

  private async staffNames(ids: string[]): Promise<Map<string, string>> {
    if (ids.length === 0) return new Map();
    const rows = await this.prisma.staff.findMany({ where: { id: { in: [...new Set(ids)] } }, select: { id: true, name: true } });
    return new Map(rows.map((s) => [s.id, s.name]));
  }

  private async loadRequest(organizationId: string, id: string): Promise<TeacherLeaveRequest> {
    if (!isUuid(id)) throw new CommError(CommErrorCode.LEAVE_NOT_FOUND, 'leave request not found');
    const row = await this.prisma.teacherLeaveRequest.findFirst({ where: { id, organizationId } });
    if (!row) throw new CommError(CommErrorCode.LEAVE_NOT_FOUND, 'leave request not found');
    return row;
  }

  private async requireTeacher(actorId: string): Promise<Actor> {
    const actor = await this.conversations.requireActor(actorId);
    if (!isLiveTeacher(actor)) throw new CommError(CommErrorCode.LEAVE_DENIED, 'only a teacher has leave of their own');
    return actor;
  }

  private async requireSupervisor(actorId: string): Promise<Actor> {
    const actor = await this.conversations.requireActor(actorId);
    if (!(await this.supervision.staffAccess(actor)).canSupervise) {
      throw new CommError(CommErrorCode.LEAVE_DENIED, 'only the Teachers department decides leave');
    }
    return actor;
  }

  private async requireTeacherOf(actor: Actor, teacherId: string) {
    if (!isUuid(teacherId)) throw new CommError(CommErrorCode.LEAVE_NOT_FOUND, 'teacher not found');
    const t = await this.prisma.teacher.findFirst({ where: { id: teacherId, organizationId: actor.organizationId ?? '' }, select: { id: true } });
    if (!t) throw new CommError(CommErrorCode.LEAVE_NOT_FOUND, 'teacher not found');
  }

  private async timeZone(): Promise<string> {
    const row = await this.prisma.config.findUnique({ where: { key: 'schedule.timezone' } });
    const tz = typeof row?.value === 'string' ? row.value : DEFAULT_TIME_ZONE;
    try {
      new Intl.DateTimeFormat('en', { timeZone: tz });
      return tz;
    } catch {
      return DEFAULT_TIME_ZONE;
    }
  }

  /** Map the database's refusal to a stable code: the triggers have the last word. */
  private async write<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (e) {
      if (e instanceof CommError) throw e;
      const message = e instanceof Error ? e.message : String(e);
      if (/23P01|teacher_leave_request_no_overlap/.test(message)) {
        throw state('this leave overlaps another open or approved request');
      }
      if (/23514|check_violation|42501|insufficient_privilege/.test(message)) {
        throw state(/message: "([^"]+)"/.exec(message)?.[1] ?? 'the leave does not allow this');
      }
      throw e;
    }
  }
}

// ----------------------------------------------------------------------
// Dates are calendar dates (YYYY-MM-DD), never instants.
// ----------------------------------------------------------------------

function invalid(reason: string) {
  return new CommError(CommErrorCode.VALIDATION, reason, 400);
}

function state(reason: string) {
  return new CommError(CommErrorCode.LEAVE_STATE, reason, 409);
}

function textField(body: Record<string, unknown>, field: string, max: number, required: boolean): string | null {
  const raw = body[field];
  if (raw === undefined || raw === null || (typeof raw === 'string' && raw.trim() === '')) {
    if (required) throw invalid(`${field}: required`);
    return null;
  }
  if (typeof raw !== 'string') throw invalid(`${field}: must be text`);
  const value = raw.trim();
  if (value.length > max) throw invalid(`${field}: at most ${max} characters`);
  return value;
}

function dateField(body: Record<string, unknown>, field: string): string {
  const raw = body[field];
  if (typeof raw !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(raw) || isoDate(asDate(raw)) !== raw) {
    throw invalid(`${field}: a date, YYYY-MM-DD`);
  }
  return raw;
}

function yearField(raw: string | undefined, today: string): number {
  if (raw === undefined) return Number(today.slice(0, 4));
  const year = Number(raw);
  if (!Number.isInteger(year) || year < 2000 || year > 2100) throw invalid('year: a calendar year');
  return year;
}

function asDate(day: string): Date {
  return new Date(`${day}T00:00:00.000Z`);
}

export function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Every calendar day from first to last, inclusive. */
export function daysBetween(first: string, last: string): string[] {
  const out: string[] = [];
  for (let t = asDate(first).getTime(); t <= asDate(last).getTime(); t += 86_400_000) {
    out.push(isoDate(new Date(t)));
    if (out.length > 400) break;
  }
  return out;
}

/** Today's calendar date in a time zone. */
export function todayIn(tz: string, now = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

function langOf(actor: Actor): CardLanguage {
  return actor.locale === 'en' ? 'en' : 'ar';
}
