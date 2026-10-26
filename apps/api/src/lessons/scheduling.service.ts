import { Inject, Injectable, Logger } from '@nestjs/common';
import { Learner, Prisma } from '@prisma/client';
import { PrismaService } from '../platform/prisma.service';
import { AppConfigService } from '../platform/app-config.service';
import { AuthorizationService, type LessonAct, type LessonStanding } from '../platform/authorization.service';
import { CommError, CommErrorCode } from '../platform/errors';
import { AUDIT_SERVICE, SUBSCRIPTION_LOCK } from '../platform/tokens';
import { NO_SUBSCRIPTION_LOCK, type SubscriptionLockReader } from '../platform/subscription-lock';
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
  NotificationStatus,
  RulingKind,
} from '../communication/contracts/vocab';
import { localDate, readerClockShifts, weeklyStartsAround } from '../platform/time-zone';
import { zonesOf } from '../platform/time-zone.service';
import {
  LESSON_INCLUDE,
  MAKEUP_CAUSES,
  TEACHER_MAKEUP_CAUSES,
  LessonService,
  learnerLesson,
  cancelReminders,
  dateField,
  movedByOf,
  invalid,
  stateError,
  textField,
  type Tx,
} from './lesson.service';

export type WeeklySlot = { weekday: number; startMinute: number; durationMinutes: number };

/** PD-31: why a lesson may not be moved by this reader right now. */
type MoveRefusal = 'not_movable' | 'started' | 'too_late' | 'family_already_moved' | 'family_monthly_limit';
const MOVE_REFUSALS: Readonly<Record<MoveRefusal, string>> = {
  not_movable: 'only an open regular or make-up lesson can be moved',
  started: 'a lesson that has started cannot be moved',
  too_late: 'it is too close to the start to move this lesson; ask the supervision team',
  family_already_moved: 'this lesson was already moved once by the family',
  family_monthly_limit: 'the family has moved this child\'s lessons as many times as allowed this month',
};

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const HHMM_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;
const MAKEUP_ACTIONS: ReadonlySet<string> = new Set(Object.values(MakeupAction));

/** PD-22: the event of the daylight-saving warning (rule lesson_clock_shift_parent). */
export const CLOCK_SHIFT_EVENT = 'lesson_clock_shift';
/**
 * How often the worker looks for clock changes. A warning goes out days ahead,
 * and the look formats three starts of every slot in every parent's zone, so the
 * lesson sweep's five minutes would be work for nothing.
 */
