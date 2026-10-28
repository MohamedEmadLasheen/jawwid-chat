import { StaffRole } from '../communication/contracts/vocab';

/**
 * Staff-profile permission keys and the role -> permission mapping.
 *
 * AUTHORIZATION-MODEL §1.5: "Permissions are data, not code." Phase 1's
 * `chat.role_permission` table does not exist yet, so this constant is the
 * profile slice of that mapping; when the table lands these rows move into it
 * and `test/unit/staff-profile/staff-profile-authorization.spec.ts` asserts the
 * two agree, exactly as §3 prescribes for the other keys.
 *
 * WHAT THESE KEYS COVER, AND WHAT THEY NEVER COVER
 *   They decide who may view and edit staff PROFILES -- a photo, a job title,
 *   an introduction, responsibility labels, a reporting line. None of them
 *   grants anything over families, conversations, messages, calls, stories,
 *   roles, permissions, credentials or account status. There is deliberately no
 *   key here that could: role, permission, account status and login identity
 *   are not editable through the profile at all, by anyone.
 *
 * A key is necessary, never sufficient. Every `team_*` key also requires the
 * target to be a direct report of the actor (chat.staff_reporting_line); every
 * `org_*` key requires the same organization. AuthorizationService checks the
 * key AND the relation; neither alone admits anything.
 */
export const StaffProfilePermission = {
  /** Own photo, job title and introduction. */
  SELF_EDIT: 'profile.self.edit',
  /** View the profiles of one's direct reports. */
  TEAM_VIEW: 'team_profiles.view',
  /** Edit a direct report's job title and introduction. Never their photo or name. */
  TEAM_EDIT_PROFESSIONAL: 'team_profiles.edit_professional_info',
  /** Assign / end responsibility labels for a direct report. Never for oneself. */
  TEAM_RESPONSIBILITIES_MANAGE: 'team_responsibilities.manage',
  /** View every staff profile in the organization, and the organization overview. */
  ORG_VIEW: 'org_profiles.view',
  ORG_EDIT_PROFESSIONAL: 'org_profiles.edit_professional_info',
  /** Display name and photo of somebody else. Never role, account or status. */
  ORG_EDIT_IDENTITY: 'org_profiles.edit_identity',
  ORG_RESPONSIBILITIES_MANAGE: 'org_responsibilities.manage',
  /** Set or clear who a staff member reports to (team membership). */
  REPORTING_LINES_MANAGE: 'reporting_lines.manage',
  /** Read the audit trail of profiles the actor may view. AUTHORIZATION-MODEL §3 `audit.read`. */
  PROFILE_AUDIT_READ: 'profile_audit.read',
} as const;
export type StaffProfilePermission = (typeof StaffProfilePermission)[keyof typeof StaffProfilePermission];

const P = StaffProfilePermission;

/**
 * The default mapping. `manager` gets the team keys and nothing organization-
 * wide; only `super_admin` holds `reporting_lines.manage`, because team
 * membership is user management (AUTHORIZATION-MODEL §3 `users.manage`).
 */
export const ROLE_PROFILE_PERMISSIONS: Readonly<Record<StaffRole, readonly StaffProfilePermission[]>> = {
  [StaffRole.ADMIN]: [P.SELF_EDIT],
  [StaffRole.COVERAGE]: [P.SELF_EDIT],
  [StaffRole.FINANCE]: [P.SELF_EDIT],
  [StaffRole.TECHNICAL]: [P.SELF_EDIT],
  [StaffRole.ACADEMIC]: [P.SELF_EDIT],
  [StaffRole.SPECIALIST]: [P.SELF_EDIT],
  [StaffRole.MANAGER]: [
    P.SELF_EDIT,
    P.TEAM_VIEW,
    P.TEAM_EDIT_PROFESSIONAL,
    P.TEAM_RESPONSIBILITIES_MANAGE,
    P.PROFILE_AUDIT_READ,
  ],
  [StaffRole.SUPER_ADMIN]: [
    P.SELF_EDIT,
    P.TEAM_VIEW,
    P.ORG_VIEW,
    P.ORG_EDIT_PROFESSIONAL,
    P.ORG_EDIT_IDENTITY,
    P.ORG_RESPONSIBILITIES_MANAGE,
    P.REPORTING_LINES_MANAGE,
    P.PROFILE_AUDIT_READ,
  ],
};

export function profilePermissionsFor(role: string | undefined): ReadonlySet<StaffProfilePermission> {
  const granted = role ? ROLE_PROFILE_PERMISSIONS[role as StaffRole] : undefined;
  return new Set(granted ?? []);
}

/**
 * The target of a profile decision, as the DATABASE says it is.
 *
 * Resolved by StaffProfileService from chat.staff and chat.staff_reporting_line
 * and handed to AuthorizationService as a fact -- the same arrangement as the
 * PD-6 relationship predicate, which keeps the decision itself database-free
 * and testable without a server. Nothing on this object comes from a request.
 */
export interface StaffProfileTarget {
  staffId: string;
  role: string;
  organizationId: string;
  isActive: boolean;
  /** chat.staff_reporting_line.manager_id = the actor. */
  reportsToActor: boolean;
}

/** How the actor relates to the profile. `none` is never returned to a client. */
export type ProfileRelation = 'self' | 'team' | 'organization' | 'none';

/**
 * What the actor may do with ONE profile. Returned to the client as-is so the
 * page shows exactly the controls the server will honour -- and enforced by the
 * service field by field, so a hand-built request gains nothing a hidden
 * control would have refused.
 */
export interface StaffProfileAccess {
  relation: ProfileRelation;
  canView: boolean;
  /** Job title and introduction. */
  canEditProfessional: boolean;
  canEditPhoto: boolean;
  /** Display name. */
  canEditDisplayName: boolean;
  canManageResponsibilities: boolean;
  canManageReportingLine: boolean;
  canReadAudit: boolean;
}

export const NO_PROFILE_ACCESS: StaffProfileAccess = Object.freeze({
  relation: 'none',
  canView: false,
  canEditProfessional: false,
  canEditPhoto: false,
  canEditDisplayName: false,
  canManageResponsibilities: false,
  canManageReportingLine: false,
  canReadAudit: false,
});

/** Roles whose holders can never be somebody's team member. */
export const NEVER_A_TEAM_MEMBER: ReadonlySet<string> = new Set([StaffRole.MANAGER, StaffRole.SUPER_ADMIN]);
