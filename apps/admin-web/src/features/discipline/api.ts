import { api } from '@/core/api/client'

/**
 * PD-12 S2 wire contract, mirrored from apps/api/src/discipline. Every step is
 * computed by the server; this page only shows it and sends a person's decision.
 */
export type Decision =
  | 'warning'
  | 'deduction_1'
  | 'deduction_2'
  | 'temporary_suspension'
  | 'permanent_suspension'
  | 'excused'

export const LADDER: readonly Decision[] = ['warning', 'deduction_1', 'deduction_2', 'temporary_suspension', 'permanent_suspension']

export interface Violation {
  id: string
  kind: 'teacher_apology' | 'teacher_no_show' | 'late'
  teacher: { id: string; name: string | null }
  lesson: { id: string; startsAt: string | null; learnerName: string | null; note: string | null }
  occurredAt: string
  /** YYYY-MM, the academy's month it counts in. */
  month: string
  lateMinutes: number | null
  note: string | null
  recordedBy: { id: string; name: string | null } | null
  /** Its rank among the teacher's counted violations of the month (1-5). */
  step: number
  suggestedDecision: Decision
  decision: Decision | null
  decisionNote: string | null
  decidedBy: { id: string; name: string | null } | null
  decidedAt: string | null
  suspension: { id: string; kind: 'temporary' | 'permanent'; startsOn: string; endsOn: string | null } | null
}

export interface DecideBody {
  decision: Decision
  note?: string
  startsOn?: string
  endsOn?: string
  cancelCollidingLessons?: boolean
}

export type ViolationQuery = { state?: 'open' | 'decided' | 'all'; month?: string; teacherId?: string; kind?: 'late' | 'cancellations' }

export const disciplineApi = {
  violations: (query: ViolationQuery) =>
    api.get<{ violations: Violation[] }>('/discipline/violations', Object.fromEntries(Object.entries(query).filter(([, v]) => v !== undefined)) as Record<string, string>),
  decide: (violationId: string, body: DecideBody) =>
    api.post<{ violation: Violation; cancelledLessons: number; notCancelled: Array<{ lessonId: string; reason: string }> }>(
      `/discipline/violations/${encodeURIComponent(violationId)}/decide`,
      body,
    ),
  recordLateness: (lessonId: string, body: { minutes: number; note?: string }) =>
    api.post<{ violation: Violation }>(`/lessons/${encodeURIComponent(lessonId)}/lateness`, body),
}

export const disciplineKeys = {
  all: ['discipline'] as const,
  violations: (q: ViolationQuery) => ['discipline', 'violations', q] as const,
}
