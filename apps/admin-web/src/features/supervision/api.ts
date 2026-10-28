import { api } from '@/core/api/client'

/**
 * PD-12 S1 wire contract -- teacher leave and the teacher supervision
 * conversation -- mirrored from src/teacher-file/leave.* and src/supervision.
 * (Student certificates moved to features/certificates, PD-41.) Who may do what is decided
 * there; these pages only offer the controls and show the server's answer.
 */

export interface Person {
  id: string
  name: string | null
}

export type LeaveState = 'requested' | 'approved' | 'declined' | 'withdrawn' | 'cancelled'

export interface LeaveRequest {
  id: string
  teacher: Person
  /** YYYY-MM-DD */
  firstDay: string
  lastDay: string
  days: number
  reason: string
  state: LeaveState
  requestedAt: string
  decidedAt: string | null
  decidedBy: Person | null
  decisionNote: string | null
  endedAt: string | null
  /**
   * Open requests only: the balance before approving, null while no allowance is
   * set. Absent for an Operations supervisor: the allowance is the Teachers department's.
   */
  balance?: number | null
  /** Open requests only: lessons approving would cancel. No name for a child of another family (Operations). */
  collidingLessons?: Array<{ id: string; startsAt: string; learnerName: string | null }>
}

/** The allowance, the balance and the history are absent for an Operations supervisor (PD-26 amendment). */
export interface TeacherLeave {
  year: number
  allowance?: number | null
  used?: number
  balance?: number | null
  requests: LeaveRequest[]
  allowanceHistory?: Array<{ days: number; note: string | null; setAt: string; setBy: Person }>
}

export interface ApproveBody {
  /** The days that consume the allowance; omitted = every day of the request. */
  days?: string[]
  note?: string
  cancelCollidingLessons?: boolean
}

const id = encodeURIComponent

export const supervisionApi = {

  leaveRequests: (state?: LeaveState) =>
    api.get<{ requests: LeaveRequest[] }>(`/teacher-leave-requests${state ? `?state=${state}` : ''}`),
  approveLeave: (requestId: string, body: ApproveBody) =>
    api.post<{ request: LeaveRequest; cancelledLessons: number; notCancelled: Array<{ lessonId: string; reason: string }> }>(
      `/teacher-leave-requests/${id(requestId)}/approve`,
      body,
    ),
  declineLeave: (requestId: string, note: string) =>
    api.post<{ request: LeaveRequest }>(`/teacher-leave-requests/${id(requestId)}/decline`, { note }),
  cancelLeave: (requestId: string, note: string) =>
    api.post<{ request: LeaveRequest; daysReturned: number }>(`/teacher-leave-requests/${id(requestId)}/cancel`, { note }),
  teacherLeave: (teacherId: string, year?: number) =>
    api.get<TeacherLeave>(`/teacher-files/${id(teacherId)}/leave${year ? `?year=${year}` : ''}`),
  setAllowance: (teacherId: string, body: { year: number; days: number; note?: string }) =>
    api.post<TeacherLeave>(`/teacher-files/${id(teacherId)}/leave-allowance`, body),

  openSupervision: (teacherId: string) =>
    api.post<{ conversationId: string }>(`/teachers/${id(teacherId)}/supervision-conversation`, {}),
}

export const supervisionKeys = {
  leave: (state?: LeaveState) => ['teacher-leave-requests', state ?? 'all'] as const,
  allLeave: ['teacher-leave-requests'] as const,
  teacherLeave: (teacherId: string, year?: number) => ['teacher-leave', teacherId, year ?? 'current'] as const,
  allTeacherLeave: ['teacher-leave'] as const,
}
