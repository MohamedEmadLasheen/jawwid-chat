import { Inject, Injectable, Logger } from '@nestjs/common';
import { Prisma, TeacherViolation } from '@prisma/client';
import { PrismaService } from '../platform/prisma.service';
import { AppConfigService } from '../platform/app-config.service';
import { CommError, CommErrorCode } from '../platform/errors';
import { AUDIT_SERVICE } from '../platform/tokens';
import type { AuditService } from '../platform/audit.service';
import type { Actor } from '../platform/types';
import { ConversationService, isUuid } from '../communication/conversations/conversation.service';
import { OutboxService } from '../communication/outbox/outbox.service';
import { CommEvent } from '../communication/contracts/events';
import { CardKind } from '../communication/contracts/vocab';
import { CardPoster } from '../supervision/card-poster';
import { SupervisionConversationService } from '../supervision/supervision-conversation.service';
import { renderPd012CardBody, type CardLanguage } from '../supervision/pd012-cards';
import { LessonService } from '../lessons/lesson.service';
import { TrialService } from '../lessons/trial.service';
import { daysBetween, isoDate, todayIn } from '../leave/leave.service';
import { DECISIONS, Decision, decisionForStep, isSuspension, needsReason, stepsOf } from './ladder';

type Tx = Prisma.TransactionClient;

const MAX_TEXT = 1000;
const MONTH_RE = /^\d{4}-\d{2}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const DEFAULT_TIME_ZONE = 'Africa/Cairo';

/** The lists of the Teacher Supervision page (PD-26), by what happened. */
const KIND_FILTERS = {
  late: ['late'],
  cancellations: ['teacher_apology', 'teacher_no_show'],
  absences: ['teacher_apology', 'teacher_no_show', 'absence'],
  complaints: ['complaint'],
} as const;

/**
 * PD-12 S2: the teacher discipline ladder.
 *
 * Violations are recorded by the database itself -- a trigger writes one the
 * moment a lesson closes `teacher_apology` or `teacher_no_show` -- or by the
 * Teachers department recording a held lesson as late (from
 * `teacher.late_threshold_minutes`). Each one is decided ONCE by a person:
 *
 *   warning                a card in the teacher's supervision conversation
 *   first/second deduction the card, and `teacher.deduction_applied` to Core
 *                          payroll -- the amount is payroll's, never typed here
 *   temporary suspension   PD-11 days off for the window (so make-up booking
 *                          skips it; they never count against leave), the
 *                          card, `teacher.suspended` to Core/HR; open lessons in
 *                          the window are cancelled for the families
 *   permanent suspension   refused while the teacher still has students (move
 *                          them first, PD-11 transfer); then the card,
 *                          `teacher.suspended`, the teacher deactivated through
 *                          chat.deactivate_principal (RT-032: signed out
 *                          everywhere), and their open lessons cancelled
 *   excused                kept on record, no longer counted
 *
 * The suggested step is computed on every read (ladder.ts); choosing anything
 * else needs a reason, and the step that was suggested is stored with the
 * decision.
 */
@Injectable()
export class DisciplineService {
  private readonly logger = new Logger(DisciplineService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly conversations: ConversationService,
    private readonly supervision: SupervisionConversationService,
    private readonly cards: CardPoster,
    private readonly lessons: LessonService,
    private readonly outbox: OutboxService,
    private readonly config: AppConfigService,
    @Inject(AUDIT_SERVICE) private readonly audit: AuditService,
    private readonly trials: TrialService,
  ) {}

  // ------------------------------------------------------------------
  // Reading
  // ------------------------------------------------------------------

