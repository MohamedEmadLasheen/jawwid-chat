import { Inject, Injectable } from '@nestjs/common';
import { Learner, Prisma } from '@prisma/client';
import { PrismaService } from '../platform/prisma.service';
import { AppConfigService } from '../platform/app-config.service';
import { AuthorizationService, type LessonAct, type LessonStanding } from '../platform/authorization.service';
import { CommError, CommErrorCode } from '../platform/errors';
import { AUDIT_SERVICE } from '../platform/tokens';
import type { AuditService } from '../platform/audit.service';
import type { Actor } from '../platform/types';
import { ConversationService, isUuid } from '../communication/conversations/conversation.service';
import { OutboxService } from '../communication/outbox/outbox.service';
import { ReminderService } from '../communication/notifications/reminder.service';
import { CommEvent } from '../communication/contracts/events';
import {
  ActorKind,
  CardKind,
  LessonKind,
  LessonOutcome,
  MakeupAction,
  RulingKind,
} from '../communication/contracts/vocab';
import {
  LESSON_INCLUDE,
  LessonService,
  cancelReminders,
  dateField,
  invalid,
  stateError,
  textField,
  type Tx,
} from './lesson.service';

type WeeklySlot = { weekday: number; startMinute: number; durationMinutes: number };

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const HHMM_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;
const MAKEUP_ACTIONS: ReadonlySet<string> = new Set(Object.values(MakeupAction));

/**
 * PD-11 T2: a teacher's availability, a learner's regular weekly times, the
 * make-up a family books itself, a family's request to change its regular
 * times, and the follow-up when a teacher-cancelled lesson is never replaced.
 *
 * Weekly times are wall-clock times in the TEACHER's zone. Every conversion to
 * an instant -- free slots, materialized lessons, a "next on" date -- happens in
 * Postgres (chat.teacher_free_slots, chat.teacher_free_weekly_slots,
 * chat.materialize_lessons), so daylight saving is the database's job and there
 * is one clock.
 *
 * Who may act is AuthorizationService's (the same lessonStanding /
 * canRecordLessonAct as the T1 tickets). Cards are posted by LessonService, in
 * the same transaction as the record they describe.
 */
