import { Inject, Injectable } from '@nestjs/common';
import type { LessonReport, Prisma } from '@prisma/client';
import { PrismaService } from '../platform/prisma.service';
import { CommError, CommErrorCode } from '../platform/errors';
import { AUDIT_SERVICE } from '../platform/tokens';
import type { AuditService } from '../platform/audit.service';
import type { Actor } from '../platform/types';
import { ConversationService } from '../communication/conversations/conversation.service';
import { OutboxService } from '../communication/outbox/outbox.service';
import { CommEvent } from '../communication/contracts/events';
import { ActorKind, CardKind, LessonOutcome } from '../communication/contracts/vocab';
import { renderCardBody } from './lesson-card';
import { parseReportMaterials } from '../materials/report-materials';
import {
  LessonService,
  categoryAfterCorrection,
  invalid,
  reportFields,
  stateError,
  textField,
  type LessonWithRelations,
  type ReportFields,
  type Tx,
} from './lesson.service';

/** The outcomes a correction may write (chat.lesson_correction.to_outcome). */
const CORRECTABLE_TO: ReadonlySet<string> = new Set([
  LessonOutcome.HELD,
  LessonOutcome.STUDENT_APOLOGY,
  LessonOutcome.TEACHER_APOLOGY,
  LessonOutcome.ADMIN_CANCELLED,
  LessonOutcome.STUDENT_NO_SHOW,
  LessonOutcome.TEACHER_NO_SHOW,
  LessonOutcome.VOIDED,
]);
/** Outcomes nothing corrects: replaced, paused, or already removed from the record. */
const NOT_CORRECTABLE: ReadonlySet<string> = new Set([LessonOutcome.RESCHEDULED, LessonOutcome.SUSPENDED, LessonOutcome.VOIDED]);
const TIMINGS: ReadonlySet<string> = new Set(['before_start', 'after_start']);
const MAX_REASON = 1000;

/**
 * PD-15: changing a lesson's record after it was written -- correcting its
 * outcome, editing its report, deleting the report (and resending it, or not).
 *
 * Every change is ONE transaction that writes its own authority first -- a
 * chat.lesson_correction or a chat.lesson_report_revision -- which is the only
 * thing the database triggers accept as a reason to rewrite an outcome, a
 * report or its card. The previous value, the new one, the reason, who and
 * when are therefore always on record (plus chat.audit_log).
 *
 * Statistics follow by construction: they are queries over the lesson rows
 * (20261019100000, 20261021120000), so a corrected lesson is counted once, in
 * its new category, and a voided one nowhere.
 *
 * Who: corrections and deleting reports are the Teachers department's,
 * Operations' (the child's supervisor and the Operations manager) and the
 * super admin's; a teacher edits only their own report (LESSON_ACTS).
 */
