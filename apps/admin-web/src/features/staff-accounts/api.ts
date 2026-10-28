import { api } from '@/core/api/client'

/**
 * PD-40 PR-3 wire contract, mirrored from apps/api/src/staff-accounts.
 *
 * Who may create, see or manage which staff account, and grant which role, is
 * the server's answer alone (staff-account-policy.ts, then the SQL writers):
 * the super admin every staff account but their own; a department manager the
 * specialists of the department they run. `grantable` is advisory -- every
 * write is decided again.
 */

/** chat.staff.role. The four a staff account is created with, then the legacy department tiers. */
export type StaffTier = 'specialist' | 'admin' | 'coverage' | 'manager' | 'finance' | 'technical' | 'academic'
export type CreatableTier = 'specialist' | 'admin' | 'coverage' | 'manager'
export type StaffAccountStatus = 'provisioned' | 'active' | 'suspended' | 'deactivated'
export type RoleMaxTier = 'specialist' | 'supervisor' | 'manager'
export type PermissionRisk = 'none' | 'pii' | 'family_contact' | 'finance' | 'admin'

export interface StaffAccountRole {
  id: string
  key: string
  nameEn: string
  nameAr: string
}

export interface StaffAccount {
  staffId: string
  /** '' when the staff member has no sign-in. */
  accountId: string
  name: string
  tier: string
  status: string
  /** A specialist's department; null for anyone else. */
  departmentId: string | null
  roles: StaffAccountRole[]
  lastLoginAt: string | null
  /** Provisioned, with a live first sign-in code waiting. */
  setupPending: boolean
}

/**
 * The first sign-in code: shown ONCE, never stored by the client. `code` is
 * absent when a manager reissues it -- then it went by e-mail only.
 */
export interface StaffFirstLogin {
  code?: string
  expiresAt: string
  emailed: boolean
}

export interface CreatedStaffAccount {
  account: StaffAccount
  signIn: string
  firstLogin: StaffFirstLogin
}

export interface NewStaffAccount {
  name: string
  email: string
  tier: CreatableTier
  departmentId?: string
  roleIds: string[]
  reason: string
}

export interface AccessRole {
  id: string
  key: string
  nameEn: string
  nameAr: string
  description: string | null
  maxTier: string
  permissions: string[]
  archived: boolean
  /** Seeded from a template (PD-40 PR-4). Where it came from, nothing more. */
  template: boolean
  /** May THIS caller grant it now? Advisory: the database decides again. */
  grantable: boolean
}

export interface PermissionEntry {
  key: string
  page: string
  action: string
  label: { en: string; ar: string }
  risk: PermissionRisk | string
  delegable: boolean
  /** False: never part of a role (the super admin's own powers, account administration). */
  inRoles: boolean
}

export interface NewAccessRole {
  key: string
  nameEn: string
  nameAr: string
  description?: string
  maxTier: RoleMaxTier
  permissions: string[]
  reason: string
}

export interface AccessRoleEdit {
  nameEn: string
  nameAr: string
  description?: string
  permissions: string[]
  reason: string
}

export const staffAccountKeys = {
  all: ['staff-accounts'] as const,
  list: ['staff-accounts', 'list'] as const,
  one: (staffId: string) => ['staff-accounts', 'one', staffId] as const,
  roles: ['staff-accounts', 'roles'] as const,
  permissions: ['staff-accounts', 'permissions'] as const,
}

const path = (staffId: string) => `/admin/staff-accounts/${encodeURIComponent(staffId)}`
const rolePath = (roleId: string) => `/admin/access-roles/${encodeURIComponent(roleId)}`

export const staffAccountsApi = {
  list: () => api.get<{ accounts: StaffAccount[] }>('/admin/staff-accounts'),
  get: (staffId: string) => api.get<StaffAccount>(path(staffId)),
  create: (body: NewStaffAccount) => api.post<CreatedStaffAccount>('/admin/staff-accounts', body),
  grant: (staffId: string, roleId: string, reason: string) => api.post<StaffAccount>(`${path(staffId)}/roles`, { roleId, reason }),
  revoke: (staffId: string, roleId: string, reason: string) =>
    api.post<StaffAccount>(`${path(staffId)}/roles/${encodeURIComponent(roleId)}/revoke`, { reason }),
  setupCode: (staffId: string, reason: string) => api.post<{ firstLogin: StaffFirstLogin }>(`${path(staffId)}/setup-code`, { reason }),

  roles: () => api.get<{ roles: AccessRole[] }>('/admin/access-roles'),
  permissions: () => api.get<{ permissions: PermissionEntry[] }>('/admin/permissions'),
  defineRole: (body: NewAccessRole) => api.post<{ role: AccessRole }>('/admin/access-roles', body),
  updateRole: (roleId: string, body: AccessRoleEdit) => api.post<{ role: AccessRole }>(rolePath(roleId), body),
  archiveRole: (roleId: string, reason: string) => api.post<{ role: AccessRole }>(`${rolePath(roleId)}/archive`, { reason }),
}

/** The tier rank a role's `maxTier` is compared with (plan §5): a role is granted up to its tier. */
const RANK: Record<string, number> = { specialist: 1, admin: 2, coverage: 2, supervisor: 2, manager: 3 }

/** May a role with this `maxTier` go to an account of this tier? Advisory, like `grantable`. */
export function roleFitsTier(maxTier: string, tier: string): boolean {
  return (RANK[maxTier] ?? 0) >= (RANK[tier] ?? Number.POSITIVE_INFINITY)
}
