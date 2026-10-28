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
  /** PD-40: a department account (the Designer) with no implicit powers; it opens only what it was granted. */
  | 'specialist'
  | 'system'
  /** PD-40: a department account with no implicit powers -- only what its access roles open. */
  | 'specialist'

export type Presence = 'online' | 'away' | 'offline'

export interface Staff {
  id: string
  name: string
  role: StaffRole
  presence: Presence
  is_active: boolean
  last_activity_at?: string | null
  /**
   * PD-40: the permission keys /me reports. UX only -- a page or a Dashboard
   * section is offered when the key is held; the server decides every request.
   * Absent from an API that predates PD-40.
   */
  permissions?: string[]
}

export interface Paginated<T> {
  items: T[]
  next_cursor: string | null
}
