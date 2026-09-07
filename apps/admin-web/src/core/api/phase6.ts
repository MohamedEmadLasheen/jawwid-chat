import { api } from './client'

/**
 * PHASE 6 -- smart moderation and the Manager Command Center.
 *
 * TWO RULES SHAPE EVERY SIGNATURE HERE.
 *
 * 1. THE CLIENT NEVER DECIDES ANYTHING. It does not compute a KPI, it does not
 *    filter a queue, and it does not work out whether a supervisor is
 *    overloaded. Every number on the Command Center is aggregated in the
 *    database and every queue item is scoped by the server. This module has no
 *    type that could express a client-side count even by accident.
 *
 * 2. THE PATTERNS ARE PRIVILEGED. A rule's `pattern` is served only to actors
 *    holding `messages.moderate` or `moderation_rules.manage`, and the
 *    sender-facing view of a held message carries no flags at all -- publishing
 *    the detection patterns to the people being detected would tell them how to
 *    word their way past them.
 */

// ---------------------------------------------------------------- vocabulary

export type ModerationCategory =
  | 'phone_number'
  | 'email_address'
  | 'url'
  | 'forbidden_word'
  | 'forbidden_phrase'
  | 'cancellation'
  | 'resignation'
  | 'custom'

export type ModerationSeverity = 'low' | 'medium' | 'high' | 'critical'
export type MatchType = 'word' | 'phrase' | 'regex'
/** policy = everything from this role is held here. scan = a rule matched. */
export type ApprovalTrigger = 'policy' | 'scan'
export type OverloadLevel = 'ok' | 'warning' | 'overloaded'

export const MODERATION_CATEGORIES: readonly ModerationCategory[] = [
  'phone_number', 'email_address', 'url',
  'forbidden_word', 'forbidden_phrase',
  'cancellation', 'resignation', 'custom',
]

export const SEVERITIES: readonly ModerationSeverity[] = ['low', 'medium', 'high', 'critical']
export const MATCH_TYPES: readonly MatchType[] = ['word', 'phrase', 'regex']

// ------------------------------------------------------------------- queue

export interface ModerationFlag {
  ruleId: string | null
  ruleName: string
  category: ModerationCategory
  severity: ModerationSeverity
  matchedExcerpt: string | null
}

export interface QueueItem {
  approvalId: string
  conversationId: string
  messageId: string
  requestedBy: string
  requestedByName: string | null
  approverId: string | null
  createdAt: string
  conversationType: string
  conversationTitle: string | null
  familyId: string | null
  trigger: ApprovalTrigger
  highestSeverity: ModerationSeverity | null
  flags: ModerationFlag[]
  pendingForMs: number
  escalatedAt: string | null
  escalatedTo: string | null
  /**
   * What the sender actually submitted, whatever happened to it afterwards.
   * Never truncated in the UI: you cannot approve what you cannot read.
   */
  originalBody: string | null
  editedAt: string | null
  editedBy: string | null
  message: { id: string; body: string | null; type: string; createdAt: string }
}

export interface QueueFilter {
  conversationId?: string
  escalated?: boolean
  severity?: ModerationSeverity
  trigger?: ApprovalTrigger
}

export const moderationApi = {
  queue: (f: QueueFilter = {}) =>
    api
      .get<{ items: QueueItem[] }>('/moderation/queue', {
        ...(f.conversationId ? { conversationId: f.conversationId } : {}),
        ...(f.escalated ? { escalated: 'true' } : {}),
        ...(f.severity ? { severity: f.severity } : {}),
        ...(f.trigger ? { trigger: f.trigger } : {}),
      })
      .then((r) => r.items),

  approve: (approvalId: string) =>
    api.post<{ ok: true }>(`/approvals/${approvalId}/approve`),

  reject: (approvalId: string, reason: string) =>
    api.post<{ ok: true }>(`/approvals/${approvalId}/reject`, { reason }),

  /** Sends the edited body; the original stays recoverable server-side. */
  editAndSend: (approvalId: string, body: string, reason?: string) =>
    api.post<{ ok: true }>(`/moderation/queue/${approvalId}/edit-and-send`, { body, reason }),

  /** Rejects AND withdraws. Requires `messages.delete`. */
  remove: (approvalId: string, reason: string) =>
    api.post<{ ok: true }>(`/moderation/queue/${approvalId}/delete`, { reason }),
}

// ------------------------------------------------------------------- rules

