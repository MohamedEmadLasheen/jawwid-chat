import { api, newIdempotencyKey } from './client'
import type {
  Absence,
  AttentionBucket,
  Case,
  CoverageGap,
  CoverageRule,
  FamilyDetail,
  Handoff,
  InboxRow,
  Message,
  Paginated,
  Shift,
  Staff,
  Task,
  TeamNowRow,
  WorkloadLevel,
} from '@/shared/types/domain'

/* ---------------------------------------------------------------- session */

export interface DutyState {
  in_shift: boolean
  shift_ends_at: string | null
  covering_for: string[]
  sticky_threads: number
}

export const sessionApi = {
  me: () => api.get<Staff>('/me'),
  duty: () => api.get<DutyState>('/me/duty'),
  login: (email: string, password: string) =>
    api.post<Staff>('/auth/login', { email, password }),
  logout: () => api.post<void>('/auth/logout'),
}

/**
 * Every threshold, weight and window from the brief lives here. The UI reads
 * labels and limits from this map; it never hardcodes 60 / 25 / 8 / 15.
 */
export type AppConfig = Record<string, unknown>
export const configApi = {
  get: () => api.get<AppConfig>('/config'),
  update: (patch: AppConfig) => api.patch<AppConfig>('/config', patch, newIdempotencyKey()),
}

/* ------------------------------------------------------------------ inbox */

export type InboxSection = AttentionBucket | 'covering'

export interface ShiftBanner {
  minutes_remaining: number
  waiting_count: number
  follow_up_count: number
  can_snooze: boolean
}

export const inboxApi = {
  section: (section: InboxSection, cursor?: string, limit = 30) =>
    api.get<Paginated<InboxRow>>('/inbox', { section, cursor, limit }),
  awaySummary: () => api.get<{ handoffs: Handoff[]; since: string | null }>('/inbox/away-summary'),
  shiftBanner: () => api.get<ShiftBanner | null>('/inbox/shift-banner'),
  snoozeToNextShift: (familyIds: string[]) =>
    api.post<void>('/inbox/snooze-to-next-shift', { family_ids: familyIds }, newIdempotencyKey()),
  /**
   * Brief §6: "this order is wrong" calibration logging. MVP-required — it is
   * how the initial attention weights get replaced by real ones after 60-90 days.
   */
  orderFeedback: (input: {
    family_id: string
    section: InboxSection
    position: number
    what_i_would_have_done: string
  }) => api.post<void>('/inbox/order-feedback', input, newIdempotencyKey()),
}

/* ----------------------------------------------------------------- family */

export const familyApi = {
  detail: (id: string) => api.get<FamilyDetail>(`/families/${id}`),
  messages: (id: string, cursor?: string, limit = 40) =>
    api.get<Paginated<Message>>(`/families/${id}/messages`, { cursor, limit }),
  /**
   * `on_behalf_mode` is intentionally absent: the server derives it from
   * on_duty(). Brief §12 forbids the client choosing it.
   */
  sendMessage: (
    id: string,
    input: { body: string; visibility: 'customer' | 'internal'; case_id?: string | null },
    idempotencyKey: string,
  ) => api.post<Message>(`/families/${id}/messages`, input, idempotencyKey),
  cases: (id: string) => api.get<Case[]>(`/families/${id}/cases`),
  createCase: (
    id: string,
    input: { type: Case['type']; severity?: Case['severity']; is_blocking?: boolean; due_at?: string | null },
  ) => api.post<Case>(`/families/${id}/cases`, input, newIdempotencyKey()),
  addNote: (id: string, body: string, pinned = false) =>
    api.post<void>(`/families/${id}/notes`, { body, pinned }, newIdempotencyKey()),
  pinHandler: (id: string) => api.post<void>(`/families/${id}/pin-handler`, {}, newIdempotencyKey()),
  deferToOwner: (id: string) =>
    api.post<void>(`/families/${id}/defer-to-owner`, {}, newIdempotencyKey()),
  list: (filters: {
    q?: string
    owner_id?: string
    on_duty_id?: string
    bucket?: AttentionBucket
    state?: string
    needs_reply?: boolean
    cursor?: string
    limit?: number
  }) => api.get<Paginated<InboxRow>>('/families', filters),
  transferImpact: (id: string, toStaffId: string) =>
    api.get<{
      families_affected: number
      open_cases: number
      open_tasks: number
      target_workload_score: number
      target_workload_level: WorkloadLevel
    }>(`/families/${id}/transfer-impact`, { to_staff_id: toStaffId }),
  /** The ONLY path that changes family.owner_id. `reason` is NOT NULL. */
  transferOwnership: (id: string, toStaffId: string, reason: string) =>
    api.post<void>(
      `/families/${id}/transfer-ownership`,
      { to_staff_id: toStaffId, reason },
      newIdempotencyKey(),
    ),
}

