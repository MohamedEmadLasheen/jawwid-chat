import { Injectable } from '@nestjs/common';
import { PrismaService } from '../platform/prisma.service';
import { AppConfigService } from '../platform/app-config.service';
import { CommError, CommErrorCode } from '../platform/errors';
import type { Actor } from '../platform/types';
import { ActorKind, LessonOutcome, StaffRole } from '../communication/contracts/vocab';
import { ConversationService, isUuid } from '../communication/conversations/conversation.service';
import { LessonService, MAKEUP_CAUSES, invalid } from './lesson.service';
import { SchedulingService } from './scheduling.service';

/** Every category chat.lesson_category can answer, in the order a dashboard shows them. */
export const STAT_CATEGORIES = [
  'held',
  'upcoming',
  'unreported',
  'student_apology',
  'teacher_apology',
  'student_no_show',
  'teacher_no_show',
  'admin_cancelled',
  'rescheduled',
  'suspended',
] as const;
export type StatCategory = (typeof STAT_CATEGORIES)[number];

/** Counted for or against someone. `rescheduled` / `suspended` are information only. */
const COUNTED: ReadonlySet<string> = new Set([
  'held', 'student_apology', 'teacher_apology', 'student_no_show', 'teacher_no_show', 'admin_cancelled',
]);
const CLOSED_NOT_HELD = ['student_apology', 'teacher_apology', 'student_no_show', 'teacher_no_show', 'admin_cancelled'];

type Row = { teacher_id: string; category: string; kind: string; duration_minutes: number; lessons: number; minutes: number };
type Bucket = { lessons: number; minutes: number };

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

/**
 * PD-9 / PD-11 T5: teacher statistics, the teacher's own workload, and a
 * child's progress for the family.
 *
 * Every number is read from the SQL functions of 20261019100000 -- one
 * definition per number, no stored counter -- and this service only shapes
 * them. A month is a calendar month in the academy's zone (`stats.zone`).
 *
 * Access follows PD-10: the whole organization's statistics are the Teachers
 * department's and the super admin's; a teacher sees their own; a family sees
 * its own child's progress and nothing about the teacher.
 */
