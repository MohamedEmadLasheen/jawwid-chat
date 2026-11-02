import { api } from '@/core/api/client'
import type { Person } from '@/features/teacher-files/api'
import type { FeedbackStatus } from '@/features/teacher-supervision/api'

/**
 * PD-52: the teacher-records pages, mirrored from apps/api
 * (src/teacher-file/teacher-records.*, platform/teacher-records-policy.ts).
 * Page A is Attendance & Complaints, page B Grants & Testimonials. The access
 * answer is advisory: every route decides again.
 */
export interface TeacherRecordsAccess {
  basis: 'super_admin' | 'teachers' | 'operations' | null
  attendance: { view: boolean; record: boolean; decide: boolean }
  grants: { view: boolean; record: boolean }
  /** A teacher's leave allowance and balance (never for Operations). */
  leaveBalance: boolean
  /** A grant's amount (payroll). */
  amounts: boolean
  /** The link to the Teacher File. */
  opensFile: boolean
}

/** How a staff-recorded testimonial reached the academy; `parent_app` is a parent's own praise. */
export type TestimonialSource = 'parent_message' | 'parent_call' | 'staff_observation' | 'other'
export const TESTIMONIAL_SOURCES: readonly TestimonialSource[] = ['parent_message', 'parent_call', 'staff_observation', 'other']

export interface Testimonial {
  id: string
  /** `parent`: the parent's praise from the app, read in place (its id is the feedback's). */
  origin: 'staff' | 'parent'
  teacher: Person
  body: string
  createdAt: string
  source: TestimonialSource | 'parent_app' | null
  child: Person | null
  familyId: string | null
  prospect: Person | null
  /** Who recorded it (staff only). */
  author: Person | null
  /** Who wrote it (the parent's praise only), its status and the reply the parent reads. */
  parent: Person | null
  status: FeedbackStatus | null
  response: string | null
  /** Corrected: the reason, who and when. Shown only when asked for. */
  voided: { id: string; body: string; createdAt: string; author: Person | null } | null
}

export interface TestimonialQuery {
  teacher?: string
  month?: string
  voided?: boolean
}

export interface TeacherSummary {
  teacher: { id: string; name: string; isActive: boolean }
  away: { kind: 'leave' | 'suspended' | 'day_off'; until: string } | null
  ladder: { month: string; counted: number; nextStep: string }
  openComplaints: number
  year: string
  grants: number
  testimonials: number
  opensFile: boolean
}

export const teacherRecordsApi = {
  access: () => api.get<TeacherRecordsAccess>('/teacher-records/access'),
  testimonials: (q: TestimonialQuery = {}) => {
    const query: Record<string, string> = {}
    if (q.teacher) query.teacher = q.teacher
    if (q.month) query.month = q.month
    if (q.voided) query.voided = 'include'
    return api.get<{ canRecord: boolean; testimonials: Testimonial[] }>('/teacher-records/testimonials', Object.keys(query).length ? query : undefined)
  },
  recordTestimonial: (teacherId: string, body: { body: string; source: TestimonialSource; learnerId?: string }) =>
    api.post<{ id: string; kind: string; createdAt: string }>(`/teachers/${encodeURIComponent(teacherId)}/testimonials`, body),
  /** A complaint (page A, decide) or testimonial (page B) entered by mistake: hidden, never deleted. */
  voidEntry: (entryId: string, reason: string) =>
    api.post<{ id: string; voids: string }>(`/teacher-records/entries/${encodeURIComponent(entryId)}/void`, { reason }),
  summary: (teacherId: string) => api.get<TeacherSummary>(`/teacher-records/teachers/${encodeURIComponent(teacherId)}/summary`),
  students: (teacherId: string) =>
    api.get<{ students: Array<{ id: string; name: string; familyId: string }> }>(`/teacher-records/teachers/${encodeURIComponent(teacherId)}/students`),
}

export const teacherRecordsKeys = {
  all: ['teacher-records'] as const,
  access: ['teacher-records', 'access'] as const,
  testimonials: (q: TestimonialQuery) => ['teacher-records', 'testimonials', q.teacher ?? 'all', q.month ?? 'all', q.voided ? 'voided' : 'live'] as const,
  summary: (teacherId: string) => ['teacher-records', 'summary', teacherId] as const,
  students: (teacherId: string) => ['teacher-records', 'students', teacherId] as const,
}
