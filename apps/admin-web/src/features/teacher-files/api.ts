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
  /** PD-18: offer the payroll sections (super admin, Teachers manager since PD-43). Optional: older servers omit it. */
  canViewFinance?: boolean
}

/** PD-26: away today, and the last day (YYYY-MM-DD). Computed from the days off on every read. */
export interface Away {
  kind: 'leave' | 'suspended' | 'day_off'
  until: string
}

export interface TeacherSummary {
  /** PD-43: the login's status; `none` = Give sign-in is for this teacher. Optional: older servers omit it. */
  signIn?: TeacherSignIn['status']
  id: string
  name: string
  isActive: boolean
  studentCount: number
  openComplaints: number
  /** PD-26. Optional: older servers omit it. */
  away?: Away | null
  /** PD-43: how many set-up steps are not done (the file says which). Optional: older servers omit it. */
  setupMissing?: number
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

export type ComplaintStatus = 'open' | 'upheld' | 'actioned' | 'resolved'

/** PD-26 sources a supervisor records; PD-32 adds `parent_app`, filed by the parent in the app. */
export type ComplaintSource = 'management' | 'parent' | 'parent_app'

/** PD-32: the parent feedback an app complaint was filed as -- what the parent reads back. */
export interface ComplaintParentFeedback {
  id: string
  familyId: string
  parent: Person
  child: Person
  status: 'received' | 'in_review' | 'resolved'
  response: string | null
  respondedAt: string | null
}

export interface Complaint extends Omit<EntryBrief, 'author'> {
  /** Null on a PD-32 app complaint: the parent filed it, not staff (see `parentFeedback`). */
  author: Person | null
  source: { conversationId: string; messageId: string | null } | null
  resolution: EntryBrief | null
  /** PD-26 (optional on older servers). Null on complaints recorded before it. */
  from?: ComplaintSource | null
  /** PD-32: set on a `parent_app` complaint (optional on older servers). */
  parentFeedback?: ComplaintParentFeedback | null
  handledBy?: Person | null
  followUps?: EntryBrief[]
  /** Upheld: the violation on the ladder, and its decision once taken -- the action. */
  action?: { violationId: string; decision: string | null; decidedAt: string | null } | null
  status?: ComplaintStatus
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
  /** PD-43. Optional: older servers omit it. */
  signIn?: TeacherSignIn
  /** PD-43 PR-1b: which of Offboard / Reactivate to offer. Optional: older servers omit it. */
  onboarding?: { canOffboard: boolean; canReactivate: boolean }
  /** PD-43 PR-1b: the set-up checklist, read live. Optional: older servers omit it. */
  setup?: TeacherSetup | null
  access: TeacherFileAccessFlags
  teacher: { id: string; name: string; isActive: boolean; leftAt: string | null; away?: Away | null }
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
  | { kind: 'complaint'; body: string; source: 'management' | 'parent'; handledBy?: string; sourceConversationId?: string }
  | { kind: 'complaint_resolution'; body: string; refersTo: string }
  | { kind: 'complaint_followup'; body: string; refersTo: string }
  | { kind: 'monthly_comment'; body: string; month: string }
  | { kind: 'day_off'; body: string; dayOffOn: string }
  | { kind: 'day_off_cancellation'; body: string; refersTo: string }

/** PD-43: what GET /teacher-files says about adding a teacher. Optional: older servers omit it. */
export interface TeacherOnboardingOffer {
  canAdd: boolean
  /** 'any' = the Teachers manager and the super admin pick any primary supervisor, or none; 'self_or_none' = a teacher supervisor. */
  supervisorChoice: 'any' | 'self_or_none' | null
  supervisors: Person[]
  selfId: string
}

/** PD-43: POST /teachers. `supervisorId` is a staff id, 'self' (a teacher supervisor) or null. */
export interface NewTeacher {
  id: string
  name: string
  email: string
  phone?: string
  joinedOn?: string
  supervisorId: string | null
  /** PD-43 §3.4: add even though an active teacher has the same name (after COMM.TEACHER_SIMILAR_NAME). */
  confirmSimilarName?: boolean
}

/** `code` is present only for whoever may see it: the creator of a new teacher, or the Teachers manager and the super admin on a reissue. */
export interface FirstLogin {
  code?: string
  expiresAt: string
  emailed: boolean
}

/** PD-43: a Teacher File's sign-in -- `none` until the teacher has a login. */
export interface TeacherSignIn {
  status: 'none' | 'provisioned' | 'active' | 'suspended' | 'deactivated'
  canSendCode: boolean
  /** Give sign-in: a login for a teacher who has none. Optional: older servers omit it. */
  canGive?: boolean
}

export interface ReissuedCode {
  teacherId: string
  signIn: string
  firstLogin: FirstLogin
}

/** PD-43: each set-up step done or not (never an amount); `missing` counts the ones that are not. */
export interface TeacherSetup {
  signedIn: boolean
  supervisor: boolean
  contact: boolean
  payTerms: boolean
  payoutAccount: boolean
  leaveAllowance: boolean
  shift: boolean
  availability: boolean
  profile: boolean
  /** The PD-18 pay type and the PD-38 shift category agree (hourly with hourly). */
  payMatchesShift: boolean
  missing: number
}

/** PD-43: GET /teachers/:id/offboard-preview. With no student left, a lesson ahead is a trial or the like. */
export interface OffboardPreview {
  teacherId: string
  isActive: boolean
  students: Person[]
  openLessons: Array<{ id: string; kind: string; startsAt: string; endsAt: string }>
  canOffboard: boolean
}

export interface Offboarded {
  teacherId: string
  cancelledLessons: string[]
  notCancelled: Array<{ lessonId: string; reason: string }>
}

/** `signIn` and `firstLogin` are null for a teacher who never had a login: Give sign-in is for them. */
export interface Reactivated {
  teacherId: string
  signIn: string | null
  firstLogin: FirstLogin | null
}

export interface AddedTeacher {
  teacher: { id: string; name: string; supervisorId: string | null }
  signIn: string
  firstLogin: FirstLogin
}

export const teacherFileApi = {
  list: () =>
    api.get<{ access: TeacherFileAccessFlags; teachers: TeacherSummary[]; supervisors?: Person[]; onboarding?: TeacherOnboardingOffer }>(
      '/teacher-files',
    ),
  addTeacher: (body: NewTeacher) => api.post<AddedTeacher>('/teachers', body),
  giveSignIn: (teacherId: string, email: string) =>
    api.post<ReissuedCode>(`/teachers/${encodeURIComponent(teacherId)}/sign-in`, { email }),
  reissueFirstLogin: (teacherId: string) =>
    api.post<ReissuedCode>(`/teachers/${encodeURIComponent(teacherId)}/first-login-code`, {}),
  offboardPreview: (teacherId: string) => api.get<OffboardPreview>(`/teachers/${encodeURIComponent(teacherId)}/offboard-preview`),
  offboard: (teacherId: string, body: { reason: string; cancelOpenLessons?: boolean }) =>
    api.post<Offboarded>(`/teachers/${encodeURIComponent(teacherId)}/offboard`, body),
  reactivate: (teacherId: string, reason: string) =>
    api.post<Reactivated>(`/teachers/${encodeURIComponent(teacherId)}/reactivate`, { reason }),
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
 * PD-18 payroll (`/teacher-files/:id/finance*`), the super admin and the
 * Teachers manager (PD-43). Mirrored
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

/**
 * PD-26 amendment (owner 2026-10-27): the Teacher Supervision page's own reads,
 * the same for the Teachers department, the super admin and an Operations
 * supervisor (the teachers of their families). Nothing of the Teacher File.
 */
export interface SupervisionDirectory {
  basis: 'super_admin' | 'teachers' | 'operations'
  access: { canWriteSupervision: boolean; canViewFinance: boolean }
  /** `operationsOnly`: reached only through Operations -- a parent's complaint about them names its family chat. */
  teachers: Array<{ id: string; name: string; isActive: boolean; away: Away | null; operationsOnly?: boolean }>
  /** Who may handle a complaint. */
  supervisors: Person[]
  /** The caller's own families' student groups (Operations), to name where a parent's complaint came from. */
  familyChats?: Array<{ conversationId: string; learnerName: string }>
}

export interface HeldLesson {
  id: string
  kind: 'regular' | 'trial'
  startsAt: string
  /** The learner's name, or the trial's booking label. */
  label: string
}

export const supervisionDirectoryApi = {
  directory: () => api.get<SupervisionDirectory>('/teacher-supervision/directory'),
  heldLessons: (teacherId: string, kind: 'regular' | 'trial') =>
    api.get<{ lessons: HeldLesson[] }>(`/teacher-supervision/teachers/${encodeURIComponent(teacherId)}/held-lessons`, { kind }),
}

export const supervisionDirectoryKeys = {
  directory: ['teacher-supervision', 'directory'] as const,
  held: (teacherId: string, kind: string) => ['teacher-supervision', 'held-lessons', teacherId, kind] as const,
}

