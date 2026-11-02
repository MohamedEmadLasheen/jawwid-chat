import { api } from '@/core/api/client'

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

export const teacherRecordsApi = {
  access: () => api.get<TeacherRecordsAccess>('/teacher-records/access'),
}

export const teacherRecordsKeys = {
  all: ['teacher-records'] as const,
  access: ['teacher-records', 'access'] as const,
}
