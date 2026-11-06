import { api, newIdempotencyKey } from '@/core/api/client'

/**
 * WP-1C (PD-57): the moderation queue's API. Built against roadmap §5.4 as
 * amended by docs/release/pd57-closure-plan-2026-11-06.md §3-§4 (which wins):
 *
 *   GET  /moderation/reports?status&priority&overdue   (moderation.view)
 *   GET  /moderation/reports/:id                        (moderation.view; the server audits `report.viewed`)
 *   POST /moderation/reports/:id/take                   (moderation.act)  -> 200
 *   POST /moderation/reports/:id/resolve                (moderation.act)  {resolution, note?, answer}
 *   POST /moderation/reports/:id/attachments/:index/url (moderation.view) -> {url, expiresAt}, 5 min
 *
 * Access is scoped on the server (Super Admin: all; others: their departments;
 * child_safety: Super Admin + moderation.child_safety). A report this reviewer
 * may not see answers 404 everywhere, so the UI never assumes it sees it all.
 * §5.5: the reporter's identity is never typed, stored or rendered here, even
 * if a response were to carry it. The *subject* (the reported person) is shown.
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

/** Resolutions the server refuses without a note (closure plan §4). */
export const NOTE_REQUIRED: readonly Resolution[] = ['reassigned', 'account_suspended']

export type SubjectKind = 'contact' | 'teacher' | 'staff'
/** The reported person (never the reporter). */
export interface ReportSubject {
  kind: SubjectKind
  id: string
  name: string
}

/** Attachment metadata only: no object key ever reaches the console. */
export interface EvidenceAttachment {
  index: number
  kind: string
  mime: string
  name: string
  size: number
}

export interface QueueReport {
  id: string
  targetKind: 'message' | 'person'
  reason: ReportReasonOrBlocked
  priority: ReportPriority
  status: ReportStatus
  createdAt: string
  dueAt: string
  /** Set by the server's sweep at 24 h (D-1). */
  overdueAt?: string | null
  /** Who took it: the reviewer, a staff member. Never the reporter. */
  takenBy?: string | null
  reporterAnsweredAt?: string | null
  subject: ReportSubject
}

export interface ReportEvidence {
  body?: string | null
  attachments?: EvidenceAttachment[] | null
  author?: { name?: string | null } | null
  sentAt?: string | null
  deletedAt?: string | null
}

export interface ReportDetail extends QueueReport {
  /** Whether this reviewer may take/resolve this report. UX only: the server still decides. */
  canAct: boolean
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
  /** A fresh signed GET (5 min) per call; audited server-side. Never cached. */
  attachmentUrl: (id: string, index: number) =>
    api.post<{ url: string; expiresAt: string }>(`/moderation/reports/${encodeURIComponent(id)}/attachments/${index}/url`),
}
