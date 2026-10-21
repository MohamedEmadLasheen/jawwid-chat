import { api } from '@/core/api/client'

/**
 * `/teacher-files/*` -- the PD-10 wire contract, mirrored from
 * apps/api/src/teacher-file/teacher-file.service.ts. Who may see or change
 * what is decided there; `access` tells the page which controls to offer, and
 * the server still answers every request on its own.
 */

export interface TeacherFileAccessFlags {
  canEditPersonal: boolean
  canWriteSupervision: boolean
  /** PD-18: offer the payroll sections (super admin). Optional: older servers omit it. */
  canViewFinance?: boolean
}

export interface TeacherSummary {
  id: string
  name: string
  isActive: boolean
  studentCount: number
  openComplaints: number
}

export interface Person {
  id: string
  name: string
}

export interface EntryBrief {
  id: string
  body: string
  createdAt: string
  author: Person
}

export interface Complaint extends EntryBrief {
  source: { conversationId: string; messageId: string | null } | null
  resolution: EntryBrief | null
}

export interface MonthlyComment {
  /** YYYY-MM */
  month: string
  current: EntryBrief
  earlierVersions: EntryBrief[]
}

export interface DayOff extends EntryBrief {
  /** YYYY-MM-DD */
  date: string
  cancellation: EntryBrief | null
}

export interface TeacherFile {
  access: TeacherFileAccessFlags
  teacher: { id: string; name: string; isActive: boolean; leftAt: string | null }
  personal: {
    fullName: string
    phone: string | null
    email: string | null
    /** YYYY-MM-DD */
    joinedOn: string | null
    updatedAt: string | null
    updatedBy: Person | null
  }
  assignedStudents: Array<{
    learnerId: string
    name: string
    level: string | null
    family: { id: string; displayName: string }
    supervisor: Person | null
  }>
  supervision: {
    complaints: Complaint[]
    monthlyComments: MonthlyComment[]
    daysOff: DayOff[]
  }
  /** PD-18. Optional: older servers omit them. */
  employment?: { teachingMarket: string | null; studentCount: number }
  /** What was recorded, for every reader. Amounts are only in `/finance`. */
  history?: {
    bonuses: Array<{ id: string; reason: string; createdAt: string; author: Person }>
    deductions: Array<{
      id: string
      step: 'deduction_1' | 'deduction_2'
      violation: string
      /** YYYY-MM, the payroll month */
      month: string
      note: string | null
      decidedAt: string
      author: Person
    }>
  }
}

/** A field left out is unchanged; null clears it. */
export interface PersonalPatch {
  phone?: string | null
  email?: string | null
  joinedOn?: string | null
  teachingMarket?: string | null
  reason: string
}

export type NewEntry =
  | { kind: 'complaint'; body: string }
  | { kind: 'complaint_resolution'; body: string; refersTo: string }
  | { kind: 'monthly_comment'; body: string; month: string }
  | { kind: 'day_off'; body: string; dayOffOn: string }
  | { kind: 'day_off_cancellation'; body: string; refersTo: string }

export const teacherFileApi = {
  list: () => api.get<{ access: TeacherFileAccessFlags; teachers: TeacherSummary[] }>('/teacher-files'),
  detail: (teacherId: string) => api.get<TeacherFile>(`/teacher-files/${encodeURIComponent(teacherId)}`),
  updatePersonal: (teacherId: string, body: PersonalPatch) =>
    api.post<TeacherFile>(`/teacher-files/${encodeURIComponent(teacherId)}/personal`, body),
  addEntry: (teacherId: string, body: NewEntry) =>
    api.post<{ id: string; kind: string; createdAt: string }>(`/teacher-files/${encodeURIComponent(teacherId)}/entries`, body),
}

export const teacherFileKeys = {
  all: ['teacher-files'] as const,
  list: ['teacher-files', 'list'] as const,
  detail: (teacherId: string) => ['teacher-files', 'detail', teacherId] as const,
}

/**
 * PD-11's supervision timeline (`GET /teachers/:id/supervision`): a QUERY over
 * the records that already exist -- entries, decided rulings, lessons the
 * teacher did not give, transfers, days off -- newest first. Nothing in it is
 * stored twice. Mirrored from apps/api/src/lessons/supervision.service.ts.
 */
export type TimelineType =
  | 'bonus'
  | 'complaint'
  | 'complaint_resolution'
  | 'monthly_comment'
  | 'note'
  | 'late_apology'
  | 'makeup_followup'
  | 'teacher_apology'
  | 'teacher_no_show'
  | 'transfer_in'
  | 'transfer_out'
  | 'day_off'

