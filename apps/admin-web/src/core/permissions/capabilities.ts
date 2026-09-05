/**
 * UX AFFORDANCES ONLY — NOT A SECURITY BOUNDARY.
 *
 * The backend is the sole authority (brief §12; docs/qa/rbac-matrix.md: "A
 * UI-only restriction is a defect, not a control"). Everything here exists so
 * that an operator sees a disabled control with an honest reason instead of
 * typing a reply and discovering a 403.
 *
 * Two consequences we hold ourselves to:
 *   1. Nothing here ever *grants* access. If the server says no, the answer is
 *      no, and the UI shows the server's message and refreshes.
 *   2. Per-family decisions are NOT made here. They come from the server in
 *      `FamilyDetail.capabilities`, because only the server can evaluate
 *      on_duty(family, now), stickiness, assist eligibility and owner_locked.
 *
 * This file therefore only answers coarse, role-level questions used for
 * navigation and page-level routing.
 */
import type { StaffRole } from '@/shared/types/domain'

export type NavArea =
  | 'inbox'
  | 'families'
  | 'tasks'
  | 'coverage'
  | 'dashboard'
  | 'settings'

/** Roles that operate the customer relationship. */
const OPERATOR_ROLES: readonly StaffRole[] = ['admin', 'coverage', 'manager']

/** Departments: see and complete only their own tasks. Never message families. */
const DEPARTMENT_ROLES: readonly StaffRole[] = ['finance', 'technical', 'academic']

export function isOperator(role: StaffRole): boolean {
  return OPERATOR_ROLES.includes(role)
}

export function isDepartment(role: StaffRole): boolean {
  return DEPARTMENT_ROLES.includes(role)
}

export function isManager(role: StaffRole): boolean {
  return role === 'manager'
}

/** Which nav areas this role may even attempt to open. */
export function visibleAreas(role: StaffRole): NavArea[] {
  if (isManager(role)) {
    return ['inbox', 'families', 'tasks', 'coverage', 'dashboard', 'settings']
  }
  if (isOperator(role)) {
    // No coverage configuration, no manager dashboard, no config editing.
    return ['inbox', 'families', 'tasks']
  }
  if (isDepartment(role)) {
    // Departments get tasks and nothing else — they may not open family records.
    return ['tasks']
  }
  return []
}

export function canOpenArea(role: StaffRole, area: NavArea): boolean {
  return visibleAreas(role).includes(area)
}

/** Manager-only, per the brief's invariants and AI #5's matrix. */
export const managerOnly = {
  transferOwnership: isManager,
  editCoverageConfig: isManager,
  editConfigWeights: isManager,
  readAuditLog: isManager,
  offboardStaff: isManager,
  activateBackup: isManager,
  viewTeamWorkload: isManager,
  viewUnattended: isManager,
} as const

/** The task scope a role should request from the API. */
export function taskScopeFor(role: StaffRole): 'mine' | 'team' | 'department' {
  if (isManager(role)) return 'team'
  if (isDepartment(role)) return 'department'
  return 'mine'
}
