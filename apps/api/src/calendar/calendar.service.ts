import { Injectable, Optional } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../platform/prisma.service';
import { AppConfigService } from '../platform/app-config.service';
import { CommError, CommErrorCode } from '../platform/errors';
import { ACADEMY_ZONE, canonicalZone, localDate } from '../platform/time-zone';
import { ALL_TEACHERS, type TeacherScope } from '../platform/teacher-scope';
import { TimeZoneService } from '../platform/time-zone.service';
import type { Actor } from '../platform/types';
import { ConversationService } from '../communication/conversations/conversation.service';
import { ActorKind, StaffRole } from '../communication/contracts/vocab';
import { LessonService } from '../lessons/lesson.service';
import {
  DEFAULT_STATUSES,
  hasLessonFilter,
  parseFilters,
  utilization,
  type CalendarFilters,
} from './calendar-filters';
import { PALETTE_KEYS } from './palette';
import { dashboardTile, type DashboardTile } from '../dashboard/dashboard-tile';

type Query = Record<string, string | string[] | undefined>;

/**
 * Who sees what (PD-38 §B3) -- the UNION of every basis a person holds:
 *   - the super admin, the Operations Manager, and the Teachers department
 *     with PD-35's strict switch off (or the Teachers Manager): the academy;
 *   - an Operations supervisor: the academy's CAPACITY, with their own
 *     children named and every other child an anonymous block (time and
 *     color, no name -- PD-8's boundary on children holds);
 *   - a teacher supervisor under the strict switch: their assigned teachers.
 * A person holding two bases gets both: an Operations supervisor who also
 * supervises teachers sees those teachers' children named as well.
 */
export type CalendarScope =
  | { kind: 'academy'; staffId: string }
  // PD-35 strict scope: a teacher supervisor's own teachers, nobody else's.
  | { kind: 'teachers'; staffId: string; teacherIds: ReadonlySet<string> }
  // namedTeachers: the lessons of these teachers are named too (a Teachers basis held beside Operations).
  | { kind: 'supervisor'; staffId: string; ownLearners: ReadonlySet<string>; namedTeachers: ReadonlySet<string> };

/** One teacher row's totals over the window, in minutes. */
export interface TeacherTotals {
  shiftMinutes: number;
  workMinutes: number;
  leaveMinutes: number;
  bookedMinutes: number;
  pausedMinutes: number;
  inShiftBookedMinutes: number;
  inShiftPausedMinutes: number;
  inShiftLeaveMinutes: number;
  emptyMinutes: number;
  freeMinutes: number;
  outsideMinutes: number;
}

type CapRow = {
  teacher_id: string;
  day: string;
  shift_m: number; work_m: number; leave_m: number; booked_m: number; paused_m: number;
  in_shift_booked_m: number; in_shift_paused_m: number; in_shift_leave_m: number;
  empty_m: number; free_m: number; outside_m: number;
};

type TeacherRow = CapRow & { name: string; category: string; is_active: boolean; zone: string | null; lessons: number; matching: number };

/**
 * PD-38: the academy scheduling calendar. Every number is read from
 * chat.calendar_capacity (20261026210000) -- one definition per number -- and
 * every filter is applied in SQL. The calendar, the month summary and the
 * statistics share ONE query shape (`ctes`), so they cannot disagree.
 */
@Injectable()
export class CalendarService {
  private readonly timeZones: TimeZoneService;

  constructor(
    private readonly prisma: PrismaService,
    private readonly conversations: ConversationService,
    private readonly lessons: LessonService,
    private readonly config: AppConfigService,
    // PD-22's resolver. Optional so positional harness constructions stay as they are.
    @Optional() timeZones?: TimeZoneService,
  ) {
    this.timeZones = timeZones ?? new TimeZoneService(prisma);
  }

  // ------------------------------------------------------------------
  // Access
  // ------------------------------------------------------------------

  async scopeOf(actor: Actor): Promise<CalendarScope | null> {
    if (actor.kind !== ActorKind.STAFF || !actor.isActive || !actor.organizationId) return null;
    if (actor.staffRole === StaffRole.SUPER_ADMIN) return { kind: 'academy', staffId: actor.actorId };
    // Every basis, then their union -- no single check is final.
    // PD-35: the Teachers department reads the teachers in its scope -- every
    // teacher with the strict switch off (and always for the Teachers Manager),
    // a supervisor's assigned teachers with it on -- as GET /lessons does.
    const teachers = await this.lessons.teachersFacts(actor);
    if (teachers.department && teachers.scope.all) return { kind: 'academy', staffId: actor.actorId };
    if (await this.managesDepartment(actor, 'operations')) return { kind: 'academy', staffId: actor.actorId };
    const assigned: ReadonlySet<string> = teachers.department && !teachers.scope.all ? teachers.scope.teacherIds : new Set();
    if (await this.lessons.inDepartment(actor, 'operations')) {
      const own = await this.lessons.supervisedLearnerIds(actor, new Date());
      // The children of the assigned teachers may be asked for by name too.
      const taught = assigned.size === 0 ? [] : await this.prisma.$queryRaw<Array<{ id: string }>>`
        SELECT id::text AS id FROM chat.learner
         WHERE organization_id = ${actor.organizationId}::uuid AND teacher_id = ANY (${[...assigned]}::uuid[])`;
      return {
        kind: 'supervisor',
        staffId: actor.actorId,
        ownLearners: new Set([...own, ...taught.map((r) => r.id)]),
        namedTeachers: assigned,
      };
    }
    if (teachers.department) return { kind: 'teachers', staffId: actor.actorId, teacherIds: assigned };
    return null;
  }