export interface TimelineItem {
  id: string
  type: TimelineType | string
  at: string
  body?: string | null
  /** monthly_comment: YYYY-MM */
  period?: string | null
  /** day_off: YYYY-MM-DD */
  day?: string
  decision?: string | null
  reason?: string | null
  lesson?: { id: string; startsAt: string; learnerName: string }
  learner?: { id: string; name: string }
  by?: string | null
  byName?: string | null
}

export const supervisionTimelineApi = {
  timeline: (teacherId: string) =>
    api.get<{ teacher: { id: string; name: string }; items: TimelineItem[] }>(`/teachers/${encodeURIComponent(teacherId)}/supervision`),
  /** A free note on the timeline (complaints and monthly comments have their own sections). */
  addNote: (teacherId: string, body: string) =>
    api.post<{ id: string; kind: string }>(`/teachers/${encodeURIComponent(teacherId)}/supervision`, { kind: 'note', body }),
  /** The bonus ticket: a `bonus` entry and a card in the teacher's supervision chat. No amount -- payroll's. */
  bonus: (teacherId: string, reason: string) =>
    api.post<{ id: string; kind: string; conversationId: string }>(`/teachers/${encodeURIComponent(teacherId)}/bonus`, { reason }),
}

export const timelineKeys = {
  timeline: (teacherId: string) => ['teacher-files', 'timeline', teacherId] as const,
}

/**
 * PD-18 payroll (`/teacher-files/:id/finance*`), super admin only. Mirrored
 * from apps/api/src/teacher-file/teacher-payroll.service.ts. Amounts are
 * strings with two decimals ("1500.00"); the page formats them and never
 * computes a total itself -- the summary is the server's.
 */
export type SalaryType = 'shift' | 'hourly'
export type PayoutMethod = 'e_wallet' | 'instapay' | 'bank_transfer'

export interface PayTerms {
  /** YYYY-MM */
  effectiveMonth: string
  salaryType: SalaryType
  currency: string
  monthlyAmount: string | null
  hourlyRate: string | null
  reason: string
}

export interface PayAdjustment {
  id: string
  kind: 'bonus' | 'deduction'
  month: string
  amount: string
  currency: string
  reason: string
  bonusEntryId: string | null
  violationId: string | null
  replaces: string | null
  /** Not replaced by a correction. A live amount of 0.00 is a cancellation. */
  live: boolean
  createdBy: Person
  createdAt: string
}

export interface MonthPay {
  month: string
  currency: string | null
  salaryType: SalaryType | null
  paidMinutes: number
  base: string | null
  bonuses: string
  deductions: string
  net: string | null
}

export interface TeacherFinance {
  month: string
  /** False: the server has no payout key, so accounts can be neither saved nor shown. */
  keyConfigured: boolean
  terms: Array<PayTerms & { createdBy: Person; createdAt: string }>
  currentTerms: PayTerms | null
  payoutAccount: { method: PayoutMethod; last4: string; updatedAt: string; updatedBy: Person } | null
  adjustments: PayAdjustment[]
  unpriced: { bonusEntryIds: string[]; violationIds: string[] }
  /** Newest month first. */
  summary: MonthPay[]
}

export type PayoutDetails =
  | { provider: string; walletNumber: string }
  | { address: string }
  | { bankName: string; accountHolder: string; accountNumber: string; iban?: string; swift?: string }

export interface NewAdjustment {
  kind?: 'bonus' | 'deduction'
  amount: string
  month?: string
  reason: string
  bonusEntryId?: string
  violationId?: string
  replaces?: string
}

const finance = (teacherId: string) => `/teacher-files/${encodeURIComponent(teacherId)}/finance`

export const payrollApi = {
  finance: (teacherId: string, month?: string) => api.get<TeacherFinance>(finance(teacherId), month ? { month } : undefined),
  setTerms: (teacherId: string, body: { effectiveMonth: string; salaryType: SalaryType; currency: string; monthlyAmount?: string; hourlyRate?: string; reason: string }) =>
    api.post<PayTerms & { id: string }>(`${finance(teacherId)}/terms`, body),
  setPayoutAccount: (teacherId: string, body: { method: PayoutMethod; details: PayoutDetails; reason: string }) =>
    api.post<{ method: PayoutMethod; last4: string }>(`${finance(teacherId)}/payout-account`, body),
  revealPayoutAccount: (teacherId: string, reason: string) =>
    api.post<{ method: PayoutMethod; details: Record<string, string> }>(`${finance(teacherId)}/payout-account/reveal`, { reason }),
  addAdjustment: (teacherId: string, body: NewAdjustment) =>
    api.post<{ id: string; kind: string; month: string; amount: string; currency: string }>(`${finance(teacherId)}/adjustments`, body),
}

export const payrollKeys = {
  all: (teacherId: string) => ['teacher-files', 'finance', teacherId] as const,
  finance: (teacherId: string, month: string) => ['teacher-files', 'finance', teacherId, month] as const,
}