const CLOCK_SHIFT_SWEEP_MS = 3_600_000;
/** failure_code of a warning cancelled because it no longer holds -- and may be revived. */
const CLOCK_SHIFT_GONE = 'CLOCK_SHIFT_GONE';

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
  private readonly log = new Logger(SchedulingService.name);
  private nextClockShiftSweepAt = 0;

  constructor(
    private readonly prisma: PrismaService,
    private readonly authz: AuthorizationService,
    private readonly conversations: ConversationService,
    private readonly lessons: LessonService,
    private readonly outbox: OutboxService,
    private readonly config: AppConfigService,
    private readonly reminders: ReminderService,
    @Inject(AUDIT_SERVICE) private readonly audit: AuditService,
    // PD-30: the payment lock (chat.learner_lesson_lock + the switch). Required
    // from the container; positional harness constructions get no lock.
    @Inject(SUBSCRIPTION_LOCK) private readonly locks: SubscriptionLockReader = NO_SUBSCRIPTION_LOCK,
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
    // Through write(): a day off the database will not let go (PD-12: one that
    // belongs to an approved leave) comes back as 409 with the database's reason.
    await this.lessons.write(() =>
      this.prisma.$transaction(async (tx) => {
        await tx.teacherDayOff.deleteMany({ where: { teacherId: teacher.id, day: new Date(`${day}T00:00:00Z`) } });
        await this.audit.audit(tx, {
          actorId: actor.actorId, action: 'teacher.day_off_removed', entity: 'teacher', entityId: teacher.id,
          before: { date: day }, reason: 'day off removed',
        });
      }),
    );
    return this.availability(actorId, teacher.id);
  }

  /**
   * What the Teachers department schedules for: every teacher (with their zone)
   * and every learner (with their teacher, family, current regular times and
   * any active pause). The Admin Web's Schedules tab reads this; it is the
   * department's view of the whole organization, as PD-10 gives it.
   */
  async roster(actorId: string) {
    const actor = await this.conversations.requireActor(actorId);
    await this.lessons.requireManager(actor);
    const org = actor.organizationId as string;
    const [teachers, zones, learners, slots, pauses] = await Promise.all([
      this.prisma.teacher.findMany({ where: { organizationId: org }, select: { id: true, name: true, isActive: true, leftAt: true }, orderBy: { name: 'asc' } }),
      this.prisma.teacherAvailability.findMany({ where: { organizationId: org }, select: { teacherId: true, timezone: true }, distinct: ['teacherId'] }),
      this.prisma.learner.findMany({
        where: { organizationId: org },
        include: { family: { select: { id: true, displayName: true } } },
        orderBy: { name: 'asc' },
        take: 5000,
      }),
      this.prisma.learnerScheduleSlot.findMany({ where: { organizationId: org, validTo: null }, orderBy: [{ weekday: 'asc' }, { startMinute: 'asc' }] }),
      this.prisma.learnerSuspension.findMany({ where: { organizationId: org, status: 'active' } }),
    ]);
    const zoneOf = new Map(zones.map((z) => [z.teacherId, z.timezone]));
    const pauseOf = new Map(pauses.map((p) => [p.learnerId, p]));
    return {
      teachers: teachers.map((t) => ({
        id: t.id,
        name: t.name,
        isActive: t.isActive && t.leftAt === null,
        timezone: zoneOf.get(t.id) ?? null,
      })),
      learners: learners.map((l) => {
        const pause = pauseOf.get(l.id);
        return {
          id: l.id,
          name: l.name,
          family: { id: l.family.id, displayName: l.family.displayName },
          teacherId: l.teacherId,
          slots: slots
            .filter((x) => x.learnerId === l.id)
            .map((x) => ({ weekday: x.weekday, start: hhmm(x.startMinute), durationMinutes: x.durationMinutes })),
          suspension: pause
            ? { id: pause.id, kind: pause.kind, returnOn: pause.returnOn ? pause.returnOn.toISOString().slice(0, 10) : null }
            : null,
        };
      }),
    };
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
    const teacher = learner.teacherId
      ? await this.prisma.teacher.findUnique({ where: { id: learner.teacherId }, select: { id: true, name: true } })
      : null;
    // PD-31: the next time each weekly slot really happens (an instance moved
    // away, cancelled or paused is skipped), so a reader in any zone sees it in
    // their own clock.
    const next = await this.slotNextStarts(slots.map((x) => x.id));
    return {
      learnerId: learner.id,
      timezone: slots[0]?.timezone ?? null,
      teacher,
      slots: slots.map((s) => ({
        id: s.id,
        weekday: s.weekday,
        start: hhmm(s.startMinute),
        durationMinutes: s.durationMinutes,
        validFrom: s.validFrom.toISOString().slice(0, 10),
        nextStartsAt: next.get(s.id)?.toISOString() ?? null,
      })),
      pendingRequest: pending
        ? {
            id: pending.id,
            slots: pending.slots,
            note: pending.note,
            createdAt: pending.createdAt.toISOString(),
            effectiveFrom: pending.effectiveFrom ? pending.effectiveFrom.toISOString().slice(0, 10) : null,
            requestedBy: pending.requestedByKind === 'teacher' ? 'teacher' : 'family',
          }
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
   *
   * PD-31: also the learner's current times (the picker shows what changes),
   * and for each option the starts in the next weeks that another lesson of
   * the teacher already holds -- the week the new time would be skipped is
   * shown before anyone chooses it. Staff who may change the teacher ask for
   * another teacher's options with `teacherId`.
   */
  async scheduleOptions(actorId: string, learnerId: string, teacherId?: string) {
    const actor = await this.conversations.requireActor(actorId);
    const { learner, standing } = await this.learnerFor(actor, learnerId, 'read_schedule');
    let forTeacher = learner.teacherId;
    if (teacherId !== undefined && teacherId !== learner.teacherId) {
      this.requireAct(actor, standing, 'transfer');
      forTeacher = (await this.orgTeacher(actor, teacherId)).id;
    }
    const locked = await this.lockOf(learner.id);
    const duration = await this.currentDuration(learner.id);
    const current = await this.currentSlots(learner.id);
    if (!forTeacher) return { timezone: null, durationMinutes: duration, locked, current, options: [] };
    const step = Number(await this.config.get('lesson.slot_step_minutes'));
    const rows = await this.weeklyOptions(forTeacher, duration, step, learner.id);
    const except = await this.weeklyExceptions(forTeacher, duration, step, learner.id);
    return {
      timezone: rows[0]?.timezone ?? null,
      durationMinutes: duration,
      locked,
      current,
      options: rows.map((r) => ({
        weekday: r.weekday,
        start: hhmm(r.start_minute),
        nextStartsAt: r.next_at.toISOString(),
        except: (except.get(`${r.weekday}:${r.start_minute}`) ?? []).map((d) => d.toISOString()),
      })),
    };
  }

  /**
   * A family -- or, PD-31, the child's teacher -- asks for new regular times,
   * chosen from the free options: the FULL new set, from a day (default: the
   * day it is approved). A Teachers-department supervisor decides.
   */
  async requestScheduleChange(actorId: string, learnerId: string, body: Record<string, unknown>) {
    const actor = await this.conversations.requireActor(actorId);
    const { learner, standing } = await this.learnerFor(actor, learnerId, 'read_schedule');
    this.requireAct(actor, standing, 'request_schedule_change');
    if (!learner.teacherId) throw stateError('this learner has no teacher yet');
    if (await this.lockOf(learner.id)) throw stateError('locked');
    if (await this.prisma.scheduleChangeRequest.count({ where: { learnerId: learner.id, status: 'pending' } })) {
      throw stateError('a request for this learner is already waiting for a decision');
    }
    const duration = await this.currentDuration(learner.id);
    const wanted = slotsField(body.slots, false).map((s) => ({ ...s, durationMinutes: duration }));
    const note = textField(body, 'note', 1000, false);
    const effectiveFrom = body.effectiveFrom === undefined || body.effectiveFrom === null
      ? null
      : dateOnlyField(body.effectiveFrom, 'effectiveFrom');
    if (effectiveFrom && effectiveFrom < (await this.teacherToday(learner.teacherId))) throw invalid('effectiveFrom: today or later');
    await this.assertFree(learner.teacherId, learner.id, wanted);
    const step = Number(await this.config.get('lesson.slot_step_minutes'));
    const next = new Map(
      (await this.weeklyOptions(learner.teacherId, duration, step, learner.id)).map((r) => [`${r.weekday}:${r.start_minute}`, r]),
    );
    const byTeacher = actor.kind === ActorKind.TEACHER;

    const lang = await this.lessons.languageOf({ learner: { familyId: learner.familyId } });
    const request = await this.lessons.write(() =>
      this.prisma.$transaction(async (tx) => {
        const created = await tx.scheduleChangeRequest.create({
          data: {
            organizationId: learner.organizationId,
            learnerId: learner.id,
            requestedBy: actor.actorId,
            requestedByKind: byTeacher ? 'teacher' : 'contact',
            effectiveFrom: effectiveFrom ? new Date(`${effectiveFrom}T00:00:00Z`) : null,
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
            effectiveFrom,
            requestedBy: byTeacher ? 'teacher' : 'family',
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
    // PD-31: the day the requester asked for, unless the approver names another
    // or it has passed while the request waited.
    let from = effectiveFrom;
    if (from === null && request.effectiveFrom && learner.teacherId) {
      const asked = request.effectiveFrom.toISOString().slice(0, 10);
      if (asked >= (await this.teacherToday(learner.teacherId))) from = asked;
    }

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
      await this.applySchedule(actor, learner, slots, from, finish);
    } else {
      await this.lessons.write(() => this.prisma.$transaction(finish));
    }
    return { id: request.id, status: decision };
  }

  // ------------------------------------------------------------------
  // Make-ups
  // ------------------------------------------------------------------

  /**
   * The teacher's free start times for the make-up of `lessonId`: the only
   * times a family may book, and suggestions for the teacher and staff.
   */
  async makeupSlots(actorId: string, lessonId: string) {
    const actor = await this.conversations.requireActor(actorId);
    const { lesson, standing } = await this.lessons.load(actor, lessonId);
    this.requireAct(actor, standing, 'book_makeup');
    await this.assertOwed(lesson, MAKEUP_CAUSES);
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
   * "Reschedule a make-up class" (PD-11 T2, PD-15): book the make-up an
   * apologised or teacher-cancelled lesson owes. It is recorded once the family
   * and the teacher have agreed on a time, never when the apology is filed.
   *
   * A family books only into one of the teacher's real free times (instant,
   * PD-11). The teacher and staff record the time that was agreed -- any future
   * time that is not one of the teacher's days off. Either way the database
   * refuses a second live make-up for the same lesson and any overlap for the
   * teacher. The make-up stays linked to the lesson it replaces (makeup_for)
   * and counts as a completed lesson only once it is itself reported held.
   */
  async bookMakeup(actorId: string, lessonId: string, body: Record<string, unknown>) {
    const startsAt = dateField(body, 'startsAt');
    const actor = await this.conversations.requireActor(actorId);
    const { lesson, standing } = await this.lessons.load(actor, lessonId);
    this.requireAct(actor, standing, 'book_makeup');
    await this.assertOwed(lesson, MAKEUP_CAUSES);
    await this.lessons.assertMayBook(lesson.learnerId);
    const duration = minutesBetween(lesson.startsAt, lesson.endsAt);
    if (actor.kind === ActorKind.CONTACT) {
      const free = await this.freeSlots(lesson.teacherId, duration);
      if (!free.some((d) => d.getTime() === startsAt.getTime())) {
        throw stateError('that time is not free any more; choose another');
      }
    } else {
      await this.assertAgreedTime(lesson.teacherId, startsAt);
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
            createdByKind: actor.kind === ActorKind.CONTACT ? 'contact' : actor.kind === ActorKind.TEACHER ? 'teacher' : 'staff',
            createdBy: actor.actorId,
          },
          include: LESSON_INCLUDE,
        }).then(learnerLesson);
        await this.lessons.postCard(
          tx, created, actor, CardKind.LESSON_MAKEUP_BOOKED,
          { ...this.lessons.cardBase(created), makeupFor: lesson.id, missedStartsAt: lesson.startsAt.toISOString(), missedOutcome: lesson.outcome },
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
  // PD-31: moving ONE lesson
  // ------------------------------------------------------------------

  /**
   * The free times one lesson may move to, or why it may not move. The family's
   * limits are checked here so the picker says why instead of offering chips a
   * submit would refuse: the booking lead before the start, one family move per
   * lesson (over its whole moved chain) and `lesson.family_moves_per_month` per
   * child. Staff are unlimited.
   */
  async moveSlots(actorId: string, lessonId: string) {
    const actor = await this.conversations.requireActor(actorId);
    const { lesson, standing } = await this.lessons.load(actor, lessonId);
    this.requireAct(actor, standing, 'move_lesson');
    const duration = minutesBetween(lesson.startsAt, lesson.endsAt);
    const check = await this.moveCheck(actor, lesson);
    const tz = await this.prisma.teacherAvailability.findFirst({ where: { teacherId: lesson.teacherId }, select: { timezone: true } });
    const slots = check.locked || check.refusal ? [] : await this.freeSlots(lesson.teacherId, duration);
    return {
      lessonId: lesson.id,
      startsAt: lesson.startsAt.toISOString(),
      durationMinutes: duration,
      timezone: tz?.timezone ?? null,
      slots: slots.map((d) => d.toISOString()),
      locked: check.locked,
      refusal: check.refusal,
      familyMovesLeft: check.familyMovesLeft,
    };
  }

  /**
   * Move one lesson to another time, at once. It is not an apology and not a
   * violation: the old row becomes `rescheduled` (counted for nobody) and the
   * lesson continues as a new row that names it (`moved_from`), so reminders,
   * free times and statistics stay right. The family and the teacher choose one
   * of the teacher's free times; staff may also record another agreed time
   * (not on a day off). The database refuses an overlap.
   */
  async moveLesson(actorId: string, lessonId: string, body: Record<string, unknown>) {
    const startsAt = dateField(body, 'startsAt');
    const actor = await this.conversations.requireActor(actorId);
    const { lesson, standing } = await this.lessons.load(actor, lessonId);
    this.requireAct(actor, standing, 'move_lesson');
    const check = await this.moveCheck(actor, lesson);
    if (check.locked) throw stateError('locked');
    if (check.refusal) throw stateError(MOVE_REFUSALS[check.refusal]);
    if (startsAt.getTime() === lesson.startsAt.getTime()) throw invalid('startsAt: a different time');
    const duration = minutesBetween(lesson.startsAt, lesson.endsAt);
    const free = await this.freeSlots(lesson.teacherId, duration);
    if (!free.some((d) => d.getTime() === startsAt.getTime())) {
      if (actor.kind !== ActorKind.STAFF) throw stateError('that time is not free any more; choose another');
      await this.assertAgreedTime(lesson.teacherId, startsAt, 'a lesson');
    }
    const by = actor.kind === ActorKind.CONTACT ? 'contact' : actor.kind === ActorKind.TEACHER ? 'teacher' : 'staff';
    const lang = await this.lessons.languageOf(lesson);
    const familyLimit = Number(await this.config.get('lesson.family_moves_per_month'));
    const moved = await this.lessons.write(() =>
      this.prisma.$transaction(async (tx) => {
        // One writer per child at a time: two moves, or a move and a change of
        // teacher (chat.transfer_learner locks the same row), queue here, and the
        // family's limits are counted again behind the lock.
        await tx.$queryRaw`SELECT id FROM chat.learner WHERE id = ${lesson.learnerId}::uuid FOR UPDATE`;
        if (actor.kind === ActorKind.CONTACT) {
          if (await this.familyMovedChain(lesson, tx)) throw stateError(MOVE_REFUSALS.family_already_moved);
          if ((await this.familyMovesThisMonth(lesson.learnerId, tx)) >= familyLimit) throw stateError(MOVE_REFUSALS.family_monthly_limit);
        }
        const closed = await tx.lesson.updateMany({
          where: { id: lesson.id, outcome: null, teacherId: lesson.teacherId },
          data: { outcome: LessonOutcome.RESCHEDULED, outcomeNote: 'moved to another time', outcomeByKind: by, outcomeBy: actor.actorId, outcomeAt: new Date() },
        });
        if (closed.count !== 1) throw stateError('this lesson changed meanwhile; open it again');
        await cancelReminders(tx, lesson.id);
        const created = await tx.lesson.create({
          data: {
            organizationId: lesson.organizationId,
            learnerId: lesson.learnerId,
            teacherId: lesson.teacherId,
            kind: lesson.kind,
            makeupFor: lesson.makeupFor,
            movedFrom: lesson.id,
            startsAt,
            endsAt: new Date(startsAt.getTime() + duration * 60_000),
            createdByKind: by,
            createdBy: actor.actorId,
          },
          include: LESSON_INCLUDE,
        }).then(learnerLesson);
        await this.lessons.postCard(
          tx, created, actor, CardKind.LESSON_MOVED,
          { ...this.lessons.cardBase(created), previousStartsAt: lesson.startsAt.toISOString(), movedBy: movedByOf(by) },
          lang,
        );
        await this.audit.audit(tx, {
          actorId: actor.actorId, action: 'lesson.moved', entity: 'lesson', entityId: created.id,
          before: { lessonId: lesson.id, startsAt: lesson.startsAt.toISOString() },
          after: { startsAt: startsAt.toISOString(), movedBy: movedByOf(by) },
          reason: 'lesson moved to another time',
        });
        return created;
      }),
    );
    return this.lessons.get(actorId, moved.id);
  }

  private async moveCheck(actor: Actor, lesson: { id: string; learnerId: string; kind: string; outcome: string | null; startsAt: Date; movedFrom: string | null; createdByKind: string }) {
    const locked = await this.lockOf(lesson.learnerId);
    const family = actor.kind === ActorKind.CONTACT;
    let familyMovesLeft: number | null = null;
    let refusal: MoveRefusal | null = null;
    if (family) {
      const limit = Number(await this.config.get('lesson.family_moves_per_month'));
      familyMovesLeft = Math.max(0, limit - (await this.familyMovesThisMonth(lesson.learnerId)));
    }
    // The family books with the make-up lead; a teacher moves with their own notice (PD-31).
    const lead = family
      ? Number(await this.config.get('lesson.booking_lead_minutes'))
      : actor.kind === ActorKind.TEACHER ? Number(await this.config.get('lesson.teacher_move_lead_minutes')) : 0;
    if (lesson.outcome !== null || (lesson.kind !== LessonKind.REGULAR && lesson.kind !== LessonKind.MAKEUP)) refusal = 'not_movable';
    else if (lesson.startsAt.getTime() <= Date.now()) refusal = 'started';
    else if (lead > 0 && lesson.startsAt.getTime() <= Date.now() + lead * 60_000) refusal = 'too_late';
    else if (family && (await this.familyMovedChain(lesson))) refusal = 'family_already_moved';
    else if (family && familyMovesLeft === 0) refusal = 'family_monthly_limit';
    return { locked, refusal, familyMovesLeft };
  }

  /** Was this lesson -- or one it continues -- already moved by the family? */
  private async familyMovedChain(lesson: { movedFrom: string | null; createdByKind: string }, db: Pick<Tx, 'lesson'> = this.prisma): Promise<boolean> {
    let at: { movedFrom: string | null; createdByKind: string } | null = lesson;
    for (let hops = 0; at && at.movedFrom && hops < 50; hops++) {
      if (at.createdByKind === 'contact') return true;
      at = await db.lesson.findUnique({ where: { id: at.movedFrom }, select: { movedFrom: true, createdByKind: true } });
    }
    return false;
  }

  /** The child's lessons the family moved in this calendar month (stats.zone). */
  private async familyMovesThisMonth(learnerId: string, db: Pick<Tx, '$queryRaw'> = this.prisma): Promise<number> {
    const zone = String(await this.config.get('stats.zone'));
    const rows = await db.$queryRaw<Array<{ n: number }>>`
      SELECT count(*)::int AS n FROM chat.lesson l
       WHERE l.learner_id = ${learnerId}::uuid AND l.moved_from IS NOT NULL AND l.created_by_kind = 'contact'
         AND date_trunc('month', l.created_at AT TIME ZONE ${zone}) = date_trunc('month', now() AT TIME ZONE ${zone})`;
    return rows[0]?.n ?? 0;
  }

  /**
   * The child's teacher's free one-off starts, for staff adding a lesson.
   * The Teachers department, the super admin and the child's supervisor.
   */
  async learnerFreeSlots(actorId: string, learnerId: string, durationMinutes?: string) {
    const actor = await this.conversations.requireActor(actorId);
    if (actor.kind !== ActorKind.STAFF) throw new CommError(CommErrorCode.LESSON_DENIED, 'staff only');
    const { learner, standing } = await this.learnerFor(actor, learnerId, 'read_schedule');
    this.requireAct(actor, standing, 'manage_enrollment');
    const duration = durationMinutes === undefined ? await this.currentDuration(learner.id) : Number(durationMinutes);
    if (!Number.isInteger(duration) || duration < 15 || duration > 240) throw invalid('durationMinutes: 15 to 240');
    const locked = await this.lockOf(learner.id);
    if (!learner.teacherId) return { durationMinutes: duration, timezone: null, slots: [], locked };
    const tz = await this.prisma.teacherAvailability.findFirst({ where: { teacherId: learner.teacherId }, select: { timezone: true } });
    const slots = locked ? [] : await this.freeSlots(learner.teacherId, duration);
    return { durationMinutes: duration, timezone: tz?.timezone ?? null, slots: slots.map((d) => d.toISOString()), locked };
  }

  // ------------------------------------------------------------------
  // PD-31: weekly lessons the teacher's other lessons blocked
  // ------------------------------------------------------------------

  /** Open blocked weekly lessons of the organization, for Needs action. */
  async blockedOccurrences(organizationId: string) {
    const rows = await this.prisma.$queryRaw<Array<{
      id: string; learner_id: string; learner_name: string; teacher_id: string; teacher_name: string;
      starts_at: Date; ends_at: Date; blocker_id: string; blocker_kind: string; blocker_starts: Date; blocker_ends: Date;
      reason: string; lesson_kind: string;
    }>>`
      SELECT b.id::text, b.learner_id::text, l.name AS learner_name, b.teacher_id::text, t.name AS teacher_name,
             b.starts_at, b.ends_at, x.id::text AS blocker_id, x.kind AS blocker_kind,
             x.starts_at AS blocker_starts, x.ends_at AS blocker_ends,
             b.reason, coalesce(st.kind, 'regular') AS lesson_kind
        FROM chat.lesson_blocked_occurrence b
        JOIN chat.learner l ON l.id = b.learner_id
        JOIN chat.teacher t ON t.id = b.teacher_id
        JOIN chat.lesson x ON x.id = b.blocked_by
        LEFT JOIN chat.lesson st ON st.id = b.stranded_lesson
       WHERE b.organization_id = ${organizationId}::uuid AND b.resolution IS NULL AND b.starts_at > now()
       ORDER BY b.starts_at
       LIMIT 500`;
    return rows.map((r) => ({
      id: r.id,
      learner: { id: r.learner_id, name: r.learner_name },
      teacher: { id: r.teacher_id, name: r.teacher_name },
      startsAt: r.starts_at.toISOString(),
      endsAt: r.ends_at.toISOString(),
      blockedBy: { lessonId: r.blocker_id, kind: r.blocker_kind, startsAt: r.blocker_starts.toISOString(), endsAt: r.blocker_ends.toISOString() },
      // weekly: the generator passed it over; teacher_changed: a one-off (a make-up, a
      // moved lesson) the new teacher could not take at its time.
      reason: r.reason as 'weekly' | 'teacher_changed',
      lessonKind: r.lesson_kind,
    }));
  }

  private async openBlocked(actorId: string, id: string) {
    if (!isUuid(id)) throw new CommError(CommErrorCode.LESSON_NOT_FOUND, 'not found');
    const actor = await this.conversations.requireActor(actorId);
    await this.lessons.requireManager(actor);
    const row = await this.prisma.lessonBlockedOccurrence.findUnique({ where: { id } });
    if (!row || row.organizationId !== actor.organizationId) throw new CommError(CommErrorCode.LESSON_NOT_FOUND, 'not found');
    if (row.resolution !== null) throw stateError('this weekly lesson is already resolved');
    return { actor, row };
  }

  async blockedSlots(actorId: string, id: string) {
    const { row } = await this.openBlocked(actorId, id);
    const duration = minutesBetween(row.startsAt, row.endsAt);
    const tz = await this.prisma.teacherAvailability.findFirst({ where: { teacherId: row.teacherId }, select: { timezone: true } });
    const slots = await this.freeSlots(row.teacherId, duration);
    return { durationMinutes: duration, timezone: tz?.timezone ?? null, slots: slots.map((d) => d.toISOString()) };
  }

  /** Give the blocked weekly lesson another time: a one-off lesson, and the entry is resolved. */
  async scheduleBlocked(actorId: string, id: string, body: Record<string, unknown>) {
    const startsAt = dateField(body, 'startsAt');
    const { actor, row } = await this.openBlocked(actorId, id);
    const duration = minutesBetween(row.startsAt, row.endsAt);
    const learner = await this.prisma.learner.findUnique({ where: { id: row.learnerId }, select: { teacherId: true } });
    if (learner?.teacherId !== row.teacherId) throw stateError('the student has another teacher now; dismiss this and book with them');
    await this.assertAgreedTime(row.teacherId, startsAt, 'a lesson');
    // A stranded make-up is booked again as the make-up of the same missed lesson.
    const stranded = row.strandedLesson
      ? await this.prisma.lesson.findUnique({ where: { id: row.strandedLesson }, select: { kind: true, makeupFor: true } })
      : null;
    const lesson = await this.lessons.write(() =>
      this.prisma.$transaction(async (tx) => {
        const created = await tx.lesson.create({
          data: {
            organizationId: row.organizationId,
            learnerId: row.learnerId,
            teacherId: row.teacherId,
            kind: stranded?.kind === LessonKind.MAKEUP ? LessonKind.MAKEUP : LessonKind.REGULAR,
            makeupFor: stranded?.kind === LessonKind.MAKEUP ? stranded.makeupFor : null,
            startsAt,
            endsAt: new Date(startsAt.getTime() + duration * 60_000),
            createdBy: actor.actorId,
          },
        });
        await tx.lessonBlockedOccurrence.update({
          where: { id: row.id },
          data: { resolution: 'scheduled', resolvedBy: actor.actorId, resolvedAt: new Date(), lessonId: created.id },
        });
        await this.audit.audit(tx, {
          actorId: actor.actorId, action: 'lesson.scheduled', entity: 'lesson', entityId: created.id,
          after: { learnerId: row.learnerId, startsAt: startsAt.toISOString(), blockedOccurrence: row.id },
          reason: 'weekly lesson the teacher was busy for, given another time',
        });
        return created;
      }),
    );
    return this.lessons.get(actorId, lesson.id);
  }

  async dismissBlocked(actorId: string, id: string, body: Record<string, unknown>) {
    const note = textField(body, 'note', 1000, false);
    const { actor, row } = await this.openBlocked(actorId, id);
    await this.lessons.write(() =>
      this.prisma.$transaction(async (tx) => {
        await tx.lessonBlockedOccurrence.update({
          where: { id: row.id },
          data: { resolution: 'dismissed', resolvedBy: actor.actorId, resolvedAt: new Date(), note },
        });
        await this.audit.audit(tx, {
          actorId: actor.actorId, action: 'lesson.blocked_dismissed', entity: 'learner', entityId: row.learnerId,
          after: { blockedOccurrence: row.id, startsAt: row.startsAt.toISOString() }, reason: note ?? 'no lesson that week',
        });
      }),
    );
    return { ok: true };
  }

  /** Record the weekly lessons the materializer passed over (PD-31). */
  async collectBlocked(db: Pick<Tx, '$queryRaw'> = this.prisma): Promise<number> {
    const weeks = Number(await this.config.get('lesson.materialize_weeks'));
    const rows = await db.$queryRaw<Array<{ n: number }>>`
      SELECT chat.collect_blocked_occurrences(now(), now() + make_interval(weeks => ${weeks}::int)) AS n`;
    return Number(rows[0]?.n ?? 0);
  }

  // ------------------------------------------------------------------
  // PD-31: Needs action, with every request re-checked now
  // ------------------------------------------------------------------

  /**
   * The schedule requests as an approver needs them: before and after, from
   * when, who asked, and whether every requested time is STILL free -- so an
   * approval that would fail is flagged before anyone presses it -- plus the
   * blocked weekly lessons.
   */
  async enrichNeedsAction<T extends { scheduleRequests: Array<{ id: string }> }>(actorId: string, base: T) {
    const actor = await this.conversations.requireActor(actorId);
    const org = actor.organizationId as string;
    const requests = await this.prisma.scheduleChangeRequest.findMany({
      where: { id: { in: base.scheduleRequests.map((r) => r.id) } },
      orderBy: { createdAt: 'asc' },
    });
    const learners = new Map(
      (await this.prisma.learner.findMany({ where: { id: { in: requests.map((r) => r.learnerId) } }, select: { id: true, name: true, teacherId: true } }))
        .map((l) => [l.id, l]),
    );
    const contacts = new Map(
      (await this.prisma.contact.findMany({ where: { id: { in: requests.filter((r) => r.requestedByKind === 'contact').map((r) => r.requestedBy) } }, select: { id: true, name: true } }))
        .map((c) => [c.id, c.name]),
    );
    const teacherIds = [...new Set([...learners.values()].map((l) => l.teacherId).filter((t): t is string => !!t))];
    const teachers = new Map(
      (await this.prisma.teacher.findMany({ where: { id: { in: [...teacherIds, ...requests.map((r) => r.requestedBy)] } }, select: { id: true, name: true } }))
        .map((t) => [t.id, t.name]),
    );
    const scheduleRequests = [];
    for (const r of requests) {
      const learner = learners.get(r.learnerId);
      const teacherId = learner?.teacherId ?? null;
      const duration = await this.currentDuration(r.learnerId);
      const asked = (r.slots as Array<{ weekday: number; start: string }>).map((x) => ({ weekday: x.weekday, startMinute: minuteField(x.start, 'slots.start') }));
      const current = await this.currentSlots(r.learnerId);
      const tz = teacherId ? (await this.prisma.teacherAvailability.findFirst({ where: { teacherId }, select: { timezone: true } }))?.timezone ?? null : null;
      const next = tz ? await this.nextStarts(tz, asked) : new Map<string, Date>();
      const requested = [];
      for (const a of asked) {
        requested.push({
          weekday: a.weekday,
          start: hhmm(a.startMinute),
          nextStartsAt: next.get(`${a.weekday}:${a.startMinute}`)?.toISOString() ?? null,
          free: teacherId ? await this.isFree(teacherId, r.learnerId, { ...a, durationMinutes: duration }) : false,
        });
      }
      scheduleRequests.push({
        id: r.id,
        learner: { id: r.learnerId, name: learner?.name ?? '' },
        teacher: teacherId ? { id: teacherId, name: teachers.get(teacherId) ?? '' } : null,
        requestedBy: {
          kind: r.requestedByKind === 'teacher' ? 'teacher' : 'family',
          name: (r.requestedByKind === 'teacher' ? teachers.get(r.requestedBy) : contacts.get(r.requestedBy)) ?? '',
        },
        note: r.note,
        createdAt: r.createdAt.toISOString(),
        effectiveFrom: r.effectiveFrom ? r.effectiveFrom.toISOString().slice(0, 10) : null,
        current,
        requested,
        stillFree: requested.every((x) => x.free),
        slots: r.slots,
      });
    }
    const { scheduleRequests: _legacy, ...rest } = base;
    return { ...rest, scheduleRequests, blockedOccurrences: await this.blockedOccurrences(org) };
  }

  // ------------------------------------------------------------------
  // The sweep (the worker)
  // ------------------------------------------------------------------

  /**
   * Materialize lessons from regular times, schedule the reminders now due, and
   * (hourly) the daylight-saving warnings.
   */
  async sweep(): Promise<{ materialized: number; reminded: number; clockWarnings: number | null }> {
    const materialized = await this.materialize();
    // PD-31: a weekly lesson the materializer passed over is recorded, never lost.
    await this.collectBlocked();
    const reminded = await this.scheduleDueReminders();
    let clockWarnings: number | null = null;
    if (Date.now() >= this.nextClockShiftSweepAt) {
      clockWarnings = await this.scheduleClockShiftWarnings();
      this.nextClockShiftSweepAt = Date.now() + CLOCK_SHIFT_SWEEP_MS;
    }
    return { materialized, reminded, clockWarnings };
  }

  async materialize(db: Pick<Tx, '$queryRaw'> = this.prisma): Promise<number> {
    const weeks = Number(await this.config.get('lesson.materialize_weeks'));
    const rows = await db.$queryRaw<Array<{ n: number }>>`
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
      // A trial (PD-11 T4) has no family yet: its teacher is still reminded.
      const parents = lesson.learner
        ? await this.prisma.contact.findMany({
            where: { familyId: lesson.learner.familyId, isActive: true, canMessage: true },
            select: { id: true },
          })
        : [];
      const locale = lesson.learner?.family.language === 'en' ? 'en' : 'ar';
      await this.reminders.scheduleForEvent('lesson_scheduled', {
        subjectId: lesson.id,
        anchorAt: lesson.startsAt,
        recipients: [
          { actorId: lesson.teacherId, role: 'teacher', locale },
          ...parents.map((p) => ({ actorId: p.id, role: 'parent', locale })),
        ],
        familyId: lesson.learner?.familyId ?? null,
        // PD-22: the push says the time, worded in each recipient's own zone at send time.
        variables: { startsAt: lesson.startsAt.toISOString() },
        skipPast: true,
      });
      await this.prisma.lesson.update({ where: { id: lesson.id }, data: { remindersScheduledAt: new Date() } });
    }
    return due.length;
  }

  /**
   * PD-22: the daylight-saving warning. A weekly lesson stays anchored in the
   * teacher's zone, so when that zone changes its clocks and a parent's does not
   * (Egypt and the Gulf), or the parent's changes and the teacher's does not
   * (Cairo and London), the parent's local lesson time moves by an hour. Each
   * parent whose zone is known is told once per slot per change, a few days
   * before the first lesson at the new time (rule lesson_clock_shift_parent,
   * offset from that lesson's start). The text says the day and time in the
   * parent's zone, worked out at send time, and names nobody.
   *
   * A warning that no longer holds when the sweep looks again -- the slot was
   * replaced, the parent moved to a zone where nothing changes, the lesson
   * already started -- is cancelled before it is sent. Returns the warnings that
   * stand, one per (slot, change, parent).
   */
  async scheduleClockShiftWarnings(now: Date = new Date()): Promise<number> {
    const slots = await this.prisma.learnerScheduleSlot.findMany({
      where: { OR: [{ validTo: null }, { validTo: { gt: now } }] },
      select: { id: true, learnerId: true, weekday: true, startMinute: true, timezone: true, validFrom: true, validTo: true },
    });
    const learners = await this.prisma.learner.findMany({
      where: { id: { in: [...new Set(slots.map((x) => x.learnerId))] } },
      select: { id: true, familyId: true, family: { select: { language: true } } },
    });
    const learnerOf = new Map(learners.map((l) => [l.id, l]));
    const parents = await this.prisma.contact.findMany({
      where: { familyId: { in: [...new Set(learners.map((l) => l.familyId))] }, isActive: true, canMessage: true },
      select: { id: true, familyId: true },
    });
    const zones = await zonesOf(this.prisma, parents.map((p) => p.id));

    // `:subject:recipient`, the part of each dedupe key every rule shares (ReminderService.dedupeKey).
    const wanted = new Set<string>();
    for (const slot of slots) {
      const learner = learnerOf.get(slot.learnerId);
      if (!learner) continue;
      const from = slot.validFrom.toISOString().slice(0, 10);
      const to = slot.validTo ? slot.validTo.toISOString().slice(0, 10) : null;
      // Only starts the slot really has: a family never had the old time if the
      // slot began after it, and gets no new time if it ends before.
      const starts = weeklyStartsAround(slot.weekday, slot.startMinute, slot.timezone, now).filter((at) => {
        const d = localDate(at, slot.timezone);
        return d >= from && (to === null || d < to);
      });
      const changes = new Map<string, { at: Date; parentIds: string[] }>();
      for (const parent of parents) {
        if (parent.familyId !== learner.familyId) continue;
        const zone = zones.get(parent.id);
        // No zone: their reminders say Cairo time, named, so nothing moves for them.
        if (!zone) continue;
        for (const at of readerClockShifts(starts, zone)) {
          if (at.getTime() <= now.getTime()) continue;
          const change = localDate(at, slot.timezone);
          const entry = changes.get(change) ?? { at, parentIds: [] };
          entry.parentIds.push(parent.id);
          changes.set(change, entry);
        }
      }
      const locale = learner.family.language === 'en' ? 'en' : 'ar';
      for (const [change, { at, parentIds }] of changes) {
        const subjectId = `${slot.id}:${change}`;
        await this.reminders.scheduleForEvent(CLOCK_SHIFT_EVENT, {
          subjectId,
          anchorAt: at,
          recipients: parentIds.map((actorId) => ({ actorId, role: 'parent', locale })),
          familyId: learner.familyId,
          variables: { startsAt: at.toISOString() },
        });
        for (const id of parentIds) wanted.add(`:${subjectId}:${id}`);
      }
    }

    // The dedupe key is unique, so a warning cancelled here could never be
    // scheduled again. One that holds again (the parent flew to Cairo and back)
    // is revived instead; only cancellations made here, never another reason's.
    const unsent = await this.prisma.notification.findMany({
      where: {
        eventType: CLOCK_SHIFT_EVENT,
        OR: [
          { status: NotificationStatus.SCHEDULED },
          { status: NotificationStatus.CANCELLED, failureCode: CLOCK_SHIFT_GONE },
        ],
      },
      select: { id: true, dedupeKey: true, status: true },
    });
    const holds = (n: { dedupeKey: string }) => wanted.has(n.dedupeKey.slice(n.dedupeKey.indexOf(':')));
    const stale = unsent.filter((n) => n.status === NotificationStatus.SCHEDULED && !holds(n)).map((n) => n.id);
    const revived = unsent.filter((n) => n.status === NotificationStatus.CANCELLED && holds(n)).map((n) => n.id);
    if (stale.length > 0) {
      await this.prisma.notification.updateMany({
        where: { id: { in: stale }, status: NotificationStatus.SCHEDULED },
        data: { status: NotificationStatus.CANCELLED, failureCode: CLOCK_SHIFT_GONE },
      });
    }
    if (revived.length > 0) {
      await this.prisma.notification.updateMany({
        where: { id: { in: revived }, status: NotificationStatus.CANCELLED, failureCode: CLOCK_SHIFT_GONE },
        data: { status: NotificationStatus.SCHEDULED, failureCode: null },
      });
    }
    return wanted.size;
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
  async applySchedule(
    actor: Actor,
    learner: Learner,
    slots: WeeklySlot[],
    effectiveFrom: string | null,
    then: ((tx: Tx) => Promise<void>) | null,
  ) {
    if (!learner.teacherId) throw stateError('this learner has no teacher yet');
    const teacherId = learner.teacherId;
    const timezone = await this.teacherZone(teacherId);
    await this.assertFree(teacherId, learner.id, slots);
    const today = await this.teacherToday(teacherId);
    const from = effectiveFrom ?? today;
    if (from < today) throw invalid('effectiveFrom: today or later');

    await this.lessons.write(() =>
      this.prisma.$transaction(async (tx) => {
        await this.applyScheduleTx(tx, actor, learner, teacherId, timezone, slots, from, []);
        if (then) await then(tx);
      }),
    );
    // The change is committed; the worker's sweep creates the lessons if this does not.
    await this.materialize().catch((e: unknown) => this.log.error(`materialize after a schedule change: ${String(e)}`));
  }

  /**
   * The body of applySchedule, in the caller's transaction (PD-31: a change of
   * teacher sets the new times in the SAME transaction as the move). Also
   * reschedules the open future lessons of `endedSlotIds` -- slots the caller
   * already ended (chat.transfer_learner ends them) -- so the materializer
   * creates them again at the new times and nothing is doubled.
   */
  async applyScheduleTx(
    tx: Tx,
    actor: Actor,
    learner: { id: string; organizationId: string },
    teacherId: string,
    timezone: string,
    slots: WeeklySlot[],
    from: string,
    endedSlotIds: string[],
  ) {
    await this.assertFree(teacherId, learner.id, slots, tx);
    const ended = await tx.$queryRaw<Array<{ id: string }>>`
      UPDATE chat.learner_schedule_slot
         SET valid_to = greatest(valid_from, ${from}::date)
       WHERE learner_id = ${learner.id}::uuid AND valid_to IS NULL
      RETURNING id::text AS id`;
    const slotIds = [...ended.map((e) => e.id), ...endedSlotIds];
    if (slotIds.length > 0) {
      const moved = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT l.id::text AS id FROM chat.lesson l
         WHERE l.schedule_slot_id = ANY(${slotIds}::uuid[])
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
      after: { effectiveFrom: from, teacherId, slots: slots.map((s) => ({ weekday: s.weekday, start: hhmm(s.startMinute), durationMinutes: s.durationMinutes })) },
      reason: 'regular lesson times replaced',
    });
  }

  /** Every wanted weekly time must be free for the teacher (this learner's own current times excepted). */
  async assertFree(teacherId: string, learnerId: string, slots: WeeklySlot[], db: Pick<Prisma.TransactionClient, '$queryRaw'> = this.prisma) {
    for (const a of slots) {
      for (const b of slots) {
        if (a !== b && a.weekday === b.weekday && a.startMinute < b.startMinute + b.durationMinutes && b.startMinute < a.startMinute + a.durationMinutes) {
          throw invalid('slots: two times overlap on the same day');
        }
      }
    }
    for (const s of slots) {
      if (!(await this.isFree(teacherId, learnerId, s, db))) {
        throw stateError(`${weekdayName(s.weekday)} ${hhmm(s.startMinute)} is not a free time for this teacher`);
      }
    }
  }

  /** One weekly time is free for the teacher (this learner's own times excepted). */
  async isFree(teacherId: string, learnerId: string, s: WeeklySlot, db: Pick<Prisma.TransactionClient, '$queryRaw'> = this.prisma): Promise<boolean> {
    const rows = await db.$queryRaw<Array<{ ok: boolean }>>`
      SELECT EXISTS (
        SELECT 1 FROM chat.teacher_free_weekly_slots(${teacherId}::uuid, ${s.durationMinutes}::int, 5, ${learnerId}::uuid) f
         WHERE f.weekday = ${s.weekday} AND f.start_minute = ${s.startMinute}
      ) AS ok`;
    return rows[0]?.ok === true;
  }

  /** The teacher's availability zone; a weekly time is meaningless without it. */
  async teacherZone(teacherId: string): Promise<string> {
    const tzRow = await this.prisma.teacherAvailability.findFirst({ where: { teacherId }, select: { timezone: true } });
    if (!tzRow) throw stateError('set the teacher\'s availability first');
    return tzRow.timezone;
  }

  /** Today's date in the teacher's zone (the academy's when they have none). */
  async teacherToday(teacherId: string): Promise<string> {
    const rows = await this.prisma.$queryRaw<Array<{ d: string }>>`
      SELECT to_char((now() AT TIME ZONE coalesce(
               (SELECT a.timezone FROM chat.teacher_availability a WHERE a.teacher_id = ${teacherId}::uuid LIMIT 1),
               'Africa/Cairo'))::date, 'YYYY-MM-DD') AS d`;
    return rows[0].d;
  }

  /**
   * PD-30's payment lock for a child, or null when the child's lessons may be
   * booked and moved (grace and an active exception included, and always
   * while SUBSCRIPTION_LOCK_ENFORCED is off). PD-30 owns the state and answers
   * through SubscriptionLockReader (chat.learner_lesson_lock, computed now,
   * fail closed): ANY non-null answer locks -- 'balance' and 'overdue' by
   * name, anything else as 'other'. Every PD-31 picker and write asks this ONE
   * method.
   */
  async lockOf(learnerId: string): Promise<'balance' | 'overdue' | 'other' | null> {
    if (!this.locks.enforced) return null;
    const lock: string | null = await this.locks.lockOf(learnerId);
    if (lock === null) return null;
    return lock === 'balance' || lock === 'overdue' ? lock : 'other';
  }

  /**
   * A weekly time kept across zones (PD-31 change of teacher): the same
   * INSTANTS, expressed on the new teacher's wall clock -- PD-22 anchors a
   * weekly lesson in its teacher's zone. Null when the instants do not stay one
   * weekly time over the coming year, i.e. one of the two zones changes its
   * clocks and the other does not; the time cannot then be kept exactly.
   */
  async convertWeekly(s: WeeklySlot, fromZone: string, toZone: string): Promise<WeeklySlot | null> {
    if (fromZone === toZone) return s;
    const rows = await this.prisma.$queryRaw<Array<{ weekday: number; minute: number }>>`
      WITH first AS (
        SELECT d + ((${s.weekday}::int - extract(isodow FROM d)::int + 7) % 7) AS f
          FROM (SELECT (now() AT TIME ZONE ${fromZone})::date AS d) t
      ), occ AS (
        SELECT (((f + 7 * k) + make_interval(mins => ${s.startMinute}::int)) AT TIME ZONE ${fromZone}) AT TIME ZONE ${toZone} AS local
          FROM first CROSS JOIN generate_series(0, 52) k
      )
      SELECT DISTINCT extract(isodow FROM local)::int AS weekday,
             (extract(hour FROM local) * 60 + extract(minute FROM local))::int AS minute
        FROM occ`;
    if (rows.length !== 1) return null;
    return { weekday: rows[0].weekday, startMinute: rows[0].minute, durationMinutes: s.durationMinutes };
  }

  /** The learner's current weekly times, each with its next real start. */
  async currentSlots(learnerId: string) {
    const slots = await this.prisma.learnerScheduleSlot.findMany({
      where: { learnerId, validTo: null },
      orderBy: [{ weekday: 'asc' }, { startMinute: 'asc' }],
    });
    const next = await this.slotNextStarts(slots.map((x) => x.id));
    return slots.map((s) => ({
      weekday: s.weekday,
      start: hhmm(s.startMinute),
      durationMinutes: s.durationMinutes,
      nextStartsAt: next.get(s.id)?.toISOString() ?? null,
    }));
  }

  /**
   * When each of a learner's weekly slots next REALLY happens, keyed by slot
   * id: its first coming occurrence (within 12 weeks) whose lesson was not
   * closed early -- moved away, cancelled, paused, voided, excused -- that is
   * not one of the teacher's days off or inside the learner's pause, and that
   * the slot still covers. A lesson moved to another time is a lesson of its
   * own (`moved_from`), never this slot's next start.
   */
  async slotNextStarts(slotIds: string[]): Promise<Map<string, Date>> {
    if (slotIds.length === 0) return new Map();
    const rows = await this.prisma.$queryRaw<Array<{ id: string; next_at: Date | null }>>`
      SELECT s.id::text AS id, min(o.at) AS next_at
        FROM chat.learner_schedule_slot s
        CROSS JOIN LATERAL (
          SELECT ((d::date + make_interval(mins => s.start_minute)) AT TIME ZONE s.timezone) AS at, d::date AS day
            FROM generate_series((now() AT TIME ZONE s.timezone)::date,
                                 (now() AT TIME ZONE s.timezone)::date + 84,
                                 interval '1 day') d
           WHERE extract(isodow FROM d) = s.weekday
             AND d::date >= s.valid_from
             AND (s.valid_to IS NULL OR d::date < s.valid_to)
        ) o
       WHERE s.id = ANY(${slotIds}::uuid[])
         AND o.at > now()
         AND NOT EXISTS (SELECT 1 FROM chat.lesson l
                          WHERE l.schedule_slot_id = s.id AND l.starts_at = o.at AND l.outcome IS NOT NULL)
         AND NOT EXISTS (SELECT 1 FROM chat.teacher_day_off off WHERE off.teacher_id = s.teacher_id AND off.day = o.day)
         AND NOT chat.learner_suspended_on(s.learner_id, o.day)
       GROUP BY s.id`;
    return new Map(rows.filter((r) => r.next_at !== null).map((r) => [r.id, r.next_at as Date]));
  }

  /** The next instant each weekly time (wall clock in `timezone`) falls on, keyed `weekday:startMinute`. */
  async nextStarts(timezone: string, slots: Array<{ weekday: number; startMinute: number }>): Promise<Map<string, Date>> {
    if (slots.length === 0) return new Map();
    const rows = await this.prisma.$queryRaw<Array<{ weekday: number; start_minute: number; next_at: Date }>>`
      WITH s AS (
        SELECT u.weekday, u.start_minute, (now() AT TIME ZONE ${timezone})::date AS today
          FROM unnest(${slots.map((x) => x.weekday)}::int[], ${slots.map((x) => x.startMinute)}::int[]) AS u(weekday, start_minute)
      )
      SELECT s.weekday, s.start_minute,
             (SELECT min(x) FROM (VALUES
                (((s.today + ((s.weekday - extract(isodow FROM s.today)::int + 7) % 7)) + make_interval(mins => s.start_minute)) AT TIME ZONE ${timezone}),
                (((s.today + ((s.weekday - extract(isodow FROM s.today)::int + 7) % 7) + 7) + make_interval(mins => s.start_minute)) AT TIME ZONE ${timezone})
              ) v(x) WHERE x > now()) AS next_at
        FROM s`;
    return new Map(rows.map((r) => [`${r.weekday}:${r.start_minute}`, r.next_at]));
  }

  /**
   * For each free weekly time, the starts in the materializing window that
   * another lesson of the teacher (a make-up, a trial, a one-off) already
   * holds: those weeks would be skipped. This learner's own lessons are not
   * obstacles -- they move with the change.
   */
  private async weeklyExceptions(teacherId: string, duration: number, step: number, learnerId: string): Promise<Map<string, Date[]>> {
    const weeks = Number(await this.config.get('lesson.materialize_weeks'));
    const rows = await this.prisma.$queryRaw<Array<{ weekday: number; start_minute: number; at: Date }>>`
      WITH f AS (
        SELECT * FROM chat.teacher_free_weekly_slots(${teacherId}::uuid, ${duration}::int, ${step}::int, ${learnerId}::uuid)
      ), occ AS (
        SELECT f.weekday::int AS weekday, f.start_minute,
               ((d::date + make_interval(mins => f.start_minute)) AT TIME ZONE f.timezone) AS at
          FROM f
          CROSS JOIN LATERAL generate_series((now() AT TIME ZONE f.timezone)::date,
                                             (now() AT TIME ZONE f.timezone)::date + 7 * ${weeks}::int,
                                             interval '1 day') d
         WHERE extract(isodow FROM d) = f.weekday
      )
      SELECT o.weekday, o.start_minute, o.at FROM occ o
       WHERE o.at > now()
         AND EXISTS (
           SELECT 1 FROM chat.lesson x
            WHERE x.teacher_id = ${teacherId}::uuid
              AND x.learner_id IS DISTINCT FROM ${learnerId}::uuid
              AND (x.outcome IS NULL OR x.outcome IN ('held', 'student_no_show', 'teacher_no_show'))
              AND tstzrange(x.starts_at, x.ends_at) && tstzrange(o.at, o.at + make_interval(mins => ${duration}::int)))
       ORDER BY o.at`;
    const out = new Map<string, Date[]>();
    for (const r of rows) {
      const k = `${r.weekday}:${r.start_minute}`;
      out.set(k, [...(out.get(k) ?? []), r.at]);
    }
    return out;
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

  /** Free start times for one lesson of `duration` (shared with TrialService). */
  /** `db` lets a caller ask inside its own transaction (a trial being moved frees its old time first). */
  async freeSlots(teacherId: string, duration: number, db: Pick<Prisma.TransactionClient, '$queryRaw'> = this.prisma): Promise<Date[]> {
    const lead = Number(await this.config.get('lesson.booking_lead_minutes'));
    const horizon = Number(await this.config.get('lesson.makeup_horizon_days'));
    const step = Number(await this.config.get('lesson.slot_step_minutes'));
    const rows = await db.$queryRaw<Array<{ starts_at: Date }>>`
      SELECT starts_at FROM chat.teacher_free_slots(
        ${teacherId}::uuid,
        now() + make_interval(mins => ${lead}::int),
        now() + make_interval(days => ${horizon}::int),
        ${duration}::int,
        ${step}::int)`;
    return rows.map((r) => r.starts_at);
  }

  /**
   * A make-up time agreed outside the free-slot list (PD-15): in the future,
   * within the booking horizon, and not on one of the teacher's days off (in
   * the teacher's own zone). Overlaps are the database's to refuse.
   */
  private async assertAgreedTime(teacherId: string, startsAt: Date, what = 'a make-up') {
    const horizon = Number(await this.config.get('lesson.makeup_horizon_days'));
    const rows = await this.prisma.$queryRaw<Array<{ future: boolean; within: boolean; day_off: boolean }>>`
      SELECT ${startsAt}::timestamptz > now() AS future,
             ${startsAt}::timestamptz <= now() + make_interval(days => ${horizon}::int) AS within,
             EXISTS (
               SELECT 1 FROM chat.teacher_day_off o
                WHERE o.teacher_id = ${teacherId}::uuid
                  AND o.day = (${startsAt}::timestamptz AT TIME ZONE coalesce(
                        (SELECT a.timezone FROM chat.teacher_availability a WHERE a.teacher_id = ${teacherId}::uuid LIMIT 1),
                        (SELECT c.value #>> '{}' FROM chat.config c WHERE c.key = 'schedule.timezone'),
                        'Africa/Cairo'))::date
             ) AS day_off`;
    const r = rows[0];
    if (!r.future) throw stateError(`${what} is scheduled in the future`);
    if (!r.within) throw stateError(`${what} is scheduled within ${horizon} days`);
    if (r.day_off) throw stateError('that is one of the teacher\'s days off; agree on another day');
  }

  private async assertOwed(
    lesson: { id: string; organizationId: string; learnerId: string },
    causes: readonly string[] = TEACHER_MAKEUP_CAUSES,
  ) {
    const owed = await this.lessons.owedMakeups(lesson.organizationId, { learnerIds: [lesson.learnerId], causes });
    if (!owed.some((l) => l.id === lesson.id)) {
      throw stateError('this lesson does not owe a make-up (it was given, or already replaced or resolved)');
    }
  }

  /** The length of the learner's regular lessons (the first current slot), or 30 minutes. */
  async currentDuration(learnerId: string): Promise<number> {
    const slot = await this.prisma.learnerScheduleSlot.findFirst({
      where: { learnerId, validTo: null },
      orderBy: { createdAt: 'asc' },
      select: { durationMinutes: true },
    });
    return slot?.durationMinutes ?? 30;
  }

  /** How the actor stands to a learner -- the same standing a lesson of theirs would give. */
  async learnerFor(actor: Actor, learnerId: string, act: LessonAct): Promise<{ learner: Learner; standing: LessonStanding }> {
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

  requireAct(actor: Actor, standing: LessonStanding, act: LessonAct) {
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

export function hhmm(minute: number): string {
  return `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`;
}

export function minuteField(v: unknown, key: string): number {
  if (typeof v !== 'string') throw invalid(`${key}: a time as HH:MM`);
  const m = HHMM_RE.exec(v);
  if (!m) throw invalid(`${key}: a time as HH:MM`);
  return Number(m[1]) * 60 + Number(m[2]);
}

function weekdayField(v: unknown, key: string): number {
  if (typeof v !== 'number' || !Number.isInteger(v) || v < 1 || v > 7) throw invalid(`${key}: 1 (Monday) to 7 (Sunday)`);
  return v;
}

export function dateOnlyField(v: unknown, key: string): string {
  if (typeof v !== 'string' || !DATE_RE.test(v) || Number.isNaN(Date.parse(`${v}T00:00:00Z`))) {
    throw invalid(`${key}: a date as YYYY-MM-DD`);
  }
  return v;
}

/** `[{ weekday, start: 'HH:MM', durationMinutes? }]`; a duration is required only when `withDuration`. */
export function slotsField(v: unknown, withDuration: boolean): WeeklySlot[] {
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
