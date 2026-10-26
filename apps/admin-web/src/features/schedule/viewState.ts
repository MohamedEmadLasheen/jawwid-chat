import { isoToAcademyWallClock } from '@/core/time/academyTime'
import type { CalendarQuery } from './api'

/**
 * PD-38: what the schedule shows, held in the URL so a filtered view can be
 * shared and survives a reload. Pure -- every rule here is unit-tested.
 *
 * Days are the academy's calendar days ("2026-10-26"), never the browser's
 * (PD-22). The week runs Saturday to Friday, as the academy's working week
 * (Saturday-Thursday) does.
 */

export type View = 'day' | 'week' | 'month'
export const VIEWS: readonly View[] = ['day', 'week', 'month']

/** The filters, by the API's own query names (apps/api/src/calendar/calendar-filters.ts). */
export const LIST_FILTERS = [
  'teacherIds', 'categories', 'supervisorIds', 'learnerIds', 'statuses', 'kinds', 'weekdays', 'utilization',
] as const
export type ListFilter = (typeof LIST_FILTERS)[number]
export const SCALAR_FILTERS = ['timeFrom', 'timeTo', 'emptyMinutesGte', 'onlyMatching'] as const
export type ScalarFilter = (typeof SCALAR_FILTERS)[number]

export interface ViewState {
  view: View
  /** The day the view is anchored on. */
  date: string
  lists: Record<ListFilter, string[]>
  scalars: Partial<Record<ScalarFilter, string>>
}

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/

export function academyToday(now: Date = new Date()): string {
  return isoToAcademyWallClock(now.toISOString()).date
}

export function addDays(day: string, n: number): string {
  const d = new Date(`${day}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

/** ISO weekday of a calendar day: 1 = Monday ... 7 = Sunday. */
export function isoWeekday(day: string): number {
  const d = new Date(`${day}T00:00:00Z`).getUTCDay()
  return d === 0 ? 7 : d
}

/** The Saturday that starts the day's week. */
export function weekStart(day: string): string {
  return addDays(day, -((isoWeekday(day) + 1) % 7))
}

export function monthStart(day: string): string {
  return `${day.slice(0, 7)}-01`
}

function addMonths(day: string, n: number): string {
  const d = new Date(`${monthStart(day)}T00:00:00Z`)
  d.setUTCMonth(d.getUTCMonth() + n)
  return d.toISOString().slice(0, 10)
}

/** The view's days, [from, to). */
export function rangeFor(view: View, date: string): { from: string; to: string } {
  if (view === 'day') return { from: date, to: addDays(date, 1) }
  if (view === 'week') {
    const from = weekStart(date)
    return { from, to: addDays(from, 7) }
  }
  return { from: monthStart(date), to: addMonths(date, 1) }
}

/** Every day of [from, to). */
export function daysOf(from: string, to: string): string[] {
  const out: string[] = []
  for (let d = from; d < to; d = addDays(d, 1)) out.push(d)
  return out
}

/** Previous / next day, week or month. */
export function step(view: View, date: string, dir: -1 | 1): string {
  if (view === 'day') return addDays(date, dir)
  if (view === 'week') return addDays(date, 7 * dir)
  return addMonths(date, dir)
}

export function parseViewState(params: URLSearchParams, today: string): ViewState {
  const v = params.get('view')
  const d = params.get('date')
  const lists = Object.fromEntries(
    LIST_FILTERS.map((k) => [k, (params.get(k) ?? '').split(',').map((s) => s.trim()).filter(Boolean)]),
  ) as Record<ListFilter, string[]>
  const scalars: Partial<Record<ScalarFilter, string>> = {}
  for (const k of SCALAR_FILTERS) {
    const value = params.get(k)
    if (value) scalars[k] = value
  }
  return {
    view: VIEWS.includes(v as View) ? (v as View) : 'week',
    date: d && DAY_RE.test(d) ? d : today,
    lists,
    scalars,
  }
}

/** The state as URL parameters: only what differs from "nothing filtered". */
export function toParams(s: ViewState): URLSearchParams {
  const p = new URLSearchParams()
  p.set('view', s.view)
  p.set('date', s.date)
  for (const k of LIST_FILTERS) if (s.lists[k].length > 0) p.set(k, s.lists[k].join(','))
  for (const k of SCALAR_FILTERS) if (s.scalars[k]) p.set(k, s.scalars[k] as string)
  return p
}

/** The API query for the view: the range plus every filter set. */
export function apiQuery(s: ViewState): CalendarQuery {
  const q: CalendarQuery = { ...rangeFor(s.view, s.date) }
  for (const k of LIST_FILTERS) if (s.lists[k].length > 0) q[k] = s.lists[k].join(',')
  for (const k of SCALAR_FILTERS) if (s.scalars[k]) q[k] = s.scalars[k] as string
  return q
}

export function activeFilterCount(s: ViewState): number {
  return LIST_FILTERS.filter((k) => s.lists[k].length > 0).length +
    SCALAR_FILTERS.filter((k) => k !== 'onlyMatching' && s.scalars[k]).length
}

export function clearFilters(s: ViewState): ViewState {
  return { ...s, lists: Object.fromEntries(LIST_FILTERS.map((k) => [k, []])) as unknown as Record<ListFilter, string[]>, scalars: {} }
}

/** Minutes since the academy day's midnight of an instant, on `day` (clamped to it). */
export function minuteOfDay(iso: string, day: string): number {
  const { date, time } = isoToAcademyWallClock(iso)
  if (date < day) return 0
  if (date > day) return 1440
  return Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5))
}