  /**
   * The organization's violations: `open` (default -- the "needs decision"
   * queue, oldest first), `decided` or `all`; optionally one month (YYYY-MM),
   * one teacher, and `late` or `cancellations` only.
   */
  async list(actorId: string, query: { state?: string; month?: string; teacherId?: string; kind?: string }) {
    const actor = await this.requireSupervisor(actorId);
    const state = query.state ?? 'open';
    if (!['open', 'decided', 'all'].includes(state)) throw invalid('state: open | decided | all');
    if (query.month !== undefined && !MONTH_RE.test(query.month)) throw invalid('month: YYYY-MM');
    if (query.teacherId !== undefined && !isUuid(query.teacherId)) throw invalid('teacherId: a uuid');
    if (query.kind !== undefined && !(query.kind in KIND_FILTERS)) throw invalid(`kind: ${Object.keys(KIND_FILTERS).join(' | ')}`);

    // PD-35: the violations of the teachers in the caller's scope.
    const scope = await this.supervision.teacherScope.scopeOf(actor);
    const where: Prisma.TeacherViolationWhereInput = {
      organizationId: actor.organizationId,
      ...(scope.all ? {} : { AND: [{ teacherId: { in: [...scope.teacherIds] } }] }),
      ...(state === 'open' ? { decision: null } : state === 'decided' ? { decision: { not: null } } : {}),
      ...(query.month ? { month: new Date(`${query.month}-01T00:00:00Z`) } : {}),
      ...(query.teacherId ? { teacherId: query.teacherId } : {}),
      ...(query.kind ? { kind: { in: [...KIND_FILTERS[query.kind as keyof typeof KIND_FILTERS]] } } : {}),
    };
    const rows = await this.standing(await this.prisma.teacherViolation.findMany({
      where,
      orderBy: state === 'open' ? { occurredAt: 'asc' } : { occurredAt: 'desc' },
      take: 500,
    }));
    return { violations: await this.dtos(rows) };
  }

  /** One teacher's month: the count that sets the next step, the violations, and their suspensions. */
  async teacherMonth(actorId: string, teacherId: string, month?: string) {
    const actor = await this.requireSupervisor(actorId);
    const teacher = await this.requireTeacher(actor, teacherId);
    const m = month ?? todayIn(await this.timeZone()).slice(0, 7);
    if (!MONTH_RE.test(m)) throw invalid('month: YYYY-MM');
    const rows = await this.standing(await this.prisma.teacherViolation.findMany({
      where: { teacherId: teacher.id, month: new Date(`${m}-01T00:00:00Z`) },
      orderBy: { occurredAt: 'asc' },
    }));
    const counted = rows.filter((r) => r.decision !== Decision.EXCUSED).length;
    const suspensions = await this.prisma.teacherSuspension.findMany({
      where: { teacherId: teacher.id },
      orderBy: { startsOn: 'desc' },
      take: 20,
    });
    return {
      teacher: { id: teacher.id, name: teacher.name, isActive: teacher.isActive && teacher.leftAt === null },
      month: m,
      counted,
      nextStep: decisionForStep(counted + 1),
      violations: await this.dtos(rows),
      suspensions: suspensions.map((s) => ({
        id: s.id,
        kind: s.kind,
        startsOn: isoDate(s.startsOn),
        endsOn: s.endsOn ? isoDate(s.endsOn) : null,
        reason: s.reason,
        createdAt: s.createdAt.toISOString(),
      })),
    };
  }

  // ------------------------------------------------------------------
  // Recording lateness
  // ------------------------------------------------------------------

