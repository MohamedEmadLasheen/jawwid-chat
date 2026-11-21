import { api } from '@/core/api/client'

/**
 * PD-60 wire contract, mirrored from apps/api/src/lessons/student-directory.service.ts
 * (GET /learners). Essential facts only: the API sends no contact details.
 */
export type StudentStatus = 'active' | 'paused' | 'stopped'

export interface StudentRow {
  id: string
  name: string
  family: { id: string; displayName: string }
  teacher: { id: string; name: string } | null
  supervisor: { id: string; name: string } | null
  status: StudentStatus
  /** The day a pause ends, when paused. */
  returnOn: string | null
  /** Regular weekly lesson times. */
  weeklySlots: number
}

export interface StudentList {
  page: number
  limit: number
  total: number
  students: StudentRow[]
  filters: { teachers: Array<{ id: string; name: string }>; supervisors: Array<{ id: string; name: string }> }
}

export interface StudentQuery {
  q: string
  /** A teacher id, 'none', or '' for all. */
  teacher: string
  supervisor: string
  status: StudentStatus | ''
  page: number
}

export const STUDENTS_PAGE_SIZE = 25

export const studentsApi = {
  list: (f: StudentQuery) =>
    api.get<StudentList>('/learners', {
      q: f.q || undefined,
      teacher: f.teacher || undefined,
      supervisor: f.supervisor || undefined,
      status: f.status || undefined,
      page: f.page,
      limit: STUDENTS_PAGE_SIZE,
    }),
}

export const studentKeys = {
  list: (f: StudentQuery) => ['pd60-students', 'list', f] as const,
}
