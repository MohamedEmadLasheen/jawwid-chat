import { Injectable } from '@nestjs/common';
import { PrismaService } from '../platform/prisma.service';
import { AppConfigService } from '../platform/app-config.service';
import { CommError, CommErrorCode } from '../platform/errors';
import type { Actor } from '../platform/types';
import { ActorKind, LessonOutcome, StaffRole } from '../communication/contracts/vocab';
import { ConversationService, isUuid } from '../communication/conversations/conversation.service';
import { LessonService, invalid } from './lesson.service';
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
    const [teachers, rows, reports] = await Promise.all([
      this.prisma.teacher.findMany({ where: { organizationId: org }, select: { id: true, name: true, isActive: true }, orderBy: { name: 'asc' } }),
      this.lessonRows(org, period),
      this.reportRows(org, period),
    ]);
    const byTeacher = groupBy(rows, (r) => r.teacher_id);
    const reportsOf = new Map(reports.map((r) => [r.teacher_id, r]));
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
        };
      }),
    };
  }

  /** One teacher, the month in full -- the screenshot's dashboard and more. */
  async teacher(actorId: string, teacherId: string, month?: string) {
    const actor = await this.conversations.requireActor(actorId);
    await this.requireStatsReader(actor);
    if (!isUuid(teacherId)) throw new CommError(CommErrorCode.LESSON_NOT_FOUND, 'teacher not found');
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
    const lessons = await this.prisma.lesson.findMany({
      where: { learnerId: learner.id },
      include: { report: true },
      orderBy: { startsAt: 'desc' },
      take: 500,
    });
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
    const owed = await this.lessons.owedMakeups(learner.organizationId, { learnerIds: [learner.id] });
    const next = [...lessons].reverse().find((l) => l.outcome === null && l.startsAt.getTime() > now) ?? null;
    const lastReport = lessons.find((l) => l.report !== null) ?? null;
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
            covered: lastReport.report.covered,
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
    const [allRows, prevRows, reports, replies, conversions] = await Promise.all([
      this.lessonRows(org, period, teacherId),
      this.lessonRows(org, previous, teacherId),
      this.reportRows(org, period, teacherId),
      this.replyRows(org, period, teacherId),
      this.conversionRows(org, period, teacherId),
    ]);
    // A trial is not a student's lesson: it has its own block below, and only
    // its time joins the workload.
    const rows = allRows.filter((r) => r.kind !== 'trial');
    const trialRows = allRows.filter((r) => r.kind === 'trial');
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
      totals: { counted, scheduledMinutes },
      makeups: { lessons: makeups.lessons, held: makeupsHeld.lessons },
      trials: {
        lessons: sum(trialRows.filter((r) => COUNTED.has(r.category) || r.category === 'unreported')).lessons,
        attended: sum(trialRows.filter((r) => r.category === 'held')).lessons,
        noShow: sum(trialRows.filter((r) => r.category === 'student_no_show')).lessons,
        upcoming: sum(trialRows.filter((r) => r.category === 'upcoming')).lessons,
        // Sales' decision, by the trial's month; credited to the teacher only once Core confirms.
        subscribed: conversions.subscribed,
        confirmed: conversions.confirmed,
        notSubscribed: conversions.notSubscribed,
        available: true,
      },
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

  private async lessonRows(org: string, p: Period, teacherId?: string): Promise<Row[]> {
    const rows = await this.prisma.$queryRaw<Row[]>`
      SELECT teacher_id::text AS teacher_id, category, kind, duration_minutes, lessons, minutes
        FROM chat.teacher_lesson_stats(${org}::uuid, ${p.from}::timestamptz, ${p.to}::timestamptz)
       WHERE ${teacherId ?? null}::uuid IS NULL OR teacher_id = ${teacherId ?? null}::uuid`;
    return rows.map((r) => ({ ...r, duration_minutes: Number(r.duration_minutes), lessons: Number(r.lessons), minutes: Number(r.minutes) }));
  }

  /** Sales' recorded decisions on the teacher's trials of the month. */
  private async conversionRows(org: string, p: Period, teacherId: string) {
    const rows = await this.prisma.$queryRaw<Array<{ subscribed: number; confirmed: number; not_subscribed: number }>>`
      SELECT count(*) FILTER (WHERE o.result = 'subscribed')::int AS subscribed,
             count(*) FILTER (WHERE o.result = 'subscribed' AND o.confirmed_at IS NOT NULL)::int AS confirmed,
             count(*) FILTER (WHERE o.result = 'not_subscribed')::int AS not_subscribed
        FROM chat.trial_outcome o JOIN chat.lesson l ON l.id = o.lesson_id
       WHERE o.organization_id = ${org}::uuid AND l.teacher_id = ${teacherId}::uuid
         AND l.starts_at >= ${p.from}::timestamptz AND l.starts_at < ${p.to}::timestamptz`;
    const r = rows[0];
    return { subscribed: Number(r?.subscribed ?? 0), confirmed: Number(r?.confirmed ?? 0), notSubscribed: Number(r?.not_subscribed ?? 0) };
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