  async recordLateness(actorId: string, lessonId: string, body: Record<string, unknown>) {
    const actor = await this.requireSupervisor(actorId);
    if (!isUuid(lessonId)) throw new CommError(CommErrorCode.DISCIPLINE_NOT_FOUND, 'lesson not found');
    const lesson = await this.prisma.lesson.findFirst({ where: { id: lessonId, organizationId: actor.organizationId } });
    if (!lesson) throw new CommError(CommErrorCode.DISCIPLINE_NOT_FOUND, 'lesson not found');
    await this.supervision.requireTeacherInScope(actor, lesson.teacherId, CommErrorCode.DISCIPLINE_NOT_FOUND);
    const minutes = body.minutes;
    if (typeof minutes !== 'number' || !Number.isInteger(minutes) || minutes < 1 || minutes > 240) {
      throw invalid('minutes: a whole number of minutes, 1 to 240');
    }
    const threshold = Number(await this.config.get('teacher.late_threshold_minutes'));
    if (minutes < threshold) {
      throw stateError(`a lesson counts as late from ${threshold} minutes; this is not a violation`);
    }
    const note = textField(body, 'note', false);
    const row = await this.write(() =>
      this.prisma.$transaction(async (tx) => {
        const created = await tx.teacherViolation.create({
          data: {
            organizationId: lesson.organizationId,
            teacherId: lesson.teacherId,
            lessonId: lesson.id,
            kind: 'late',
            occurredAt: lesson.startsAt,
            month: new Date(0), // set by the trigger from the lesson, in the academy's month
            lateMinutes: minutes,
            recordedBy: actor.actorId,
            note,
          },
        });
        await this.audit.audit(tx, {
          actorId: actor.actorId,
          action: 'teacher.lateness_recorded',
          entity: 'teacher',
          entityId: lesson.teacherId,
          after: { violationId: created.id, lessonId: lesson.id, minutes },
          reason: note ?? 'lateness recorded',
        });
        return created;
      }),
    );
    return { violation: (await this.dtos([row]))[0] };
  }

  // ------------------------------------------------------------------
  // PD-26: incidents that are not a lesson's
  // ------------------------------------------------------------------

  /**
   * An absence the teacher never reported, with no lesson to close (a missed
   * meeting, a shift). When there IS a lesson, close it as the teacher's
   * absence instead (POST /lessons/:id/teacher-no-show): that records the
   * violation by itself, and the family is told.
   */
  async recordAbsence(actorId: string, teacherId: string, body: Record<string, unknown>) {
    const actor = await this.requireSupervisor(actorId);
    const teacher = await this.requireTeacher(actor, teacherId);
    const tz = await this.timeZone();
    const day = dateField(body, 'occurredOn');
    if (!day) throw invalid('occurredOn: required, YYYY-MM-DD');
    if (day > todayIn(tz)) throw stateError('an absence is recorded once it has happened');
    const note = textField(body, 'note', true) as string;
    const [{ at }] = await this.prisma.$queryRaw<Array<{ at: Date }>>`
      SELECT (${day}::date::timestamp AT TIME ZONE ${tz}) AS at`;
    const row = await this.write(() =>
      this.prisma.$transaction(async (tx) => {
        const created = await tx.teacherViolation.create({
          data: {
            organizationId: teacher.organizationId,
            teacherId: teacher.id,
            kind: 'absence',
            occurredAt: at,
            month: new Date(0), // set by the trigger, in the academy's month
            recordedBy: actor.actorId,
            note,
          },
        });
        await this.audit.audit(tx, {
          actorId: actor.actorId,
          action: 'teacher.absence_recorded',
          entity: 'teacher',
          entityId: teacher.id,
          after: { violationId: created.id, occurredOn: day },
          reason: note,
        });
        return created;
      }),
    );
    return { violation: (await this.dtos([row]))[0] };
  }

