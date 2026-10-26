import { api } from '@/core/api/client'

/**
 * `/stats/*` and `/lessons/access` -- the PD-11 T5 wire contract, mirrored from
 * apps/api/src/lessons/stats.service.ts. Every number is computed by the server
 * from the lesson rows (one definition per number); this page only lays them out.
 */

export interface Bucket {
  lessons: number
  minutes: number
}

export type StatCategory =
  | 'held'
  | 'upcoming'
  | 'unreported'
  | 'student_apology'
  | 'teacher_apology'
  | 'student_no_show'
  | 'teacher_no_show'
  | 'admin_cancelled'
  | 'rescheduled'
  | 'suspended'

export interface CategoryStats extends Bucket {
  key: StatCategory
  /** Counted for or against someone. Moved and paused lessons are information only. */
  counted: boolean
  byDuration: Array<{ durationMinutes: number } & Bucket>
}

/** PD-15: StatsService.monthSummary -- every lesson of the month in exactly one line. */
export interface MonthSummary {
  totalScheduled: number
  conducted: number
  studentAttended: number
  studentNoShow: number
  studentExcuses: { total: number; beforeStart: number; afterStart: number }
  teacherExcuses: number
  teacherNoShow: number
  cancelled: number
  pending: { total: number; upcoming: number; awaitingReport: number }
  completed: { regular: number; makeup: number; total: number }
  makeups: { completed: number; scheduled: number; total: number }
}

/**
 * A teacher's trials of the month, each counted once by its one outcome,
 * from Chat's records only. total = subscribed + notSubscribed + noShow +
 * awaiting; upcoming and cancelled are outside the total.
 */
export interface TrialStats {
  total: number
  conducted: number
  subscribed: number
  notSubscribed: number
  noShow: number
  awaiting: number
  upcoming: number
  cancelled: number
  /** Of the trials with a decision; null when there is none. */
  conversionRate: number | null
}

export interface TeacherRow {
  teacher: { id: string; name: string; isActive: boolean }
  held: Bucket
  scheduled: Bucket
  notHeld: Bucket
  unreported: Bucket
  upcoming: Bucket
  attendanceRate: number | null
  reportsOnTimeRate: number | null
  trials: TrialStats
  summary?: MonthSummary
  /** PD-31: lessons the teacher moved this month. Information, NOT a violation. */
  movesByTeacher?: number
}

export interface TeacherDetail {
  teacher: { id: string; name: string }
  month: string
  zone: string
  categories: CategoryStats[]
  summary?: MonthSummary
  totals: { counted: Bucket; scheduledMinutes: number }
  makeups: { lessons: number; held: number }
  trials: TrialStats
  rates: { attendance: number | null; completion: number | null; teacherReliability: number | null }
  reports: { reports: number; onTime: number; onTimeRate: number | null; medianDelayMinutes: number | null }
  replies: { familyMessages: number; answeredWithin: number; rate: number | null; medianReplyMinutes: number | null }
  /**
   * PD-38: one partition of the working hours --
   * available = bookedWithin + pausedWithin + free; outside = booked time beyond them.
   * scheduledMinutes counts every lesson (outside the hours too). Newer fields are
   * optional for an older server.
   */
  workload: {
    availableMinutes: number | null
    scheduledMinutes: number
    freeMinutes: number | null
    bookedWithinMinutes?: number | null
    pausedWithinMinutes?: number | null
    outsideMinutes?: number | null
  }
  movements?: { transfersIn: number; transfersOut: number; paused: number; stopped: number }
  previous: { month: string; held: Bucket }
  /** PD-31: lessons the teacher moved this month. Information, NOT a violation. */
  movesByTeacher?: number
}

export const statsApi = {
  /** `sales` / `operations`: PD-11 T4's Trials and New Students pages; `calendar`: PD-38's schedule (optional: older servers omit them). */
  access: () => api.get<{ lessonManager: boolean; sales?: boolean; operations?: boolean; calendar?: boolean }>('/lessons/access'),
  teachers: (month: string) => api.get<{ month: string; zone: string; teachers: TeacherRow[] }>('/stats/teachers', { month }),
  teacher: (id: string, month: string) =>
    api.get<TeacherDetail>(`/stats/teachers/${encodeURIComponent(id)}`, { month }),
}

export const statsKeys = {
  access: ['lessons', 'access'] as const,
  teachers: (month: string) => ['stats', 'teachers', month] as const,
  teacher: (id: string, month: string) => ['stats', 'teacher', id, month] as const,
}
