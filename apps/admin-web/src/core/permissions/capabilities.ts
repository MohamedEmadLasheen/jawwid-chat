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
import type { StaffDepartment, StaffRole } from '@/shared/types/domain'

export type NavArea =
  | 'inbox'
  | 'families'
  | 'tasks'
  | 'coverage'
  | 'dashboard'
  | 'settings'

/** Roles that operate the customer relationship (PRD v0.1 §3). */
const OPERATOR_ROLES: readonly StaffRole[] = [
  'admin',
  'coverage_admin',
  'manager',
  'super_admin',
]

export function isOperator(role: StaffRole): boolean {
  return OPERATOR_ROLES.includes(role)
}

/**
 * Departments are an operational concept, NOT a role (product decision X-1).
 * A departmental staff member sees and completes only their own tasks and
 * never messages a family — but that is now driven by `staff.department`,
 * not by `staff.role`.
 */
export function isDepartment(department?: StaffDepartment | null): boolean {
  return department != null
}

/** PRD §3: super_admin has everything the manager has, and more. */
export function isManager(role: StaffRole): boolean {
  return role === 'manager' || role === 'super_admin'
}

/** Which nav areas this role may even attempt to open. */
export function visibleAreas(
  role: StaffRole,
  department?: StaffDepartment | null,
): NavArea[] {
  // Department first: a departmental staff member gets tasks and nothing else,
  // whatever operator role they also carry. They may not open family records.
  if (isDepartment(department)) {
    return ['tasks']
  }
  if (isManager(role)) {
    return ['inbox', 'families', 'tasks', 'coverage', 'dashboard', 'settings']
  }
  if (isOperator(role)) {
    // No coverage configuration, no manager dashboard, no config editing.
    return ['inbox', 'families', 'tasks']
  }
  return []
}

export function canOpenArea(
  role: StaffRole,
  area: NavArea,
  department?: StaffDepartment | null,
): boolean {
  return visibleAreas(role, department).includes(area)
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
export function taskScopeFor(
  role: StaffRole,
  department?: StaffDepartment | null,
): 'mine' | 'team' | 'department' {
  if (isDepartment(department)) return 'department'
  if (isManager(role)) return 'team'
  return 'mine'
}
