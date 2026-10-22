import { api } from '@/core/api/client'
import type { Complaint, Person, TeacherFileAccessFlags } from '@/features/teacher-files/api'

/**
 * PD-24: the Teacher Supervision page's reads, mirrored from apps/api
 * (src/leave, src/teacher-file). Absences and lateness are the discipline
 * routes (features/discipline/api.ts); leave requests are PD-12's
 * (features/supervision/api.ts). Who may see what is decided by the server.
 */

export interface LeaveOverviewRow {
  id: string
  name: string
  isActive: boolean
  /** Null while no allowance is set for the year: the leave is still recorded. */
  allowance: number | null
  used: number
  balance: number | null
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
  complaints: (from?: 'management' | 'parent') =>
    api.get<{ access: TeacherFileAccessFlags; complaints: SupervisedComplaint[] }>('/teacher-files/complaints', from ? { from } : undefined),
  rewards: (month?: string) => api.get<{ canViewAmounts: boolean; rewards: Reward[] }>('/teacher-files/rewards', month ? { month } : undefined),
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