  /**
   * An upheld complaint joins the same monthly ladder as absences and lateness
   * (PD-26): it becomes a violation, decided like any other. Once.
   */
  async upholdComplaint(actorId: string, complaintId: string, body: Record<string, unknown>) {
    const actor = await this.requireSupervisor(actorId);
    if (!isUuid(complaintId)) throw new CommError(CommErrorCode.DISCIPLINE_NOT_FOUND, 'complaint not found');
    const complaint = await this.prisma.teacherSupervisionEntry.findFirst({
      where: { id: complaintId, organizationId: actor.organizationId ?? '', kind: 'complaint' },
    });
    if (!complaint) throw new CommError(CommErrorCode.DISCIPLINE_NOT_FOUND, 'complaint not found');
    await this.supervision.requireTeacherInScope(actor, complaint.teacherId, CommErrorCode.DISCIPLINE_NOT_FOUND);
    const note = textField(body, 'note', false);
    const row = await this.write(() =>
      this.prisma.$transaction(async (tx) => {
        const created = await tx.teacherViolation.create({
          data: {
            organizationId: complaint.organizationId,
            teacherId: complaint.teacherId,
            kind: 'complaint',
            complaintEntryId: complaint.id,
            occurredAt: complaint.createdAt, // the trigger sets it from the complaint
            month: new Date(0),
            recordedBy: actor.actorId,
            note,
          },
        });
        await this.audit.audit(tx, {
          actorId: actor.actorId,
          action: 'teacher.complaint_upheld',
          entity: 'teacher',
          entityId: complaint.teacherId,
          after: { violationId: created.id, complaintId: complaint.id },
          reason: note ?? 'complaint upheld',
        });
        return created;
      }),
    );
    return { violation: (await this.dtos([row]))[0] };
  }

  // ------------------------------------------------------------------
  // Deciding
  // ------------------------------------------------------------------

