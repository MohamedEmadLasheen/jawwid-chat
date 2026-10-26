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
  /** PD-31: the lesson this one replaced (a moved lesson). */
  movedFrom?: string | null
  /** PD-31: for a row moved away, the ISO start of its replacement. */
  movedTo?: string | null
  /** PD-31: who moved THIS row here (set when `movedFrom` is). */
  movedBy?: MovedBy | null
}

export type MovedBy = 'family' | 'teacher' | 'staff'
/** PD-30's lock; always null until PD-30 lands. When set, every write is refused. */
export type Locked = 'balance' | 'overdue' | 'other' | null

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
  /** Legacy: the requested times without flags. */
  slots: Array<{ weekday: number; start: string }>
  note: string | null
  createdAt: string
  // PD-31 (optional: an older server omits them).
  teacher?: { id: string; name: string } | null
  requestedBy?: { kind: 'family' | 'teacher'; name: string }
  effectiveFrom?: string | null
  current?: Array<{ weekday: number; start: string; durationMinutes: number; nextStartsAt: string }>
  requested?: Array<{ weekday: number; start: string; nextStartsAt: string; free: boolean }>
  /** false: a requested time was taken since; approving would fail, so it is disabled. */
  stillFree?: boolean
}

/** PD-31: a weekly occurrence the generator could not create (the teacher was busy). */
export interface BlockedOccurrence {
  id: string
  learner: { id: string; name: string }
  teacher: { id: string; name: string }
  startsAt: string
  endsAt: string
  blockedBy: { lessonId: string; kind: 'regular' | 'makeup' | 'trial'; startsAt: string; endsAt: string }
  /** weekly: the generator passed it over; teacher_changed: a one-off the new teacher could not take. */
  reason?: 'weekly' | 'teacher_changed'
  lessonKind?: string
}

export interface NeedsAction {
  overdue: LessonDto[]
  awaitingClose: LessonDto[]
  rulings: RulingDto[]
  makeupsOverdue: LessonDto[]
  returningSoon: Array<{ suspensionId: string; learner: { id: string; name: string }; returnOn: string }>
  scheduleRequests: ScheduleRequestDto[]
  blockedOccurrences?: BlockedOccurrence[]
}

export type MoveRefusal = 'started' | 'not_movable' | 'family_already_moved' | 'family_monthly_limit' | 'too_late'

export interface MoveSlots {
  lessonId: string
  startsAt: string
  durationMinutes: number
  timezone: string
  slots: string[]
  locked: Locked
  refusal: MoveRefusal | null
  familyMovesLeft: number | null
}

export interface ScheduleOptions {
  timezone: string
  durationMinutes: number
  locked: Locked
  current: Array<{ weekday: number; start: string; durationMinutes: number; nextStartsAt: string }>
  options: Array<{ weekday: number; start: string; nextStartsAt: string; except: string[] }>
}

export interface FreeSlots {
  durationMinutes: number
  timezone: string
  slots: string[]
  locked?: Locked
}

export interface TeacherCandidate {
  id: string
  name: string
  isActive: boolean
  away: null | { kind: 'leave' | 'suspended'; until: string }
}

export interface TransferPreview {
  toTeacher: { id: string; name: string; away: TeacherCandidate['away'] }
  locked: Locked
  /** The conversation route only; more than one means the client must say which teacher is replaced. */
  groupTeachers?: Array<{ id: string; name: string }>
  learners: Array<{
    id: string
    name: string
    fromTeacher: { id: string; name: string } | null
    slots: Array<{
      weekday: number
      start: string
      durationMinutes: number
      nextStartsAt: string
      free: boolean
      /** The same instants on the new teacher's clock; null when they cannot be kept exactly. */
      keptAs?: { weekday: number; start: string } | null
      /** The two zones change their clocks on different days: this time cannot be kept. */
      zoneShift?: boolean
    }>
    allFree: boolean
    futureLessons: number
    unmovable: Array<{ lessonId: string; kind: string; startsAt: string }>
  }>
}

export interface TransferBody {
  toTeacherId: string
  reason: TransferReason
  handoverNote?: string
  note?: string
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
  transfer: (learnerId: string, body: TransferBody & { slots?: Array<{ weekday: number; start: string }> }) =>
    api.post<{ transferId: string; toTeacherId?: string; lessonsMoved: number; lessonsRescheduled: number; scheduleKept: boolean }>(
      `/learners/${id(learnerId)}/transfer`,
      body,
    ),
  transferPreview: (learnerId: string, toTeacherId: string) =>
    api.get<TransferPreview>(`/learners/${id(learnerId)}/transfer-preview`, { toTeacherId }),
  // PD-31: a group's children change teacher together, in one transaction.
  groupTeacherPreview: (conversationId: string, toTeacherId: string, fromTeacherId?: string) =>
    api.get<TransferPreview>(`/conversations/${id(conversationId)}/teacher-preview`, { toTeacherId, fromTeacherId }),
  changeGroupTeacher: (
    conversationId: string,
    body: TransferBody & { fromTeacherId?: string; slots?: Record<string, Array<{ weekday: number; start: string }>> },
  ) =>
    api.post<{ learners: Array<{ learnerId: string; transferId: string; lessonsMoved: number; lessonsRescheduled: number }> }>(
      `/conversations/${id(conversationId)}/teacher`,
      body,
    ),
  teacherCandidates: () => api.get<{ teachers: TeacherCandidate[] }>('/teachers/candidates'),

  // PD-31: picking times from what is free
  scheduleOptions: (learnerId: string, teacherId?: string) =>
    api.get<ScheduleOptions>(`/learners/${id(learnerId)}/schedule-options`, { teacherId }),
  freeSlots: (learnerId: string, durationMinutes: number) =>
    api.get<FreeSlots>(`/learners/${id(learnerId)}/free-slots`, { durationMinutes }),
  moveSlots: (lessonId: string) => api.get<MoveSlots>(`/lessons/${id(lessonId)}/move-slots`),
  move: (lessonId: string, startsAt: string) => api.post<LessonDto>(`/lessons/${id(lessonId)}/move`, { startsAt }),
  blockedSlots: (blockedId: string) => api.get<FreeSlots>(`/lessons/blocked/${id(blockedId)}/slots`),
  scheduleBlocked: (blockedId: string, startsAt: string) =>
    api.post<LessonDto>(`/lessons/blocked/${id(blockedId)}/schedule`, { startsAt }),
  dismissBlocked: (blockedId: string, note?: string) =>
    api.post<{ ok: true }>(`/lessons/blocked/${id(blockedId)}/dismiss`, note ? { note } : {}),
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
  upcoming: (learnerId: string) => ['lessons-ops', 'upcoming', learnerId] as const,
  scheduleOptions: (learnerId: string, teacherId: string) => ['lessons-ops', 'schedule-options', learnerId, teacherId] as const,
  freeSlots: (learnerId: string, minutes: number) => ['lessons-ops', 'free-slots', learnerId, minutes] as const,
  moveSlots: (lessonId: string) => ['lessons-ops', 'move-slots', lessonId] as const,
  blockedSlots: (blockedId: string) => ['lessons-ops', 'blocked-slots', blockedId] as const,
  candidates: ['lessons-ops', 'teacher-candidates'] as const,
  preview: (scope: string, scopeId: string, toTeacherId: string, fromTeacherId: string) =>
    ['lessons-ops', 'transfer-preview', scope, scopeId, toTeacherId, fromTeacherId] as const,
}