@Injectable()
export class SchedulingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly authz: AuthorizationService,
    private readonly conversations: ConversationService,
    private readonly lessons: LessonService,
    private readonly outbox: OutboxService,
    private readonly config: AppConfigService,
    private readonly reminders: ReminderService,
    @Inject(AUDIT_SERVICE) private readonly audit: AuditService,
  ) {}

  // ------------------------------------------------------------------
  // Availability (Teachers department; a teacher reads their own)
  // ------------------------------------------------------------------

  async availability(actorId: string, teacherId: string) {
    const actor = await this.conversations.requireActor(actorId);
    const teacher = await this.readableTeacher(actor, teacherId);
    const windows = await this.prisma.teacherAvailability.findMany({
      where: { teacherId: teacher.id },
      orderBy: [{ weekday: 'asc' }, { startMinute: 'asc' }],
    });
    const daysOff = await this.prisma.teacherDayOff.findMany({
      where: { teacherId: teacher.id, day: { gte: new Date(Date.now() - 86_400_000) } },
      orderBy: { day: 'asc' },
      take: 200,
    });
    return {
      teacherId: teacher.id,
      timezone: windows[0]?.timezone ?? null,
      windows: windows.map((w) => ({ weekday: w.weekday, start: hhmm(w.startMinute), end: hhmm(w.endMinute) })),
      daysOff: daysOff.map((d) => ({ date: d.day.toISOString().slice(0, 10), reason: d.reason })),
    };
  }

  /** Replace a teacher's weekly windows as a whole. */
  async setAvailability(actorId: string, teacherId: string, body: Record<string, unknown>) {
    const actor = await this.conversations.requireActor(actorId);
    await this.lessons.requireManager(actor);
    const teacher = await this.orgTeacher(actor, teacherId);
    const timezone = textField(body, 'timezone', 64, true) as string;
    const raw = body.windows;
    if (!Array.isArray(raw) || raw.length > 28) throw invalid('windows: an array of at most 28 windows');
    const windows = raw.map((w, i) => {
      if (typeof w !== 'object' || w === null) throw invalid(`windows[${i}]: an object`);
      const o = w as Record<string, unknown>;
      const weekday = weekdayField(o.weekday, `windows[${i}].weekday`);
      const start = minuteField(o.start, `windows[${i}].start`);
      const end = o.end === '24:00' ? 1440 : minuteField(o.end, `windows[${i}].end`);
      if (end <= start) throw invalid(`windows[${i}]: end must be after start`);
      return { weekday, start, end };
    });
    for (const a of windows) {
      for (const b of windows) {
        if (a !== b && a.weekday === b.weekday && a.start < b.end && b.start < a.end) {
          throw invalid('windows: two windows overlap on the same day');
        }
      }
    }
    const zoned = await this.prisma.$queryRaw<Array<{ ok: boolean }>>`SELECT chat.is_time_zone(${timezone}) AS ok`;
    if (!zoned[0]?.ok) throw invalid('timezone: an IANA time zone, e.g. Africa/Cairo');
    const otherZone = await this.prisma.learnerScheduleSlot.findFirst({
      where: { teacherId: teacher.id, validTo: null, NOT: { timezone } },
      select: { id: true },
    });
    if (otherZone) {
      throw stateError('this teacher has regular lessons in another time zone; change those first');
    }

    await this.lessons.write(() =>
      this.prisma.$transaction(async (tx) => {
        await tx.teacherAvailability.deleteMany({ where: { teacherId: teacher.id } });
        if (windows.length > 0) {
          await tx.teacherAvailability.createMany({
            data: windows.map((w) => ({
              organizationId: teacher.organizationId,
              teacherId: teacher.id,
              weekday: w.weekday,
              startMinute: w.start,
              endMinute: w.end,
              timezone,
              createdBy: actor.actorId,
            })),
          });
        }
        await this.audit.audit(tx, {
          actorId: actor.actorId,
          action: 'teacher.availability_set',
          entity: 'teacher',
          entityId: teacher.id,
          after: { timezone, windows },
          reason: 'weekly availability replaced',
        });
      }),
    );
    return this.availability(actorId, teacher.id);
  }

  async addDayOff(actorId: string, teacherId: string, body: Record<string, unknown>) {
    const actor = await this.conversations.requireActor(actorId);
    await this.lessons.requireManager(actor);
    const teacher = await this.orgTeacher(actor, teacherId);
    const date = dateOnlyField(body.date, 'date');
    const reason = textField(body, 'reason', 500, false);
    await this.lessons.write(() =>
      this.prisma.$transaction(async (tx) => {
        await tx.teacherDayOff.upsert({
          where: { teacherId_day: { teacherId: teacher.id, day: new Date(`${date}T00:00:00Z`) } },
          create: {
            organizationId: teacher.organizationId,
            teacherId: teacher.id,
            day: new Date(`${date}T00:00:00Z`),
            reason,
            createdBy: actor.actorId,
          },
          update: {},
        });
        await this.audit.audit(tx, {
          actorId: actor.actorId, action: 'teacher.day_off_added', entity: 'teacher', entityId: teacher.id,
          after: { date }, reason: reason ?? 'day off',
        });
      }),
    );
    return this.availability(actorId, teacher.id);
  }

  async removeDayOff(actorId: string, teacherId: string, date: string) {
    const actor = await this.conversations.requireActor(actorId);
    await this.lessons.requireManager(actor);
    const teacher = await this.orgTeacher(actor, teacherId);
    const day = dateOnlyField(date, 'date');
    await this.prisma.$transaction(async (tx) => {
      await tx.teacherDayOff.deleteMany({ where: { teacherId: teacher.id, day: new Date(`${day}T00:00:00Z`) } });
      await this.audit.audit(tx, {
        actorId: actor.actorId, action: 'teacher.day_off_removed', entity: 'teacher', entityId: teacher.id,
        before: { date: day }, reason: 'day off removed',
      });
    });
    return this.availability(actorId, teacher.id);
  }

  // ------------------------------------------------------------------
  // Regular weekly times
  // ------------------------------------------------------------------

  async schedule(actorId: string, learnerId: string) {
    const actor = await this.conversations.requireActor(actorId);
    const { learner } = await this.learnerFor(actor, learnerId, 'read_schedule');
    const slots = await this.prisma.learnerScheduleSlot.findMany({
      where: { learnerId: learner.id, validTo: null },
      orderBy: [{ weekday: 'asc' }, { startMinute: 'asc' }],
    });
    const pending = await this.prisma.scheduleChangeRequest.findFirst({
      where: { learnerId: learner.id, status: 'pending' },
    });
    return {
      learnerId: learner.id,
      timezone: slots[0]?.timezone ?? null,
      slots: slots.map((s) => ({
        id: s.id,
        weekday: s.weekday,
        start: hhmm(s.startMinute),
        durationMinutes: s.durationMinutes,
        validFrom: s.validFrom.toISOString().slice(0, 10),
      })),
      pendingRequest: pending
        ? { id: pending.id, slots: pending.slots, note: pending.note, createdAt: pending.createdAt.toISOString() }
        : null,
    };
  }

  /** The Teachers department sets a learner's regular times (replacing the current ones). */
  async setSchedule(actorId: string, learnerId: string, body: Record<string, unknown>) {
    const actor = await this.conversations.requireActor(actorId);
    await this.lessons.requireManager(actor);
    const { learner } = await this.learnerFor(actor, learnerId, 'read_schedule');
    const slots = slotsField(body.slots, true);
    const effectiveFrom = body.effectiveFrom === undefined ? null : dateOnlyField(body.effectiveFrom, 'effectiveFrom');
    await this.applySchedule(actor, learner, slots, effectiveFrom, null);
    return this.schedule(actorId, learnerId);
  }

  /**
   * The free regular weekly times a family may ask for: the teacher's working
   * windows minus the regular times of the teacher's other learners, for this
   * learner's lesson length. Each with the next instant it would fall on, so a
   * client in any zone can show it in the family's own clock.
   */
  async scheduleOptions(actorId: string, learnerId: string) {
    const actor = await this.conversations.requireActor(actorId);
    const { learner } = await this.learnerFor(actor, learnerId, 'read_schedule');
    if (!learner.teacherId) return { timezone: null, durationMinutes: null, options: [] };
    const duration = await this.currentDuration(learner.id);
    const step = Number(await this.config.get('lesson.slot_step_minutes'));
    const rows = await this.weeklyOptions(learner.teacherId, duration, step, learner.id);
    return {
      timezone: rows[0]?.timezone ?? null,
      durationMinutes: duration,
      options: rows.map((r) => ({ weekday: r.weekday, start: hhmm(r.start_minute), nextStartsAt: r.next_at.toISOString() })),
    };
  }

  /** A family asks for new regular times, chosen from the free options. A supervisor decides. */
  async requestScheduleChange(actorId: string, learnerId: string, body: Record<string, unknown>) {
    const actor = await this.conversations.requireActor(actorId);
    const { learner, standing } = await this.learnerFor(actor, learnerId, 'read_schedule');
    this.requireAct(actor, standing, 'request_schedule_change');
    if (!learner.teacherId) throw stateError('this learner has no teacher yet');
    if (await this.prisma.scheduleChangeRequest.count({ where: { learnerId: learner.id, status: 'pending' } })) {
      throw stateError('a request for this learner is already waiting for a decision');
    }
    const duration = await this.currentDuration(learner.id);
    const wanted = slotsField(body.slots, false).map((s) => ({ ...s, durationMinutes: duration }));
    const note = textField(body, 'note', 1000, false);
    await this.assertFree(learner.teacherId, learner.id, wanted);
    const step = Number(await this.config.get('lesson.slot_step_minutes'));
    const next = new Map(
      (await this.weeklyOptions(learner.teacherId, duration, step, learner.id)).map((r) => [`${r.weekday}:${r.start_minute}`, r]),
    );

    const lang = await this.lessons.languageOf({ learner: { familyId: learner.familyId } });
    const request = await this.lessons.write(() =>
      this.prisma.$transaction(async (tx) => {
        const created = await tx.scheduleChangeRequest.create({
          data: {
            organizationId: learner.organizationId,
            learnerId: learner.id,
            requestedBy: actor.actorId,
            slots: wanted.map((w) => ({ weekday: w.weekday, start: hhmm(w.startMinute) })) as Prisma.InputJsonValue,
            note,
          },
        });
        await this.lessons.postCard(
          tx,
          this.subject(learner),
          actor,
          CardKind.SCHEDULE_CHANGE_REQUESTED,
          {
            learnerName: learner.name,
            requestId: created.id,
            note,
            slots: wanted.map((w) => ({
              weekday: w.weekday,
              start: hhmm(w.startMinute),
              nextStartsAt: next.get(`${w.weekday}:${w.startMinute}`)?.next_at.toISOString() ?? null,
            })),
          },
          lang,
        );
        return created;
      }),
    );
    return { id: request.id, status: request.status };
  }

  /** A Teachers-department supervisor approves (and applies) or rejects a request. */
  async decideScheduleChange(actorId: string, requestId: string, body: Record<string, unknown>) {
    if (!isUuid(requestId)) throw new CommError(CommErrorCode.LESSON_NOT_FOUND, 'request not found');
    const decision = body.decision;
    if (decision !== 'approved' && decision !== 'rejected') throw invalid('decision: approved or rejected');
    const note = textField(body, 'note', 1000, false);
    const effectiveFrom = body.effectiveFrom === undefined ? null : dateOnlyField(body.effectiveFrom, 'effectiveFrom');
    const actor = await this.conversations.requireActor(actorId);
    const request = await this.prisma.scheduleChangeRequest.findUnique({ where: { id: requestId } });
    if (!request || request.organizationId !== actor.organizationId) {
      throw new CommError(CommErrorCode.LESSON_NOT_FOUND, 'request not found');
    }
    const { learner, standing } = await this.learnerFor(actor, request.learnerId, 'read_schedule');
    this.requireAct(actor, standing, 'decide_schedule_change');
    if (request.status !== 'pending') throw stateError('this request is already decided');

    const duration = await this.currentDuration(learner.id);
    const slots: WeeklySlot[] = (request.slots as Array<{ weekday: number; start: string }>).map((s) => ({
      weekday: s.weekday,
      startMinute: minuteField(s.start, 'slots.start'),
      durationMinutes: duration,
    }));
    const lang = await this.lessons.languageOf({ learner: { familyId: learner.familyId } });
    const finish = async (tx: Tx) => {
      await tx.scheduleChangeRequest.update({
        where: { id: request.id },
        data: { status: decision, decidedBy: actor.actorId, decidedAt: new Date(), decisionNote: note },
      });
      await this.lessons.postCard(
        tx,
        this.subject(learner),
        null,
        CardKind.SCHEDULE_CHANGE_DECIDED,
        { learnerName: learner.name, requestId: request.id, decision, note, slots: request.slots },
        lang,
      );
    };
    if (decision === 'approved') {
      await this.applySchedule(actor, learner, slots, effectiveFrom, finish);
    } else {
      await this.lessons.write(() => this.prisma.$transaction(finish));
    }
    return { id: request.id, status: decision };
  }

  // ------------------------------------------------------------------
  // Make-ups
  // ------------------------------------------------------------------

  /** The free start times a family may book the make-up of `lessonId` into. */
  async makeupSlots(actorId: string, lessonId: string) {
    const actor = await this.conversations.requireActor(actorId);
    const { lesson, standing } = await this.lessons.load(actor, lessonId);
    this.requireAct(actor, standing, 'book_makeup');
    await this.assertOwed(lesson);
    const duration = minutesBetween(lesson.startsAt, lesson.endsAt);
    const slots = await this.freeSlots(lesson.teacherId, duration);
    const tz = await this.prisma.teacherAvailability.findFirst({ where: { teacherId: lesson.teacherId }, select: { timezone: true } });
    return {
      lessonId: lesson.id,
      durationMinutes: duration,
      timezone: tz?.timezone ?? null,
      slots: slots.map((d) => d.toISOString()),
    };
  }

  /**
   * Book the make-up a teacher-cancelled lesson owes, into one of the teacher's
   * real free times. Instant (PD-11): no one approves it. The database refuses a
   * second live make-up for the same lesson and any overlap for the teacher.
   */
  async bookMakeup(actorId: string, lessonId: string, body: Record<string, unknown>) {
    const startsAt = dateField(body, 'startsAt');
    const actor = await this.conversations.requireActor(actorId);
    const { lesson, standing } = await this.lessons.load(actor, lessonId);
    this.requireAct(actor, standing, 'book_makeup');
    await this.assertOwed(lesson);
    const duration = minutesBetween(lesson.startsAt, lesson.endsAt);
    const free = await this.freeSlots(lesson.teacherId, duration);
    if (!free.some((d) => d.getTime() === startsAt.getTime())) {
      throw stateError('that time is not free any more; choose another');
    }
    const lang = await this.lessons.languageOf(lesson);
    const makeup = await this.lessons.write(() =>
      this.prisma.$transaction(async (tx) => {
        const created = await tx.lesson.create({
          data: {
            organizationId: lesson.organizationId,
            learnerId: lesson.learnerId,
            teacherId: lesson.teacherId,
            kind: LessonKind.MAKEUP,
            makeupFor: lesson.id,
            startsAt,
            endsAt: new Date(startsAt.getTime() + duration * 60_000),
            createdByKind: actor.kind === ActorKind.CONTACT ? 'contact' : 'staff',
            createdBy: actor.actorId,
          },
          include: LESSON_INCLUDE,
        });
        await this.lessons.postCard(
          tx, created, actor, CardKind.LESSON_MAKEUP_BOOKED,
          { ...this.lessons.cardBase(created), makeupFor: lesson.id, missedStartsAt: lesson.startsAt.toISOString() },
          lang,
        );
        await this.audit.audit(tx, {
          actorId: actor.actorId, action: 'lesson.makeup_booked', entity: 'lesson', entityId: created.id,
          after: { makeupFor: lesson.id, startsAt: startsAt.toISOString() }, reason: 'make-up booked',
        });
        return created;
      }),
    );
    return this.lessons.get(actorId, makeup.id);
  }

  /**
   * A supervisor records what was done about a teacher-cancelled lesson that no
   * make-up replaced (PD-11 case 2). It is kept as a ruling on the lesson -- the
   * Teacher Supervision record -- the family is told, and Core is told so a
   * credit or an extension reaches the package.
   */
  async resolveMakeup(actorId: string, lessonId: string, body: Record<string, unknown>) {
    const action = body.action;
    if (typeof action !== 'string' || !MAKEUP_ACTIONS.has(action)) {
      throw invalid(`action: one of ${[...MAKEUP_ACTIONS].join(', ')}`);
    }
    const note = textField(body, 'note', 1000, false);
    const actor = await this.conversations.requireActor(actorId);
    const { lesson, standing } = await this.lessons.load(actor, lessonId);
    this.requireAct(actor, standing, 'resolve_makeup');
    await this.assertOwed(lesson);
    const lang = await this.lessons.languageOf(lesson);
    await this.lessons.write(() =>
      this.prisma.$transaction(async (tx) => {
        const ruling = await tx.lessonRuling.create({
          data: {
            organizationId: lesson.organizationId,
            lessonId: lesson.id,
            kind: RulingKind.MAKEUP_FOLLOWUP,
            openedByKind: ActorKind.STAFF,
            openedBy: actor.actorId,
            reason: note ?? action,
          },
        });
        await tx.lessonRuling.update({
          where: { id: ruling.id },
          data: { decision: action, decidedBy: actor.actorId, decidedAt: new Date(), decisionNote: note },
        });
        await this.lessons.postCard(
          tx, lesson, null, CardKind.LESSON_MAKEUP_RESOLVED,
          { ...this.lessons.cardBase(lesson), action, note },
          lang,
        );
        await this.outbox.enqueue(tx, CommEvent.LESSON_MAKEUP_RESOLVED, {
          lessonId: lesson.id,
          learnerId: lesson.learnerId,
          teacherId: lesson.teacherId,
          action,
          durationMinutes: minutesBetween(lesson.startsAt, lesson.endsAt),
        });
        await this.audit.audit(tx, {
          actorId: actor.actorId, action: 'lesson.makeup_resolved', entity: 'lesson', entityId: lesson.id,
          after: { action, rulingId: ruling.id }, reason: note ?? action,
        });
      }),
    );
    return this.lessons.get(actorId, lesson.id);
  }

  // ------------------------------------------------------------------
  // The sweep (the worker)
  // ------------------------------------------------------------------

  /** Materialize lessons from regular times, then schedule the reminders now due. */
  async sweep(): Promise<{ materialized: number; reminded: number }> {
    const materialized = await this.materialize();
    const reminded = await this.scheduleDueReminders();
    return { materialized, reminded };
  }

  async materialize(): Promise<number> {
    const weeks = Number(await this.config.get('lesson.materialize_weeks'));
    const rows = await this.prisma.$queryRaw<Array<{ n: number }>>`
      SELECT chat.materialize_lessons(now(), now() + make_interval(weeks => ${weeks}::int)) AS n`;
    return Number(rows[0]?.n ?? 0);
  }

  /**
   * Reminders for every open lesson starting in the next 26 hours that has none
   * yet: the family 24 h and 30 min before, the teacher 15 min before (rules are
   * data: chat.notification_rule, event `lesson_scheduled`). A rule whose moment
   * has already passed is skipped, never sent late.
   */
  async scheduleDueReminders(): Promise<number> {
    const due = await this.prisma.lesson.findMany({
      where: {
        outcome: null,
        remindersScheduledAt: null,
        startsAt: { gt: new Date(), lte: new Date(Date.now() + 26 * 3_600_000) },
      },
      include: { learner: { select: { familyId: true, family: { select: { language: true } } } } },
      orderBy: { startsAt: 'asc' },
      take: 500,
    });
    for (const lesson of due) {
      const parents = await this.prisma.contact.findMany({
        where: { familyId: lesson.learner.familyId, isActive: true, canMessage: true },
        select: { id: true },
      });
      const locale = lesson.learner.family.language === 'en' ? 'en' : 'ar';
      await this.reminders.scheduleForEvent('lesson_scheduled', {
        subjectId: lesson.id,
        anchorAt: lesson.startsAt,
        recipients: [
          { actorId: lesson.teacherId, role: 'teacher', locale },
          ...parents.map((p) => ({ actorId: p.id, role: 'parent', locale })),
        ],
        familyId: lesson.learner.familyId,
        skipPast: true,
      });
      await this.prisma.lesson.update({ where: { id: lesson.id }, data: { remindersScheduledAt: new Date() } });
    }
    return due.length;
  }

  // ------------------------------------------------------------------
  // Internals
  // ------------------------------------------------------------------

  /**
   * Replace a learner's regular times from `effectiveFrom` (default: today in
   * the teacher's zone). In one transaction: the current slots end, their open
   * lessons from that day on become `rescheduled` (and lose their reminders),
   * the new slots begin, and `then` runs (an approval's request and card).
   * Lessons are then materialized for the new times.
   */
  private async applySchedule(
    actor: Actor,
    learner: Learner,
    slots: WeeklySlot[],
    effectiveFrom: string | null,
    then: ((tx: Tx) => Promise<void>) | null,
  ) {
    if (!learner.teacherId) throw stateError('this learner has no teacher yet');
    const teacherId = learner.teacherId;
    const tzRow = await this.prisma.teacherAvailability.findFirst({ where: { teacherId }, select: { timezone: true } });
    if (!tzRow) throw stateError('set the teacher\'s availability first');
    const timezone = tzRow.timezone;
    await this.assertFree(teacherId, learner.id, slots);
    const today = await this.prisma.$queryRaw<Array<{ d: string }>>`
      SELECT to_char((now() AT TIME ZONE ${timezone})::date, 'YYYY-MM-DD') AS d`;
    const from = effectiveFrom ?? today[0].d;
    if (from < today[0].d) throw invalid('effectiveFrom: today or later');

    await this.lessons.write(() =>
      this.prisma.$transaction(async (tx) => {
        const ended = await tx.$queryRaw<Array<{ id: string }>>`
          UPDATE chat.learner_schedule_slot
             SET valid_to = greatest(valid_from, ${from}::date)
           WHERE learner_id = ${learner.id}::uuid AND valid_to IS NULL
          RETURNING id::text AS id`;
        if (ended.length > 0) {
          const moved = await tx.$queryRaw<Array<{ id: string }>>`
            SELECT l.id::text AS id FROM chat.lesson l
             WHERE l.schedule_slot_id = ANY(${ended.map((e) => e.id)}::uuid[])
               AND l.outcome IS NULL
               AND l.starts_at > now()
               AND l.starts_at >= (${from}::date::timestamp AT TIME ZONE ${timezone})`;
          if (moved.length > 0) {
            await tx.lesson.updateMany({
              where: { id: { in: moved.map((m) => m.id) } },
              data: {
                outcome: LessonOutcome.RESCHEDULED,
                outcomeNote: 'regular times changed',
                outcomeByKind: ActorKind.STAFF,
                outcomeBy: actor.actorId,
                outcomeAt: new Date(),
              },
            });
            for (const m of moved) await cancelReminders(tx, m.id);
          }
        }
        if (slots.length > 0) {
          await tx.learnerScheduleSlot.createMany({
            data: slots.map((s) => ({
              organizationId: learner.organizationId,
              learnerId: learner.id,
              teacherId,
              weekday: s.weekday,
              startMinute: s.startMinute,
              durationMinutes: s.durationMinutes,
              timezone,
              validFrom: new Date(`${from}T00:00:00Z`),
              createdBy: actor.actorId,
            })),
          });
        }
        await this.audit.audit(tx, {
          actorId: actor.actorId,
          action: 'learner.schedule_set',
          entity: 'learner',
          entityId: learner.id,
          after: { effectiveFrom: from, slots: slots.map((s) => ({ weekday: s.weekday, start: hhmm(s.startMinute), durationMinutes: s.durationMinutes })) },
          reason: 'regular lesson times replaced',
        });
        if (then) await then(tx);
      }),
    );
    await this.materialize();
  }

  /** Every wanted weekly time must be free for the teacher (this learner's own current times excepted). */
  private async assertFree(teacherId: string, learnerId: string, slots: WeeklySlot[]) {
    for (const a of slots) {
      for (const b of slots) {
        if (a !== b && a.weekday === b.weekday && a.startMinute < b.startMinute + b.durationMinutes && b.startMinute < a.startMinute + a.durationMinutes) {
          throw invalid('slots: two times overlap on the same day');
        }
      }
    }
    for (const s of slots) {
      const rows = await this.prisma.$queryRaw<Array<{ ok: boolean }>>`
        SELECT EXISTS (
          SELECT 1 FROM chat.teacher_free_weekly_slots(${teacherId}::uuid, ${s.durationMinutes}::int, 5, ${learnerId}::uuid) f
           WHERE f.weekday = ${s.weekday} AND f.start_minute = ${s.startMinute}
        ) AS ok`;
      if (!rows[0]?.ok) {
        throw stateError(`${weekdayName(s.weekday)} ${hhmm(s.startMinute)} is not a free time for this teacher`);
      }
    }
  }

  private async weeklyOptions(teacherId: string, duration: number, step: number, learnerId: string) {
    return this.prisma.$queryRaw<Array<{ weekday: number; start_minute: number; timezone: string; next_at: Date }>>`
      WITH f AS (
        SELECT * FROM chat.teacher_free_weekly_slots(${teacherId}::uuid, ${duration}::int, ${step}::int, ${learnerId}::uuid)
      ), d AS (
        SELECT f.*, (now() AT TIME ZONE f.timezone)::date AS today
          FROM f
      )
      SELECT d.weekday::int AS weekday, d.start_minute, d.timezone,
             (SELECT min(x) FROM (VALUES
                (((d.today + ((d.weekday - extract(isodow FROM d.today)::int + 7) % 7)) + make_interval(mins => d.start_minute)) AT TIME ZONE d.timezone),
                (((d.today + ((d.weekday - extract(isodow FROM d.today)::int + 7) % 7) + 7) + make_interval(mins => d.start_minute)) AT TIME ZONE d.timezone)
              ) v(x) WHERE x > now()) AS next_at
        FROM d
       ORDER BY d.weekday, d.start_minute`;
  }

  private async freeSlots(teacherId: string, duration: number): Promise<Date[]> {
    const lead = Number(await this.config.get('lesson.booking_lead_minutes'));
    const horizon = Number(await this.config.get('lesson.makeup_horizon_days'));
    const step = Number(await this.config.get('lesson.slot_step_minutes'));
    const rows = await this.prisma.$queryRaw<Array<{ starts_at: Date }>>`
      SELECT starts_at FROM chat.teacher_free_slots(
        ${teacherId}::uuid,
        now() + make_interval(mins => ${lead}::int),
        now() + make_interval(days => ${horizon}::int),
        ${duration}::int,
        ${step}::int)`;
    return rows.map((r) => r.starts_at);
  }

  private async assertOwed(lesson: { id: string; organizationId: string; learnerId: string }) {
    const owed = await this.lessons.owedMakeups(lesson.organizationId, { learnerIds: [lesson.learnerId] });
    if (!owed.some((l) => l.id === lesson.id)) {
      throw stateError('this lesson does not owe a make-up (it was given, or already replaced or resolved)');
    }
  }

  /** The length of the learner's regular lessons (the first current slot), or 30 minutes. */
  private async currentDuration(learnerId: string): Promise<number> {
    const slot = await this.prisma.learnerScheduleSlot.findFirst({
      where: { learnerId, validTo: null },
      orderBy: { createdAt: 'asc' },
      select: { durationMinutes: true },
    });
    return slot?.durationMinutes ?? 30;
  }

  /** How the actor stands to a learner -- the same standing a lesson of theirs would give. */
  private async learnerFor(actor: Actor, learnerId: string, act: LessonAct): Promise<{ learner: Learner; standing: LessonStanding }> {
    if (!isUuid(learnerId)) throw new CommError(CommErrorCode.LESSON_NOT_FOUND, 'learner not found');
    const learner = await this.prisma.learner.findUnique({ where: { id: learnerId } });
    if (!learner) throw new CommError(CommErrorCode.LESSON_NOT_FOUND, 'learner not found');
    const staff = actor.kind === ActorKind.STAFF;
    const standing = this.authz.lessonStanding(
      actor,
      { organizationId: learner.organizationId, teacherId: learner.teacherId ?? '', familyId: learner.familyId },
      {
        teachersDepartment: staff ? await this.lessons.isManager(actor) : false,
        supervisesLearner: staff ? (await this.lessons.supervisedLearnerIds(actor, new Date(), learner.id)).length > 0 : false,
      },
    );
    if (!standing) throw new CommError(CommErrorCode.LESSON_NOT_FOUND, 'learner not found');
    this.requireAct(actor, standing, act);
    return { learner, standing };
  }

  private requireAct(actor: Actor, standing: LessonStanding, act: LessonAct) {
    const d = this.authz.canRecordLessonAct(actor, standing, act);
    if (!d.allowed) throw new CommError(d.code, d.reason);
  }

  /** A teacher of the actor's organization (managers), or answered as unknown. */
  private async orgTeacher(actor: Actor, teacherId: string) {
    if (!isUuid(teacherId)) throw new CommError(CommErrorCode.LESSON_NOT_FOUND, 'teacher not found');
    const teacher = await this.prisma.teacher.findFirst({ where: { id: teacherId, organizationId: actor.organizationId } });
    if (!teacher) throw new CommError(CommErrorCode.LESSON_NOT_FOUND, 'teacher not found');
    return teacher;
  }

  /** The Teachers department reads any teacher's availability; a teacher reads their own ('me'). */
  private async readableTeacher(actor: Actor, teacherId: string) {
    if (actor.kind === ActorKind.TEACHER && (teacherId === 'me' || teacherId === actor.actorId)) {
      return this.orgTeacher(actor, actor.actorId);
    }
    await this.lessons.requireManager(actor);
    return this.orgTeacher(actor, teacherId);
  }

  private subject(learner: Learner) {
    return { id: null, learnerId: learner.id, organizationId: learner.organizationId, teacherId: learner.teacherId ?? '' };
  }
}

