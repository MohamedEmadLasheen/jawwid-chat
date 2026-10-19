import { api } from '@/core/api/client'

/**
 * The Calls page's reads and writes (PD-13 + W8-W2). Everything here is the
 * server's answer: who may schedule, who may see, who may join and what each
 * call's outcome was. The page never derives a permission from these shapes.
 *
 * Shapes mirror docs/communication/scheduled-calls.md and
 * apps/api/src/communication/calls/call.service.ts (`toHistoryRow`).
 */

export type ScheduledCallKind = 'scheduled' | 'link'
export type ScheduledCallState = 'upcoming' | 'open' | 'cancelled' | 'over'

export interface ScheduledCall {
  id: string
  conversationId: string
  kind: ScheduledCallKind
  title: string | null
  startsAt: string
  joinableFrom: string
  joinableUntil: string
  /** Computed with the server's clock at response time; re-derive "can join" from the window. */
  state: ScheduledCallState
  createdBy: { actorId: string; displayName: string | null }
  canCancel: boolean
}

export interface CreateScheduledCall {
  conversationId: string
  kind: ScheduledCallKind
  /** Required for `scheduled`; a link starts now. */
  startsAt?: string
  title?: string
}

/** One row of the ACCOUNT's call history (`GET /calls/history`). */
export interface AccountCallRow {
  id: string
  conversationId: string
  type: 'direct' | 'group' | string
  status: string
  outcome: 'answered' | 'missed' | 'declined' | string | null
  initiatorId: string
  startedAt: string
  endedAt: string | null
  durationSeconds: number | null
  participants: Array<{
    actorId: string
    actorKind: string
    displayName: string | null
    joinedAt: string | null
    leftAt: string | null
  }>
}

export interface AccountHistoryPage {
  items: AccountCallRow[]
  nextCursor: string | null
}

const sc = (id: string) => `/scheduled-calls/${encodeURIComponent(id)}`

export const callsPageApi = {
  upcoming: () => api.get<{ items: ScheduledCall[] }>('/scheduled-calls').then((r) => r.items),
  get: (id: string) => api.get<ScheduledCall>(sc(id)),
  create: (input: CreateScheduledCall) => api.post<ScheduledCall>('/scheduled-calls', input),
  cancel: (id: string) => api.post<ScheduledCall>(`${sc(id)}/cancel`),
  history: (cursor?: string | null, limit = 30) =>
    api.get<AccountHistoryPage>('/calls/history', { cursor: cursor ?? undefined, limit }),
}

export const callsPageKeys = {
  all: ['calls-page'] as const,
  upcoming: ['calls-page', 'upcoming'] as const,
  scheduled: (id: string) => ['calls-page', 'scheduled', id] as const,
  history: ['calls-page', 'history'] as const,
}
