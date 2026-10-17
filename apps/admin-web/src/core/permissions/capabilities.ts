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
  | 'chat'
  | 'inbox'
  | 'families'
  | 'tasks'
  | 'coverage'
  | 'dashboard'
  | 'stories'
  | 'organization'
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

/**
 * The organization owner (PD-5). Sees every Admin Portal section, including the
 * ones still in development, plus every legacy screen. Seeing a section is not
 * being allowed to act in it: the API answers each request on its own, and
 * today it gives super_admin read-only inspection and nothing more.
 */
export function isSuperAdmin(role: StaffRole): boolean {
  return role === 'super_admin'
}

/** Which nav areas this role may even attempt to open. */
export function visibleAreas(role: StaffRole): NavArea[] {
  if (isSuperAdmin(role)) {
    return ['inbox', 'families', 'tasks', 'coverage', 'dashboard', 'stories', 'settings']
  }
  if (isManager(role)) {
    // PD-8: the department's structure -- children's supervisors and backups.
    return ['chat', 'inbox', 'families', 'organization', 'tasks', 'coverage', 'dashboard', 'stories', 'settings']
  }
  if (isOperator(role)) {
    // No coverage configuration, no manager dashboard, no config editing.
    // Stories IS here: admin and coverage hold the publisher role server-side
    // (AuthorizationService.canPublishStory), and a nav entry that hid a page
    // the server would happily serve is a worse lie than one that shows it.
    //
    // Chat is first: the conversation workspace on the real conversation API
    // (the same conversations parents and teachers are in). The server decides
    // which ones this admin may open -- staff scope -- not this list.
    return ['chat', 'inbox', 'families', 'tasks', 'stories']
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

/**
 * Areas that stay ROUTABLE (old links, bookmarks) but are not OFFERED in any
 * navigation. The legacy Inbox calls `/inbox` and `/families/*`, which no API
 * on any current branch serves, so presenting it as a destination would offer
 * a page that cannot load. The working conversation interface is `/chat`.
 */
export const UNLISTED_AREAS: ReadonlySet<NavArea> = new Set<NavArea>(['inbox'])

/** What navigation shows: the areas this role may open, minus the unlisted ones. */
export function navAreas(role: StaffRole): NavArea[] {
  return visibleAreas(role).filter((area) => !UNLISTED_AREAS.has(area))
}

/** Manager-only, per the brief's invariants and AI #5's matrix. */
export const managerOnly = {
  editCoverageConfig: isManager,
  editConfigWeights: isManager,
  readAuditLog: isManager,
  activateBackup: isManager,
  viewTeamWorkload: isManager,
  viewUnattended: isManager,
} as const

/**
 * Ownership and offboarding -- the approved policy (DB: 20261014110000, API:
 * AuthorizationService.canAssignFamilies / canTransferStaffFamilies /
 * canDeactivateStaff). Separate actions, separate rules; the database refuses
 * anything else whatever this says.
 */
export const ownershipActions = {
  /** families.assign: transfer or assign a family's owner. */
  transferOwnership: (role: StaffRole) => isManager(role) || isSuperAdmin(role),
  /** Offboarding, part 1: move a staff member's families. */
  moveStaffFamilies: (role: StaffRole) => isManager(role) || isSuperAdmin(role),
  /** Offboarding, part 2: deactivate the account (users.manage). */
  deactivateStaff: isSuperAdmin,
  /** Both parts in one transaction, so it needs both authorities. */
  offboardStaff: isSuperAdmin,
} as const

/** The task scope a role should request from the API. */
export function taskScopeFor(role: StaffRole): 'mine' | 'team' | 'department' {
  if (isManager(role) || isSuperAdmin(role)) return 'team'
  if (isDepartment(role)) return 'department'
  return 'mine'
}
