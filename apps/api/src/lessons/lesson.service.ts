import { Inject, Injectable } from '@nestjs/common';
import { Conversation, Lesson, LessonCorrection, LessonReport, LessonRuling, Prisma } from '@prisma/client';
import { PrismaService } from '../platform/prisma.service';
import { AppConfigService } from '../platform/app-config.service';
import { AuthorizationService, type LessonAct, type LessonStanding } from '../platform/authorization.service';
import { CommError, CommErrorCode } from '../platform/errors';
import { AUDIT_SERVICE } from '../platform/tokens';
import type { AuditService } from '../platform/audit.service';
import type { Actor } from '../platform/types';
import { ConversationService, isUuid } from '../communication/conversations/conversation.service';
import { OutboxService } from '../communication/outbox/outbox.service';
import { CommEvent } from '../communication/contracts/events';
import { conversationState, needsReply } from '../communication/contracts/dto';
import {
  ActorKind,
  CardKind,
  ConversationType,
  LessonKind,
  LessonOutcome,
  MessageType,
  Moderation,
  OnBehalfMode,
  Origin,
  ReceiptState,
  RulingDecision,
  RulingKind,
  Visibility,
} from '../communication/contracts/vocab';
import { renderCardBody, type CardLanguage } from './lesson-card';
import { COVERED_TOPICS, NEXT_TASKS } from './report-vocab';

export type Tx = Prisma.TransactionClient;

/**
 * A LEARNER's lesson -- every lesson but a trial. Trials (kind 'trial', for a
 * prospect, no learner) are TrialService's: every query here excludes them
 * (LEARNER_LESSON) and narrows with learnerLesson(), so a learner is always there.
 */
export type LessonWithRelations = Lesson & {
  learnerId: string;
  report: LessonReport | null;
  rulings: LessonRuling[];
  corrections?: LessonCorrection[];
  learner: { id: string; name: string; familyId: string };
  teacher: { id: string; name: string };
};

/** The `where` fragment that keeps trials out of every learner-lesson query. */
export const LEARNER_LESSON = { kind: { not: 'trial' } } as const;

type LessonRow = Prisma.LessonGetPayload<{ include: typeof LESSON_INCLUDE }>;

/** A row from a LEARNER_LESSON query, typed as what it is. A trial here is answered as unknown. */
export function learnerLesson(l: LessonRow): LessonWithRelations {
  if (l.learner === null || l.learnerId === null) {
    throw new CommError(CommErrorCode.LESSON_NOT_FOUND, 'lesson not found');
  }
  return l as LessonWithRelations;
}

/**
 * What a card is about: a lesson, or -- for a regular-time change -- a learner
 * with no one lesson (`id` null). Its group is the learner's (groupFor).
 */
export interface CardSubject {
  id: string | null;
  learnerId: string;
  organizationId: string;
  teacherId: string;
}

export const LESSON_INCLUDE = {
  report: true,
  rulings: true,
  corrections: { orderBy: { correctedAt: 'asc' } },
  learner: { select: { id: true, name: true, familyId: true } },
  teacher: { select: { id: true, name: true } },
} as const;

/** Where an open lesson is in its day, as the needs-action list and the clients sort it. */
export type LessonPhase = 'upcoming' | 'in_progress' | 'awaiting_close' | 'overdue' | 'closed';

/** A late apology is accepted this long after the start -- chat.guard_lesson_ruling's rule. */
const LATE_APOLOGY_HOURS = 48;
const MAX_TEXT = 1000;
const MAX_NOTE = 2000;
/** PD-15: the short "details" lines beside the quick choices. */
const MAX_SHORT = 500;
const MAX_RANGE_DAYS = 93;

/**
 * PD-9 / PD-11: lessons and their tickets.
 *
 * Every ticket changes exactly one record and posts exactly one card, in ONE
 * transaction: the outcome, the report, the ruling and the card commit
 * together or not at all, so the parent never reads a report the statistics do
 * not count, nor the other way round.
 *
 * Who may act is AuthorizationService's (lessonStanding / canRecordLessonAct).
 * Whether the lesson's state and the clock allow it is pre-checked here for a
 * clear refusal and decided, authoritatively, by the triggers of 20261018120000
 * against the database clock.
 */
/** A teacher's zone when none is recorded: "today" for pauses and their notices. */
export const DEFAULT_ZONE = 'Africa/Cairo';

