import { api } from '@/core/api/client'

/** PD-35 B5: escalation cases (apps/api src/cases). Who may open, see and act is the server's. */
export type CaseSubjectKind = 'teacher' | 'lesson' | 'learner' | 'complaint' | 'feedback'
export type CaseTarget = 'teachers' | 'operations'
export type CaseStatus = 'open' | 'in_progress' | 'resolved' | 'cancelled'
export type CaseTab = 'mine' | 'opened' | 'department'

export interface Named {
  id: string
  name: string
}

export interface CaseSummary {
  id: string
  title: string
  body: string | null
  status: CaseStatus
  target: CaseTarget
  subject: { kind: CaseSubjectKind; id: string; label: string }
  teacher: Named | null
  learner: Named | null
  owner: Named | null
  openedBy: Named
  /** YYYY-MM-DD on the academy's calendar. */
  dueOn: string | null
  createdAt: string
  updatedAt: string
  closedAt: string | null
}

export interface CaseEvent {
  id: string
  kind: 'opened' | 'assigned' | 'status' | 'due' | 'note'
  actor: Named
  at: string
  note: string | null
  before?: Record<string, unknown> | null
  after?: Record<string, unknown> | null
}

export interface CaseDetail extends CaseSummary {
  /** Owner, the target department's manager or the super admin. */
  canAct: boolean
  events: CaseEvent[]
}

export interface NewCase {
  subject: { kind: CaseSubjectKind; id: string }
  target: CaseTarget
  title: string
  body?: string
  dueOn?: string
}

export const casesApi = {
  list: (tab: CaseTab, status: 'open' | 'closed' | 'all') => api.get<{ cases: CaseSummary[] }>('/cases', { tab, status }),
  get: (id: string) => api.get<CaseDetail>(`/cases/${encodeURIComponent(id)}`),
  owners: (id: string) => api.get<{ owners: Named[] }>(`/cases/${encodeURIComponent(id)}/owners`),
  open: (body: NewCase) => api.post<CaseSummary>('/cases', body),
  assign: (id: string, ownerId: string) => api.post<CaseDetail>(`/cases/${encodeURIComponent(id)}/assign`, { ownerId }),
  setStatus: (id: string, status: Exclude<CaseStatus, 'open'>, note?: string) =>
    api.post<CaseDetail>(`/cases/${encodeURIComponent(id)}/status`, note ? { status, note } : { status }),
  setDue: (id: string, dueOn: string | null) => api.post<CaseDetail>(`/cases/${encodeURIComponent(id)}/due`, { dueOn }),
  note: (id: string, note: string) => api.post<CaseDetail>(`/cases/${encodeURIComponent(id)}/notes`, { note }),
}
