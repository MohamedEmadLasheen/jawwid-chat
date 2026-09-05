import type { AttentionBucket, Case, Handoff, HandlingMode, Message, Presence, Task } from '@/shared/types/domain'

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
  'family.updated': {
    family_id: string
    bucket: AttentionBucket
    top_reason: string
    needs_reply: boolean
    on_duty_id: string | null
    handling_mode: HandlingMode
  }
  'message.created': { family_id: string; message: Message }
  'case.updated': { family_id: string; case: Case }
  'task.updated': { task: Task }
  'handoff.created': { handoff: Handoff }
  'coverage.changed': { family_ids?: string[]; effective_at: string }
  'ownership.changed': { family_id: string; from: string; to: string }
  'unattended.changed': { count: number }
  'escalation.created': { family_id: string; case_id: string; reason: string }
  'presence.changed': { staff_id: string; presence: Presence }
  'shift.ending': { minutes_remaining: number; waiting_count: number; follow_up_count: number }
}

export type ServerEventName = keyof ServerEvents

export type ConnectionState = 'connecting' | 'connected' | 'disconnected'
