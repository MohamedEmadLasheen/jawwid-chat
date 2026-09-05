/**
 * Domain types for Jawwid Chat.
 *
 * Mirrors the data model in the project brief (docs/JAWWID_CHAT_BRIEF.txt §3)
 * and the contract in docs/admin/backend-contract-required.md.
 *
 * Rules that these types deliberately encode:
 *  - There is no `super_admin` role.
 *  - `workload_level` has no CRITICAL level.
 *  - Attention is a server-computed `bucket` + `top_reason` TEXT. There is no
 *    client-visible score, and no P1/P2/P3.
 *  - One thread per family; `Case` is layered on the thread, never a second thread.
 */

export type StaffRole =
  | 'admin'
  | 'coverage'
  | 'manager'
  | 'finance'
  | 'technical'
  | 'academic'
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

/** Which authority the current staff member is acting under for a family. */
export type HandlingMode =
  | 'owner'
  | 'coverage'
  | 'assist'
  | 'escalation'
  | 'sticky'
  | 'none'

/** Brief §6. Ordered by urgency; never rendered as a number. */
export type AttentionBucket = 'now' | 'today' | 'waiting_family' | 'quiet'

export type FamilyState =
  | 'onboarding'
  | 'active'
  | 'at_risk'
  | 'renewal_due'
  | 'paused'
  | 'churned'

export type FamilyTier = 'standard' | 'priority'

export interface ResponseTarget {
  /** 0..1 of the target elapsed. Computed by the server. */
  elapsed_pct: number
  breached: boolean
  due_at: string | null
}

/** One row of the admin inbox. The unit is a FAMILY, not a ticket (brief §8). */
export interface InboxRow {
  family_id: string
  display_name: string
  bucket: AttentionBucket
  /** Localised display text, e.g. "class started 5 minutes ago". Never a score. */
  top_reason: string
  waiting_since: string | null
  needs_reply: boolean
  tier: FamilyTier
  state: FamilyState
  owner_id: string
  on_duty_id: string | null
  handling_mode: HandlingMode
  open_case_count: number
  response_target: ResponseTarget | null
}

export type ContactPreset =
  | 'primary_guardian'
  | 'billing_authorized'
  | 'authorized_contact'
  | 'secondary_read_only'

/**
 * The six capability flags from brief §2. Presets are display sugar over these;
 * AI #5 (rbac-matrix §2) requires that behaviour keys off flags, not presets.
 * Note there is deliberately no phone/contact-number field.
 */
export interface Contact {
  id: string
  name: string
  relationship: string
  role_preset: ContactPreset
  can_message: boolean
  can_view_progress: boolean
  can_manage_schedule: boolean
  can_manage_billing: boolean
  can_manage_contacts: boolean
  can_cancel: boolean
  is_active: boolean
}

export interface Learner {
  id: string
  name: string
  level: string | null
  teacher_name: string | null
  next_class_at: string | null
  last_attended_at: string | null
  consecutive_absences: number
}

export interface Subscription {
  plan: string
  status: string
  ends_at: string | null
  renewal_due_at: string | null
  last_payment_status: string | null
  last_payment_at: string | null
}

export type CaseType =
  | 'technical'
  | 'billing'
  | 'schedule'
  | 'renewal'
  | 'cancellation'
  | 'complaint'
  | 'onboarding'
  | 'at_risk'
  | 'academic'
  | 'general'

export type CaseStatus =
  | 'open'
  | 'waiting_customer'
  | 'waiting_internal'
  | 'scheduled'
  | 'resolved'
  | 'closed'

export type CaseSeverity = 'low' | 'medium' | 'high'

export interface Case {
  id: string
  family_id: string
  learner_id: string | null
  type: CaseType
  severity: CaseSeverity | null
  is_blocking: boolean
  status: CaseStatus
  handler_id: string | null
  /** Relationship cases. Coverage may never close these (brief §5). */
  owner_locked: boolean
  due_at: string | null
  follow_up_reason: string | null
  escalation_level: number
  escalated_to_id: string | null
  resolved_at: string | null
  reopen_count: number
}

