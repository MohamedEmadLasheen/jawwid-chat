/**
 * UX AFFORDANCES ONLY — NOT A SECURITY BOUNDARY.
 *
 * The backend is the sole authority. Everything here exists so that an operator
 * sees a disabled control with an honest reason instead of typing a reply and
 * discovering a 403.
 *
 * Two consequences we hold ourselves to:
 *   1. Nothing here ever *grants* access. If the server says no, the answer is
 *      no, and the UI shows the server's message and refreshes.
 *   2. Per-family decisions are NOT made here. Scope belongs to the server:
 *      which families a supervisor may reach is read live from the assignment
 *      table on every request, and no client can mirror that safely.
 *
 * PHASE 1 changed the vocabulary this file speaks (PD-5, and
 * docs/architecture/AUTHORIZATION-MODEL.md §2):
 *   `coverage`                          -> `coverage_admin`
 *   `finance` | `technical` | `academic` -> a DEPARTMENT on the staff row
 *   `super_admin`                       -> added; it exists from day one
 *
 * The server also publishes each actor's effective permission keys on `/me`,
 * with per-account overrides already applied. Prefer `hasPermission()` over the
 * role helpers for anything new: a per-person DENY is invisible to a role check.
 */
import type { Department, StaffRole } from '@/shared/types/domain'

export type NavArea =
  | 'inbox'
  | 'families'
  | 'tasks'
  | 'coverage'
  | 'dashboard'
  | 'settings'

/** Roles that operate the customer relationship. */
const OPERATOR_ROLES: readonly StaffRole[] = [
  'admin',
  'coverage_admin',
  'manager',
  'super_admin',
]

/** Roles that run the operation rather than a caseload. */
const MANAGEMENT_ROLES: readonly StaffRole[] = ['manager', 'super_admin']

export function isOperator(role: StaffRole, department?: Department | null): boolean {
  if (department) return false
  return OPERATOR_ROLES.includes(role)
}

/**
 * Departmental staff. Note the signature: a department is an ATTRIBUTE, not a
 * role, so this cannot be answered from the role alone -- which is exactly the
 * modelling error PD-5 corrected.
 */
export function isDepartment(_role: StaffRole, department?: Department | null): boolean {
  return Boolean(department)
}

export function isManager(role: StaffRole, department?: Department | null): boolean {
  if (department) return false
  return MANAGEMENT_ROLES.includes(role)
}

/** Organization owner: user management and credentials, on top of a manager's. */
export function isSuperAdmin(role: StaffRole, department?: Department | null): boolean {
  return !department && role === 'super_admin'
}

/** Which nav areas this role may even attempt to open. */
export function visibleAreas(role: StaffRole, department?: Department | null): NavArea[] {
  if (isManager(role, department)) {
    return ['inbox', 'families', 'tasks', 'coverage', 'dashboard', 'settings']
  }
  if (isOperator(role, department)) {
    // No coverage configuration, no manager dashboard, no config editing.
    return ['inbox', 'families', 'tasks']
  }
  if (isDepartment(role, department)) {
    // Departments get tasks and nothing else — they may not open family records.
    return ['tasks']
  }
  return []
}

export function canOpenArea(
  role: StaffRole,
  area: NavArea,
  department?: Department | null,
): boolean {
  return visibleAreas(role, department).includes(area)
}

/** Manager-and-above affordances. */
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

/** Super-admin-only affordances (accounts, credentials, others' sessions). */
export const superAdminOnly = {
  manageUsers: isSuperAdmin,
} as const

/**
 * The authoritative client-side check for anything added from Phase 1 onwards.
 *
 * `permissions` comes from `/me` and already has the account's ALLOW/DENY
 * overrides applied, so a person whose `messages.send` was denied individually
 * sees the composer disabled rather than a 403 after typing.
 */
export function hasPermission(
  permissions: readonly string[] | undefined,
  key: string,
): boolean {
  return permissions?.includes(key) ?? false
}

/** The task scope a role should request from the API. */
export function taskScopeFor(
  role: StaffRole,
  department?: Department | null,
): 'mine' | 'team' | 'department' {
  if (isManager(role, department)) return 'team'
  if (isDepartment(role, department)) return 'department'
  return 'mine'
}