  async decide(actorId: string, violationId: string, body: Record<string, unknown>) {
    const actor = await this.requireSupervisor(actorId);
    const violation = await this.load(actor, violationId);
    if (violation.decision !== null) throw stateError('this violation has already been decided');
    const decision = body.decision;
    if (typeof decision !== 'string' || !DECISIONS.has(decision)) {
      throw invalid(`decision: one of ${[...DECISIONS].join(', ')}`);
    }
    const step = await this.stepOf(violation);
    const note = textField(body, 'note', false);
    if (needsReason(decision as Decision, step) && !note) {
      throw invalid(
        decision === Decision.EXCUSED ? 'note: say why it is excused' : `note: the suggested step is ${decisionForStep(step)}; say why you chose another`,
      );
    }

    const tz = await this.timeZone();
    const today = todayIn(tz);
    let window: { startsOn: string; endsOn: string | null } | null = null;
    if (decision === Decision.TEMPORARY_SUSPENSION) {
      const days = Number(await this.config.get('teacher.suspension_default_days'));
      const startsOn = dateField(body, 'startsOn') ?? today;
      const endsOn = dateField(body, 'endsOn') ?? daysBetween(startsOn, addDays(startsOn, days - 1)).at(-1)!;
      if (startsOn < today) throw stateError('a suspension starts today or later');
      if (endsOn < startsOn) throw invalid('endsOn: on or after startsOn');
      if (daysBetween(startsOn, endsOn).length > 92) throw invalid('a temporary suspension lasts at most 92 days');
      window = { startsOn, endsOn };
    } else if (decision === Decision.PERMANENT_SUSPENSION) {
      const students = await this.prisma.learner.count({ where: { teacherId: violation.teacherId } });
      if (students > 0) {
        throw stateError(`move this teacher's ${students} student(s) to other teachers first (Schedules › Transfer)`);
      }
      window = { startsOn: today, endsOn: null };
    }

    const colliding = window ? await this.openLessonsIn(violation.teacherId, window, tz) : [];
    if (colliding.length > 0 && body.cancelCollidingLessons !== true) {
      throw new CommError(
        CommErrorCode.DISCIPLINE_LESSONS_COLLIDE,
        `${colliding.length} open lesson(s) fall inside the suspension; decide with cancelCollidingLessons to cancel them`,
        409,
      );
    }

    const teacher = await this.conversations.requireActor(violation.teacherId);
    const context = await this.cardContext(violation);
    await this.write(() =>
      this.prisma.$transaction(async (tx) => {
        let suspensionId: string | null = null;
        if (window && isSuspension(decision)) {
          const suspension = await tx.teacherSuspension.create({
            data: {
              organizationId: violation.organizationId,
              teacherId: violation.teacherId,
              kind: decision === Decision.TEMPORARY_SUSPENSION ? 'temporary' : 'permanent',
              startsOn: asDate(window.startsOn),
              endsOn: window.endsOn ? asDate(window.endsOn) : null,
              reason: note ?? `ladder step ${step}`,
              createdBy: actor.actorId,
            },
          });
          suspensionId = suspension.id;
          if (window.endsOn) {
            const already = new Set(
              (await tx.teacherDayOff.findMany({
                where: { teacherId: violation.teacherId, day: { gte: asDate(window.startsOn), lte: asDate(window.endsOn) } },
                select: { day: true },
              })).map((d) => isoDate(d.day)),
            );
            for (const day of daysBetween(window.startsOn, window.endsOn)) {
              if (already.has(day)) continue; // already off (leave, a day off): still unavailable
              await tx.teacherDayOff.create({
                data: {
                  organizationId: violation.organizationId,
                  teacherId: violation.teacherId,
                  day: asDate(day),
                  reason: 'Suspended',
                  createdBy: actor.actorId,
                  suspensionId,
                },
              });
            }
          }
        }
        await tx.teacherViolation.update({
          where: { id: violation.id },
          data: { decision, suggestedStep: step, decisionNote: note, decidedBy: actor.actorId, suspensionId },
        });

        if (decision !== Decision.EXCUSED) {
          const kind =
            decision === Decision.WARNING
              ? CardKind.DISCIPLINE_WARNING
              : decision === Decision.DEDUCTION_1 || decision === Decision.DEDUCTION_2
                ? CardKind.DISCIPLINE_DEDUCTION
                : CardKind.DISCIPLINE_SUSPENSION;
          const payload = {
            violationId: violation.id,
            ...context,
            step: decision === Decision.DEDUCTION_2 ? 2 : decision === Decision.DEDUCTION_1 ? 1 : step,
            note,
            ...(window
              ? { kind: decision === Decision.PERMANENT_SUSPENSION ? 'permanent' : 'temporary', startsOn: window.startsOn, endsOn: window.endsOn }
              : {}),
          };
          const conv = await this.supervision.ensureInTx(tx, violation.teacherId, violation.organizationId, actor.actorId).catch(() => null);
          if (conv) {
            await this.cards.post(tx, conv, actor, { kind, payload, body: renderPd012CardBody(kind, payload, langOf(teacher)) });
          }
        }
        if (decision === Decision.DEDUCTION_1 || decision === Decision.DEDUCTION_2) {
          await this.outbox.enqueue(tx, CommEvent.TEACHER_DEDUCTION_APPLIED, {
            teacherId: violation.teacherId,
            violationId: violation.id,
            step: decision === Decision.DEDUCTION_2 ? 2 : 1,
            month: isoDate(violation.month).slice(0, 7),
          });
        }
        if (window && suspensionId) {
          await this.outbox.enqueue(tx, CommEvent.TEACHER_SUSPENDED, {
            teacherId: violation.teacherId,
            suspensionId,
            violationId: violation.id,
            kind: decision === Decision.PERMANENT_SUSPENSION ? 'permanent' : 'temporary',
            startsOn: window.startsOn,
            endsOn: window.endsOn,
          });
        }
        await this.audit.audit(tx, {
          actorId: actor.actorId,
          action: `teacher.discipline_${decision}`,
          entity: 'teacher',
          entityId: violation.teacherId,
          after: { violationId: violation.id, suggestedStep: step, suspensionId, collidingLessons: colliding.map((l) => l.id) },
          reason: note ?? `ladder step ${step}`,
        });
        if (decision === Decision.PERMANENT_SUSPENSION) {
          // RT-032: the teacher's sessions are revoked through the journal, and a
          // node's completion barrier confirms it after this commit.
          await tx.$queryRaw`
            SELECT chat.deactivate_principal('teacher', ${violation.teacherId}::uuid,
                                             ${`permanent suspension: ${note ?? `ladder step ${step}`}`},
                                             ${actor.actorId}::uuid, 'deactivated')::text`;
        }
      }),
    );

    // The families are told through each lesson's own cancellation card.
    const notCancelled: Array<{ lessonId: string; reason: string }> = [];
    for (const lesson of colliding) {
      try {
        const reason = teacher.locale === 'en' ? 'The teacher is suspended' : 'المعلم موقوف';
        // A trial (PD-11 T4) is cancelled as a trial: LessonService never sees one.
        if (lesson.kind === 'trial') await this.trials.cancel(actorId, lesson.id, { reason });
        else await this.lessons.cancel(actorId, lesson.id, { reason });
      } catch (e) {
        const reason = e instanceof Error ? e.message : String(e);
        this.logger.warn(`lesson ${lesson.id} inside suspension of ${violation.teacherId} was not cancelled: ${reason}`);
        notCancelled.push({ lessonId: lesson.id, reason });
      }
    }
    const fresh = await this.prisma.teacherViolation.findUniqueOrThrow({ where: { id: violation.id } });
    return { violation: (await this.dtos([fresh]))[0], cancelledLessons: colliding.length - notCancelled.length, notCancelled };
  }