@Injectable()
export class StatsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly conversations: ConversationService,
    private readonly lessons: LessonService,
    private readonly scheduling: SchedulingService,
    private readonly config: AppConfigService,
  ) {}

  /** What the Admin Web may offer this staff member. Advisory -- every route decides again. */
  async access(actorId: string) {
    const actor = await this.conversations.requireActor(actorId);
    const staff = actor.kind === ActorKind.STAFF && actor.isActive && !!actor.organizationId;
    const superAdmin = staff && actor.staffRole === StaffRole.SUPER_ADMIN;
    return {
      lessonManager: await this.isStatsReader(actor),
      sales: staff && (superAdmin || (await this.lessons.inDepartment(actor, 'sales'))),
      operations: staff && (superAdmin || (await this.lessons.inDepartment(actor, 'operations'))),
    };
  }

  /** Every teacher of the organization, one row each, for the month. */
  async teachers(actorId: string, month?: string) {
    const actor = await this.conversations.requireActor(actorId);
    await this.requireStatsReader(actor);
    const period = await this.period(month);
    const org = actor.organizationId as string;
    // PD-35: the teachers in the caller's scope (every one, with the switch off).
    const scope = await this.lessons.teacherScope.scopeOf(actor);
    const [teachers, rows, reports, trials, timings, moves] = await Promise.all([
      this.prisma.teacher.findMany({
        where: { organizationId: org, ...(scope.all ? {} : { id: { in: [...scope.teacherIds] } }) },
        select: { id: true, name: true, isActive: true },
        orderBy: { name: 'asc' },
      }),
      this.lessonRows(org, period),
      this.reportRows(org, period),
      this.trialRows(org, period),
      this.timingRows(org, period),
      this.teacherMoves(org, period),
    ]);
    const byTeacher = groupBy(rows, (r) => r.teacher_id);
    const reportsOf = new Map(reports.map((r) => [r.teacher_id, r]));
    const trialsOf = new Map(trials.map((r) => [r.teacher_id, r]));
    const timingsOf = groupBy(timings, (r) => r.teacher_id);
    return {
      month: period.month,
      zone: period.zone,
      teachers: teachers.map((t) => {
        const mine = (byTeacher.get(t.id) ?? []).filter((r) => r.kind !== 'trial');
        const total = (c: string) => sum(mine.filter((r) => r.category === c));
        const counted = sum(mine.filter((r) => COUNTED.has(r.category)));
        const held = total('held');
        const r = reportsOf.get(t.id);
        return {
          teacher: { id: t.id, name: t.name, isActive: t.isActive },
          held,
          scheduled: counted,
          notHeld: sum(mine.filter((x) => CLOSED_NOT_HELD.includes(x.category))),
          unreported: total('unreported'),
          upcoming: total('upcoming'),
          attendanceRate: rate(held.lessons, held.lessons + total('student_no_show').lessons),
          reportsOnTimeRate: r ? rate(r.on_time, r.reports) : null,
          trials: trialBlock(trialsOf.get(t.id)),
          movesByTeacher: moves.get(t.id) ?? 0,
          summary: monthSummary(mine, timingsOf.get(t.id) ?? []),
        };
      }),
    };
  }

  /** One teacher, the month in full -- the screenshot's dashboard and more. */
  async teacher(actorId: string, teacherId: string, month?: string) {
    const actor = await this.conversations.requireActor(actorId);
    await this.requireStatsReader(actor);
    if (!isUuid(teacherId) || !(await this.lessons.teacherScope.covers(actor, teacherId))) {
      throw new CommError(CommErrorCode.LESSON_NOT_FOUND, 'teacher not found');
    }
    return this.detail(actor.organizationId as string, teacherId, month, true);
  }

  /** A teacher's own workload (PD-10: their schedule and workload, nothing else of the Teacher File). */
  async mine(actorId: string, month?: string) {
    const actor = await this.conversations.requireActor(actorId);
    if (actor.kind !== ActorKind.TEACHER || !actor.isActive || !actor.organizationId) {
      throw new CommError(CommErrorCode.LESSON_DENIED, 'this is a teacher\'s own workload');
    }
    return this.detail(actor.organizationId, actor.actorId, month, false);
  }

  /**
   * A child's progress for the family (PD-10's per-child page): this month's
   * attended / apologised / absent lessons, lessons the teacher did not give and
   * make-ups owed, the attendance streak, the next lesson and the latest report.
   * Nothing about the teacher's performance.
   */
  async progress(actorId: string, learnerId: string, month?: string) {
    const actor = await this.conversations.requireActor(actorId);
    const { learner } = await this.scheduling.learnerFor(actor, learnerId, 'read_schedule');
    const period = await this.period(month);
    // A voided lesson (PD-15: its report deleted, not resent) is in no number.
    const lessons = (await this.prisma.lesson.findMany({
      where: { learnerId: learner.id },
      include: { report: true },
      orderBy: { startsAt: 'desc' },
      take: 500,
    })).filter((l) => l.outcome !== LessonOutcome.VOIDED);
    const now = Date.now();
    const inMonth = lessons.filter((l) => l.startsAt >= period.from && l.startsAt < period.to);
    const count = (outcomes: string[], set = inMonth) => set.filter((l) => l.outcome && outcomes.includes(l.outcome)).length;
    // A streak is lessons attended in a row, newest first: an absence or an
    // apology ends it; what the teacher or Jawwid cancelled, moved or paused
    // neither adds to it nor breaks it.
    let streak = 0;
    for (const l of lessons) {
      if (l.outcome === LessonOutcome.HELD) streak += 1;
      else if (l.outcome === LessonOutcome.STUDENT_NO_SHOW || l.outcome === LessonOutcome.STUDENT_APOLOGY) break;
    }
    const owed = await this.lessons.owedMakeups(learner.organizationId, { learnerIds: [learner.id], causes: MAKEUP_CAUSES });
    const next = [...lessons].reverse().find((l) => l.outcome === null && l.startsAt.getTime() > now) ?? null;
    const lastReport = lessons.find((l) => l.outcome === LessonOutcome.HELD && l.report !== null && l.report.deletedAt === null) ?? null;
    // PD-12: the learner's issued student certificates. The file itself is the
    // attachment of the card in `conversationId`, signed per reader there.
    const certificates = await this.prisma.learnerCertificate.findMany({
      where: { learnerId: learner.id, state: 'issued' },
      orderBy: { achievedOn: 'desc' },
      select: { id: true, title: true, achievement: true, achievedOn: true, grade: true, decidedAt: true, conversationId: true, issuedMessageId: true },
      take: 50,
    });
    return {
      learner: { id: learner.id, name: learner.name },
      month: period.month,
      thisMonth: {
        attended: count([LessonOutcome.HELD]),
        apologised: count([LessonOutcome.STUDENT_APOLOGY]),
        absent: count([LessonOutcome.STUDENT_NO_SHOW]),
        notGivenByTeacher: count([LessonOutcome.TEACHER_APOLOGY, LessonOutcome.TEACHER_NO_SHOW]),
        cancelled: count([LessonOutcome.ADMIN_CANCELLED]),
      },
      allTime: { attended: count([LessonOutcome.HELD], lessons) },
      streak,
      makeupsOwed: owed.length,
      nextLesson: next ? { id: next.id, startsAt: next.startsAt.toISOString(), endsAt: next.endsAt.toISOString() } : null,
      lastReport: lastReport?.report
        ? {
            lessonId: lastReport.id,
            startsAt: lastReport.startsAt.toISOString(),
            lessonNumber: lastReport.report.lessonNumber,
            coveredTopics: lastReport.report.coveredTopics,
            covered: lastReport.report.covered,
            nextTasks: lastReport.report.nextTasks,
            homework: lastReport.report.homework,
            rating: lastReport.report.rating,
          }
        : null,
      certificates: certificates.map((c) => ({
        id: c.id,
        title: c.title,
        achievement: c.achievement,
        achievedOn: c.achievedOn.toISOString().slice(0, 10),
        grade: c.grade,
        issuedAt: c.decidedAt?.toISOString() ?? null,
        conversationId: c.conversationId,
        messageId: c.issuedMessageId,
      })),
    };
  }

  // ------------------------------------------------------------------
  // Internals
  // ------------------------------------------------------------------

  private async detail(org: string, teacherId: string, month: string | undefined, forManager: boolean) {
    const teacher = await this.prisma.teacher.findFirst({ where: { id: teacherId, organizationId: org }, select: { id: true, name: true } });
    if (!teacher) throw new CommError(CommErrorCode.LESSON_NOT_FOUND, 'teacher not found');
    const period = await this.period(month);
    const previous = await this.period(shiftMonth(period.month, -1));
    const [allRows, prevRows, reports, replies, trials, timings] = await Promise.all([
      this.lessonRows(org, period, teacherId),
      this.lessonRows(org, previous, teacherId),
      this.reportRows(org, period, teacherId),
      this.replyRows(org, period, teacherId),
      this.trialRows(org, period, teacherId),
      this.timingRows(org, period, teacherId),
    ]);
    // A trial is not a student's lesson: it has its own block below, and only
    // its time joins the workload.
    const rows = allRows.filter((r) => r.kind !== 'trial');
    const categories = STAT_CATEGORIES.map((key) => {
      const mine = rows.filter((r) => r.category === key);
      const byDuration = new Map<number, Bucket>();
      for (const r of mine) {
        const b = byDuration.get(r.duration_minutes) ?? { lessons: 0, minutes: 0 };
        b.lessons += r.lessons;
        b.minutes += r.minutes;
        byDuration.set(r.duration_minutes, b);
      }
      return {
        key,
        counted: COUNTED.has(key),
        ...sum(mine),
        byDuration: [...byDuration.entries()].sort((a, b) => a[0] - b[0]).map(([durationMinutes, b]) => ({ durationMinutes, ...b })),
      };
    });
    const total = (key: string) => categories.find((c) => c.key === key) as { lessons: number; minutes: number };
    const held = total('held');
    const counted = sum(rows.filter((r) => COUNTED.has(r.category)));
    const closedCounted = counted.lessons;
    const teacherCaused = total('teacher_apology').lessons + total('teacher_no_show').lessons;
    const available = await this.availableMinutes(teacherId, period);
    const scheduledMinutes = sum(allRows.filter((r) => r.category !== 'rescheduled' && r.category !== 'suspended')).minutes;
    const report = reports[0];
    const reply = replies[0];
    const makeups = sum(rows.filter((r) => r.kind === 'makeup' && COUNTED.has(r.category)));
    const makeupsHeld = sum(rows.filter((r) => r.kind === 'makeup' && r.category === 'held'));

    return {
      teacher,
      month: period.month,
      zone: period.zone,
      categories,
      // PD-15: the month as the Teachers department reads it (monthSummary).
      summary: monthSummary(rows, timings),
      totals: { counted, scheduledMinutes },
      makeups: { lessons: makeups.lessons, held: makeupsHeld.lessons },
      // Each trial once, by its one outcome, from Chat's records (chat.teacher_trial_stats).
      trials: trialBlock(trials[0]),
      // PD-31: lessons the teacher moved to another time this month. A figure to
      // read, never a violation.
      movesByTeacher: (await this.teacherMoves(org, period, teacherId)).get(teacherId) ?? 0,
      rates: {
        attendance: rate(held.lessons, held.lessons + total('student_no_show').lessons),
        // Of the lessons closed and counted, how many took place.
        completion: rate(held.lessons, closedCounted),
        teacherReliability: closedCounted > 0 ? rate(closedCounted - teacherCaused, closedCounted) : null,
      },
      reports: report
        ? { reports: report.reports, onTime: report.on_time, onTimeRate: rate(report.on_time, report.reports), medianDelayMinutes: report.median_delay_minutes }
        : { reports: 0, onTime: 0, onTimeRate: null, medianDelayMinutes: null },
      replies: reply
        ? { familyMessages: reply.family_messages, answeredWithin: reply.answered_within, rate: rate(reply.answered_within, reply.family_messages), medianReplyMinutes: reply.median_reply_minutes }
        : { familyMessages: 0, answeredWithin: 0, rate: null, medianReplyMinutes: null },
      workload: available === null
        ? { availableMinutes: null, scheduledMinutes, freeMinutes: null }
        : { availableMinutes: available, scheduledMinutes, freeMinutes: Math.max(0, available - scheduledMinutes) },
      ...(forManager ? { movements: await this.movements(org, teacherId, period) } : {}),
      previous: { month: previous.month, held: sum(prevRows.filter((r) => r.category === 'held' && r.kind !== 'trial')) },
    };
  }

  /** PD-31: lessons each teacher moved this month (the new row's author is the teacher). */
  private async teacherMoves(org: string, p: Period, teacherId?: string): Promise<Map<string, number>> {
    const rows = await this.prisma.$queryRaw<Array<{ teacher_id: string; n: number }>>`
      SELECT l.teacher_id::text AS teacher_id, count(*)::int AS n FROM chat.lesson l
       WHERE l.organization_id = ${org}::uuid AND l.moved_from IS NOT NULL AND l.created_by_kind = 'teacher'
         AND l.created_at >= ${p.from}::timestamptz AND l.created_at < ${p.to}::timestamptz
         AND (${teacherId ?? null}::uuid IS NULL OR l.teacher_id = ${teacherId ?? null}::uuid)
       GROUP BY l.teacher_id`;
    return new Map(rows.map((r) => [r.teacher_id, Number(r.n)]));
  }

  private async lessonRows(org: string, p: Period, teacherId?: string): Promise<Row[]> {
    const rows = await this.prisma.$queryRaw<Row[]>`
      SELECT teacher_id::text AS teacher_id, category, kind, duration_minutes, lessons, minutes
        FROM chat.teacher_lesson_stats(${org}::uuid, ${p.from}::timestamptz, ${p.to}::timestamptz)
       WHERE ${teacherId ?? null}::uuid IS NULL OR teacher_id = ${teacherId ?? null}::uuid`;
    return rows.map((r) => ({ ...r, duration_minutes: Number(r.duration_minutes), lessons: Number(r.lessons), minutes: Number(r.minutes) }));
  }

  /** Student apologies by when they were excused (PD-15), per teacher and kind. */
  private async timingRows(org: string, p: Period, teacherId?: string): Promise<TimingRow[]> {
    const rows = await this.prisma.$queryRaw<TimingRow[]>`
      SELECT teacher_id::text AS teacher_id, kind, before_start, after_start
        FROM chat.teacher_apology_timing_stats(${org}::uuid, ${p.from}::timestamptz, ${p.to}::timestamptz)
       WHERE ${teacherId ?? null}::uuid IS NULL OR teacher_id = ${teacherId ?? null}::uuid`;
    return rows
      .filter((r) => r.kind !== 'trial')
      .map((r) => ({ ...r, before_start: Number(r.before_start), after_start: Number(r.after_start) }));
  }

  /** Trials of the month per teacher, each counted once by its current outcome. */
  private async trialRows(org: string, p: Period, teacherId?: string): Promise<TrialRow[]> {
    const rows = await this.prisma.$queryRaw<TrialRow[]>`
      SELECT teacher_id::text AS teacher_id, total, conducted, subscribed, not_subscribed, no_show, awaiting, upcoming, cancelled
        FROM chat.teacher_trial_stats(${org}::uuid, ${p.from}::timestamptz, ${p.to}::timestamptz)
       WHERE ${teacherId ?? null}::uuid IS NULL OR teacher_id = ${teacherId ?? null}::uuid`;
    return rows.map((r) => ({
      teacher_id: r.teacher_id, total: Number(r.total), conducted: Number(r.conducted), subscribed: Number(r.subscribed),
      not_subscribed: Number(r.not_subscribed), no_show: Number(r.no_show), awaiting: Number(r.awaiting),
      upcoming: Number(r.upcoming), cancelled: Number(r.cancelled),
    }));
  }

  private async reportRows(org: string, p: Period, teacherId?: string) {
    const grace = Number(await this.config.get('stats.report_grace_hours'));
    const rows = await this.prisma.$queryRaw<Array<{ teacher_id: string; reports: number; on_time: number; median_delay_minutes: number | null }>>`
      SELECT teacher_id::text AS teacher_id, reports, on_time, median_delay_minutes
        FROM chat.teacher_report_timeliness(${org}::uuid, ${p.from}::timestamptz, ${p.to}::timestamptz, make_interval(hours => ${grace}::int))
       WHERE ${teacherId ?? null}::uuid IS NULL OR teacher_id = ${teacherId ?? null}::uuid`;
    return rows.map((r) => ({ ...r, reports: Number(r.reports), on_time: Number(r.on_time) }));
  }

  private async replyRows(org: string, p: Period, teacherId: string) {
    const within = Number(await this.config.get('stats.reply_within_hours'));
    const rows = await this.prisma.$queryRaw<Array<{ teacher_id: string; family_messages: number; answered_within: number; median_reply_minutes: number | null }>>`
      SELECT teacher_id::text AS teacher_id, family_messages, answered_within, median_reply_minutes
        FROM chat.teacher_reply_times(${org}::uuid, ${p.from}::timestamptz, ${p.to}::timestamptz, make_interval(hours => ${within}::int))
       WHERE teacher_id = ${teacherId}::uuid`;
    return rows.map((r) => ({ ...r, family_messages: Number(r.family_messages), answered_within: Number(r.answered_within) }));
  }

  /** Null when the teacher has no recorded availability: "no data", not "zero hours". */
  private async availableMinutes(teacherId: string, p: Period): Promise<number | null> {
    const has = await this.prisma.teacherAvailability.count({ where: { teacherId } });
    if (has === 0) return null;
    const rows = await this.prisma.$queryRaw<Array<{ m: number }>>`
      SELECT chat.teacher_available_minutes(${teacherId}::uuid, ${p.firstDay}::date, ${p.nextFirstDay}::date) AS m`;
    return Number(rows[0]?.m ?? 0);
  }

  private async movements(org: string, teacherId: string, p: Period) {
    const [transfersIn, transfersOut, paused, stopped] = await Promise.all([
      this.prisma.learnerTransfer.count({ where: { organizationId: org, toTeacherId: teacherId, createdAt: { gte: p.from, lt: p.to } } }),
      this.prisma.learnerTransfer.count({ where: { organizationId: org, fromTeacherId: teacherId, createdAt: { gte: p.from, lt: p.to } } }),
      this.countSuspensions(org, teacherId, p, 'temporary'),
      this.countSuspensions(org, teacherId, p, 'permanent'),
    ]);
    return { transfersIn, transfersOut, paused, stopped };
  }

  /** Pauses and stops recorded in the month for the teacher's learners. */
  private async countSuspensions(org: string, teacherId: string, p: Period, kind: string) {
    const rows = await this.prisma.$queryRaw<Array<{ n: number }>>`
      SELECT count(*)::int AS n FROM chat.learner_suspension s JOIN chat.learner l ON l.id = s.learner_id
       WHERE s.organization_id = ${org}::uuid AND s.kind = ${kind} AND l.teacher_id = ${teacherId}::uuid
         AND s.created_at >= ${p.from}::timestamptz AND s.created_at < ${p.to}::timestamptz`;
    return Number(rows[0]?.n ?? 0);
  }

  /** A calendar month in the academy's zone, as instants. Defaults to the current month. */
  private async period(month?: string): Promise<Period> {
    const zone = String(await this.config.get('stats.zone'));
    if (month !== undefined && !MONTH_RE.test(month)) throw invalid('month: YYYY-MM');
    const rows = await this.prisma.$queryRaw<Array<{ month: string; first_day: string; next_first_day: string; from: Date; to: Date }>>`
      WITH m AS (
        SELECT coalesce(${month ?? null}::text || '-01', to_char((now() AT TIME ZONE ${zone})::date, 'YYYY-MM') || '-01')::date AS first_day
      )
      SELECT to_char(first_day, 'YYYY-MM') AS month,
             to_char(first_day, 'YYYY-MM-DD') AS first_day,
             to_char((first_day + interval '1 month')::date, 'YYYY-MM-DD') AS next_first_day,
             (first_day::timestamp AT TIME ZONE ${zone}) AS "from",
             ((first_day + interval '1 month')::timestamp AT TIME ZONE ${zone}) AS "to"
        FROM m`;
    const r = rows[0];
    return { month: r.month, zone, firstDay: r.first_day, nextFirstDay: r.next_first_day, from: r.from, to: r.to };
  }

  private async isStatsReader(actor: Actor): Promise<boolean> {
    if (actor.kind !== ActorKind.STAFF || !actor.isActive || !actor.organizationId) return false;
    return actor.staffRole === StaffRole.SUPER_ADMIN || (await this.lessons.isManager(actor));
  }

  private async requireStatsReader(actor: Actor) {
    if (!(await this.isStatsReader(actor))) {
      throw new CommError(CommErrorCode.LESSON_DENIED, 'teacher statistics belong to the Teachers department and the super admin');
    }
  }
}