@Injectable()
export class LessonRecordService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly lessons: LessonService,
    private readonly conversations: ConversationService,
    private readonly outbox: OutboxService,
    @Inject(AUDIT_SERVICE) private readonly audit: AuditService,
  ) {}

  /**
   * Correct a recorded outcome. `held` needs a report: the lesson's previous
   * one is restored if it has one, otherwise `report` must carry the fields.
   * Leaving `held` withdraws the report and its card. The family's group gets
   * one card saying what the lesson is now recorded as -- never the reason.
   */
  async correct(actorId: string, lessonId: string, body: Record<string, unknown>) {
    const to = typeof body.outcome === 'string' ? body.outcome : '';
    if (!CORRECTABLE_TO.has(to)) throw invalid(`outcome: one of ${[...CORRECTABLE_TO].join(', ')}`);
    const reason = textField(body, 'reason', MAX_REASON, true) as string;
    let apologyTiming: string | null = null;
    if (to === LessonOutcome.STUDENT_APOLOGY) {
      if (typeof body.apologyTiming !== 'string' || !TIMINGS.has(body.apologyTiming)) {
        throw invalid('apologyTiming: before_start or after_start, for a student apology');
      }
      apologyTiming = body.apologyTiming;
    }

    const actor = await this.conversations.requireActor(actorId);
    const { lesson, standing } = await this.lessons.load(actor, lessonId);
    this.lessons.requireAct(actor, standing, 'correct_outcome');
    const from = lesson.outcome;
    if (from === null) throw stateError('this lesson has no outcome yet: record one instead of correcting');
    if (NOT_CORRECTABLE.has(from)) throw stateError(`a ${from} lesson is not corrected`);
    if (from === to) throw stateError('the lesson already has this outcome');
    const started = Date.now() >= lesson.startsAt.getTime();
    if (!started && (to === LessonOutcome.HELD || to === LessonOutcome.STUDENT_NO_SHOW || to === LessonOutcome.TEACHER_NO_SHOW)) {
      throw stateError('a lesson that has not started cannot be held or missed');
    }

    const report = lesson.report;
    let newFields: ReportFields | null = null;
    if (to === LessonOutcome.HELD) {
      const given = body.report && typeof body.report === 'object' ? (body.report as Record<string, unknown>) : null;
      if (given) newFields = reportFields(given);
      else if (!report) throw invalid('report: a lesson corrected to held needs its report (what was covered)');
    }

    const lang = await this.lessons.languageOf(lesson);
    await this.lessons.write(() =>
      this.prisma.$transaction(async (tx) => {
        const correction = await tx.lessonCorrection.create({
          data: {
            organizationId: lesson.organizationId,
            lessonId: lesson.id,
            fromOutcome: from,
            toOutcome: to,
            apologyTiming,
            reason,
            correctedBy: actor.actorId,
          },
        });

        // Leaving `held`: the report stops counting and its card leaves the chat.
        if (from === LessonOutcome.HELD && report && report.deletedAt === null) {
          await this.revise(tx, report, actor, 'delete', reason);
          await tx.lessonReport.update({
            where: { lessonId: lesson.id },
            data: { deletedAt: new Date(), deletedBy: actor.actorId, deleteReason: reason },
          });
          if (report.messageId) await this.retractCard(tx, report.messageId, actor, reason);
        }

        const updated = await tx.lesson.update({
          where: { id: lesson.id },
          data: {
            outcome: to,
            // admin_cancelled must name its reason; every other correction's
            // reason is internal and lives on the correction row.
            outcomeNote: to === LessonOutcome.ADMIN_CANCELLED ? reason : null,
            excuseCategory: categoryAfterCorrection(lesson.outcome, to, lesson.excuseCategory),
            outcomeByKind: ActorKind.STAFF,
            outcomeBy: actor.actorId,
            outcomeAt: new Date(),
          },
        });

        if (to === LessonOutcome.HELD) {
          const fields = await this.reinstateReport(tx, lesson, report, newFields, actor, reason);
          const messageId = await this.lessons.postCard(
            tx, lesson, actor, CardKind.LESSON_REPORT,
            { ...this.lessons.reportPayload(lesson, fields), corrected: true },
            lang,
          );
          if (messageId) await this.revisedUpdate(tx, lesson.id, { messageId });
        } else if (to !== LessonOutcome.VOIDED) {
          await this.lessons.postCard(
            tx, lesson, actor, CardKind.LESSON_CORRECTED,
            { ...this.lessons.cardBase(lesson), outcome: to, previousOutcome: from, apologyTiming: updated.apologyTiming },
            lang,
          );
        }

        await this.lessons.emitClosed(tx, updated, true);
        await this.lessons.recordAttendance(tx, updated, actor, lesson.learner.familyId);
        await this.audit.audit(tx, {
          actorId: actor.actorId,
          action: 'lesson.outcome_corrected',
          entity: 'lesson',
          entityId: lesson.id,
          before: { outcome: from, apologyTiming: lesson.apologyTiming },
          after: { outcome: to, apologyTiming: updated.apologyTiming, correctionId: correction.id },
          reason,
        });
      }),
    );
    return this.lessons.get(actorId, lessonId);
  }

  /**
   * Edit a report: its teacher, or the Teachers / Operations department or the
   * super admin. The whole report is sent again. The card in the group is
   * rewritten in place and marked edited; the previous version is kept.
   */
  async editReport(actorId: string, lessonId: string, body: Record<string, unknown>) {
    const fields = reportFields(body);
    // PD-29: a key the edit leaves out leaves that part as it was.
    const materials = parseReportMaterials(body);
    const actor = await this.conversations.requireActor(actorId);
    const { lesson, standing } = await this.lessons.load(actor, lessonId);
    this.lessons.requireAct(actor, standing, 'edit_report');
    const report = this.liveReport(lesson);
    const lang = await this.lessons.languageOf(lesson);

    await this.lessons.write(() =>
      this.prisma.$transaction(async (tx) => {
        await this.lessons.prepareMaterials(tx, lesson, actor, materials);
        await this.revise(tx, report, actor, 'edit', null);
        await tx.lessonReport.update({ where: { lessonId: lesson.id }, data: { ...fields } });
        await this.lessons.reportMaterials?.writeEdit(tx, lesson, actor, materials);
        if (report.messageId) {
          const practice = this.lessons.reportMaterials ? await this.lessons.reportMaterials.cardPractice(tx, lesson.id) : undefined;
          await this.rewriteCard(tx, report.messageId, actor, this.lessons.reportPayload(lesson, fields, practice), lang);
        }
        await this.audit.audit(tx, {
          actorId: actor.actorId,
          action: 'lesson.report_edited',
          entity: 'lesson',
          entityId: lesson.id,
          before: { version: report.version },
          after: { version: report.version + 1 },
          reason: actor.kind === ActorKind.TEACHER ? 'report edited by its teacher' : 'report edited by staff',
        });
      }),
    );
    return this.lessons.get(actorId, lessonId);
  }

  /**
   * Delete a report (supervisors only). The card leaves the chat either way.
   *   resend: true  -- a corrected version (`report`, or the current one) is
   *                    posted as a new card; the lesson stays held and is
   *                    counted once.
   *   resend: false -- nothing is resent: the lesson is VOIDED and disappears
   *                    from every statistic. The report is kept as history.
   */
  async deleteReport(actorId: string, lessonId: string, body: Record<string, unknown>) {
    const reason = textField(body, 'reason', MAX_REASON, true) as string;
    if (typeof body.resend !== 'boolean') throw invalid('resend: true (send a corrected version) or false (leave it unsent)');
    const resend = body.resend;
    const given = body.report && typeof body.report === 'object' ? reportFields(body.report as Record<string, unknown>) : null;
    if (!resend && given) throw invalid('report: only a resent report carries fields');

    const actor = await this.conversations.requireActor(actorId);
    const { lesson, standing } = await this.lessons.load(actor, lessonId);
    this.lessons.requireAct(actor, standing, 'delete_report');
    const report = this.liveReport(lesson);
    const lang = await this.lessons.languageOf(lesson);

    await this.lessons.write(() =>
      this.prisma.$transaction(async (tx) => {
        if (report.messageId) await this.retractCard(tx, report.messageId, actor, reason);
        if (resend) {
          const fields = given ?? fieldsOf(report);
          await this.revise(tx, report, actor, 'resend', reason);
          const messageId = await this.lessons.postCard(
            tx, lesson, actor, CardKind.LESSON_REPORT, this.lessons.reportPayload(lesson, fields), lang,
          );
          await tx.lessonReport.update({ where: { lessonId: lesson.id }, data: { ...fields, messageId } });
        } else {
          await this.revise(tx, report, actor, 'delete', reason);
          await tx.lessonReport.update({
            where: { lessonId: lesson.id },
            data: { deletedAt: new Date(), deletedBy: actor.actorId, deleteReason: reason },
          });
          await tx.lessonCorrection.create({
            data: {
              organizationId: lesson.organizationId,
              lessonId: lesson.id,
              fromOutcome: LessonOutcome.HELD,
              toOutcome: LessonOutcome.VOIDED,
              reason,
              correctedBy: actor.actorId,
            },
          });
          const updated = await tx.lesson.update({
            where: { id: lesson.id },
            data: { outcome: LessonOutcome.VOIDED, outcomeNote: null, outcomeByKind: ActorKind.STAFF, outcomeBy: actor.actorId, outcomeAt: new Date() },
          });
          await this.lessons.emitClosed(tx, updated, true);
        }
        await this.audit.audit(tx, {
          actorId: actor.actorId,
          action: resend ? 'lesson.report_resent' : 'lesson.report_deleted',
          entity: 'lesson',
          entityId: lesson.id,
          before: { outcome: lesson.outcome, version: report.version, messageId: report.messageId },
          after: resend ? { outcome: LessonOutcome.HELD } : { outcome: LessonOutcome.VOIDED },
          reason,
        });
      }),
    );
    return this.lessons.get(actorId, lessonId);
  }

  /** A lesson's record history for staff: its corrections and every report version. */
  async history(actorId: string, lessonId: string) {
    const actor = await this.conversations.requireActor(actorId);
    const { lesson, standing } = await this.lessons.load(actor, lessonId);
    if (standing !== 'manager' && standing !== 'supervisor') {
      throw new CommError(CommErrorCode.LESSON_DENIED, 'a lesson\'s record history is staff\'s');
    }
    const revisions = await this.prisma.lessonReportRevision.findMany({ where: { lessonId: lesson.id }, orderBy: { at: 'asc' } });
    return {
      lessonId: lesson.id,
      corrections: (lesson.corrections ?? []).map((c) => ({
        id: c.id, from: c.fromOutcome, to: c.toOutcome, apologyTiming: c.apologyTiming,
        reason: c.reason, by: c.correctedBy, at: c.correctedAt.toISOString(),
      })),
      reportRevisions: revisions.map((r) => ({
        id: r.id, action: r.action, previous: r.previous, by: { kind: r.byKind, id: r.byId },
        reason: r.reason, at: r.at.toISOString(),
      })),
    };
  }

  // ------------------------------------------------------------------

  private liveReport(lesson: LessonWithRelations): LessonReport {
    if (lesson.outcome !== LessonOutcome.HELD || !lesson.report || lesson.report.deletedAt !== null) {
      throw stateError('this lesson has no report to change');
    }
    return lesson.report;
  }

  /** The revision that authorizes a change to `report` in this transaction, holding its previous version. */
  private async revise(tx: Tx, report: LessonReport, actor: Actor, action: string, reason: string | null) {
    await tx.lessonReportRevision.create({
      data: {
        organizationId: report.organizationId,
        lessonId: report.lessonId,
        action,
        previous: snapshot(report) as Prisma.InputJsonValue,
        byKind: actor.kind === ActorKind.TEACHER ? 'teacher' : 'staff',
        byId: actor.actorId,
        reason,
      },
    });
  }

  /** Update a report already revised in this transaction (the card id after posting). */
  private async revisedUpdate(tx: Tx, lessonId: string, data: Prisma.LessonReportUpdateInput) {
    await tx.lessonReport.update({ where: { lessonId }, data });
  }

  /** The report a correction to `held` stands on: the previous one restored (optionally with new fields), or a new one. */
  private async reinstateReport(
    tx: Tx,
    lesson: LessonWithRelations,
    report: LessonReport | null,
    fields: ReportFields | null,
    actor: Actor,
    reason: string,
  ): Promise<ReportFields> {
    if (!report) {
      const f = fields as ReportFields;
      await tx.lessonReport.create({
        data: {
          lessonId: lesson.id, organizationId: lesson.organizationId, teacherId: lesson.teacherId,
          ...f, enteredByKind: 'staff', enteredBy: actor.actorId,
        },
      });
      // Born live; the card id is written after posting, under this revision.
      const created = await tx.lessonReport.findUniqueOrThrow({ where: { lessonId: lesson.id } });
      await this.revise(tx, created, actor, 'restore', reason);
      return f;
    }
    const f = fields ?? fieldsOf(report);
    await this.revise(tx, report, actor, 'restore', reason);
    await tx.lessonReport.update({
      where: { lessonId: lesson.id },
      data: { ...f, deletedAt: null, deletedBy: null, deleteReason: null },
    });
    return f;
  }

  /** Take a card out of the chat for everyone, exactly as a delete-for-everyone does. */
  private async retractCard(tx: Tx, messageId: string, actor: Actor, reason: string) {
    const message = await tx.message.findUnique({ where: { id: messageId } });
    if (!message || message.deletedForAll || !message.conversationId) return;
    await tx.message.update({
      where: { id: messageId },
      data: { deletedAt: new Date(), deletedBy: actor.actorId, deletedForAll: true, redactedReason: reason },
    });
    await this.audit.audit(tx, {
      actorId: actor.actorId,
      action: 'message.delete_for_everyone',
      entity: 'message',
      entityId: messageId,
      reason,
      after: { card: CardKind.LESSON_REPORT },
    });
    await this.outbox.enqueue(tx, CommEvent.MESSAGE_DELETED, {
      conversationId: message.conversationId,
      messageId,
      deletedForAll: true,
    });
  }

  /** Rewrite a report card in place: payload, body, a message revision, edited_at. */
  private async rewriteCard(tx: Tx, messageId: string, actor: Actor, payload: Record<string, unknown>, lang: 'ar' | 'en') {
    const message = await tx.message.findUnique({ where: { id: messageId } });
    if (!message || message.deletedForAll || !message.conversationId) return;
    const now = new Date();
    const body = renderCardBody(CardKind.LESSON_REPORT, payload, lang);
    await tx.messageCard.update({ where: { messageId }, data: { payload: payload as Prisma.InputJsonValue } });
    if (body !== message.body) {
      await tx.messageRevision.create({
        data: { messageId, previousBody: message.body ?? '', editedBy: actor.actorId, editedByKind: actor.kind, editedAt: now },
      });
    }
    await tx.message.update({ where: { id: messageId }, data: { ...(body !== message.body ? { body } : {}), editedAt: now } });
    await this.outbox.enqueue(tx, CommEvent.MESSAGE_UPDATED, {
      conversationId: message.conversationId,
      messageId,
      visibility: message.visibility,
      editedAt: now.toISOString(),
    });
  }
}

function fieldsOf(r: LessonReport): ReportFields {
  return {
    lessonNumber: r.lessonNumber,
    coveredTopics: r.coveredTopics,
    covered: r.covered,
    rating: r.rating,
    nextTasks: r.nextTasks,
    homework: r.homework,
    note: r.note,
  };
}

function snapshot(r: LessonReport) {
  return {
    version: r.version,
    ...fieldsOf(r),
    enteredByKind: r.enteredByKind,
    enteredBy: r.enteredBy,
    messageId: r.messageId,
    deletedAt: r.deletedAt?.toISOString() ?? null,
    updatedAt: r.updatedAt.toISOString(),
  };
}
