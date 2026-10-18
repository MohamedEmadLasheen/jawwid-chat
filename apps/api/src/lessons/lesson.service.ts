import { Inject, Injectable } from '@nestjs/common';
import { Lesson, LessonReport, LessonRuling, Prisma } from '@prisma/client';
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
  Origin,
  ReceiptState,
  RulingDecision,
  RulingKind,
  Visibility,
} from '../communication/contracts/vocab';
import { renderCardBody, type CardLanguage } from './lesson-card';

type Tx = Prisma.TransactionClient;

type LessonWithRelations = Lesson & {
  report: LessonReport | null;
  rulings: LessonRuling[];
  learner: { id: string; name: string; familyId: string };
  teacher: { id: string; name: string };
};

const LESSON_INCLUDE = {
  report: true,
  rulings: true,
  learner: { select: { id: true, name: true, familyId: true } },
  teacher: { select: { id: true, name: true } },
} as const;

/** Where an open lesson is in its day, as the needs-action list and the clients sort it. */
export type LessonPhase = 'upcoming' | 'in_progress' | 'awaiting_close' | 'overdue' | 'closed';

/** A late apology is accepted this long after the start -- chat.guard_lesson_ruling's rule. */
const LATE_APOLOGY_HOURS = 48;
const MAX_TEXT = 1000;
const MAX_NOTE = 2000;
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
    if (!learner.teacherId) throw state('the learner has no assigned teacher');

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
        });
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
    return { lessons: rows.map((l) => this.toDto(l, standing, now, escalation)) };
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
      where: { organizationId: actor.organizationId, outcome: null, endsAt: { lte: now } },
      include: LESSON_INCLUDE,
      orderBy: { endsAt: 'asc' },
      take: 500,
    });
    const rulings = await this.prisma.lessonRuling.findMany({
      where: { organizationId: actor.organizationId, decision: null },
      include: { lesson: { include: LESSON_INCLUDE } },
      orderBy: { openedAt: 'asc' },
      take: 500,
    });
    const lessons = open.map((l) => this.toDto(l, 'manager', now, escalation));
    return {
      overdue: lessons.filter((l) => l.phase === 'overdue'),
      awaitingClose: lessons.filter((l) => l.phase === 'awaiting_close'),
      rulings: rulings.map((r) => ({
        ...rulingDto(r),
        lesson: this.toDto(r.lesson as LessonWithRelations, 'manager', now, escalation),
      })),
    };
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
    });
    const tickets: Array<{
      ticket: LessonAct;
      lessonId: string;
      learner: { id: string; name: string };
      startsAt: string;
      endsAt: string;
    }> = [];
    for (const l of rows) {
      const standing = this.authz.lessonStanding(actor, this.scopeOf(l), { teachersDepartment: false, supervisesLearner: false });
      if (!standing) continue;
      for (const act of availableActs(l, now)) {
        if (this.authz.canRecordLessonAct(actor, standing, act).allowed) {
          tickets.push({
            ticket: act,
            lessonId: l.id,
            learner: { id: l.learner.id, name: l.learner.name },
            startsAt: l.startsAt.toISOString(),
            endsAt: l.endsAt.toISOString(),
          });
        }
      }
    }
    return { tickets };
  }

  // ------------------------------------------------------------------
  // Tickets
  // ------------------------------------------------------------------

  /** Case 1: the learner attended. The report closes the lesson as held and is posted once. */
  async report(actorId: string, lessonId: string, body: Record<string, unknown>) {
    const covered = textField(body, 'covered', MAX_TEXT, true) as string;
    const homework = textField(body, 'homework', MAX_TEXT, false);
    const note = textField(body, 'note', MAX_NOTE, false);
    const rating = ratingField(body);
    return this.close(actorId, lessonId, 'report', LessonOutcome.HELD, null, async (tx, lesson, actor, lang) => {
      await tx.lessonReport.create({
        data: { lessonId: lesson.id, organizationId: lesson.organizationId, teacherId: lesson.teacherId, covered, homework, rating, note },
      });
      const payload = { ...this.cardBase(lesson), covered, homework, rating, note };
      const messageId = await this.postCard(tx, lesson, actor, CardKind.LESSON_REPORT, payload, lang);
      if (messageId) await tx.lessonReport.update({ where: { lessonId: lesson.id }, data: { messageId } });
    });
  }

  /** Case 2b: no apology and the start has passed -- an absence, credited to the teacher. */
  async absence(actorId: string, lessonId: string, body: Record<string, unknown>) {
    const note = textField(body, 'note', MAX_TEXT, false);
    return this.close(actorId, lessonId, 'absence', LessonOutcome.STUDENT_NO_SHOW, note, async (tx, lesson, actor, lang) => {
      await this.postCard(tx, lesson, actor, CardKind.LESSON_ABSENCE, { ...this.cardBase(lesson), note }, lang);
    });
  }

  /** Case 2a: the family excuses the learner before the start. No report is needed. */
  async apology(actorId: string, lessonId: string, body: Record<string, unknown>) {
    const reason = textField(body, 'reason', MAX_TEXT, true) as string;
    return this.close(actorId, lessonId, 'apology', LessonOutcome.STUDENT_APOLOGY, reason, async (tx, lesson, actor, lang) => {
      const noticeMinutes = Math.max(0, Math.round((lesson.startsAt.getTime() - Date.now()) / 60_000));
      await this.postCard(tx, lesson, actor, CardKind.LESSON_APOLOGY, { ...this.cardBase(lesson), reason, noticeMinutes }, lang);
    });
  }

  /** The teacher cannot teach, before the start. A make-up is owed (PD-11, booked in T2). */
  async teacherApology(actorId: string, lessonId: string, body: Record<string, unknown>) {
    const reason = textField(body, 'reason', MAX_TEXT, true) as string;
    return this.close(actorId, lessonId, 'teacher_apology', LessonOutcome.TEACHER_APOLOGY, reason, async (tx, lesson, actor, lang) => {
      await this.postCard(
        tx, lesson, actor, CardKind.LESSON_TEACHER_APOLOGY,
        { ...this.cardBase(lesson), reason, makeupOwed: true },
        lang,
      );
    });
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
    if (now < lesson.startsAt) throw state('the lesson has not started: send an apology instead');
    if (now.getTime() > lesson.startsAt.getTime() + LATE_APOLOGY_HOURS * 3_600_000) {
      throw state(`a late apology is accepted for ${LATE_APOLOGY_HOURS} hours after the start`);
    }
    if (lesson.outcome !== null && lesson.outcome !== LessonOutcome.STUDENT_NO_SHOW) {
      throw state('a late apology applies only to an absence');
    }
    if (lesson.rulings.some((r) => r.kind === RulingKind.LATE_APOLOGY)) throw state('a late apology was already filed');

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
    if (ruling.decision !== null) throw state('this ruling is already decided');

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
  // Internals
  // ------------------------------------------------------------------

  /** Close an open lesson with `outcome`, run the ticket's own writes, and tell Core -- one transaction. */
  private async close(
    actorId: string,
    lessonId: string,
    act: LessonAct,
    outcome: string,
    outcomeNote: string | null,
    then: (tx: Tx, lesson: LessonWithRelations, actor: Actor, lang: CardLanguage) => Promise<void>,
  ) {
    const actor = await this.conversations.requireActor(actorId);
    const { lesson, standing } = await this.load(actor, lessonId);
    this.requireAct(actor, standing, act);
    if (lesson.outcome !== null) throw state('this lesson is already closed');
    const now = new Date();
    const afterStart = outcome === LessonOutcome.HELD || outcome === LessonOutcome.STUDENT_NO_SHOW || outcome === LessonOutcome.TEACHER_NO_SHOW;
    const beforeStart = outcome === LessonOutcome.STUDENT_APOLOGY || outcome === LessonOutcome.TEACHER_APOLOGY;
    if (afterStart && now < lesson.startsAt) throw state('the lesson has not started yet');
    if (beforeStart && now >= lesson.startsAt) {
      throw state(
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
        await this.emitClosed(tx, updated, false);
        await this.recordAttendance(tx, updated, actor, lesson.learner.familyId);
        if (outcomeNote !== null && act !== 'report') {
          await this.audit.audit(tx, {
            actorId: actor.actorId,
            action: `lesson.${outcome}`,
            entity: 'lesson',
            entityId: lesson.id,
            after: { outcome },
            reason: outcomeNote,
          });
        }
      }),
    );
    return this.get(actorId, lessonId);
  }

  private async emitClosed(tx: Tx, lesson: Lesson, correction: boolean) {
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
  private async recordAttendance(tx: Tx, lesson: Lesson, actor: Actor, familyId: string) {
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
  private async postCard(
    tx: Tx,
    lesson: LessonWithRelations,
    recorder: Actor | null,
    kind: string,
    payload: Record<string, unknown>,
    lang: CardLanguage,
  ): Promise<string | null> {
    const conv = await this.groupFor(tx, lesson);
    if (!conv) return null;
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
      data: { messageId: message.id, organizationId: conv.organizationId, kind, lessonId: lesson.id, payload: payload as Prisma.InputJsonValue },
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
      payload: { conversationId: conv.id, messageId: message.id, type: MessageType.CARD, card: kind, lessonId: lesson.id },
    });
    return message.id;
  }

  /**
   * Where a lesson's card is posted: the learner's live student group, or else a
   * live PD-8 family group that is about the learner and that the lesson's
   * teacher is in. Both belong to ONE family (chat.conversation_learner holds a
   * single family's children), so a card never reaches another family.
   */
  private async groupFor(tx: Tx, lesson: LessonWithRelations) {
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
  private async learnersOf(conv: { id: string; type: string; learnerId: string | null }): Promise<string[]> {
    if (conv.type === ConversationType.STUDENT_GROUP) return conv.learnerId ? [conv.learnerId] : [];
    if (conv.type === ConversationType.FAMILY_GROUP) {
      const rows = await this.prisma.conversationLearner.findMany({ where: { conversationId: conv.id }, select: { learnerId: true } });
      return rows.map((r) => r.learnerId);
    }
    return [];
  }

  private cardBase(lesson: LessonWithRelations) {
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
  private async load(actor: Actor, lessonId: string): Promise<{ lesson: LessonWithRelations; standing: LessonStanding }> {
    if (!isUuid(lessonId)) throw new CommError(CommErrorCode.LESSON_NOT_FOUND, 'lesson not found');
    const lesson = await this.prisma.lesson.findUnique({ where: { id: lessonId }, include: LESSON_INCLUDE });
    if (!lesson) throw new CommError(CommErrorCode.LESSON_NOT_FOUND, 'lesson not found');
    const staff = actor.kind === ActorKind.STAFF;
    const standing = this.authz.lessonStanding(actor, this.scopeOf(lesson), {
      teachersDepartment: staff ? await this.isManager(actor) : false,
      supervisesLearner: staff ? (await this.supervisedLearnerIds(actor, new Date(), lesson.learnerId)).length > 0 : false,
    });
    if (!standing) throw new CommError(CommErrorCode.LESSON_NOT_FOUND, 'lesson not found');
    return { lesson, standing };
  }

  private scopeOf(lesson: LessonWithRelations) {
    return { organizationId: lesson.organizationId, teacherId: lesson.teacherId, familyId: lesson.learner.familyId };
  }

  private requireAct(actor: Actor, standing: LessonStanding, act: LessonAct) {
    const d = this.authz.canRecordLessonAct(actor, standing, act);
    if (!d.allowed) throw new CommError(d.code, d.reason);
  }

  private async requireManager(actor: Actor) {
    const d = this.authz.canManageLessons(actor, actor.organizationId ?? '', { teachersDepartment: await this.isManager(actor) });
    if (!d.allowed) throw new CommError(CommErrorCode.LESSON_DENIED, d.reason);
  }

  /** The actor manages or belongs to the organization's Teachers department. */
  private async isManager(actor: Actor): Promise<boolean> {
    if (actor.kind !== ActorKind.STAFF || !actor.organizationId) return false;
    const rows = await this.prisma.$queryRaw<Array<{ ok: boolean }>>`
      SELECT EXISTS (
        SELECT 1 FROM chat.department d
         WHERE d.organization_id = ${actor.organizationId}::uuid
           AND d.kind = 'teachers'
           AND (d.manager_id = ${actor.actorId}::uuid
                OR EXISTS (SELECT 1 FROM chat.department_member m
                            WHERE m.department_id = d.id AND m.staff_id = ${actor.actorId}::uuid))
      ) AS ok`;
    return rows[0]?.ok === true;
  }

  /** Learners whose PD-8 supervisor is one of the actor's principals (optionally just `only`). */
  private async supervisedLearnerIds(actor: Actor, at: Date, only?: string): Promise<string[]> {
    const rows = await this.prisma.$queryRaw<Array<{ learner_id: string }>>`
      SELECT ls.learner_id::text AS learner_id
        FROM chat.learner_supervision ls
       WHERE ls.organization_id = ${actor.organizationId}::uuid
         AND ls.supervisor_id IN (SELECT chat.staff_principals(${actor.actorId}::uuid, ${at}::timestamptz))
         AND (${only ?? null}::uuid IS NULL OR ls.learner_id = ${only ?? null}::uuid)`;
    return rows.map((r) => r.learner_id);
  }

  private async languageOf(lesson: LessonWithRelations): Promise<CardLanguage> {
    const family = await this.prisma.family.findUnique({ where: { id: lesson.learner.familyId }, select: { language: true } });
    return family?.language === 'en' ? 'en' : 'ar';
  }

  private async escalationMs(): Promise<number> {
    return Number(await this.config.get('lesson.escalation_after_minutes')) * 60_000;
  }

  /** Map the database's refusal to a stable code: the triggers have the last word. */
  private async write<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (e) {
      if (e instanceof CommError) throw e;
      const text = e instanceof Error ? e.message : String(e);
      if (/23P01|lesson_teacher_is_never_double_booked/.test(text)) {
        throw new CommError(CommErrorCode.LESSON_TEACHER_BUSY, 'the teacher already has a lesson at that time', 409);
      }
      if (/23514|check_violation/.test(text)) {
        const reason = /message: "([^"]+)"/.exec(text)?.[1] ?? 'the lesson does not allow this';
        throw new CommError(CommErrorCode.LESSON_STATE, reason, 409);
      }
      throw e;
    }
  }

  private toDto(lesson: LessonWithRelations, standing: LessonStanding, now: Date, escalationMs: number) {
    const ruling = lesson.rulings.find((r) => r.kind === RulingKind.LATE_APOLOGY) ?? null;
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
      outcomeNote: lesson.outcomeNote,
      outcomeAt: lesson.outcomeAt?.toISOString() ?? null,
      // Who recorded it is staff-facing; a family sees what happened, not whom to blame.
      outcomeBy: standing === 'manager' || standing === 'supervisor'
        ? (lesson.outcomeBy ? { kind: lesson.outcomeByKind, id: lesson.outcomeBy } : null)
        : undefined,
      report: lesson.report
        ? {
            covered: lesson.report.covered,
            homework: lesson.report.homework,
            rating: lesson.report.rating,
            note: lesson.report.note,
            submittedAt: lesson.report.submittedAt.toISOString(),
            messageId: lesson.report.messageId,
          }
        : null,
      ruling: ruling ? rulingDto(ruling) : null,
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
export function availableActs(lesson: Pick<Lesson, 'outcome' | 'startsAt'> & { rulings: Pick<LessonRuling, 'kind'>[] }, now: Date): LessonAct[] {
  const started = now >= lesson.startsAt;
  const acts: LessonAct[] = [];
  if (lesson.outcome === null) {
    if (started) acts.push('report', 'absence');
    else acts.push('apology', 'teacher_apology');
  }
  const withinLate = started && now.getTime() <= lesson.startsAt.getTime() + LATE_APOLOGY_HOURS * 3_600_000;
  if (
    withinLate &&
    (lesson.outcome === null || lesson.outcome === LessonOutcome.STUDENT_NO_SHOW) &&
    !lesson.rulings.some((r) => r.kind === RulingKind.LATE_APOLOGY)
  ) {
    acts.push('late_apology');
  }
  return acts;
}

function invalid(reason: string) {
  return new CommError(CommErrorCode.VALIDATION, reason, 400);
}
function state(reason: string) {
  return new CommError(CommErrorCode.LESSON_STATE, reason, 409);
}
function uuidField(body: Record<string, unknown>, key: string): string {
  const v = body[key];
  if (typeof v !== 'string' || !isUuid(v)) throw invalid(`${key}: must be a uuid`);
  return v;
}
function optionalUuidField(body: Record<string, unknown>, key: string): string | null {
  if (body[key] === undefined || body[key] === null) return null;
  return uuidField(body, key);
}
function parseDate(v: string, key: string): Date {
  const d = new Date(v);
  if (Number.isNaN(d.getTime()) || !/^\d{4}-\d{2}-\d{2}T/.test(v)) throw invalid(`${key}: must be an ISO-8601 timestamp`);
  return d;
}
function dateField(body: Record<string, unknown>, key: string): Date {
  const v = body[key];
  if (typeof v !== 'string') throw invalid(`${key}: must be an ISO-8601 timestamp`);
  return parseDate(v, key);
}
function textField(body: Record<string, unknown>, key: string, max: number, required: boolean): string | null {
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
function ratingField(body: Record<string, unknown>): number | null {
  const v = body.rating;
  if (v === undefined || v === null) return null;
  if (typeof v !== 'number' || !Number.isInteger(v) || v < 1 || v > 5) throw invalid('rating: an integer from 1 to 5');
  return v;
}