export interface ModerationRule {
  id: string
  name: string
  category: ModerationCategory
  severity: ModerationSeverity
  matchType: MatchType
  pattern: string
  /** Built-ins may be disabled and retuned, never deleted. */
  isBuiltin: boolean
  isEnabled: boolean
  notes: string | null
  createdAt: string
  updatedAt: string
}

export interface RuleDraft {
  name: string
  category: ModerationCategory
  severity: ModerationSeverity
  matchType: MatchType
  pattern: string
  isEnabled?: boolean
  notes?: string | null
}

export const ruleApi = {
  list: () => api.get<{ rules: ModerationRule[] }>('/moderation/rules').then((r) => r.rules),
  create: (draft: RuleDraft) =>
    api.post<{ rule: ModerationRule }>('/moderation/rules', draft).then((r) => r.rule),
  update: (id: string, patch: Partial<RuleDraft>) =>
    api.patch<{ rule: ModerationRule }>(`/moderation/rules/${id}`, patch).then((r) => r.rule),
  setEnabled: (id: string, enabled: boolean) =>
    api
      .post<{ rule: ModerationRule }>(`/moderation/rules/${id}/enabled`, { enabled })
      .then((r) => r.rule),
  // There is deliberately no `delete`. A rule is disabled, so the flags that
  // reference it keep pointing at something -- and the API serves no such route.
}

// ---------------------------------------------------------- command center

export interface CommandCenterKpis {
  unansweredMessages: number
  pendingApprovals: number
  escalatedApprovals: number
  overloadedSupervisors: number
  openConversations: number
  closedConversations: number
  activeFamilies: number
  calls: number
  missedClassCalls: number
  windowHours: number
  /** Rendered as "as of 14:22". Stale numbers presented as live are worse than none. */
  asOf: string
}

export interface OverloadThresholds {
  unansweredWarning: number
  unansweredHigh: number
  pendingWarning: number
  pendingHigh: number
}

export interface SupervisorLoad {
  staffId: string
  name: string
  role: string
  presence: string
  families: number
  openConversations: number
  unanswered: number
  unreadMessages: number
  pendingApprovals: number
  escalated: number
  oldestWaitMs: number
  overload: OverloadLevel
  /** Why the level says what it says. Never rendered without it. */
  reasons: string[]
}

export interface AttentionRow {
  conversationId: string
  familyId: string | null
  familyName: string | null
  conversationType: string
  conversationTitle: string | null
  supervisorId: string
  supervisorName: string
  waitingSince: string
  waitingMs: number
  pendingApprovals: number
}

export const commandCenterApi = {
  kpis: () =>
    api.get<{ kpis: CommandCenterKpis; thresholds: OverloadThresholds }>('/command-center/kpis'),
  supervisors: () =>
    api.get<{ supervisors: SupervisorLoad[]; thresholds: OverloadThresholds }>(
      '/command-center/supervisors',
    ),
  /** The conversations behind a number. This is what makes a tile clickable. */
  attention: (staffId?: string, limit = 50) =>
    api
      .get<{ items: AttentionRow[] }>('/command-center/attention', {
        ...(staffId ? { staffId } : {}),
        limit: String(limit),
      })
      .then((r) => r.items),
}

// ------------------------------------------------------------------ display

/** Elapsed time, in the words an operator uses. Never a raw millisecond count. */
export function humanDuration(ms: number): string {
  const minutes = Math.floor(ms / 60_000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ${minutes % 60}m`
  return `${Math.floor(hours / 24)}d ${hours % 24}h`
}

/**
 * Severity and overload, mapped onto the EXISTING design-system tones.
 *
 * No new visual language: `danger`, `today` and `ok` are the tones the console
 * already uses for "act now", "soon" and "fine", and Phase 6 borrows them
 * rather than introducing a parallel palette.
 *
 * `critical` and `high` are both `danger` on purpose: an operator scanning a
 * queue reads two levels of "act now", not four. The exact word is rendered on
 * the badge beside the colour, so colour is never the only signal.
 */
export type BadgeTone = 'danger' | 'today' | 'ok' | 'neutral'

export function severityTone(s: ModerationSeverity | null): BadgeTone {
  if (s === 'critical' || s === 'high') return 'danger'
  if (s === 'medium') return 'today'
  return 'neutral'
}

export function overloadTone(level: OverloadLevel): BadgeTone {
  return level === 'overloaded' ? 'danger' : level === 'warning' ? 'today' : 'ok'
}
