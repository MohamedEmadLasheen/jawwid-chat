import { api } from '@/core/api/client'

/**
 * PD-11 T4 and the trial journey -- trial lessons, each trial's one outcome,
 * the trial group's membership and the New Students page, mirrored from
 * apps/api/src/lessons/trial.service.ts. Jawwid Chat is the only source of
 * truth: nothing waits for Core. The server decides who may do what -- these
 * pages only offer the controls.
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
/** A trial's ONE outcome (trial journey): what the statistics count it as. */
export type TrialOutcome = 'upcoming' | 'awaiting' | 'no_show' | 'subscribed' | 'not_subscribed' | 'cancelled'
export type RecordedResult = 'no_show' | 'subscribed' | 'not_subscribed'
export type NotSubscribedReason = 'price' | 'schedule' | 'not_ready' | 'chose_other' | 'no_response' | 'other'
export type PaymentMethod = 'bank_transfer' | 'invoice'

export interface TrialDto {
  id: string
  prospect: { id: string; displayName: string; level: string | null }
  teacher: { id: string; name: string }
  startsAt: string
  endsAt: string
  durationMinutes: number
  attendance: TrialAttendance
  report: { covered: string; rating: number | null; note: string | null } | null
  outcome: TrialOutcome
  /** Sales and the Teachers department only; never the teacher. */
  outcomeDetail?: { reason: NotSubscribedReason | null; note: string | null; recordedAt: string; correctedAt: string | null }
}

export interface ScheduleSlot {
  /** ISO weekday: 1 = Monday ... 7 = Sunday. */
  weekday: number
  /** "HH:MM", the academy's time. */
  time: string
}

/** Sales' subscription form, as sent. */
export interface SubscriptionFormInput {
  parent: { name: string; email: string; phone: string }
  children: Array<{
    name: string
    age: number
    course: string
    teacherId: string
    packagePrice: number
    lessonPrice: number
    schedule: ScheduleSlot[]
  }>
  payment: { currency: string; method: PaymentMethod }
}

/** One subscription on the New Students page, as Sales recorded it in Chat. */
export interface NewStudentDto {
  trialId: string
  prospectName: string
  trialTeacher: { id: string; name: string } | null
  trialAt: string | null
  recordedAt: string
  recordedBy: { id: string; name: string }
  updatedAt: string | null
  parent: { name: string; email: string | null; phone: string }
  children: Array<{
    name: string
    age: number
    course: string
    teacher: { id: string; name: string }
    packagePrice: number
    lessonPrice: number
    schedule: ScheduleSlot[]
  }>
  payment: { currency: string; method: PaymentMethod }
  /** PD-16: null until the Operations manager assigns the student. */
  enrolment?: NewStudentEnrolment | null
}

/** PD-16: how far a new student's setup got. */
export interface NewStudentEnrolment {
  familyId: string
  learnerIds: string[]
  supervisor: { id: string; name: string } | null
  assignedAt: string
  groupConversationId: string | null
  canCreateGroup: boolean
  parentSignup:
    | { state: 'not_started' }
    | { state: 'code_waiting'; code?: string | null; expiresAt?: string }
    | { state: 'signed_up' }
}

export interface AssignResult {
  familyId: string
  learnerIds: string[]
  schedules: Array<{ learnerId: string; set: boolean; reason: string | null }>
}

/** What the "+ -> Trial" card needs in one trial group. */
export interface TrialGroupContextDto {
  conversationId: string
  teacher: { id: string; name: string } | null
  membership: { isMember: boolean; permanent: boolean; canJoin: boolean; canLeave: boolean }
  can: { noShow: boolean; decide: boolean; correct: boolean }
  /** Awaiting an outcome first (oldest first), then recent ones that have one. */
  trials: TrialDto[]
}

export type OutcomeInput =
  | { result: 'no_show' }
  | { result: 'subscribed'; subscription: SubscriptionFormInput }
  | { result: 'not_subscribed'; reason: NotSubscribedReason; note?: string }

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
  /** The trial's one outcome, from the "+ -> Trial" card or the Trials page. */
  outcome: (trialId: string, body: OutcomeInput) => api.post<TrialDto>(`/trials/${id(trialId)}/outcome`, body),
  /** Sales corrects an outcome, saying why. */
  correct: (trialId: string, body: OutcomeInput & { why: string }) => api.post<TrialDto>(`/trials/${id(trialId)}/correction`, body),
  /** Sales changes a subscribed trial's form. */
  updateSubscription: (trialId: string, subscription: SubscriptionFormInput) =>
    api.post<NewStudentDto | null>(`/trials/${id(trialId)}/subscription`, { subscription }),
  /** The teacher's trial group (created if needed): Sales and the Teachers department talk to the teacher there. */
  openGroup: (teacherId: string) => api.post<{ conversationId: string }>(`/trials/teachers/${id(teacherId)}/group`),
  groupContext: (conversationId: string) => api.get<TrialGroupContextDto>(`/trials/groups/${id(conversationId)}`),
  joinGroup: (conversationId: string) => api.post<TrialGroupContextDto>(`/trials/groups/${id(conversationId)}/join`),
  leaveGroup: (conversationId: string) => api.post<TrialGroupContextDto>(`/trials/groups/${id(conversationId)}/leave`),
  newStudents: () => api.get<{ students: NewStudentDto[]; canAssign?: boolean }>('/trials/new-students'),
  /** PD-16: the Operations manager assigns the supervisor; Chat creates the family. */
  assignNewStudent: (trialId: string, body: { supervisorId: string; email?: string }) =>
    api.post<AssignResult>(`/trials/new-students/${id(trialId)}/assign`, body),
  /** PD-16: the responsible supervisor opens the family's group. */
  createNewStudentGroup: (trialId: string) => api.post<{ conversationId: string }>(`/trials/new-students/${id(trialId)}/group`),
}

export const trialKeys = {
  all: ['trials'] as const,
  list: ['trials', 'list'] as const,
  prospects: ['trials', 'prospects'] as const,
  teachers: ['trials', 'teachers'] as const,
  slots: (teacherId: string, duration: number) => ['trials', 'slots', teacherId, duration] as const,
  newStudents: ['trials', 'new-students'] as const,
  group: (conversationId: string) => ['trials', 'group', conversationId] as const,
}
