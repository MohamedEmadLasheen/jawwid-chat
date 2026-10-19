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

export interface TeacherRow {
  teacher: { id: string; name: string; isActive: boolean }
  held: Bucket
  scheduled: Bucket
  notHeld: Bucket
  unreported: Bucket
  upcoming: Bucket
  attendanceRate: number | null
  reportsOnTimeRate: number | null
}

export interface TeacherDetail {
  teacher: { id: string; name: string }
  month: string
  zone: string
  categories: CategoryStats[]
  totals: { counted: Bucket; scheduledMinutes: number }
  makeups: { lessons: number; held: number }
  trials: { lessons: number; attended: number; converted: number; available: boolean }
  rates: { attendance: number | null; completion: number | null; teacherReliability: number | null }
  reports: { reports: number; onTime: number; onTimeRate: number | null; medianDelayMinutes: number | null }
  replies: { familyMessages: number; answeredWithin: number; rate: number | null; medianReplyMinutes: number | null }
  workload: { availableMinutes: number | null; scheduledMinutes: number; freeMinutes: number | null }
  movements?: { transfersIn: number; transfersOut: number; paused: number; stopped: number }
  previous: { month: string; held: Bucket }
}

export const statsApi = {
  access: () => api.get<{ lessonManager: boolean }>('/lessons/access'),
  teachers: (month: string) => api.get<{ month: string; zone: string; teachers: TeacherRow[] }>('/stats/teachers', { month }),
  teacher: (id: string, month: string) =>
    api.get<TeacherDetail>(`/stats/teachers/${encodeURIComponent(id)}`, { month }),
}

export const statsKeys = {
  access: ['lessons', 'access'] as const,
  teachers: (month: string) => ['stats', 'teachers', month] as const,
  teacher: (id: string, month: string) => ['stats', 'teacher', id, month] as const,
}