export type MessageAuthorType = 'contact' | 'staff' | 'system'
export type MessageVisibility = 'customer' | 'internal'
export type OnBehalfMode = 'owner' | 'coverage' | 'assist' | 'escalation'

export interface Attachment {
  id: string
  name: string
  content_type: string
  size_bytes: number
  url: string
}

export interface Message {
  id: string
  case_id: string | null
  author_type: MessageAuthorType
  author_id: string | null
  author_name: string | null
  /** Set by the server from on_duty(); the client never chooses it (brief §12). */
  on_behalf_mode: OnBehalfMode | null
  body: string
  attachments: Attachment[]
  visibility: MessageVisibility
  created_at: string
  /** Present on author_type === 'system' so the UI can render an event card. */
  system_kind?: string | null
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

export type HandoffReason =
  | 'shift_end'
  | 'absence'
  | 'friday'
  | 'assist'
  | 'escalation'
  | 'sticky_expired'

export interface Handoff {
  id: string
  family_id: string
  family_name?: string
  from_staff_id: string | null
  from_staff_name?: string | null
  to_staff_id: string
  to_staff_name?: string
  reason: HandoffReason
  summary: string | null
  note: string | null
  created_at: string
  acknowledged_at: string | null
}

export interface FamilyNote {
  id: string
  author_id: string
  author_name?: string
  body: string
  pinned: boolean
  created_at: string
}

/**
 * UX affordances only. The backend re-checks every write (brief §12,
 * AI #5 rbac-matrix). A `false` here disables a control and shows an honest
 * reason; it is never the thing that keeps an action safe.
 */
export interface FamilyCapabilities {
  can_send_customer_message: boolean
  can_reply_as_assist: boolean
  assist_blocked_reason?: string | null
  can_close_owner_locked: boolean
  can_transfer_ownership: boolean
  can_create_task: boolean
  can_escalate: boolean
}

export interface FamilyDetail {
  family: {
    id: string
    display_name: string
    tier: FamilyTier
    tier_reason: string | null
    state: FamilyState
    state_reason: string | null
    state_changed_at: string | null
    language: string
    manual_flag: 'urgent' | null
    manual_flag_reason: string | null
  }
  owner: Pick<Staff, 'id' | 'name'>
  on_duty: { id: string; name: string; mode: HandlingMode } | null
  contacts: Contact[]
  learners: Learner[]
  subscription: Subscription | null
  pinned_notes: FamilyNote[]
  recent_cases: Case[]
  open_tasks: Task[]
  capabilities: FamilyCapabilities
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

export interface Shift {
  id: string
  staff_id: string
  staff_name?: string
  days: number[]
  starts: string
  ends: string
  valid_from: string | null
  valid_to: string | null
}

export type CoverageWindow = 'outside_owner_shift' | 'all_day' | 'custom'

export interface CoverageRule {
  id: string
  covering_id: string
  covering_name?: string
  /** null means ALL owners. */
  covered_id: string | null
  covered_name?: string | null
  days: number[]
  window: CoverageWindow
  custom_from: string | null
  custom_to: string | null
  priority: number
  valid_from: string | null
  valid_to: string | null
}

export type AbsenceType = 'planned' | 'sick' | 'auto_detected'

export interface Absence {
  id: string
  staff_id: string
  staff_name?: string
  from: string
  to: string
  backup_id: string | null
  backup_name?: string | null
  type: AbsenceType
}

export interface CoverageGap {
  kind: 'absence_without_backup' | 'missing_rule' | 'uncovered_window'
  starts_at: string
  ends_at: string
  description: string
  staff_id: string | null
}

export interface Paginated<T> {
  items: T[]
  next_cursor: string | null
}
