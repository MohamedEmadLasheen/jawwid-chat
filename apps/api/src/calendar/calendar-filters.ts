import { CommError, CommErrorCode } from '../platform/errors';
import { isUuid } from '../communication/conversations/conversation.service';

/**
 * PD-38: the calendar's query string, parsed once. Pure (no I/O), so every rule
 * here is unit-tested; the SQL that applies a filter lives in calendar.service.
 *
 * Two kinds of filter, and the difference is the design's key rule:
 *   - teacher-level (teacher, category, utilization, empty hours) choose the
 *     teacher rows -- and so the capacity totals;
 *   - lesson-level (supervisor, student, status, kind, time of day) choose which
 *     lessons are highlighted and which feed the lesson statistics.
 * Capacity always counts ALL of a shown teacher's lessons: filtering by one
 * supervisor must never paint another supervisor's lesson as empty time.
 */

export const CATEGORIES = ['full_shift', 'part_shift', 'hourly', 'unset'] as const;
export type Category = (typeof CATEGORIES)[number];
export const SHIFT_CATEGORIES: readonly Category[] = ['full_shift', 'part_shift'];

/** What a lesson is on the calendar (chat.calendar_status); `void` is never shown. */
export const STATUSES = ['active', 'trial', 'paused', 'moved'] as const;
export type CalendarStatus = (typeof STATUSES)[number];
/** Shown when no status is asked for: a moved-away lesson holds no time. */
export const DEFAULT_STATUSES: readonly CalendarStatus[] = ['active', 'trial', 'paused'];

export const KINDS = ['regular', 'makeup', 'trial'] as const;
export const UTILIZATION_BANDS = ['lt50', '50to80', 'gte80'] as const;
export type UtilizationBand = (typeof UTILIZATION_BANDS)[number];

/** Longest window /calendar and /calendar/stats answer: a month view and its edges. */
export const MAX_WINDOW_DAYS = 42;

export interface CalendarFilters {
  /** Viewer-zone days, [from, to). */
  from: string;
  to: string;
  teacherIds: string[] | null;
  categories: Category[] | null;
  /** Lessons of these supervisors' children; `withoutSupervisor` adds children with none. */
  supervisorIds: string[] | null;
  withoutSupervisor: boolean;
  learnerIds: string[] | null;
  statuses: CalendarStatus[] | null;
  kinds: string[] | null;
  /** ISO weekdays (1 = Monday) of the viewer's days: limits days, lessons and capacity alike. */
  weekdays: number[] | null;
  /** Minutes of the viewer's day: a lesson matches when it starts in [timeFrom, timeTo). */
  timeFrom: number | null;
  timeTo: number | null;
  utilization: UtilizationBand[] | null;
  emptyMinutesGte: number | null;
  /** With a lesson-level filter: hide teachers who have no matching lesson (default on). */
  onlyMatching: boolean;
}

type Query = Record<string, string | string[] | undefined>;

function invalid(reason: string) {
  return new CommError(CommErrorCode.VALIDATION, reason, 400);
}

function one(q: Query, key: string): string | undefined {
  const v = q[key];
  if (Array.isArray(v)) throw invalid(`${key}: give it once`);
  return v === undefined || v === '' ? undefined : v;
}

/** A comma-separated list, each item checked; absent or empty means "no filter". */
function list<T extends string>(q: Query, key: string, check: (v: string) => v is T, what: string, max = 200): T[] | null {
  const raw = one(q, key);
  if (raw === undefined) return null;
  const items = [...new Set(raw.split(',').map((s) => s.trim()).filter((s) => s.length > 0))];
  if (items.length === 0) return null;
  if (items.length > max) throw invalid(`${key}: at most ${max} values`);
  for (const v of items) if (!check(v)) throw invalid(`${key}: ${what}`);
  return items as T[];
}

const uuid = (v: string): v is string => isUuid(v);
const inSet = <T extends string>(set: readonly T[]) => (v: string): v is T => (set as readonly string[]).includes(v);

const DAY_RE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

