import { api, newIdempotencyKey } from '@/core/api/client'

/**
 * WP-1C (PD-57): the moderation queue's API. Built against the FROZEN contract
 * in docs/release/google-play-blocker-roadmap-2026-11-03.md §5.4:
 *
 *   GET  /moderation/reports?status&priority&overdue   (moderation.view)
 *   GET  /moderation/reports/:id                        (moderation.view; the server audits `report.viewed`)
 *   POST /moderation/reports/:id/take                   (moderation.act)  -> 200
 *   POST /moderation/reports/:id/resolve                (moderation.act)  {resolution, note?, answer}
 *
 * §5.4 does not spell out the queue row or detail shape, so the types below
 * are the §5.3 column names in camelCase, and every field the page does not
 * need is left out on purpose. §5.5: the reporter's identity is never typed,
 * stored or rendered here, even if a response were to carry it.
 */
export const REASONS = ['harassment', 'inappropriate', 'spam', 'child_safety', 'other'] as const
export type ReportReason = (typeof REASONS)[number]
/** `blocked` is set only by the server (WP-2); it is shown but not offered as a filter. */
export type ReportReasonOrBlocked = ReportReason | 'blocked'

export const STATUSES = ['open', 'in_review', 'actioned', 'dismissed'] as const
export type ReportStatus = (typeof STATUSES)[number]

export type ReportPriority = 'urgent' | 'normal'

export const RESOLUTIONS = ['no_action', 'message_removed', 'warned', 'account_suspended', 'reassigned'] as const
export type Resolution = (typeof RESOLUTIONS)[number]

export const ANSWER_MAX = 1000

export interface QueueReport {
  id: string
  targetKind: 'message' | 'person'
  reason: ReportReasonOrBlocked
  priority: ReportPriority
  status: ReportStatus
  createdAt: string
  dueAt: string
  /** Set by the server's sweep at 48 h. */
  overdueAt?: string | null
  /** Who took it: the reviewer, a staff member. Never the reporter. */
  takenBy?: string | null
  reporterAnsweredAt?: string | null
}

export interface ReportEvidence {
  body?: string | null
  /** The snapshot's attachment keys are names, not capabilities: only their number is shown. */
  attachments?: unknown[] | null
  author?: { name?: string | null } | null
  sentAt?: string | null
  deletedAt?: string | null
}

export interface ReportDetail extends QueueReport {
  note?: string | null
  evidence?: ReportEvidence | null
  resolution?: Resolution | null
  resolutionNote?: string | null
  resolvedAt?: string | null
  answerText?: string | null
}

export interface QueueFilters {
  status?: ReportStatus
  overdue?: boolean
  /** The child-safety filter: the contract's `priority=urgent`. */
  urgent?: boolean
}

export const moderationKeys = {
  all: ['moderation', 'reports'] as const,
  list: (f: QueueFilters) => ['moderation', 'reports', 'list', f.status ?? '', f.overdue ? 'overdue' : '', f.urgent ? 'urgent' : ''] as const,
  one: (id: string) => ['moderation', 'reports', 'one', id] as const,
}

export const moderationApi = {
  async list(f: QueueFilters): Promise<QueueReport[]> {
    const res = await api.get<QueueReport[] | { items: QueueReport[] }>('/moderation/reports', {
      status: f.status,
      priority: f.urgent ? 'urgent' : undefined,
      overdue: f.overdue ? true : undefined,
    })
    return Array.isArray(res) ? res : res.items
  },
  get: (id: string) => api.get<ReportDetail>(`/moderation/reports/${encodeURIComponent(id)}`),
  take: (id: string, key: string = newIdempotencyKey()) =>
    api.post<unknown>(`/moderation/reports/${encodeURIComponent(id)}/take`, undefined, key),
  resolve: (id: string, body: { resolution: Resolution; note?: string; answer: string }, key: string = newIdempotencyKey()) =>
    api.post<unknown>(`/moderation/reports/${encodeURIComponent(id)}/resolve`, body, key),
}
