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

/**
 * PD-11's supervision timeline (`GET /teachers/:id/supervision`): a QUERY over
 * the records that already exist -- entries, decided rulings, lessons the
 * teacher did not give, transfers, days off -- newest first. Nothing in it is
 * stored twice. Mirrored from apps/api/src/lessons/supervision.service.ts.
 */
export type TimelineType =
  | 'bonus'
  | 'complaint'
  | 'complaint_resolution'
  | 'monthly_comment'
  | 'note'
  | 'late_apology'
  | 'makeup_followup'
  | 'teacher_apology'
  | 'teacher_no_show'
  | 'transfer_in'
  | 'transfer_out'
  | 'day_off'

export interface TimelineItem {
  id: string
  type: TimelineType | string
  at: string
  body?: string | null
  /** monthly_comment: YYYY-MM */
  period?: string | null
  /** day_off: YYYY-MM-DD */
  day?: string
  decision?: string | null
  reason?: string | null
  lesson?: { id: string; startsAt: string; learnerName: string }
  learner?: { id: string; name: string }
  by?: string | null
  byName?: string | null
}

export const supervisionTimelineApi = {
  timeline: (teacherId: string) =>
    api.get<{ teacher: { id: string; name: string }; items: TimelineItem[] }>(`/teachers/${encodeURIComponent(teacherId)}/supervision`),
  /** A free note on the timeline (complaints and monthly comments have their own sections). */
  addNote: (teacherId: string, body: string) =>
    api.post<{ id: string; kind: string }>(`/teachers/${encodeURIComponent(teacherId)}/supervision`, { kind: 'note', body }),
  /** The bonus ticket: a `bonus` entry and a card in the teacher's supervision chat. No amount -- payroll's. */
  bonus: (teacherId: string, reason: string) =>
    api.post<{ id: string; kind: string; conversationId: string }>(`/teachers/${encodeURIComponent(teacherId)}/bonus`, { reason }),
}

export const timelineKeys = {
  timeline: (teacherId: string) => ['teacher-files', 'timeline', teacherId] as const,
}
