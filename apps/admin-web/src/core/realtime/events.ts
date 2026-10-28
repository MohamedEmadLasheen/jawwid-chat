import type { Task } from '@/shared/types/domain'

/**
 * Realtime events are SIGNALS, NOT STATE.
 *
 * On receipt we invalidate the affected query and refetch. We never patch a
 * bucket, a score, or a workload level into the cache from an event payload —
 * that would make the client a second (and wrong) source of computed truth,
 * which brief §12 forbids. Refetching is also what makes concurrent edits
 * reconcile to the server rather than to whichever tab wrote last.
 */
export interface ServerEvents {
  'task.updated': { task: Task }
  'coverage.changed': { family_ids?: string[]; effective_at: string }
}

export type ServerEventName = keyof ServerEvents

export type ConnectionState = 'connecting' | 'connected' | 'disconnected'