function hhmm(minute: number): string {
  return `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`;
}

function minuteField(v: unknown, key: string): number {
  if (typeof v !== 'string') throw invalid(`${key}: a time as HH:MM`);
  const m = HHMM_RE.exec(v);
  if (!m) throw invalid(`${key}: a time as HH:MM`);
  return Number(m[1]) * 60 + Number(m[2]);
}

function weekdayField(v: unknown, key: string): number {
  if (typeof v !== 'number' || !Number.isInteger(v) || v < 1 || v > 7) throw invalid(`${key}: 1 (Monday) to 7 (Sunday)`);
  return v;
}

function dateOnlyField(v: unknown, key: string): string {
  if (typeof v !== 'string' || !DATE_RE.test(v) || Number.isNaN(Date.parse(`${v}T00:00:00Z`))) {
    throw invalid(`${key}: a date as YYYY-MM-DD`);
  }
  return v;
}

/** `[{ weekday, start: 'HH:MM', durationMinutes? }]`; a duration is required only when `withDuration`. */
function slotsField(v: unknown, withDuration: boolean): WeeklySlot[] {
  if (!Array.isArray(v) || v.length < 1 || v.length > 7) throw invalid('slots: between 1 and 7 weekly times');
  return v.map((raw, i) => {
    if (typeof raw !== 'object' || raw === null) throw invalid(`slots[${i}]: an object`);
    const o = raw as Record<string, unknown>;
    const weekday = weekdayField(o.weekday, `slots[${i}].weekday`);
    const startMinute = minuteField(o.start, `slots[${i}].start`);
    let durationMinutes = 30;
    if (withDuration) {
      const d = o.durationMinutes;
      if (typeof d !== 'number' || !Number.isInteger(d) || d < 15 || d > 240) {
        throw invalid(`slots[${i}].durationMinutes: 15 to 240`);
      }
      durationMinutes = d;
    }
    return { weekday, startMinute, durationMinutes };
  });
}

function minutesBetween(a: Date, b: Date): number {
  return Math.round((b.getTime() - a.getTime()) / 60_000);
}

function weekdayName(d: number): string {
  return ['', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'][d] ?? String(d);
}
