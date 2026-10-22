import { api } from '@/core/api/client'

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

export type PaymentMethod = 'invoice' | 'bank_transfer'
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
  payment: { paidOn: string; method: PaymentMethod; reference: string | null; recordedAt: string; recordedBy: { id: string; name: string } } | null
  void: { at: string; by: { id: string; name: string }; reason: string } | null
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
  parents: (q: string) => api.get<{ items: ParentListItem[]; truncated: boolean }>('/parent-profiles', q ? { q } : undefined),
  parent: (id: string) => api.get<ParentProfile>(parent(id)),
  updateParent: (id: string, body: ParentUpdate) => api.post<ParentProfile>(parent(id), body),
  authorizePhoto: (id: string, mimeType: string, byteSize: number) =>
    api.post<AvatarUploadGrant>(`${parent(id)}/avatar/upload`, { mimeType, byteSize }),
  commitPhoto: (id: string, objectKey: string) => api.post<{ avatarUrl: string | null }>(`${parent(id)}/avatar`, { objectKey }),
  removePhoto: (id: string) => api.delete<{ avatarUrl: null }>(`${parent(id)}/avatar`),

  billing: (familyId: string) => api.get<FamilyBilling>(`${family(familyId)}/billing`),
  updateBilling: (familyId: string, body: BillingUpdate) => api.post<FamilyBilling>(`${family(familyId)}/billing`, body),
  createInstalments: (familyId: string, body: NewInstalments) => api.post<FamilyBilling>(`${family(familyId)}/instalments`, body),
  recordPayment: (id: string, body: { paidOn: string; method: PaymentMethod; reference?: string }) =>
    api.post<FamilyBilling>(`/instalments/${encodeURIComponent(id)}/payment`, body),
  voidInstalment: (id: string, reason: string) => api.post<FamilyBilling>(`/instalments/${encodeURIComponent(id)}/void`, { reason }),

  student: (learnerId: string) => api.get<StudentProfile>(`/learners/${encodeURIComponent(learnerId)}/profile`),
}

export const profileKeys = {
  all: ['pd17-profiles'] as const,
  parents: (q: string) => ['pd17-profiles', 'parents', q] as const,
  parent: (id: string) => ['pd17-profiles', 'parent', id] as const,
  billing: (familyId: string) => ['pd17-profiles', 'billing', familyId] as const,
  student: (id: string) => ['pd17-profiles', 'student', id] as const,
}

/** Where each profile lives: one URL per person, whoever opens it. */
export const parentPath = (id: string) => `/parents/${encodeURIComponent(id)}`
export const studentPath = (id: string) => `/students/${encodeURIComponent(id)}`