  // ------------------------------------------------------------------

  /** The step this violation stands at now, among its teacher's month. */
  private async stepOf(v: TeacherViolation): Promise<number> {
    const month = await this.standing(await this.prisma.teacherViolation.findMany({
      where: { teacherId: v.teacherId, month: v.month },
      select: { id: true, teacherId: true, occurredAt: true, month: true, decision: true, lessonId: true, kind: true },
    }));
    return stepsOf(month.map((m) => ({ ...m, month: isoDate(m.month) }))).get(v.id) ?? 1;
  }

  private async openLessonsIn(teacherId: string, window: { startsOn: string; endsOn: string | null }, tz: string) {
    return this.prisma.$queryRaw<Array<{ id: string; kind: string }>>`
      SELECT l.id::text AS id, l.kind
        FROM chat.lesson l
       WHERE l.teacher_id = ${teacherId}::uuid
         AND l.outcome IS NULL
         AND (l.starts_at AT TIME ZONE ${tz})::date >= ${window.startsOn}::date
         AND (${window.endsOn}::date IS NULL OR (l.starts_at AT TIME ZONE ${tz})::date <= ${window.endsOn}::date)
       ORDER BY l.starts_at`;
  }

  /** What a card says about the violation: what, whose lesson, which day (in the academy's calendar). */
  private async cardContext(v: TeacherViolation) {
    const lesson = v.lessonId
      ? await this.prisma.lesson.findUnique({ where: { id: v.lessonId }, select: { learner: { select: { name: true } } } })
      : null;
    return {
      violationKind: v.kind,
      lateMinutes: v.lateMinutes,
      learnerName: lesson?.learner?.name ?? null,
      lessonDay: todayIn(await this.timeZone(), v.occurredAt),
    };
  }

