import { api } from '@/core/api/client'
import type { Invoice, Payment, PaymentMethod as AnyPaymentMethod, PaymentRequest, PlanMonths, Receipt, RequestPurpose } from '@/features/payments/api'

/**
 * PD-17 wire contract, mirrored from apps/api/src/parent-profile,
 * apps/api/src/billing and apps/api/src/lessons (EnrollmentService.profile).
 *
 * Who may read and change each of these is the server's answer alone: a
 * Parent Profile and a family's money are the administration's (Operations in
 * scope, the Operations Manager, the super admin -- never a teacher); a
 * Student Profile the administration's and the child's own teacher's.
 */

export interface ParentListItem {
  id: string
  name: string
  avatarUrl: string | null
  family: { id: string; name: string }
  childrenCount: number
}

export interface ParentProfile {
  id: string
  name: string
  relationship: string | null
  isActive: boolean
  avatarUrl: string | null
  family: { id: string; name: string }
  contact: { phone: string | null; email: string | null; countryCode: string | null; region: string | null }
  /** The administration's note about this parent. The parent never sees it. */
  adminNote: string | null
  childrenCount: number
  children: Array<{ id: string; name: string; avatarUrl: string | null }>
  updatedAt: string | null
  access: { canEdit: boolean }
}

export type ParentUpdate = Partial<{
  name: string
  phone: string | null
  email: string | null
  countryCode: string | null
  region: string | null
  adminNote: string | null
}>

/** A family's usual method (PD-17). What a payment actually used is PD-27's wider set. */
export type PaymentMethod = 'invoice' | 'bank_transfer'
/** POST /instalments/:id/payment: the whole remaining amount, by one of these. */
export type InstalmentPaymentMethod = 'invoice' | 'bank_transfer' | 'cash'
export type TimelineStatus = 'overdue' | 'due' | 'upcoming' | 'paid' | 'voided'

export interface TimelineInstalment {
  id: string
  planId: string | null
  label: string
  child: { id: string; name: string } | null
  amountMinor: number
  currency: string
  /** YYYY-MM-DD. */
  dueDate: string
  status: TimelineStatus
  days: number
  createdAt: string
  createdBy: { id: string; name: string }
  /** recordedBy null: confirmed by Stripe (PD-27). */
  payment: { paidOn: string; method: AnyPaymentMethod; reference: string | null; recordedAt: string; recordedBy: { id: string; name: string } | null } | null
  void: { at: string; by: { id: string; name: string }; reason: string } | null
  /** PD-27: payments may be partial; the instalment is paid when they cover it. */
  paidMinor: number
  remainingMinor: number
  partial: boolean
  /** Its open payment request, if any. */
  requestId: string | null
}

export interface FamilyBilling {
  familyId: string
  today: string
  paymentMethod: PaymentMethod | null
  currency: string | null
  /** The family's plan: 1, 3, 6 or 12 months. */
  planMonths: number | null
  instalments: TimelineInstalment[]
  totals: Array<{ currency: string; paidMinor: number; outstandingMinor: number; overdueMinor: number }>
  canRecord: boolean
  /** PD-27. */
  requests: PaymentRequest[]
  payments: Payment[]
  invoices: Invoice[]
  receipts: Receipt[]
  /** Approve receipts, record bank transfers, void, refund: the super admin and the Operations Manager. */
  canVerify: boolean
  /** Stripe is configured on this deployment. */
  cardAvailable: boolean
}

export type BillingUpdate = Partial<{ paymentMethod: PaymentMethod | null; currency: string | null; planMonths: number | null }>

export interface NewInstalments {
  label: string
  amountMinor: number
  firstDueDate: string
  currency?: string
  count?: number
  everyMonths?: number
  learnerId?: string | null
  /** PD-30: a plan for one child's subscription credits these lessons when it is created. */
  lessonsIncluded?: number
  planMonths?: number
}

/** PD-27: a custom schedule, 1-24 rows, instead of the equal split. */
export interface CustomInstalments {
  label: string
  currency?: string
  learnerId?: string | null
  items: Array<{ amountMinor: number; dueDate: string }>
  lessonsIncluded?: number
  planMonths?: number
}

export interface NewPaymentRequest {
  purpose: RequestPurpose
  label: string
  amountMinor?: number
  currency?: string
  learnerId?: string
  instalmentId?: string
  planMonths?: PlanMonths
  /** PD-30: a subscription / renewal buys these lessons (credited when paid in full). */
  lessonsIncluded?: number
  periodStart?: string
  periodEnd?: string
  expiresInDays?: number
}

export interface NewFamilyPayment {
  method: 'cash' | 'bank_transfer'
  amountMinor: number
  paidOn: string
  requestId?: string
  instalmentId?: string
  learnerId?: string
  reference?: string
}

