/**
 * Domain types for Jawwid Chat.
 *
 * Mirrors the data model in the project brief (docs/JAWWID_CHAT_BRIEF.txt §3)
 * and the contract in docs/admin/backend-contract-required.md.
 *
 * Rules that these types deliberately encode:
 *  - `super_admin` exists (PD-5, closed 2026-09-07; the earlier "there is no
 *    super_admin" rule was withdrawn as D-1). It is the organization owner and
 *    the only role that reaches the read-only `/admin` inspection surface.
 *  - `workload_level` has no CRITICAL level.
 */

export type StaffRole =
  | 'admin'
  | 'coverage'
  | 'manager'
  | 'finance'
  | 'technical'
  | 'academic'
  | 'super_admin'
  | 'system'

export type Presence = 'online' | 'away' | 'offline'

export interface Staff {
  id: string
  name: string
  role: StaffRole
  presence: Presence
  is_active: boolean
  last_activity_at?: string | null
}

export type TaskType = 'finance' | 'technical' | 'academic' | 'other'
export type TaskStatus = 'open' | 'in_progress' | 'done' | 'cancelled'

export interface Task {
  id: string
  case_id: string | null
  family_id: string
  family_name?: string
  type: TaskType
  title: string
  details: string | null
  owner_id: string
  owner_name?: string
  status: TaskStatus
  due_at: string | null
  result: string | null
  created_at: string
  done_at: string | null
}

/** Brief §7. LOW / MEDIUM / HIGH — there is no CRITICAL. */
export type WorkloadLevel = 'low' | 'medium' | 'high'

export interface TeamNowRow {
  staff_id: string
  name: string
  presence: Presence
  now_count: number
  today_count: number
  late_replies: number
  workload_score: number
  workload_level: WorkloadLevel
  inactivity_warning: boolean
}

export interface Paginated<T> {
  items: T[]
  next_cursor: string | null
}
