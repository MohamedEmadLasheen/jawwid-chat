import { api } from '@/core/api/client'

/**
 * PD-38 `/calendar/*`, `/teachers/:id/work-pattern` and
 * `/org/staff/:id/calendar-color` -- mirrored from apps/api/src/calendar. Every
 * number (shift, booked, empty, utilization...) is computed by the server from
 * one SQL definition; this feature only lays them out.
 */

export type Category = 'full_shift' | 'part_shift' | 'hourly' | 'unset'
export type CalendarStatus = 'active' | 'trial' | 'paused' | 'moved'
export type LessonKind = 'regular' | 'makeup' | 'trial'
/** [from, to) instants. */
export type Interval = [string, string]

export interface Totals {
  shiftMinutes: number
  workMinutes: number
  leaveMinutes: number
  bookedMinutes: number
  pausedMinutes: number
  inShiftBookedMinutes: number
  inShiftPausedMinutes: number
  inShiftLeaveMinutes: number
  emptyMinutes: number
  freeMinutes: number
  outsideMinutes: number
}

export interface CalendarTeacher {
  id: string
  name: string
  isActive: boolean
  category: Category
  zone: string | null
  lessons: number
  matching: number
  totals: Totals
  utilization: number | null
}

export interface CalendarDay {
  teacherId: string
  day: string
  shift: Interval[]
  work: Interval[]
  leave: Interval[]
  empty: Interval[]
  free: Interval[]
}

interface LessonBase {
  id: string
  teacherId: string
  startsAt: string
  endsAt: string
  kind: LessonKind
  status: CalendarStatus
  colorKey: string | null
  matches: boolean
  outsideShift: boolean
}

/** A lesson the viewer may name -- or, for an Operations supervisor, another supervisor's child: time and color only. */
export type CalendarLesson =
  | (LessonBase & {
      anonymous?: undefined
      learner: { id: string; name: string } | null
      prospect: { name: string } | null
      outcome: string | null
      suspendedFor: 'payment' | null
      movedFrom: string | null
    })
  | (LessonBase & { anonymous: true })

export interface CalendarWindow {
  zone: string
  from: string
  to: string
  lessonFilter: boolean
  teachers: CalendarTeacher[]
  days: CalendarDay[]
  lessons: CalendarLesson[]
}

export interface SummaryCell extends Totals {
  teacherId: string
  day: string
  lessons: number
  matching: number
  utilization: number | null
}

export interface CalendarSummary {
  zone: string
  from: string
  to: string
  lessonFilter: boolean
  teachers: CalendarTeacher[]
  cells: SummaryCell[]
}

export interface CalendarStats {
  zone: string
  from: string
  to: string
  lessonFilter: boolean
  teaching: { lessons: number; bookedMinutes: number; heldMinutes: number }
  students: { distinct: number; trial: number; paused: number }
  capacity: {
    shiftMinutes: number
    inShiftBookedMinutes: number
    inShiftPausedMinutes: number
    inShiftLeaveMinutes: number
    emptyMinutes: number
    outsideMinutes: number
    workMinutes: number
    freeMinutes: number
    utilization: number | null
  }
  teachers: CalendarTeacher[]
}

export interface Supervisor {
  id: string
  name: string
  role: 'manager' | 'supervisor' | 'backup_supervisor'
  colorKey: string | null
}

export interface CalendarOptions {
  zone: string
  viewer: { staffId: string; scope: 'academy' | 'supervisor'; canEditShifts: boolean; canEditColors: boolean }
  palette: string[]
  teachers: Array<{ id: string; name: string; isActive: boolean; category: Category; timezone: string | null }>
  supervisors: Supervisor[]
  learners: Array<{ id: string; name: string; teacherId: string | null }>
}

export interface ShiftWindow {
  weekday: number
  start: string
  end: string
}

export interface WorkPattern {
  id: string
  category: Exclude<Category, 'unset'>
  timezone: string
  validFrom: string
  validTo: string | null
  reason: string | null
  createdAt: string
  windows: ShiftWindow[]
}

export interface ShiftDefault {
  start: string
  end: string
  weekdays: number[]
}

export interface WorkPatterns {
  teacherId: string
  /** The earliest day a change may start: today on the academy's calendar. */
  today: string
  patterns: WorkPattern[]
  defaults: { full_shift: ShiftDefault; part_shift: ShiftDefault }
}

export interface SetWorkPattern {
  category: Exclude<Category, 'unset'>
  timezone: string
  validFrom: string
  windows?: ShiftWindow[]
  reason?: string
  applyToAvailability?: boolean
}

/** The query string every read takes: from/to days plus the filters (calendar-filters.ts). */
export type CalendarQuery = Record<string, string>

export const calendarApi = {
  options: () => api.get<CalendarOptions>('/calendar/options'),
  window: (q: CalendarQuery) => api.get<CalendarWindow>('/calendar', q),
  summary: (q: CalendarQuery) => api.get<CalendarSummary>('/calendar/summary', q),
  stats: (q: CalendarQuery) => api.get<CalendarStats>('/calendar/stats', q),
  patterns: (teacherId: string) => api.get<WorkPatterns>(`/teachers/${encodeURIComponent(teacherId)}/work-pattern`),
  setPattern: (teacherId: string, body: SetWorkPattern) =>
    api.post<WorkPatterns>(`/teachers/${encodeURIComponent(teacherId)}/work-pattern`, body),
  setColor: (staffId: string, colorKey: string | null) =>
    api.post<Supervisor>(`/org/staff/${encodeURIComponent(staffId)}/calendar-color`, { colorKey }),
}

export const calendarKeys = {
  all: ['calendar'] as const,
  options: ['calendar', 'options'] as const,
  window: (q: CalendarQuery) => ['calendar', 'window', q] as const,
  summary: (q: CalendarQuery) => ['calendar', 'summary', q] as const,
  stats: (q: CalendarQuery) => ['calendar', 'stats', q] as const,
  patterns: (teacherId: string) => ['calendar', 'patterns', teacherId] as const,
}
