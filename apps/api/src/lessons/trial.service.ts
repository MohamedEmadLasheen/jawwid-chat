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

const NOT_SUBSCRIBED_REASONS: ReadonlySet<string> = new Set(['price', 'schedule', 'not_ready', 'chose_other', 'no_response', 'other']);
const MAX_RANGE_DAYS = 93;

const TRIAL_INCLUDE = {
  prospect: { select: { id: true, displayName: true, level: true, learnerId: true } },
  teacher: { select: { id: true, name: true } },
  report: true,
  trialOutcome: true,
} as const;
type TrialRow = Prisma.LessonGetPayload<{ include: typeof TRIAL_INCLUDE }>;

type TrialStanding = 'sales' | 'manager' | 'teacher';

/**
 * PD-11 T4 (part 1): trial lessons and their two independent facts.
 *
 *   attendance  -- the TEACHER's fact (or the Teachers department's): the
 *                  prospect attended (with a short report) or did not
 *   conversion  -- SALES' fact, about an attended trial only: subscribed, or
 *                  not subscribed with a reason
 *
 * A subscription credits the teacher only once Core confirms it
 * (chat.confirm_trial_conversion, called by Core ingestion -- which does not
 * exist yet, so until then subscriptions read "awaiting Core"). Owner decisions
 * 2026-10-19: Sales records prospects and books trials (the Teachers department
 * may book too); a prospect is a display name only (BR-2).
 *
 * A trial is a chat.lesson row (kind 'trial'), so the teacher's time, free
 * slots and the exclusion constraint already account for it. LessonService
 * never sees trials; this service is their only reader and writer.
 *
 * Part 2: every change posts its card into the teacher's trial group
 * (TrialGroupService), in the same transaction as the record -- the report is the
 * message. The not-subscribed reason never reaches the group: the teacher reads it.
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
  // Sales' fact: conversion
  // ------------------------------------------------------------------

  /**
   * Subscribed, or not subscribed with a reason -- for a trial the prospect
   * attended. Sales only. A subscription stays "awaiting Core" until Core's
   * subscription event confirms it.
   */
  async outcome(actorId: string, lessonId: string, body: Record<string, unknown>) {
    const actor = await this.conversations.requireActor(actorId);
    const { trial, standing } = await this.load(actor, lessonId);
    if (standing !== 'sales') throw new CommError(CommErrorCode.LESSON_DENIED, 'the subscription decision is recorded by Sales');
    const result = body.result;
    if (result !== 'subscribed' && result !== 'not_subscribed') throw invalid('result: subscribed or not_subscribed');
    let reasonCode: string | null = null;
    if (result === 'not_subscribed') {
      const r = body.reason;
      if (typeof r !== 'string' || !NOT_SUBSCRIBED_REASONS.has(r)) throw invalid(`reason: one of ${[...NOT_SUBSCRIBED_REASONS].join(', ')}`);
      reasonCode = r;
    }
    const note = textField(body, 'note', 1000, false);
    if (trial.outcome !== LessonOutcome.HELD) throw stateError('only a trial the prospect attended leads to a subscription decision');
    if (trial.trialOutcome) throw stateError('the decision for this trial is already recorded');
    await this.lessons.write(() =>
      this.prisma.$transaction(async (tx) => {
        await tx.trialOutcome.create({
          data: { lessonId: trial.id, organizationId: trial.organizationId, result, reasonCode, note, recordedBy: actor.actorId },
        });
        // The result only: the reason and note stay with Sales.
        await this.groups.postCard(tx, trial, actor, CardKind.TRIAL_DECISION, { result });
        await this.audit.audit(tx, {
          actorId: actor.actorId, action: `trial.${result}`, entity: 'lesson', entityId: trial.id,
          after: { result, reasonCode }, reason: note ?? result,
        });
      }),
    );
    return this.get(actorId, lessonId);
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

  // ------------------------------------------------------------------
  // New students
  // ------------------------------------------------------------------

  /**
   * The Operations team's New Students page: subscriptions Core has CONFIRMED
   * whose learner exists and still has no live group to talk in (ready to set
   * up), and subscriptions Sales recorded that Core has not confirmed yet.
   */
  async newStudents(actorId: string) {
    const actor = await this.conversations.requireActor(actorId);
    const allowed = actor.staffRole === StaffRole.SUPER_ADMIN
      || (await this.lessons.inDepartment(actor, 'operations'))
      || (await this.lessons.inDepartment(actor, 'sales'));
    if (!allowed) throw new CommError(CommErrorCode.LESSON_DENIED, 'the New Students page belongs to Operations and Sales');
    const rows = await this.prisma.trialOutcome.findMany({
      where: { organizationId: actor.organizationId, result: 'subscribed' },
      include: { lesson: { include: TRIAL_INCLUDE } },
      orderBy: { recordedAt: 'desc' },
      take: 500,
    });
    const learnerIds = rows.map((r) => r.lesson.prospect?.learnerId).filter((x): x is string => !!x);
    const grouped = new Set(
      (await this.prisma.$queryRaw<Array<{ learner_id: string }>>`
        SELECT DISTINCT x.learner_id::text AS learner_id FROM (
          SELECT c.learner_id FROM chat.conversation c
           WHERE c.type = 'student_group' AND c.archived_at IS NULL AND c.learner_id = ANY(${learnerIds}::uuid[])
          UNION
          SELECT cl.learner_id FROM chat.conversation_learner cl JOIN chat.conversation c ON c.id = cl.conversation_id
           WHERE c.archived_at IS NULL AND cl.learner_id = ANY(${learnerIds}::uuid[])
        ) x`).map((r) => r.learner_id),
    );
    const item = (r: (typeof rows)[number]) => ({
      lessonId: r.lessonId,
      prospect: { id: r.lesson.prospect?.id ?? '', displayName: r.lesson.prospect?.displayName ?? '' },
      learnerId: r.lesson.prospect?.learnerId ?? null,
      teacher: r.lesson.teacher,
      trialAt: r.lesson.startsAt.toISOString(),
      recordedAt: r.recordedAt.toISOString(),
      confirmedAt: r.confirmedAt?.toISOString() ?? null,
    });
    return {
      readyForSetup: rows.filter((r) => r.confirmedAt && r.lesson.prospect?.learnerId && !grouped.has(r.lesson.prospect.learnerId)).map(item),
      awaitingCore: rows.filter((r) => !r.confirmedAt).map(item),
    };
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

  private async requireSalesOrManager(actor: Actor) {
    const s = await this.standing(actor, '');
    if (s !== 'sales' && s !== 'manager') throw new CommError(CommErrorCode.LESSON_DENIED, 'trials belong to Sales and the Teachers department');
  }

  private async orgTeacher(actor: Actor, teacherId: string) {
    const teacher = isUuid(teacherId)
      ? await this.prisma.teacher.findFirst({ where: { id: teacherId, organizationId: actor.organizationId, isActive: true, leftAt: null } })
      : null;
    if (!teacher) throw new CommError(CommErrorCode.LESSON_NOT_FOUND, 'teacher not found');
    return teacher;
  }

  /** A trial as each reader may see it: a teacher never sees why a prospect did not subscribe. */
  private dto(t: TrialRow, standing: TrialStanding = 'sales') {
    const o = t.trialOutcome;
    const conversion = !o
      ? (t.outcome === LessonOutcome.HELD ? 'pending' : null)
      : o.result === 'not_subscribed' ? 'not_subscribed'
      : o.confirmedAt ? 'confirmed' : 'awaiting_core';
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
      conversion,
      ...(standing !== 'teacher' && o
        ? { conversionDetail: { reason: o.reasonCode, note: o.note, recordedAt: o.recordedAt.toISOString(), confirmedAt: o.confirmedAt?.toISOString() ?? null } }
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