export interface StudentProfile {
  id: string
  name: string
  avatarUrl: string | null
  age: number | null
  /** Staff only. */
  birthDate?: string | null
  course: { id: string; name: string } | null
  teacher: { id: string; name: string } | null
  /** `start` is the teacher's wall clock in `timezone`; `nextStartsAt` the next real start (PD-22). */
  schedule: Array<{ weekday: number; start: string; durationMinutes: number; timezone: string; nextStartsAt?: string }>
  /** Staff only: the parents, to open their Parent Profile (whose own rule then decides). */
  family?: { id: string; name: string; parents: Array<{ id: string; name: string }> }
  /** PD-22: the family's own zone (from a parent's phone), or null before any parent opened the app. */
  familyTimeZone?: string | null
  viewer: 'teacher' | 'staff'
}

export interface AvatarUploadGrant {
  objectKey: string
  uploadUrl: string
  method: 'PUT'
  headers: Record<string, string>
  expiresAt: string
}

const parent = (id: string) => `/parent-profiles/${encodeURIComponent(id)}`
const family = (id: string) => `/families/${encodeURIComponent(id)}`

export const profilesApi = {
  parents: (q: string, access: ParentAccessFilter = 'all') => {
    const params = { ...(q ? { q } : {}), ...(access !== 'all' ? { access } : {}) }
    return api.get<{ items: ParentListItem[]; truncated: boolean }>('/parent-profiles', Object.keys(params).length ? params : undefined)
  },
  parent: (id: string) => api.get<ParentProfile>(parent(id)),
  updateParent: (id: string, body: ParentUpdate) => api.post<ParentProfile>(parent(id), body),
  authorizePhoto: (id: string, mimeType: string, byteSize: number) =>
    api.post<AvatarUploadGrant>(`${parent(id)}/avatar/upload`, { mimeType, byteSize }),
  commitPhoto: (id: string, objectKey: string) => api.post<{ avatarUrl: string | null }>(`${parent(id)}/avatar`, { objectKey }),
  removePhoto: (id: string) => api.delete<{ avatarUrl: null }>(`${parent(id)}/avatar`),

  billing: (familyId: string) => api.get<FamilyBilling>(`${family(familyId)}/billing`),
  updateBilling: (familyId: string, body: BillingUpdate) => api.post<FamilyBilling>(`${family(familyId)}/billing`, body),
  createInstalments: (familyId: string, body: NewInstalments | CustomInstalments) => api.post<FamilyBilling>(`${family(familyId)}/instalments`, body),
  recordPayment: (id: string, body: { paidOn: string; method: InstalmentPaymentMethod; reference?: string }) =>
    api.post<FamilyBilling>(`/instalments/${encodeURIComponent(id)}/payment`, body),
  voidInstalment: (id: string, reason: string) => api.post<FamilyBilling>(`/instalments/${encodeURIComponent(id)}/void`, { reason }),

  // PD-27: every write that names a family answers its billing.
  createPaymentRequest: (familyId: string, body: NewPaymentRequest) =>
    api.post<{ request: PaymentRequest; billing: FamilyBilling }>(`${family(familyId)}/payment-requests`, body),
  cancelPaymentRequest: (id: string, reason: string) => api.post<FamilyBilling>(`/payment-requests/${encodeURIComponent(id)}/cancel`, { reason }),
  recordFamilyPayment: (familyId: string, body: NewFamilyPayment) => api.post<FamilyBilling>(`${family(familyId)}/payments`, body),
  voidPayment: (id: string, reason: string) => api.post<FamilyBilling>(`/payments/${encodeURIComponent(id)}/void`, { reason }),
  refundPayment: (id: string, body: { amountMinor: number; reason: string }) => api.post<FamilyBilling>(`/payments/${encodeURIComponent(id)}/refunds`, body),

  student: (learnerId: string) => api.get<StudentProfile>(`/learners/${encodeURIComponent(learnerId)}/profile`),
}

export const profileKeys = {
  all: ['pd17-profiles'] as const,
  parents: (q: string, access: ParentAccessFilter = 'all') => ['pd17-profiles', 'parents', q, access] as const,
  parent: (id: string) => ['pd17-profiles', 'parent', id] as const,
  billing: (familyId: string) => ['pd17-profiles', 'billing', familyId] as const,
  student: (id: string) => ['pd17-profiles', 'student', id] as const,
}

/** Where each profile lives: one URL per person, whoever opens it. */
/** PD-44: the Parents list's subscription filter -- families with a child locked, or in the grace period. */
export type ParentAccessFilter = 'all' | 'locked' | 'grace'

export const parentPath = (id: string) => `/parents/${encodeURIComponent(id)}`
export const studentPath = (id: string) => `/students/${encodeURIComponent(id)}`