  private async dtos(rows: TeacherViolation[]) {
    if (rows.length === 0) return [];
    // Every violation of the teacher-months involved, so each step is computed in its whole month.
    const keys = [...new Set(rows.map((r) => `${r.teacherId}|${isoDate(r.month)}`))];
    const all = await this.standing(await this.prisma.teacherViolation.findMany({
      where: { OR: keys.map((k) => ({ teacherId: k.split('|')[0], month: asDate(k.split('|')[1]) })) },
      select: { id: true, teacherId: true, occurredAt: true, month: true, decision: true, lessonId: true, kind: true },
    }));
    const steps = stepsOf(all.map((m) => ({ ...m, month: isoDate(m.month) })));
    const lessons = await this.prisma.lesson.findMany({
      where: { id: { in: [...new Set(rows.map((r) => r.lessonId).filter((x): x is string => !!x))] } },
      select: { id: true, kind: true, startsAt: true, outcomeNote: true, learner: { select: { name: true } } },
    });
    const lessonOf = new Map(lessons.map((l) => [l.id, l]));
    const teachers = await this.prisma.teacher.findMany({
      where: { id: { in: [...new Set(rows.map((r) => r.teacherId))] } },
      select: { id: true, name: true },
    });
    const teacherName = new Map(teachers.map((t) => [t.id, t.name]));
    const staffIds = [...new Set(rows.flatMap((r) => [r.recordedBy, r.decidedBy]).filter((x): x is string => !!x))];
    const staff = staffIds.length ? await this.prisma.staff.findMany({ where: { id: { in: staffIds } }, select: { id: true, name: true } }) : [];
    const staffName = new Map(staff.map((s) => [s.id, s.name]));
    const suspensions = await this.prisma.teacherSuspension.findMany({
      where: { id: { in: rows.map((r) => r.suspensionId).filter((x): x is string => !!x) } },
    });
    const suspensionOf = new Map(suspensions.map((s) => [s.id, s]));
    const complaintIds = rows.map((r) => r.complaintEntryId).filter((x): x is string => !!x);
    const complaints = complaintIds.length
      ? await this.prisma.teacherSupervisionEntry.findMany({
          where: { id: { in: complaintIds } },
          select: { id: true, body: true, complaintSource: true, createdAt: true },
        })
      : [];
    const complaintOf = new Map(complaints.map((c) => [c.id, c]));

    return rows.map((r) => {
      const step = r.suggestedStep ?? steps.get(r.id) ?? 1;
      const lesson = r.lessonId ? lessonOf.get(r.lessonId) : undefined;
      const s = r.suspensionId ? suspensionOf.get(r.suspensionId) : undefined;
      const c = r.complaintEntryId ? complaintOf.get(r.complaintEntryId) : undefined;
      return {
        id: r.id,
        kind: r.kind,
        teacher: { id: r.teacherId, name: teacherName.get(r.teacherId) ?? null },
        // PD-26: null for an absence without a lesson, and an upheld complaint.
        lesson: r.lessonId
          ? {
              id: r.lessonId,
              // trial | regular, so lateness reads in two lists (PD-26). A make-up is a regular lesson.
              kind: lesson?.kind === 'trial' ? 'trial' : 'regular',
              startsAt: lesson?.startsAt.toISOString() ?? null,
              learnerName: lesson?.learner?.name ?? null,
              note: lesson?.outcomeNote ?? null,
            }
          : null,
        complaint: c ? { id: c.id, body: c.body, from: c.complaintSource, createdAt: c.createdAt.toISOString() } : null,
        occurredAt: r.occurredAt.toISOString(),
        month: isoDate(r.month).slice(0, 7),
        lateMinutes: r.lateMinutes,
        note: r.note,
        recordedBy: r.recordedBy ? { id: r.recordedBy, name: staffName.get(r.recordedBy) ?? null } : null,
        step,
        suggestedDecision: decisionForStep(step),
        decision: r.decision,
        decisionNote: r.decisionNote,
        decidedBy: r.decidedBy ? { id: r.decidedBy, name: staffName.get(r.decidedBy) ?? null } : null,
        decidedAt: r.decidedAt?.toISOString() ?? null,
        suspension: s ? { id: s.id, kind: s.kind, startsOn: isoDate(s.startsOn), endsOn: s.endsOn ? isoDate(s.endsOn) : null } : null,
      };
    });
  }

  private async load(actor: Actor, id: string): Promise<TeacherViolation> {
    if (!isUuid(id)) throw new CommError(CommErrorCode.DISCIPLINE_NOT_FOUND, 'violation not found');
    const v = await this.prisma.teacherViolation.findFirst({ where: { id, organizationId: actor.organizationId } });
    if (!v || (await this.standing([v])).length === 0) throw new CommError(CommErrorCode.DISCIPLINE_NOT_FOUND, 'violation not found');
    await this.supervision.requireTeacherInScope(actor, v.teacherId, CommErrorCode.DISCIPLINE_NOT_FOUND);
    return v;
  }

