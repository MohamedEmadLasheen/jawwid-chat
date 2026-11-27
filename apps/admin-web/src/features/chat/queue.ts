import type { ChatConversation } from './chatApi'

/**
 * The conversation list is a work queue, not a flat inbox: what is owed an
 * answer first (the longest wait leading), then what is unread, then
 * everything else by recency. Pure views of the list the server returned.
 */
export type QueueKey = 'needs' | 'unread' | 'rest'

export interface QueueSection<T> {
  key: QueueKey
  rows: T[]
}

interface Queued {
  needsReply?: boolean
  unreadCount?: number
  lastActivityAt: string
}

const at = (c: Queued) => new Date(c.lastActivityAt).getTime()

/**
 * `lead` ranks what stays on top inside its section (asked in: 2, pinned: 1).
 * Rows arrive most recent first, and keep that order where nothing else decides.
 */
export function groupQueue<T extends Queued>(rows: readonly T[], lead: (c: T) => number = () => 0): QueueSection<T>[] {
  const byLead = (a: T, b: T) => lead(b) - lead(a)
  const needs = rows.filter((c) => c.needsReply).sort((a, b) => byLead(a, b) || at(a) - at(b))
  const unread = rows.filter((c) => !c.needsReply && (c.unreadCount ?? 0) > 0).sort(byLead)
  const rest = rows.filter((c) => !c.needsReply && (c.unreadCount ?? 0) === 0).sort(byLead)
  const sections: QueueSection<T>[] = [
    { key: 'needs', rows: needs },
    { key: 'unread', rows: unread },
    { key: 'rest', rows: rest },
  ]
  return sections.filter((s) => s.rows.length > 0)
}

/** "34 min", "2 hr", "3 days" / "34 د", "2 س": how long something has waited, short enough for a row's end. */
export function waitedFor(iso: string, locale: 'ar' | 'en', now: number = Date.now()): string {
  const minutes = Math.max(0, Math.round((now - new Date(iso).getTime()) / 60_000))
  const [value, unit] = minutes < 60 ? [Math.max(1, minutes), 'minute'] : minutes < 1440 ? [Math.round(minutes / 60), 'hour'] : [Math.round(minutes / 1440), 'day']
  return new Intl.NumberFormat(locale === 'ar' ? 'ar-EG-u-nu-latn' : 'en-GB', { style: 'unit', unit, unitDisplay: 'short' }).format(value)
}

/** Still owed an answer, the one to take first leading; the viewer's own archive and closed conversations left out. */
export function waitingFirst(conversations: ChatConversation[]): ChatConversation[] {
  const live = conversations.filter((c) => !c.viewerState?.archived && c.archivedAt === null)
  return groupQueue(live)
    .filter((s) => s.key !== 'rest')
    .flatMap((s) => (s.key === 'unread' ? [...s.rows].sort((a, b) => at(a) - at(b)) : s.rows))
}
