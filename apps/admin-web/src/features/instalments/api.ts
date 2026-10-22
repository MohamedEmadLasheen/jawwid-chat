import { api } from '@/core/api/client'

/**
 * PD-12 S3 wire contract, mirrored from apps/api/src/billing. Since PD-17 the
 * instalments are Jawwid Chat's own records (chat.family_instalment), written
 * on each family's Parent Profile; this page shows what the server derived
 * (status, order, responsible supervisor).
 */
export type InstalmentStatus = 'overdue' | 'due' | 'upcoming' | 'paid'

export interface Instalment {
  id: string
  family: { id: string; name: string }
  /** The payer: the family's primary parent, whose Parent Profile the row opens. */
  account: { id: string | null; name: string }
  /** null = a family instalment. */
  child: { id: string | null; name: string | null; known: boolean } | null
  amountMinor: number
  currency: string
  /** YYYY-MM-DD. */
  dueDate: string
  status: InstalmentStatus
  days: number
  paidAt: string | null
  label: string | null
  responsibleSupervisor: { id: string; name: string } | null
  responsibleBasis: 'child' | 'family'
  conversationId: string | null
}

export interface InstalmentList {
  today: string
  canAssignBillingSupervisor: boolean
  items: Instalment[]
  counts: Record<InstalmentStatus | 'unassigned', number>
}

export type Responsible = 'all' | 'me' | 'none'
export type InstalmentQuery = { responsible: Responsible; paid: boolean }

export interface BillingSupervisorView {
  familyId: string
  current: { id: string; name: string | null; assignedAt: string } | null
  candidates: Array<{ id: string; name: string; children: string[] }>
  canAssign: boolean
}

export const instalmentsApi = {
  /** PD-27 adds `canVerifyPayments`: refunds and payment settings (receipts are decided by `canRecordPayments`). */
  access: () =>
    api.get<{ billingReader: boolean; canAssignBillingSupervisor: boolean; canRecordPayments?: boolean; canVerifyPayments?: boolean }>(
      '/instalments/access',
    ),
  list: (q: InstalmentQuery) =>
    api.get<InstalmentList>('/instalments', { responsible: q.responsible, ...(q.paid ? { paid: 'true' } : {}) }),
  billingSupervisor: (familyId: string) =>
    api.get<BillingSupervisorView>(`/families/${encodeURIComponent(familyId)}/billing-supervisor`),
  setBillingSupervisor: (familyId: string, body: { supervisorId: string | null; reason: string }) =>
    api.post<{ familyId: string; supervisorId: string | null; changed: boolean }>(
      `/families/${encodeURIComponent(familyId)}/billing-supervisor`,
      body,
    ),
}

export const instalmentKeys = {
  all: ['instalments'] as const,
  access: ['instalments', 'access'] as const,
  list: (q: InstalmentQuery) => ['instalments', 'list', q] as const,
  billingSupervisor: (familyId: string) => ['instalments', 'billing-supervisor', familyId] as const,
}