  /**
   * PD-15: the violations that still stand. A lesson whose outcome was
   * corrected away from the teacher's apology or absence (or, for lateness,
   * away from held) withdraws its UNDECIDED violation: it no longer counts
   * toward the month's ladder and cannot be decided. A decision already taken
   * stays on record -- reversing one is the Teachers department's own act.
   */
  private async standing<T extends { lessonId: string | null; kind: string; decision: string | null }>(rows: T[]): Promise<T[]> {
    const open = rows.filter((r) => r.decision === null && r.lessonId !== null);
    if (open.length === 0) return rows;
    const lessons = await this.prisma.lesson.findMany({
      where: { id: { in: [...new Set(open.map((r) => r.lessonId as string))] } },
      select: { id: true, outcome: true },
    });
    const outcomeOf = new Map(lessons.map((l) => [l.id, l.outcome]));
    // An absence or an upheld complaint has no lesson to be corrected: it stands.
    return rows.filter(
      (r) => r.decision !== null || r.lessonId === null || outcomeOf.get(r.lessonId) === (r.kind === 'late' ? 'held' : r.kind),
    );
  }

  private async requireSupervisor(actorId: string): Promise<Actor> {
    const actor = await this.conversations.requireActor(actorId);
    if (!(await this.supervision.staffAccess(actor)).canSupervise) {
      throw new CommError(CommErrorCode.DISCIPLINE_DENIED, 'discipline is the Teachers department\'s');
    }
    return actor;
  }

  private async requireTeacher(actor: Actor, teacherId: string) {
    if (!isUuid(teacherId)) throw new CommError(CommErrorCode.DISCIPLINE_NOT_FOUND, 'teacher not found');
    const t = await this.prisma.teacher.findFirst({ where: { id: teacherId, organizationId: actor.organizationId ?? '' } });
    if (!t) throw new CommError(CommErrorCode.DISCIPLINE_NOT_FOUND, 'teacher not found');
    await this.supervision.requireTeacherInScope(actor, t.id, CommErrorCode.DISCIPLINE_NOT_FOUND);
    return t;
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
      const code = (e as { code?: string }).code;
      if (code === 'P2002' || /teacher_violation_once_per_lesson|Unique constraint failed/.test(message)) {
        throw stateError('this lesson already has that violation recorded');
      }
      if (/23514|check_violation|42501|insufficient_privilege/.test(message)) {
        throw stateError(/message: "([^"]+)"/.exec(message)?.[1] ?? 'discipline does not allow this');
      }
      throw e;
    }
  }
}

function invalid(reason: string) {
  return new CommError(CommErrorCode.VALIDATION, reason, 400);
}

function stateError(reason: string) {
  return new CommError(CommErrorCode.DISCIPLINE_STATE, reason, 409);
}

function textField(body: Record<string, unknown>, field: string, required: boolean): string | null {
  const raw = body[field];
  if (raw === undefined || raw === null || (typeof raw === 'string' && raw.trim() === '')) {
    if (required) throw invalid(`${field}: required`);
    return null;
  }
  if (typeof raw !== 'string') throw invalid(`${field}: must be text`);
  if (raw.trim().length > MAX_TEXT) throw invalid(`${field}: at most ${MAX_TEXT} characters`);
  return raw.trim();
}

function dateField(body: Record<string, unknown>, field: string): string | null {
  const raw = body[field];
  if (raw === undefined || raw === null) return null;
  if (typeof raw !== 'string' || !DATE_RE.test(raw) || isoDate(asDate(raw)) !== raw) throw invalid(`${field}: a date, YYYY-MM-DD`);
  return raw;
}

function asDate(day: string): Date {
  return new Date(`${day}T00:00:00.000Z`);
}

function addDays(day: string, n: number): string {
  return isoDate(new Date(asDate(day).getTime() + n * 86_400_000));
}

function langOf(actor: Actor): CardLanguage {
  return actor.locale === 'en' ? 'en' : 'ar';
}
