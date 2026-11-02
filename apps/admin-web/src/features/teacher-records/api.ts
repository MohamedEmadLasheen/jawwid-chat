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
  /** PD-52 PR-5: `sales` records about its trials and families, never decides. */
  basis: 'super_admin' | 'teachers' | 'operations' | 'sales' | null
  attendance: { view: boolean; record: boolean; decide: boolean }
  grants: { view: boolean; record: boolean }
  /** A teacher's leave allowance and balance (never for Operations). */
  leaveBalance: boolean
  /** A grant's amount (payroll). */
  amounts: boolean
  /** The link to the Teacher File. */
  opensFile: boolean
}

/** Who a record is about: one student, or (PD-52 PR-5) one trial family. */
export type RecordAbout = { learnerId?: string; prospectId?: string }

/** The picker's value, `learner:<id>` or `prospect:<id>`, as the request's fields. */
export function aboutFields(value: string): RecordAbout {
  if (value.startsWith('learner:')) return { learnerId: value.slice('learner:'.length) }
  if (value.startsWith('prospect:')) return { prospectId: value.slice('prospect:'.length) }
  return {}
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
  /** Whether the caller may correct this testimonial (the recording department, the Operations Manager, the super admin). */
  canCorrect?: boolean
}

export interface TestimonialQuery {
  teacher?: string
  month?: string
  voided?: boolean
}

/**
 * One teacher's strip. Each section is null when the caller's key does not
 * cover it (review of #374): away, the ladder and open complaints are page
 * A's (attendance.view), grants and testimonials page B's (grants.view).
 */
export interface TeacherSummary {
  teacher: { id: string; name: string; isActive: boolean }
  away: { kind: 'leave' | 'suspended' | 'day_off'; until: string } | null
  /** Also null for Sales: the ladder is a supervision matter (PD-52 PR-5). */
  ladder: { month: string; counted: number; nextStep: string } | null
  openComplaints: number | null
  year: string
  grants: number | null
  testimonials: number | null
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
  recordTestimonial: (teacherId: string, body: { body: string; source: TestimonialSource } & RecordAbout) =>
    api.post<{ id: string; kind: string; createdAt: string }>(`/teachers/${encodeURIComponent(teacherId)}/testimonials`, body),
  /** A complaint (page A, decide) or testimonial (page B) entered by mistake: hidden, never deleted. */
  voidEntry: (entryId: string, reason: string) =>
    api.post<{ id: string; voids: string }>(`/teacher-records/entries/${encodeURIComponent(entryId)}/void`, { reason }),
  summary: (teacherId: string) => api.get<TeacherSummary>(`/teacher-records/teachers/${encodeURIComponent(teacherId)}/summary`),
  /** Who a record about this teacher may name: their students and (PD-52 PR-5) trial families. */
  students: (teacherId: string) =>
    api.get<{ students: Array<{ id: string; name: string; familyId: string }>; trials?: Array<{ id: string; name: string }> }>(
      `/teacher-records/teachers/${encodeURIComponent(teacherId)}/students`,
    ),
}

export const teacherRecordsKeys = {
  all: ['teacher-records'] as const,
  access: ['teacher-records', 'access'] as const,
  testimonials: (q: TestimonialQuery) => ['teacher-records', 'testimonials', q.teacher ?? 'all', q.month ?? 'all', q.voided ? 'voided' : 'live'] as const,
  summary: (teacherId: string) => ['teacher-records', 'summary', teacherId] as const,
  students: (teacherId: string) => ['teacher-records', 'students', teacherId] as const,
}
