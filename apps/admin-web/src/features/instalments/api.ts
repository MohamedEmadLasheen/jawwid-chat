import { api } from '@/core/api/client'

/**
 * PD-12 S3 wire contract, mirrored from apps/api/src/billing. Every invoice is
 * Jawwid Core's, read by the server at request time and never stored; this
 * page shows what the server derived (status, order, responsible supervisor).
 */
export type InstalmentStatus = 'overdue' | 'due' | 'upcoming' | 'paid'

export interface Instalment {
  id: string
  family: { id: string; name: string }
  account: { name: string }
  /** null = a family invoice; `known: false` = Core named a child Chat does not have in this family. */
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
  /** `not_connected`: Core's invoice API is not connected in this deployment. */
  source: 'core' | 'not_connected'
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
  access: () => api.get<{ billingReader: boolean; canAssignBillingSupervisor: boolean; coreConnected: boolean }>('/instalments/access'),
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