type TimingRow = { teacher_id: string; kind: string; before_start: number; after_start: number };

/**
 * PD-15: a teacher's month in the owner's terms. Every lesson of the month is
 * in exactly one line (one lesson row, one category -- nothing is counted
 * twice); replaced (`rescheduled`) and paused (`suspended`) lessons are left
 * out of the total, and a voided lesson never reaches here (the SQL drops it).
 *
 *   totalScheduled   every lesson that still stands: closed + still pending
 *   conducted        held -- a report confirms the learner attended; regular
 *                    and make-up lessons both count (completed.total)
 *   studentAttended  the same lessons, from the learner's side
 *   studentNoShow    absent without an excuse
 *   studentExcuses   excused, split by before / after the start
 *   teacherExcuses   the teacher apologised (never counted as conducted)
 *   teacherNoShow    the teacher did not come
 *   cancelled        Jawwid cancelled it
 *   pending          no final outcome yet (still to come, or awaiting a report)
 *   makeups          make-up lessons: completed, still scheduled, total
 */
export function monthSummary(rows: Row[], timings: TimingRow[]) {
  const learnerRows = rows.filter((r) => r.kind !== 'trial');
  const n = (pred: (r: Row) => boolean) => learnerRows.filter(pred).reduce((a, r) => a + r.lessons, 0);
  const is = (...cats: string[]) => (r: Row) => cats.includes(r.category);
  const heldRegular = n((r) => r.category === 'held' && r.kind !== 'makeup');
  const heldMakeup = n((r) => r.category === 'held' && r.kind === 'makeup');
  const pendingAll = n(is('upcoming', 'unreported'));
  const before = timings.reduce((a, t) => a + t.before_start, 0);
  const after = timings.reduce((a, t) => a + t.after_start, 0);
  return {
    totalScheduled: n((r) => r.category !== 'rescheduled' && r.category !== 'suspended'),
    conducted: heldRegular + heldMakeup,
    studentAttended: heldRegular + heldMakeup,
    studentNoShow: n(is('student_no_show')),
    studentExcuses: { total: n(is('student_apology')), beforeStart: before, afterStart: after },
    teacherExcuses: n(is('teacher_apology')),
    teacherNoShow: n(is('teacher_no_show')),
    cancelled: n(is('admin_cancelled')),
    pending: { total: pendingAll, upcoming: n(is('upcoming')), awaitingReport: n(is('unreported')) },
    completed: { regular: heldRegular, makeup: heldMakeup, total: heldRegular + heldMakeup },
    makeups: {
      completed: heldMakeup,
      scheduled: n((r) => r.kind === 'makeup' && (r.category === 'upcoming' || r.category === 'unreported')),
      total: n((r) => r.kind === 'makeup' && r.category !== 'rescheduled' && r.category !== 'suspended'),
    },
  };
}

