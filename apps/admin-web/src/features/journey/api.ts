import { api } from '@/core/api/client'

/**
 * PD-15's wire contract -- the student's journey after enrolment -- mirrored
 * from apps/api/src/lessons/{lesson,lesson-record,enrollment}.service.ts and
 * journey.controller.ts. The server decides who may do what; these screens
 * offer the controls and show its answer.
 */

/** A lesson ticket the server offers under "+" in one conversation, right now. */
export interface LessonTicket {
  ticket: string
  lessonId: string | null
  learner: { id: string; name: string }
  startsAt: string | null
  endsAt: string | null
  suggestedLessonNumber?: number
}

/** The fields of a lesson report (report-vocab.ts codes). */
export interface ReportInput {
  lessonNumber: number | null
  coveredTopics: string[]
  covered: string | null
  rating: number | null
  nextTasks: string[]
  homework: string | null
  note: string | null
}

export interface LessonRecord {
  id: string
  learner: { id: string; name: string }
  teacher: { id: string; name: string }
  kind: string
  startsAt: string
  endsAt: string
  outcome: string | null
  apologyTiming: 'before_start' | 'after_start' | null
  outcomeNote: string | null
  /** PD-50: the excuse's reason category, which the family reads. */
  excuseCategory?: string | null
  report: (Omit<ReportInput, 'note'> & {
    note?: string | null
    version: number
    submittedAt: string
    updatedAt: string
    deletedAt: string | null
    enteredBy?: { kind: string; id: string }
    messageId: string | null
  }) | null
  corrections?: Array<{ id: string; from: string; to: string; apologyTiming: string | null; reason: string; by: string; at: string }>
}

export interface LessonHistory {
  lessonId: string
  corrections: Array<{ id: string; from: string; to: string; apologyTiming: string | null; reason: string; by: string; at: string }>
  reportRevisions: Array<{ id: string; action: string; previous: Record<string, unknown>; by: { kind: string; id: string }; reason: string | null; at: string }>
}

export interface GroupLearner {
  id: string
  name: string
  age: number | null
  birthDate?: string | null
  course: { id: string; name: string } | null
  packageLessons: number | null
  /** PD-30: the package is the current subscription (Student Profile → Subscription), not typed here. */
  packageFromSubscription?: boolean
  teacher: { id: string; name: string } | null
  schedule: Array<{ weekday: number; start: string; durationMinutes: number; timezone: string }>
  canEdit: boolean
}

export interface Course {
  id: string
  name: string
  isActive: boolean
}

export interface EnrollmentInput {
  birthDate?: string | null
  courseId?: string | null
  packageLessons?: number | null
}

export const journeyApi = {
  tickets: (conversationId: string) =>
    api.get<{ tickets: LessonTicket[] }>(`/conversations/${conversationId}/lesson-tickets`),
  /** A student excused before the start (the supervisor gives no reason). */
  excuseBefore: (lessonId: string, reason: string | null = null, reasonCategory: string | null = null) =>
    api.post<LessonRecord>(`/lessons/${lessonId}/apology`, { ...(reason ? { reason } : {}), ...(reasonCategory ? { reasonCategory } : {}) }),
  /** A student excused after the start: excused at once; the reason is internal. */
  excuseAfter: (lessonId: string, reason: string, reasonCategory: string | null = null) =>
    api.post<LessonRecord>(`/lessons/${lessonId}/late-excuse`, { reason, ...(reasonCategory ? { reasonCategory } : {}) }),
  teacherExcuse: (lessonId: string, reason: string, reasonCategory: string | null = null) =>
    api.post<LessonRecord>(`/lessons/${lessonId}/teacher-apology`, { reason, ...(reasonCategory ? { reasonCategory } : {}) }),
  makeupSlots: (lessonId: string) =>
    api.get<{ lessonId: string; durationMinutes: number; timezone: string | null; slots: string[] }>(`/lessons/${lessonId}/makeup-slots`),
  bookMakeup: (lessonId: string, startsAt: string) => api.post<LessonRecord>(`/lessons/${lessonId}/makeup`, { startsAt }),

  lesson: (lessonId: string) => api.get<LessonRecord>(`/lessons/${lessonId}`),
  history: (lessonId: string) => api.get<LessonHistory>(`/lessons/${lessonId}/history`),
  correct: (lessonId: string, body: { outcome: string; reason: string; apologyTiming?: string; report?: ReportInput }) =>
    api.post<LessonRecord>(`/lessons/${lessonId}/correction`, body),
  editReport: (lessonId: string, report: ReportInput) => api.post<LessonRecord>(`/lessons/${lessonId}/report/edit`, report),
  deleteReport: (lessonId: string, body: { reason: string; resend: boolean; report?: ReportInput }) =>
    api.post<LessonRecord>(`/lessons/${lessonId}/report/delete`, body),

  // PD-35: ask the teacher to file or correct the report (they answer through the edit above).
  requestCorrection: (lessonId: string, body: { reason: string; kind?: 'missing' | 'correction' }) =>
    api.post<CorrectionRequest>(`/lessons/${lessonId}/correction-requests`, body),
  corrections: (status: 'open' | 'resolved' | 'all' = 'open') =>
    api.get<{ requests: CorrectionRequest[] }>('/correction-requests', { status }),
  withdrawCorrection: (id: string) => api.post<CorrectionRequest>(`/correction-requests/${encodeURIComponent(id)}/withdraw`),

  groupLearners: (conversationId: string) => api.get<{ learners: GroupLearner[] }>(`/conversations/${conversationId}/learners`),
  setEnrollment: (learnerId: string, body: EnrollmentInput) => api.post<unknown>(`/learners/${learnerId}/enrollment`, body),
  courses: () => api.get<{ canManage: boolean; courses: Course[] }>('/courses'),
  createCourse: (name: string) => api.post<Course>('/courses', { name }),
  updateCourse: (id: string, body: { name?: string; isActive?: boolean }) => api.post<Course>(`/courses/${id}`, body),
}

