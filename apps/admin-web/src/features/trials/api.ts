import { api } from '@/core/api/client'

/**
 * PD-11 T4 -- trial lessons and the New Students page, mirrored from
 * apps/api/src/lessons/trial.service.ts. Sales records prospects, books trials
 * and records the subscription decision; the trial's teacher records
 * attendance (in the app); Operations works the New Students page. The server
 * decides who may do what -- these pages only offer the controls.
 */

export interface ProspectDto {
  id: string
  displayName: string
  level: string | null
  note: string | null
  learnerId?: string | null
  createdAt: string
}

export type TrialAttendance = 'upcoming' | 'awaiting' | 'attended' | 'no_show' | 'admin_cancelled' | string
export type TrialConversion = 'pending' | 'awaiting_core' | 'confirmed' | 'not_subscribed' | null
export type NotSubscribedReason = 'price' | 'schedule' | 'not_ready' | 'chose_other' | 'no_response' | 'other'

export interface TrialDto {
  id: string
  prospect: { id: string; displayName: string; level: string | null }
  teacher: { id: string; name: string }
  startsAt: string
  endsAt: string
  durationMinutes: number
  attendance: TrialAttendance
  report: { covered: string; rating: number | null; note: string | null } | null
  conversion: TrialConversion
  conversionDetail?: { reason: NotSubscribedReason | null; note: string | null; recordedAt: string; confirmedAt: string | null }
}

export interface NewStudentDto {
  lessonId: string
  prospect: { id: string; displayName: string }
  learnerId: string | null
  teacher: { id: string; name: string }
  trialAt: string
  recordedAt: string
  confirmedAt: string | null
}

const id = (v: string) => encodeURIComponent(v)

export const trialsApi = {
  prospects: () => api.get<{ prospects: ProspectDto[] }>('/trials/prospects'),
  createProspect: (body: { displayName: string; level?: string; note?: string }) => api.post<ProspectDto>('/trials/prospects', body),
  teachers: () => api.get<{ teachers: Array<{ id: string; name: string }> }>('/trials/teachers'),
  slots: (teacherId: string, durationMinutes: number) =>
    api.get<{ teacherId: string; durationMinutes: number; slots: string[] }>('/trials/slots', { teacherId, durationMinutes: String(durationMinutes) }),
  list: (query: { from?: string; to?: string; teacherId?: string } = {}) => api.get<{ trials: TrialDto[] }>('/trials', query),
  book: (body: { prospectId: string; teacherId: string; startsAt: string; durationMinutes: number }) => api.post<TrialDto>('/trials', body),
  absence: (trialId: string, note?: string) => api.post<TrialDto>(`/trials/${id(trialId)}/attendance`, note ? { attended: false, note } : { attended: false }),
  cancel: (trialId: string, reason: string) => api.post<TrialDto>(`/trials/${id(trialId)}/cancel`, { reason }),
  outcome: (trialId: string, body: { result: 'subscribed' | 'not_subscribed'; reason?: NotSubscribedReason; note?: string }) =>
    api.post<TrialDto>(`/trials/${id(trialId)}/outcome`, body),
  /** The teacher's trial group (created if needed): Sales and the Teachers department talk to the teacher there. */
  openGroup: (teacherId: string) => api.post<{ conversationId: string }>(`/trials/teachers/${id(teacherId)}/group`),
  newStudents: () => api.get<{
      readyForSetup: NewStudentDto[]
      /** Confirmed by Core; the student is not in Chat yet and links itself when they arrive. */
      awaitingStudent?: NewStudentDto[]
      awaitingCore: NewStudentDto[]
    }>('/trials/new-students'),
}

export const trialKeys = {
  all: ['trials'] as const,
  list: ['trials', 'list'] as const,
  prospects: ['trials', 'prospects'] as const,
  teachers: ['trials', 'teachers'] as const,
  slots: (teacherId: string, duration: number) => ['trials', 'slots', teacherId, duration] as const,
  newStudents: ['trials', 'new-students'] as const,
}