interface Period {
  month: string;
  zone: string;
  firstDay: string;
  nextFirstDay: string;
  from: Date;
  to: Date;
}

function sum(rows: Array<{ lessons: number; minutes: number }>): Bucket {
  return rows.reduce((a, r) => ({ lessons: a.lessons + r.lessons, minutes: a.minutes + r.minutes }), { lessons: 0, minutes: 0 });
}

/** A share from 0 to 1, or null when there is nothing to divide -- never a fake 0%. */
function rate(part: number, whole: number): number | null {
  return whole > 0 ? Math.round((part / whole) * 1000) / 1000 : null;
}

function groupBy<T>(rows: T[], key: (r: T) => string): Map<string, T[]> {
  const out = new Map<string, T[]>();
  for (const r of rows) out.set(key(r), [...(out.get(key(r)) ?? []), r]);
  return out;
}

function shiftMonth(month: string, by: number): string {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + by, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

interface TrialRow {
  teacher_id: string;
  total: number;
  conducted: number;
  subscribed: number;
  not_subscribed: number;
  no_show: number;
  awaiting: number;
  upcoming: number;
  cancelled: number;
}

/**
 * A teacher's month of trials. total = subscribed + notSubscribed + noShow +
 * awaiting; conversionRate is of the trials with a decision.
 */
function trialBlock(r: TrialRow | undefined) {
  const n = (k: keyof Omit<TrialRow, 'teacher_id'>) => r?.[k] ?? 0;
  return {
    total: n('total'),
    conducted: n('conducted'),
    subscribed: n('subscribed'),
    notSubscribed: n('not_subscribed'),
    noShow: n('no_show'),
    awaiting: n('awaiting'),
    upcoming: n('upcoming'),
    cancelled: n('cancelled'),
    conversionRate: rate(n('subscribed'), n('subscribed') + n('not_subscribed')),
  };
}
