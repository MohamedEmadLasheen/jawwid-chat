import { api } from '@/core/api/client'

/**
 * `/teacher-files/*` -- the PD-10 wire contract, mirrored from
 * apps/api/src/teacher-file/teacher-file.service.ts. Who may see or change
 * what is decided there; `access` tells the page which controls to offer, and
 * the server still answers every request on its own.
 */

export interface TeacherFileAccessFlags {
  canEditPersonal: boolean
  canWriteSupervision: boolean
}

export interface TeacherSummary {
  id: string
  name: string
  isActive: boolean
  studentCount: number
  openComplaints: number
}

export interface Person {
  id: string
  name: string
}

export interface EntryBrief {
  id: string
  body: string
  createdAt: string
  author: Person
}

export interface Complaint extends EntryBrief {
  source: { conversationId: string; messageId: string | null } | null
  resolution: EntryBrief | null
}

export interface MonthlyComment {
  /** YYYY-MM */
  month: string
  current: EntryBrief
  earlierVersions: EntryBrief[]
}

export interface DayOff extends EntryBrief {
  /** YYYY-MM-DD */
  date: string
  cancellation: EntryBrief | null
}

export interface TeacherFile {
  access: TeacherFileAccessFlags
  teacher: { id: string; name: string; isActive: boolean; leftAt: string | null }
  personal: {
    fullName: string
    phone: string | null
    email: string | null
    /** YYYY-MM-DD */
    joinedOn: string | null
    updatedAt: string | null
    updatedBy: Person | null
  }
  assignedStudents: Array<{
    learnerId: string
    name: string
    level: string | null
    family: { id: string; displayName: string }
    supervisor: Person | null
  }>
  supervision: {
    complaints: Complaint[]
    monthlyComments: MonthlyComment[]
    daysOff: DayOff[]
  }
}

/** A field left out is unchanged; null clears it. */
export interface PersonalPatch {
  phone?: string | null
  email?: string | null
  joinedOn?: string | null
  reason: string
}

export type NewEntry =
  | { kind: 'complaint'; body: string }
  | { kind: 'complaint_resolution'; body: string; refersTo: string }
  | { kind: 'monthly_comment'; body: string; month: string }
  | { kind: 'day_off'; body: string; dayOffOn: string }
  | { kind: 'day_off_cancellation'; body: string; refersTo: string }

export const teacherFileApi = {
  list: () => api.get<{ access: TeacherFileAccessFlags; teachers: TeacherSummary[] }>('/teacher-files'),
  detail: (teacherId: string) => api.get<TeacherFile>(`/teacher-files/${encodeURIComponent(teacherId)}`),
  updatePersonal: (teacherId: string, body: PersonalPatch) =>
    api.post<TeacherFile>(`/teacher-files/${encodeURIComponent(teacherId)}/personal`, body),
  addEntry: (teacherId: string, body: NewEntry) =>
    api.post<{ id: string; kind: string; createdAt: string }>(`/teacher-files/${encodeURIComponent(teacherId)}/entries`, body),
}

export const teacherFileKeys = {
  all: ['teacher-files'] as const,
  list: ['teacher-files', 'list'] as const,
  detail: (teacherId: string) => ['teacher-files', 'detail', teacherId] as const,
}
