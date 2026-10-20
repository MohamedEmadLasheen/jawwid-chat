import { Inject, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../platform/prisma.service';
import { CommError, CommErrorCode } from '../platform/errors';
import { AUDIT_SERVICE } from '../platform/tokens';
import type { AuditService } from '../platform/audit.service';
import type { Actor } from '../platform/types';
import { ActorKind, CardKind, LessonKind, LessonOutcome, StaffRole } from '../communication/contracts/vocab';
import { ConversationService, isUuid } from '../communication/conversations/conversation.service';
import { LessonService, cancelReminders, dateField, invalid, stateError, textField } from './lesson.service';
import { SchedulingService } from './scheduling.service';
import { TrialGroupService } from './trial-group.service';
import { NewStudentsService } from '../new-students/new-students.service';

const NOT_SUBSCRIBED_REASONS: ReadonlySet<string> = new Set(['price', 'schedule', 'not_ready', 'chose_other', 'no_response', 'other']);
const MAX_RANGE_DAYS = 93;
/** How far back the trial group's card looks for trials to record or correct. */
const GROUP_WINDOW_DAYS = 60;

const TRIAL_INCLUDE = {
  prospect: { select: { id: true, displayName: true, level: true, learnerId: true } },
  teacher: { select: { id: true, name: true } },
  report: true,
  trialOutcome: true,
} as const;
type TrialRow = Prisma.LessonGetPayload<{ include: typeof TRIAL_INCLUDE }>;

type TrialStanding = 'sales' | 'manager' | 'teacher';

/**
 * PD-11 T4 and the trial journey (owner decisions 2026-10-20): trial lessons
 * and each trial's ONE outcome.
 *
 *   the teacher      reports the trial from the app: attended (with a short
 *                    report) or did not attend
 *   a supervisor     records the outcome from the "+ -> Trial" card: no_show
 *                    (either department), subscribed with the form, or not
 *                    subscribed with a reason (Sales); Sales corrects it
 *
 * Jawwid Chat is the only source of truth: "subscribed" is final when Sales
 * records it, and nothing waits for or tells Core. Sales records prospects and
 * books trials (the Teachers department may book too); a prospect is a display
 * name only (BR-2). The subscription form, which does carry the parent's
 * contact details, lives in src/new-students, confined (G-07).
 *
 * A trial is a chat.lesson row (kind 'trial'), so the teacher's time, free
 * slots and the exclusion constraint already account for it. LessonService
 * never sees trials; this service is their only reader and writer.
 *
 * Every change posts its card into the teacher's trial group
 * (TrialGroupService), in the same transaction as the record. An outcome card
 * carries the result only: the reason, the form and its prices never reach the
 * group, which the teacher reads.
 */
@Injectable()
export class TrialService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly conversations: ConversationService,
    private readonly lessons: LessonService,
    private readonly scheduling: SchedulingService,
    @Inject(AUDIT_SERVICE) private readonly audit: AuditService,
    private readonly groups: TrialGroupService,
    private readonly forms: NewStudentsService,
  ) {}

  // ------------------------------------------------------------------
  // Prospects
  // ------------------------------------------------------------------

  async createProspect(actorId: string, body: Record<string, unknown>) {
    const actor = await this.conversations.requireActor(actorId);
    await this.requireSales(actor);
    const displayName = textField(body, 'displayName', 120, true) as string;
    const level = textField(body, 'level', 80, false);
    const note = textField(body, 'note', 1000, false);
    const p = await this.prisma.$transaction(async (tx) => {
      const created = await tx.trialProspect.create({
        data: { organizationId: actor.organizationId as string, displayName, level, note, createdBy: actor.actorId },
      });
      await this.audit.audit(tx, {
        actorId: actor.actorId, action: 'trial.prospect_recorded', entity: 'trial_prospect', entityId: created.id,
        after: { displayName }, reason: 'prospect recorded',
      });
      return created;
    });
    return { id: p.id, displayName: p.displayName, level: p.level, note: p.note, createdAt: p.createdAt.toISOString() };
  }

  async prospects(actorId: string) {
    const actor = await this.conversations.requireActor(actorId);
    await this.requireSalesOrManager(actor);
    const rows = await this.prisma.trialProspect.findMany({
      where: { organizationId: actor.organizationId },
      orderBy: { createdAt: 'desc' },
      take: 1000,
    });
    return {
      prospects: rows.map((p) => ({
        id: p.id, displayName: p.displayName, level: p.level, note: p.note,
        learnerId: p.learnerId, createdAt: p.createdAt.toISOString(),
      })),
    };
  }

  // ------------------------------------------------------------------
  // Booking
  // ------------------------------------------------------------------

  /** The organization's active teachers -- who a trial can be booked with. Names only. */
  async teachers(actorId: string) {
    const actor = await this.conversations.requireActor(actorId);
    await this.requireSalesOrManager(actor);
    const rows = await this.prisma.teacher.findMany({
      where: { organizationId: actor.organizationId, isActive: true, leftAt: null },
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    });
    return { teachers: rows };
  }

  /** A teacher's free start times for a trial of `durationMinutes` (default 30). */
  async slots(actorId: string, teacherId: string, durationMinutes?: string) {
    const actor = await this.conversations.requireActor(actorId);
    await this.requireSalesOrManager(actor);
    const teacher = await this.orgTeacher(actor, teacherId);
    const duration = durationMinutes === undefined ? 30 : Number(durationMinutes);
    if (!Number.isInteger(duration) || duration < 15 || duration > 120) throw invalid('durationMinutes: 15 to 120');
    const slots = await this.scheduling.freeSlots(teacher.id, duration);
    return { teacherId: teacher.id, durationMinutes: duration, slots: slots.map((d) => d.toISOString()) };
  }

  /** Book a trial into one of the teacher's real free times. Sales, or the Teachers department. */
  async book(actorId: string, body: Record<string, unknown>) {
    const actor = await this.conversations.requireActor(actorId);
    await this.requireSalesOrManager(actor);
    const prospectId = uuid(body.prospectId, 'prospectId');
    const teacher = await this.orgTeacher(actor, uuid(body.teacherId, 'teacherId'));
    const startsAt = dateField(body, 'startsAt');
    const duration = body.durationMinutes === undefined ? 30 : Number(body.durationMinutes);
    if (!Number.isInteger(duration) || duration < 15 || duration > 120) throw invalid('durationMinutes: 15 to 120');
    const prospect = await this.prisma.trialProspect.findFirst({ where: { id: prospectId, organizationId: actor.organizationId } });
    if (!prospect) throw new CommError(CommErrorCode.LESSON_NOT_FOUND, 'prospect not found');
    const free = await this.scheduling.freeSlots(teacher.id, duration);
    if (!free.some((d) => d.getTime() === startsAt.getTime())) {
      throw stateError('that time is not free for this teacher; choose one of the offered times');
    }
    const trial = await this.lessons.write(() =>
      this.prisma.$transaction(async (tx) => {
        const created = await tx.lesson.create({
          data: {
            organizationId: actor.organizationId as string,
            kind: LessonKind.TRIAL,
            prospectId: prospect.id,
            teacherId: teacher.id,
            startsAt,
            endsAt: new Date(startsAt.getTime() + duration * 60_000),
            createdByKind: 'staff',
            createdBy: actor.actorId,
          },
          include: TRIAL_INCLUDE,
        });
        await this.audit.audit(tx, {
          actorId: actor.actorId, action: 'trial.booked', entity: 'lesson', entityId: created.id,
          after: { prospectId: prospect.id, teacherId: teacher.id, startsAt: startsAt.toISOString() }, reason: 'trial booked',
        });
        await this.groups.postCard(tx, created, actor, CardKind.TRIAL_BOOKED);
        return created;
      }),
    );
    return this.dto(trial);
  }

  /**
   * Trials in [from, to): Sales and the Teachers department see all; a teacher
   * sees their own (and never the conversion's reason or note).
   */
  async list(actorId: string, query: { from?: string; to?: string; teacherId?: string }) {
    const actor = await this.conversations.requireActor(actorId);
    const standing = await this.listStanding(actor);
    const now = Date.now();
    const from = query.from ? parse(query.from, 'from') : new Date(now - 31 * 86_400_000);
    const to = query.to ? parse(query.to, 'to') : new Date(now + 31 * 86_400_000);
    if (to <= from || to.getTime() - from.getTime() > MAX_RANGE_DAYS * 86_400_000) throw invalid(`from/to: at most ${MAX_RANGE_DAYS} days`);
    if (query.teacherId !== undefined && !isUuid(query.teacherId)) throw invalid('teacherId: must be a uuid');
    const rows = await this.prisma.lesson.findMany({
      where: {
        organizationId: actor.organizationId,
        kind: LessonKind.TRIAL,
        startsAt: { gte: from, lt: to },
        ...(standing === 'teacher' ? { teacherId: actor.actorId } : query.teacherId ? { teacherId: query.teacherId } : {}),
      },
      include: TRIAL_INCLUDE,
      orderBy: { startsAt: 'asc' },
      take: 1000,
    });
    return { trials: rows.map((r) => this.dto(r, standing)) };
  }

  // ------------------------------------------------------------------
  // The teacher's fact: attendance
  // ------------------------------------------------------------------

  /**
   * The prospect attended (`attended: true`, with what was covered) or did not.
   * The trial's own teacher records it; the Teachers department may record an
   * absence. The database clock decides "after the start".
   */
  async attendance(actorId: string, lessonId: string, body: Record<string, unknown>) {
    const actor = await this.conversations.requireActor(actorId);
    const { trial, standing } = await this.load(actor, lessonId);
    const attended = body.attended;
    if (attended !== true && attended !== false) throw invalid('attended: true or false');
    if (attended && standing !== 'teacher') throw new CommError(CommErrorCode.LESSON_DENIED, 'the trial report is the teacher\'s');
    if (!attended && standing === 'sales') throw new CommError(CommErrorCode.LESSON_DENIED, 'attendance is the teacher\'s fact');
    if (trial.outcome !== null) throw stateError('this trial is already closed');
    if (Date.now() < trial.startsAt.getTime()) throw stateError('the trial has not started yet');
    const covered = attended ? (textField(body, 'covered', 1000, true) as string) : null;
    const note = textField(body, 'note', 2000, false);
    const rating = body.rating === undefined || body.rating === null ? null : Number(body.rating);
    if (rating !== null && (!Number.isInteger(rating) || rating < 1 || rating > 5)) throw invalid('rating: an integer from 1 to 5');

    await this.lessons.write(() =>
      this.prisma.$transaction(async (tx) => {
        const updated = await tx.lesson.update({
          where: { id: trial.id },
          data: {
            outcome: attended ? LessonOutcome.HELD : LessonOutcome.STUDENT_NO_SHOW,
            outcomeNote: attended ? null : note,
            outcomeByKind: actor.kind,
            outcomeBy: actor.actorId,
            outcomeAt: new Date(),
          },
        });
        if (attended) {
          await tx.lessonReport.create({
            data: { lessonId: trial.id, organizationId: trial.organizationId, teacherId: trial.teacherId, covered: covered as string, rating, note },
          });
        }
        await this.lessons.emitClosed(tx, updated, false);
        await this.groups.postCard(tx, trial, actor, attended ? CardKind.TRIAL_REPORT : CardKind.TRIAL_NO_SHOW,
          attended ? { covered, rating, note } : { note });
        await this.audit.audit(tx, {
          actorId: actor.actorId, action: attended ? 'trial.attended' : 'trial.no_show', entity: 'lesson', entityId: trial.id,
          after: { outcome: updated.outcome }, reason: attended ? 'trial report' : (note ?? 'prospect did not attend'),
        });
      }),
    );
    return this.get(actorId, lessonId);
  }

  /** Jawwid cancels a trial before it happens (or one nobody held). Reason required. */
  async cancel(actorId: string, lessonId: string, body: Record<string, unknown>) {
    const actor = await this.conversations.requireActor(actorId);
    const { trial, standing } = await this.load(actor, lessonId);
    if (standing === 'teacher') throw new CommError(CommErrorCode.LESSON_DENIED, 'Sales or the Teachers department cancels a trial');
    const reason = textField(body, 'reason', 1000, true) as string;
    if (trial.outcome !== null) throw stateError('this trial is already closed');
    await this.lessons.write(() =>
      this.prisma.$transaction(async (tx) => {
        const updated = await tx.lesson.update({
          where: { id: trial.id },
          data: { outcome: LessonOutcome.ADMIN_CANCELLED, outcomeNote: reason, outcomeByKind: ActorKind.STAFF, outcomeBy: actor.actorId, outcomeAt: new Date() },
        });
        await cancelReminders(tx, trial.id);
        await this.lessons.emitClosed(tx, updated, false);
        await this.groups.postCard(tx, trial, actor, CardKind.TRIAL_CANCELLED, { reason });
        await this.audit.audit(tx, {
          actorId: actor.actorId, action: 'trial.cancelled', entity: 'lesson', entityId: trial.id, after: { outcome: updated.outcome }, reason,
        });
      }),
    );
    return this.get(actorId, lessonId);
  }

  // ------------------------------------------------------------------
  // The trial's one outcome (trial journey)
  // ------------------------------------------------------------------

  /**
   * The "+ -> Trial" card's three options, for a trial that has started:
   *
   *   no_show         the student did not attend. Either supervisor (Sales or
   *                   the Teachers department).
   *   subscribed      with Sales' subscription form (parent, children, payment),
   *                   kept on the New Students page and never in the group.
   *   not_subscribed  with a reason (fixed list) and its details, kept with
   *                   Sales and never in the group.
   *
   * Subscribed / not subscribed are Sales' alone, and mark the trial attended
   * if the teacher has not. Chat is the only source of truth: nothing here
   * waits for, or tells, Jawwid Core. One outcome per trial, enforced by the
   * database (chat.trial_outcome's key); a second one is a correction.
   */
  async outcome(actorId: string, lessonId: string, body: Record<string, unknown>) {
    const actor = await this.conversations.requireActor(actorId);
    const { trial, standing } = await this.load(actor, lessonId);
    const result = body.result;
    if (result !== 'no_show' && result !== 'subscribed' && result !== 'not_subscribed') {
      throw invalid('result: no_show, subscribed or not_subscribed');
    }
    if (standing === 'teacher') throw new CommError(CommErrorCode.LESSON_DENIED, 'a trial\'s outcome is recorded by a supervisor');
    if (result !== 'no_show' && standing !== 'sales') {
      throw new CommError(CommErrorCode.LESSON_DENIED, 'whether the student subscribed is recorded by Sales');
    }
    if (Date.now() < trial.startsAt.getTime()) throw stateError('the trial has not started yet');
    if (trial.trialOutcome) throw stateError('this trial\'s outcome is already recorded; correct it instead');
    if (trial.outcome !== null && trial.outcome !== LessonOutcome.HELD && trial.outcome !== LessonOutcome.STUDENT_NO_SHOW) {
      throw stateError('this trial did not take place');
    }
    if (trial.outcome === LessonOutcome.STUDENT_NO_SHOW) {
      throw stateError('the teacher recorded that the student did not attend; correct it instead');
    }
    if (result === 'no_show' && trial.outcome === LessonOutcome.HELD) {
      throw stateError('the teacher reported that the student attended; Sales can correct it');
    }
    const decision = await this.decision(actor.organizationId as string, result, body);

    await this.lessons.write(() =>
      this.prisma.$transaction(async (tx) => {
        await this.attend(tx, trial, actor, result === 'no_show' ? LessonOutcome.STUDENT_NO_SHOW : LessonOutcome.HELD);
        await tx.trialOutcome.create({
          data: {
            lessonId: trial.id, organizationId: trial.organizationId, result,
            reasonCode: decision.reasonCode, note: decision.note, recordedBy: actor.actorId,
          },
        });
        if (decision.form) {
          await this.forms.recordInTx(tx, { lessonId: trial.id, organizationId: trial.organizationId, form: decision.form, by: actor.actorId });
        }
        // The result only: the reason, the form and the prices stay out of the group.
        await this.groups.postCard(tx, trial, actor, result === 'no_show' ? CardKind.TRIAL_NO_SHOW : CardKind.TRIAL_DECISION, { result });
        await this.audit.audit(tx, {
          actorId: actor.actorId, action: `trial.${result}`, entity: 'lesson', entityId: trial.id,
          after: { result, reasonCode: decision.reasonCode }, reason: result,
        });
      }),
    );
    return this.get(actorId, lessonId);
  }

  /**
   * Correct a trial's outcome -- Sales (or the super admin), with why. The trial
   * keeps ONE outcome: the record is changed in place, its previous value lands
   * in chat.trial_outcome_revision (written by the database), and statistics,
   * which read the current outcome, count it once. Moving to "subscribed"
   * needs the form; moving away withdraws it from New Students (kept).
   */
  async correct(actorId: string, lessonId: string, body: Record<string, unknown>) {
    const actor = await this.conversations.requireActor(actorId);
    const { trial, standing } = await this.load(actor, lessonId);
    if (standing !== 'sales') throw new CommError(CommErrorCode.LESSON_DENIED, 'a trial\'s outcome is corrected by Sales');
    const result = body.result;
    if (result !== 'no_show' && result !== 'subscribed' && result !== 'not_subscribed') {
      throw invalid('result: no_show, subscribed or not_subscribed');
    }
    const why = textField(body, 'why', 1000, true) as string;
    const current = trial.trialOutcome?.result
      ?? (trial.outcome === LessonOutcome.STUDENT_NO_SHOW ? 'no_show' : null);
    if (current === null) throw stateError('this trial has no outcome to correct yet');
    const decision = await this.decision(actor.organizationId as string, result, body);
    if (current === result && result !== 'not_subscribed') {
      throw stateError(result === 'subscribed' ? 'already subscribed; edit the subscription form instead' : 'the outcome is already that');
    }

    await this.lessons.write(() =>
      this.prisma.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT set_config('chat.correcting_trial', 'on', true), set_config('chat.trial_correction_reason', ${why}, true)`;
        const attendance = result === 'no_show' ? LessonOutcome.STUDENT_NO_SHOW : LessonOutcome.HELD;
        if (trial.outcome !== attendance) {
          await tx.lesson.update({
            where: { id: trial.id },
            data: { outcome: attendance, outcomeNote: null, outcomeByKind: ActorKind.STAFF, outcomeBy: actor.actorId, outcomeAt: new Date() },
          });
        }
        if (trial.trialOutcome) {
          await tx.trialOutcome.update({
            where: { lessonId: trial.id },
            data: { result, reasonCode: decision.reasonCode, note: decision.note, correctedBy: actor.actorId },
          });
        } else {
          // The teacher's own "did not attend" had no supervisor's record yet.
          await tx.trialOutcome.create({
            data: { lessonId: trial.id, organizationId: trial.organizationId, result, reasonCode: decision.reasonCode, note: decision.note, recordedBy: actor.actorId },
          });
        }
        if (decision.form) {
          await this.forms.recordInTx(tx, { lessonId: trial.id, organizationId: trial.organizationId, form: decision.form, by: actor.actorId });
        } else if (current === 'subscribed') {
          await this.forms.withdrawInTx(tx, { lessonId: trial.id, by: actor.actorId });
        }
        await tx.$executeRaw`SELECT set_config('chat.correcting_trial', 'off', true), set_config('chat.trial_correction_reason', '', true)`;
        await this.groups.postCard(tx, trial, actor, CardKind.TRIAL_CORRECTION, { result });
        await this.audit.audit(tx, {
          actorId: actor.actorId, action: 'trial.corrected', entity: 'lesson', entityId: trial.id,
          before: { result: current }, after: { result, reasonCode: decision.reasonCode }, reason: why,
        });
      }),
    );
    return this.get(actorId, lessonId);
  }

  /** Change a subscribed trial's form (a typo, a new schedule). Sales. Nothing is posted. */
  async updateSubscription(actorId: string, lessonId: string, body: Record<string, unknown>) {
    const actor = await this.conversations.requireActor(actorId);
    const { trial, standing } = await this.load(actor, lessonId);
    if (standing !== 'sales') throw new CommError(CommErrorCode.LESSON_DENIED, 'the subscription form is Sales\'');
    if (trial.trialOutcome?.result !== 'subscribed') throw stateError('this trial is not subscribed');
    const form = await this.forms.validate(actor.organizationId as string, body.subscription);
    await this.prisma.$transaction(async (tx) => {
      await this.forms.updateInTx(tx, { lessonId: trial.id, form, by: actor.actorId });
      await this.audit.audit(tx, {
        actorId: actor.actorId, action: 'trial.subscription_updated', entity: 'lesson', entityId: trial.id,
        after: { children: form.children.length }, reason: 'subscription form updated',
      });
    });
    return this.forms.get(actor.organizationId as string, trial.id);
  }

  /** The outcome's own data, validated before anything is written. */
  private async decision(organizationId: string, result: 'no_show' | 'subscribed' | 'not_subscribed', body: Record<string, unknown>) {
    if (result === 'subscribed') {
      return { reasonCode: null, note: null, form: await this.forms.validate(organizationId, body.subscription) };
    }
    if (result === 'not_subscribed') {
      const r = body.reason;
      if (typeof r !== 'string' || !NOT_SUBSCRIBED_REASONS.has(r)) throw invalid(`reason: one of ${[...NOT_SUBSCRIBED_REASONS].join(', ')}`);
      const note = textField(body, 'note', 1000, r === 'other');
      return { reasonCode: r, note, form: null };
    }
    return { reasonCode: null, note: null, form: null };
  }

  /** Mark the trial attended / not attended by a supervisor, unless it already is (same transaction). */
  private async attend(tx: Prisma.TransactionClient, trial: TrialRow, actor: Actor, outcome: string) {
    if (trial.outcome === outcome) return;
    const updated = await tx.lesson.update({
      where: { id: trial.id },
      data: { outcome, outcomeNote: null, outcomeByKind: ActorKind.STAFF, outcomeBy: actor.actorId, outcomeAt: new Date() },
    });
    await this.lessons.emitClosed(tx, updated, false);
  }

  // ------------------------------------------------------------------
  // The trial group
  // ------------------------------------------------------------------

  /** Open a teacher's trial group from the Admin Web. Sales or the Teachers department. */
  async openGroup(actorId: string, teacherId: string) {
    const actor = await this.conversations.requireActor(actorId);
    await this.requireSalesOrManager(actor);
    const teacher = await this.orgTeacher(actor, teacherId);
    return this.groups.open(actor, teacher.id);
  }

  openOwnGroup(actorId: string) {
    return this.groups.openOwn(actorId);
  }

  ticketsFor(actorId: string, conversationId: string) {
    return this.groups.ticketsFor(actorId, conversationId);
  }

  /**
   * What the Admin Web's "+ -> Trial" card needs in one trial group: who the
   * caller is there (member, permanent, may join or leave), what they may
   * record, and the teacher's trials -- those still awaiting an outcome first,
   * then the recent ones that have one (to correct). Each is named by its
   * student and time, so trials sharing a group are never confused.
   */
  async groupContext(actorId: string, conversationId: string) {
    const actor = await this.conversations.requireActor(actorId);
    const standing = await this.requireSalesOrManager(actor);
    const context = await this.groups.context(actor, conversationId);
    const teacherId = context.teacher?.id as string;
    const rows = await this.prisma.lesson.findMany({
      where: {
        organizationId: actor.organizationId, kind: LessonKind.TRIAL, teacherId,
        startsAt: { lte: new Date(), gte: new Date(Date.now() - GROUP_WINDOW_DAYS * 86_400_000) },
        OR: [{ outcome: null }, { outcome: { in: [LessonOutcome.HELD, LessonOutcome.STUDENT_NO_SHOW] } }],
      },
      include: TRIAL_INCLUDE,
      orderBy: { startsAt: 'desc' },
      take: 200,
    });
    const trials = rows.map((r) => this.dto(r, standing));
    const open = trials.filter((t) => t.outcome === 'awaiting').reverse();
    const closed = trials.filter((t) => t.outcome !== 'awaiting');
    return {
      ...context,
      can: { noShow: true, decide: standing === 'sales', correct: standing === 'sales' },
      trials: [...open, ...closed].slice(0, 50),
    };
  }

  async joinGroup(actorId: string, conversationId: string) {
    const actor = await this.conversations.requireActor(actorId);
    await this.requireSalesOrManager(actor);
    await this.groups.join(actor, conversationId);
    return this.groupContext(actorId, conversationId);
  }

  async leaveGroup(actorId: string, conversationId: string) {
    const actor = await this.conversations.requireActor(actorId);
    await this.requireSalesOrManager(actor);
    await this.groups.leave(actor, conversationId);
    return this.groupContext(actorId, conversationId);
  }

  // ------------------------------------------------------------------
  // New students
  // ------------------------------------------------------------------

  /**
   * The New Students page: every subscribed trial's form -- parent, children,
   * payment -- as Sales recorded it in Chat. Operations, Sales, super admin.
   */
  async newStudents(actorId: string) {
    const actor = await this.conversations.requireActor(actorId);
    const allowed = actor.staffRole === StaffRole.SUPER_ADMIN
      || (await this.lessons.inDepartment(actor, 'operations'))
      || (await this.lessons.inDepartment(actor, 'sales'));
    if (!allowed) throw new CommError(CommErrorCode.LESSON_DENIED, 'the New Students page belongs to Operations and Sales');
    return { students: await this.forms.list(actor.organizationId as string) };
  }

  // ------------------------------------------------------------------
  // Internals
  // ------------------------------------------------------------------

  async get(actorId: string, lessonId: string) {
    const actor = await this.conversations.requireActor(actorId);
    const { trial, standing } = await this.load(actor, lessonId);
    return this.dto(trial, standing);
  }

  private async load(actor: Actor, lessonId: string): Promise<{ trial: TrialRow; standing: TrialStanding }> {
    if (!isUuid(lessonId)) throw new CommError(CommErrorCode.LESSON_NOT_FOUND, 'trial not found');
    const trial = await this.prisma.lesson.findFirst({
      where: { id: lessonId, kind: LessonKind.TRIAL, organizationId: actor.organizationId },
      include: TRIAL_INCLUDE,
    });
    if (!trial) throw new CommError(CommErrorCode.LESSON_NOT_FOUND, 'trial not found');
    const standing = await this.standing(actor, trial.teacherId);
    if (!standing) throw new CommError(CommErrorCode.LESSON_NOT_FOUND, 'trial not found');
    return { trial, standing };
  }

  /** Sales first (the conversion is theirs), then the Teachers department, then the trial's own teacher. */
  private async standing(actor: Actor, teacherId: string): Promise<TrialStanding | null> {
    if (!actor.isActive || !actor.organizationId) return null;
    if (actor.kind === ActorKind.TEACHER) return actor.actorId === teacherId ? 'teacher' : null;
    if (actor.kind !== ActorKind.STAFF) return null;
    if (actor.staffRole === StaffRole.SUPER_ADMIN || (await this.lessons.inDepartment(actor, 'sales'))) return 'sales';
    if (await this.lessons.isManager(actor)) return 'manager';
    return null;
  }

  private async listStanding(actor: Actor): Promise<TrialStanding> {
    if (actor.kind === ActorKind.TEACHER && actor.isActive) return 'teacher';
    const s = await this.standing(actor, '');
    if (!s) throw new CommError(CommErrorCode.LESSON_DENIED, 'trials belong to Sales and the Teachers department');
    return s;
  }

  private async requireSales(actor: Actor) {
    if ((await this.standing(actor, '')) !== 'sales') {
      throw new CommError(CommErrorCode.LESSON_DENIED, 'prospects are recorded by Sales');
    }
  }

  private async requireSalesOrManager(actor: Actor): Promise<'sales' | 'manager'> {
    const s = await this.standing(actor, '');
    if (s !== 'sales' && s !== 'manager') throw new CommError(CommErrorCode.LESSON_DENIED, 'trials belong to Sales and the Teachers department');
    return s;
  }

  private async orgTeacher(actor: Actor, teacherId: string) {
    const teacher = isUuid(teacherId)
      ? await this.prisma.teacher.findFirst({ where: { id: teacherId, organizationId: actor.organizationId, isActive: true, leftAt: null } })
      : null;
    if (!teacher) throw new CommError(CommErrorCode.LESSON_NOT_FOUND, 'teacher not found');
    return teacher;
  }

  /**
   * A trial as each reader may see it. `outcome` is the trial's ONE outcome:
   * upcoming, awaiting (started, nothing recorded or attended without a
   * decision), no_show, subscribed, not_subscribed, or cancelled. A teacher
   * never sees why a student did not subscribe.
   */
  private dto(t: TrialRow, standing: TrialStanding = 'sales') {
    const o = t.trialOutcome;
    const outcome = trialOutcomeOf(t);
    return {
      id: t.id,
      prospect: { id: t.prospect?.id ?? '', displayName: t.prospect?.displayName ?? '', level: t.prospect?.level ?? null },
      teacher: t.teacher,
      startsAt: t.startsAt.toISOString(),
      endsAt: t.endsAt.toISOString(),
      durationMinutes: Math.round((t.endsAt.getTime() - t.startsAt.getTime()) / 60_000),
      attendance: t.outcome === LessonOutcome.HELD ? 'attended'
        : t.outcome === LessonOutcome.STUDENT_NO_SHOW ? 'no_show'
        : t.outcome === null ? (Date.now() < t.startsAt.getTime() ? 'upcoming' : 'awaiting')
        : t.outcome,
      report: t.report ? { covered: t.report.covered, rating: t.report.rating, note: t.report.note } : null,
      outcome,
      ...(standing !== 'teacher' && o
        ? {
            outcomeDetail: {
              reason: o.reasonCode, note: o.note, recordedAt: o.recordedAt.toISOString(),
              correctedAt: o.correctedAt?.toISOString() ?? null,
            },
          }
        : {}),
    };
  }
}

function uuid(v: unknown, key: string): string {
  if (typeof v !== 'string' || !isUuid(v)) throw invalid(`${key}: must be a uuid`);
  return v;
}

function parse(v: string, key: string): Date {
  const d = new Date(v);
  if (Number.isNaN(d.getTime()) || !/^\d{4}-\d{2}-\d{2}T/.test(v)) throw invalid(`${key}: an ISO-8601 timestamp`);
  return d;
}

export type TrialOutcomeName = 'upcoming' | 'awaiting' | 'no_show' | 'subscribed' | 'not_subscribed' | 'cancelled';

/** The trial's one outcome -- the same rule as chat.teacher_trial_stats. */
export function trialOutcomeOf(t: { outcome: string | null; startsAt: Date; trialOutcome: { result: string } | null }): TrialOutcomeName {
  if (t.trialOutcome) return t.trialOutcome.result as TrialOutcomeName;
  if (t.outcome === LessonOutcome.STUDENT_NO_SHOW) return 'no_show';
  if (t.outcome === null) return Date.now() < t.startsAt.getTime() ? 'upcoming' : 'awaiting';
  if (t.outcome === LessonOutcome.HELD) return 'awaiting';
  return 'cancelled';
}