export const caseApi = {
  update: (id: string, patch: Partial<Pick<Case, 'status' | 'severity' | 'is_blocking' | 'due_at' | 'handler_id'>>) =>
    api.patch<Case>(`/cases/${id}`, patch, newIdempotencyKey()),
  escalate: (id: string, reason: string) =>
    api.post<void>(`/cases/${id}/escalate`, { reason }, newIdempotencyKey()),
  followUp: (id: string, dueAt: string, reason: string) =>
    api.post<void>(`/cases/${id}/follow-up`, { due_at: dueAt, reason }, newIdempotencyKey()),
}

/* ------------------------------------------------------------------ tasks */

export const taskApi = {
  list: (filters: {
    scope: 'mine' | 'team' | 'department'
    status?: string
    type?: string
    overdue?: boolean
    cursor?: string
    limit?: number
  }) => api.get<Paginated<Task>>('/tasks', filters),
  create: (input: {
    family_id: string
    case_id?: string | null
    type: Task['type']
    title: string
    details?: string
    owner_id: string
    due_at?: string | null
  }) => api.post<Task>('/tasks', input, newIdempotencyKey()),
  update: (id: string, patch: Partial<Pick<Task, 'status' | 'due_at' | 'result'>>) =>
    api.patch<Task>(`/tasks/${id}`, patch, newIdempotencyKey()),
}

/* --------------------------------------------------------------- coverage */

export const coverageApi = {
  shifts: () => api.get<Shift[]>('/coverage/shifts'),
  createShift: (input: Omit<Shift, 'id' | 'staff_name'>) =>
    api.post<Shift>('/coverage/shifts', input, newIdempotencyKey()),
  updateShift: (id: string, patch: Partial<Shift>) =>
    api.patch<Shift>(`/coverage/shifts/${id}`, patch, newIdempotencyKey()),
  deleteShift: (id: string) => api.delete<void>(`/coverage/shifts/${id}`),

  rules: () => api.get<CoverageRule[]>('/coverage/rules'),
  createRule: (input: Omit<CoverageRule, 'id' | 'covering_name' | 'covered_name'>) =>
    api.post<CoverageRule>('/coverage/rules', input, newIdempotencyKey()),
  updateRule: (id: string, patch: Partial<CoverageRule>) =>
    api.patch<CoverageRule>(`/coverage/rules/${id}`, patch, newIdempotencyKey()),
  deleteRule: (id: string) => api.delete<void>(`/coverage/rules/${id}`),

  absences: () => api.get<Absence[]>('/coverage/absences'),
  createAbsence: (input: Omit<Absence, 'id' | 'staff_name' | 'backup_name'>) =>
    api.post<Absence>('/coverage/absences', input, newIdempotencyKey()),
  /** Manager one-click. Never automatic in MVP (brief §4). */
  activateBackup: (absenceId: string) =>
    api.post<void>(`/absences/${absenceId}/activate-backup`, {}, newIdempotencyKey()),

  tonight: () => api.get<{ covering_id: string; covering_name: string; covered_id: string | null; covered_name: string | null }[]>('/coverage/tonight'),
  gaps: (days: number) => api.get<CoverageGap[]>('/coverage/gaps', { days }),
}

/* -------------------------------------------------------------- dashboard */

export interface DashboardHeader {
  unattended_count: number
  open_escalations: number
}

export interface NeedsActionItem {
  kind: 'escalation' | 'auto_detected_absence' | 'high_admin_new_now'
  family_id: string | null
  family_name: string | null
  staff_id: string | null
  staff_name: string | null
  absence_id: string | null
  description: string
  at: string
}

export interface ThisWeek {
  renewals: { due: number; renewed: number; no_reply: number; refused: number }
  at_risk: { reason: string; count: number }[]
  target_compliance_pct: number
  median_first_reply_by_shift: { shift: string; median_minutes: number }[]
}

export const dashboardApi = {
  header: () => api.get<DashboardHeader>('/dashboard/header'),
  teamNow: () => api.get<TeamNowRow[]>('/dashboard/team-now'),
  unattended: (cursor?: string) =>
    api.get<Paginated<InboxRow>>('/dashboard/unattended', { cursor }),
  needsAction: () => api.get<NeedsActionItem[]>('/dashboard/needs-action'),
  thisWeek: () => api.get<ThisWeek>('/dashboard/this-week'),
}

export const staffApi = {
  list: () => api.get<Staff[]>('/staff'),
  offboard: (id: string, input: { mode: 'even' | 'named'; to_staff_id?: string; reason: string }) =>
    api.post<void>(`/staff/${id}/offboard`, input, newIdempotencyKey()),
}
