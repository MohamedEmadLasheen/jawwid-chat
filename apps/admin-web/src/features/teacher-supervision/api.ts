import { api } from '@/core/api/client'
import type { Complaint, ComplaintSource, Person, TeacherFileAccessFlags } from '@/features/teacher-files/api'

/**
 * PD-26: the Teacher Supervision page's reads, mirrored from apps/api
 * (src/leave, src/teacher-file). Absences and lateness are the discipline
 * routes (features/discipline/api.ts); leave requests are PD-12's
 * (features/supervision/api.ts). Who may see what is decided by the server.
 */

export interface LeaveOverviewRow {
  id: string
  name: string
  isActive: boolean
  /**
   * Null while no allowance is set for the year: the leave is still recorded.
   * The three are absent for a teacher the viewer reaches only through
   * Operations: the allowance is the Teachers department's (PD-26 amendment).
   */
  allowance?: number | null
  used?: number
  balance?: number | null
  pendingRequests: number
  away: { kind: 'leave' | 'suspended' | 'day_off'; until: string } | null
}

export type SupervisedComplaint = Complaint & { teacher: Person }

export interface Reward {
  id: string
  teacher: Person
  reason: string
  recordedAt: string
  recordedBy: Person
  /** Present for the super admin only; null when not priced yet. */
  amount?: { amount: string; currency: string; month: string } | null
}

export interface DeductionDefault {
  kind: 'deduction_1' | 'deduction_2'
  currency: string
  amount: string
  setAt: string
  setBy: Person
}

export const supervisionHubApi = {
  leaveOverview: (year?: number) =>
    api.get<{ year: number; teachers: LeaveOverviewRow[] }>('/teacher-leave-overview', year ? { year: String(year) } : undefined),
  complaints: (from?: ComplaintSource) =>
    api.get<{ access: TeacherFileAccessFlags; complaints: SupervisedComplaint[] }>('/teacher-files/complaints', from ? { from } : undefined),
  rewards: (month?: string) => api.get<{ canViewAmounts: boolean; rewards: Reward[] }>('/teacher-files/rewards', month ? { month } : undefined),
  /** PD-26: a reward and its amount in one transaction (super admin); refused whole without pay terms. */
  recordReward: (teacherId: string, body: { reason: string; amount: string }) =>
    api.post<{ id: string; kind: string; amount: { amount: string; currency: string; month: string } }>(
      `/teacher-files/${encodeURIComponent(teacherId)}/rewards`,
      body,
    ),
  deductionDefaults: () => api.get<{ currencies: string[]; defaults: DeductionDefault[] }>('/teacher-files/finance/deduction-defaults'),
  setDeductionDefault: (body: { kind: 'deduction_1' | 'deduction_2'; currency: string; amount: string }) =>
    api.post<{ currencies: string[]; defaults: DeductionDefault[] }>('/teacher-files/finance/deduction-defaults', body),
}

export const supervisionHubKeys = {
  all: ['teacher-supervision'] as const,
  leave: (year?: number) => ['teacher-supervision', 'leave', year ?? 'this'] as const,
  complaints: (from?: string) => ['teacher-supervision', 'complaints', from ?? 'all'] as const,
  rewards: (month?: string) => ['teacher-supervision', 'rewards', month ?? 'all'] as const,
  deductionDefaults: ['teacher-supervision', 'deduction-defaults'] as const,
}

/**
 * PD-32: a parent's feedback about their child's teacher, mirrored from
 * apps/api/src/teacher-file/parent-feedback.service.ts (`forStaff`). The
 * parent reads back only the status and `response`; everything else here is
 * staff's. A complaint is also a PD-26 complaint (`complaint.entryId`) and is
 * resolved only on the Teacher File.
 */
export type FeedbackCategory = 'praise' | 'suggestion' | 'complaint'
export type FeedbackStatus = 'received' | 'in_review' | 'resolved'

export interface StaffFeedback {
  id: string
  familyId: string
  parent: Person
  child: Person
  teacher: Person
  category: FeedbackCategory
  body: string
  status: FeedbackStatus
  response: string | null
  respondedBy: Person | null
  respondedAt: string | null
  createdAt: string
  complaint: { entryId: string; handledBy: Person | null } | null
}

export interface FeedbackQuery {
  status?: FeedbackStatus
  category?: FeedbackCategory
}

export const parentFeedbackApi = {
  /** The Teachers department and the super admin; anyone else is refused (COMM.TEACHER_FILE_DENIED). */
  list: (q: FeedbackQuery = {}) => {
    const query: Record<string, string> = {}
    if (q.status) query.status = q.status
    if (q.category) query.category = q.category
    return api.get<{ canWrite: boolean; feedback: StaffFeedback[] }>('/parent-feedback', Object.keys(query).length ? query : undefined)
  },
  /** received -> in review; on a complaint the taker becomes its PD-26 handler (once). */
  take: (id: string) => api.post<StaffFeedback>(`/parent-feedback/${encodeURIComponent(id)}/take`),
  /** The one text the parent reads back. `resolve` closes praise or a suggestion; a complaint refuses it (409). */
  reply: (id: string, body: { response: string; resolve?: boolean }) =>
    api.post<StaffFeedback>(`/parent-feedback/${encodeURIComponent(id)}/reply`, body),
  /** A family's Parent File: also the children's supervisor, for their own children (COMM.FEEDBACK_DENIED otherwise). */
  forFamily: (familyId: string) => api.get<{ feedback: StaffFeedback[] }>(`/families/${encodeURIComponent(familyId)}/parent-feedback`),
}

export const parentFeedbackKeys = {
  all: ['parent-feedback'] as const,
  list: (q: FeedbackQuery) => ['parent-feedback', 'list', q.status ?? 'all', q.category ?? 'all'] as const,
  family: (familyId: string) => ['parent-feedback', 'family', familyId] as const,
}