  async requireScope(actorId: string): Promise<{ actor: Actor; scope: CalendarScope }> {
    const actor = await this.conversations.requireActor(actorId);
    const scope = await this.scopeOf(actor);
    if (!scope) throw new CommError(CommErrorCode.LESSON_DENIED, 'the schedule belongs to the administration');
    return { actor, scope };
  }

  /**
   * PD-44: the Dashboard's Lessons section (plan §3.3).
   *
   *   lessons.today_*        today's lessons as GET /calendar shows them to this
   *                          person (same scope, same window, same `m` and
   *                          `shown`), by outcome: upcoming / unreported (no
   *                          outcome, before / after their start), held, student
   *                          or teacher absent, cancelled (an apology or the
   *                          administration). Moved and paused lessons are in no
   *                          tile; an Operations supervisor counts only the
   *                          lessons the calendar names to them (an anonymous
   *                          lesson's outcome is not theirs to see).
   *   lessons.needs_outcome  GET /lessons/needs-action's overdue + awaiting close:
   *   lessons.rulings_open   and its open rulings -- the Teachers department (in
   *                          its PD-35 scope) and the super admin only
   *
   * Absent, never 0, outside a basis; another person (a parent, a teacher) is
   * refused as the calendar refuses them. A fixed number of statements.
   */
  async dashboardCounts(actorId: string, now: Date = new Date()): Promise<DashboardTile[]> {
    const actor = await this.conversations.requireActor(actorId);
    if (actor.kind !== ActorKind.STAFF) throw new CommError(CommErrorCode.LESSON_DENIED, 'the schedule belongs to the administration');
    if (!actor.isActive || !actor.organizationId) return [];
    const org = actor.organizationId;
    const [scope, facts] = await Promise.all([this.scopeOf(actor), this.lessons.teachersFacts(actor)]);
    const queue: TeacherScope | null = actor.staffRole === StaffRole.SUPER_ADMIN ? ALL_TEACHERS : facts.department ? facts.scope : null;
    const tiles: DashboardTile[] = [];

    if (scope) {
      const zone = await this.zone();
      const today = localDate(now, zone);
      const tomorrow = new Date(Date.parse(`${today}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
      const f = this.filtersFor(scope, { from: today, to: tomorrow });
      const supervisor = scope.kind === 'supervisor';
      const named = scope.kind === 'supervisor' ? [...scope.namedTeachers] : [];
      const own = scope.kind === 'supervisor' ? [...scope.ownLearners] : [];
      const [r] = await this.prisma.$queryRaw<Array<{
        upcoming: number; unreported: number; unreported_oldest: Date | null; held: number;
        student_absent: number; teacher_absent: number; cancelled: number;
      }>>`
        ${this.ctes(org, f, zone)}
        SELECT count(*) FILTER (WHERE m.outcome IS NULL AND m.starts_at > ${now}::timestamptz)::int AS upcoming,
               count(*) FILTER (WHERE m.outcome IS NULL AND m.starts_at <= ${now}::timestamptz)::int AS unreported,
               min(m.starts_at) FILTER (WHERE m.outcome IS NULL AND m.starts_at <= ${now}::timestamptz) AS unreported_oldest,
               count(*) FILTER (WHERE m.outcome = 'held')::int AS held,
               count(*) FILTER (WHERE m.outcome = 'student_no_show')::int AS student_absent,
               count(*) FILTER (WHERE m.outcome = 'teacher_no_show')::int AS teacher_absent,
               count(*) FILTER (WHERE m.outcome IN ('student_apology', 'teacher_apology', 'admin_cancelled'))::int AS cancelled
          FROM m
          JOIN shown t ON t.teacher_id = m.teacher_id
         WHERE m.st NOT IN ('moved', 'paused')
           AND (NOT ${supervisor}::boolean
                OR m.teacher_id = ANY (${named}::uuid[])
                OR m.learner_id = ANY (${own}::uuid[]))`;
      tiles.push(
        dashboardTile('lessons.today_upcoming', r?.upcoming ?? 0),
        dashboardTile('lessons.today_unreported', r?.unreported ?? 0, r?.unreported_oldest ?? null),
        dashboardTile('lessons.today_held', r?.held ?? 0),
        dashboardTile('lessons.today_student_absent', r?.student_absent ?? 0),
        dashboardTile('lessons.today_teacher_absent', r?.teacher_absent ?? 0),
        dashboardTile('lessons.today_cancelled', r?.cancelled ?? 0),
      );
    }

    if (queue) {
      const all = queue.all;
      const ids = queue.all ? [] : [...queue.teacherIds];
      // needsAction's own predicates: learner lessons (not trials) still open
      // after their end, and rulings nobody has decided -- in the PD-35 scope.
      const [q] = await this.prisma.$queryRaw<Array<{ open: number; open_oldest: Date | null; rulings: number; rulings_oldest: Date | null }>>`
        SELECT (SELECT count(*)::int FROM chat.lesson l
                 WHERE l.organization_id = ${org}::uuid AND l.kind <> 'trial' AND l.outcome IS NULL
                   AND l.ends_at <= ${now}::timestamptz
                   AND (${all}::boolean OR l.teacher_id = ANY (${ids}::uuid[]))) AS open,
               (SELECT min(l.ends_at) FROM chat.lesson l
                 WHERE l.organization_id = ${org}::uuid AND l.kind <> 'trial' AND l.outcome IS NULL
                   AND l.ends_at <= ${now}::timestamptz
                   AND (${all}::boolean OR l.teacher_id = ANY (${ids}::uuid[]))) AS open_oldest,
               (SELECT count(*)::int FROM chat.lesson_ruling r JOIN chat.lesson l ON l.id = r.lesson_id
                 WHERE r.organization_id = ${org}::uuid AND r.decision IS NULL
                   AND (${all}::boolean OR l.teacher_id = ANY (${ids}::uuid[]))) AS rulings,
               (SELECT min(r.opened_at) FROM chat.lesson_ruling r JOIN chat.lesson l ON l.id = r.lesson_id
                 WHERE r.organization_id = ${org}::uuid AND r.decision IS NULL
                   AND (${all}::boolean OR l.teacher_id = ANY (${ids}::uuid[]))) AS rulings_oldest`;
      tiles.push(
        dashboardTile('lessons.needs_outcome', q?.open ?? 0, q?.open_oldest ?? null),
        dashboardTile('lessons.rulings_open', q?.rulings ?? 0, q?.rulings_oldest ?? null),
      );
    }
    return tiles;
  }

  /** The department's manager (chat.department.manager_id), not a member. */
  async managesDepartment(actor: Actor, kind: 'teachers' | 'operations'): Promise<boolean> {
    if (actor.kind !== ActorKind.STAFF || !actor.isActive || !actor.organizationId) return false;
    const rows = await this.prisma.$queryRaw<Array<{ ok: boolean }>>`
      SELECT EXISTS (SELECT 1 FROM chat.department d
                      WHERE d.organization_id = ${actor.organizationId}::uuid AND d.kind = ${kind}
                        AND d.manager_id = ${actor.actorId}::uuid) AS ok`;
    return rows[0]?.ok === true;
  }

  async zone(): Promise<string> {
    return canonicalZone(await this.config.get('stats.zone')) ?? ACADEMY_ZONE;
  }

  // ------------------------------------------------------------------
  // Reads
  // ------------------------------------------------------------------

  /** What the filter panel and the legend offer this viewer. */
  async options(actorId: string) {
    const { actor, scope } = await this.requireScope(actorId);
    const org = actor.organizationId as string;
    const superAdmin = actor.staffRole === StaffRole.SUPER_ADMIN;
    const zone = await this.zone();
    const [teachers, supervisors, learners, editShifts, editColors] = await Promise.all([
      this.prisma.$queryRaw<Array<{ id: string; name: string; is_active: boolean; category: string; timezone: string | null }>>`
        SELECT t.id::text AS id, t.name, t.is_active,
               coalesce(p.category, 'unset') AS category,
               coalesce(p.timezone, (SELECT min(a.timezone) FROM chat.teacher_availability a WHERE a.teacher_id = t.id)) AS timezone
          FROM chat.teacher t
          LEFT JOIN chat.teacher_work_pattern p
            ON p.teacher_id = t.id AND p.valid_from <= (now() AT TIME ZONE ${zone})::date
           AND (p.valid_to IS NULL OR (now() AT TIME ZONE ${zone})::date < p.valid_to)
         WHERE t.organization_id = ${org}::uuid
         ORDER BY t.name`,
      this.supervisors(org),
      this.prisma.$queryRaw<Array<{ id: string; name: string; teacher_id: string | null }>>`
        SELECT l.id::text AS id, l.name, l.teacher_id::text AS teacher_id
          FROM chat.learner l
         WHERE l.organization_id = ${org}::uuid AND l.teacher_id IS NOT NULL
         ORDER BY l.name`,
      superAdmin || this.managesDepartment(actor, 'teachers'),
      superAdmin || this.managesDepartment(actor, 'operations'),
    ]);
    return {
      zone,
      viewer: { staffId: actor.actorId, scope: scope.kind, canEditShifts: editShifts, canEditColors: editColors },
      palette: PALETTE_KEYS,
      teachers: teachers
        .filter((t) => scope.kind !== 'teachers' || scope.teacherIds.has(t.id))
        .map((t) => ({ id: t.id, name: t.name, isActive: t.is_active, category: t.category, timezone: t.timezone })),
      supervisors,
      learners: learners
        .filter((l) =>
          scope.kind === 'academy' ||
          (scope.kind === 'teachers' && l.teacher_id !== null && scope.teacherIds.has(l.teacher_id)) ||
          (scope.kind === 'supervisor' && scope.ownLearners.has(l.id)))
        .map((l) => ({ id: l.id, name: l.name, teacherId: l.teacher_id })),
    };
  }

  /** Operations' supervisors (and its manager), each with their calendar color. */
  async supervisors(org: string) {
    const rows = await this.prisma.$queryRaw<Array<{ id: string; name: string; role: string; color_key: string | null }>>`
      SELECT s.id::text AS id, s.name,
             CASE WHEN d.manager_id = s.id THEN 'manager' ELSE m.position END AS role,
             c.color_key
        FROM chat.department d
        JOIN chat.staff s ON s.organization_id = d.organization_id
                         AND (s.id = d.manager_id
                              OR EXISTS (SELECT 1 FROM chat.department_member m2 WHERE m2.department_id = d.id AND m2.staff_id = s.id))
        LEFT JOIN chat.department_member m ON m.department_id = d.id AND m.staff_id = s.id
        LEFT JOIN chat.staff_calendar_color c ON c.staff_id = s.id
       WHERE d.organization_id = ${org}::uuid AND d.kind = 'operations' AND s.is_active
       ORDER BY s.name`;
    return rows.map((r) => ({ id: r.id, name: r.name, role: r.role, colorKey: r.color_key }));
  }

  /** Day and week views: the shown teachers, their intervals per day, and the lessons. */
  async calendar(actorId: string, query: Query) {
    const { actor, scope } = await this.requireScope(actorId);
    const f = this.filtersFor(scope, query);
    const zone = await this.zone();
    const org = actor.organizationId as string;
    const ctes = this.ctes(org, f, zone);

    // ONE statement: chat.calendar_capacity is computed once for the rows, the
    // days and the lessons (three queries computed it three times).
    type DayRow = { teacher_id: string; day: string; shift: unknown; work: unknown; leave: unknown; empty: unknown; free: unknown };
    type LessonRow = {
      id: string; teacher_id: string; learner_id: string | null; learner_name: string | null; prospect_name: string | null;
      kind: string; st: string; outcome: string | null; payment_hold: boolean; starts_at: string; ends_at: string;
      moved_from: string | null; matches: boolean; color_key: string | null; within_hours: boolean;
    };
    const [{ teachers, days, lessons }] = await this.prisma.$queryRaw<Array<{ teachers: TeacherRow[]; days: DayRow[]; lessons: LessonRow[] }>>`
      ${ctes}
      SELECT
        (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM (${this.teacherSelect()}) t) AS teachers,
        (SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY x.teacher_id, x.day), '[]'::jsonb) FROM (
           SELECT c.teacher_id::text AS teacher_id, to_char(c.day, 'YYYY-MM-DD') AS day,
                  chat.mr_json(c.shift) AS shift, chat.mr_json(c.work) AS work, chat.mr_json(c.leave) AS leave,
                  chat.mr_json(c.empty) AS empty, chat.mr_json(c.free) AS free
             FROM cap c
            WHERE c.teacher_id IN (SELECT teacher_id FROM shown)) x) AS days,
        (SELECT coalesce(jsonb_agg(to_jsonb(y) ORDER BY y.starts_at, y.teacher_id), '[]'::jsonb) FROM (
           SELECT m.id::text AS id, m.teacher_id::text AS teacher_id, m.learner_id::text AS learner_id,
                  ln.name AS learner_name, tp.display_name AS prospect_name,
                  m.kind, m.st, m.outcome, (m.outcome = 'suspended' AND m.outcome_by_kind = 'system') AS payment_hold,
                  m.starts_at, m.ends_at, m.moved_from::text AS moved_from, m.matches, col.color_key,
                  (tstzrange(m.starts_at, m.ends_at) <@ t.hours) AS within_hours
             FROM m
             JOIN shown t ON t.teacher_id = m.teacher_id
             LEFT JOIN chat.learner ln ON ln.id = m.learner_id
             LEFT JOIN chat.trial_prospect tp ON tp.id = m.prospect_id
             LEFT JOIN chat.staff_calendar_color col ON col.staff_id = m.supervisor_id) y) AS lessons`;

    const categoryOf = new Map(teachers.map((t) => [t.teacher_id, t.category]));
    return {
      zone,
      from: f.from,
      to: f.to,
      lessonFilter: hasLessonFilter(f),
      teachers: teachers.map((t) => this.teacherDto(t)),
      days: days.map((d) => ({
        teacherId: d.teacher_id, day: d.day,
        shift: d.shift, work: d.work, leave: d.leave, empty: d.empty, free: d.free,
      })),
      lessons: lessons.map((l) => {
        const named =
          scope.kind !== 'supervisor' || scope.namedTeachers.has(l.teacher_id) || (l.learner_id !== null && scope.ownLearners.has(l.learner_id));
        const shift = categoryOf.get(l.teacher_id) === 'full_shift' || categoryOf.get(l.teacher_id) === 'part_shift';
        return {
          id: l.id,
          teacherId: l.teacher_id,
          startsAt: new Date(l.starts_at).toISOString(),
          endsAt: new Date(l.ends_at).toISOString(),
          kind: l.kind,
          status: l.st,
          colorKey: l.color_key,
          matches: l.matches,
          outsideShift: shift && !l.within_hours,
          // Another supervisor's child: time, status and color only.
          ...(named
            ? {
                learner: l.learner_id ? { id: l.learner_id, name: l.learner_name } : null,
                prospect: l.prospect_name ? { name: l.prospect_name } : null,
                outcome: l.outcome,
                suspendedFor: l.payment_hold ? 'payment' : null,
                movedFrom: l.moved_from,
              }
            : { anonymous: true }),
        };
      }),
    };
  }

  /** Month view (and any large window): per teacher and day, numbers only. */
  async summary(actorId: string, query: Query) {
    const { actor, scope } = await this.requireScope(actorId);
    const f = this.filtersFor(scope, query);
    const zone = await this.zone();
    const ctes = this.ctes(actor.organizationId as string, f, zone);
    // One statement: the capacity is computed once for the rows and the cells.
    const [{ teachers, cells }] = await this.prisma.$queryRaw<Array<{ teachers: TeacherRow[]; cells: Array<CapRow & { lessons: number; matching: number }> }>>`
      ${ctes}
      SELECT
        (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM (${this.teacherSelect()}) t) AS teachers,
        (SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY x.teacher_id, x.day), '[]'::jsonb) FROM (
           SELECT c.teacher_id::text AS teacher_id, to_char(c.day, 'YYYY-MM-DD') AS day,
                  c.shift_m, c.work_m, c.leave_m, c.booked_m, c.paused_m,
                  c.in_shift_booked_m, c.in_shift_paused_m, c.in_shift_leave_m, c.empty_m, c.free_m, c.outside_m,
                  coalesce(md.lessons, 0) AS lessons, coalesce(md.matching, 0) AS matching
             FROM cap c
             LEFT JOIN m_day md ON md.teacher_id = c.teacher_id AND md.day = c.day
            WHERE c.teacher_id IN (SELECT teacher_id FROM shown)) x) AS cells`;
    return {
      zone,
      from: f.from,
      to: f.to,
      lessonFilter: hasLessonFilter(f),
      teachers: teachers.map((t) => this.teacherDto(t)),
      cells: cells.map((c) => ({
        teacherId: c.teacher_id,
        day: c.day,
        lessons: c.lessons,
        matching: c.matching,
        ...totalsOf(c),
        utilization: utilization(totalsOf(c)),
      })),
    };
  }

  /**
   * The stats bar: ONE statement over the same CTEs as the calendar. Teaching
   * hours are the merged time of the MATCHING booked lessons (overlaps counted
   * once); distinct students are counted once each; capacity is the shown
   * teachers' (all their lessons). Totals are sums of minutes, never averages
   * of percentages.
   */
  async stats(actorId: string, query: Query) {
    const { actor, scope } = await this.requireScope(actorId);
    const f = this.filtersFor(scope, query);
    const zone = await this.zone();
    const ctes = this.ctes(actor.organizationId as string, f, zone);
    const rows = await this.prisma.$queryRaw<Array<{ teachers: TeacherRow[]; lessons: {
      lessons: number; booked_m: number; held_m: number; students: number; trial_students: number; paused_students: number;
    } }>>`
      ${ctes},
      taught AS (
        SELECT m.teacher_id,
               chat.mr_minutes(range_agg(tstzrange(m.starts_at, m.ends_at))) AS booked_m,
               chat.mr_minutes(coalesce(range_agg(tstzrange(m.starts_at, m.ends_at)) FILTER (WHERE m.outcome = 'held'), '{}'::tstzmultirange)) AS held_m,
               count(*)::int AS lessons
          FROM m
         WHERE m.matches AND m.st IN ('active', 'trial') AND m.teacher_id IN (SELECT teacher_id FROM shown)
         GROUP BY m.teacher_id
      )
      SELECT
        (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM (${this.teacherSelect()}) t) AS teachers,
        (SELECT jsonb_build_object(
                  'lessons', coalesce((SELECT sum(lessons) FROM taught), 0),
                  'booked_m', coalesce((SELECT sum(booked_m) FROM taught), 0),
                  'held_m', coalesce((SELECT sum(held_m) FROM taught), 0),
                  'students', count(DISTINCT m.learner_id) FILTER (WHERE m.st = 'active'),
                  'trial_students', count(DISTINCT m.prospect_id) FILTER (WHERE m.st = 'trial'),
                  'paused_students', count(DISTINCT m.learner_id) FILTER (WHERE m.st = 'paused'))
           FROM m WHERE m.matches AND m.teacher_id IN (SELECT teacher_id FROM shown)) AS lessons`;
    const r = rows[0];
    const teachers = r.teachers.map((t) => this.teacherDto(t));
    const sum = (k: keyof TeacherTotals, among = teachers) => among.reduce((n, t) => n + t.totals[k], 0);
    const shiftTeachers = teachers.filter((t) => t.category === 'full_shift' || t.category === 'part_shift');
    const capacity = {
      shiftMinutes: sum('shiftMinutes'),
      inShiftBookedMinutes: sum('inShiftBookedMinutes'),
      inShiftPausedMinutes: sum('inShiftPausedMinutes'),
      inShiftLeaveMinutes: sum('inShiftLeaveMinutes'),
      emptyMinutes: sum('emptyMinutes'),
      outsideMinutes: sum('outsideMinutes'),
      workMinutes: sum('workMinutes'),
      freeMinutes: sum('freeMinutes'),
    };
    return {
      zone,
      from: f.from,
      to: f.to,
      lessonFilter: hasLessonFilter(f),
      teaching: {
        lessons: Number(r.lessons.lessons),
        bookedMinutes: Number(r.lessons.booked_m),
        heldMinutes: Number(r.lessons.held_m),
      },
      students: {
        distinct: Number(r.lessons.students),
        trial: Number(r.lessons.trial_students),
        paused: Number(r.lessons.paused_students),
      },
      capacity: {
        ...capacity,
        utilization: utilization({
          shiftMinutes: sum('shiftMinutes', shiftTeachers),
          inShiftBookedMinutes: sum('inShiftBookedMinutes', shiftTeachers),
          inShiftLeaveMinutes: sum('inShiftLeaveMinutes', shiftTeachers),
        }),
      },
      teachers,
    };
  }

  /**
   * PD-38 P2: a teacher's own schedule -- their shift or working hours, leave,
   * empty time and lessons, with the period's figures. The teacher is the
   * caller, never a parameter, so no other teacher's lesson or student can be
   * asked for; the days are the teacher's account zone (PD-22, what the app's
   * clock shows). Nothing financial reaches a teacher: a payment hold reads
   * "paused" (PD-30), and supervisors' colors are the office's, not shown.
   * ONE statement, like the academy views.
   */
  async mine(actorId: string, query: Query) {
    const actor = await this.conversations.requireActor(actorId);
    if (actor.kind !== ActorKind.TEACHER || !actor.isActive || !actor.organizationId) {
      throw new CommError(CommErrorCode.LESSON_DENIED, 'this is a teacher\'s own schedule');
    }
    // Only the window: every other filter is the office's.
    const f: CalendarFilters = {
      ...parseFilters({ from: one(query.from), to: one(query.to) }),
      teacherIds: [actor.actorId],
    };
    const zone = await this.accountZone(actor.actorId);
    const ctes = this.ctes(actor.organizationId, f, zone);
    type DayRow = { day: string; shift: unknown; work: unknown; leave: unknown; empty: unknown; free: unknown };
    type LessonRow = {
      id: string; learner_id: string | null; learner_name: string | null; prospect_name: string | null; kind: string; st: string;
      outcome: string | null; starts_at: string; ends_at: string; moved_from: string | null; within_hours: boolean;
    };
    type Taught = { lessons: number; booked_m: number; held_m: number; students: number; trial_students: number };
    const [{ teachers, days, lessons, taught }] = await this.prisma.$queryRaw<Array<{
      teachers: TeacherRow[]; days: DayRow[]; lessons: LessonRow[]; taught: Taught;
    }>>`
      ${ctes}
      SELECT
        (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM (${this.teacherSelect()}) t) AS teachers,
        (SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY x.day), '[]'::jsonb) FROM (
           SELECT to_char(c.day, 'YYYY-MM-DD') AS day,
                  chat.mr_json(c.shift) AS shift, chat.mr_json(c.work) AS work, chat.mr_json(c.leave) AS leave,
                  chat.mr_json(c.empty) AS empty, chat.mr_json(c.free) AS free
             FROM cap c WHERE c.teacher_id = ${actor.actorId}::uuid) x) AS days,
        (SELECT coalesce(jsonb_agg(to_jsonb(y) ORDER BY y.starts_at), '[]'::jsonb) FROM (
           SELECT m.id::text AS id, m.learner_id::text AS learner_id, ln.name AS learner_name, tp.display_name AS prospect_name,
                  m.kind, m.st, m.outcome, m.starts_at, m.ends_at, m.moved_from::text AS moved_from,
                  coalesce(tstzrange(m.starts_at, m.ends_at) <@ t.hours, false) AS within_hours
             FROM m
             LEFT JOIN cap_t t ON t.teacher_id = m.teacher_id
             LEFT JOIN chat.learner ln ON ln.id = m.learner_id
             LEFT JOIN chat.trial_prospect tp ON tp.id = m.prospect_id
            WHERE m.teacher_id = ${actor.actorId}::uuid) y) AS lessons,
        (SELECT jsonb_build_object(
                  'lessons', count(*) FILTER (WHERE m.st IN ('active', 'trial')),
                  'booked_m', chat.mr_minutes(coalesce(range_agg(tstzrange(m.starts_at, m.ends_at)) FILTER (WHERE m.st IN ('active', 'trial')), '{}'::tstzmultirange)),
                  'held_m', chat.mr_minutes(coalesce(range_agg(tstzrange(m.starts_at, m.ends_at)) FILTER (WHERE m.outcome = 'held'), '{}'::tstzmultirange)),
                  'students', count(DISTINCT m.learner_id) FILTER (WHERE m.st = 'active'),
                  'trial_students', count(DISTINCT m.prospect_id) FILTER (WHERE m.st = 'trial'))
           FROM m WHERE m.teacher_id = ${actor.actorId}::uuid) AS taught`;
    const me = teachers[0] ? this.teacherDto(teachers[0]) : null;
    const shift = me?.category === 'full_shift' || me?.category === 'part_shift';
    return {
      zone,
      from: f.from,
      to: f.to,
      category: me?.category ?? 'unset',
      totals: me?.totals ?? null,
      utilization: me?.utilization ?? null,
      teaching: { lessons: Number(taught.lessons), bookedMinutes: Number(taught.booked_m), heldMinutes: Number(taught.held_m) },
      students: { distinct: Number(taught.students), trial: Number(taught.trial_students) },
      days,
      lessons: lessons.map((l) => ({
        id: l.id,
        startsAt: new Date(l.starts_at).toISOString(),
        endsAt: new Date(l.ends_at).toISOString(),
        kind: l.kind,
        status: l.st,
        outcome: l.outcome,
        learner: l.learner_id ? { id: l.learner_id, name: l.learner_name } : null,
        prospect: l.prospect_name ? { name: l.prospect_name } : null,
        movedFrom: l.moved_from,
        outsideShift: shift && !l.within_hours,
      })),
    };
  }

  /**
   * A person's own zone (PD-22: what their app's clock shows), else the
   * academy's -- both through TimeZoneService, the resolver every other reader
   * of a person's zone uses. The response names the zone it used, and the app
   * draws in exactly that zone, so the two can never cut a day differently.
   */
  private async accountZone(actorId: string): Promise<string> {
    const own = await this.timeZones.get(actorId);
    return canonicalZone(own.timeZone) ?? (await this.timeZones.academyZone());
  }

  // ------------------------------------------------------------------
  // Internals
  // ------------------------------------------------------------------

  /** Parse, then hold an Operations supervisor to their own children for the student filter. */
  private filtersFor(scope: CalendarScope, query: Query): CalendarFilters {
    const f = parseFilters(query);
    if (scope.kind === 'teachers') {
      // A teacher outside the scope is not found, never "forbidden" (PD-35).
      if (f.teacherIds?.some((id) => !scope.teacherIds.has(id))) {
        throw new CommError(CommErrorCode.LESSON_NOT_FOUND, 'teacher not found');
      }
      return { ...f, teacherIds: f.teacherIds ?? [...scope.teacherIds] };
    }
    if (scope.kind === 'supervisor' && f.learnerIds?.some((id) => !scope.ownLearners.has(id))) {
      // As GET /lessons: a child outside the scope is not found, never "forbidden".
      throw new CommError(CommErrorCode.LESSON_NOT_FOUND, 'student not found');
    }
    return f;
  }

  /**
   * The shared query shape. `cap` is chat.calendar_capacity in minutes (and its
   * intervals); `cap_t` sums it per teacher; `m` is the window's lessons with
   * `matches` (the lesson-level filters); `shown` is the teacher rows after the
   * teacher-level filters.
   */
  private ctes(org: string, f: CalendarFilters, zone: string): Prisma.Sql {
    const statuses = f.statuses ?? [...DEFAULT_STATUSES];
    const lessonFilter = hasLessonFilter(f);
    const util = f.utilization;
    return Prisma.sql`
      WITH win AS (
        SELECT (${f.from}::date)::timestamp AT TIME ZONE ${zone} AS lo,
               (${f.to}::date)::timestamp AT TIME ZONE ${zone} AS hi
      ),
      cap AS (
        SELECT c.teacher_id, c.day, c.category, c.shift, c.work, c.leave, c.empty, c.free,
               chat.mr_minutes(c.shift) AS shift_m, chat.mr_minutes(c.work) AS work_m,
               chat.mr_minutes(c.leave) AS leave_m, chat.mr_minutes(c.booked) AS booked_m,
               chat.mr_minutes(c.paused) AS paused_m, chat.mr_minutes(c.in_shift_booked) AS in_shift_booked_m,
               chat.mr_minutes(c.in_shift_paused) AS in_shift_paused_m, chat.mr_minutes(c.in_shift_leave) AS in_shift_leave_m,
               chat.mr_minutes(c.empty) AS empty_m, chat.mr_minutes(c.free) AS free_m, chat.mr_minutes(c.outside) AS outside_m
          FROM chat.calendar_capacity(${org}::uuid, ${f.teacherIds}::uuid[], ${f.from}::date, ${f.to}::date, ${zone}) c
         WHERE ${f.weekdays}::int[] IS NULL OR extract(isodow FROM c.day)::int = ANY (${f.weekdays}::int[])
      ),
      cap_t AS (
        SELECT c.teacher_id,
               (array_agg(c.category ORDER BY c.day DESC))[1] AS category,
               array_agg(DISTINCT c.category) AS categories,
               range_agg(c.shift + c.work) AS hours,
               sum(c.shift_m)::int AS shift_m, sum(c.work_m)::int AS work_m, sum(c.leave_m)::int AS leave_m,
               sum(c.booked_m)::int AS booked_m, sum(c.paused_m)::int AS paused_m,
               sum(c.in_shift_booked_m)::int AS in_shift_booked_m, sum(c.in_shift_paused_m)::int AS in_shift_paused_m,
               sum(c.in_shift_leave_m)::int AS in_shift_leave_m, sum(c.empty_m)::int AS empty_m,
               sum(c.free_m)::int AS free_m, sum(c.outside_m)::int AS outside_m
          FROM cap c
         GROUP BY c.teacher_id
      ),
      m AS (
        SELECT l.id, l.teacher_id, l.learner_id, l.prospect_id, l.kind, l.outcome, l.outcome_by_kind,
               l.starts_at, l.ends_at, l.moved_from, chat.calendar_status(l.kind, l.outcome) AS st, ls.supervisor_id,
               (chat.calendar_status(l.kind, l.outcome) = ANY (${statuses}::text[])
                AND (${f.supervisorIds}::uuid[] IS NULL AND NOT ${f.withoutSupervisor}::boolean
                     OR ls.supervisor_id = ANY (coalesce(${f.supervisorIds}::uuid[], '{}'))
                     OR (${f.withoutSupervisor}::boolean AND l.learner_id IS NOT NULL AND ls.supervisor_id IS NULL))
                AND (${f.learnerIds}::uuid[] IS NULL OR l.learner_id = ANY (${f.learnerIds}::uuid[]))
                AND (${f.kinds}::text[] IS NULL OR l.kind = ANY (${f.kinds}::text[]))
                AND (${f.timeFrom}::int IS NULL
                     OR extract(hour FROM l.starts_at AT TIME ZONE ${zone}) * 60 + extract(minute FROM l.starts_at AT TIME ZONE ${zone}) >= ${f.timeFrom}::int)
                AND (${f.timeTo}::int IS NULL
                     OR extract(hour FROM l.starts_at AT TIME ZONE ${zone}) * 60 + extract(minute FROM l.starts_at AT TIME ZONE ${zone}) < ${f.timeTo}::int)
               ) AS matches
          FROM win, chat.calendar_lessons(${org}::uuid, ${f.teacherIds}::uuid[], win.lo, win.hi) l
          LEFT JOIN chat.learner_supervision ls ON ls.learner_id = l.learner_id
         WHERE (${f.weekdays}::int[] IS NULL OR extract(isodow FROM l.starts_at AT TIME ZONE ${zone})::int = ANY (${f.weekdays}::int[]))
           AND (chat.calendar_status(l.kind, l.outcome) <> 'moved' OR 'moved' = ANY (${statuses}::text[]))
           -- One rule for every list and figure: a lesson belongs to the window it
           -- STARTS in (the day it is drawn on). Capacity alone is by time.
           AND l.starts_at >= win.lo
      ),
      -- Lesson counts, grouped once (a correlated count per cell scanned the
      -- window's lessons once per cell: 4.7 s for a month of 100 teachers).
      m_t AS (
        SELECT m.teacher_id, count(*) FILTER (WHERE m.st <> 'moved')::int AS lessons, count(*) FILTER (WHERE m.matches)::int AS matching
          FROM m GROUP BY m.teacher_id
      ),
      m_day AS (
        SELECT m.teacher_id, (m.starts_at AT TIME ZONE ${zone})::date AS day,
               count(*) FILTER (WHERE m.st <> 'moved')::int AS lessons, count(*) FILTER (WHERE m.matches)::int AS matching
          FROM m GROUP BY 1, 2
      ),
      shown AS (
        SELECT t.*,
               CASE WHEN t.shift_m - t.in_shift_leave_m > 0
                    THEN t.in_shift_booked_m::numeric / (t.shift_m - t.in_shift_leave_m) END AS util
          FROM cap_t t
         WHERE (${f.categories}::text[] IS NULL OR t.categories && ${f.categories}::text[])
           AND (${f.emptyMinutesGte}::int IS NULL OR t.empty_m >= ${f.emptyMinutesGte}::int)
           AND (${util}::text[] IS NULL OR (t.shift_m - t.in_shift_leave_m > 0 AND (
                  ('lt50' = ANY (${util}::text[]) AND t.in_shift_booked_m::numeric / (t.shift_m - t.in_shift_leave_m) < 0.5)
               OR ('50to80' = ANY (${util}::text[]) AND t.in_shift_booked_m::numeric / (t.shift_m - t.in_shift_leave_m) >= 0.5
                                                    AND t.in_shift_booked_m::numeric / (t.shift_m - t.in_shift_leave_m) < 0.8)
               OR ('gte80' = ANY (${util}::text[]) AND t.in_shift_booked_m::numeric / (t.shift_m - t.in_shift_leave_m) >= 0.8))))
           AND (NOT ${lessonFilter && f.onlyMatching}::boolean OR EXISTS (SELECT 1 FROM m WHERE m.teacher_id = t.teacher_id AND m.matches))
      )`;
  }

  private teacherSelect(): Prisma.Sql {
    return Prisma.sql`
      SELECT t.teacher_id::text AS teacher_id, te.name, te.is_active, t.category,
             coalesce((SELECT p.timezone FROM chat.teacher_work_pattern p WHERE p.teacher_id = t.teacher_id AND p.valid_to IS NULL),
                      (SELECT min(a.timezone) FROM chat.teacher_availability a WHERE a.teacher_id = t.teacher_id)) AS zone,
             t.shift_m, t.work_m, t.leave_m, t.booked_m, t.paused_m, t.in_shift_booked_m, t.in_shift_paused_m,
             t.in_shift_leave_m, t.empty_m, t.free_m, t.outside_m,
             coalesce(mt.lessons, 0) AS lessons, coalesce(mt.matching, 0) AS matching
        FROM shown t
        JOIN chat.teacher te ON te.id = t.teacher_id
        LEFT JOIN m_t mt ON mt.teacher_id = t.teacher_id
       ORDER BY te.name`;
  }

  private teacherDto(t: TeacherRow) {
    const totals = totalsOf(t);
    return {
      id: t.teacher_id,
      name: t.name,
      isActive: t.is_active,
      category: t.category,
      zone: t.zone,
      lessons: Number(t.lessons),
      matching: Number(t.matching),
      totals,
      utilization: utilization(totals),
    };
  }
}

function one(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

function totalsOf(r: CapRow | TeacherRow): TeacherTotals {
  return {
    shiftMinutes: Number(r.shift_m),
    workMinutes: Number(r.work_m),
    leaveMinutes: Number(r.leave_m),
    bookedMinutes: Number(r.booked_m),
    pausedMinutes: Number(r.paused_m),
    inShiftBookedMinutes: Number(r.in_shift_booked_m),
    inShiftPausedMinutes: Number(r.in_shift_paused_m),
    inShiftLeaveMinutes: Number(r.in_shift_leave_m),
    emptyMinutes: Number(r.empty_m),
    freeMinutes: Number(r.free_m),
    outsideMinutes: Number(r.outside_m),
  };
}
