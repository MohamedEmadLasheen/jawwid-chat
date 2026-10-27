import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../platform/prisma.service';
import { AppConfigService } from '../platform/app-config.service';
import { CommError, CommErrorCode } from '../platform/errors';
import { ACADEMY_ZONE, canonicalZone } from '../platform/time-zone';
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

type Query = Record<string, string | string[] | undefined>;

/**
 * Who sees what (PD-38 §B3). The super admin, the Teachers department and the
 * Operations Manager read the academy. An Operations supervisor reads the
 * academy's CAPACITY too, but another supervisor's child is an anonymous block:
 * time and color, no name -- PD-8's boundary on children holds.
 */
export type CalendarScope =
  | { kind: 'academy'; staffId: string }
  | { kind: 'supervisor'; staffId: string; ownLearners: ReadonlySet<string> };

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
  constructor(
    private readonly prisma: PrismaService,
    private readonly conversations: ConversationService,
    private readonly lessons: LessonService,
    private readonly config: AppConfigService,
  ) {}

  // ------------------------------------------------------------------
  // Access
  // ------------------------------------------------------------------

  async scopeOf(actor: Actor): Promise<CalendarScope | null> {
    if (actor.kind !== ActorKind.STAFF || !actor.isActive || !actor.organizationId) return null;
    if (actor.staffRole === StaffRole.SUPER_ADMIN) return { kind: 'academy', staffId: actor.actorId };
    // PD-35 will narrow a teacher supervisor to their assigned teachers; until
    // then the Teachers department reads the academy, as GET /lessons does.
    if ((await this.lessons.isManager(actor)) || (await this.managesDepartment(actor, 'operations'))) {
      return { kind: 'academy', staffId: actor.actorId };
    }
    if (await this.lessons.inDepartment(actor, 'operations')) {
      const own = await this.lessons.supervisedLearnerIds(actor, new Date());
      return { kind: 'supervisor', staffId: actor.actorId, ownLearners: new Set(own) };
    }
    return null;
  }

  async requireScope(actorId: string): Promise<{ actor: Actor; scope: CalendarScope }> {
    const actor = await this.conversations.requireActor(actorId);
    const scope = await this.scopeOf(actor);
    if (!scope) throw new CommError(CommErrorCode.LESSON_DENIED, 'the schedule belongs to the administration');
    return { actor, scope };
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
      teachers: teachers.map((t) => ({ id: t.id, name: t.name, isActive: t.is_active, category: t.category, timezone: t.timezone })),
      supervisors,
      learners: learners
        .filter((l) => scope.kind === 'academy' || scope.ownLearners.has(l.id))
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
        const named = scope.kind === 'academy' || (l.learner_id !== null && scope.ownLearners.has(l.learner_id));
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
               chat.mr_minutes(range_agg(tstzrange(m.starts_at, m.ends_at)) * tstzmultirange(tstzrange(win.lo, win.hi))) AS booked_m,
               chat.mr_minutes(coalesce(range_agg(tstzrange(m.starts_at, m.ends_at)) FILTER (WHERE m.outcome = 'held'), '{}'::tstzmultirange)
                               * tstzmultirange(tstzrange(win.lo, win.hi))) AS held_m,
               count(*)::int AS lessons
          FROM m, win
         WHERE m.matches AND m.st IN ('active', 'trial') AND m.teacher_id IN (SELECT teacher_id FROM shown)
         GROUP BY m.teacher_id, win.lo, win.hi
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

  // ------------------------------------------------------------------
  // Internals
  // ------------------------------------------------------------------

  /** Parse, then hold an Operations supervisor to their own children for the student filter. */
  private filtersFor(scope: CalendarScope, query: Query): CalendarFilters {
    const f = parseFilters(query);
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