/** PD-35: a request that the teacher files or corrects a lesson report. */
export interface CorrectionRequest {
  id: string
  lessonId: string
  learner: { id: string; name: string }
  teacher: { id: string; name: string }
  lessonStartsAt: string
  kind: 'missing' | 'correction'
  reason: string
  requestedBy: { id: string; name: string }
  requestedAt: string
  status: 'open' | 'corrected' | 'filed' | 'withdrawn'
  /** The change is the lesson's history between these two versions. */
  askedVersion: number | null
  resolvedVersion: number | null
  resolvedAt: string | null
  resolvedByKind: 'teacher' | 'staff' | null
}

export const journeyKeys = {
  tickets: (conversationId: string) => ['journey', 'tickets', conversationId] as const,
  lesson: (lessonId: string) => ['journey', 'lesson', lessonId] as const,
  history: (lessonId: string) => ['journey', 'history', lessonId] as const,
  learners: (conversationId: string) => ['journey', 'learners', conversationId] as const,
  courses: ['journey', 'courses'] as const,
  corrections: (status: string) => ['journey', 'corrections', status] as const,
}

/** The kinds of card that are about one lesson, and so open its record. */
export const LESSON_CARD_KINDS: ReadonlySet<string> = new Set([
  'lesson_report', 'lesson_absence', 'lesson_apology', 'lesson_teacher_apology', 'lesson_cancelled',
  'lesson_late_apology', 'lesson_ruling', 'lesson_corrected', 'lesson_makeup_booked',
  // PD-31: a moved lesson's card opens the NEW lesson's record.
  'lesson_moved',
])

/** The report's quick choices -- the same codes as apps/api/src/lessons/report-vocab.ts. */
export const COVERED_TOPICS = [
  'new_memorization', 'revision', 'recitation', 'tajweed', 'reading', 'writing', 'grammar', 'vocabulary', 'islamic_studies', 'assessment',
] as const
export const NEXT_TASKS = [
  'memorize_new', 'revise_previous', 'practise_recitation', 'practise_reading', 'written_homework', 'prepare_next', 'nothing',
] as const
export const PERFORMANCE_LEVELS = [5, 4, 3, 2, 1] as const

/** The outcomes a correction may write. */
export const CORRECTABLE_OUTCOMES = [
  'held', 'student_no_show', 'student_apology', 'teacher_apology', 'teacher_no_show', 'admin_cancelled', 'voided',
] as const

export function emptyReport(lessonNumber: number | null = null): ReportInput {
  return { lessonNumber, coveredTopics: [], covered: null, rating: null, nextTasks: [], homework: null, note: null }
}

export function reportOf(r: LessonRecord['report']): ReportInput {
  if (!r) return emptyReport()
  return {
    lessonNumber: r.lessonNumber,
    coveredTopics: [...r.coveredTopics],
    covered: r.covered,
    rating: r.rating,
    nextTasks: [...r.nextTasks],
    homework: r.homework,
    note: r.note ?? null,
  }
}

/** What a report needs before it is sent: a topic or a short text. */
export function reportComplete(r: ReportInput): boolean {
  return r.coveredTopics.length > 0 || !!r.covered?.trim()
}
