/**
 * Phase 3 business-model types, mirroring the API's DTOs.
 *
 * ONE CONVENTION THROUGHOUT: current state and history are never merged into a
 * single "latest" field. Every historical row carries `isCurrent`, computed by
 * the server from `ended_at is null`, so the UI can render the two differently
 * and can never present a past relationship as a present one.
 */

export interface FamilySummary {
  id: string
  displayName: string
  state: string
  tier: string
  language: string
  supervisorId: string
  supervisorName: string | null
}

/** The six-value lifecycle. There is deliberately no `isActive` column. */
export const ACTIVE_FAMILY_STATES = ['onboarding', 'active', 'at_risk', 'renewal_due'] as const

export function familyIsActive(state: string): boolean {
  return (ACTIVE_FAMILY_STATES as readonly string[]).includes(state)
}

/**
 * The two states a Phase 3 operator may set. `at_risk` and `renewal_due` belong
 * to the frozen renewal machinery: they are displayed when stored, and no
 * control offers them.
 */
export const SETTABLE_INACTIVE_STATES = ['paused', 'churned'] as const
export type SettableInactiveState = (typeof SETTABLE_INACTIVE_STATES)[number]

export interface Learner {
  id: string
  familyId: string
  name: string
  level: string | null
  isActive: boolean
  currentTeacherId: string | null
  currentTeacherName: string | null
  deactivatedAt: string | null
  createdAt: string
}

export interface TeacherAssignment {
  id: string
  learnerId: string
  teacherId: string
  teacherName: string | null
  startedAt: string
  endedAt: string | null
  endedReason: string | null
  reason: string
  /** Reconstructed at the Phase 3 cutover: `startedAt` is a baseline, not observed. */
  isBackfilled: boolean
  isCurrent: boolean
}

export interface SupervisorAssignment {
  id: string
  familyId: string
  staffId: string
  staffName: string | null
  kind: string
  startsAt: string
  endsAt: string | null
  endedAt: string | null
  reason: string
}

export interface LifecycleEntry {
  at: string
  from: string | null
  to: string | null
  reason: string | null
}

export interface Group {
  id: string
  name: string
  state: 'active' | 'closed' | 'archived'
  ownerId: string
  ownerName: string | null
  replacedByGroupId: string | null
  closedAt: string | null
  archivedAt: string | null
  createdAt: string
}

export interface GroupMember {
  id: string
  learnerId: string
  learnerName: string | null
  familyId: string | null
  joinedAt: string
  leftAt: string | null
  removedReason: string | null
  isCurrent: boolean
}

export interface GroupTeacher {
  id: string
  teacherId: string
  teacherName: string | null
  startedAt: string
  endedAt: string | null
  removedReason: string | null
  isCurrent: boolean
}

export interface GroupHistoryEntry {
  at: string
  type: string
  payload: Record<string, unknown>
}

export interface Label {
  id: string
  name: string
  color: string | null
  description: string | null
  familyCount: number
  createdAt: string
}

/** Per-family result of a bulk label operation. */
export interface BulkOutcome {
  familyId: string
  status: 'applied' | 'already' | 'out_of_scope' | 'not_found'
}

export function splitCurrent<T extends { isCurrent: boolean }>(rows: readonly T[]) {
  return {
    current: rows.filter((r) => r.isCurrent),
    former: rows.filter((r) => !r.isCurrent),
  }
}
