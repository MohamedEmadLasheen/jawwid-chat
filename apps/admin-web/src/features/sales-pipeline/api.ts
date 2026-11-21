import { api } from '@/core/api/client'

/**
 * PD-59: the Sales pipeline, mirrored from apps/api/src/sales-pipeline. The
 * server decides who may use it on every call (Sales and the super admin); a
 * list row carries only WHETHER a channel exists, and the contact itself
 * arrives with the detail read, which the server audits.
 */

export const STAGES = ['new_lead', 'contacted', 'trial_booked', 'trial_completed', 'converted', 'lost'] as const
export type Stage = (typeof STAGES)[number]

export const LOST_REASONS = ['price', 'schedule', 'not_ready', 'chose_other', 'no_response', 'other'] as const
export type LostReason = (typeof LOST_REASONS)[number]

export interface ContactPresence {
  phone: boolean
  whatsapp: boolean
  email: boolean
}

export interface LeadRow {
  id: string
  displayName: string
  level: string | null
  stage: Stage
  /** A stored reason, a trial's reason code, or 'no_show'. */
  lostReason: string | null
  /** True when a person may move the stage; false when a trial or the hand-over decides it. */
  manualStage: boolean
  lastContactedAt: string | null
  nextFollowUpOn: string | null
  followUpDue: boolean
  followUpNote: string | null
  createdAt: string
  handedOver: boolean
  contact: ContactPresence
}

export interface LeadPage {
  leads: LeadRow[]
  total: number
  counts: Record<Stage, number>
  dueCount: number
  limit: number
  offset: number
  truncated: boolean
}

export interface LeadContact {
  parentName: string
  phone: string | null
  whatsapp: string | null
  email: string | null
  country: string | null
}

export interface LeadDetail {
  id: string
  displayName: string
  level: string | null
  note: string | null
  stage: Stage
  lostReason: string | null
  manualStage: boolean
  lastContactedAt: string | null
  nextFollowUpOn: string | null
  followUpDue: boolean
  followUpNote: string | null
  createdAt: string
  convertedAt: string | null
  familyId: string | null
  canConvert: boolean
  trial: { startsAt: string; result: string | null } | null
  /** Null when the lead has no contact (or it moved to the family's record on conversion). */
  contact: LeadContact | null
}

export interface ContactInput {
  parentName?: string | null
  phone?: string | null
  whatsapp?: string | null
  email?: string | null
  country?: string | null
}

export interface CreateLeadInput {
  displayName: string
  level?: string | null
  note?: string | null
  contact?: ContactInput
  nextFollowUpOn?: string | null
  followUpNote?: string | null
}

export interface UpdateLeadInput {
  stage?: 'new_lead' | 'contacted' | 'lost'
  lostReason?: LostReason
  contact?: ContactInput
  nextFollowUpOn?: string | null
  followUpNote?: string | null
}

export type ConvertResult = { outcome: 'linked'; familyId: string } | { outcome: 'intake_required'; familyId: null }

export interface LeadQuery {
  stage?: Stage | ''
  q?: string
  followUp?: 'due' | ''
  limit?: number
  offset?: number
}

export const pipelineKeys = {
  all: ['sales-pipeline'] as const,
  list: (q: LeadQuery) => ['sales-pipeline', 'leads', q] as const,
  detail: (id: string) => ['sales-pipeline', 'lead', id] as const,
}

const enc = (id: string) => encodeURIComponent(id)

export const pipelineApi = {
  list: (q: LeadQuery) => {
    const query: Record<string, string> = {}
    if (q.stage) query.stage = q.stage
    if (q.q) query.q = q.q
    if (q.followUp) query.followUp = q.followUp
    if (q.limit) query.limit = String(q.limit)
    if (q.offset) query.offset = String(q.offset)
    return api.get<LeadPage>('/sales-pipeline/leads', query)
  },
  get: (id: string) => api.get<LeadDetail>(`/sales-pipeline/leads/${enc(id)}`),
  create: (body: CreateLeadInput) => api.post<LeadDetail>('/sales-pipeline/leads', body),
  update: (id: string, body: UpdateLeadInput) => api.post<LeadDetail>(`/sales-pipeline/leads/${enc(id)}`, body),
  contacted: (id: string, body: { nextFollowUpOn?: string | null; followUpNote?: string | null }) =>
    api.post<LeadDetail>(`/sales-pipeline/leads/${enc(id)}/contacted`, body),
  convert: (id: string) => api.post<ConvertResult>(`/sales-pipeline/leads/${enc(id)}/convert`, {}),
}
