import { api } from '@/core/api/client'

/**
 * The supervisors' day-to-day lesson operations -- PD-11 T1-T3's wire contract,
 * mirrored from apps/api/src/lessons/{lesson,scheduling,lifecycle}.service.ts.
 * Who may do what, and whether the lesson's state and the clock allow it, is
 * decided there and by the database; these pages offer the controls and show
 * the server's answer.
 */

export interface LessonDto {
  id: string
  learner: { id: string; name: string }
  teacher: { id: string; name: string }
  kind: 'regular' | 'makeup'
  makeupFor: string | null
  startsAt: string
  endsAt: string
  durationMinutes: number
  phase: 'upcoming' | 'in_progress' | 'awaiting_close' | 'overdue' | 'closed'
  outcome: string | null
  outcomeNote: string | null
}

export interface RulingDto {
  id: string
  kind: string
  reason: string
  openedAt: string
  decision: string | null
  lesson: LessonDto
}

export interface ScheduleRequestDto {
  id: string
  learner: { id: string; name: string }
  slots: Array<{ weekday: number; start: string }>
  note: string | null
  createdAt: string
}

export interface NeedsAction {
  overdue: LessonDto[]
  awaitingClose: LessonDto[]
  rulings: RulingDto[]
  makeupsOverdue: LessonDto[]
  returningSoon: Array<{ suspensionId: string; learner: { id: string; name: string }; returnOn: string }>
  scheduleRequests: ScheduleRequestDto[]
}

export interface WeeklySlot {
  weekday: number
  start: string
  durationMinutes: number
}

export interface Roster {
  teachers: Array<{ id: string; name: string; isActive: boolean; timezone: string | null }>
  learners: Array<{
    id: string
    name: string
    family: { id: string; displayName: string }
    teacherId: string | null
    slots: WeeklySlot[]
    suspension: { id: string; kind: 'temporary' | 'permanent'; returnOn: string | null } | null
  }>
}

export interface Availability {
  teacherId: string
  timezone: string | null
  windows: Array<{ weekday: number; start: string; end: string }>
  daysOff: Array<{ date: string; reason: string | null }>
}

export interface SuspensionDto {
  id: string
  learner: { id: string; name: string }
  kind: 'temporary' | 'permanent'
  reason: string
  note: string | null
  startsOn: string
  returnOn: string | null
  status: 'active' | 'ended'
  family: { id: string; displayName: string } | null
  teacher: { id: string; name: string } | null
  packageBalance: number | null
}

export type MakeupAction = 'substitute_teacher' | 'family_credit' | 'package_extension' | 'waived'
export type TransferReason = 'family_request' | 'teacher_request' | 'schedule_fit' | 'level_fit' | 'quality' | 'teacher_leaving' | 'other'
export type SuspensionReason =
  | 'travel' | 'exams' | 'health' | 'holiday' | 'financial' | 'schedule' | 'quality' | 'finished' | 'moved_elsewhere' | 'other'

const id = (v: string) => encodeURIComponent(v)

export const opsApi = {
  needsAction: () => api.get<NeedsAction>('/lessons/needs-action'),
  roster: () => api.get<Roster>('/lessons/roster'),
  lessons: (query: { learnerId?: string; teacherId?: string; from?: string; to?: string }) =>
    api.get<{ lessons: LessonDto[] }>('/lessons', query),

  // Closing a lesson the teacher did not
  absence: (lessonId: string, note?: string) => api.post<LessonDto>(`/lessons/${id(lessonId)}/absence`, note ? { note } : {}),
  teacherNoShow: (lessonId: string, note: string) => api.post<LessonDto>(`/lessons/${id(lessonId)}/teacher-no-show`, { note }),
  cancel: (lessonId: string, reason: string) => api.post<LessonDto>(`/lessons/${id(lessonId)}/cancel`, { reason }),
  decideRuling: (rulingId: string, body: { decision: 'excused' | 'teacher_credited'; note?: string }) =>
    api.post<LessonDto>(`/lesson-rulings/${id(rulingId)}/decide`, body),
  resolveMakeup: (lessonId: string, body: { action: MakeupAction; note?: string }) =>
    api.post<LessonDto>(`/lessons/${id(lessonId)}/makeup-resolution`, body),
  decideScheduleRequest: (requestId: string, body: { decision: 'approved' | 'rejected'; note?: string }) =>
    api.post<{ id: string; status: string }>(`/schedule-change-requests/${id(requestId)}/decide`, body),

  // Scheduling
  schedule: (body: { learnerId: string; startsAt: string; endsAt: string }) => api.post<LessonDto>('/lessons', body),
  availability: (teacherId: string) => api.get<Availability>(`/teachers/${id(teacherId)}/availability`),
  setAvailability: (teacherId: string, body: { timezone: string; windows: Availability['windows'] }) =>
    api.post<Availability>(`/teachers/${id(teacherId)}/availability`, body),
  addDayOff: (teacherId: string, body: { date: string; reason?: string }) =>
    api.post<Availability>(`/teachers/${id(teacherId)}/days-off`, body),
  removeDayOff: (teacherId: string, date: string) =>
    api.post<Availability>(`/teachers/${id(teacherId)}/days-off/${id(date)}/remove`),
  setSchedule: (learnerId: string, body: { slots: WeeklySlot[]; effectiveFrom?: string }) =>
    api.post(`/learners/${id(learnerId)}/schedule`, body),

  // Learners
  transfer: (learnerId: string, body: { toTeacherId: string; reason: TransferReason; note?: string; handoverNote?: string }) =>
    api.post<{ transferId: string; lessonsMoved: number; lessonsRescheduled: number; scheduleKept: boolean }>(
      `/learners/${id(learnerId)}/transfer`,
      body,
    ),
  suspend: (learnerId: string, body: { kind: 'temporary' | 'permanent'; reason: SuspensionReason; note?: string; startsOn?: string; returnOn?: string }) =>
    api.post<SuspensionDto>(`/learners/${id(learnerId)}/suspensions`, body),
  suspensions: (query: { kind?: 'temporary' | 'permanent'; status?: 'active' | 'ended' }) =>
    api.get<{ suspensions: SuspensionDto[] }>('/suspensions', query),
  extendSuspension: (suspensionId: string, returnOn: string) =>
    api.post<SuspensionDto>(`/suspensions/${id(suspensionId)}/extend`, { returnOn }),
  endSuspension: (suspensionId: string) => api.post<SuspensionDto>(`/suspensions/${id(suspensionId)}/end`),
}

export const opsKeys = {
  all: ['lessons-ops'] as const,
  needsAction: ['lessons-ops', 'needs-action'] as const,
  roster: ['lessons-ops', 'roster'] as const,
  availability: (teacherId: string) => ['lessons-ops', 'availability', teacherId] as const,
  learnerLessons: (learnerId: string) => ['lessons-ops', 'lessons', learnerId] as const,
  suspensions: (kind: string, status: string) => ['lessons-ops', 'suspensions', kind, status] as const,
}