@Injectable()
export class LessonService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly authz: AuthorizationService,
    private readonly conversations: ConversationService,
    private readonly outbox: OutboxService,
    private readonly config: AppConfigService,
    @Inject(AUDIT_SERVICE) private readonly audit: AuditService,
  ) {}

  // ------------------------------------------------------------------
  // Scheduling
  // ------------------------------------------------------------------

  /** One lesson for a learner, with the learner's assigned teacher. Teachers department only. */
  async schedule(actorId: string, body: Record<string, unknown>) {
    const actor = await this.conversations.requireActor(actorId);
    await this.requireManager(actor);
    const learnerId = uuidField(body, 'learnerId');
    const startsAt = dateField(body, 'startsAt');
    const endsAt = dateField(body, 'endsAt');
    const makeupFor = optionalUuidField(body, 'makeupFor');
    if (endsAt <= startsAt) throw invalid('endsAt: must be after startsAt');

    const learner = await this.prisma.learner.findFirst({
      where: { id: learnerId, organizationId: actor.organizationId },
      select: { id: true, teacherId: true },
    });
    if (!learner) throw new CommError(CommErrorCode.LESSON_NOT_FOUND, 'learner not found');
    if (!learner.teacherId) throw stateError('the learner has no assigned teacher');

    const lesson = await this.write(() =>
      this.prisma.$transaction(async (tx) => {
        const created = await tx.lesson.create({
          data: {
            organizationId: actor.organizationId as string,
            learnerId,
            teacherId: learner.teacherId as string,
            kind: makeupFor ? LessonKind.MAKEUP : LessonKind.REGULAR,
            makeupFor,
            startsAt,
            endsAt,
            createdBy: actor.actorId,
          },
          include: LESSON_INCLUDE,
        }).then(learnerLesson);
        await this.audit.audit(tx, {
          actorId: actor.actorId,
          action: 'lesson.scheduled',
          entity: 'lesson',
          entityId: created.id,
          after: { learnerId, teacherId: created.teacherId, startsAt: startsAt.toISOString(), endsAt: endsAt.toISOString() },
          reason: makeupFor ? 'make-up lesson scheduled' : 'lesson scheduled',
        });
        return created;
      }),
    );
    return this.toDto(lesson, 'manager', new Date(), await this.escalationMs());
  }

  // ------------------------------------------------------------------
  // Reading
  // ------------------------------------------------------------------

  /**
   * The lessons the caller may see in [from, to): a teacher, their own; a
   * contact, their family's children's; the Teachers department, any (filtered
   * by teacherId / learnerId); a supervisor, the children they supervise.
   */
  async list(actorId: string, query: { from?: string; to?: string; teacherId?: string; learnerId?: string }) {
    const actor = await this.conversations.requireActor(actorId);
    if (!actor.isActive || !actor.organizationId) throw new CommError(CommErrorCode.LESSON_DENIED, 'inactive actor');
    const now = new Date();
    const from = query.from ? parseDate(query.from, 'from') : new Date(now.getTime() - 7 * 86_400_000);
    const to = query.to ? parseDate(query.to, 'to') : new Date(now.getTime() + 28 * 86_400_000);
    if (to <= from || to.getTime() - from.getTime() > MAX_RANGE_DAYS * 86_400_000) {
      throw invalid(`from/to: a window of at most ${MAX_RANGE_DAYS} days`);
    }
    if (query.teacherId !== undefined && !isUuid(query.teacherId)) throw invalid('teacherId: must be a uuid');
    if (query.learnerId !== undefined && !isUuid(query.learnerId)) throw invalid('learnerId: must be a uuid');

    const where: Prisma.LessonWhereInput = {
      ...LEARNER_LESSON,
      organizationId: actor.organizationId,
      startsAt: { gte: from, lt: to },
      ...(query.teacherId ? { teacherId: query.teacherId } : {}),
      ...(query.learnerId ? { learnerId: query.learnerId } : {}),
    };
    let standing: LessonStanding;
    if (actor.kind === ActorKind.TEACHER) {
      standing = 'teacher';
      where.teacherId = actor.actorId;
      if (query.teacherId && query.teacherId !== actor.actorId) return { lessons: [] };
    } else if (actor.kind === ActorKind.CONTACT) {
      standing = 'family';
      where.learner = { familyId: actor.familyId };
    } else if (actor.kind === ActorKind.STAFF) {
      if (await this.isManager(actor)) {
        standing = 'manager';
      } else {
        standing = 'supervisor';
        where.learnerId = { in: await this.supervisedLearnerIds(actor, now, query.learnerId) };
      }
    } else {
      throw new CommError(CommErrorCode.LESSON_DENIED, 'only people take part in lessons');
    }

    const rows = await this.prisma.lesson.findMany({
      where,
      include: LESSON_INCLUDE,
      orderBy: { startsAt: 'asc' },
      take: 1000,
    });
    const escalation = await this.escalationMs();
    return { lessons: rows.map((l) => this.toDto(learnerLesson(l), standing, now, escalation)) };
  }

  async get(actorId: string, lessonId: string) {
    const actor = await this.conversations.requireActor(actorId);
    const { lesson, standing } = await this.load(actor, lessonId);
    return this.toDto(lesson, standing, new Date(), await this.escalationMs());
  }

  /**
   * The Teachers department's queue: lessons still open after their end (the
   * overdue ones first) and rulings waiting for a decision. A query, not a
   * stored list: it cannot drift from the lessons it describes.
   */
  async needsAction(actorId: string) {
    const actor = await this.conversations.requireActor(actorId);
    await this.requireManager(actor);
    const now = new Date();
    const escalation = await this.escalationMs();
    const open = await this.prisma.lesson.findMany({
      where: { ...LEARNER_LESSON, organizationId: actor.organizationId, outcome: null, endsAt: { lte: now } },
      include: LESSON_INCLUDE,
      orderBy: { endsAt: 'asc' },
      take: 500,
    }).then((rows) => rows.map(learnerLesson));
    const rulings = await this.prisma.lessonRuling.findMany({
      where: { organizationId: actor.organizationId, decision: null },
      include: { lesson: { include: LESSON_INCLUDE } },
      orderBy: { openedAt: 'asc' },
      take: 500,
    });
    const lessons = open.map((l) => this.toDto(l, 'manager', now, escalation));
    // PD-11 T2: teacher-cancelled lessons nobody replaced within the window, and
    // families waiting for an answer about their regular times.
    const windowDays = Number(await this.config.get('lesson.makeup_window_days'));
    const owed = await this.owedMakeups(actor.organizationId as string, { closedDaysAgo: windowDays });
    const requests = await this.prisma.scheduleChangeRequest.findMany({
      where: { organizationId: actor.organizationId, status: 'pending' },
      orderBy: { createdAt: 'asc' },
      take: 500,
    });
    const learnerNames = new Map(
      (await this.prisma.learner.findMany({ where: { id: { in: requests.map((r) => r.learnerId) } }, select: { id: true, name: true } }))
        .map((l) => [l.id, l.name]),
    );
    return {
      overdue: lessons.filter((l) => l.phase === 'overdue'),
      awaitingClose: lessons.filter((l) => l.phase === 'awaiting_close'),
      rulings: rulings.map((r) => ({
        ...rulingDto(r),
        lesson: this.toDto(learnerLesson(r.lesson), 'manager', now, escalation),
      })),
      makeupsOverdue: owed.map((l) => this.toDto(l, 'manager', now, escalation)),
      // PD-11 T3: paused learners coming back within the notice window -- the
      // team's half of the return notice (the family's half is a card). "Today"
      // is the pause's own, exactly as LifecycleService.sweep reads it (the
      // learner's teacher's zone), never the database's UTC current_date: the two
      // disagreed for the hours after local midnight.
      returningSoon: (
        await this.prisma.$queryRaw<Array<{ id: string; learner_id: string; name: string; return_on: Date }>>`
          SELECT s.id::text AS id, s.learner_id::text AS learner_id, l.name, s.return_on
            FROM chat.learner_suspension s JOIN chat.learner l ON l.id = s.learner_id
           WHERE s.organization_id = ${actor.organizationId}::uuid AND s.status = 'active' AND s.kind = 'temporary'
             AND s.return_on - ${Number(await this.config.get('lesson.return_notice_days'))}::int
                 <= (now() AT TIME ZONE coalesce(
                      (SELECT a.timezone FROM chat.teacher_availability a WHERE a.teacher_id = l.teacher_id LIMIT 1),
                      ${DEFAULT_ZONE}))::date
           ORDER BY s.return_on`
      ).map((r) => ({
        suspensionId: r.id,
        learner: { id: r.learner_id, name: r.name },
        returnOn: r.return_on.toISOString().slice(0, 10),
      })),
      scheduleRequests: requests.map((r) => ({
        id: r.id,
        learner: { id: r.learnerId, name: learnerNames.get(r.learnerId) ?? '' },
        slots: r.slots,
        note: r.note,
        createdAt: r.createdAt.toISOString(),
      })),
    };
  }

  /**
   * Lessons the teacher did not give that still owe the family a make-up: no
   * live make-up replaces them and no supervisor has recorded what was done
   * instead. Optionally only those closed at least `closedDaysAgo` days ago by
   * the DATABASE clock (the follow-up window -- outcome_at is written by that
   * clock, so it is measured by it too) and only for `learnerIds`.
   */
  async owedMakeups(
    organizationId: string,
    opts: { closedDaysAgo?: number; learnerIds?: string[]; since?: Date; causes?: readonly string[] } = {},
  ): Promise<LessonWithRelations[]> {
    // The follow-up queue stays the teacher's misses only; a family's own
    // apology owes a make-up (PD-15) but is never escalated.
    const causes = [...(opts.causes ?? TEACHER_MAKEUP_CAUSES)];
    const ids = await this.prisma.$queryRaw<Array<{ id: string }>>`
      SELECT l.id::text AS id
        FROM chat.lesson l
       WHERE l.organization_id = ${organizationId}::uuid
         AND l.kind <> 'trial'
         AND l.outcome = ANY(${causes}::text[])
         AND (${opts.closedDaysAgo ?? null}::int IS NULL OR l.outcome_at <= now() - make_interval(days => ${opts.closedDaysAgo ?? null}::int))
         AND (${opts.since ?? null}::timestamptz IS NULL OR l.starts_at >= ${opts.since ?? null}::timestamptz)
         AND (${opts.learnerIds ?? null}::uuid[] IS NULL OR l.learner_id = ANY(${opts.learnerIds ?? null}::uuid[]))
         AND NOT EXISTS (
           SELECT 1 FROM chat.lesson m
            WHERE m.makeup_for = l.id AND m.kind = 'makeup'
              AND (m.outcome IS NULL OR m.outcome NOT IN ('teacher_apology', 'teacher_no_show', 'admin_cancelled', 'rescheduled', 'voided')))
         AND NOT EXISTS (SELECT 1 FROM chat.lesson_ruling r WHERE r.lesson_id = l.id AND r.kind = 'makeup_followup')
       ORDER BY l.outcome_at ASC
       LIMIT 500`;
    if (ids.length === 0) return [];
    return this.prisma.lesson.findMany({
      where: { id: { in: ids.map((r) => r.id) } },
      include: LESSON_INCLUDE,
      orderBy: { outcomeAt: 'asc' },
    }).then((rows) => rows.map(learnerLesson));
  }

  /**
   * The lesson tickets the caller may open in one conversation right now --
   * what the client puts under "+". Advisory, exactly like canCall: each ticket
   * is re-decided when it is submitted.
   */
  async ticketsFor(actorId: string, conversationId: string) {
    const actor = await this.conversations.requireActor(actorId);
    const conv = await this.conversations.requireConversation(conversationId);
    const tenant = this.authz.canActInOrganization(actor, conv.organizationId);
    if (!tenant.allowed) throw new CommError(tenant.code, tenant.reason, 404);
    const membership = await this.conversations.membershipOf(conv.id, actor.actorId);
    if (!membership || conv.archivedAt) return { tickets: [] };
    const learnerIds = await this.learnersOf(conv);
    if (learnerIds.length === 0) return { tickets: [] };
    const now = new Date();
    const rows = await this.prisma.lesson.findMany({
      where: {
        learnerId: { in: learnerIds },
        organizationId: conv.organizationId,
        startsAt: { gte: new Date(now.getTime() - LATE_APOLOGY_HOURS * 3_600_000), lte: new Date(now.getTime() + 14 * 86_400_000) },
      },
      include: LESSON_INCLUDE,
      orderBy: { startsAt: 'asc' },
    }).then((found) => found.map(learnerLesson));
    const tickets: Array<{
      ticket: LessonAct;
      /** Null for a ticket about the learner rather than one lesson (a regular-time change). */
      lessonId: string | null;
      learner: { id: string; name: string };
      startsAt: string | null;
      endsAt: string | null;
      /** PD-15, a report ticket only: the number the report form starts from. */
      suggestedLessonNumber?: number;
    }> = [];
    // PD-15: a staff member's standing is computed exactly as load() computes
    // it, so the child's supervisor sees the excuse cards in the group.
    const staff = actor.kind === ActorKind.STAFF;
    const teachersDepartment = staff ? await this.isManager(actor) : false;
    const supervised = new Set(staff && !teachersDepartment ? await this.supervisedLearnerIds(actor, now) : []);
    const standingFor = (l: { learnerId: string } & Parameters<LessonService['scopeOf']>[0]) =>
      this.authz.lessonStanding(actor, this.scopeOf(l), { teachersDepartment, supervisesLearner: supervised.has(l.learnerId) });
    const lessonNumbers = new Map<string, number>();
    for (const l of rows) {
      const standing = standingFor(l);
      if (!standing) continue;
      for (const act of availableActs(l, now)) {
        if (this.authz.canRecordLessonAct(actor, standing, act).allowed) {
          let suggestedLessonNumber: number | undefined;
          if (act === 'report') {
            if (!lessonNumbers.has(l.learnerId)) lessonNumbers.set(l.learnerId, await this.nextLessonNumber(l.learnerId));
            suggestedLessonNumber = lessonNumbers.get(l.learnerId);
          }
          tickets.push({
            ticket: act,
            lessonId: l.id,
            learner: { id: l.learner.id, name: l.learner.name },
            startsAt: l.startsAt.toISOString(),
            endsAt: l.endsAt.toISOString(),
            ...(suggestedLessonNumber !== undefined ? { suggestedLessonNumber } : {}),
          });
        }
      }
    }

    // PD-11 T2 / PD-15: the make-ups owed here -- after a teacher's or a
    // student's apology -- and asking for new regular times.
    const owed = await this.owedMakeups(conv.organizationId, {
      learnerIds,
      since: new Date(now.getTime() - 60 * 86_400_000),
      causes: MAKEUP_CAUSES,
    });
    for (const l of owed) {
      const standing = standingFor(l);
      if (standing && this.authz.canRecordLessonAct(actor, standing, 'book_makeup').allowed) {
        tickets.push({
          ticket: 'book_makeup',
          lessonId: l.id,
          learner: { id: l.learner.id, name: l.learner.name },
          startsAt: l.startsAt.toISOString(),
          endsAt: l.endsAt.toISOString(),
        });
      }
    }
    if (actor.kind === ActorKind.CONTACT) {
      const learners = await this.prisma.learner.findMany({
        where: { id: { in: learnerIds }, familyId: actor.familyId, organizationId: conv.organizationId },
        select: { id: true, name: true, teacherId: true },
      });
      for (const learner of learners) {
        const scope = { organizationId: conv.organizationId, teacherId: learner.teacherId ?? '', familyId: actor.familyId as string };
        const standing = this.authz.lessonStanding(actor, scope, { teachersDepartment: false, supervisesLearner: false });
        if (!standing || !this.authz.canRecordLessonAct(actor, standing, 'request_schedule_change').allowed) continue;
        const [slots, pending] = await Promise.all([
          this.prisma.learnerScheduleSlot.count({ where: { learnerId: learner.id, validTo: null } }),
          this.prisma.scheduleChangeRequest.count({ where: { learnerId: learner.id, status: 'pending' } }),
        ]);
        if (slots > 0 && pending === 0) {
          tickets.push({
            ticket: 'request_schedule_change',
            lessonId: null,
            learner: { id: learner.id, name: learner.name },
            startsAt: null,
            endsAt: null,
          });
        }
      }
    }
    return { tickets };
  }

  // ------------------------------------------------------------------
  // Tickets
  // ------------------------------------------------------------------

  /**
   * Case 1: the learner attended. The report closes the lesson as held and is
   * posted once. PD-15: mostly taps -- the lesson number, topic and
   * next-lesson choices and a performance level -- plus optional short text.
   * The teacher's note is staff-only and never reaches the card.
   */
  async report(actorId: string, lessonId: string, body: Record<string, unknown>) {
    const fields = reportFields(body);
    return this.close(actorId, lessonId, 'report', LessonOutcome.HELD, null, async (tx, lesson, actor, lang) => {
      await tx.lessonReport.create({
        data: {
          lessonId: lesson.id, organizationId: lesson.organizationId, teacherId: lesson.teacherId,
          ...fields, enteredByKind: 'teacher', enteredBy: actor.actorId,
        },
      });
      const messageId = await this.postCard(tx, lesson, actor, CardKind.LESSON_REPORT, this.reportPayload(lesson, fields), lang);
      if (messageId) await tx.lessonReport.update({ where: { lessonId: lesson.id }, data: { messageId } });
    });
  }

  /** What a report card carries: everything but the private note. */
  reportPayload(lesson: LessonWithRelations, f: ReportFields) {
    return {
      ...this.cardBase(lesson),
      lessonNumber: f.lessonNumber,
      coveredTopics: f.coveredTopics,
      covered: f.covered,
      rating: f.rating,
      nextTasks: f.nextTasks,
      homework: f.homework,
    };
  }

  /** The number a new report starts from: the child's live reported lessons, plus one. */
  async nextLessonNumber(learnerId: string): Promise<number> {
    const last = await this.prisma.lessonReport.findFirst({
      where: { deletedAt: null, lessonNumber: { not: null }, lesson: { learnerId, outcome: LessonOutcome.HELD } },
      orderBy: { submittedAt: 'desc' },
      select: { lessonNumber: true },
    });
    if (last?.lessonNumber) return last.lessonNumber + 1;
    const held = await this.prisma.lesson.count({ where: { learnerId, outcome: LessonOutcome.HELD, ...LEARNER_LESSON } });
    return held + 1;
  }

  /** Case 2b: no apology and the start has passed -- an absence, credited to the teacher. */
  async absence(actorId: string, lessonId: string, body: Record<string, unknown>) {
    const note = textField(body, 'note', MAX_TEXT, false);
    return this.close(actorId, lessonId, 'absence', LessonOutcome.STUDENT_NO_SHOW, note, async (tx, lesson, actor, lang) => {
      await this.postCard(tx, lesson, actor, CardKind.LESSON_ABSENCE, { ...this.cardBase(lesson), note }, lang);
    });
  }

  /**
   * Case 2a: the learner is excused before the start -- by the family (with
   * its reason, shown on the card) or, PD-15, by the child's supervisor from
   * the group, for whom no reason is asked. No report is needed; a make-up is
   * owed and is booked once the family and the teacher agree on a time.
   */
  async apology(actorId: string, lessonId: string, body: Record<string, unknown>) {
    const actor = await this.conversations.requireActor(actorId);
    const family = actor.kind === ActorKind.CONTACT;
    const reason = textField(body, 'reason', MAX_TEXT, family);
    return this.close(actorId, lessonId, 'apology', LessonOutcome.STUDENT_APOLOGY, reason, async (tx, lesson, recorder, lang) => {
      const noticeMinutes = Math.max(0, Math.round((lesson.startsAt.getTime() - Date.now()) / 60_000));
      await this.postCard(
        tx, lesson, recorder, CardKind.LESSON_APOLOGY,
        { ...this.cardBase(lesson), timing: 'before_start', noticeMinutes, makeupOwed: true, ...(family ? { reason } : {}) },
        lang,
      );
    }, !family && reason === null ? 'student excused before the start' : null);
  }

  /**
   * The teacher cannot teach, before the start -- recorded by the teacher or,
   * PD-15, by a supervisor. The reason stays with the lesson for staff; the
   * family's card says only that a make-up follows.
   */
  async teacherApology(actorId: string, lessonId: string, body: Record<string, unknown>) {
    const reason = textField(body, 'reason', MAX_TEXT, true) as string;
    return this.close(actorId, lessonId, 'teacher_apology', LessonOutcome.TEACHER_APOLOGY, reason, async (tx, lesson, actor, lang) => {
      await this.postCard(
        tx, lesson, actor, CardKind.LESSON_TEACHER_APOLOGY,
        { ...this.cardBase(lesson), makeupOwed: true },
        lang,
      );
    });
  }

  /**
   * PD-15: the child's supervisor (or the Teachers department) excuses the
   * learner AFTER the start. Unlike a family's late apology, which waits for a
   * ruling, the supervisor's card is the decision: the lesson becomes a student
   * apology timed `after_start` at once, and a ruling decided `excused` records
   * it (the authority chat.guard_lesson needs). The reason is internal: it is
   * kept on the ruling and the audit log, never on the card. If the family
   * already filed a late apology, that ruling is the one decided.
   */
  async lateExcuse(actorId: string, lessonId: string, body: Record<string, unknown>) {
    const reason = textField(body, 'reason', MAX_TEXT, true) as string;
    const actor = await this.conversations.requireActor(actorId);
    const { lesson, standing } = await this.load(actor, lessonId);
    this.requireAct(actor, standing, 'late_excuse');
    const now = new Date();
    if (now < lesson.startsAt) throw stateError('the lesson has not started: record an excuse before the start instead');
    if (now.getTime() > lesson.startsAt.getTime() + LATE_APOLOGY_HOURS * 3_600_000) {
      throw stateError(`an excuse after the start is accepted for ${LATE_APOLOGY_HOURS} hours; correct the lesson instead`);
    }
    if (lesson.outcome !== null && lesson.outcome !== LessonOutcome.STUDENT_NO_SHOW) {
      throw stateError(
        lesson.outcome === LessonOutcome.STUDENT_APOLOGY
          ? 'this lesson is already excused'
          : 'this lesson already has another outcome; correct it instead',
      );
    }
    const existing = lesson.rulings.find((r) => r.kind === RulingKind.LATE_APOLOGY) ?? null;
    if (existing?.decision) throw stateError('a decision on an excuse for this lesson was already recorded; correct the lesson instead');

    const lang = await this.languageOf(lesson);
    await this.write(() =>
      this.prisma.$transaction(async (tx) => {
        const ruling = existing ?? await tx.lessonRuling.create({
          data: {
            organizationId: lesson.organizationId,
            lessonId: lesson.id,
            kind: RulingKind.LATE_APOLOGY,
            openedByKind: ActorKind.STAFF,
            openedBy: actor.actorId,
            reason,
          },
        });
        await tx.lessonRuling.update({
          where: { id: ruling.id },
          data: { decision: RulingDecision.EXCUSED, decidedBy: actor.actorId, decidedAt: now, decisionNote: reason },
        });
        const updated = await tx.lesson.update({
          where: { id: lesson.id },
          data: { outcome: LessonOutcome.STUDENT_APOLOGY, outcomeNote: reason, outcomeByKind: ActorKind.STAFF, outcomeBy: actor.actorId, outcomeAt: now },
        });
        await this.emitClosed(tx, updated, lesson.outcome !== null);
        await this.postCard(
          tx, lesson, actor, CardKind.LESSON_APOLOGY,
          { ...this.cardBase(lesson), timing: 'after_start', makeupOwed: true },
          lang,
        );
        await this.audit.audit(tx, {
          actorId: actor.actorId,
          action: 'lesson.student_excused_after_start',
          entity: 'lesson',
          entityId: lesson.id,
          before: { outcome: lesson.outcome },
          after: { outcome: LessonOutcome.STUDENT_APOLOGY, apologyTiming: 'after_start', rulingId: ruling.id },
          reason,
        });
      }),
    );
    return this.get(actorId, lessonId);
  }

  /** Jawwid cancels a lesson. The reason is mandatory and the family is told. */
  async cancel(actorId: string, lessonId: string, body: Record<string, unknown>) {
    const reason = textField(body, 'reason', MAX_TEXT, true) as string;
    return this.close(actorId, lessonId, 'cancel', LessonOutcome.ADMIN_CANCELLED, reason, async (tx, lesson, _actor, lang) => {
      await this.postCard(tx, lesson, null, CardKind.LESSON_CANCELLED, { ...this.cardBase(lesson), outcome: LessonOutcome.ADMIN_CANCELLED, reason }, lang);
    });
  }

  /** The teacher did not come. Recorded by the Teachers department; a make-up is owed. */
  async teacherNoShow(actorId: string, lessonId: string, body: Record<string, unknown>) {
    const note = textField(body, 'note', MAX_TEXT, true) as string;
    return this.close(actorId, lessonId, 'teacher_no_show', LessonOutcome.TEACHER_NO_SHOW, note, async (tx, lesson, _actor, lang) => {
      await this.postCard(
        tx, lesson, null, CardKind.LESSON_CANCELLED,
        { ...this.cardBase(lesson), outcome: LessonOutcome.TEACHER_NO_SHOW, makeupOwed: true },
        lang,
      );
    });
  }

  /**
   * Case 2c: the family apologises after the start (an emergency). It opens a
   * ruling and changes nothing else: the lesson stays credited to the teacher
   * until a supervisor excuses it.
   */
  async lateApology(actorId: string, lessonId: string, body: Record<string, unknown>) {
    const reason = textField(body, 'reason', MAX_TEXT, true) as string;
    const actor = await this.conversations.requireActor(actorId);
    const { lesson, standing } = await this.load(actor, lessonId);
    this.requireAct(actor, standing, 'late_apology');
    const now = new Date();
    if (now < lesson.startsAt) throw stateError('the lesson has not started: send an apology instead');
    if (now.getTime() > lesson.startsAt.getTime() + LATE_APOLOGY_HOURS * 3_600_000) {
      throw stateError(`a late apology is accepted for ${LATE_APOLOGY_HOURS} hours after the start`);
    }
    if (lesson.outcome !== null && lesson.outcome !== LessonOutcome.STUDENT_NO_SHOW) {
      throw stateError('a late apology applies only to an absence');
    }
    if (lesson.rulings.some((r) => r.kind === RulingKind.LATE_APOLOGY)) throw stateError('a late apology was already filed');

    const lang = await this.languageOf(lesson);
    await this.write(() =>
      this.prisma.$transaction(async (tx) => {
        const ruling = await tx.lessonRuling.create({
          data: {
            organizationId: lesson.organizationId,
            lessonId: lesson.id,
            kind: RulingKind.LATE_APOLOGY,
            openedByKind: ActorKind.CONTACT,
            openedBy: actor.actorId,
            reason,
          },
        });
        await this.postCard(
          tx, lesson, actor, CardKind.LESSON_LATE_APOLOGY,
          { ...this.cardBase(lesson), reason, rulingId: ruling.id },
          lang,
        );
        await this.audit.audit(tx, {
          actorId: actor.actorId,
          action: 'lesson.late_apology',
          entity: 'lesson',
          entityId: lesson.id,
          after: { rulingId: ruling.id },
          reason,
        });
      }),
    );
    return this.get(actorId, lessonId);
  }

  /**
   * A supervisor decides a late apology. `excused` turns the lesson into a
   * student apology (the one change chat.guard_lesson allows, because this
   * ruling now says so); `teacher_credited` keeps -- or, if the teacher had not
   * closed it yet, records -- the absence. Either way the family is told.
   */
  async decideRuling(actorId: string, rulingId: string, body: Record<string, unknown>) {
    if (!isUuid(rulingId)) throw new CommError(CommErrorCode.LESSON_NOT_FOUND, 'ruling not found');
    const decision = body.decision;
    if (decision !== RulingDecision.EXCUSED && decision !== RulingDecision.TEACHER_CREDITED) {
      throw invalid(`decision: one of ${RulingDecision.EXCUSED}, ${RulingDecision.TEACHER_CREDITED}`);
    }
    const note = textField(body, 'note', MAX_TEXT, false);
    const actor = await this.conversations.requireActor(actorId);
    const ruling = await this.prisma.lessonRuling.findUnique({ where: { id: rulingId } });
    if (!ruling) throw new CommError(CommErrorCode.LESSON_NOT_FOUND, 'ruling not found');
    const { lesson, standing } = await this.load(actor, ruling.lessonId);
    this.requireAct(actor, standing, 'decide_ruling');
    if (ruling.decision !== null) throw stateError('this ruling is already decided');

    const lang = await this.languageOf(lesson);
    await this.write(() =>
      this.prisma.$transaction(async (tx) => {
        await tx.lessonRuling.update({
          where: { id: ruling.id },
          data: { decision, decidedBy: actor.actorId, decidedAt: new Date(), decisionNote: note },
        });
        const outcome = decision === RulingDecision.EXCUSED ? LessonOutcome.STUDENT_APOLOGY : LessonOutcome.STUDENT_NO_SHOW;
        if (lesson.outcome !== outcome) {
          const updated = await tx.lesson.update({
            where: { id: lesson.id },
            data: { outcome, outcomeNote: note ?? ruling.reason, outcomeByKind: ActorKind.STAFF, outcomeBy: actor.actorId, outcomeAt: new Date() },
          });
          await this.emitClosed(tx, updated, lesson.outcome !== null);
          await this.recordAttendance(tx, updated, actor, lesson.learner.familyId);
        }
        await this.postCard(
          tx, lesson, null, CardKind.LESSON_RULING,
          { ...this.cardBase(lesson), rulingId: ruling.id, decision, note },
          lang,
        );
        await this.audit.audit(tx, {
          actorId: actor.actorId,
          action: 'lesson.ruling_decided',
          entity: 'lesson',
          entityId: lesson.id,
          before: { outcome: lesson.outcome },
          after: { rulingId: ruling.id, decision, outcome },
          reason: note ?? `late apology ${decision}`,
        });
      }),
    );
    return this.get(actorId, lesson.id);
  }

  // ------------------------------------------------------------------
  // Internals. The non-private ones are shared with SchedulingService, which
  // posts its cards and loads its lessons exactly as the tickets above do.
  // ------------------------------------------------------------------

  /** Close an open lesson with `outcome`, run the ticket's own writes, and tell Core -- one transaction. */
  private async close(
    actorId: string,
    lessonId: string,
    act: LessonAct,
    outcome: string,
    outcomeNote: string | null,
    then: (tx: Tx, lesson: LessonWithRelations, actor: Actor, lang: CardLanguage) => Promise<void>,
    /** PD-15: audit a close that carries no note (a supervisor's excuse before the start) under this reason. */
    auditReason: string | null = null,
  ) {
    const actor = await this.conversations.requireActor(actorId);
    const { lesson, standing } = await this.load(actor, lessonId);
    this.requireAct(actor, standing, act);
    if (lesson.outcome !== null) throw stateError('this lesson is already closed');
    const now = new Date();
    const afterStart = outcome === LessonOutcome.HELD || outcome === LessonOutcome.STUDENT_NO_SHOW || outcome === LessonOutcome.TEACHER_NO_SHOW;
    const beforeStart = outcome === LessonOutcome.STUDENT_APOLOGY || outcome === LessonOutcome.TEACHER_APOLOGY;
    if (afterStart && now < lesson.startsAt) throw stateError('the lesson has not started yet');
    if (beforeStart && now >= lesson.startsAt) {
      throw stateError(
        outcome === LessonOutcome.STUDENT_APOLOGY
          ? 'the lesson has started: file a late apology instead'
          : 'the lesson has started: a missed lesson is recorded by the Teachers department',
      );
    }

    const lang = await this.languageOf(lesson);
    await this.write(() =>
      this.prisma.$transaction(async (tx) => {
        const updated = await tx.lesson.update({
          where: { id: lesson.id },
          data: {
            outcome,
            outcomeNote,
            outcomeByKind: actor.kind,
            outcomeBy: actor.actorId,
            outcomeAt: now,
          },
        });
        await then(tx, lesson, actor, lang);
        // A lesson that will not happen reminds nobody -- in the same
        // transaction, so a reminder can never outlive the cancellation.
        if (beforeStart || outcome === LessonOutcome.ADMIN_CANCELLED) await cancelReminders(tx, lesson.id);
        await this.emitClosed(tx, updated, false);
        await this.recordAttendance(tx, updated, actor, lesson.learner.familyId);
        if ((outcomeNote !== null || auditReason !== null) && act !== 'report') {
          await this.audit.audit(tx, {
            actorId: actor.actorId,
            action: `lesson.${outcome}`,
            entity: 'lesson',
            entityId: lesson.id,
            after: { outcome, ...(updated.apologyTiming ? { apologyTiming: updated.apologyTiming } : {}) },
            reason: outcomeNote ?? (auditReason as string),
          });
        }
      }),
    );
    return this.get(actorId, lessonId);
  }

  async emitClosed(tx: Tx, lesson: Lesson, correction: boolean) {
    await this.outbox.enqueue(tx, CommEvent.LESSON_CLOSED, {
      lessonId: lesson.id,
      learnerId: lesson.learnerId,
      teacherId: lesson.teacherId,
      kind: lesson.kind,
      outcome: lesson.outcome as string,
      startsAt: lesson.startsAt.toISOString(),
      endsAt: lesson.endsAt.toISOString(),
      correction,
    });
  }

  /** PD-9 keeps the class_attended / class_missed vocabulary and emits it from outcomes. */
  async recordAttendance(tx: Tx, lesson: Lesson, actor: Actor, familyId: string) {
    const type =
      lesson.outcome === LessonOutcome.HELD ? 'class_attended'
        : lesson.outcome === LessonOutcome.STUDENT_NO_SHOW ? 'class_missed'
          : null;
    if (!type) return;
    await this.audit.event(tx, {
      familyId,
      actorKind: actor.kind,
      actorId: actor.actorId,
      type,
      payload: { lessonId: lesson.id, learnerId: lesson.learnerId, teacherId: lesson.teacherId },
    });
  }

  /**
   * Post one card into the learner's live student group, in the caller's
   * transaction. It bypasses moderation (PD-9 default 1): it carries a record,
   * not free speech, and a held report would leave the parent blind while the
   * statistics already counted it. The author is the person who recorded it
   * when they are a live member of the group, and Jawwid otherwise. Returns
   * null when the learner has no live student group: the record stands, and
   * the parent's child page still shows it.
   */
  async postCard(
    tx: Tx,
    lesson: CardSubject,
    recorder: Actor | null,
    kind: string,
    payload: Record<string, unknown>,
    lang: CardLanguage,
  ): Promise<string | null> {
    const conv = await this.groupFor(tx, lesson);
    if (!conv) return null;
    return this.postCardInto(tx, conv, lesson.id, recorder, kind, payload, lang);
  }

  /**
   * Post one card into a given conversation (a learner's group, or -- T3 -- a
   * teacher's supervision chat), in the caller's transaction. Same rules as
   * postCard: published, authored by the recorder when they are a live member,
   * by Jawwid otherwise.
   */
  async postCardInto(
    tx: Tx,
    conv: Conversation,
    lessonId: string | null,
    recorder: Actor | null,
    kind: string,
    payload: Record<string, unknown>,
    lang: CardLanguage,
  ): Promise<string> {
    const locked = await tx.$queryRaw<Array<{ last_seq: bigint }>>`
      SELECT last_seq FROM chat.conversation WHERE id = ${conv.id}::uuid FOR UPDATE`;
    const seq = locked[0].last_seq + BigInt(1);
    const members = await tx.conversationMember.findMany({ where: { conversationId: conv.id, leftAt: null } });
    const asMember = recorder !== null && members.some((m) => m.actorId === recorder.actorId);
    const author = asMember ? recorder : null;
    if (author) await this.conversations.assertActorLive(tx, author);

    const now = new Date();
    const body = renderCardBody(kind, payload, lang);
    const message = await tx.message.create({
      data: {
        organizationId: conv.organizationId,
        conversationId: conv.id,
        authorType: author ? author.kind : ActorKind.SYSTEM,
        authorId: author ? author.actorId : null,
        // A staff member recording a card in a chat they belong to speaks as
        // themselves (chat.message requires staff to declare a mode).
        onBehalfMode: author?.kind === ActorKind.STAFF ? OnBehalfMode.OWNER : null,
        type: MessageType.CARD,
        body,
        visibility: Visibility.CUSTOMER,
        moderation: Moderation.PUBLISHED,
        origin: author ? Origin.USER : Origin.AUTOMATION,
        seq,
        attachmentsJson: [],
      },
    });
    await tx.messageCard.create({
      data: { messageId: message.id, organizationId: conv.organizationId, kind, lessonId, payload: payload as Prisma.InputJsonValue },
    });
    const recipients = members.filter((m) => m.actorId !== author?.actorId);
    if (recipients.length > 0) {
      await tx.messageReceipt.createMany({
        data: recipients.map((r) => ({ messageId: message.id, actorId: r.actorId, state: ReceiptState.SENT })),
        skipDuplicates: true,
      });
    }
    const updated = await tx.conversation.update({ where: { id: conv.id }, data: { lastSeq: seq, lastActivityAt: now } });
    await this.outbox.enqueue(tx, CommEvent.MESSAGE_CREATED, {
      conversationId: conv.id,
      messageId: message.id,
      seq: seq.toString(),
      authorKind: message.authorType,
      authorId: message.authorId,
      type: message.type,
      visibility: message.visibility,
      moderation: message.moderation,
      createdAt: message.createdAt.toISOString(),
    });
    await this.outbox.enqueue(tx, CommEvent.CONVERSATION_UPDATED, {
      conversationId: updated.id,
      familyId: updated.familyId,
      state: conversationState(updated),
      needsReply: needsReply(updated),
      lastActivityAt: updated.lastActivityAt.toISOString(),
      handlerId: await this.conversations.responsibleSupervisor(conv),
    });
    await this.audit.event(tx, {
      familyId: conv.familyId,
      actorKind: author ? author.kind : ActorKind.SYSTEM,
      actorId: author ? author.actorId : null,
      type: 'message_sent',
      payload: { conversationId: conv.id, messageId: message.id, type: MessageType.CARD, card: kind, lessonId },
    });
    return message.id;
  }

  /**
   * Where a lesson's card is posted: the learner's live student group, or else a
   * live PD-8 family group that is about the learner and that the lesson's
   * teacher is in. Both belong to ONE family (chat.conversation_learner holds a
   * single family's children), so a card never reaches another family.
   */
  async groupFor(tx: Tx, lesson: CardSubject) {
    const own = await tx.conversation.findFirst({
      where: { type: ConversationType.STUDENT_GROUP, learnerId: lesson.learnerId, archivedAt: null, organizationId: lesson.organizationId },
      orderBy: { createdAt: 'desc' },
    });
    if (own) return own;
    const rows = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT c.id::text AS id
        FROM chat.conversation c
        JOIN chat.conversation_learner cl ON cl.conversation_id = c.id
       WHERE cl.learner_id = ${lesson.learnerId}::uuid
         AND c.type = 'family_group'
         AND c.archived_at IS NULL
         AND c.organization_id = ${lesson.organizationId}::uuid
         AND EXISTS (SELECT 1 FROM chat.conversation_member m
                      WHERE m.conversation_id = c.id AND m.actor_id = ${lesson.teacherId}::uuid AND m.left_at IS NULL)
       ORDER BY c.created_at DESC
       LIMIT 1`;
    return rows.length ? tx.conversation.findUnique({ where: { id: rows[0].id } }) : null;
  }

  /** The learners a group is about: a student group's one, or a family group's chat.conversation_learner rows. */
  async learnersOf(conv: { id: string; type: string; learnerId: string | null }): Promise<string[]> {
    if (conv.type === ConversationType.STUDENT_GROUP) return conv.learnerId ? [conv.learnerId] : [];
    if (conv.type === ConversationType.FAMILY_GROUP) {
      const rows = await this.prisma.conversationLearner.findMany({ where: { conversationId: conv.id }, select: { learnerId: true } });
      return rows.map((r) => r.learnerId);
    }
    return [];
  }

  cardBase(lesson: LessonWithRelations) {
    return {
      lessonId: lesson.id,
      learnerName: lesson.learner.name,
      teacherName: lesson.teacher.name,
      startsAt: lesson.startsAt.toISOString(),
      endsAt: lesson.endsAt.toISOString(),
      durationMinutes: Math.round((lesson.endsAt.getTime() - lesson.startsAt.getTime()) / 60_000),
    };
  }

  /** Load a lesson the actor may see. A lesson they may not see is answered exactly as an unknown one. */
  async load(actor: Actor, lessonId: string): Promise<{ lesson: LessonWithRelations; standing: LessonStanding }> {
    if (!isUuid(lessonId)) throw new CommError(CommErrorCode.LESSON_NOT_FOUND, 'lesson not found');
    const row = await this.prisma.lesson.findUnique({ where: { id: lessonId }, include: LESSON_INCLUDE });
    // A trial is TrialService's; here it is answered exactly as an unknown lesson.
    if (!row || row.kind === LessonKind.TRIAL) throw new CommError(CommErrorCode.LESSON_NOT_FOUND, 'lesson not found');
    const lesson = learnerLesson(row);
    const staff = actor.kind === ActorKind.STAFF;
    const standing = this.authz.lessonStanding(actor, this.scopeOf(lesson), {
      teachersDepartment: staff ? await this.isManager(actor) : false,
      supervisesLearner: staff ? (await this.supervisedLearnerIds(actor, new Date(), lesson.learnerId)).length > 0 : false,
    });
    if (!standing) throw new CommError(CommErrorCode.LESSON_NOT_FOUND, 'lesson not found');
    return { lesson, standing };
  }

  scopeOf(lesson: LessonWithRelations) {
    return { organizationId: lesson.organizationId, teacherId: lesson.teacherId, familyId: lesson.learner.familyId };
  }

  requireAct(actor: Actor, standing: LessonStanding, act: LessonAct) {
    const d = this.authz.canRecordLessonAct(actor, standing, act);
    if (!d.allowed) throw new CommError(d.code, d.reason);
  }

  async requireManager(actor: Actor) {
    const d = this.authz.canManageLessons(actor, actor.organizationId ?? '', { teachersDepartment: await this.isManager(actor) });
    if (!d.allowed) throw new CommError(CommErrorCode.LESSON_DENIED, d.reason);
  }

  /** The actor manages or belongs to the organization's Teachers department. */
  async isManager(actor: Actor): Promise<boolean> {
    return this.inDepartment(actor, 'teachers');
  }

  /** The actor manages or belongs to the organization's `kind` department (PD-8). */
  async inDepartment(actor: Actor, kind: 'teachers' | 'sales' | 'operations'): Promise<boolean> {
    if (actor.kind !== ActorKind.STAFF || !actor.organizationId || !actor.isActive) return false;
    const rows = await this.prisma.$queryRaw<Array<{ ok: boolean }>>`
      SELECT EXISTS (
        SELECT 1 FROM chat.department d
         WHERE d.organization_id = ${actor.organizationId}::uuid
           AND d.kind = ${kind}
           AND (d.manager_id = ${actor.actorId}::uuid
                OR EXISTS (SELECT 1 FROM chat.department_member m
                            WHERE m.department_id = d.id AND m.staff_id = ${actor.actorId}::uuid))
      ) AS ok`;
    return rows[0]?.ok === true;
  }

  /** Learners whose PD-8 supervisor is one of the actor's principals (optionally just `only`). */
  async supervisedLearnerIds(actor: Actor, at: Date, only?: string): Promise<string[]> {
    const rows = await this.prisma.$queryRaw<Array<{ learner_id: string }>>`
      SELECT ls.learner_id::text AS learner_id
        FROM chat.learner_supervision ls
       WHERE ls.organization_id = ${actor.organizationId}::uuid
         AND ls.supervisor_id IN (SELECT chat.staff_principals(${actor.actorId}::uuid, ${at}::timestamptz))
         AND (${only ?? null}::uuid IS NULL OR ls.learner_id = ${only ?? null}::uuid)`;
    return rows.map((r) => r.learner_id);
  }

  async languageOf(lesson: { learner: { familyId: string } }): Promise<CardLanguage> {
    const family = await this.prisma.family.findUnique({ where: { id: lesson.learner.familyId }, select: { language: true } });
    return family?.language === 'en' ? 'en' : 'ar';
  }

  async escalationMs(): Promise<number> {
    return Number(await this.config.get('lesson.escalation_after_minutes')) * 60_000;
  }

  /** Map the database's refusal to a stable code: the triggers have the last word. */
  async write<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (e) {
      if (e instanceof CommError) throw e;
      const text = e instanceof Error ? e.message : String(e);
      if (/23P01|lesson_teacher_is_never_double_booked/.test(text)) {
        throw new CommError(CommErrorCode.LESSON_TEACHER_BUSY, 'the teacher already has a lesson at that time', 409);
      }
      // A unique index refusing a second live record (a second make-up, a second
      // pending request) is a state answer, not a server error.
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new CommError(CommErrorCode.LESSON_STATE, 'this was already done', 409);
      }
      if (/23505|23514|check_violation|unique constraint/i.test(text)) {
        const reason = /message: "([^"]+)"/.exec(text)?.[1] ?? 'the lesson does not allow this';
        throw new CommError(CommErrorCode.LESSON_STATE, reason, 409);
      }
      throw e;
    }
  }

  toDto(lesson: LessonWithRelations, standing: LessonStanding, now: Date, escalationMs: number) {
    const ruling = lesson.rulings.find((r) => r.kind === RulingKind.LATE_APOLOGY) ?? null;
    const staffView = standing === 'manager' || standing === 'supervisor';
    return {
      id: lesson.id,
      learner: { id: lesson.learner.id, name: lesson.learner.name },
      teacher: { id: lesson.teacher.id, name: lesson.teacher.name },
      kind: lesson.kind,
      makeupFor: lesson.makeupFor,
      startsAt: lesson.startsAt.toISOString(),
      endsAt: lesson.endsAt.toISOString(),
      durationMinutes: Math.round((lesson.endsAt.getTime() - lesson.startsAt.getTime()) / 60_000),
      phase: phaseOf(lesson, now, escalationMs),
      outcome: lesson.outcome,
      apologyTiming: lesson.apologyTiming,
      // PD-15: internal reasons (a teacher's apology, a supervisor's excuse, a
      // correction) are staff's. A family reads only its own apology's reason
      // and a cancellation's, which its card already told it.
      outcomeNote: staffView || standing === 'teacher' || familyMayReadNote(lesson) ? lesson.outcomeNote : null,
      outcomeAt: lesson.outcomeAt?.toISOString() ?? null,
      // Who recorded it is staff-facing; a family sees what happened, not whom to blame.
      outcomeBy: staffView
        ? (lesson.outcomeBy ? { kind: lesson.outcomeByKind, id: lesson.outcomeBy } : null)
        : undefined,
      report: lesson.report && (lesson.report.deletedAt === null || staffView)
        ? {
            lessonNumber: lesson.report.lessonNumber,
            coveredTopics: lesson.report.coveredTopics,
            covered: lesson.report.covered,
            rating: lesson.report.rating,
            nextTasks: lesson.report.nextTasks,
            homework: lesson.report.homework,
            // The private note: the teacher who wrote it and staff only.
            ...(staffView || standing === 'teacher' ? { note: lesson.report.note } : {}),
            submittedAt: lesson.report.submittedAt.toISOString(),
            updatedAt: lesson.report.updatedAt.toISOString(),
            version: lesson.report.version,
            enteredBy: staffView ? { kind: lesson.report.enteredByKind, id: lesson.report.enteredBy } : undefined,
            deletedAt: lesson.report.deletedAt?.toISOString() ?? null,
            messageId: lesson.report.messageId,
          }
        : null,
      // A supervisor's excuse keeps its reason on the ruling: staff's only.
      ruling: ruling && (staffView || ruling.openedByKind === ActorKind.CONTACT) ? rulingDto(ruling) : null,
      corrections: staffView
        ? (lesson.corrections ?? []).map((c) => ({
            id: c.id,
            from: c.fromOutcome,
            to: c.toOutcome,
            apologyTiming: c.apologyTiming,
            reason: c.reason,
            by: c.correctedBy,
            at: c.correctedAt.toISOString(),
          }))
        : undefined,
    };
  }
}

function rulingDto(r: LessonRuling) {
  return {
    id: r.id,
    kind: r.kind,
    reason: r.reason,
    openedAt: r.openedAt.toISOString(),
    decision: r.decision,
    decisionNote: r.decisionNote,
    decidedAt: r.decidedAt?.toISOString() ?? null,
  };
}

export function phaseOf(lesson: Pick<Lesson, 'outcome' | 'startsAt' | 'endsAt'>, now: Date, escalationMs: number): LessonPhase {
  if (lesson.outcome !== null) return 'closed';
  if (now < lesson.startsAt) return 'upcoming';
  if (now < lesson.endsAt) return 'in_progress';
  return now.getTime() >= lesson.endsAt.getTime() + escalationMs ? 'overdue' : 'awaiting_close';
}

/** The tickets a lesson's state and the clock allow -- before asking who may open them. */
export function availableActs(lesson: Pick<Lesson, 'outcome' | 'startsAt'> & { rulings: Pick<LessonRuling, 'kind' | 'decision'>[] }, now: Date): LessonAct[] {
  const started = now >= lesson.startsAt;
  const acts: LessonAct[] = [];
  if (lesson.outcome === null) {
    if (started) acts.push('report', 'absence');
    else acts.push('apology', 'teacher_apology');
  }
  const withinLate = started && now.getTime() <= lesson.startsAt.getTime() + LATE_APOLOGY_HOURS * 3_600_000;
  const absentOrOpen = lesson.outcome === null || lesson.outcome === LessonOutcome.STUDENT_NO_SHOW;
  if (withinLate && absentOrOpen && !lesson.rulings.some((r) => r.kind === RulingKind.LATE_APOLOGY)) {
    acts.push('late_apology');
  }
  // PD-15: a supervisor's excuse after the start -- also when the family's own
  // late apology is still waiting, which it then decides.
  if (withinLate && absentOrOpen && !lesson.rulings.some((r) => r.kind === RulingKind.LATE_APOLOGY && r.decision !== null)) {
    acts.push('late_excuse');
  }
  return acts;
}

/** The outcomes that owe a make-up (PD-15): the teacher's misses and the student's apologies. */
export const MAKEUP_CAUSES = ['teacher_apology', 'teacher_no_show', 'student_apology'] as const;
/** The ones the follow-up queue escalates when no make-up is booked: the teacher's (PD-11 T2). */
export const TEACHER_MAKEUP_CAUSES = ['teacher_apology', 'teacher_no_show'] as const;

function familyMayReadNote(lesson: Pick<Lesson, 'outcome' | 'outcomeByKind'>): boolean {
  return lesson.outcome === LessonOutcome.ADMIN_CANCELLED
    || (lesson.outcome === LessonOutcome.STUDENT_APOLOGY && lesson.outcomeByKind === ActorKind.CONTACT);
}

export interface ReportFields {
  lessonNumber: number | null;
  coveredTopics: string[];
  covered: string | null;
  rating: number | null;
  nextTasks: string[];
  homework: string | null;
  note: string | null;
}

/**
 * The fields of a lesson report (PD-15). What was covered is required: at
 * least one topic choice or a short text. Everything else is optional.
 */
export function reportFields(body: Record<string, unknown>): ReportFields {
  const coveredTopics = codeList(body, 'coveredTopics', Object.keys(COVERED_TOPICS));
  const covered = textField(body, 'covered', MAX_TEXT, false);
  if (coveredTopics.length === 0 && covered === null) throw invalid('coveredTopics or covered: say what the lesson covered');
  return {
    lessonNumber: lessonNumberField(body),
    coveredTopics,
    covered,
    rating: ratingField(body),
    nextTasks: codeList(body, 'nextTasks', Object.keys(NEXT_TASKS)),
    homework: textField(body, 'homework', MAX_SHORT, false),
    note: textField(body, 'note', MAX_NOTE, false),
  };
}

function codeList(body: Record<string, unknown>, key: string, known: string[]): string[] {
  const v = body[key];
  if (v === undefined || v === null) return [];
  if (!Array.isArray(v) || v.some((c) => typeof c !== 'string' || !known.includes(c))) {
    throw invalid(`${key}: a list of ${known.join(', ')}`);
  }
  return [...new Set(v as string[])];
}

function lessonNumberField(body: Record<string, unknown>): number | null {
  const v = body.lessonNumber;
  if (v === undefined || v === null) return null;
  if (typeof v !== 'number' || !Number.isInteger(v) || v < 1 || v > 9999) throw invalid('lessonNumber: an integer from 1 to 9999');
  return v;
}

/** ReminderService.cancelForSubject, inside the caller's transaction. */
export async function cancelReminders(tx: Tx, lessonId: string): Promise<void> {
  await tx.notification.updateMany({
    where: { status: 'scheduled', dedupeKey: { contains: `:${lessonId}:` } },
    data: { status: 'cancelled' },
  });
}

export function invalid(reason: string) {
  return new CommError(CommErrorCode.VALIDATION, reason, 400);
}
export function stateError(reason: string) {
  return new CommError(CommErrorCode.LESSON_STATE, reason, 409);
}
export function uuidField(body: Record<string, unknown>, key: string): string {
  const v = body[key];
  if (typeof v !== 'string' || !isUuid(v)) throw invalid(`${key}: must be a uuid`);
  return v;
}
export function optionalUuidField(body: Record<string, unknown>, key: string): string | null {
  if (body[key] === undefined || body[key] === null) return null;
  return uuidField(body, key);
}
export function parseDate(v: string, key: string): Date {
  const d = new Date(v);
  if (Number.isNaN(d.getTime()) || !/^\d{4}-\d{2}-\d{2}T/.test(v)) throw invalid(`${key}: must be an ISO-8601 timestamp`);
  return d;
}
export function dateField(body: Record<string, unknown>, key: string): Date {
  const v = body[key];
  if (typeof v !== 'string') throw invalid(`${key}: must be an ISO-8601 timestamp`);
  return parseDate(v, key);
}
export function textField(body: Record<string, unknown>, key: string, max: number, required: boolean): string | null {
  const v = body[key];
  if (v === undefined || v === null || (typeof v === 'string' && v.trim() === '')) {
    if (required) throw invalid(`${key}: required`);
    return null;
  }
  if (typeof v !== 'string') throw invalid(`${key}: must be text`);
  const t = v.trim();
  if (t.length > max) throw invalid(`${key}: at most ${max} characters`);
  return t;
}
export function ratingField(body: Record<string, unknown>): number | null {
  const v = body.rating;
  if (v === undefined || v === null) return null;
  if (typeof v !== 'number' || !Number.isInteger(v) || v < 1 || v > 5) throw invalid('rating: an integer from 1 to 5');
  return v;
}
