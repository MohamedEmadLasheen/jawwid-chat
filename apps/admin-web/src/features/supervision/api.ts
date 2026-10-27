import { api } from '@/core/api/client'

/**
 * PD-12 S1 wire contract -- student certificates, teacher leave and the teacher
 * supervision conversation -- mirrored from apps/api/src/certificates,
 * src/teacher-file/leave.* and src/supervision. Who may do what is decided
 * there; these pages only offer the controls and show the server's answer.
 */

export interface Person {
  id: string
  name: string | null
}

export type CertificateState = 'requested' | 'issued' | 'declined'

export interface Certificate {
  id: string
  state: CertificateState
  learner: { id: string; name: string }
  teacher: { id: string; name: string }
  title: string
  achievement: string
  /** YYYY-MM-DD */
  achievedOn: string
  grade: string | null
  printedName: string
  note: string | null
  requestedAt: string
  decidedAt: string | null
  declineReason: string | null
  fileName: string | null
  /** The group it was delivered into, once issued. */
  deliveredTo: string | null
  /** Requested only: whether the learner has a live group to deliver into now. */
  canDeliver: boolean | null
}

export interface UploadGrant {
  objectKey: string
  uploadUrl: string
  method: 'PUT'
  headers: Record<string, string>
  expiresAt: string
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
  certificates: (state?: CertificateState) =>
    api.get<{ certificates: Certificate[] }>(`/learner-certificates${state ? `?state=${state}` : ''}`),
  authorizeCertificateUpload: (certificateId: string, mimeType: string, byteSize: number) =>
    api.post<{ upload: UploadGrant; conversationId: string }>(`/learner-certificates/${id(certificateId)}/upload`, { mimeType, byteSize }),
  issueCertificate: (certificateId: string, body: { objectKey: string; mimeType: string; byteSize: number; fileName: string }) =>
    api.post<{ certificate: Certificate }>(`/learner-certificates/${id(certificateId)}/issue`, body),
  declineCertificate: (certificateId: string, reason: string) =>
    api.post<{ certificate: Certificate }>(`/learner-certificates/${id(certificateId)}/decline`, { reason }),

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
  certificates: (state?: CertificateState) => ['learner-certificates', state ?? 'all'] as const,
  allCertificates: ['learner-certificates'] as const,
  leave: (state?: LeaveState) => ['teacher-leave-requests', state ?? 'all'] as const,
  allLeave: ['teacher-leave-requests'] as const,
  teacherLeave: (teacherId: string, year?: number) => ['teacher-leave', teacherId, year ?? 'current'] as const,
  allTeacherLeave: ['teacher-leave'] as const,
}

/**
 * Upload a finished certificate straight to storage on the signed URL. The
 * server chose the key -- inside the learner's group -- and reads the bytes back
 * before it issues anything.
 */
export async function uploadCertificateFile(certificateId: string, file: File): Promise<{ objectKey: string }> {
  const { upload } = await supervisionApi.authorizeCertificateUpload(certificateId, file.type, file.size)
  const response = await fetch(upload.uploadUrl, {
    method: upload.method,
    // content-length is set by the browser from the body; it is a forbidden header.
    headers: Object.fromEntries(Object.entries(upload.headers).filter(([k]) => k.toLowerCase() !== 'content-length')),
    body: file,
    credentials: 'omit',
  })
  if (!response.ok) throw new Error(`upload failed with ${response.status}`)
  return { objectKey: upload.objectKey }
}

/** The types the server accepts, so the picker never offers what will be refused. */
export const CERTIFICATE_ACCEPT = 'application/pdf,image/jpeg,image/png,image/webp'
export const MAX_CERTIFICATE_BYTES = 20 * 1024 * 1024