export function dayField(v: string | undefined, key: string): string {
  if (v === undefined || !DAY_RE.test(v) || Number.isNaN(Date.parse(`${v}T00:00:00Z`))) {
    throw invalid(`${key}: a day, YYYY-MM-DD`);
  }
  // 2026-02-31 parses (it rolls over): compare back.
  if (new Date(`${v}T00:00:00Z`).toISOString().slice(0, 10) !== v) throw invalid(`${key}: a day, YYYY-MM-DD`);
  return v;
}

export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

/** "HH:MM" (or "24:00" for an end) to minutes of the day. */
export function clockField(v: string | undefined, key: string, allowEndOfDay = false): number | null {
  if (v === undefined) return null;
  if (allowEndOfDay && v === '24:00') return 1440;
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(v);
  if (!m) throw invalid(`${key}: HH:MM`);
  return Number(m[1]) * 60 + Number(m[2]);
}

export function parseFilters(q: Query, maxDays = MAX_WINDOW_DAYS): CalendarFilters {
  const from = dayField(one(q, 'from'), 'from');
  const to = dayField(one(q, 'to'), 'to');
  const span = daysBetween(from, to);
  if (span < 1 || span > maxDays) throw invalid(`from/to: a window of 1 to ${maxDays} days`);

  const supervisors = list(q, 'supervisorIds', (v): v is string => v === 'none' || isUuid(v), 'uuids, or none');
  const weekdays = list(q, 'weekdays', (v): v is string => /^[1-7]$/.test(v), 'ISO weekdays 1-7', 7);
  const timeFrom = clockField(one(q, 'timeFrom'), 'timeFrom');
  const timeTo = clockField(one(q, 'timeTo'), 'timeTo', true);
  if (timeFrom !== null && timeTo !== null && timeTo <= timeFrom) throw invalid('timeTo: after timeFrom');
  const emptyRaw = one(q, 'emptyMinutesGte');
  let emptyMinutesGte: number | null = null;
  if (emptyRaw !== undefined) {
    if (!/^\d{1,6}$/.test(emptyRaw)) throw invalid('emptyMinutesGte: whole minutes');
    emptyMinutesGte = Number(emptyRaw);
  }
  const onlyRaw = one(q, 'onlyMatching');
  if (onlyRaw !== undefined && onlyRaw !== 'true' && onlyRaw !== 'false') throw invalid('onlyMatching: true or false');

  return {
    from,
    to,
    teacherIds: list(q, 'teacherIds', uuid, 'uuids'),
    categories: list(q, 'categories', inSet(CATEGORIES), CATEGORIES.join(', ')),
    supervisorIds: supervisors?.filter((v) => v !== 'none') ?? null,
    withoutSupervisor: supervisors?.includes('none') ?? false,
    learnerIds: list(q, 'learnerIds', uuid, 'uuids'),
    statuses: list(q, 'statuses', inSet(STATUSES), STATUSES.join(', ')),
    kinds: list(q, 'kinds', inSet(KINDS), KINDS.join(', ')),
    weekdays: weekdays?.map(Number) ?? null,
    timeFrom,
    timeTo,
    utilization: list(q, 'utilization', inSet(UTILIZATION_BANDS), UTILIZATION_BANDS.join(', ')),
    emptyMinutesGte,
    onlyMatching: onlyRaw !== 'false',
  };
}

/** Does any lesson-level filter apply? Then non-matching lessons are "other bookings". */
export function hasLessonFilter(f: CalendarFilters): boolean {
  return (
    f.supervisorIds !== null || f.withoutSupervisor || f.learnerIds !== null || f.statuses !== null ||
    f.kinds !== null || f.timeFrom !== null || f.timeTo !== null
  );
}

/** in-shift booked / (shift - leave), or null for a teacher without a shift that period. */
export function utilization(t: { shiftMinutes: number; inShiftBookedMinutes: number; inShiftLeaveMinutes: number }): number | null {
  const base = t.shiftMinutes - t.inShiftLeaveMinutes;
  if (base <= 0) return null;
  return Math.round((t.inShiftBookedMinutes / base) * 1000) / 1000;
}
