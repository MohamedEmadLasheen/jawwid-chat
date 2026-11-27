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
export function groupQueue<T extends Queued>(
  rows: readonly T[],
  lead: (c: T) => number = () => 0,
  /** What asks this viewer to act: owed an answer, by default; the list adds an unseen summons. */
  asks: (c: T) => boolean = (c) => !!c.needsReply,
): QueueSection<T>[] {
  const byLead = (a: T, b: T) => lead(b) - lead(a)
  const needs = rows.filter(asks).sort((a, b) => byLead(a, b) || at(a) - at(b))
  const unread = rows.filter((c) => !asks(c) && (c.unreadCount ?? 0) > 0).sort(byLead)
  const rest = rows.filter((c) => !asks(c) && (c.unreadCount ?? 0) === 0).sort(byLead)
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
  // Arabic in words ("3 ساعات", "18 دقيقة"): its short units are single letters nobody reads at a glance.
  return new Intl.NumberFormat(locale === 'ar' ? 'ar-EG-u-nu-latn' : 'en-GB', { style: 'unit', unit, unitDisplay: locale === 'ar' ? 'long' : 'short' }).format(value)
}

/**
 * How long a family may wait for an answer before the wait is the row's
 * warning (amber) and then its problem (red). The API carries no reply target
 * of its own (no SLA field exists), so this is the client's one named
 * constant: a reply within two hours, the second hour being the warning.
 */
export const REPLY_WAIT = { soonMinutes: 60, lateMinutes: 120 } as const

export type WaitTone = 'calm' | 'soon' | 'late'

/** Grey while there is time, amber in the last window, red past it. */
export function waitTone(iso: string, now: number = Date.now()): WaitTone {
  const minutes = (now - new Date(iso).getTime()) / 60_000
  return minutes >= REPLY_WAIT.lateMinutes ? 'late' : minutes >= REPLY_WAIT.soonMinutes ? 'soon' : 'calm'
}

/** PD-36: the viewer was asked into this chat and has not opened it since. */
export function isUnseenSummons(c: Pick<ChatConversation, 'viewerState'>): boolean {
  const m = c.viewerState?.mention
  return !!m && m.kind === 'summons' && m.state === 'pending' && !m.seen
}

/** What asks this viewer to act: a family owed an answer, or an unseen summons. */
export const asksViewer = (c: ChatConversation): boolean => c.needsReply || isUnseenSummons(c)

/** Still owed an answer, the one to take first leading; the viewer's own archive and closed conversations left out. */
export function waitingFirst(conversations: ChatConversation[]): ChatConversation[] {
  const live = conversations.filter((c) => !c.viewerState?.archived && c.archivedAt === null)
  return groupQueue(live, () => 0, asksViewer)
    .filter((s) => s.key !== 'rest')
    .flatMap((s) => (s.key === 'unread' ? [...s.rows].sort((a, b) => at(a) - at(b)) : s.rows))
}
